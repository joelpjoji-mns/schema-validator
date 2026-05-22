import { jsonSchemaAdapter, tomlSchemaAdapter } from './adapters/jsonSchema';
import {
    avroAdapter,
    csvTableSchemaAdapter,
    graphqlAdapter,
    keyValueRulesAdapter,
    openApiAdapter,
    protobufAdapter,
} from './adapters/topFormats';
import { xmlXsdAdapter } from './adapters/xmlXsd';
import { makeIssue, summarizeIssues, wholeDocumentRange } from './textRanges';
import type { MessageFormat, SchemaFormat, ValidationRequest, ValidationResult, ValidatorAdapter } from './types';

export const validators: ValidatorAdapter[] = [
  jsonSchemaAdapter,
  tomlSchemaAdapter,
  xmlXsdAdapter,
  openApiAdapter,
  graphqlAdapter,
  protobufAdapter,
  avroAdapter,
  csvTableSchemaAdapter,
  keyValueRulesAdapter,
];

export const getValidator = (schemaFormat: SchemaFormat, messageFormat: MessageFormat) =>
  validators.find(
    (validator) => validator.schemaFormats.includes(schemaFormat) && validator.messageFormats.includes(messageFormat),
  );

export const validateRequest = async (request: ValidationRequest): Promise<ValidationResult> => {
  const validator = getValidator(request.schemaFormat, request.messageFormat);
  if (!validator) {
    const issue = makeIssue({
      code: 'unsupported-format-pair',
      title: 'Unsupported schema/message combination',
      message: `No validator is registered for ${request.schemaFormat} schemas with ${request.messageFormat} messages.`,
      schemaRange: wholeDocumentRange(request.schemaText),
      messageRange: wholeDocumentRange(request.messageText),
      hint: 'Choose one of the supported combinations in the format selectors.',
    });

    return {
      ok: false,
      adapterId: 'unsupported',
      summary: summarizeIssues([issue], 'Format Pair'),
      durationMs: 0,
      issues: [issue],
    };
  }

  return validator.validate(request);
};

export const supportedMessageFormatsForSchema = (schemaFormat: SchemaFormat): MessageFormat[] => {
  const formats = validators.flatMap((validator) =>
    validator.schemaFormats.includes(schemaFormat) ? validator.messageFormats : [],
  );
  return [...new Set(formats)];
};

export const isSupportedFormatPair = (schemaFormat: SchemaFormat, messageFormat: MessageFormat) =>
  Boolean(getValidator(schemaFormat, messageFormat));
