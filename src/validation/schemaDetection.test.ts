import { describe, expect, it } from 'vitest';
import { detectSchemaFormat } from './schemaDetection';

describe('detectSchemaFormat', () => {
  it('detects XSD by XML Schema root', () => {
    const result = detectSchemaFormat('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" />');

    expect(result.format).toBe('xsd');
    expect(result.confidence).toBe('high');
  });

  it('detects GraphQL SDL by type definitions', () => {
    const result = detectSchemaFormat('type Query { order(id: ID!): Order } type Order { id: ID! }');

    expect(result.format).toBe('graphql');
    expect(result.confidence).toBe('high');
  });

  it('detects OpenAPI documents before JSON Schema fallback', () => {
    const result = detectSchemaFormat(`{
      "openapi": "3.1.0",
      "paths": {},
      "components": { "schemas": { "Order": { "type": "object" } } }
    }`);

    expect(result.format).toBe('openapi');
    expect(result.confidence).toBe('high');
  });

  it('separates table schemas, Avro records, and key-value rules', () => {
    expect(detectSchemaFormat('{"fields":[{"name":"id","type":"string"}]}').format).toBe('table-schema');
    expect(detectSchemaFormat('{"type":"record","name":"Order","fields":[{"name":"id","type":"string"}]}').format).toBe(
      'avro',
    );
    expect(detectSchemaFormat('{"properties":{"PORT":{"type":"integer","required":true}}}').format).toBe(
      'key-value-rules',
    );
  });

  it('does not accept malformed JSON as structured schema', () => {
    const result = detectSchemaFormat('{"type":"object",');

    expect(result.format).toBe('json-schema');
    expect(result.confidence).toBe('medium');
  });
});
