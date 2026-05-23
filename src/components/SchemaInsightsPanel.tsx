import { BarChart3, GitCompare, ScanSearch } from 'lucide-react';
import type { CoverageReport, SchemaMetrics, SummaryDiff } from './workbenchPowerTools';

interface SchemaInsightsPanelProps {
  metrics: SchemaMetrics;
  coverage: CoverageReport;
  diff?: SummaryDiff;
  hasBaseline: boolean;
  onSaveBaseline: () => void;
  onClearBaseline: () => void;
}

export function SchemaInsightsPanel({
  metrics,
  coverage,
  diff,
  hasBaseline,
  onSaveBaseline,
  onClearBaseline,
}: SchemaInsightsPanelProps) {
  return (
    <div className="schema-insights" aria-label="Schema insights">
      <section className="insight-section">
        <div className="insight-heading">
          <BarChart3 aria-hidden="true" size={17} />
          <h3>Metrics</h3>
          <span>{metrics.complexity}</span>
        </div>
        <div className="metric-grid">
          <Metric label="Fields" value={metrics.fieldCount} />
          <Metric label="Attributes" value={metrics.attributeCount} />
          <Metric label="Required" value={metrics.requiredCount} />
          <Metric label="Optional" value={metrics.optionalCount} />
          <Metric label="Max depth" value={metrics.maxDepth} />
          <Metric label="Enums" value={metrics.enumCount} />
          <Metric label="Patterns" value={metrics.patternCount} />
          <Metric label="Sources" value={metrics.sourceCount} />
        </div>
      </section>

      <section className="insight-section">
        <div className="insight-heading">
          <ScanSearch aria-hidden="true" size={17} />
          <h3>Message Coverage</h3>
          <span>{coverage.percent}%</span>
        </div>
        <p className="insight-note">{coverage.note}</p>
        <CoverageList label="Present" items={coverage.present} />
        <CoverageList label="Missing" items={coverage.missing} />
        <CoverageList label="Unused" items={coverage.unused} />
      </section>

      <section className="insight-section">
        <div className="insight-heading">
          <GitCompare aria-hidden="true" size={17} />
          <h3>Comparison Baseline</h3>
          <span>{hasBaseline ? 'active' : 'none'}</span>
        </div>
        <div className="insight-actions">
          <button type="button" className="secondary-button" onClick={onSaveBaseline}>
            Save baseline
          </button>
          <button type="button" className="secondary-button" disabled={!hasBaseline} onClick={onClearBaseline}>
            Clear baseline
          </button>
        </div>
        {diff ? (
          <div className="diff-grid">
            <CoverageList label="Added" items={diff.added.slice(0, 20)} />
            <CoverageList label="Removed" items={diff.removed.slice(0, 20)} />
            <CoverageList label="Changed" items={diff.changed.slice(0, 20)} />
          </div>
        ) : (
          <p className="insight-note">Save a baseline, then edit the schema to see structural changes.</p>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-item">
      <strong>{value.toLocaleString()}</strong>
      <span>{label}</span>
    </div>
  );
}

function CoverageList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="coverage-list">
      <strong>
        {label} <span>{items.length}</span>
      </strong>
      {items.length === 0 ? <em>None</em> : null}
      <div>
        {items.slice(0, 16).map((item) => (
          <span key={`${label}-${item}`}>{item}</span>
        ))}
      </div>
    </div>
  );
}
