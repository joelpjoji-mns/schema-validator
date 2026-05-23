import type { SchemaSummary, SchemaSummaryNode } from '../validation/introspection';
import { parseMessageDocument } from '../validation/structuredParsers';
import type { MessageFormat, RelatedSchemaDocument, SchemaFormat, ValidationIssue, ValidationResult } from '../validation/types';
import { formatLabel, messageFormatOptions, schemaFormatOptions } from '../validation/types';

export const WORKSPACE_STORAGE_KEY = 'schema-validator.workspace.v2';
export const PRESETS_STORAGE_KEY = 'schema-validator.presets.v1';
export const HISTORY_STORAGE_KEY = 'schema-validator.history.v1';
export const MAX_HISTORY_ENTRIES = 12;

export type WorkbenchTheme = 'light' | 'dark';
export type WorkbenchLayoutMode = 'normal' | 'schema-focus' | 'message-focus' | 'no-diagnostics';

export interface WorkbenchSnapshot {
  schemaFormat: SchemaFormat;
  messageFormat: MessageFormat;
  schemaText: string;
  messageText: string;
  autoValidate: boolean;
  schemaTabId: string;
  messageTabId: string;
  selectedXsdSourceId?: string;
  xsdSources: RelatedSchemaDocument[];
  layoutMode: WorkbenchLayoutMode;
  theme: WorkbenchTheme;
}

export interface WorkbenchPreset {
  id: string;
  name: string;
  updatedAt: string;
  snapshot: WorkbenchSnapshot;
}

export interface ValidationHistoryEntry {
  id: string;
  createdAt: string;
  result: ValidationResult;
  snapshot: WorkbenchSnapshot;
}

export interface SchemaMetrics {
  fieldCount: number;
  attributeCount: number;
  requiredCount: number;
  optionalCount: number;
  enumCount: number;
  patternCount: number;
  constraintCount: number;
  warningCount: number;
  maxDepth: number;
  sourceCount: number;
  complexity: 'compact' | 'moderate' | 'large' | 'very large';
}

export interface CoverageReport {
  present: string[];
  missing: string[];
  unused: string[];
  percent: number;
  note: string;
}

export interface SummaryDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface MessagePreview {
  ok: boolean;
  mode: 'tree' | 'table' | 'text';
  title: string;
  details: string;
  content?: string;
  table?: string[][];
}

interface WorkspaceImportBundle {
  snapshot?: WorkbenchSnapshot;
  presets?: WorkbenchPreset[];
  history?: ValidationHistoryEntry[];
}

const defaultSnapshot: WorkbenchSnapshot = {
  schemaFormat: 'json-schema',
  messageFormat: 'json',
  schemaText: '',
  messageText: '',
  autoValidate: true,
  schemaTabId: 'editor',
  messageTabId: 'editor',
  xsdSources: [],
  layoutMode: 'normal',
  theme: 'light',
};

export const getDefaultWorkbenchSnapshot = (): WorkbenchSnapshot => ({ ...defaultSnapshot, xsdSources: [] });

export const loadWorkspaceSnapshot = (): WorkbenchSnapshot | undefined =>
  readJson<WorkbenchSnapshot>(WORKSPACE_STORAGE_KEY, isWorkbenchSnapshot);

export const saveWorkspaceSnapshot = (snapshot: WorkbenchSnapshot) => writeJson(WORKSPACE_STORAGE_KEY, snapshot);

export const clearWorkspaceSnapshot = () => removeStorageItem(WORKSPACE_STORAGE_KEY);

export const loadPresets = (): WorkbenchPreset[] => readJsonArray(PRESETS_STORAGE_KEY, isWorkbenchPreset);

export const savePresets = (presets: WorkbenchPreset[]) => writeJson(PRESETS_STORAGE_KEY, presets);

export const loadHistory = (): ValidationHistoryEntry[] => readJsonArray(HISTORY_STORAGE_KEY, isValidationHistoryEntry);

export const saveHistory = (entries: ValidationHistoryEntry[]) => writeJson(HISTORY_STORAGE_KEY, entries.slice(0, MAX_HISTORY_ENTRIES));

export const createHistoryEntry = (result: ValidationResult, snapshot: WorkbenchSnapshot): ValidationHistoryEntry => ({
  id: stableId('run'),
  createdAt: new Date().toISOString(),
  result,
  snapshot,
});

