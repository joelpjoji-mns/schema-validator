import { supportedMessageFormatsForSchema } from '../validation/registry';
import type { MessageFormat, SchemaFormat } from '../validation/types';
import { messageFormatOptions, schemaFormatOptions } from '../validation/types';

interface FormatSelectorProps {
  schemaFormat: SchemaFormat;
  messageFormat: MessageFormat;
  onSchemaFormatChange: (format: SchemaFormat) => void;
  onMessageFormatChange: (format: MessageFormat) => void;
}

export function FormatSelector({
  schemaFormat,
  messageFormat,
  onSchemaFormatChange,
  onMessageFormatChange,
}: FormatSelectorProps) {
  const supportedMessages = supportedMessageFormatsForSchema(schemaFormat);

  return (
    <div className="format-grid" aria-label="Validation formats">
      <label className="field-label">
        <span>Schema</span>
        <select value={schemaFormat} onChange={(event) => onSchemaFormatChange(event.target.value as SchemaFormat)}>
          {schemaFormatOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field-label">
        <span>Message</span>
        <select value={messageFormat} onChange={(event) => onMessageFormatChange(event.target.value as MessageFormat)}>
          {messageFormatOptions.map((option) => (
            <option key={option.value} value={option.value} disabled={!supportedMessages.includes(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
