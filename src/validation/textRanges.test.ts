import { describe, expect, it } from 'vitest';
import { makeIssue } from './textRanges';

describe('makeIssue', () => {
  it('creates deterministic IDs for the same diagnostic payload', () => {
    const first = makeIssue({
      code: 'wrong-type',
      title: 'Wrong type',
      message: 'Expected string.',
      messageRange: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 9 },
    });
    const second = makeIssue({
      code: 'wrong-type',
      title: 'Wrong type',
      message: 'Expected string.',
      messageRange: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 9 },
    });

    expect(second.id).toBe(first.id);
  });

  it('changes IDs when the diagnostic location changes', () => {
    const first = makeIssue({
      code: 'wrong-type',
      title: 'Wrong type',
      message: 'Expected string.',
      messageRange: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 9 },
    });
    const second = makeIssue({
      code: 'wrong-type',
      title: 'Wrong type',
      message: 'Expected string.',
      messageRange: { startLineNumber: 3, startColumn: 3, endLineNumber: 3, endColumn: 9 },
    });

    expect(second.id).not.toBe(first.id);
  });
});
