import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface CommandPaletteCommand {
  id: string;
  label: string;
  detail: string;
  shortcut?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  commands: CommandPaletteCommand[];
  onClose: () => void;
}

export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const visibleCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return commands;
    }

    return commands.filter((command) =>
      `${command.label} ${command.detail} ${command.shortcut ?? ''}`.toLowerCase().includes(normalized),
    );
  }, [commands, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const timeout = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="command-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-search">
          <Search aria-hidden="true" size={17} />
          <input
            ref={inputRef}
            value={query}
            aria-label="Search commands"
            placeholder="Search commands"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className="icon-button" title="Close command palette" onClick={onClose}>
            <X aria-hidden="true" size={16} />
            <span className="sr-only">Close command palette</span>
          </button>
        </div>
        <div className="command-list" role="listbox">
          {visibleCommands.length === 0 ? <div className="command-empty">No commands match.</div> : null}
          {visibleCommands.map((command) => (
            <button
              key={command.id}
              type="button"
              className="command-item"
              onClick={() => {
                command.run();
                onClose();
              }}
            >
              <span>
                <strong>{command.label}</strong>
                <small>{command.detail}</small>
              </span>
              {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
