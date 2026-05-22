import {
    buildSchema,
    parse as parseGraphql,
    validate as validateGraphql,
    type GraphQLError,
    type GraphQLSchema,
} from 'graphql';
import Papa from 'papaparse';
import protobuf from 'protobufjs';
import {
    parseJsonDocument,
    parseMessageDocument,
    parseSchemaDocument,
    type SourceDocument,
} from '../structuredParsers';
import {
    describeActual,
    findRegexRange,
    findTextRange,
    getValueAtPath,
    isRecord,
    makeIssue,
    pointerToSegments,
    rangeFromLineColumn,
    segmentsToPointer,
    summarizeIssues,
    wholeDocumentRange,
} from '../textRanges';
import type { TextRange, ValidationIssue, ValidationRequest, ValidationResult, ValidatorAdapter } from '../types';
import { validateStructuredWithJsonSchema } from './jsonSchema';

export const openApiAdapter: ValidatorAdapter = {
  id: 'openapi',
  label: 'OpenAPI Example',
  schemaFormats: ['openapi'],
  messageFormats: ['json', 'yaml'],
  validate: (request) => validateOpenApiExample(request),
};

export const graphqlAdapter: ValidatorAdapter = {
  id: 'graphql',
  label: 'GraphQL',
  schemaFormats: ['graphql'],
  messageFormats: ['graphql'],
  validate: (request) => validateGraphqlOperation(request),
};

export const protobufAdapter: ValidatorAdapter = {
  id: 'protobuf',
  label: 'Protocol Buffers JSON',
  schemaFormats: ['protobuf'],
  messageFormats: ['json'],
  validate: (request) => validateProtobufJson(request),
};

export const avroAdapter: ValidatorAdapter = {
  id: 'avro',
  label: 'Avro Record',
  schemaFormats: ['avro'],
  messageFormats: ['json'],
  validate: (request) => validateAvroRecord(request),
};

export const csvTableSchemaAdapter: ValidatorAdapter = {
  id: 'csv-table-schema',
  label: 'CSV Table Schema',
  schemaFormats: ['table-schema'],
  messageFormats: ['csv'],
  validate: (request) => validateCsvTableSchema(request),
};

export const keyValueRulesAdapter: ValidatorAdapter = {
  id: 'key-value-rules',
  label: 'INI / ENV Rules',
  schemaFormats: ['key-value-rules'],
  messageFormats: ['properties'],
  validate: (request) => validateKeyValueRules(request),
};

const validateOpenApiExample = (request: ValidationRequest): ValidationResult => {
  const start = performance.now();
  const schema = parseSchemaDocument(request.schemaText);
  if (!schema.ok) {
    return resultFromIssues('OpenAPI Example', 'openapi', start, schema.issues.map(moveIssueToSchema));
  }

  const payload = parseMessageDocument(request.messageFormat, request.messageText);
  if (!payload.ok) {
    return resultFromIssues('OpenAPI Example', 'openapi', start, payload.issues);
  }

  const schemaCandidate = findOpenApiSchema(schema.document.data);
  if (!schemaCandidate) {
    return resultFromIssues('OpenAPI Example', 'openapi', start, [
      makeIssue({
        code: 'openapi-schema-not-found',
        title: 'No OpenAPI schema found',
        message: 'Could not find a request, response, or component schema to validate against.',
        schemaRange: schema.document.rootRange,
        hint: 'Add a content schema under requestBody, responses, or components.schemas.',
      }),
    ]);
  }

  const resolved = resolveLocalRef(schemaCandidate.schema, schema.document.data, schemaCandidate.path);
  const normalizedSchema = normalizeOpenApiSchema(resolved.schema);

  return validateStructuredWithJsonSchema(
    {
      schemaData: normalizedSchema,
      schemaDocument: schema.document,
      payloadData: payload.document.data,
      payloadDocument: payload.document,
      adapterId: 'openapi',
      adapterLabel: 'OpenAPI Example',
      schemaRootPath: resolved.path,
    },
    start,
  );
};

