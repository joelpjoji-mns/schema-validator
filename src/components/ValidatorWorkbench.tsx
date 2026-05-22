import { Play, ShieldCheck, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { introspectSchema, type SchemaSummaryNode } from '../validation/introspection';
import { isSupportedFormatPair, supportedMessageFormatsForSchema, validateRequest } from '../validation/registry';
import { detectSchemaFormat } from '../validation/schemaDetection';
import {
    formatLabel,
    messageFormatOptions,
    schemaFormatOptions,
    type MessageFormat,
    type SchemaFormat,
    type TextRange,
    type ValidationIssue,
    type ValidationResult,
} from '../validation/types';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { EditorPane } from './EditorPane';
import { FormatSelector } from './FormatSelector';
import { SchemaSummaryTree } from './SchemaSummaryTree';

export function ValidatorWorkbench() {
  const [schemaFormat, setSchemaFormat] = useState<SchemaFormat>('json-schema');
  const [messageFormat, setMessageFormat] = useState<MessageFormat>('json');
  const [schemaText, setSchemaText] = useState('');
  const [messageText, setMessageText] = useState('');
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [activeIssueId, setActiveIssueId] = useState<string>();
  const [autoValidate, setAutoValidate] = useState(true);
  const [isValidating, setIsValidating] = useState(false);
  const [schemaTabId, setSchemaTabId] = useState('editor');
  const [manualSchemaFormat, setManualSchemaFormat] = useState(false);
  const [summaryRange, setSummaryRange] = useState<TextRange>();
  const validationRunId = useRef(0);

  const supportedPair = isSupportedFormatPair(schemaFormat, messageFormat);
  const activeIssue = result?.issues.find((issue) => issue.id === activeIssueId);
  const schemaDetection = useMemo(() => detectSchemaFormat(schemaText), [schemaText]);
  const schemaSummary = useMemo(() => introspectSchema({ schemaText, schemaFormat }), [schemaFormat, schemaText]);

  const schemaIssues = useMemo(
    () =>
      result?.issues.filter((issue) => issue.schemaRange).map((issue) => ({ ...issue, messageRange: undefined })) ?? [],
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
      const nextResult = await validateRequest({ schemaText, messageText, schemaFormat, messageFormat });
      if (runId !== validationRunId.current) {
        return;
      }
      setResult(nextResult);
      setActiveIssueId(nextResult.issues[0]?.id);
    } finally {
      if (runId === validationRunId.current) {
        setIsValidating(false);
      }
    }
  }, [messageFormat, messageText, schemaFormat, schemaText]);

  useEffect(() => {
    if (!autoValidate) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void runValidation();
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [autoValidate, runValidation]);

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
  };

  const detectionLabel = manualSchemaFormat
    ? `Manual: ${formatLabel(schemaFormat)}`
    : schemaDetection.format
      ? `Detected: ${formatLabel(schemaDetection.format)}`
      : 'No schema detected';
  const schemaActiveRange = activeIssue?.schemaRange ?? summaryRange;

  return (
    <main className="app-shell">
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

      <section className="workspace-grid">
        <div className="editor-grid">
          <EditorPane
            title="Schema"
            language={languageForSchema(schemaFormat)}
            value={schemaText}
            issues={schemaIssues}
            activeRange={schemaActiveRange}
            onChange={handleSchemaTextChange}
            headingMeta={<span className="pane-meta">{schemaSummary.stats.nodes} summary nodes</span>}
            tabs={[
              { id: 'editor', label: 'Editor' },
              {
                id: 'summary',
                label: 'Summary',
                content: <SchemaSummaryTree summary={schemaSummary} onNodeSelect={handleSummaryNodeSelect} />,
              },
            ]}
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
          />
        </div>
        <DiagnosticsPanel result={result} activeIssueId={activeIssueId} onIssueSelect={handleIssueSelect} />
      </section>
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
