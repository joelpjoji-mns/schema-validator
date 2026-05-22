export type SchemaFormat =
  | 'json-schema'
  | 'xsd'
  | 'openapi'
  | 'graphql'
  | 'protobuf'
  | 'avro'
  | 'table-schema'
  | 'toml-schema'
  | 'key-value-rules';

export type MessageFormat = 'json' | 'yaml' | 'xml' | 'graphql' | 'csv' | 'toml' | 'properties';

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface TextRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  code: string;
  title: string;
  message: string;
  hint?: string;
  path?: string;
  expected?: string;
  actual?: string;
  schemaRange?: TextRange;
  messageRange?: TextRange;
  schemaPointer?: string;
  messagePointer?: string;
  schemaSourceId?: string;
  schemaSourceLabel?: string;
}

export interface RelatedSchemaDocument {
  id: string;
  label: string;
  schemaLocation?: string;
  namespace?: string;
  text: string;
}

export interface ValidationRequest {
  schemaText: string;
  messageText: string;
  schemaFormat: SchemaFormat;
  messageFormat: MessageFormat;
  relatedSchemas?: RelatedSchemaDocument[];
}

export interface ValidationResult {
  ok: boolean;
  adapterId: string;
  summary: string;
  durationMs: number;
  issues: ValidationIssue[];
}

export interface ValidatorAdapter {
  id: string;
  label: string;
  schemaFormats: SchemaFormat[];
  messageFormats: MessageFormat[];
  validate: (request: ValidationRequest) => Promise<ValidationResult> | ValidationResult;
}

export interface FormatOption<TValue extends string> {
  value: TValue;
  label: string;
  description: string;
  language: string;
}

export const schemaFormatOptions: FormatOption<SchemaFormat>[] = [
  {
    value: 'json-schema',
    label: 'JSON Schema',
    description: 'Draft-style JSON Schema rules for JSON, YAML, and TOML payloads.',
    language: 'json',
  },
  {
    value: 'xsd',
    label: 'XSD',
    description: 'XML Schema definitions with precise XML diagnostics and XSD-lite rule mapping.',
    language: 'xml',
  },
  {
    value: 'openapi',
    label: 'OpenAPI 3.x',
    description: 'Extracts request/response schemas and validates JSON or YAML examples.',
    language: 'yaml',
  },
  {
    value: 'graphql',
    label: 'GraphQL SDL',
    description: 'Validates GraphQL operations against a schema definition.',
    language: 'graphql',
  },
  {
    value: 'protobuf',
    label: 'Protocol Buffers',
    description: 'Validates JSON message objects against .proto message definitions.',
    language: 'proto',
  },
  {
    value: 'avro',
    label: 'Avro',
    description: 'Validates JSON records against Avro schemas.',
    language: 'json',
  },
  {
    value: 'table-schema',
    label: 'CSV Table Schema',
    description: 'Validates CSV rows against typed column rules.',
    language: 'json',
  },
  {
    value: 'toml-schema',
    label: 'TOML Schema',
    description: 'Uses JSON Schema rules against TOML payloads.',
    language: 'json',
  },
  {
    value: 'key-value-rules',
    label: 'INI / ENV Rules',
    description: 'Validates key-value files for required keys, empties, types, enums, and duplicates.',
    language: 'json',
  },
];

export const messageFormatOptions: FormatOption<MessageFormat>[] = [
  { value: 'json', label: 'JSON', description: 'JSON object, array, or scalar payload.', language: 'json' },
  { value: 'yaml', label: 'YAML', description: 'YAML payload or OpenAPI document.', language: 'yaml' },
  { value: 'xml', label: 'XML', description: 'XML message instance.', language: 'xml' },
  {
    value: 'graphql',
    label: 'GraphQL Operation',
    description: 'GraphQL query, mutation, or subscription.',
    language: 'graphql',
  },
  { value: 'csv', label: 'CSV', description: 'Comma-separated tabular data.', language: 'csv' },
  { value: 'toml', label: 'TOML', description: 'TOML configuration payload.', language: 'toml' },
  { value: 'properties', label: 'INI / ENV', description: 'Key-value configuration text.', language: 'ini' },
];

export const formatLabel = (value: SchemaFormat | MessageFormat) =>
  [...schemaFormatOptions, ...messageFormatOptions].find((option) => option.value === value)?.label ?? value;