const validateGraphqlOperation = (request: ValidationRequest): ValidationResult => {
  const start = performance.now();
  const issues: ValidationIssue[] = [];
  let schema: GraphQLSchema;

  if (!request.schemaText.trim()) {
    issues.push(
      makeIssue({
        code: 'empty-graphql-schema',
        title: 'Empty GraphQL schema',
        message: 'Paste a GraphQL SDL schema before validating an operation.',
        schemaRange: wholeDocumentRange(request.schemaText),
      }),
    );
  }

  if (!request.messageText.trim()) {
    issues.push(
      makeIssue({
        code: 'empty-graphql-operation',
        title: 'Empty GraphQL operation',
        message: 'Paste a query, mutation, or subscription before validating.',
        messageRange: wholeDocumentRange(request.messageText),
      }),
    );
  }

  if (issues.length > 0) {
    return resultFromIssues('GraphQL', 'graphql', start, issues);
  }

  try {
    schema = buildSchema(request.schemaText);
  } catch (error) {
    const graphError = error as GraphQLError;
    return resultFromIssues('GraphQL', 'graphql', start, [
      makeIssue({
        code: 'graphql-schema-error',
        title: 'GraphQL schema cannot build',
        message: graphError.message,
        schemaRange: graphqlRange(request.schemaText, graphError) ?? wholeDocumentRange(request.schemaText),
      }),
    ]);
  }

  try {
    const document = parseGraphql(request.messageText);
    const validationErrors = validateGraphql(schema, document);
    const mapped = validationErrors.map((error) =>
      makeIssue({
        code: 'graphql-validation-error',
        title: 'GraphQL operation is invalid',
        message: error.message,
        messageRange: graphqlRange(request.messageText, error) ?? wholeDocumentRange(request.messageText),
        schemaRange: findGraphqlSchemaRange(request.schemaText, error.message),
        hint: 'Check the highlighted operation node against the schema type or field rule.',
      }),
    );

    return resultFromIssues('GraphQL', 'graphql', start, mapped);
  } catch (error) {
    const graphError = error as GraphQLError;
    return resultFromIssues('GraphQL', 'graphql', start, [
      makeIssue({
        code: 'graphql-parse-error',
        title: 'GraphQL operation cannot parse',
        message: graphError.message,
        messageRange: graphqlRange(request.messageText, graphError) ?? wholeDocumentRange(request.messageText),
      }),
    ]);
  }
};

