import { describe, expect, it } from 'vitest';
import type { SchemaSummary } from '../validation/introspection';
import {
  buildCoverageReport,
  buildMessagePreview,
  buildSchemaMetrics,
  compareSummaries,
  createPreset,
  getDefaultWorkbenchSnapshot,
  parseWorkspaceImport,
  suggestedFixForIssue,
} from './workbenchPowerTools';

const summary: SchemaSummary = {
  ok: true,
  schemaFormat: 'json-schema',
  title: 'Test summary',
  warnings: [],
  errors: [],
  stats: { nodes: 3, required: 1, optional: 1, warnings: 0, maxDepth: 1 },
  root: {
    id: 'root',
    name: 'Customer',
    kind: 'root',
    dataType: 'object',
    required: true,
    constraints: [],
    children: [
      {
        id: 'name',
        name: 'name',
        kind: 'field',
        dataType: 'string',
        required: true,
        constraints: [{ kind: 'pattern', label: 'pattern', value: '^J' }],
        children: [],
      },
      {
        id: 'email',
        name: 'email',
        kind: 'field',
        dataType: 'string',
        required: false,
        constraints: [{ kind: 'enumeration', label: 'enum', value: 'a@example.test' }],
        children: [],
      },
    ],
  },
};

describe('workbenchPowerTools', () => {
  it('builds schema metrics and message coverage', () => {
    const metrics = buildSchemaMetrics(summary, 2);
    const coverage = buildCoverageReport(summary, 'json', '{"name":"Joel","unused":true}');

    expect(metrics.fieldCount).toBe(2);
    expect(metrics.patternCount).toBe(1);
    expect(metrics.enumCount).toBe(1);
    expect(metrics.sourceCount).toBe(2);
    expect(coverage.percent).toBe(50);
    expect(coverage.present).toContain('name');
    expect(coverage.missing).toContain('email');
    expect(coverage.unused).toContain('unused');
  });

  it('previews structured and CSV messages', () => {
    const jsonPreview = buildMessagePreview('json', '{"name":"Joel"}');
    const csvPreview = buildMessagePreview('csv', 'id,name\n1,Joel');

    expect(jsonPreview.ok).toBe(true);
    expect(jsonPreview.content).toContain('Joel');
    expect(csvPreview.mode).toBe('table');
    expect(csvPreview.table?.[0]).toEqual(['id', 'name']);
  });

  it('imports workspace bundles and compares summaries', () => {
    const snapshot = getDefaultWorkbenchSnapshot();
    const preset = createPreset('Default', snapshot);
    const bundle = parseWorkspaceImport(JSON.stringify({ snapshot, presets: [preset] }));
    const changedSummary = {
      ...summary,
      root: summary.root
        ? {
            ...summary.root,
            children: summary.root.children.slice(0, 1),
          }
        : undefined,
    };
    const diff = compareSummaries(summary, changedSummary);

    expect(bundle.snapshot?.schemaFormat).toBe('json-schema');
    expect(bundle.presets?.[0].name).toBe('Default');
    expect(diff?.removed).toContain('Customer.email');
  });

  it('suggests issue fixes from diagnostic text', () => {
    expect(
      suggestedFixForIssue({
        id: 'required-name',
        severity: 'error',
        code: 'required',
        title: 'Missing required field: name',
        message: 'name is required.',
        path: '/name',
      }),
    ).toContain('Add the missing field');
  });
});
