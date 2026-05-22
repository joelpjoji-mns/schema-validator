import {
    findNodeAtLocation,
    parse,
    parseTree,
    printParseErrorCode,
    type Node as JsonNode,
    type ParseError,
} from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { isMap, isSeq, parseDocument, type Document, type Pair, type Node as YamlNode } from 'yaml';
import {
    findRegexRange,
    findTextRange,
    makeIssue,
    pointerToSegments,
    rangeFromOffset,
    wholeDocumentRange,
} from './textRanges';
import type { MessageFormat, TextRange, ValidationIssue } from './types';

export interface SourceDocument {
  data: unknown;
  text: string;
  format: 'json' | 'yaml' | 'toml';
  rootRange: TextRange;
  rangeForPointer: (pointer: string | undefined) => TextRange | undefined;
  rangeForPath: (segments: string[]) => TextRange | undefined;
  rangeForKey: (key: string) => TextRange | undefined;
}

export type ParseOutcome = { ok: true; document: SourceDocument } | { ok: false; issues: ValidationIssue[] };

export const parseSchemaDocument = (text: string): ParseOutcome => {
  const json = parseJsonDocument(text);
  if (json.ok) {
    return json;
  }

  const yaml = parseYamlDocument(text);
  if (yaml.ok) {
    return yaml;
  }

  return { ok: false, issues: [...json.issues, ...yaml.issues] };
};

export const parseMessageDocument = (format: MessageFormat, text: string): ParseOutcome => {
  if (format === 'json') {
    return parseJsonDocument(text);
  }

  if (format === 'yaml') {
    return parseYamlDocument(text);
  }

  if (format === 'toml') {
    return parseTomlDocument(text);
  }

  return {
    ok: false,
    issues: [
      makeIssue({
        code: 'unsupported-structured-format',
        title: 'Unsupported structured format',
        message: `The ${format} payload cannot be parsed as JSON-like data by this adapter.`,
        messageRange: wholeDocumentRange(text),
      }),
    ],
  };
};

export const parseJsonDocument = (text: string): ParseOutcome => {
  if (!text.trim()) {
    return {
      ok: false,
      issues: [
        makeIssue({
          code: 'empty-json',
          title: 'Empty JSON input',
          message: 'Paste or upload JSON before validating.',
          messageRange: wholeDocumentRange(text),
        }),
      ],
    };
  }

  const errors: ParseError[] = [];
  const data = parse(text, errors, { allowTrailingComma: false, disallowComments: true });
  const tree = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true });

  if (errors.length > 0 || !tree) {
    return {
      ok: false,
      issues: errors.map((error) =>
        makeIssue({
          code: 'malformed-json',
          title: 'Malformed JSON',
          message: printParseErrorCode(error.error),
          messageRange: rangeFromOffset(text, error.offset, Math.max(error.length, 1)),
          hint: 'JSON must use quoted property names, valid commas, and valid string escapes.',
        }),
      ),
    };
  }

  const rangeForPath = (segments: string[]) => jsonRangeForPath(text, tree, segments);

  return {
    ok: true,
    document: {
      data,
      text,
      format: 'json',
      rootRange: rangeFromOffset(text, tree.offset, tree.length),
      rangeForPointer: (pointer) => rangeForPath(pointerToSegments(pointer)),
      rangeForPath,
      rangeForKey: (key) => findRegexRange(text, new RegExp(`"${escapeRegExp(key)}"\\s*:`), 0),
    },
  };
};

export const parseYamlDocument = (text: string): ParseOutcome => {
  if (!text.trim()) {
    return {
      ok: false,
      issues: [
        makeIssue({
          code: 'empty-yaml',
          title: 'Empty YAML input',
          message: 'Paste or upload YAML before validating.',
          messageRange: wholeDocumentRange(text),
        }),
      ],
    };
  }

  const document = parseDocument(text, { prettyErrors: false, uniqueKeys: false });
  if (document.errors.length > 0) {
    return {
      ok: false,
      issues: document.errors.map((error) => {
        const start = Array.isArray(error.pos) ? error.pos[0] : 0;
        const end = Array.isArray(error.pos) ? error.pos[1] : start + 1;

        return makeIssue({
          code: 'malformed-yaml',
          title: 'Malformed YAML',
          message: error.message,
          messageRange: rangeFromOffset(text, start, Math.max(end - start, 1)),
          hint: 'YAML indentation, colons, and list markers must line up with the structure.',
        });
      }),
    };
  }

  const data = document.toJS({ maxAliasCount: 50 });
  const rangeForPath = (segments: string[]) => yamlRangeForPath(text, document, segments);

  return {
    ok: true,
    document: {
      data,
      text,
      format: 'yaml',
      rootRange: document.contents?.range
        ? rangeFromOffset(text, document.contents.range[0], document.contents.range[1] - document.contents.range[0])
        : wholeDocumentRange(text),
      rangeForPointer: (pointer) => rangeForPath(pointerToSegments(pointer)),
      rangeForPath,
      rangeForKey: (key) => findRegexRange(text, new RegExp(`(^|\\n)(\\s*)${escapeRegExp(key)}\\s*:`), 0),
    },
  };
};

export const parseTomlDocument = (text: string): ParseOutcome => {
  if (!text.trim()) {
    return {
      ok: false,
      issues: [
        makeIssue({
          code: 'empty-toml',
          title: 'Empty TOML input',
          message: 'Paste or upload TOML before validating.',
          messageRange: wholeDocumentRange(text),
        }),
      ],
    };
  }

  try {
    const data = parseToml(text);

    return {
      ok: true,
      document: {
        data,
        text,
        format: 'toml',
        rootRange: wholeDocumentRange(text),
        rangeForPointer: (pointer) => tomlRangeForPath(text, pointerToSegments(pointer)),
        rangeForPath: (segments) => tomlRangeForPath(text, segments),
        rangeForKey: (key) => findRegexRange(text, new RegExp(`(^|\\n)\\s*${escapeRegExp(key)}\\s*=`), 0),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TOML could not be parsed.';

    return {
      ok: false,
      issues: [
        makeIssue({
          code: 'malformed-toml',
          title: 'Malformed TOML',
          message,
          messageRange: wholeDocumentRange(text),
        }),
      ],
    };
  }
};

const jsonRangeForPath = (text: string, tree: JsonNode, segments: string[]): TextRange | undefined => {
  const node = findNodeAtLocation(tree, segments);
  return node ? rangeFromOffset(text, node.offset, node.length) : undefined;
};

const yamlRangeForPath = (text: string, document: Document.Parsed, segments: string[]): TextRange | undefined => {
  let current: YamlNode | null | undefined = document.contents;

  for (const segment of segments) {
    if (!current) {
      return undefined;
    }

    if (isMap(current)) {
      const pair = current.items.find(
        (item: Pair) => String((item.key as { value?: unknown } | null)?.value) === segment,
      );
      current = pair?.value as YamlNode | null | undefined;
    } else if (isSeq(current)) {
      current = current.items[Number(segment)] as YamlNode | null | undefined;
    } else {
      return undefined;
    }
  }

  const range = current?.range;
  return range ? rangeFromOffset(text, range[0], Math.max(range[1] - range[0], 1)) : undefined;
};

const tomlRangeForPath = (text: string, segments: string[]): TextRange | undefined => {
  const last = segments.at(-1);
  if (!last) {
    return wholeDocumentRange(text);
  }

  return findRegexRange(text, new RegExp(`(^|\\n)\\s*${escapeRegExp(last)}\\s*=`), 0) ?? findTextRange(text, last);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
