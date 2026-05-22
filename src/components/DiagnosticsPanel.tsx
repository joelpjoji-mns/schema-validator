import { CheckCircle2, ClipboardCopy, Download, FileJson, XCircle } from 'lucide-react';
import type { ValidationIssue, ValidationResult } from '../validation/types';

interface DiagnosticsPanelProps {
  result: ValidationResult | null;
  activeIssueId?: string;
  onIssueSelect: (issue: ValidationIssue) => void;
}

export function DiagnosticsPanel({ result, activeIssueId, onIssueSelect }: DiagnosticsPanelProps) {
  const report = result ? JSON.stringify(result, null, 2) : '';

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

      <div className="issue-list" role="list">
        {result && result.issues.length === 0 ? (
          <div className="empty-state">
            <FileJson aria-hidden="true" size={24} />
            <p>No diagnostics. The schema and message agree.</p>
          </div>
        ) : null}

        {result?.issues.map((issue, index) => (
          <button
            key={issue.id}
            type="button"
            className={`issue-item ${activeIssueId === issue.id ? 'is-active' : ''}`}
            onClick={() => onIssueSelect(issue)}
          >
            <span className={`issue-number severity-${issue.severity}`}>{index + 1}</span>
            <span className="issue-copy">
              <strong>{issue.title}</strong>
              <span>{issue.message}</span>
              <span className="issue-meta">
                {issue.code}
                {issue.schemaSourceLabel ? ` / ${issue.schemaSourceLabel}` : ''}
                {issue.path ? ` / ${issue.path}` : ''}
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
