import type { XMLFileInfo, XMLValidationError } from 'xmllint-wasm';
import type { RelatedSchemaDocument, ValidationRequest } from '../../types';

export const XMLLINT_MESSAGE_FILE = 'message.xml';
export const XMLLINT_PRIMARY_SCHEMA_FILE = 'main-schema.xsd';
export const XMLLINT_PRIMARY_SCHEMA_SOURCE_ID = 'primary-schema';
export const XMLLINT_PRIMARY_SCHEMA_LABEL = 'Main schema';

export interface XmllintEngineFile {
  role: 'message' | 'primary-schema' | 'related-schema';
  fileName: string;
  label: string;
  text: string;
  sourceId?: string;
  schemaSource?: RelatedSchemaDocument;
}

export interface XmllintEngineError {
  rawMessage: string;
  message: string;
  loc: XMLValidationError['loc'];
}

export interface XmllintEngineResult {
  kind: 'validated' | 'rejected';
  valid: boolean;
  errors: XmllintEngineError[];
  rawOutput: string;
  files: XmllintEngineFile[];
}

export class XmllintEngineLoadError extends Error {
  constructor(cause: unknown) {
    super('The full XSD validation engine could not be loaded.');
    this.name = 'XmllintEngineLoadError';
    this.cause = cause;
  }
}

let xmllintModulePromise: Promise<typeof import('xmllint-wasm')> | undefined;

export const validateXmlWithXmllint = async (request: ValidationRequest): Promise<XmllintEngineResult> => {
  const xmllint = await loadXmllintModule();
  const bundle = prepareXmllintBundle(request);

  try {
    const result = await xmllint.validateXML({
      xml: bundle.xml,
      schema: bundle.schema,
      preload: bundle.preload,
      extension: 'schema',
      modifyArguments: (args) => ['--nonet', ...args],
    });

    return {
      kind: 'validated',
      valid: result.valid,
      errors: result.errors.map(normalizeEngineError),
      rawOutput: result.rawOutput,
      files: bundle.files,
    };
  } catch (error) {
    const rawOutput = errorMessage(error);
    return {
      kind: 'rejected',
      valid: false,
      errors: parseXmllintErrorOutput(rawOutput),
      rawOutput,
      files: bundle.files,
    };
  }
};

export const prepareXmllintBundle = (request: ValidationRequest) => {
  const relatedFiles = (request.relatedSchemas ?? [])
    .filter((source) => source.text.trim())
    .map((source, index) => ({
      role: 'related-schema' as const,
      fileName: safeSchemaFileName(source, index),
      label: source.label || source.schemaLocation || source.id,
      text: source.text,
      sourceId: source.id,
      schemaSource: source,
    }));

  const primarySchemaText = rewriteSchemaReferences(request.schemaText, relatedFiles);
  const preloadFiles = relatedFiles.map((file) => ({
    ...file,
    text: rewriteSchemaReferences(file.text, relatedFiles),
  }));
  const messageFile: XmllintEngineFile = {
    role: 'message',
    fileName: XMLLINT_MESSAGE_FILE,
    label: 'XML message',
    text: request.messageText,
  };
  const primarySchemaFile: XmllintEngineFile = {
    role: 'primary-schema',
    fileName: XMLLINT_PRIMARY_SCHEMA_FILE,
    label: XMLLINT_PRIMARY_SCHEMA_LABEL,
    sourceId: XMLLINT_PRIMARY_SCHEMA_SOURCE_ID,
    text: primarySchemaText,
  };

  return {
    xml: [{ fileName: messageFile.fileName, contents: messageFile.text }] satisfies XMLFileInfo[],
    schema: [{ fileName: primarySchemaFile.fileName, contents: primarySchemaFile.text }] satisfies XMLFileInfo[],
    preload: preloadFiles.map((file) => ({ fileName: file.fileName, contents: file.text })) satisfies XMLFileInfo[],
    files: [messageFile, primarySchemaFile, ...preloadFiles] satisfies XmllintEngineFile[],
  };
};

