import type { TextRange, ValidationIssue } from './types';

export const wholeDocumentRange = (text: string): TextRange => {
  const lines = text.length === 0 ? [''] : text.split(/\r?\n/);
  const lastLine = lines.at(-1) ?? '';

  return {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: Math.max(lines.length, 1),
    endColumn: Math.max(lastLine.length + 1, 2),
  };
};

export const rangeFromOffset = (text: string, offset: number, length = 1): TextRange => {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const endOffset = Math.max(safeOffset + 1, Math.min(safeOffset + Math.max(length, 1), text.length));
  const start = lineColumnFromOffset(text, safeOffset);
  const end = lineColumnFromOffset(text, endOffset);

  return {
    startLineNumber: start.line,
    startColumn: start.column,
    endLineNumber: end.line,
    endColumn: Math.max(end.column, start.column + 1),
  };
};

export const lineColumnFromOffset = (text: string, offset: number) => {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let column = 1;

  for (let index = 0; index < safeOffset; index += 1) {
    if (text[index] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
};

export const rangeFromLineColumn = (text: string, line: number, column: number, length = 1): TextRange => {
  const lines = text.split(/\r?\n/);
  const safeLine = Math.max(1, Math.min(line, Math.max(lines.length, 1)));
  const safeColumn = Math.max(1, Math.min(column, (lines[safeLine - 1] ?? '').length + 1));

  return {
    startLineNumber: safeLine,
    startColumn: safeColumn,
    endLineNumber: safeLine,
    endColumn: safeColumn + Math.max(length, 1),
  };
};

export const findTextRange = (text: string, needle: string): TextRange | undefined => {
  if (!needle) {
    return undefined;
  }

  const offset = text.indexOf(needle);
  return offset >= 0 ? rangeFromOffset(text, offset, needle.length) : undefined;
};

export const findRegexRange = (text: string, pattern: RegExp, groupIndex = 0): TextRange | undefined => {
  const match = pattern.exec(text);
  if (!match?.[groupIndex]) {
    return undefined;
  }

  const matchOffset = match.index + match[0].indexOf(match[groupIndex]);
  return rangeFromOffset(text, matchOffset, match[groupIndex].length);
};

export const pointerToSegments = (pointer: string | undefined): string[] => {
  if (!pointer || pointer === '#') {
    return [];
  }

  const normalized = pointer.startsWith('#') ? pointer.slice(1) : pointer;
  if (!normalized) {
    return [];
  }

  return normalized
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment).replace(/~1/g, '/').replace(/~0/g, '~'));
};

export const segmentsToPointer = (segments: Array<string | number>) =>
  `#/${segments.map((segment) => String(segment).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;

export const getValueAtPath = (value: unknown, segments: string[]): unknown => {
  let current = value;

  for (const segment of segments) {
    if (Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }

  return current;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const describeActual = (value: unknown) => {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
};

export const makeIssue = (
  issue: Omit<ValidationIssue, 'id' | 'severity'> & { severity?: ValidationIssue['severity'] },
): ValidationIssue => {
  const severity = issue.severity ?? 'error';
  const stablePayload = JSON.stringify({
    severity,
    code: issue.code,
    title: issue.title,
    message: issue.message,
    path: issue.path,
    expected: issue.expected,
    actual: issue.actual,
    schemaPointer: issue.schemaPointer,
    messagePointer: issue.messagePointer,
    schemaRange: issue.schemaRange,
    messageRange: issue.messageRange,
    schemaSourceId: issue.schemaSourceId,
    schemaSourceLabel: issue.schemaSourceLabel,
  });

  return {
    id: `${issue.code}-${hashString(stablePayload)}`,
    severity,
    ...issue,
  };
};

const hashString = (value: string) => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
};

export const summarizeIssues = (issues: ValidationIssue[], adapterLabel: string) => {
  if (issues.length === 0) {
    return `${adapterLabel} validation passed. The message matches the schema.`;
  }

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const parts = [
    errors && `${errors} error${errors === 1 ? '' : 's'}`,
    warnings && `${warnings} warning${warnings === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return `${adapterLabel} validation found ${parts.join(' and ')}.`;
};