export const addHistoryEntry = (
  entries: ValidationHistoryEntry[],
  result: ValidationResult,
  snapshot: WorkbenchSnapshot,
): ValidationHistoryEntry[] => [createHistoryEntry(result, snapshot), ...entries].slice(0, MAX_HISTORY_ENTRIES);

export const createPreset = (name: string, snapshot: WorkbenchSnapshot): WorkbenchPreset => ({
  id: stableId('preset'),
  name,
  updatedAt: new Date().toISOString(),
  snapshot,
});

export const buildWorkspaceExport = (
  snapshot: WorkbenchSnapshot,
  presets: WorkbenchPreset[],
  history: ValidationHistoryEntry[],
  result: ValidationResult | null,
) =>
  JSON.stringify(
    {
      version: 2,
      exportedAt: new Date().toISOString(),
      snapshot,
      presets,
      history,
      result,
    },
    null,
    2,
  );

export const parseWorkspaceImport = (text: string): WorkspaceImportBundle => {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Workspace import must be a JSON object.');
  }

  const bundle: WorkspaceImportBundle = {};
  if (isWorkbenchSnapshot(parsed.snapshot)) {
    bundle.snapshot = parsed.snapshot;
  } else if (isWorkbenchSnapshot(parsed)) {
    bundle.snapshot = parsed;
  }

  if (Array.isArray(parsed.presets)) {
    bundle.presets = parsed.presets.filter(isWorkbenchPreset);
  }
  if (Array.isArray(parsed.history)) {
    bundle.history = parsed.history.filter(isValidationHistoryEntry);
  }

  if (!bundle.snapshot && !bundle.presets?.length && !bundle.history?.length) {
    throw new Error('Workspace import did not contain a usable snapshot, preset, or history entry.');
  }

  return bundle;
};

export const createShareUrl = (snapshot: WorkbenchSnapshot) => {
  const payload = encodeBase64Url(JSON.stringify({ version: 2, snapshot }));
  const url = new URL(window.location.href);
  url.searchParams.set('workspace', payload);
  return url.toString();
};

export const loadSharedSnapshotFromUrl = (): WorkbenchSnapshot | undefined => {
  const value = new URL(window.location.href).searchParams.get('workspace');
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(value)) as unknown;
    if (isRecord(parsed) && isWorkbenchSnapshot(parsed.snapshot)) {
      return parsed.snapshot;
    }
  } catch {
    return undefined;
  }

  return undefined;
};

export const buildSchemaMetrics = (summary: SchemaSummary, sourceCount: number): SchemaMetrics => {
  const nodes = summary.root ? flattenSummary(summary.root) : [];
  const fieldNodes = nodes.filter((item) => !['root', 'warning'].includes(item.node.kind));
  const constraintCount = fieldNodes.reduce((total, item) => total + item.node.constraints.length, 0);
  const enumCount = fieldNodes.reduce(
    (total, item) => total + item.node.constraints.filter((constraint) => constraint.kind === 'enumeration').length,
    0,
  );
  const patternCount = fieldNodes.reduce(
    (total, item) => total + item.node.constraints.filter((constraint) => constraint.kind === 'pattern').length,
    0,
  );
  const maxDepth = nodes.reduce((max, item) => Math.max(max, item.depth), 0);
  const score = fieldNodes.length + constraintCount + maxDepth * 4 + sourceCount * 3;

  return {
    fieldCount: fieldNodes.filter((item) => item.node.kind !== 'attribute').length,
    attributeCount: fieldNodes.filter((item) => item.node.kind === 'attribute').length,
    requiredCount: fieldNodes.filter((item) => item.node.required).length,
    optionalCount: fieldNodes.filter((item) => !item.node.required).length,
    enumCount,
    patternCount,
    constraintCount,
    warningCount: summary.warnings.length + fieldNodes.filter((item) => item.node.warnings?.length).length,
    maxDepth,
    sourceCount,
    complexity: score > 260 ? 'very large' : score > 120 ? 'large' : score > 40 ? 'moderate' : 'compact',
  };
};

