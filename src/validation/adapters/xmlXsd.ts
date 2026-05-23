import { XMLValidator } from 'fast-xml-parser';
import { makeIssue, rangeFromLineColumn, summarizeIssues, wholeDocumentRange } from '../textRanges';
import type { ValidationIssue, ValidationRequest, ValidationResult, ValidatorAdapter } from '../types';
import { enrichXmllintIssues, type XmllintIssueEntry } from './xsd/enrichDiagnostics';
import { parseXsdModel } from './xsd/parseXsdModel';
import { validateXmlAgainstXsdModel } from './xsd/validateXsdModel';
import {
  findXmllintFile,
  validateXmlWithXmllint,
  XMLLINT_PRIMARY_SCHEMA_LABEL,
  XMLLINT_PRIMARY_SCHEMA_SOURCE_ID,
  XmllintEngineLoadError,
  type XmllintEngineError,
  type XmllintEngineFile,
  type XmllintEngineResult,
} from './xsd/xmllintWasmEngine';

export const xmlXsdAdapter: ValidatorAdapter = {
  id: 'xml-xsd',
  label: 'XML + XSD',
  schemaFormats: ['xsd'],
  messageFormats: ['xml'],
  validate: (request) => validateXmlXsd(request),
};

export const validateXmlXsd = async (request: ValidationRequest): Promise<ValidationResult> => {
  const start = performance.now();
  const issues: ValidationIssue[] = [];

  if (!request.schemaText.trim()) {
    issues.push(
      makeIssue({
        code: 'empty-xsd',
        title: 'Empty XSD schema',
        message: 'Paste or upload an XSD schema before validating XML.',
        schemaRange: wholeDocumentRange(request.schemaText),
      }),
    );
  }

  if (!request.messageText.trim()) {
    issues.push(
      makeIssue({
        code: 'empty-xml',
        title: 'Empty XML message',
        message: 'Paste or upload an XML message before validating.',
        messageRange: wholeDocumentRange(request.messageText),
      }),
    );
  }

  if (issues.length > 0) {
    return resultFromIssues(start, issues);
  }

  const xsdSyntax = XMLValidator.validate(request.schemaText, { allowBooleanAttributes: true });
  if (xsdSyntax !== true) {
    const err = xsdSyntax.err;
    issues.push(
      makeIssue({
        code: 'malformed-xsd',
        title: 'Malformed XSD',
        message: err.msg,
        schemaRange: rangeFromLineColumn(request.schemaText, err.line, err.col),
        hint: 'Fix the highlighted XSD syntax before validating the XML instance.',
      }),
    );
    return resultFromIssues(start, issues);
  }

  for (const source of request.relatedSchemas ?? []) {
    if (!source.text.trim()) {
      continue;
    }

    const sourceSyntax = XMLValidator.validate(source.text, { allowBooleanAttributes: true });
    if (sourceSyntax !== true) {
      const err = sourceSyntax.err;
      issues.push(
        makeIssue({
          code: 'malformed-xsd',
          title: `Malformed XSD: ${source.label}`,
          message: err.msg,
          schemaRange: rangeFromLineColumn(source.text, err.line, err.col),
          schemaSourceId: source.id,
          schemaSourceLabel: source.label,
          hint: 'Fix the highlighted auxiliary XSD syntax before validating the XML instance.',
        }),
      );
    }
  }

  if (issues.length > 0) {
    return resultFromIssues(start, issues);
  }

  const xmlSyntax = XMLValidator.validate(request.messageText, { allowBooleanAttributes: true });
  if (xmlSyntax !== true) {
    const err = xmlSyntax.err;
    issues.push(
      makeIssue({
        code: 'malformed-xml',
        title: 'Malformed XML',
        message: err.msg,
        messageRange: rangeFromLineColumn(request.messageText, err.line, err.col),
        hint: 'The XML parser stopped at the highlighted character, so schema validation cannot continue yet.',
      }),
    );
    return resultFromIssues(start, issues);
  }

  let engineFailure: unknown;
  try {
    const engineResult = await validateXmlWithXmllint(request);
    return resultFromIssues(start, issuesFromXmllint(engineResult, request));
  } catch (error) {
    engineFailure = error;
  }

  const parsedModel = parseXsdModel({
    primary: {
      id: 'primary-schema',
      label: 'Main schema',
      text: request.schemaText,
    },
    relatedSchemas: request.relatedSchemas,
  });
  if (!parsedModel.ok) {
    if (engineFailure) {
      return resultFromIssues(start, [engineUnavailableIssue(engineFailure, request)]);
    }

    return resultFromIssues(start, parsedModel.issues);
  }

  const fallbackIssues = validateXmlAgainstXsdModel(parsedModel.model, request.messageText);
  if (engineFailure && fallbackIssues.some(isUnsupportedFallbackIssue)) {
    return resultFromIssues(start, [engineUnavailableIssue(engineFailure, request)]);
  }

  return resultFromIssues(start, fallbackIssues);
};

