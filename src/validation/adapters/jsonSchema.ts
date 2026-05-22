import Ajv, { type AnySchema, type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { parseMessageDocument, parseSchemaDocument, type SourceDocument } from '../structuredParsers';
import {
    describeActual,
    findTextRange,
    getValueAtPath,
    makeIssue,
    pointerToSegments,
    segmentsToPointer,
    summarizeIssues,
    wholeDocumentRange,
} from '../textRanges';
import type { ValidationIssue, ValidationRequest, ValidationResult, ValidatorAdapter } from '../types';

interface JsonSchemaValidationOptions {
  schemaData: unknown;
  schemaDocument: SourceDocument;
  payloadData: unknown;
  payloadDocument: SourceDocument;
  adapterId: string;
  adapterLabel: string;
  schemaRootPath?: string[];
}

export const jsonSchemaAdapter: ValidatorAdapter = {
  id: 'json-schema',
  label: 'JSON Schema',
  schemaFormats: ['json-schema'],
  messageFormats: ['json', 'yaml'],
  validate: (request) => validateJsonSchemaRequest(request, 'JSON Schema'),
};

export const tomlSchemaAdapter: ValidatorAdapter = {
  id: 'toml-schema',
  label: 'TOML + JSON Schema',
  schemaFormats: ['toml-schema'],
  messageFormats: ['toml'],
  validate: (request) => validateJsonSchemaRequest({ ...request, schemaFormat: 'json-schema' }, 'TOML + JSON Schema'),
};

export const validateJsonSchemaRequest = (
  request: ValidationRequest,
  adapterLabel = 'JSON Schema',
): ValidationResult => {
  const start = performance.now();
  const schema = parseSchemaDocument(request.schemaText);
  if (!schema.ok) {
    const issues = schema.issues.map((issue) => moveIssueToSchema(issue));
    return resultFromIssues(adapterLabel, 'json-schema', start, issues);
  }

  const payload = parseMessageDocument(request.messageFormat, request.messageText);
  if (!payload.ok) {
    return resultFromIssues(adapterLabel, 'json-schema', start, payload.issues);
  }

  return validateStructuredWithJsonSchema(
    {
      schemaData: schema.document.data,
      schemaDocument: schema.document,
      payloadData: payload.document.data,
      payloadDocument: payload.document,
      adapterId: request.schemaFormat === 'toml-schema' ? 'toml-schema' : 'json-schema',
      adapterLabel,
    },
    start,
  );
};

export const validateStructuredWithJsonSchema = (
  options: JsonSchemaValidationOptions,
  startedAt = performance.now(),
): ValidationResult => {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateSchema: false,
    allowUnionTypes: true,
    messages: true,
    verbose: true,
  });
  addFormats(ajv);

  let validate: ReturnType<Ajv['compile']>;
  try {
    validate = ajv.compile(options.schemaData as AnySchema);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The schema could not be compiled.';
    const issue = makeIssue({
      code: 'schema-compile-error',
      title: 'Schema cannot compile',
      message,
      schemaRange: options.schemaDocument.rootRange,
      hint: 'Check JSON Schema keywords, $ref targets, and malformed rule values.',
    });

    return resultFromIssues(options.adapterLabel, options.adapterId, startedAt, [issue]);
  }

  const ok = validate(options.payloadData);
  const issues = ok
    ? []
    : (validate.errors ?? []).map((error, index) =>
        mapAjvError(
          error,
          index,
          options.schemaDocument,
          options.payloadDocument,
          options.payloadData,
          options.schemaRootPath ?? [],
        ),
      );

  return resultFromIssues(options.adapterLabel, options.adapterId, startedAt, issues);
};