export const buildCoverageReport = (
  summary: SchemaSummary,
  messageFormat: MessageFormat,
  messageText: string,
): CoverageReport => {
  const expected = summary.root ? collectExpectedFields(summary.root) : [];
  if (!messageText.trim()) {
    return {
      present: [],
      missing: expected.slice(0, 30),
      unused: [],
      percent: 0,
      note: 'Paste a message to estimate field coverage.',
    };
  }

  const extracted = extractMessageFields(messageFormat, messageText);
  if (!extracted.ok) {
    return { present: [], missing: expected.slice(0, 30), unused: [], percent: 0, note: extracted.error };
  }

  const expectedSet = new Set(expected.map(normalizeFieldName));
  const messageSet = new Set([...extracted.fields].map(normalizeFieldName));
  const present = expected.filter((field) => messageSet.has(normalizeFieldName(field)));
  const missing = expected.filter((field) => !messageSet.has(normalizeFieldName(field)));
  const unused = [...extracted.fields]
    .filter((field) => field && !expectedSet.has(normalizeFieldName(field)))
    .slice(0, 30);
  const percent = expected.length === 0 ? 0 : Math.round((present.length / expected.length) * 100);

  return {
    present: present.slice(0, 30),
    missing: missing.slice(0, 30),
    unused,
    percent,
    note: expected.length === 0 ? 'No summary fields are available yet.' : `${present.length} of ${expected.length} fields seen.`,
  };
};

export const compareSummaries = (baseline: SchemaSummary | undefined, current: SchemaSummary): SummaryDiff | undefined => {
  if (!baseline?.root || !current.root) {
    return undefined;
  }

  const baselineNodes = summarySignatureMap(baseline.root);
  const currentNodes = summarySignatureMap(current.root);
  const added = [...currentNodes.keys()].filter((path) => !baselineNodes.has(path));
  const removed = [...baselineNodes.keys()].filter((path) => !currentNodes.has(path));
  const changed = [...currentNodes.entries()]
    .filter(([path, signature]) => baselineNodes.has(path) && baselineNodes.get(path) !== signature)
    .map(([path]) => path);

  return { added, removed, changed };
};

export const buildMessagePreview = (format: MessageFormat, text: string): MessagePreview => {
  if (!text.trim()) {
    return { ok: false, mode: 'text', title: 'No message preview', details: 'Paste a message to preview it.' };
  }

  if (['json', 'yaml', 'toml'].includes(format)) {
    const parsed = parseMessageDocument(format, text);
    if (!parsed.ok) {
      return {
        ok: false,
        mode: 'text',
        title: `${formatLabel(format)} preview unavailable`,
        details: parsed.issues[0]?.message ?? 'The message could not be parsed.',
      };
    }

    return {
      ok: true,
      mode: 'tree',
      title: `${formatLabel(format)} structure`,
      details: `${countValues(parsed.document.data)} values rendered from the parsed payload.`,
      content: JSON.stringify(parsed.document.data, null, 2),
    };
  }

  if (format === 'csv') {
    const rows = text
      .trim()
      .split(/\r?\n/)
      .slice(0, 12)
      .map(parseCsvLine);
    return {
      ok: rows.length > 0,
      mode: 'table',
      title: 'CSV table preview',
      details: `${Math.max(0, rows.length - 1)} visible row${rows.length === 2 ? '' : 's'} plus header.`,
      table: rows,
    };
  }

  if (format === 'xml') {
    const tags = [...text.matchAll(/<\s*([A-Za-z_][\w:.-]*)\b/g)].map((match) => match[1]);
    return {
      ok: tags.length > 0,
      mode: 'text',
      title: 'XML tag preview',
      details: `${tags.length} opening tag${tags.length === 1 ? '' : 's'} detected.`,
      content: tags.slice(0, 80).join('\n'),
    };
  }

  return {
    ok: true,
    mode: 'text',
    title: `${formatLabel(format)} text preview`,
    details: `${text.length.toLocaleString()} characters.`,
    content: text.slice(0, 6000),
  };
};