const validateProtobufJson = (request: ValidationRequest): ValidationResult => {
  const start = performance.now();
  let root: protobuf.Root;

  try {
    root = protobuf.parse(request.schemaText, { keepCase: true }).root;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The .proto schema could not be parsed.';
    return resultFromIssues('Protocol Buffers JSON', 'protobuf', start, [
      makeIssue({
        code: 'protobuf-schema-error',
        title: 'Protocol Buffers schema cannot parse',
        message,
        schemaRange: wholeDocumentRange(request.schemaText),
      }),
    ]);
  }

  const payload = parseJsonDocument(request.messageText);
  if (!payload.ok) {
    return resultFromIssues('Protocol Buffers JSON', 'protobuf', start, payload.issues);
  }

  const messageType = firstProtobufType(root);
  if (!messageType) {
    return resultFromIssues('Protocol Buffers JSON', 'protobuf', start, [
      makeIssue({
        code: 'protobuf-message-not-found',
        title: 'No protobuf message found',
        message: 'The schema parsed, but it does not declare a message type.',
        schemaRange: wholeDocumentRange(request.schemaText),
      }),
    ]);
  }

  const issues: ValidationIssue[] = [];
  const data = payload.document.data;
  if (!isRecord(data)) {
    issues.push(
      makeIssue({
        code: 'protobuf-message-object',
        title: 'Payload must be a JSON object',
        message: `The selected protobuf message ${messageType.fullName} expects a JSON object payload.`,
        expected: 'object',
        actual: describeActual(data),
        messageRange: payload.document.rootRange,
        schemaRange: findTextRange(request.schemaText, `message ${messageType.name}`),
      }),
    );
    return resultFromIssues('Protocol Buffers JSON', 'protobuf', start, issues);
  }

  for (const field of Object.values(messageType.fields)) {
    if (field.required && data[field.name] === undefined) {
      issues.push(
        makeIssue({
          code: 'protobuf-required-field',
          title: `Missing protobuf field: ${field.name}`,
          message: `The proto2 field "${field.name}" is required by ${messageType.name}.`,
          expected: field.name,
          actual: 'Missing field',
          schemaRange: findProtobufFieldRange(request.schemaText, field.name),
          messageRange: payload.document.rootRange,
        }),
      );
    }
  }

  const knownFields = new Set(Object.keys(messageType.fields));
  for (const key of Object.keys(data)) {
    if (!knownFields.has(key)) {
      issues.push(
        makeIssue({
          code: 'protobuf-unknown-field',
          title: `Unknown protobuf field: ${key}`,
          message: `The JSON payload contains "${key}", but ${messageType.name} does not define that field.`,
          expected: [...knownFields].join(', '),
          actual: key,
          schemaRange: findTextRange(request.schemaText, `message ${messageType.name}`),
          messageRange: payload.document.rangeForPath([key]) ?? payload.document.rootRange,
          hint: 'Remove the highlighted field or add it to the .proto message.',
        }),
      );
    }
  }

  const verifyError = messageType.verify(data);
  if (verifyError) {
    const fieldName = verifyError.split(/[.: ]/).find((part) => knownFields.has(part));
    issues.push(
      makeIssue({
        code: 'protobuf-type-error',
        title: 'Protobuf field has the wrong value',
        message: verifyError,
        schemaRange: fieldName
          ? findProtobufFieldRange(request.schemaText, fieldName)
          : findTextRange(request.schemaText, `message ${messageType.name}`),
        messageRange: fieldName ? payload.document.rangeForPath([fieldName]) : payload.document.rootRange,
      }),
    );
  }

  return resultFromIssues('Protocol Buffers JSON', 'protobuf', start, issues);
};

const validateAvroRecord = (request: ValidationRequest): ValidationResult => {
  const start = performance.now();
  const schema = parseSchemaDocument(request.schemaText);
  if (!schema.ok) {
    return resultFromIssues('Avro Record', 'avro', start, schema.issues.map(moveIssueToSchema));
  }

  const payload = parseJsonDocument(request.messageText);
  if (!payload.ok) {
    return resultFromIssues('Avro Record', 'avro', start, payload.issues);
  }

  const schemaProblem = validateAvroSchemaShape(schema.document.data);
  if (schemaProblem) {
    return resultFromIssues('Avro Record', 'avro', start, [
      makeIssue({
        code: 'avro-schema-error',
        title: 'Avro schema cannot compile',
        message: schemaProblem,
        schemaRange: schema.document.rootRange,
      }),
    ]);
  }

  const issues = validateAvroValue(schema.document.data, payload.document.data, [], schema.document, payload.document);

  return resultFromIssues('Avro Record', 'avro', start, issues);
};

const validateAvroSchemaShape = (schema: unknown): string | undefined => {
  if (typeof schema === 'string' || Array.isArray(schema)) {
    return undefined;
  }

  if (!isRecord(schema)) {
    return 'Avro schemas must be a primitive type name, a union array, or an object schema.';
  }

  if (schema.type === 'record' && !Array.isArray(schema.fields)) {
    return 'Record schemas must include a fields array.';
  }

  return undefined;
};

