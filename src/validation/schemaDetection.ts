import { parse as parseJson, type ParseError } from 'jsonc-parser';
import { parseDocument } from 'yaml';
import { isRecord } from './textRanges';
import type { SchemaFormat } from './types';

export type SchemaDetectionConfidence = 'none' | 'low' | 'medium' | 'high';

export interface SchemaDetectionResult {
  format?: SchemaFormat;
  confidence: SchemaDetectionConfidence;
  reason: string;
  warnings?: string[];
}

const high = (format: SchemaFormat, reason: string): SchemaDetectionResult => ({ format, confidence: 'high', reason });
const medium = (format: SchemaFormat, reason: string): SchemaDetectionResult => ({
  format,
  confidence: 'medium',
  reason,
});

export const detectSchemaFormat = (schemaText: string): SchemaDetectionResult => {
  const text = schemaText.trim();
  if (!text) {
    return { confidence: 'none', reason: 'Paste or upload a schema to detect its format.' };
  }

  if (/<(?:xs|xsd):schema\b/i.test(text) || /http:\/\/www\.w3\.org\/2001\/XMLSchema/i.test(text)) {
    return high('xsd', 'Found an XML Schema root or namespace.');
  }

  if (/\bsyntax\s*=\s*["']proto[23]["']\s*;/i.test(text) || /\bmessage\s+[A-Za-z_]\w*\s*\{/i.test(text)) {
    return high('protobuf', 'Found Protocol Buffers syntax or message definitions.');
  }

  if (!looksLikeJsonOrYaml(text) && looksLikeGraphqlSchema(text)) {
    return high('graphql', 'Found GraphQL SDL type definitions.');
  }

  const structured = parseStructured(text);
  if (structured !== undefined) {
    const structuredDetection = detectStructuredSchema(structured);
    if (structuredDetection) {
      return structuredDetection;
    }
  }

  if (/\b(type|interface|input|enum|schema|directive)\s+[A-Za-z_]\w*/.test(text)) {
    return medium('graphql', 'Text resembles GraphQL SDL definitions.');
  }

  return medium('json-schema', 'No specialized schema signature was found; JSON Schema is the safest default.');
};

const detectStructuredSchema = (data: unknown): SchemaDetectionResult | undefined => {
  if (!isRecord(data)) {
    return undefined;
  }

  if (
    typeof data.openapi === 'string' ||
    typeof data.swagger === 'string' ||
    ('paths' in data && 'components' in data)
  ) {
    return high('openapi', 'Found OpenAPI version, paths, or components.');
  }

  if (
    Array.isArray(data.fields) &&
    data.fields.some((field) => isRecord(field) && 'name' in field && 'type' in field)
  ) {
    if (data.type === 'record' || typeof data.namespace === 'string') {
      return high('avro', 'Found Avro record fields and schema metadata.');
    }
    return high('table-schema', 'Found table schema fields with names and types.');
  }

  if (data.type === 'record' || data.type === 'enum' || data.type === 'array' || Array.isArray(data.symbols)) {
    return high('avro', 'Found Avro schema type markers.');
  }

  if (looksLikeKeyValueRules(data)) {
    return high('key-value-rules', 'Found INI/ENV key-value rule properties.');
  }

  if (looksLikeJsonSchema(data)) {
    return high('json-schema', 'Found JSON Schema keywords.');
  }

  return undefined;
};

const parseStructured = (text: string): unknown => {
  try {
    const errors: ParseError[] = [];
    const data = parseJson(text, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length === 0 && data !== undefined) {
      return data;
    }
  } catch {
    // Fall through to YAML.
  }

  try {
    const yaml = parseDocument(text, { prettyErrors: false, uniqueKeys: false });
    if (yaml.errors.length === 0) {
      return yaml.toJS({ maxAliasCount: 50 });
    }
  } catch {
    // Not structured JSON/YAML.
  }

  return undefined;
};

const looksLikeJsonOrYaml = (text: string) => /^[{[]/.test(text) || /^---/.test(text) || /^\w[\w-]*\s*:/m.test(text);

const looksLikeGraphqlSchema = (text: string) =>
  /\b(type|interface|input|enum|schema|directive|scalar|union)\s+[A-Za-z_]\w*/.test(text) && /[{}]/.test(text);

const looksLikeKeyValueRules = (data: Record<string, unknown>) => {
  if (!isRecord(data.properties)) {
    return false;
  }

  const hasRuleLikeProperty = Object.values(data.properties).some(
    (value) => isRecord(value) && ['type', 'required', 'enum', 'pattern'].some((key) => key in value),
  );

  return hasRuleLikeProperty && !('$schema' in data) && !('additionalProperties' in data) && !('items' in data);
};

const jsonSchemaKeywords = new Set([
  '$schema',
  '$id',
  '$defs',
  'definitions',
  'type',
  'properties',
  'required',
  'items',
  'prefixItems',
  'additionalProperties',
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  'enum',
  'const',
  'format',
  'pattern',
  'minimum',
  'maximum',
]);

const looksLikeJsonSchema = (data: Record<string, unknown>) =>
  Object.keys(data).some((key) => jsonSchemaKeywords.has(key));
