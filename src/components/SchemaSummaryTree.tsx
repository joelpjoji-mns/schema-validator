import { ChevronDown, ChevronRight, Maximize2, Minimize2, Pin, Search } from 'lucide-react';
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
  showOrder: false,
  showTypes: false,
  showLimits: false,
  showDescriptions: false,
  showWarnings: false,
};

export function SchemaSummaryTree({ summary, onNodeSelect }: SchemaSummaryTreeProps) {
  const [options, setOptions] = useState(defaultOptions);
  const allNodeIds = useMemo(() => (summary.root ? collectNodeIds(summary.root) : []), [summary.root]);
  const flatNodes = useMemo(() => (summary.root ? flattenNodes(summary.root) : []), [summary.root]);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const searchMatchCount = normalizedSearch
    ? flatNodes.filter((item) => nodeMatchesSearch(item.node, normalizedSearch)).length
    : 0;
  const pinnedNodes = flatNodes.filter((item) => pinnedIds.has(item.node.id));

  const setOption = (key: keyof SummaryOptions, value: boolean) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const collapseAll = () => setCollapsedIds(new Set(allNodeIds));
  const expandAll = () => setCollapsedIds(new Set());
  const togglePinned = (nodeId: string) => {
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

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
        <div className="summary-option-group is-primary">
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
        </div>
        <div className="summary-option-group">
          <SummaryToggle
            label="Order"
            checked={options.showOrder}
            onChange={(value) => setOption('showOrder', value)}
          />
          <SummaryToggle
            label="Types"
            checked={options.showTypes}
            onChange={(value) => setOption('showTypes', value)}
          />
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
      </div>

      <div className="summary-search-row">
        <label className="search-field">
          <Search aria-hidden="true" size={15} />
          <input
            value={searchQuery}
            aria-label="Search summary"
            placeholder="Search fields, types, constraints"
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <span>{normalizedSearch ? `${searchMatchCount} matches` : `${pinnedNodes.length} pinned`}</span>
      </div>

      {pinnedNodes.length > 0 ? (
        <div className="summary-pins" aria-label="Pinned summary nodes">
          {pinnedNodes.map(({ node }) => (
            <button key={node.id} type="button" className="summary-pin" onClick={() => onNodeSelect?.(node)}>
              <Pin aria-hidden="true" size={12} />
              {node.name}
            </button>
          ))}
        </div>
      ) : null}

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
          searchQuery={normalizedSearch}
          pinnedIds={pinnedIds}
          onTogglePinned={togglePinned}
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
  searchQuery: string;
  pinnedIds: Set<string>;
  onTogglePinned: (nodeId: string) => void;
}

function SummaryNodeRow({
  node,
  depth,
  isLast,
  options,
  collapsedIds,
  setCollapsedIds,
  onNodeSelect,
  searchQuery,
  pinnedIds,
  onTogglePinned,
}: SummaryNodeRowProps) {
  const visibleChildren = node.children.filter((child) => shouldShowNode(child, options) && nodeTreeMatches(child, searchQuery));
  const collapsed = collapsedIds.has(node.id);
  const hasChildren = visibleChildren.length > 0;
  const connectorClass = depth === 0 ? 'is-root' : isLast ? 'is-last' : 'is-branch';
  const recursiveConstraint = node.constraints.find((item) => item.kind === 'recursive');
  const cycleConstraint = node.constraints.find((item) => item.kind === 'cycle');
  const limitConstraints = node.constraints.filter(
    (item) => !['ref', 'default', 'deprecated', 'recursive', 'cycle'].includes(item.kind),
  );

  if ((!shouldShowNode(node, options) || !nodeTreeMatches(node, searchQuery)) && depth > 0) {
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

  const activateNode = () => {
    if (node.sourceRange) {
      onNodeSelect?.(node);
    }
    if (hasChildren) {
      toggleCollapsed();
    }
  };
  const isSearchMatch = Boolean(searchQuery) && nodeMatchesSearch(node, searchQuery);
  const isPinned = pinnedIds.has(node.id);

  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? !collapsed : undefined}
      style={{ '--tree-depth': depth } as CSSProperties}
    >
      <div className={`schema-tree-row kind-${node.kind} ${isSearchMatch ? 'is-search-match' : ''}`}>
        <button
          type="button"
          className={`tree-main-button ${hasChildren || node.sourceRange ? 'is-interactive' : ''}`}
          onClick={activateNode}
        >
          <span className={`tree-connector ${connectorClass}`} aria-hidden="true" />
          <span className="tree-toggle" aria-hidden="true">
            {hasChildren ? collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} /> : null}
          </span>
          <span className={`tree-kind kind-${node.kind}`}>{node.kind === 'root' ? 'schema' : node.kind}</span>
          <span className="tree-name">{node.name}</span>
          {options.showOrder && node.order !== undefined ? (
            <span className="tree-badge is-order">#{node.order}</span>
          ) : null}
          {options.showTypes ? <span className="tree-badge is-type">{node.dataType}</span> : null}
          <span className={`tree-badge ${node.required ? 'is-required' : 'is-optional'}`}>
            {node.required ? 'mandatory' : 'optional'}
          </span>
          {recursiveConstraint ? (
            <span className="tree-badge is-recursive" title={cycleConstraint?.value}>
              recursive ref
            </span>
          ) : null}
          {options.showLimits
            ? limitConstraints.slice(0, 4).map((item) => (
                <span key={`${node.id}-${item.kind}-${item.value}`} className="tree-badge is-limit">
                  {item.label}
                  {item.value ? `: ${item.value}` : ''}
                </span>
              ))
            : null}
        </button>
        <button
          type="button"
          className={`tree-pin-button ${isPinned ? 'is-pinned' : ''}`}
          title={isPinned ? 'Unpin field' : 'Pin field'}
          onClick={() => onTogglePinned(node.id)}
        >
          <Pin aria-hidden="true" size={13} />
          <span className="sr-only">{isPinned ? 'Unpin' : 'Pin'} {node.name}</span>
        </button>
      </div>
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
              searchQuery={searchQuery}
              pinnedIds={pinnedIds}
              onTogglePinned={onTogglePinned}
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
    <label className={`summary-toggle ${checked ? 'is-checked' : ''}`}>
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
const flattenNodes = (node: SchemaSummaryNode): Array<{ node: SchemaSummaryNode; depth: number }> => [
  { node, depth: 0 },
  ...node.children.flatMap((child) => flattenNodesWithDepth(child, 1)),
];

const flattenNodesWithDepth = (node: SchemaSummaryNode, depth: number): Array<{ node: SchemaSummaryNode; depth: number }> => [
  { node, depth },
  ...node.children.flatMap((child) => flattenNodesWithDepth(child, depth + 1)),
];

const nodeTreeMatches = (node: SchemaSummaryNode, query: string): boolean =>
  !query || nodeMatchesSearch(node, query) || node.children.some((child) => nodeTreeMatches(child, query));

const nodeMatchesSearch = (node: SchemaSummaryNode, query: string) =>
  [
    node.name,
    node.kind,
    node.dataType,
    node.description,
    ...(node.warnings ?? []),
    ...node.constraints.flatMap((constraint) => [constraint.kind, constraint.label, constraint.value]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query);