const validateAvroValue = (
  schema: unknown,
  value: unknown,
  path: string[],
  schemaDocument: SourceDocument,
  payloadDocument: SourceDocument,
): ValidationIssue[] => {
  if (Array.isArray(schema)) {
    const branchResults = schema.map((branch) =>
      validateAvroValue(branch, value, path, schemaDocument, payloadDocument),
    );
    if (branchResults.some((result) => result.length === 0)) {
      return [];
    }

    return [
      avroIssue(
        schema,
        value,
        path,
        schemaDocument,
        payloadDocument,
        'avro-union-error',
        'Avro union does not accept this value',
      ),
    ];
  }

  if (typeof schema === 'string') {
    return avroPrimitiveMatches(schema, value)
      ? []
      : [
          avroIssue(
            schema,
            value,
            path,
            schemaDocument,
            payloadDocument,
            'avro-type-error',
            'Avro primitive type mismatch',
          ),
        ];
  }

  if (!isRecord(schema)) {
    return [
      avroIssue(
        schema,
        value,
        path,
        schemaDocument,
        payloadDocument,
        'avro-schema-error',
        'Avro schema shape is unsupported',
      ),
    ];
  }

  if (Array.isArray(schema.type) || typeof schema.type === 'object') {
    return validateAvroValue(schema.type, value, path, schemaDocument, payloadDocument);
  }

  if (typeof schema.type !== 'string') {
    return [
      avroIssue(
        schema,
        value,
        path,
        schemaDocument,
        payloadDocument,
        'avro-schema-error',
        'Avro schema type is missing',
      ),
    ];
  }

  if (schema.type === 'record') {
    if (!isRecord(value)) {
      return [
        avroIssue(
          schema,
          value,
          path,
          schemaDocument,
          payloadDocument,
          'avro-record-type',
          'Avro record expects an object',
        ),
      ];
    }

    const issues: ValidationIssue[] = [];
    const fields = Array.isArray(schema.fields) ? schema.fields.filter(isRecord) : [];
    const knownFields = new Set(fields.map((field) => String(field.name)));

    fields.forEach((field) => {
      const fieldName = String(field.name ?? '');
      const fieldSchema = field.type;
      const nextPath = [...path, fieldName];

      if (!(fieldName in value)) {
        if (!('default' in field) && !avroAllowsNull(fieldSchema)) {
          issues.push(
            makeIssue({
              code: 'avro-missing-field',
              title: `Missing Avro field: ${fieldName}`,
              message: `The record is missing required Avro field "${fieldName}".`,
              expected: avroExpected(fieldSchema),
              actual: 'Missing field',
              schemaRange: schemaDocument.rangeForKey(fieldName) ?? schemaDocument.rootRange,
              messageRange: payloadDocument.rangeForPath(path) ?? payloadDocument.rootRange,
              messagePointer: segmentsToPointer(nextPath),
            }),
          );
        }
        return;
      }

      issues.push(...validateAvroValue(fieldSchema, value[fieldName], nextPath, schemaDocument, payloadDocument));
    });

    Object.keys(value).forEach((key) => {
      if (!knownFields.has(key)) {
        issues.push(
          makeIssue({
            code: 'avro-extra-field',
            title: `Unexpected Avro field: ${key}`,
            message: `The record includes "${key}", but the Avro schema does not declare that field.`,
            expected: [...knownFields].join(', '),
            actual: key,
            schemaRange: schemaDocument.rootRange,
            messageRange: payloadDocument.rangeForPath([...path, key]) ?? payloadDocument.rootRange,
          }),
        );
      }
    });

    return issues;
  }

  if (schema.type === 'enum') {
    const symbols = Array.isArray(schema.symbols) ? schema.symbols.map(String) : [];
    return symbols.includes(String(value))
      ? []
      : [
          avroIssue(
            schema,
            value,
            path,
            schemaDocument,
            payloadDocument,
            'avro-enum-error',
            'Avro enum symbol is not allowed',
          ),
        ];
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      return [
        avroIssue(
          schema,
          value,
          path,
          schemaDocument,
          payloadDocument,
          'avro-array-type',
          'Avro array expects a JSON array',
        ),
      ];
    }
    return value.flatMap((item, index) =>
      validateAvroValue(schema.items, item, [...path, String(index)], schemaDocument, payloadDocument),
    );
  }

  if (schema.type === 'map') {
    if (!isRecord(value)) {
      return [
        avroIssue(
          schema,
          value,
          path,
          schemaDocument,
          payloadDocument,
          'avro-map-type',
          'Avro map expects a JSON object',
        ),
      ];
    }
    return Object.entries(value).flatMap(([key, item]) =>
      validateAvroValue(schema.values, item, [...path, key], schemaDocument, payloadDocument),
    );
  }

  return avroPrimitiveMatches(schema.type, value)
    ? []
    : [avroIssue(schema, value, path, schemaDocument, payloadDocument, 'avro-type-error', 'Avro type mismatch')];
};

