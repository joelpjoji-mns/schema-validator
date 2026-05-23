import { CheckCircle2, ClipboardCopy, Download, FileJson, Search, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ValidationIssue, ValidationResult, ValidationSeverity } from '../validation/types';
import { suggestedFixForIssue } from './workbenchPowerTools';

interface DiagnosticsPanelProps {
  result: ValidationResult | null;
  activeIssueId?: string;
  onIssueSelect: (issue: ValidationIssue) => void;
}

export function DiagnosticsPanel({ result, activeIssueId, onIssueSelect }: DiagnosticsPanelProps) {
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState<ValidationSeverity | 'all'>('all');
  const [groupBy, setGroupBy] = useState<'none' | 'severity' | 'code' | 'source' | 'path'>('none');
  const report = result ? JSON.stringify(result, null, 2) : '';
  const issueGroups = useMemo(() => buildIssueGroups(result?.issues ?? [], query, severity, groupBy), [groupBy, query, result, severity]);
  const visibleIssueCount = issueGroups.reduce((total, group) => total + group.items.length, 0);

  const downloadReport = () => {
    if (!result) {
      return;
    }
    const blob = new Blob([report], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `schema-validation-${result.ok ? 'pass' : 'fail'}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  return (
    <aside className="diagnostics" aria-label="Validation diagnostics">
      <div className={`result-banner ${result?.ok ? 'is-pass' : 'is-fail'}`}>
        {result?.ok ? <CheckCircle2 aria-hidden="true" size={22} /> : <XCircle aria-hidden="true" size={22} />}
        <div>
          <h2>{result?.ok ? 'Validation passed' : 'Validation failed'}</h2>
          <p>{result?.summary ?? 'Run validation to see diagnostics.'}</p>
        </div>
      </div>

      <div className="report-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={!result}
          onClick={() => void navigator.clipboard.writeText(report)}
        >
          <ClipboardCopy aria-hidden="true" size={16} />
          Copy report
        </button>
        <button type="button" className="secondary-button" disabled={!result} onClick={downloadReport}>
          <Download aria-hidden="true" size={16} />
          Export JSON
        </button>
      </div>

      <div className="diagnostic-tools" aria-label="Diagnostic filters">
        <label className="search-field">
          <Search aria-hidden="true" size={15} />
          <input
            value={query}
            placeholder="Search diagnostics"
            aria-label="Search diagnostics"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="filter-row">
          <label>
            <span>Severity</span>
            <select value={severity} onChange={(event) => setSeverity(event.target.value as ValidationSeverity | 'all')}>
              <option value="all">All</option>
              <option value="error">Errors</option>
              <option value="warning">Warnings</option>
              <option value="info">Info</option>
            </select>
          </label>
          <label>
            <span>Group</span>
            <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as typeof groupBy)}>
              <option value="none">Related</option>
              <option value="severity">Severity</option>
              <option value="code">Code</option>
              <option value="source">Source</option>
              <option value="path">Path</option>
            </select>
          </label>
        </div>
        <p className="diagnostic-count">
          {visibleIssueCount} visible / {result?.issues.length ?? 0} total
        </p>
      </div>

      <div className="issue-list" role="list">
        {result && result.issues.length === 0 ? (
          <div className="empty-state">
            <FileJson aria-hidden="true" size={24} />
            <p>No diagnostics. The schema and message agree.</p>
          </div>
        ) : null}

        {result && result.issues.length > 0 && visibleIssueCount === 0 ? (
          <div className="empty-state">
            <Search aria-hidden="true" size={24} />
            <p>No diagnostics match the current filters.</p>
          </div>
        ) : null}

        {issueGroups.map((group) => (
          <section key={group.key} className="issue-group" aria-label={`Diagnostic group ${group.label}`}>
            <div className="issue-group-heading">
              <strong>{group.label}</strong>
              <span>{group.items.length}</span>
            </div>
            {group.items.map(({ issue, relatedCount }, index) => (
              <button
                key={issue.id}
                type="button"
                className={`issue-item ${activeIssueId === issue.id ? 'is-active' : ''}`}
                onClick={() => onIssueSelect(issue)}
              >
                <span className={`issue-number severity-${issue.severity}`}>{index + 1}</span>
                <span className="issue-copy">
                  <strong>
                    {issue.title}
                    {relatedCount > 1 ? <em>{relatedCount} similar</em> : null}
                  </strong>
                  <span>{issue.message}</span>
                  <span className="issue-meta">
                    {issue.code}
                    {issue.schemaSourceLabel ? ` / ${issue.schemaSourceLabel}` : ''}
                    {issue.path ? ` / ${issue.path}` : ''}
                  </span>
                  <span className="issue-fix">Fix: {suggestedFixForIssue(issue)}</span>
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}

interface IssueGroupItem {
  issue: ValidationIssue;
  relatedCount: number;
}

interface IssueGroup {
  key: string;
  label: string;
  items: IssueGroupItem[];
}

const buildIssueGroups = (
  issues: ValidationIssue[],
  query: string,
  severity: ValidationSeverity | 'all',
  groupBy: 'none' | 'severity' | 'code' | 'source' | 'path',
): IssueGroup[] => {
  const normalizedQuery = query.trim().toLowerCase();
  const visibleIssues = issues.filter(
    (issue) => (severity === 'all' || issue.severity === severity) && issueMatchesQuery(issue, normalizedQuery),
  );
  const deduped = dedupeIssues(visibleIssues);
  const groups = new Map<string, IssueGroup>();

  for (const item of deduped) {
    const key = issueGroupKey(item.issue, groupBy);
    const group = groups.get(key) ?? { key, label: issueGroupLabel(item.issue, groupBy), items: [] };
    group.items.push(item);
    groups.set(key, group);
  }

  return [...groups.values()];
};

const dedupeIssues = (issues: ValidationIssue[]): IssueGroupItem[] => {
  const groups = new Map<string, IssueGroupItem>();
  for (const issue of issues) {
    const key = [issue.code, issue.title, issue.path ?? '', issue.schemaSourceLabel ?? '', issue.message].join('|');
    const existing = groups.get(key);
    if (existing) {
      existing.relatedCount += 1;
    } else {
      groups.set(key, { issue, relatedCount: 1 });
    }
  }
  return [...groups.values()];
};

const issueMatchesQuery = (issue: ValidationIssue, query: string) => {
  if (!query) {
    return true;
  }

  return [
    issue.title,
    issue.message,
    issue.code,
    issue.path,
    issue.expected,
    issue.actual,
    issue.schemaSourceLabel,
    issue.hint,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query);
};

const issueGroupKey = (issue: ValidationIssue, groupBy: IssueGroup['key']) => {
  if (groupBy === 'severity') {
    return issue.severity;
  }
  if (groupBy === 'code') {
    return issue.code;
  }
  if (groupBy === 'source') {
    return issue.schemaSourceLabel ?? (issue.schemaRange ? 'Main schema' : 'Message');
  }
  if (groupBy === 'path') {
    return issue.path ?? 'No path';
  }
  return 'related';
};

const issueGroupLabel = (issue: ValidationIssue, groupBy: IssueGroup['key']) => {
  const key = issueGroupKey(issue, groupBy);
  return groupBy === 'none' ? 'Related diagnostics' : key;
};
