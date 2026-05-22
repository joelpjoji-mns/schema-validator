import Editor, { type OnMount } from '@monaco-editor/react';
import { FileUp } from 'lucide-react';
import type { editor, IRange } from 'monaco-editor';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TextRange, ValidationIssue } from '../validation/types';

export interface EditorPaneTab {
  id: string;
  label: string;
  content?: ReactNode;
}

interface EditorPaneProps {
  title: string;
  language: string;
  value: string;
  issues: ValidationIssue[];
  activeRange?: TextRange;
  onChange: (value: string) => void;
  headingMeta?: ReactNode;
  tabs?: EditorPaneTab[];
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
}

export function EditorPane({
  title,
  language,
  value,
  issues,
  activeRange,
  onChange,
  headingMeta,
  tabs,
  activeTabId = 'editor',
  onTabChange,
}: EditorPaneProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadError, setUploadError] = useState<string>();
  const activeTab = tabs?.find((tab) => tab.id === activeTabId);

  const handleMount: OnMount = (mountedEditor, monaco) => {
    editorRef.current = mountedEditor;
    monacoRef.current = monaco;
    decorationsRef.current = mountedEditor.createDecorationsCollection();
  };

  useEffect(() => {
    const monaco = monacoRef.current;
    const mountedEditor = editorRef.current;
    const model = mountedEditor?.getModel();
    if (!monaco || !mountedEditor || !model) {
      return;
    }

    const markers: editor.IMarkerData[] = issues
      .filter((issue) => issue.severity !== 'info')
      .flatMap((issue): editor.IMarkerData[] => {
        const range = issue.messageRange ?? issue.schemaRange;
        if (!range) {
          return [];
        }

        return [
          {
            ...range,
            severity: issue.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
            message: `${issue.title}: ${issue.message}`,
            code: issue.code,
          },
        ];
      });

    monaco.editor.setModelMarkers(model, `schema-validator-${title}`, markers);

    decorationsRef.current?.set(
      issues
        .map((issue) => issue.messageRange ?? issue.schemaRange)
        .filter((range): range is TextRange => Boolean(range))
        .map((range) => ({
          range: range as IRange,
          options: {
            className: 'editor-issue-line',
            inlineClassName: 'editor-issue-inline',
            minimap: { color: '#dc2626', position: monaco.editor.MinimapPosition.Inline },
            overviewRuler: { color: '#dc2626', position: monaco.editor.OverviewRulerLane.Right },
          },
        })),
    );
  }, [issues, title]);

  useEffect(() => {
    const mountedEditor = editorRef.current;
    if (!activeRange || !mountedEditor) {
      return;
    }

    mountedEditor.revealRangeInCenter(activeRange as IRange);
    mountedEditor.setPosition({ lineNumber: activeRange.startLineNumber, column: activeRange.startColumn });
    mountedEditor.focus();
  }, [activeRange]);

  return (
    <section className="editor-pane" aria-label={title}>
      <div className="pane-heading">
        <div>
          <h2>{title}</h2>
          <p>
            {issues.length === 0
              ? 'No highlighted issues'
              : `${issues.length} highlighted issue${issues.length === 1 ? '' : 's'}`}
          </p>
          {headingMeta}
        </div>
        <div className="pane-heading-actions">
          <button
            type="button"
            className="icon-button"
            title={`Upload ${title.toLowerCase()}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp aria-hidden="true" size={17} />
            <span className="sr-only">Upload {title}</span>
          </button>
        </div>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          onChange={(event) => {
            const input = event.currentTarget;
            const file = event.target.files?.[0];
            if (!file) {
              return;
            }
            setUploadError(undefined);
            void file
              .text()
              .then(onChange)
              .catch(() => setUploadError(`Could not read ${file.name}.`))
              .finally(() => {
                input.value = '';
              });
          }}
        />
      </div>
      {uploadError ? <div className="pane-upload-error">{uploadError}</div> : null}
      {tabs ? (
        <div className="pane-tabs" role="tablist" aria-label={`${title} views`}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTabId === tab.id}
              className={`pane-tab ${activeTabId === tab.id ? 'is-active' : ''}`}
              onClick={() => onTabChange?.(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}
      {activeTabId === 'editor' ? (
        <div className="editor-frame">
          <Editor
            height="100%"
            language={language}
            value={value}
            theme="vs"
            onMount={handleMount}
            onChange={(nextValue) => onChange(nextValue ?? '')}
            options={{
              automaticLayout: true,
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              fontSize: 13,
              lineNumbersMinChars: 3,
              folding: true,
              wordWrap: 'on',
              wrappingIndent: 'same',
              renderLineHighlight: 'gutter',
              fixedOverflowWidgets: true,
              tabSize: 2,
            }}
          />
        </div>
      ) : (
        <div className="summary-frame">{activeTab?.content}</div>
      )}
    </section>
  );
}
