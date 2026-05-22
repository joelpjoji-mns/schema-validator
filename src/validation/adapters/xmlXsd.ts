import { XMLValidator } from 'fast-xml-parser';
import { makeIssue, rangeFromLineColumn, summarizeIssues, wholeDocumentRange } from '../textRanges';
import type { ValidationIssue, ValidationRequest, ValidationResult, ValidatorAdapter } from '../types';
import { parseXsdModel } from './xsd/parseXsdModel';
import { validateXmlAgainstXsdModel } from './xsd/validateXsdModel';

export const xmlXsdAdapter: ValidatorAdapter = {
  id: 'xml-xsd',
  label: 'XML + XSD',
  schemaFormats: ['xsd'],
  messageFormats: ['xml'],
  validate: (request) => validateXmlXsd(request),
};

export const validateXmlXsd = (request: ValidationRequest): ValidationResult => {
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

  const parsedModel = parseXsdModel({
    primary: {
      id: 'primary-schema',
      label: 'Main schema',
      text: request.schemaText,
    },
    relatedSchemas: request.relatedSchemas,
  });
  if (!parsedModel.ok) {
    return resultFromIssues(start, parsedModel.issues);
  }

  return resultFromIssues(start, validateXmlAgainstXsdModel(parsedModel.model, request.messageText));
};

const resultFromIssues = (startedAt: number, issues: ValidationIssue[]): ValidationResult => ({
  ok: issues.length === 0,
  adapterId: 'xml-xsd',
  summary: summarizeIssues(issues, 'XML + XSD'),
  durationMs: Math.max(0, performance.now() - startedAt),
  issues,
});
