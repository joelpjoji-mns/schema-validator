import { describe, expect, it } from 'vitest';
import { parseJsonDocument, parseYamlDocument } from './structuredParsers';

describe('source range mapping', () => {
  it('maps JSON pointers to exact JSON source ranges', () => {
    const parsed = parseJsonDocument(`{
  "order": {
    "quantity": "three"
  }
}`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.document.rangeForPointer('#/order/quantity')).toMatchObject({
      startLineNumber: 3,
      startColumn: 17,
    });
  });

  it('maps YAML paths to YAML source ranges', () => {
    const parsed = parseYamlDocument(`order:
  quantity: three
`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.document.rangeForPath(['order', 'quantity'])).toMatchObject({
      startLineNumber: 2,
      startColumn: 13,
    });
  });
});
