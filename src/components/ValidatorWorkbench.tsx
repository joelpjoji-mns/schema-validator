import { Play, ShieldCheck, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { defaultSample, type ValidationSample } from '../fixtures/samples';
import { isSupportedFormatPair, supportedMessageFormatsForSchema, validateRequest } from '../validation/registry';
import {
    formatLabel,
    messageFormatOptions,
    schemaFormatOptions,
    type MessageFormat,
    type SchemaFormat,
    type ValidationIssue,
    type ValidationResult,
} from '../validation/types';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { EditorPane } from './EditorPane';
import { FormatSelector } from './FormatSelector';
import { SampleLibrary } from './SampleLibrary';

export function ValidatorWorkbench() {
  const [schemaFormat, setSchemaFormat] = useState<SchemaFormat>(defaultSample.schemaFormat);
  const [messageFormat, setMessageFormat] = useState<MessageFormat>(defaultSample.messageFormat);
  const [schemaText, setSchemaText] = useState(defaultSample.schemaText);
  const [messageText, setMessageText] = useState(defaultSample.messageText);
  const [activeSampleId, setActiveSampleId] = useState(defaultSample.id);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [activeIssueId, setActiveIssueId] = useState<string>();
  const [autoValidate, setAutoValidate] = useState(true);
  const [isValidating, setIsValidating] = useState(false);

  const supportedPair = isSupportedFormatPair(schemaFormat, messageFormat);
  const activeIssue = result?.issues.find((issue) => issue.id === activeIssueId);

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
    setIsValidating(true);
    try {
      const nextResult = await validateRequest({ schemaText, messageText, schemaFormat, messageFormat });
      setResult(nextResult);
      setActiveIssueId(nextResult.issues[0]?.id);
    } finally {
      setIsValidating(false);
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

  const loadSample = (sample: ValidationSample) => {
    setActiveSampleId(sample.id);
    setSchemaFormat(sample.schemaFormat);
    setMessageFormat(sample.messageFormat);
    setSchemaText(sample.schemaText);
    setMessageText(sample.messageText);
    setActiveIssueId(undefined);
  };

  const handleSchemaFormatChange = (nextFormat: SchemaFormat) => {
    setSchemaFormat(nextFormat);
    const supportedMessages = supportedMessageFormatsForSchema(nextFormat);
    if (!supportedMessages.includes(messageFormat)) {
      setMessageFormat(supportedMessages[0]);
    }
  };

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
          <SampleLibrary activeSampleId={activeSampleId} onSampleSelect={loadSample} />
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
          onMessageFormatChange={setMessageFormat}
        />
        <div className={`pair-status ${supportedPair ? 'is-supported' : 'is-unsupported'}`}>
          {supportedPair ? 'Supported pair' : 'Unsupported pair'}
        </div>
      </section>

      <section className="workspace-grid">
        <div className="editor-grid">
          <EditorPane
            title="Schema"
            language={languageForSchema(schemaFormat)}
            value={schemaText}
            issues={schemaIssues}
            activeRange={activeIssue?.schemaRange}
            onChange={setSchemaText}
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
        <DiagnosticsPanel
          result={result}
          activeIssueId={activeIssueId}
          onIssueSelect={(issue: ValidationIssue) => setActiveIssueId(issue.id)}
        />
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