const engineUnavailableIssue = (error: unknown, request: ValidationRequest): ValidationIssue => {
  const reason = error instanceof XmllintEngineLoadError ? 'could not be loaded' : 'stopped before validation finished';
  const detail = error instanceof Error && error.message ? ` ${error.message}` : '';

  return makeIssue({
    code: 'xsd-engine-unavailable',
    title: 'Full XSD engine unavailable',
    message: `The bundled libxml2/XSD engine ${reason}.${detail}`.trim(),
    schemaRange: wholeDocumentRange(request.schemaText),
    messageRange: wholeDocumentRange(request.messageText),
    hint: 'Refresh the page and verify the deployed build includes the xmllint WebAssembly assets before trusting XSD validation for this schema.',
  });
};

const isUnsupportedFallbackIssue = (issue: ValidationIssue) =>
  issue.code === 'unsupported-xsd-feature' ||
  issue.code === 'xsd-nested-particle' ||
  /unsupported/i.test(`${issue.title} ${issue.message}`);

const issuesFromXmllint = (result: XmllintEngineResult, request: ValidationRequest): ValidationIssue[] => {
  if (result.valid) {
    return [];
  }

  const errors = result.errors.length > 0 ? result.errors : [fallbackEngineError(result.rawOutput)];
  const entries: XmllintIssueEntry[] = errors.map((error) => ({
    issue: issueFromXmllintError(error, result.files, request),
    rawMessage: error.message || error.rawMessage,
  }));
  const parsedModel = parseXsdModel({
    primary: {
      id: 'primary-schema',
      label: 'Main schema',
      text: request.schemaText,
    },
    relatedSchemas: request.relatedSchemas,
  });

  return enrichXmllintIssues({
    issues: entries,
    request,
    model: parsedModel.ok ? parsedModel.model : undefined,
  });
};

const fallbackEngineError = (rawOutput: string): XmllintEngineError => ({
  rawMessage: rawOutput || 'The full XSD validation engine did not return detailed diagnostics.',
  message: rawOutput || 'The full XSD validation engine did not return detailed diagnostics.',
  loc: null,
});

const issueFromXmllintError = (
  error: XmllintEngineError,
  files: XmllintEngineFile[],
  request: ValidationRequest,
): ValidationIssue => {
  const file = findXmllintFile(files, error.loc?.fileName);
  const code = codeFromXmllintMessage(error.message, file);
  const message = cleanXmllintMessage(error.message || error.rawMessage);
  const base = {
    code,
    title: titleFromXmllintIssue(code, file),
    message,
    expected: expectedFromXmllintMessage(message),
    actual: actualFromXmllintMessage(message),
  };

  if (file?.role === 'message') {
    return makeIssue({
      ...base,
      messageRange: error.loc ? rangeFromLineColumn(file.text, error.loc.lineNumber, 1) : wholeDocumentRange(file.text),
      schemaRange: wholeDocumentRange(request.schemaText),
      schemaSourceId: XMLLINT_PRIMARY_SCHEMA_SOURCE_ID,
      schemaSourceLabel: XMLLINT_PRIMARY_SCHEMA_LABEL,
    });
  }

  if (file?.role === 'related-schema') {
    return makeIssue({
      ...base,
      schemaRange: error.loc ? rangeFromLineColumn(file.text, error.loc.lineNumber, 1) : wholeDocumentRange(file.text),
      schemaSourceId: file.sourceId,
      schemaSourceLabel: file.label,
      messageRange: wholeDocumentRange(request.messageText),
      hint: 'Fix the highlighted related XSD source before validating the XML instance.',
    });
  }

  return makeIssue({
    ...base,
    schemaRange:
      error.loc && file?.role === 'primary-schema'
        ? rangeFromLineColumn(file.text, error.loc.lineNumber, 1)
        : wholeDocumentRange(request.schemaText),
    schemaSourceId: XMLLINT_PRIMARY_SCHEMA_SOURCE_ID,
    schemaSourceLabel: XMLLINT_PRIMARY_SCHEMA_LABEL,
    messageRange: wholeDocumentRange(request.messageText),
    hint: 'Fix the highlighted XSD schema before validating the XML instance.',
  });
};