export const findXmllintFile = (files: XmllintEngineFile[], fileName: string | undefined) => {
  if (!fileName) {
    return undefined;
  }

  const normalized = normalizeLocation(fileName);
  const normalizedBase = basename(normalized);
  return files.find((file) => {
    const candidate = normalizeLocation(file.fileName);
    return candidate === normalized || basename(candidate) === normalizedBase;
  });
};

const loadXmllintModule = async () => {
  if (!xmllintModulePromise) {
    xmllintModulePromise = import('xmllint-wasm').catch((error: unknown) => {
      xmllintModulePromise = undefined;
      throw new XmllintEngineLoadError(error);
    });
  }

  return xmllintModulePromise;
};

const rewriteSchemaReferences = (schemaText: string, relatedFiles: XmllintEngineFile[]) => {
  const withLocations = schemaText.replace(
    /\bschemaLocation\s*=\s*(["'])([^"']+)\1/gi,
    (match, quote: string, location: string) => {
      const source = findRelatedFileForLocation(relatedFiles, location);
      return source ? `schemaLocation=${quote}${escapeXmlAttribute(source.fileName)}${quote}` : match;
    },
  );

  return withLocations.replace(
    /<((?:[A-Za-z_][\w.-]*:)?import)\b([^>]*)>/gi,
    (match, tagName: string, attributes: string) => {
      if (readXmlAttribute(attributes, 'schemaLocation')) {
        return match;
      }

      const namespace = readXmlAttribute(attributes, 'namespace');
      const source = namespace ? relatedFiles.find((file) => file.schemaSource?.namespace === namespace) : undefined;
      if (!source) {
        return match;
      }

      return match.replace(
        new RegExp(`<${escapeRegExp(tagName)}\\b`),
        `<${tagName} schemaLocation="${escapeXmlAttribute(source.fileName)}"`,
      );
    },
  );
};

const findRelatedFileForLocation = (files: XmllintEngineFile[], location: string) => {
  const expected = normalizeLocation(location);
  const expectedBase = basename(expected);
  return files.find((file) => {
    const candidates = [
      file.fileName,
      file.schemaSource?.schemaLocation,
      file.schemaSource?.label,
      file.schemaSource?.id,
      file.label,
    ]
      .filter(Boolean)
      .map((value) => normalizeLocation(String(value)));

    return candidates.some((candidate) => candidate === expected || basename(candidate) === expectedBase);
  });
};

const safeSchemaFileName = (source: RelatedSchemaDocument, index: number) => {
  const base = basename(source.schemaLocation || source.label || source.id || `schema-${index + 1}.xsd`);
  const withoutExtension = base.replace(/\.xsd$/i, '') || `schema-${index + 1}`;
  const safeBase = withoutExtension.replace(/[^A-Za-z0-9_.]+/g, '-').replace(/^-+/, '') || `schema-${index + 1}`;
  return `source-${index + 1}-${safeBase}.xsd`;
};

const normalizeEngineError = (error: XMLValidationError): XmllintEngineError => ({
  rawMessage: error.rawMessage,
  message: error.message,
  loc: error.loc,
});

const parseXmllintErrorOutput = (rawOutput: string): XmllintEngineError[] =>
  rawOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^([^:]+):(\d+):\s*(.*)$/.exec(line);
      if (!match) {
        return { rawMessage: line, message: line, loc: null };
      }

      return {
        rawMessage: line,
        message: match[3].trim(),
        loc: { fileName: match[1], lineNumber: Number(match[2]) },
      };
    });

const readXmlAttribute = (attributes: string, name: string) => {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attributes);
  return match?.[1];
};

const escapeXmlAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const normalizeLocation = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '').trim().toLowerCase();
const basename = (value: string) =>
  normalizeLocation(value).split('/').filter(Boolean).at(-1) ?? normalizeLocation(value);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
