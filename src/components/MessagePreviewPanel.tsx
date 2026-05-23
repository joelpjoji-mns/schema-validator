import type { MessagePreview } from './workbenchPowerTools';

interface MessagePreviewPanelProps {
  preview: MessagePreview;
}

export function MessagePreviewPanel({ preview }: MessagePreviewPanelProps) {
  return (
    <div className="message-preview" aria-label="Message preview">
      <div className={`preview-banner ${preview.ok ? 'is-ok' : 'is-error'}`}>
        <strong>{preview.title}</strong>
        <span>{preview.details}</span>
      </div>

      {preview.mode === 'table' && preview.table ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <tbody>
              {preview.table.map((row, rowIndex) => (
                <tr key={`${rowIndex}-${row.join('|')}`}>
                  {row.map((cell, cellIndex) =>
                    rowIndex === 0 ? (
                      <th key={`${cellIndex}-${cell}`}>{cell || '(blank)'}</th>
                    ) : (
                      <td key={`${cellIndex}-${cell}`}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="preview-code">{preview.content ?? preview.details}</pre>
      )}
    </div>
  );
}
