import { describe, expect, it } from 'vitest';
import { validateRequest } from '../registry';

describe('top format edge cases', () => {
  it('reports invalid key-value regex patterns without throwing', async () => {
    const result = await validateRequest({
      schemaFormat: 'key-value-rules',
      messageFormat: 'properties',
      schemaText: JSON.stringify({
        properties: {
          CODE: { pattern: '[a-' },
        },
      }),
      messageText: 'CODE=abc',
    });

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe('key-value-pattern-invalid');
    expect(result.issues[0]?.schemaRange).toBeDefined();
    expect(result.issues[0]?.messageRange).toMatchObject({ startLineNumber: 1, startColumn: 1 });
  });

  it('maps CSV errors after quoted commas to the correct cell', async () => {
    const result = await validateRequest({
      schemaFormat: 'table-schema',
      messageFormat: 'csv',
      schemaText: JSON.stringify({
        fields: [
          { name: 'name', type: 'string', required: true },
          { name: 'year', type: 'integer', required: true },
        ],
      }),
      messageText: 'name,year\n"Jane, Inc.",soon',
    });

    const typeIssue = result.issues.find((issue) => issue.code === 'csv-cell-type');

    expect(result.ok).toBe(false);
    expect(typeIssue?.messageRange).toMatchObject({
      startLineNumber: 2,
      startColumn: 14,
      endLineNumber: 2,
      endColumn: 18,
    });
  });

  it('rejects circular OpenAPI refs with a clear diagnostic', async () => {
    const result = await validateRequest({
      schemaFormat: 'openapi',
      messageFormat: 'json',
      schemaText: JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Loop', version: '1.0.0' },
        paths: {
          '/loop': {
            get: {
              responses: {
                '200': {
                  description: 'Loop',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/A' },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            A: { $ref: '#/components/schemas/B' },
            B: { $ref: '#/components/schemas/A' },
          },
        },
      }),
      messageText: '{}',
    });

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe('openapi-schema-resolution');
    expect(result.issues[0]?.message).toContain('Circular OpenAPI $ref');
  });
});