const avroIssue = (
  schema: unknown,
  value: unknown,
  path: string[],
  schemaDocument: SourceDocument,
  payloadDocument: SourceDocument,
  code: string,
  title: string,
) =>
  makeIssue({
    code,
    title,
    message: `Expected ${avroExpected(schema)}, but the message has ${describeActual(value)} at ${segmentsToPointer(path)}.`,
    expected: avroExpected(schema),
    actual: JSON.stringify(value),
    schemaRange: schemaDocument.rangeForKey(path.at(-1) ?? '') ?? schemaDocument.rootRange,
    messageRange: payloadDocument.rangeForPath(path) ?? payloadDocument.rootRange,
    messagePointer: segmentsToPointer(path),
  });

const avroPrimitiveMatches = (type: string, value: unknown) => {
  if (type === 'null') {
    return value === null;
  }
  if (type === 'boolean') {
    return typeof value === 'boolean';
  }
  if (['int', 'long'].includes(type)) {
    return Number.isInteger(value);
  }
  if (['float', 'double'].includes(type)) {
    return typeof value === 'number' && Number.isFinite(value);
  }
  if (['string', 'bytes'].includes(type)) {
    return typeof value === 'string';
  }

  return true;
};

const avroAllowsNull = (schema: unknown): boolean => {
  if (schema === 'null') {
    return true;
  }
  if (Array.isArray(schema)) {
    return schema.some(avroAllowsNull);
  }
  if (isRecord(schema)) {
    return avroAllowsNull(schema.type);
  }
  return false;
};

const avroExpected = (schema: unknown): string => {
  if (typeof schema === 'string') {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map(avroExpected).join(' | ');
  }
  if (isRecord(schema)) {
    if (schema.type === 'record' && typeof schema.name === 'string') {
      return `record ${schema.name}`;
    }
    if (schema.type === 'enum' && Array.isArray(schema.symbols)) {
      return `one of ${schema.symbols.map(String).join(', ')}`;
    }
    return avroExpected(schema.type);
  }
  return 'valid Avro value';
};