export const formatCapabilityFacts = (schemaFormat: SchemaFormat, messageFormat: MessageFormat) => {
  const schemaOption = schemaFormatOptions.find((option) => option.value === schemaFormat);
  const messageOption = messageFormatOptions.find((option) => option.value === messageFormat);
  return [
    `Schema: ${schemaOption?.description ?? formatLabel(schemaFormat)}`,
    `Message: ${messageOption?.description ?? formatLabel(messageFormat)}`,
    schemaFormat === 'xsd'
      ? 'XSD validation uses the browser libxml2 engine and the Sources tab for include/import bundles.'
      : 'Validation stays local in the browser; no payloads leave this page.',
    'Summary, diagnostics, previews, presets, and history are static-site features stored locally unless exported.',
  ];
};

export const suggestedFixForIssue = (issue: ValidationIssue): string => {
  const text = `${issue.code} ${issue.title} ${issue.message}`.toLowerCase();
  if (issue.hint) {
    return issue.hint;
  }
  if (text.includes('missing xsd') || text.includes('include') || text.includes('import')) {
    return 'Open Sources, add the referenced XSD, keep its schemaLocation/namespace matching the reference, then paste the full schema content.';
  }
  if (text.includes('required') || text.includes('missing')) {
    return `Add the missing field at ${issue.path ?? 'the highlighted path'} or make it optional in the schema.`;
  }
  if (text.includes('type')) {
    return `Change the message value to the expected type${issue.expected ? ` (${issue.expected})` : ''}, or update the schema type if the payload is correct.`;
  }
  if (text.includes('enum')) {
    return `Use one of the allowed enum values${issue.expected ? `: ${issue.expected}` : ''}.`;
  }
  if (text.includes('pattern')) {
    return `Adjust the value to match the schema pattern${issue.expected ? `: ${issue.expected}` : ''}.`;
  }
  if (text.includes('additional') || text.includes('extra')) {
    return 'Remove the extra field or allow it in the schema with an explicit property/additionalProperties rule.';
  }
  if (text.includes('csv') || text.includes('column')) {
    return 'Check the CSV header names, column count, and table schema field definitions for an exact match.';
  }
  if (text.includes('malformed')) {
    return 'Fix the syntax at the highlighted range, then validate again.';
  }
  return 'Review the highlighted schema/message path and either adjust the payload or relax the corresponding schema rule.';
};

const readJson = <TValue>(key: string, guard: (value: unknown) => value is TValue): TValue | undefined => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as unknown;
    return guard(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const readJsonArray = <TValue>(key: string, guard: (value: unknown) => value is TValue): TValue[] => {
  const value = readJson<unknown[]>(key, Array.isArray);
  return value?.filter(guard) ?? [];
};

const writeJson = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local storage may be disabled or full; the app remains fully usable without persistence.
  }
};

const removeStorageItem = (key: string) => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
};

const isWorkbenchSnapshot = (value: unknown): value is WorkbenchSnapshot => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isSchemaFormat(value.schemaFormat) &&
    isMessageFormat(value.messageFormat) &&
    typeof value.schemaText === 'string' &&
    typeof value.messageText === 'string' &&
    typeof value.autoValidate === 'boolean' &&
    typeof value.schemaTabId === 'string' &&
    typeof value.messageTabId === 'string' &&
    Array.isArray(value.xsdSources) &&
    value.xsdSources.every(isRelatedSchemaDocument) &&
    isLayoutMode(value.layoutMode) &&
    isTheme(value.theme)
  );
};

const isWorkbenchPreset = (value: unknown): value is WorkbenchPreset =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.updatedAt === 'string' &&
  isWorkbenchSnapshot(value.snapshot);

const isValidationHistoryEntry = (value: unknown): value is ValidationHistoryEntry =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.createdAt === 'string' &&
  isValidationResult(value.result) &&
  isWorkbenchSnapshot(value.snapshot);

const isValidationResult = (value: unknown): value is ValidationResult =>
  isRecord(value) &&
  typeof value.ok === 'boolean' &&
  typeof value.adapterId === 'string' &&
  typeof value.summary === 'string' &&
  typeof value.durationMs === 'number' &&
  Array.isArray(value.issues);

const isRelatedSchemaDocument = (value: unknown): value is RelatedSchemaDocument =>
  isRecord(value) && typeof value.id === 'string' && typeof value.label === 'string' && typeof value.text === 'string';

const isSchemaFormat = (value: unknown): value is SchemaFormat =>
  typeof value === 'string' && schemaFormatOptions.some((option) => option.value === value);

