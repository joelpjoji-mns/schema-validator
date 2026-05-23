import {
  Command,
  Download,
  FolderOpen,
  History,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RotateCcw,
  Save,
  Share2,
  ShieldCheck,
  Sun,
  Upload,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { introspectSchema, type SchemaSummary, type SchemaSummaryNode } from '../validation/introspection';
import { isSupportedFormatPair, supportedMessageFormatsForSchema, validateRequest } from '../validation/registry';
import { detectSchemaFormat } from '../validation/schemaDetection';
import {
    formatLabel,
    messageFormatOptions,
    schemaFormatOptions,
    type MessageFormat,
    type RelatedSchemaDocument,
    type SchemaFormat,
    type TextRange,
    type ValidationIssue,
    type ValidationResult,
} from '../validation/types';
import { CommandPalette, type CommandPaletteCommand } from './CommandPalette';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { EditorPane } from './EditorPane';
import { FormatSelector } from './FormatSelector';
import { MessagePreviewPanel } from './MessagePreviewPanel';
import { SchemaInsightsPanel } from './SchemaInsightsPanel';
import { SchemaSourcesPanel } from './SchemaSourcesPanel';
import { SchemaSummaryTree } from './SchemaSummaryTree';
import {
  addHistoryEntry,
  buildCoverageReport,
  buildMessagePreview,
  buildSchemaMetrics,
  buildWorkspaceExport,
  clearWorkspaceSnapshot,
  compareSummaries,
  createPreset,
  createShareUrl,
  formatCapabilityFacts,
  getDefaultWorkbenchSnapshot,
  loadHistory,
  loadPresets,
  loadSharedSnapshotFromUrl,
  loadWorkspaceSnapshot,
  parseWorkspaceImport,
  saveHistory,
  savePresets,
  saveWorkspaceSnapshot,
  type ValidationHistoryEntry,
  type WorkbenchLayoutMode,
  type WorkbenchPreset,
  type WorkbenchSnapshot,
  type WorkbenchTheme,
} from './workbenchPowerTools';

const PRIMARY_SCHEMA_SOURCE_ID = 'primary-schema';

export function ValidatorWorkbench() {
  const initialSnapshot = useMemo(
    () => loadSharedSnapshotFromUrl() ?? loadWorkspaceSnapshot() ?? getDefaultWorkbenchSnapshot(),
    [],
  );
  const [schemaFormat, setSchemaFormat] = useState<SchemaFormat>(initialSnapshot.schemaFormat);
  const [messageFormat, setMessageFormat] = useState<MessageFormat>(initialSnapshot.messageFormat);
  const [schemaText, setSchemaText] = useState(initialSnapshot.schemaText);
  const [messageText, setMessageText] = useState(initialSnapshot.messageText);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [activeIssueId, setActiveIssueId] = useState<string>();
  const [autoValidate, setAutoValidate] = useState(initialSnapshot.autoValidate);
  const [isValidating, setIsValidating] = useState(false);
  const [schemaTabId, setSchemaTabId] = useState(initialSnapshot.schemaTabId);
  const [messageTabId, setMessageTabId] = useState(initialSnapshot.messageTabId);
  const [manualSchemaFormat, setManualSchemaFormat] = useState(false);
  const [summaryRange, setSummaryRange] = useState<TextRange>();
  const [xsdSources, setXsdSources] = useState<RelatedSchemaDocument[]>(initialSnapshot.xsdSources);
  const [selectedXsdSourceId, setSelectedXsdSourceId] = useState<string | undefined>(
    initialSnapshot.selectedXsdSourceId,
  );
  const [layoutMode, setLayoutMode] = useState<WorkbenchLayoutMode>(initialSnapshot.layoutMode);
  const [theme, setTheme] = useState<WorkbenchTheme>(initialSnapshot.theme);
  const [presets, setPresets] = useState<WorkbenchPreset[]>(() => loadPresets());
  const [historyEntries, setHistoryEntries] = useState<ValidationHistoryEntry[]>(() => loadHistory());
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [summaryBaseline, setSummaryBaseline] = useState<SchemaSummary>();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Workspace autosave ready.');
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const validationRunId = useRef(0);
  const xsdSourceCounter = useRef(initialSnapshot.xsdSources.length);

  const supportedPair = isSupportedFormatPair(schemaFormat, messageFormat);
  const activeIssue = result?.issues.find((issue) => issue.id === activeIssueId);
  const schemaDetection = useMemo(() => detectSchemaFormat(schemaText), [schemaText]);
  const schemaSummary = useMemo(
    () =>
      introspectSchema({
        schemaText,
        schemaFormat,
        relatedSchemas: schemaFormat === 'xsd' ? xsdSources : undefined,
      }),
    [schemaFormat, schemaText, xsdSources],
  );
  const currentSnapshot = useMemo<WorkbenchSnapshot>(
    () => ({
      schemaFormat,
      messageFormat,
      schemaText,
      messageText,
      autoValidate,
      schemaTabId,
      messageTabId,
      selectedXsdSourceId,
      xsdSources,
      layoutMode,
      theme,
    }),
    [
      autoValidate,
      layoutMode,
      messageFormat,
      messageTabId,
      messageText,
      schemaFormat,
      schemaTabId,
      schemaText,
      selectedXsdSourceId,
      theme,
      xsdSources,
    ],
  );
  const schemaMetrics = useMemo(() => buildSchemaMetrics(schemaSummary, xsdSources.length + 1), [schemaSummary, xsdSources.length]);
  const coverageReport = useMemo(
    () => buildCoverageReport(schemaSummary, messageFormat, messageText),
    [messageFormat, messageText, schemaSummary],
  );
  const summaryDiff = useMemo(() => compareSummaries(summaryBaseline, schemaSummary), [schemaSummary, summaryBaseline]);
  const messagePreview = useMemo(() => buildMessagePreview(messageFormat, messageText), [messageFormat, messageText]);
  const capabilityFacts = useMemo(
    () => formatCapabilityFacts(schemaFormat, messageFormat),
    [messageFormat, schemaFormat],
  );

  const schemaIssues = useMemo(
    () =>
      result?.issues
        .filter(
          (issue) => issue.schemaRange && (!issue.schemaSourceId || issue.schemaSourceId === PRIMARY_SCHEMA_SOURCE_ID),
        )
        .map((issue) => ({ ...issue, messageRange: undefined })) ?? [],
    [result],
  );
  const xsdSourceIssues = useMemo(
    () =>
      result?.issues
        .filter(
          (issue) => issue.schemaRange && issue.schemaSourceId && issue.schemaSourceId !== PRIMARY_SCHEMA_SOURCE_ID,
        )
        .map((issue) => ({ ...issue, messageRange: undefined })) ?? [],
    [result],
  );
  const messageIssues = useMemo(
    () =>
      result?.issues.filter((issue) => issue.messageRange).map((issue) => ({ ...issue, schemaRange: undefined })) ?? [],
    [result],
  );

  const runValidation = useCallback(async () => {
    const runId = validationRunId.current + 1;
    validationRunId.current = runId;

    if (!schemaText.trim() && !messageText.trim()) {
      setResult(null);
      setActiveIssueId(undefined);
      return;
    }

    setIsValidating(true);
    try {
      const nextResult = await validateRequest({
        schemaText,
        messageText,
        schemaFormat,
        messageFormat,
        relatedSchemas: schemaFormat === 'xsd' ? xsdSources : undefined,
      });
      if (runId !== validationRunId.current) {
        return;
      }
      setResult(nextResult);
      setActiveIssueId(nextResult.issues[0]?.id);
      setHistoryEntries((current) => addHistoryEntry(current, nextResult, currentSnapshot));
      setStatusMessage(`${nextResult.ok ? 'Passed' : 'Failed'} in ${Math.round(nextResult.durationMs)}ms.`);
    } finally {
      if (runId === validationRunId.current) {
        setIsValidating(false);
      }
    }
  }, [currentSnapshot, messageFormat, messageText, schemaFormat, schemaText, xsdSources]);

  const restoreSnapshot = useCallback((snapshot: WorkbenchSnapshot) => {
    setSchemaFormat(snapshot.schemaFormat);
    setMessageFormat(snapshot.messageFormat);
    setSchemaText(snapshot.schemaText);
    setMessageText(snapshot.messageText);
    setAutoValidate(snapshot.autoValidate);
    setSchemaTabId(snapshot.schemaTabId);
    setMessageTabId(snapshot.messageTabId);
    setSelectedXsdSourceId(snapshot.selectedXsdSourceId);
    setXsdSources(snapshot.xsdSources);
    setLayoutMode(snapshot.layoutMode);
    setTheme(snapshot.theme);
    setManualSchemaFormat(true);
    setSummaryRange(undefined);
    setActiveIssueId(undefined);
    setResult(null);
    xsdSourceCounter.current = snapshot.xsdSources.length;
  }, []);

  const handleSavePreset = useCallback(() => {
    const name = window.prompt('Preset name', selectedPresetId ? presets.find((preset) => preset.id === selectedPresetId)?.name : '');
    if (!name?.trim()) {
      return;
    }

    const trimmedName = name.trim();
    setPresets((current) => {
      const existing = current.find((preset) => preset.name.toLowerCase() === trimmedName.toLowerCase());
      if (existing) {
        setSelectedPresetId(existing.id);
        return current.map((preset) =>
          preset.id === existing.id ? { ...preset, updatedAt: new Date().toISOString(), snapshot: currentSnapshot } : preset,
        );
      }

      const preset = createPreset(trimmedName, currentSnapshot);
      setSelectedPresetId(preset.id);
      return [preset, ...current];
    });
    setStatusMessage(`Saved preset "${trimmedName}".`);
  }, [currentSnapshot, presets, selectedPresetId]);

  const handleLoadPreset = useCallback(() => {
    const preset = presets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      return;
    }
    restoreSnapshot(preset.snapshot);
    setStatusMessage(`Loaded preset "${preset.name}".`);
  }, [presets, restoreSnapshot, selectedPresetId]);

  const handleDeletePreset = useCallback(() => {
    const preset = presets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      return;
    }
    setPresets((current) => current.filter((item) => item.id !== preset.id));
    setSelectedPresetId('');
    setStatusMessage(`Deleted preset "${preset.name}".`);
  }, [presets, selectedPresetId]);

  const handleExportWorkspace = useCallback(() => {
    const blob = new Blob([buildWorkspaceExport(currentSnapshot, presets, historyEntries, result)], {
      type: 'application/json',
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = 'schema-validator-workspace.json';
    anchor.click();
    URL.revokeObjectURL(href);
    setStatusMessage('Workspace export downloaded.');
  }, [currentSnapshot, historyEntries, presets, result]);

  const handleShareWorkspace = useCallback(() => {
    const shareUrl = createShareUrl(currentSnapshot);
    if (shareUrl.length > 7000) {
      setStatusMessage('Workspace is too large for a reliable URL. Use Export instead.');
      return;
    }
    void navigator.clipboard.writeText(shareUrl);
    setStatusMessage('Share URL copied to clipboard.');
  }, [currentSnapshot]);

  const handleResetWorkspace = useCallback(() => {
    clearWorkspaceSnapshot();
    restoreSnapshot(getDefaultWorkbenchSnapshot());
    setStatusMessage('Workspace reset.');
  }, [restoreSnapshot]);

  const handleImportFile = useCallback((file: File) => {
    void file
      .text()
      .then((text) => {
        const bundle = parseWorkspaceImport(text);
        if (bundle.snapshot) {
          restoreSnapshot(bundle.snapshot);
        }
        if (bundle.presets?.length) {
          setPresets(bundle.presets);
        }
        if (bundle.history?.length) {
          setHistoryEntries(bundle.history);
        }
        setStatusMessage(`Imported ${file.name}.`);
      })
      .catch((error: unknown) => {
        setStatusMessage(error instanceof Error ? error.message : `Could not import ${file.name}.`);
      });
  }, [restoreSnapshot]);

  const restoreHistoryEntry = useCallback(
    (entry: ValidationHistoryEntry) => {
      restoreSnapshot(entry.snapshot);
      setResult(entry.result);
      setActiveIssueId(entry.result.issues[0]?.id);
      setStatusMessage(`Restored run from ${new Date(entry.createdAt).toLocaleTimeString()}.`);
    },
    [restoreSnapshot],
  );

  useEffect(() => {
    if (!autoValidate) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void runValidation();
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [autoValidate, runValidation]);

  useEffect(() => {
    saveWorkspaceSnapshot(currentSnapshot);
  }, [currentSnapshot]);

  useEffect(() => {
    savePresets(presets);
  }, [presets]);

  useEffect(() => {
    saveHistory(historyEntries);
  }, [historyEntries]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const commands = useMemo<CommandPaletteCommand[]>(
    () => [
      { id: 'validate', label: 'Validate Now', detail: 'Run the current schema/message validation.', shortcut: 'Ctrl+Enter', run: () => void runValidation() },
      { id: 'summary', label: 'Open Summary', detail: 'Switch the schema pane to the Summary tree.', shortcut: 'Alt+S', run: () => setSchemaTabId('summary') },
      { id: 'insights', label: 'Open Insights', detail: 'Show metrics, coverage, and comparison.', run: () => setSchemaTabId('insights') },
      { id: 'preview', label: 'Open Message Preview', detail: 'Render the message as a tree, table, or text preview.', run: () => setMessageTabId('preview') },
      { id: 'save-preset', label: 'Save Preset', detail: 'Save the current workspace as a named preset.', shortcut: 'Ctrl+Shift+S', run: handleSavePreset },
      { id: 'export', label: 'Export Workspace', detail: 'Download the workspace bundle as JSON.', shortcut: 'Ctrl+Shift+E', run: handleExportWorkspace },
      { id: 'share', label: 'Copy Share URL', detail: 'Copy a compact URL for the current workspace when possible.', run: handleShareWorkspace },
      { id: 'theme', label: 'Toggle Theme', detail: 'Switch light and dark mode.', run: () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')) },
      { id: 'layout', label: 'Restore Layout', detail: 'Return panes and diagnostics to normal layout.', run: () => setLayoutMode('normal') },
    ],
    [handleExportWorkspace, handleSavePreset, handleShareWorkspace, runValidation],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void runValidation();
      } else if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 's') {
        event.preventDefault();
        handleSavePreset();
      } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'e') {
        event.preventDefault();
        handleExportWorkspace();
      } else if (event.altKey && key === 's') {
        event.preventDefault();
        setSchemaTabId('summary');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleExportWorkspace, handleSavePreset, runValidation]);

  const handleSchemaTextChange = (nextText: string) => {
    const nextDetection = detectSchemaFormat(nextText);
    setSchemaText(nextText);
    setManualSchemaFormat(false);
    setSummaryRange(undefined);

    if (nextDetection.confidence === 'high' && nextDetection.format) {
      setSchemaFormat(nextDetection.format);
      const supportedMessages = supportedMessageFormatsForSchema(nextDetection.format);
      if (!supportedMessages.includes(messageFormat)) {
        setMessageFormat(supportedMessages[0]);
      }
    }
  };

  const handleSchemaFormatChange = (nextFormat: SchemaFormat) => {
    setManualSchemaFormat(true);
    setSchemaFormat(nextFormat);
    const supportedMessages = supportedMessageFormatsForSchema(nextFormat);
    if (!supportedMessages.includes(messageFormat)) {
      setMessageFormat(supportedMessages[0]);
    }
  };

  const handleMessageFormatChange = (nextFormat: MessageFormat) => {
    setMessageFormat(nextFormat);
  };

  const handleSummaryNodeSelect = (node: SchemaSummaryNode) => {
    if (!node.sourceRange) {
      return;
    }

    setActiveIssueId(undefined);
    setSummaryRange(node.sourceRange);
    setSchemaTabId('editor');
  };

  const handleIssueSelect = (issue: ValidationIssue) => {
    setSummaryRange(undefined);
    setActiveIssueId(issue.id);
    if (issue.schemaSourceId && issue.schemaSourceId !== PRIMARY_SCHEMA_SOURCE_ID) {
      setSelectedXsdSourceId(issue.schemaSourceId);
      setSchemaTabId('sources');
    } else if (issue.schemaRange) {
      setSchemaTabId('editor');
    }
  };

  const handleAddXsdSource = (source: Omit<RelatedSchemaDocument, 'id'>) => {
    const nextId = `xsd-source-${xsdSourceCounter.current + 1}`;
    xsdSourceCounter.current += 1;
    const nextSource = { ...source, id: nextId };
    setXsdSources((current) => [...current, nextSource]);
    setSelectedXsdSourceId(nextId);
    setSchemaTabId('sources');
  };

  const handleUpdateXsdSource = (sourceId: string, patch: Partial<Omit<RelatedSchemaDocument, 'id'>>) => {
    setXsdSources((current) => current.map((source) => (source.id === sourceId ? { ...source, ...patch } : source)));
  };

  const handleRemoveXsdSource = (sourceId: string) => {
    setXsdSources((current) => {
      const nextSources = current.filter((source) => source.id !== sourceId);
      if (selectedXsdSourceId === sourceId) {
        setSelectedXsdSourceId(nextSources[0]?.id);
      }
      return nextSources;
    });
  };

  const detectionLabel = manualSchemaFormat
    ? `Manual: ${formatLabel(schemaFormat)}`
    : schemaDetection.format
      ? `Detected: ${formatLabel(schemaDetection.format)}`
      : 'No schema detected';
  const primarySchemaIssueActive =
    !activeIssue?.schemaSourceId || activeIssue.schemaSourceId === PRIMARY_SCHEMA_SOURCE_ID;
  const schemaActiveRange = (primarySchemaIssueActive ? activeIssue?.schemaRange : undefined) ?? summaryRange;
  const selectedSourceActiveRange = !primarySchemaIssueActive ? activeIssue?.schemaRange : undefined;
  const editorTheme = theme === 'dark' ? 'vs-dark' : 'vs';
  const schemaTabs = [
    { id: 'editor', label: 'Editor' },
    {
      id: 'summary',
      label: 'Summary',
      content: <SchemaSummaryTree summary={schemaSummary} onNodeSelect={handleSummaryNodeSelect} />,
    },
    {
      id: 'insights',
      label: 'Insights',
      content: (
        <SchemaInsightsPanel
          metrics={schemaMetrics}
          coverage={coverageReport}
          diff={summaryDiff}
          hasBaseline={Boolean(summaryBaseline)}
          onSaveBaseline={() => {
            setSummaryBaseline(schemaSummary);
            setStatusMessage('Schema comparison baseline saved.');
          }}
          onClearBaseline={() => {
            setSummaryBaseline(undefined);
            setStatusMessage('Schema comparison baseline cleared.');
          }}
        />
      ),
    },
    ...(schemaFormat === 'xsd'
      ? [
          {
            id: 'sources',
            label: 'Sources',
            content: (
              <SchemaSourcesPanel
                schemaText={schemaText}
                sources={xsdSources}
                selectedSourceId={selectedXsdSourceId}
                issues={xsdSourceIssues}
                activeRange={selectedSourceActiveRange}
                onAddSource={handleAddXsdSource}
                onUpdateSource={handleUpdateXsdSource}
                onRemoveSource={handleRemoveXsdSource}
                onSelectSource={setSelectedXsdSourceId}
              />
            ),
          },
        ]
      : []),
  ];
  const messageTabs = [
    { id: 'editor', label: 'Editor' },
    { id: 'preview', label: 'Preview', content: <MessagePreviewPanel preview={messagePreview} /> },
  ];

  return (
    <main className={`app-shell layout-${layoutMode}`}>
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h1>Schema Validator Workbench</h1>
            <p>
              {formatLabel(schemaFormat)} schema against {formatLabel(messageFormat)} message
            </p>
          </div>
        </div>

        <div className="topbar-actions">
          <button type="button" className="icon-button" title="Command palette" onClick={() => setCommandPaletteOpen(true)}>
            <Command aria-hidden="true" size={16} />
            <span className="sr-only">Command palette</span>
          </button>
          <button
            type="button"
            className="icon-button"
            title={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
            <span className="sr-only">Toggle theme</span>
          </button>
          <label className="toggle-control">
            <input type="checkbox" checked={autoValidate} onChange={(event) => setAutoValidate(event.target.checked)} />
            <Zap aria-hidden="true" size={15} />
            Auto
          </label>
          <button type="button" className="primary-button" onClick={() => void runValidation()} disabled={isValidating}>
            <Play aria-hidden="true" size={16} />
            {isValidating ? 'Validating' : 'Validate'}
          </button>
        </div>
      </header>

      <section className="control-row" aria-label="Validation controls">
        <FormatSelector
          schemaFormat={schemaFormat}
          messageFormat={messageFormat}
          onSchemaFormatChange={handleSchemaFormatChange}
          onMessageFormatChange={handleMessageFormatChange}
        />
        <div className="status-group">
          <div
            className={`detection-pill ${schemaDetection.format ? 'is-detected' : 'is-empty'}`}
            title={schemaDetection.reason}
          >
            {detectionLabel}
          </div>
          <div className={`pair-status ${supportedPair ? 'is-supported' : 'is-unsupported'}`}>
            {supportedPair ? 'Supported pair' : 'Unsupported pair'}
          </div>
        </div>
      </section>

      <section className="power-row" aria-label="Workspace power tools">
        <div className="preset-tools">
          <label className="field-label compact-field">
            <span>Preset</span>
            <select value={selectedPresetId} onChange={(event) => setSelectedPresetId(event.target.value)}>
              <option value="">Current workspace</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary-button" onClick={handleSavePreset}>
            <Save aria-hidden="true" size={15} />
            Save
          </button>
          <button type="button" className="secondary-button" disabled={!selectedPresetId} onClick={handleLoadPreset}>
            <FolderOpen aria-hidden="true" size={15} />
            Load
          </button>
          <button type="button" className="secondary-button danger-button" disabled={!selectedPresetId} onClick={handleDeletePreset}>
            Delete
          </button>
        </div>
        <div className="workspace-tools">
          <button type="button" className="secondary-button" onClick={handleExportWorkspace}>
            <Download aria-hidden="true" size={15} />
            Export
          </button>
          <button type="button" className="secondary-button" onClick={() => importInputRef.current?.click()}>
            <Upload aria-hidden="true" size={15} />
            Import
          </button>
          <button type="button" className="secondary-button" onClick={handleShareWorkspace}>
            <Share2 aria-hidden="true" size={15} />
            Share
          </button>
          <button type="button" className="secondary-button danger-button" onClick={handleResetWorkspace}>
            <RotateCcw aria-hidden="true" size={15} />
            Reset
          </button>
          <input
            ref={importInputRef}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const input = event.currentTarget;
              const file = event.target.files?.[0];
              if (file) {
                handleImportFile(file);
              }
              input.value = '';
            }}
          />
        </div>
        <div className="layout-tools" aria-label="Layout controls">
          <button type="button" className="icon-button" title="Normal layout" onClick={() => setLayoutMode('normal')}>
            <PanelRightOpen aria-hidden="true" size={15} />
            <span className="sr-only">Normal layout</span>
          </button>
          <button type="button" className="icon-button" title="Schema focus" onClick={() => setLayoutMode('schema-focus')}>
            S
          </button>
          <button type="button" className="icon-button" title="Message focus" onClick={() => setLayoutMode('message-focus')}>
            M
          </button>
          <button type="button" className="icon-button" title="Hide diagnostics" onClick={() => setLayoutMode('no-diagnostics')}>
            <PanelRightClose aria-hidden="true" size={15} />
            <span className="sr-only">Hide diagnostics</span>
          </button>
        </div>
        <p className="workspace-status" role="status">{statusMessage}</p>
      </section>

      <section className="capability-strip" aria-label="Format capabilities">
        {capabilityFacts.map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
      </section>

      <section className="workspace-grid">
        <div className="editor-grid">
          <EditorPane
            title="Schema"
            language={languageForSchema(schemaFormat)}
            value={schemaText}
            issues={schemaIssues}
            activeRange={schemaActiveRange}
            onChange={handleSchemaTextChange}
            editorTheme={editorTheme}
            headingMeta={
              <span className="pane-meta">
                {schemaSummary.stats.nodes} summary nodes
                {schemaFormat === 'xsd' ? ` / ${xsdSources.length} sources` : ''}
              </span>
            }
            tabs={schemaTabs}
            activeTabId={schemaTabId}
            onTabChange={setSchemaTabId}
          />
          <EditorPane
            title="Message"
            language={languageForMessage(messageFormat)}
            value={messageText}
            issues={messageIssues}
            activeRange={activeIssue?.messageRange}
            onChange={setMessageText}
            editorTheme={editorTheme}
            tabs={messageTabs}
            activeTabId={messageTabId}
            onTabChange={setMessageTabId}
          />
        </div>
        <DiagnosticsPanel result={result} activeIssueId={activeIssueId} onIssueSelect={handleIssueSelect} />
      </section>
      <section className="history-dock" aria-label="Validation history">
        <div className="history-heading">
          <History aria-hidden="true" size={15} />
          <strong>History</strong>
          <span>{historyEntries.length} runs</span>
        </div>
        <div className="history-list">
          {historyEntries.length === 0 ? <span>No validation runs yet.</span> : null}
          {historyEntries.slice(0, 8).map((entry) => (
            <button key={entry.id} type="button" className="history-item" onClick={() => restoreHistoryEntry(entry)}>
              <strong>{entry.result.ok ? 'Pass' : 'Fail'}</strong>
              <span>{new Date(entry.createdAt).toLocaleTimeString()}</span>
              <span>{entry.result.issues.length} issues</span>
            </button>
          ))}
        </div>
      </section>
      <CommandPalette open={commandPaletteOpen} commands={commands} onClose={() => setCommandPaletteOpen(false)} />
    </main>
  );
}

const languageForSchema = (format: SchemaFormat) => {
  const option = schemaFormatOptions.find((item) => item.value === format);
  return monacoLanguage(option?.language ?? 'plaintext');
};

const languageForMessage = (format: MessageFormat) => {
  const option = messageFormatOptions.find((item) => item.value === format);
  return monacoLanguage(option?.language ?? 'plaintext');
};

const monacoLanguage = (language: string) => {
  if (['json', 'yaml', 'xml', 'graphql'].includes(language)) {
    return language;
  }

  if (language === 'ini') {
    return 'ini';
  }

  return 'plaintext';
};
