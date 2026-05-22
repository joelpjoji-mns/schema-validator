import { ChevronDown, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import type { SchemaSummary, SchemaSummaryNode } from '../validation/introspection';

interface SchemaSummaryTreeProps {
  summary: SchemaSummary;
  onNodeSelect?: (node: SchemaSummaryNode) => void;
}

interface SummaryOptions {
  showRequired: boolean;
  showOptional: boolean;
  showOrder: boolean;
  showTypes: boolean;
  showLimits: boolean;
  showDescriptions: boolean;
  showWarnings: boolean;
}

const defaultOptions: SummaryOptions = {
  showRequired: true,
  showOptional: true,
  showOrder: true,
  showTypes: true,
  showLimits: true,
  showDescriptions: true,
  showWarnings: true,
};

export function SchemaSummaryTree({ summary, onNodeSelect }: SchemaSummaryTreeProps) {
  const [options, setOptions] = useState(defaultOptions);
  const allNodeIds = useMemo(() => (summary.root ? collectNodeIds(summary.root) : []), [summary.root]);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const setOption = (key: keyof SummaryOptions, value: boolean) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const collapseAll = () => setCollapsedIds(new Set(allNodeIds));
  const expandAll = () => setCollapsedIds(new Set());

  if (summary.errors.length > 0) {
    return (
      <div className="summary-empty" role="status">
        <strong>Summary unavailable</strong>
        {summary.errors.map((error) => (
          <span key={error}>{error}</span>
        ))}
      </div>
    );
  }

  if (!summary.root) {
    return (
      <div className="summary-empty" role="status">
        <strong>No schema summary yet</strong>
        <span>{summary.warnings[0] ?? 'Paste or upload a schema to build the hierarchy.'}</span>
      </div>
    );
  }

  return (
    <div className="schema-summary" aria-label="Schema summary">
      <div className="summary-toolbar">
        <div className="summary-stats" aria-label="Schema summary statistics">
          <strong>{summary.title}</strong>
          <span>{summary.stats.nodes} nodes</span>
          <span>{summary.stats.required} required</span>
          <span>{summary.stats.optional} optional</span>
        </div>
        <div className="summary-action-buttons">
          <button type="button" className="icon-button" title="Expand all" onClick={expandAll}>
            <Maximize2 aria-hidden="true" size={15} />
            <span className="sr-only">Expand all</span>
          </button>
          <button type="button" className="icon-button" title="Collapse all" onClick={collapseAll}>
            <Minimize2 aria-hidden="true" size={15} />
            <span className="sr-only">Collapse all</span>
          </button>
        </div>
      </div>

      <div className="summary-options" aria-label="Schema summary options">
        <SummaryToggle
          label="Required"
          checked={options.showRequired}
          onChange={(value) => setOption('showRequired', value)}
        />
        <SummaryToggle
          label="Optional"
          checked={options.showOptional}
          onChange={(value) => setOption('showOptional', value)}
        />
        <SummaryToggle label="Order" checked={options.showOrder} onChange={(value) => setOption('showOrder', value)} />
        <SummaryToggle label="Types" checked={options.showTypes} onChange={(value) => setOption('showTypes', value)} />
        <SummaryToggle
          label="Limits"
          checked={options.showLimits}
          onChange={(value) => setOption('showLimits', value)}
        />
        <SummaryToggle
          label="Docs"
          checked={options.showDescriptions}
          onChange={(value) => setOption('showDescriptions', value)}
        />
        <SummaryToggle
          label="Warnings"
          checked={options.showWarnings}
          onChange={(value) => setOption('showWarnings', value)}
        />
      </div>

      {options.showWarnings && summary.warnings.length > 0 ? (
        <div className="summary-warnings">
          {summary.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}

      <div className="schema-tree" role="tree">
        <SummaryNodeRow
          node={summary.root}
          depth={0}
          isLast
          options={options}
          collapsedIds={collapsedIds}
          setCollapsedIds={setCollapsedIds}
          onNodeSelect={onNodeSelect}
        />
      </div>
    </div>
  );
}

interface SummaryNodeRowProps {
  node: SchemaSummaryNode;
  depth: number;
  isLast: boolean;
  options: SummaryOptions;
  collapsedIds: Set<string>;
  setCollapsedIds: (next: Set<string>) => void;
  onNodeSelect?: (node: SchemaSummaryNode) => void;
}

function SummaryNodeRow({
  node,
  depth,
  isLast,
  options,
  collapsedIds,
  setCollapsedIds,
  onNodeSelect,
}: SummaryNodeRowProps) {
  const visibleChildren = node.children.filter((child) => shouldShowNode(child, options));
  const collapsed = collapsedIds.has(node.id);
  const hasChildren = visibleChildren.length > 0;
  const connector = depth === 0 ? '' : isLast ? '`-- ' : '|-- ';
  const limitConstraints = node.constraints.filter((item) => !['ref', 'default', 'deprecated'].includes(item.kind));

  if (!shouldShowNode(node, options) && depth > 0) {
    return null;
  }

  const toggleCollapsed = () => {
    const next = new Set(collapsedIds);
    if (next.has(node.id)) {
      next.delete(node.id);
    } else {
      next.add(node.id);
    }
    setCollapsedIds(next);
  };

  return (
    <div role="treeitem" aria-expanded={hasChildren ? !collapsed : undefined}>
      <button
        type="button"
        className={`schema-tree-row kind-${node.kind}`}
        style={{ '--tree-depth': depth } as CSSProperties}
        onClick={() => (node.sourceRange ? onNodeSelect?.(node) : hasChildren ? toggleCollapsed() : undefined)}
      >
        <span className="tree-connector" aria-hidden="true">
          {connector}
        </span>
        <span className="tree-toggle" aria-hidden="true">
          {hasChildren ? collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} /> : null}
        </span>
        <span className="tree-name">{node.name}</span>
        {options.showOrder && node.order !== undefined ? (
          <span className="tree-badge is-order">#{node.order}</span>
        ) : null}
        {options.showTypes ? <span className="tree-badge is-type">{node.dataType}</span> : null}
        <span className={`tree-badge ${node.required ? 'is-required' : 'is-optional'}`}>
          {node.required ? 'mandatory' : 'optional'}
        </span>
        {options.showLimits
          ? limitConstraints.slice(0, 4).map((item) => (
              <span key={`${node.id}-${item.kind}-${item.value}`} className="tree-badge is-limit">
                {item.label}
                {item.value ? `: ${item.value}` : ''}
              </span>
            ))
          : null}
      </button>
      {options.showDescriptions && node.description ? <p className="tree-description">{node.description}</p> : null}
      {options.showWarnings && node.warnings?.length ? (
        <div className="tree-warning-row">
          {node.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}
      {!collapsed && hasChildren
        ? visibleChildren.map((child, index) => (
            <SummaryNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              isLast={index === visibleChildren.length - 1}
              options={options}
              collapsedIds={collapsedIds}
              setCollapsedIds={setCollapsedIds}
              onNodeSelect={onNodeSelect}
            />
          ))
        : null}
    </div>
  );
}

function SummaryToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="summary-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

const shouldShowNode = (node: SchemaSummaryNode, options: SummaryOptions) => {
  if (node.kind === 'root') {
    return true;
  }
  if (node.required && !options.showRequired) {
    return false;
  }
  if (!node.required && !options.showOptional) {
    return false;
  }
  if (node.kind === 'warning' && !options.showWarnings) {
    return false;
  }
  return true;
};

const collectNodeIds = (node: SchemaSummaryNode): string[] => [node.id, ...node.children.flatMap(collectNodeIds)];