const validateCsvTableSchema = (request: ValidationRequest): ValidationResult => {
  const start = performance.now();
  const schema = parseSchemaDocument(request.schemaText);
  if (!schema.ok) {
    return resultFromIssues('CSV Table Schema', 'csv-table-schema', start, schema.issues.map(moveIssueToSchema));
  }

  const fields = getTableFields(schema.document.data);
  if (fields.length === 0) {
    return resultFromIssues('CSV Table Schema', 'csv-table-schema', start, [
      makeIssue({
        code: 'csv-schema-empty',
        title: 'No table schema fields',
        message: 'The table schema must define a fields array with column names and optional type rules.',
        schemaRange: schema.document.rootRange,
      }),
    ]);
  }

  const parsed = Papa.parse<Record<string, string>>(request.messageText, { header: true, skipEmptyLines: 'greedy' });
  const issues: ValidationIssue[] = [];

  parsed.errors.forEach((error) => {
    issues.push(
      makeIssue({
        code: 'csv-parse-error',
        title: 'CSV cannot parse cleanly',
        message: error.message,
        messageRange: rangeFromLineColumn(request.messageText, (error.row ?? 0) + 2, 1),
      }),
    );
  });

  const headers = parsed.meta.fields ?? [];
  for (const field of fields) {
    if (!headers.includes(field.name)) {
      issues.push(
        makeIssue({
          code: 'csv-missing-column',
          title: `Missing CSV column: ${field.name}`,
          message: `The schema requires a "${field.name}" column, but the CSV header does not include it.`,
          expected: field.name,
          actual: headers.join(', '),
          schemaRange: schema.document.rangeForKey(field.name) ?? findTextRange(request.schemaText, `"${field.name}"`),
          messageRange: firstLineRange(request.messageText),
        }),
      );
    }
  }

  parsed.data.forEach((row, rowIndex) => {
    fields.forEach((field) => {
      const value = row[field.name];
      const cellRange = csvCellRange(request.messageText, rowIndex + 1, headers.indexOf(field.name));

      if (field.required && (value === undefined || value.trim() === '')) {
        issues.push(
          makeIssue({
            code: 'csv-empty-required-cell',
            title: `Required CSV cell is empty: ${field.name}`,
            message: `Row ${rowIndex + 2} has an empty "${field.name}" value, but the schema marks it required.`,
            expected: 'Non-empty value',
            actual: 'Empty cell',
            schemaRange: schema.document.rangeForKey(field.name) ?? schema.document.rootRange,
            messageRange: cellRange,
          }),
        );
      } else if (value !== undefined && value.trim() !== '' && !tableValueMatches(value, field.type)) {
        issues.push(
          makeIssue({
            code: 'csv-cell-type',
            title: `CSV cell has wrong type: ${field.name}`,
            message: `Row ${rowIndex + 2}, column "${field.name}" must be ${field.type}, but the value is "${value}".`,
            expected: field.type,
            actual: value,
            schemaRange: schema.document.rangeForKey(field.name) ?? schema.document.rootRange,
            messageRange: cellRange,
          }),
        );
      }
    });
  });

  return resultFromIssues('CSV Table Schema', 'csv-table-schema', start, issues);
};

const validateKeyValueRules = (request: ValidationRequest): ValidationResult => {
  const start = performance.now();
  const schema = parseSchemaDocument(request.schemaText);
  if (!schema.ok) {
    return resultFromIssues('INI / ENV Rules', 'key-value-rules', start, schema.issues.map(moveIssueToSchema));
  }

  const rules = getKeyValueRules(schema.document.data);
  const parsed = parseKeyValueMessage(request.messageText);
  const issues: ValidationIssue[] = [];

  parsed.duplicates.forEach((duplicate) => {
    issues.push(
      makeIssue({
        code: 'duplicate-key',
        title: `Duplicate key: ${duplicate.key}`,
        message: `"${duplicate.key}" is defined more than once; the later value can hide the earlier one.`,
        messageRange: duplicate.range,
        schemaRange: schema.document.rangeForKey(duplicate.key),
        severity: 'warning',
      }),
    );
  });

  for (const key of rules.required) {
    if (!parsed.values.has(key)) {
      issues.push(
        makeIssue({
          code: 'missing-key',
          title: `Missing required key: ${key}`,
          message: `The rules require "${key}", but the key-value file does not define it.`,
          expected: key,
          actual: 'Missing key',
          schemaRange: schema.document.rangeForKey(key) ?? findTextRange(request.schemaText, `"${key}"`),
          messageRange: wholeDocumentRange(request.messageText),
        }),
      );
    }
  }

  for (const [key, rule] of Object.entries(rules.properties)) {
    const entry = parsed.values.get(key);
    if (!entry) {
      continue;
    }

    if (rule.required && entry.value.trim() === '') {
      issues.push(
        makeIssue({
          code: 'empty-key-value',
          title: `Empty value: ${key}`,
          message: `"${key}" is present, but the rule requires a non-empty value.`,
          expected: 'Non-empty value',
          actual: 'Empty value',
          schemaRange: schema.document.rangeForKey(key) ?? schema.document.rootRange,
          messageRange: entry.range,
        }),
      );
    }

    if (entry.value.trim() !== '' && rule.type && !tableValueMatches(entry.value, rule.type)) {
      issues.push(
        makeIssue({
          code: 'key-value-type',
          title: `Wrong value type: ${key}`,
          message: `"${key}" must be ${rule.type}, but the value is "${entry.value}".`,
          expected: rule.type,
          actual: entry.value,
          schemaRange: schema.document.rangeForKey(key) ?? schema.document.rootRange,
          messageRange: entry.range,
        }),
      );
    }

    if (rule.enum && !rule.enum.map(String).includes(entry.value)) {
      issues.push(
        makeIssue({
          code: 'key-value-enum',
          title: `Value not allowed: ${key}`,
          message: `"${key}" must be one of ${rule.enum.join(', ')}.`,
          expected: rule.enum.join(', '),
          actual: entry.value,
          schemaRange: schema.document.rangeForKey(key) ?? schema.document.rootRange,
          messageRange: entry.range,
        }),
      );
    }

    if (rule.pattern && !new RegExp(rule.pattern).test(entry.value)) {
      issues.push(
        makeIssue({
          code: 'key-value-pattern',
          title: `Pattern mismatch: ${key}`,
          message: `"${key}" must match /${rule.pattern}/.`,
          expected: `/${rule.pattern}/`,
          actual: entry.value,
          schemaRange: schema.document.rangeForKey(key) ?? schema.document.rootRange,
          messageRange: entry.range,
        }),
      );
    }
  }

  return resultFromIssues('INI / ENV Rules', 'key-value-rules', start, issues);
};