const isMessageFormat = (value: unknown): value is MessageFormat =>
  typeof value === 'string' && messageFormatOptions.some((option) => option.value === value);

const isLayoutMode = (value: unknown): value is WorkbenchLayoutMode =>
  value === 'normal' || value === 'schema-focus' || value === 'message-focus' || value === 'no-diagnostics';

const isTheme = (value: unknown): value is WorkbenchTheme => value === 'light' || value === 'dark';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stableId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const flattenSummary = (root: SchemaSummaryNode) => {
  const items: Array<{ node: SchemaSummaryNode; path: string; depth: number }> = [];
  const visit = (node: SchemaSummaryNode, parentPath: string, depth: number) => {
    const path = parentPath ? `${parentPath}.${node.name}` : node.name;
    items.push({ node, path, depth });
    node.children.forEach((child) => visit(child, path, depth + 1));
  };
  visit(root, '', 0);
  return items;
};

const collectExpectedFields = (root: SchemaSummaryNode): string[] => {
  const fields = flattenSummary(root)
    .filter((item) => !['root', 'warning'].includes(item.node.kind))
    .map((item) => item.node.name.replace(/^@/, ''));
  return [...new Set(fields)];
};

const extractMessageFields = (
  format: MessageFormat,
  text: string,
): { ok: true; fields: Set<string> } | { ok: false; error: string } => {
  if (['json', 'yaml', 'toml'].includes(format)) {
    const parsed = parseMessageDocument(format, text);
    if (!parsed.ok) {
      return { ok: false, error: parsed.issues[0]?.message ?? 'The message could not be parsed.' };
    }
    return { ok: true, fields: collectFieldNamesFromUnknown(parsed.document.data) };
  }

  if (format === 'xml') {
    const fields = new Set<string>();
    for (const match of text.matchAll(/<\s*([A-Za-z_][\w:.-]*)\b([^>]*)>/g)) {
      fields.add(localName(match[1]));
      const attributes = match[2] ?? '';
      for (const attribute of attributes.matchAll(/\s([A-Za-z_][\w:.-]*)\s*=/g)) {
        fields.add(localName(attribute[1]));
      }
    }
    return { ok: true, fields };
  }

  if (format === 'csv') {
    const header = text.trim().split(/\r?\n/)[0] ?? '';
    return { ok: true, fields: new Set(parseCsvLine(header).filter(Boolean)) };
  }

  if (format === 'properties') {
    const fields = new Set(
      text
        .split(/\r?\n/)
        .map((line) => /^\s*([^#;=:\s]+)\s*[=:]/.exec(line)?.[1])
        .filter((value): value is string => Boolean(value)),
    );
    return { ok: true, fields };
  }

  const fields = new Set([...text.matchAll(/\b([A-Za-z_][\w-]*)\b/g)].map((match) => match[1]));
  return { ok: true, fields };
};

const collectFieldNamesFromUnknown = (value: unknown): Set<string> => {
  const fields = new Set<string>();
  const visit = (current: unknown) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }

    if (isRecord(current)) {
      for (const [key, child] of Object.entries(current)) {
        fields.add(key);
        visit(child);
      }
    }
  };
  visit(value);
  return fields;
};

const summarySignatureMap = (root: SchemaSummaryNode) => {
  const map = new Map<string, string>();
  flattenSummary(root).forEach((item) => {
    const signature = [
      item.node.kind,
      item.node.dataType,
      String(item.node.required),
      (item.node.constraints ?? []).map((constraint) => `${constraint.kind}:${constraint.value}`).join('|'),
    ].join('::');
    map.set(item.path, signature);
  });
  return map;
};

const countValues = (value: unknown): number => {
  if (Array.isArray(value)) {
    return value.reduce<number>((total, child) => total + countValues(child), 1);
  }
  if (isRecord(value)) {
    return Object.values(value).reduce<number>((total, child) => total + countValues(child), 1);
  }
  return 1;
};

const parseCsvLine = (line: string) => {
  const values: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];
    if (character === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }

  values.push(current.trim());
  return values;
};

const normalizeFieldName = (value: string) => localName(value).toLowerCase();
const localName = (value: string) => value.replace(/^.*:/, '');

const encodeBase64Url = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const decodeBase64Url = (value: string) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};
