import Editor, { type OnMount } from '@monaco-editor/react';
import { FilePlus2, FileUp, Trash2 } from 'lucide-react';
import type { editor, IRange } from 'monaco-editor';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RelatedSchemaDocument, TextRange, ValidationIssue } from '../validation/types';

interface SchemaSourcesPanelProps {
  schemaText: string;
  sources: RelatedSchemaDocument[];
  selectedSourceId?: string;
  issues: ValidationIssue[];
  activeRange?: TextRange;
  onAddSource: (source: Omit<RelatedSchemaDocument, 'id'>) => void;
  onUpdateSource: (sourceId: string, patch: Partial<Omit<RelatedSchemaDocument, 'id'>>) => void;
  onRemoveSource: (sourceId: string) => void;
  onSelectSource: (sourceId: string) => void;
}

interface XsdReferenceSummary {
  kind: 'include' | 'import';
  schemaLocation?: string;
  namespace?: string;
  resolved: boolean;
}

export function SchemaSourcesPanel({
  schemaText,
  sources,
  selectedSourceId,
  issues,
  activeRange,
  onAddSource,
  onUpdateSource,
  onRemoveSource,
  onSelectSource,
}: SchemaSourcesPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const [uploadError, setUploadError] = useState<string>();
  const selectedSource = sources.find((source) => source.id === selectedSourceId) ?? sources[0];
  const selectedIssues = useMemo(
    () => (selectedSource ? issues.filter((issue) => issue.schemaSourceId === selectedSource.id) : []),
    [issues, selectedSource],
  );
  const references = useMemo(() => detectXsdReferences(schemaText, sources), [schemaText, sources]);

  const handleMount: OnMount = (mountedEditor, monaco) => {
    editorRef.current = mountedEditor;
    monacoRef.current = monaco;
    decorationsRef.current = mountedEditor.createDecorationsCollection();
  };

  useEffect(() => {
    if (selectedSource && selectedSource.id !== selectedSourceId) {
      onSelectSource(selectedSource.id);
    }
  }, [onSelectSource, selectedSource, selectedSourceId]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const mountedEditor = editorRef.current;
    const model = mountedEditor?.getModel();
    if (!monaco || !mountedEditor || !model) {
      return;
    }

    const markers: editor.IMarkerData[] = selectedIssues
      .filter((issue) => issue.schemaRange && issue.severity !== 'info')
      .map((issue) => ({
        ...(issue.schemaRange as TextRange),
        severity: issue.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
        message: `${issue.title}: ${issue.message}`,
        code: issue.code,
      }));

    monaco.editor.setModelMarkers(model, `schema-validator-source-${selectedSource?.id ?? 'none'}`, markers);
    decorationsRef.current?.set(
      selectedIssues
        .map((issue) => issue.schemaRange)
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
  }, [selectedIssues, selectedSource?.id]);

  useEffect(() => {
    const mountedEditor = editorRef.current;
    if (!activeRange || !mountedEditor) {
      return;
    }

    mountedEditor.revealRangeInCenter(activeRange as IRange);
    mountedEditor.setPosition({ lineNumber: activeRange.startLineNumber, column: activeRange.startColumn });
    mountedEditor.focus();
  }, [activeRange]);

  const addBlankSource = () => {
    const index = sources.length + 1;
    onAddSource({
      label: `source-${index}.xsd`,
      schemaLocation: `source-${index}.xsd`,
      text: '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\n</xs:schema>',
    });
  };

  const addSourceForReference = (reference: XsdReferenceSummary) => {
    onAddSource({
      label: labelForReference(reference),
      schemaLocation: reference.schemaLocation,
      namespace: reference.namespace,
      text: skeletonForReference(reference),
    });
  };

  return (
    <div className="schema-sources">
      <div className="sources-toolbar">
        <div className="sources-stats">
          <strong>
            {sources.length} source{sources.length === 1 ? '' : 's'}
          </strong>
          <span>{references.filter((reference) => reference.resolved).length} resolved</span>
          <span>{references.filter((reference) => !reference.resolved).length} missing</span>
        </div>
        <div className="sources-actions">
          <button type="button" className="secondary-button" onClick={addBlankSource}>
            <FilePlus2 aria-hidden="true" size={15} />
            Add XSD
          </button>
          <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()}>
            <FileUp aria-hidden="true" size={15} />
            Upload XSD
          </button>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept=".xsd,.xml,text/xml,application/xml"
            onChange={(event) => {
              const input = event.currentTarget;
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              setUploadError(undefined);
              void file
                .text()
                .then((text) => {
                  onAddSource({ label: file.name, schemaLocation: file.name, text });
                })
                .catch(() => setUploadError(`Could not read ${file.name}.`))
                .finally(() => {
                  input.value = '';
                });
            }}
          />
        </div>
      </div>

      {uploadError ? <div className="pane-upload-error">{uploadError}</div> : null}

      <div className="sources-layout">
        <aside className="sources-sidebar" aria-label="XSD source browser">
          <div className="sources-section-title">References</div>
          <div className="sources-reference-list" role="list">
            {references.length === 0 ? <div className="sources-empty">No include or import references.</div> : null}
            {references.map((reference, index) => {
              const referenceName = reference.schemaLocation ?? reference.namespace ?? 'unnamed reference';
              return (
                <div
                  key={`${reference.kind}-${referenceName}-${index}`}
                  className="source-reference"
                  role="listitem"
                >
                  <span className={`source-status ${reference.resolved ? 'is-resolved' : 'is-missing'}`}>
                    {reference.resolved ? 'Resolved' : 'Missing'}
                  </span>
                  <div className="source-reference-body">
                    <strong>{reference.kind}</strong>
                    <span>{referenceName}</span>
                  </div>
                  {!reference.resolved ? (
                    <button
                      type="button"
                      className="icon-button source-reference-add"
                      title={`Add ${reference.kind} source`}
                      aria-label={`Add missing ${reference.kind} source ${referenceName}`}
                      onClick={() => addSourceForReference(reference)}
                    >
                      <FilePlus2 aria-hidden="true" size={14} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="sources-section-title">Sources</div>
          <div className="source-list" role="list">
            {sources.length === 0 ? <div className="sources-empty">Add or upload an XSD source.</div> : null}
            {sources.map((source) => {
              const issueCount = issues.filter((issue) => issue.schemaSourceId === source.id).length;
              return (
                <button
                  key={source.id}
                  type="button"
                  className={`source-list-item ${selectedSource?.id === source.id ? 'is-active' : ''}`}
                  onClick={() => onSelectSource(source.id)}
                >
                  <span>
                    <strong>{source.label}</strong>
                    <span>{source.schemaLocation || source.namespace || 'No location'}</span>
                  </span>
                  {issueCount > 0 ? <em>{issueCount}</em> : null}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="source-editor-panel" aria-label="Selected XSD source">
          {selectedSource ? (
            <>
              <div className="source-fields">
                <label>
                  <span>Name</span>
                  <input
                    value={selectedSource.label}
                    onChange={(event) => onUpdateSource(selectedSource.id, { label: event.target.value })}
                  />
                </label>
                <label>
                  <span>schemaLocation</span>
                  <input
                    value={selectedSource.schemaLocation ?? ''}
                    onChange={(event) => onUpdateSource(selectedSource.id, { schemaLocation: event.target.value })}
                  />
                </label>
                <label>
                  <span>Namespace</span>
                  <input
                    value={selectedSource.namespace ?? ''}
                    onChange={(event) => onUpdateSource(selectedSource.id, { namespace: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="icon-button danger-button"
                  title="Remove source"
                  onClick={() => onRemoveSource(selectedSource.id)}
                >
                  <Trash2 aria-hidden="true" size={16} />
                  <span className="sr-only">Remove source</span>
                </button>
              </div>
              <div className="source-editor-frame">
                <Editor
                  height="100%"
                  language="xml"
                  value={selectedSource.text}
                  theme="vs"
                  onMount={handleMount}
                  onChange={(nextValue) => onUpdateSource(selectedSource.id, { text: nextValue ?? '' })}
                  options={{
                    automaticLayout: true,
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                    lineNumbersMinChars: 3,
                    folding: true,
                    wordWrap: 'on',
                    renderLineHighlight: 'gutter',
                    fixedOverflowWidgets: true,
                    tabSize: 2,
                  }}
                />
              </div>
            </>
          ) : (
            <div className="sources-empty source-editor-empty">No source selected.</div>
          )}
        </section>
      </div>
    </div>
  );
}

const detectXsdReferences = (schemaText: string, sources: RelatedSchemaDocument[]): XsdReferenceSummary[] => {
  const references: XsdReferenceSummary[] = [];
  const pattern = /<(?:(?:[A-Za-z_][\w.-]*):)?(include|import)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(schemaText))) {
    const kind = match[1] === 'include' ? 'include' : 'import';
    const attributes = match[2] ?? '';
    const schemaLocation = readXmlAttribute(attributes, 'schemaLocation');
    const namespace = readXmlAttribute(attributes, 'namespace');
    references.push({
      kind,
      schemaLocation,
      namespace,
      resolved: sources.some((source) => sourceMatchesReference(source, schemaLocation, namespace)),
    });
  }

  return references;
};

const sourceMatchesReference = (source: RelatedSchemaDocument, schemaLocation?: string, namespace?: string) => {
  if (namespace && source.namespace === namespace) {
    return true;
  }

  if (!schemaLocation) {
    return false;
  }

  const expected = normalizeLocation(schemaLocation);
  const expectedBase = basename(expected);
  return [source.schemaLocation, source.label, source.id]
    .filter(Boolean)
    .map((value) => normalizeLocation(String(value)))
    .some((candidate) => candidate === expected || basename(candidate) === expectedBase);
};

const readXmlAttribute = (text: string, name: string) => {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(text);
  return match?.[1];
};

const labelForReference = (reference: XsdReferenceSummary) => {
  if (reference.schemaLocation) {
    return rawBasename(reference.schemaLocation) || reference.schemaLocation;
  }

  if (reference.namespace) {
    return `${slugReference(reference.namespace)}.xsd`;
  }

  return `${reference.kind}-source.xsd`;
};

const skeletonForReference = (reference: XsdReferenceSummary) => {
  if (!reference.namespace) {
    return '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\n</xs:schema>';
  }

  return `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="${escapeXmlAttribute(reference.namespace)}" elementFormDefault="qualified">\n</xs:schema>`;
};

const rawBasename = (value: string) => value.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? value;

const slugReference = (value: string) => {
  const slug = value
    .replace(/^https?:\/\//i, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug || 'imported-schema';
};

const escapeXmlAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const normalizeLocation = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '').trim().toLowerCase();
const basename = (value: string) =>
  normalizeLocation(value).split('/').filter(Boolean).at(-1) ?? normalizeLocation(value);