interface OpenApiSchemaCandidate {
  schema: unknown;
  path: string[];
}

const findOpenApiSchema = (root: unknown): OpenApiSchemaCandidate | undefined => {
  const queue: OpenApiSchemaCandidate[] = [{ schema: root, path: [] }];
  let fallback: OpenApiSchemaCandidate | undefined;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || !isRecord(current.schema)) {
      continue;
    }

    if (current.path.at(-1) === 'schema' && looksLikeJsonSchema(current.schema)) {
      return current;
    }

    if (!fallback && current.path.includes('schemas') && looksLikeJsonSchema(current.schema)) {
      fallback = current;
    }

    for (const [key, value] of Object.entries(current.schema)) {
      if (isRecord(value) || Array.isArray(value)) {
        queue.push({ schema: value, path: [...current.path, key] });
      }
    }
  }

  return fallback;
};

const resolveLocalRef = (schema: unknown, root: unknown, path: string[]): OpenApiSchemaCandidate => {
  if (isRecord(schema) && typeof schema.$ref === 'string' && schema.$ref.startsWith('#')) {
    const refPath = pointerToSegments(schema.$ref);
    const resolved = getValueAtPath(root, refPath);
    if (resolved !== undefined) {
      return { schema: resolved, path: refPath };
    }
  }

  return { schema, path };
};

const looksLikeJsonSchema = (value: Record<string, unknown>) =>
  typeof value.type === 'string' ||
  'properties' in value ||
  'items' in value ||
  'required' in value ||
  '$ref' in value ||
  'oneOf' in value ||
  'anyOf' in value;

const normalizeOpenApiSchema = (schema: unknown): unknown => {
  if (Array.isArray(schema)) {
    return schema.map(normalizeOpenApiSchema);
  }

  if (!isRecord(schema)) {
    return schema;
  }

  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'nullable') {
      continue;
    }
    copy[key] = normalizeOpenApiSchema(value);
  }

  if (schema.nullable === true && typeof copy.type === 'string') {
    copy.type = [copy.type, 'null'];
  }

  return copy;
};

const graphqlRange = (text: string, error: GraphQLError): TextRange | undefined => {
  const location = error.locations?.[0];
  return location ? rangeFromLineColumn(text, location.line, location.column) : undefined;
};

const findGraphqlSchemaRange = (schemaText: string, message: string) => {
  const quoted = /"([A-Za-z_][A-Za-z0-9_]*)"/.exec(message)?.[1];
  return quoted ? findTextRange(schemaText, quoted) : wholeDocumentRange(schemaText);
};

