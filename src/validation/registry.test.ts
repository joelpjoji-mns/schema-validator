import { describe, expect, it } from 'vitest';
import { samples } from '../fixtures/samples';
import { validateRequest } from './registry';

const sample = (id: string) => {
  const found = samples.find((item) => item.id === id);
  if (!found) {
    throw new Error(`Missing sample ${id}`);
  }
  return found;
};

describe('validateRequest', () => {
  it('passes a valid JSON Schema payload', async () => {
    const fixture = sample('json-schema-valid');
    const result = await validateRequest(fixture);

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('returns specific JSON Schema diagnostics with schema and message ranges', async () => {
    const fixture = sample('json-schema-missing-field');
    const result = await validateRequest(fixture);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['missing-required-field', 'format-mismatch', 'enum-mismatch', 'additional-property']),
    );
    expect(result.issues.some((issue) => issue.schemaRange && issue.messageRange)).toBe(true);
  });

  it('validates YAML payloads through JSON Schema', async () => {
    const fixture = sample('yaml-schema-fail');
    const result = await validateRequest(fixture);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['wrong-type', 'enum-mismatch']));
  });

  it('reports XML/XSD missing elements, attributes, and type errors', async () => {
    const fixture = sample('xml-xsd-fail');
    const result = await validateRequest(fixture);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['missing-xml-attribute', 'xml-element-type', 'unexpected-xml-element']),
    );
  });

  it('validates CSV rows against a table schema', async () => {
    const fixture = sample('csv-fail');
    const result = await validateRequest(fixture);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['csv-cell-type', 'csv-empty-required-cell']),
    );
  });

  it('returns a clear unsupported pair diagnostic', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'json',
      schemaText: '<xs:schema />',
      messageText: '{}',
    });

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe('unsupported-format-pair');
  });
});