const mapAjvError = (
  error: ErrorObject,
  index: number,
  schemaDocument: SourceDocument,
  payloadDocument: SourceDocument,
  payloadData: unknown,
  schemaRootPath: string[],
): ValidationIssue => {
  const instanceSegments = pointerToSegments(error.instancePath);
  const schemaSegments = [...schemaRootPath, ...pointerToSegments(error.schemaPath)];
  const base = {
    schemaRange: schemaDocument.rangeForPath(schemaSegments) ?? schemaDocument.rootRange,
    schemaPointer: segmentsToPointer(schemaSegments),
    messagePointer: segmentsToPointer(instanceSegments),
    path: error.instancePath || '#',
  };

  if (error.keyword === 'required') {
    const missingProperty = String((error.params as { missingProperty?: unknown }).missingProperty ?? 'unknown');
    const requiredRange =
      schemaDocument.rangeForPath(schemaSegments) ?? findTextRange(schemaDocument.text, `"${missingProperty}"`);

    return makeIssue({
      ...base,
      code: 'missing-required-field',
      title: `Missing required field: ${missingProperty}`,
      message: `The message is missing the required field "${missingProperty}" at ${error.instancePath || 'the root object'}.`,
      expected: `Property "${missingProperty}" must exist.`,
      actual: 'Missing field',
      messageRange: payloadDocument.rangeForPath(instanceSegments) ?? payloadDocument.rootRange,
      schemaRange: requiredRange ?? base.schemaRange,
      hint: `Add "${missingProperty}" to the highlighted object in the message, or remove it from the schema's required list.`,
    });
  }

  if (error.keyword === 'additionalProperties') {
    const additionalProperty = String(
      (error.params as { additionalProperty?: unknown }).additionalProperty ?? 'unknown',
    );
    const propertySegments = [...instanceSegments, additionalProperty];

    return makeIssue({
      ...base,
      code: 'additional-property',
      title: `Unexpected field: ${additionalProperty}`,
      message: `The message contains "${additionalProperty}", but the schema does not allow extra fields here.`,
      expected: 'Only properties declared by the schema.',
      actual: `Extra property "${additionalProperty}"`,
      messageRange:
        payloadDocument.rangeForPath(propertySegments) ??
        payloadDocument.rangeForPath(instanceSegments) ??
        payloadDocument.rootRange,
      messagePointer: segmentsToPointer(propertySegments),
      hint: 'Remove the extra field or add it to the schema properties.',
    });
  }

  const value = getValueAtPath(payloadData, instanceSegments);
  const messageRange = payloadDocument.rangeForPath(instanceSegments) ?? payloadDocument.rootRange;

  if (error.keyword === 'type') {
    const expectedType = String((error.params as { type?: unknown }).type ?? 'the schema type');

    return makeIssue({
      ...base,
      code: 'wrong-type',
      title: `Wrong type at ${error.instancePath || 'root'}`,
      message: `Expected ${expectedType}, but the message has ${describeActual(value)}.`,
      expected: expectedType,
      actual: describeActual(value),
      messageRange,
      hint: `Change the highlighted value to ${expectedType}, or loosen the schema type rule.`,
    });
  }

  if (error.keyword === 'enum') {
    const allowedValues = ((error.params as { allowedValues?: unknown[] }).allowedValues ?? [])
      .map((valueItem) => JSON.stringify(valueItem))
      .join(', ');

    return makeIssue({
      ...base,
      code: 'enum-mismatch',
      title: 'Value is not allowed',
      message: `The highlighted value must be one of: ${allowedValues || 'the enum values'}.`,
      expected: allowedValues,
      actual: JSON.stringify(value),
      messageRange,
      hint: 'Choose one of the schema enum values or update the allowed list.',
    });
  }

  if (error.keyword === 'const') {
    const allowedValue = JSON.stringify((error.params as { allowedValue?: unknown }).allowedValue);

    return makeIssue({
      ...base,
      code: 'const-mismatch',
      title: 'Value does not match the constant',
      message: `The highlighted value must exactly equal ${allowedValue}.`,
      expected: allowedValue,
      actual: JSON.stringify(value),
      messageRange,
    });
  }

  if (error.keyword === 'pattern') {
    const pattern = String((error.params as { pattern?: unknown }).pattern ?? 'the regex pattern');

    return makeIssue({
      ...base,
      code: 'pattern-mismatch',
      title: 'Text does not match the required pattern',
      message: `The highlighted text must match /${pattern}/.`,
      expected: `/${pattern}/`,
      actual: JSON.stringify(value),
      messageRange,
      hint: 'Fix the characters in the highlighted value or update the schema pattern.',
    });
  }

  if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'].includes(error.keyword)) {
    const limit = String((error.params as { limit?: unknown }).limit ?? 'the schema limit');

    return makeIssue({
      ...base,
      code: 'number-out-of-range',
      title: 'Number is outside the allowed range',
      message: `The highlighted number violates the ${error.keyword} rule of ${limit}.`,
      expected: `${error.keyword}: ${limit}`,
      actual: JSON.stringify(value),
      messageRange,
    });
  }

  if (['minLength', 'maxLength'].includes(error.keyword)) {
    const limit = String((error.params as { limit?: unknown }).limit ?? 'the schema limit');

    return makeIssue({
      ...base,
      code: 'string-length',
      title: 'String length is invalid',
      message: `The highlighted string violates ${error.keyword} ${limit}.`,
      expected: `${error.keyword}: ${limit}`,
      actual: typeof value === 'string' ? `${value.length} characters` : describeActual(value),
      messageRange,
    });
  }

  if (['minItems', 'maxItems'].includes(error.keyword)) {
    const limit = String((error.params as { limit?: unknown }).limit ?? 'the schema limit');

    return makeIssue({
      ...base,
      code: 'array-size',
      title: 'Array size is invalid',
      message: `The highlighted array violates ${error.keyword} ${limit}.`,
      expected: `${error.keyword}: ${limit}`,
      actual: Array.isArray(value) ? `${value.length} items` : describeActual(value),
      messageRange,
    });
  }

  if (error.keyword === 'format') {
    const format = String((error.params as { format?: unknown }).format ?? 'format');

    return makeIssue({
      ...base,
      code: 'format-mismatch',
      title: `Invalid ${format} value`,
      message: `The highlighted value does not satisfy the ${format} format rule.`,
      expected: format,
      actual: JSON.stringify(value),
      messageRange,
    });
  }

  return makeIssue({
    ...base,
    code: `schema-rule-${error.keyword || index}`,
    title: 'Schema rule failed',
    message: error.message
      ? `The highlighted value ${error.message}.`
      : 'A schema rule failed for the highlighted value.',
    expected: error.schemaPath,
    actual: JSON.stringify(value),
    messageRange,
    hint: 'Check the linked schema rule and the highlighted message value together.',
  });
};

const resultFromIssues = (
  adapterLabel: string,
  adapterId: string,
  startedAt: number,
  issues: ValidationIssue[],
): ValidationResult => ({
  ok: issues.filter((issue) => issue.severity === 'error').length === 0,
  adapterId,
  summary: summarizeIssues(issues, adapterLabel),
  durationMs: Math.max(0, performance.now() - startedAt),
  issues,
});

const moveIssueToSchema = (issue: ValidationIssue): ValidationIssue => ({
  ...issue,
  schemaRange: issue.messageRange ?? issue.schemaRange ?? wholeDocumentRange(''),
  messageRange: undefined,
  title: issue.title.replace('JSON', 'schema'),
});
