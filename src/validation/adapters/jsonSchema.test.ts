import { describe, expect, it } from 'vitest';
import { validateRequest } from '../registry';

describe('JSON Schema adapter edge cases', () => {
  it('reports composite schema failures clearly', async () => {
    const result = await validateRequest({
      schemaFormat: 'json-schema',
      messageFormat: 'json',
      schemaText: JSON.stringify({ oneOf: [{ type: 'string' }, { type: 'number' }] }),
      messageText: 'true',
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('oneOf-mismatch');
  });

  it('reports duplicate array items', async () => {
    const result = await validateRequest({
      schemaFormat: 'json-schema',
      messageFormat: 'json',
      schemaText: JSON.stringify({ type: 'array', uniqueItems: true }),
      messageText: '[1, 2, 1]',
    });

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe('array-duplicate-items');
  });

  it('enforces modern JSON Schema keywords even without an explicit $schema URI', async () => {
    const result = await validateRequest({
      schemaFormat: 'json-schema',
      messageFormat: 'json',
      schemaText: JSON.stringify({
        type: 'object',
        properties: {
          credit_card: { type: 'number' },
        },
        dependentRequired: {
          credit_card: ['billing_address'],
        },
        unevaluatedProperties: false,
      }),
      messageText: JSON.stringify({ credit_card: 1234, extra: true }),
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['dependent-required-missing', 'schema-unevaluatedProperties']),
    );
  });
});