const codeFromXmllintMessage = (message: string, file: XmllintEngineFile | undefined) => {
  const normalized = message.toLowerCase();
  const facetMatch = /\[facet '([^']+)'\]/i.exec(message);
  if (facetMatch) {
    return `xsd-${kebabCase(facetMatch[1])}`;
  }

  if (normalized.includes('schemas parser error') || normalized.includes('failed to compile')) {
    return 'xsd-schema-error';
  }

  if (normalized.includes('no matching global declaration')) {
    return 'xsd-root-not-found';
  }

  if (normalized.includes('missing child element')) {
    return 'missing-xml-element';
  }

  if (normalized.includes('this element is not expected')) {
    return 'unexpected-xml-element';
  }

  if (normalized.includes('is required but missing')) {
    return 'missing-xml-attribute';
  }

  if (normalized.includes('not nillable') || normalized.includes("not 'nillable'")) {
    return 'xsd-nillable';
  }

  if (normalized.includes('attribute') && normalized.includes('is not allowed')) {
    return 'unexpected-xml-attribute';
  }

  if (normalized.includes('not a valid value') || normalized.includes('element content is not allowed')) {
    return 'xml-element-type';
  }

  return file?.role === 'message' ? 'xsd-validation-error' : 'xsd-schema-error';
};

const titleFromXmllintIssue = (code: string, file: XmllintEngineFile | undefined) => {
  const titles: Record<string, string> = {
    'xsd-schema-error': 'XSD schema error',
    'xsd-validation-error': 'XSD validation error',
    'xsd-root-not-found': 'No matching root declaration',
    'missing-xml-element': 'Missing required XML element',
    'unexpected-xml-element': 'Unexpected XML element',
    'missing-xml-attribute': 'Missing required XML attribute',
    'unexpected-xml-attribute': 'Unexpected XML attribute',
    'xml-element-type': 'XML value does not match the XSD type',
    'xsd-enumeration': 'Value is not allowed by the XSD enumeration',
    'xsd-pattern': 'Value does not match the XSD pattern',
    'xsd-min-length': 'Value is shorter than the XSD minimum length',
    'xsd-max-length': 'Value is longer than the XSD maximum length',
    'xsd-length': 'Value has the wrong XSD length',
    'xsd-min-inclusive': 'Value is below the XSD minimum',
    'xsd-max-inclusive': 'Value is above the XSD maximum',
    'xsd-min-exclusive': 'Value must be greater than the XSD minimum',
    'xsd-max-exclusive': 'Value must be less than the XSD maximum',
    'xsd-total-digits': 'Value has too many digits',
    'xsd-fraction-digits': 'Value has too many fractional digits',
  };

  const title = titles[code] ?? 'XSD validation error';
  return file?.role === 'related-schema' ? `${title}: ${file.label}` : title;
};

const cleanXmllintMessage = (message: string) =>
  message
    .replace(/^element\s+[^:]+:\s*/i, '')
    .replace(/^Schemas (?:validity|parser) error\s*:\s*/i, '')
    .trim();

const expectedFromXmllintMessage = (message: string) => {
  const expectedMatch = /Expected is (?:\(|\{)?([^.)]+)(?:\)|\.)?/i.exec(message);
  return expectedMatch?.[1]?.trim();
};

const actualFromXmllintMessage = (message: string) => {
  const valueMatch = /The value '([^']+)'/i.exec(message) ?? /value '([^']+)'/i.exec(message);
  return valueMatch?.[1];
};

const kebabCase = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const resultFromIssues = (startedAt: number, issues: ValidationIssue[]): ValidationResult => ({
  ok: issues.length === 0,
  adapterId: 'xml-xsd',
  summary: summarizeIssues(issues, 'XML + XSD'),
  durationMs: Math.max(0, performance.now() - startedAt),
  issues,
});