const firstProtobufType = (root: protobuf.NamespaceBase): protobuf.Type | undefined => {
  for (const nested of Object.values(root.nested ?? {})) {
    if (nested instanceof protobuf.Type) {
      return nested;
    }
    if (nested instanceof protobuf.Namespace) {
      const found = firstProtobufType(nested);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
};

const findProtobufFieldRange = (schemaText: string, fieldName: string) =>
  findRegexRange(schemaText, new RegExp(`\\b${escapeRegExp(fieldName)}\\b\\s*=`, 'i'), 0) ??
  findTextRange(schemaText, fieldName);

interface TableFieldRule {
  name: string;
  type: string;
  required: boolean;
}

const getTableFields = (data: unknown): TableFieldRule[] => {
  if (!isRecord(data) || !Array.isArray(data.fields)) {
    return [];
  }

  return data.fields
    .filter(isRecord)
    .map((field) => ({
      name: String(field.name ?? ''),
      type: String(field.type ?? 'string'),
      required: Boolean(field.required),
    }))
    .filter((field) => field.name.length > 0);
};

const tableValueMatches = (value: string, type = 'string') => {
  const trimmed = value.trim();
  if (type === 'string') {
    return true;
  }
  if (['integer', 'int'].includes(type)) {
    return /^[-+]?\d+$/.test(trimmed);
  }
  if (['number', 'decimal', 'float'].includes(type)) {
    return /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed);
  }
  if (type === 'boolean') {
    return /^(true|false|0|1|yes|no)$/i.test(trimmed);
  }
  if (type === 'date') {
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  }
  return true;
};

const firstLineRange = (text: string): TextRange => {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  return { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: Math.max(firstLine.length + 1, 2) };
};

const csvCellRange = (text: string, lineIndex: number, columnIndex: number): TextRange => {
  const lines = text.split(/\r?\n/);
  const line = lines[lineIndex] ?? '';
  if (columnIndex < 0) {
    return {
      startLineNumber: lineIndex + 1,
      startColumn: 1,
      endLineNumber: lineIndex + 1,
      endColumn: Math.max(line.length + 1, 2),
    };
  }

  const cells = line.split(',');
  const startColumn = cells.slice(0, columnIndex).join(',').length + (columnIndex > 0 ? 2 : 1);
  const cell = cells[columnIndex] ?? '';

  return {
    startLineNumber: lineIndex + 1,
    startColumn,
    endLineNumber: lineIndex + 1,
    endColumn: Math.max(startColumn + cell.length, startColumn + 1),
  };
};

interface KeyValueRule {
  type?: string;
  required?: boolean;
  enum?: string[];
  pattern?: string;
}

const getKeyValueRules = (data: unknown): { required: string[]; properties: Record<string, KeyValueRule> } => {
  const required = isRecord(data) && Array.isArray(data.required) ? data.required.map(String) : [];
  const rawProperties = isRecord(data) && isRecord(data.properties) ? data.properties : {};
  const properties: Record<string, KeyValueRule> = {};

  for (const [key, value] of Object.entries(rawProperties)) {
    if (isRecord(value)) {
      properties[key] = {
        type: typeof value.type === 'string' ? value.type : undefined,
        required: Boolean(value.required) || required.includes(key),
        enum: Array.isArray(value.enum) ? value.enum.map(String) : undefined,
        pattern: typeof value.pattern === 'string' ? value.pattern : undefined,
      };
    }
  }

  required.forEach((key) => {
    properties[key] = properties[key] ?? { required: true };
  });

  return { required, properties };
};

const parseKeyValueMessage = (text: string) => {
  const values = new Map<string, { value: string; range: TextRange }>();
  const duplicates: Array<{ key: string; range: TextRange }> = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';') || trimmed.startsWith('[')) {
      return;
    }

    const separator = line.indexOf('=') >= 0 ? line.indexOf('=') : line.indexOf(':');
    if (separator < 0) {
      return;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    const keyStart = line.indexOf(key) + 1;
    const range = {
      startLineNumber: index + 1,
      startColumn: keyStart,
      endLineNumber: index + 1,
      endColumn: Math.max(line.length + 1, keyStart + 1),
    };

    if (values.has(key)) {
      duplicates.push({ key, range });
    }
    values.set(key, { value, range });
  });

  return { values, duplicates };
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
});

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
