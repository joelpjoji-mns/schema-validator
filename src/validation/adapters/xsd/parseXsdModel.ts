import { XMLParser } from 'fast-xml-parser';
import { makeIssue, rangeFromOffset, wholeDocumentRange } from '../../textRanges';
import type { RelatedSchemaDocument, TextRange, ValidationIssue } from '../../types';
import type {
  XsdAttributeDecl,
  XsdComplexType,
  XsdElementDecl,
  XsdExternalReference,
  XsdMaxOccurs,
  XsdModelParseResult,
  XsdParticleGroup,
  XsdRestriction,
  XsdRestrictionKind,
  XsdSchemaModel,
  XsdSchemaSourceInfo,
  XsdSimpleType,
  XsdUnsupportedFeature,
} from './types';

const ATTRIBUTE_KEY = ':@';
const TEXT_KEY = '#text';
export const PRIMARY_XSD_SOURCE_ID = 'primary-schema';

type RawNode = Record<string, unknown>;

export interface XsdModelParseInput {
  schemaText?: string;
  primary?: RelatedSchemaDocument;
  relatedSchemas?: RelatedSchemaDocument[];
}

interface ParseSource extends RelatedSchemaDocument {
  isPrimary: boolean;
}

interface ParsedXsdDocument {
  source: XsdSchemaSourceInfo;
  globalElements: Map<string, XsdElementDecl>;
  complexTypes: Map<string, XsdComplexType>;
  simpleTypes: Map<string, XsdSimpleType>;
  attributes: Map<string, XsdAttributeDecl>;
  externalReferences: XsdExternalReference[];
  unsupportedFeatures: XsdUnsupportedFeature[];
}

interface TagNode {
  tagName: string;
  localName: string;
  attributes: Record<string, string>;
  children: RawNode[];
  range: TextRange;
}

interface SourceContext {
  sourceId: string;
  sourceLabel: string;
}

export const parseXsdModel = (input: string | XsdModelParseInput): XsdModelParseResult => {
  const sources = normalizeParseSources(input);
  const documents: ParsedXsdDocument[] = [];
  const parseIssues: ValidationIssue[] = [];

  for (const source of sources) {
    const parsed = parseXsdDocument(source);
    if (parsed.ok) {
      documents.push(parsed.document);
    } else {
      parseIssues.push(...parsed.issues);
    }
  }

  if (parseIssues.length > 0) {
    return { ok: false, issues: parseIssues };
  }

  const primaryDocument = documents.find((document) => document.source.isPrimary) ?? documents[0];
  if (!primaryDocument) {
    return {
      ok: false,
      issues: [
        makeIssue({
          code: 'xsd-schema-not-found',
          title: 'No XSD schema root found',
          message: 'The schema must contain an xs:schema or xsd:schema root element.',
          schemaRange: wholeDocumentRange(''),
          schemaSourceId: PRIMARY_XSD_SOURCE_ID,
          schemaSourceLabel: 'Main schema',
        }),
      ],
    };
  }

  const model: XsdSchemaModel = {
    schemaText: primaryDocument.source.text,
    primarySourceId: primaryDocument.source.id,
    sources: documents.map((document) => document.source),
    externalReferences: [],
    globalElements: new Map(),
    complexTypes: new Map(),
    simpleTypes: new Map(),
    attributes: new Map(),
    unsupportedFeatures: [],
  };

  const reachableSourceIds = collectReachableSources(primaryDocument, documents, model.unsupportedFeatures);

  for (const document of documents) {
    if (!reachableSourceIds.has(document.source.id)) {
      continue;
    }

    model.unsupportedFeatures.push(...document.unsupportedFeatures);
    model.externalReferences.push(...document.externalReferences);
    mergeDeclarations(model, document);
  }

  model.rootElementName = primaryDocument.globalElements.values().next().value?.name;

  return { ok: true, model };
};

const normalizeParseSources = (input: string | XsdModelParseInput): ParseSource[] => {
  if (typeof input === 'string') {
    return [
      {
        id: PRIMARY_XSD_SOURCE_ID,
        label: 'Main schema',
        text: input,
        isPrimary: true,
      },
    ];
  }

  const primary = input.primary ?? {
    id: PRIMARY_XSD_SOURCE_ID,
    label: 'Main schema',
    text: input.schemaText ?? '',
  };
  const seen = new Set<string>();
  const sources: ParseSource[] = [];
  const rawSources: ParseSource[] = [
    { ...primary, isPrimary: true },
    ...(input.relatedSchemas ?? []).map((source) => ({ ...source, isPrimary: false })),
  ];

  for (const source of rawSources) {
    const sourceId = source.id || stableSourceId(source.label, source.schemaLocation);
    if (seen.has(sourceId)) {
      continue;
    }
    seen.add(sourceId);
    sources.push({
      ...source,
      id: sourceId,
      label: source.label || source.schemaLocation || sourceId,
      text: source.text ?? '',
    });
  }

  return sources;
};

const parseXsdDocument = (
  source: ParseSource,
): { ok: true; document: ParsedXsdDocument } | { ok: false; issues: ValidationIssue[] } => {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: TEXT_KEY,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    allowBooleanAttributes: true,
  });

  let parsed: RawNode[];
  try {
    parsed = parser.parse(source.text) as RawNode[];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The XSD could not be parsed.';
    return {
      ok: false,
      issues: [
        makeIssue({
          code: 'malformed-xsd',
          title: `Malformed XSD: ${source.label}`,
          message,
          schemaRange: wholeDocumentRange(source.text),
          schemaSourceId: source.id,
          schemaSourceLabel: source.label,
        }),
      ],
    };
  }

  const rangeLocator = new XsdRangeLocator(source.text);
  const schemaNode = parsed.map((node) => toTagNode(node, rangeLocator)).find((node) => node?.localName === 'schema');
  if (!schemaNode) {
    return {
      ok: false,
      issues: [
        makeIssue({
          code: 'xsd-schema-not-found',
          title: `No XSD schema root found: ${source.label}`,
          message: 'The schema must contain an xs:schema or xsd:schema root element.',
          schemaRange: wholeDocumentRange(source.text),
          schemaSourceId: source.id,
          schemaSourceLabel: source.label,
        }),
      ],
    };
  }

  const sourceInfo: XsdSchemaSourceInfo = {
    ...source,
    targetNamespace: readAttribute(schemaNode.attributes, 'targetNamespace') || source.namespace,
  };
  const context: SourceContext = { sourceId: source.id, sourceLabel: source.label };
  const document: ParsedXsdDocument = {
    source: sourceInfo,
    globalElements: new Map(),
    complexTypes: new Map(),
    simpleTypes: new Map(),
    attributes: new Map(),
    externalReferences: [],
    unsupportedFeatures: findUnsupportedFeatures(source.text, context),
  };

  for (const child of schemaNode.children) {
    const tag = toTagNode(child, rangeLocator);
    if (!tag) {
      continue;
    }

    if (tag.localName === 'include' || tag.localName === 'import') {
      document.externalReferences.push(parseExternalReference(tag, context));
    } else if (tag.localName === 'element') {
      const element = parseElement(tag, document, rangeLocator, context);
      if (element.name) {
        document.globalElements.set(normalizeTypeName(element.name), element);
      }
    } else if (tag.localName === 'attribute') {
      const attribute = parseAttribute(tag, document, rangeLocator, context);
      if (attribute.name) {
        document.attributes.set(normalizeTypeName(attribute.name), attribute);
      }
    } else if (tag.localName === 'complexType') {
      const typeName = readAttribute(tag.attributes, 'name');
      if (typeName) {
        document.complexTypes.set(
          normalizeTypeName(typeName),
          parseComplexType(tag, normalizeTypeName(typeName), document, rangeLocator, context),
        );
      }
    } else if (tag.localName === 'simpleType') {
      const typeName = readAttribute(tag.attributes, 'name');
      if (typeName) {
        document.simpleTypes.set(
          normalizeTypeName(typeName),
          parseSimpleType(tag, normalizeTypeName(typeName), rangeLocator, context),
        );
      }
    }
  }

  return { ok: true, document };
};

const collectReachableSources = (
  primaryDocument: ParsedXsdDocument,
  documents: ParsedXsdDocument[],
  issues: XsdUnsupportedFeature[],
) => {
  const reachable = new Set<string>();
  const visiting = new Set<string>();
  const documentById = new Map(documents.map((document) => [document.source.id, document]));

  const visit = (document: ParsedXsdDocument) => {
    if (visiting.has(document.source.id)) {
      issues.push({
        code: 'xsd-circular-include',
        title: `Circular XSD reference: ${document.source.label}`,
        message: `The schema bundle references ${document.source.label} in a cycle. The cycle is de-duplicated for validation.`,
        range: wholeDocumentRange(document.source.text),
        sourceId: document.source.id,
        sourceLabel: document.source.label,
      });
      return;
    }

    if (reachable.has(document.source.id)) {
      return;
    }

    reachable.add(document.source.id);
    visiting.add(document.source.id);

    for (const reference of document.externalReferences) {
      const resolved = resolveExternalReference(reference, document, documents);
      if (!resolved) {
        issues.push(unresolvedReferenceIssue(reference));
        continue;
      }

      reference.resolvedSourceId = resolved.source.id;
      reference.resolvedSourceLabel = resolved.source.label;
      const namespaceIssue = validateReferenceNamespace(reference, document, resolved);
      if (namespaceIssue) {
        issues.push(namespaceIssue);
        continue;
      }

      visit(documentById.get(resolved.source.id) ?? resolved);
    }

    visiting.delete(document.source.id);
  };

  visit(primaryDocument);
  return reachable;
};

const resolveExternalReference = (
  reference: XsdExternalReference,
  fromDocument: ParsedXsdDocument,
  documents: ParsedXsdDocument[],
) => {
  const candidates = documents.filter((document) => document.source.id !== fromDocument.source.id);
  const locationMatches = reference.schemaLocation
    ? candidates.filter((document) => sourceMatchesLocation(document.source, reference.schemaLocation ?? ''))
    : [];
  const namespaceMatches = reference.namespace
    ? candidates.filter((document) => (document.source.targetNamespace ?? document.source.namespace) === reference.namespace)
    : [];

  if (reference.kind === 'include') {
    return oneOrUndefined(locationMatches);
  }

  if (reference.schemaLocation && reference.namespace) {
    return (
      oneOrUndefined(locationMatches.filter((document) => namespaceMatches.includes(document))) ??
      oneOrUndefined(namespaceMatches) ??
      oneOrUndefined(locationMatches)
    );
  }

  if (reference.namespace) {
    return oneOrUndefined(namespaceMatches);
  }

  return oneOrUndefined(locationMatches);
};

const validateReferenceNamespace = (
  reference: XsdExternalReference,
  fromDocument: ParsedXsdDocument,
  resolved: ParsedXsdDocument,
): XsdUnsupportedFeature | undefined => {
  const resolvedNamespace = resolved.source.targetNamespace ?? resolved.source.namespace;
  if (reference.kind === 'include') {
    const expectedNamespace = fromDocument.source.targetNamespace ?? fromDocument.source.namespace;
    if (resolvedNamespace && expectedNamespace && resolvedNamespace !== expectedNamespace) {
      return {
        code: 'xsd-include-namespace-mismatch',
        title: `Included XSD namespace mismatch: ${reference.schemaLocation ?? resolved.source.label}`,
        message: `xs:include can only include schemas with the same targetNamespace. Expected ${expectedNamespace}, but ${resolved.source.label} declares ${resolvedNamespace}.`,
        range: reference.range,
        sourceId: reference.sourceId,
        sourceLabel: reference.sourceLabel,
      };
    }
  }

  if (reference.kind === 'import' && reference.namespace && resolvedNamespace !== reference.namespace) {
    return {
      code: 'xsd-import-namespace-mismatch',
      title: `Imported XSD namespace mismatch: ${reference.schemaLocation ?? resolved.source.label}`,
      message: `xs:import expects namespace ${reference.namespace}, but ${resolved.source.label} declares ${resolvedNamespace ?? 'no targetNamespace'}.`,
      range: reference.range,
      sourceId: reference.sourceId,
      sourceLabel: reference.sourceLabel,
    };
  }

  return undefined;
};

const mergeDeclarations = (model: XsdSchemaModel, document: ParsedXsdDocument) => {
  mergeMap(model.globalElements, document.globalElements, 'global element', model.unsupportedFeatures);
  mergeMap(model.complexTypes, document.complexTypes, 'complex type', model.unsupportedFeatures);
  mergeMap(model.simpleTypes, document.simpleTypes, 'simple type', model.unsupportedFeatures);
  mergeMap(model.attributes, document.attributes, 'attribute', model.unsupportedFeatures);
};

const mergeMap = <TValue extends { name: string; range: TextRange; sourceId: string; sourceLabel: string }>(
  target: Map<string, TValue>,
  source: Map<string, TValue>,
  label: string,
  issues: XsdUnsupportedFeature[],
) => {
  for (const [key, value] of source) {
    const existing = target.get(key);
    if (existing && existing.sourceId !== value.sourceId) {
      issues.push({
        code: 'xsd-name-collision',
        title: `Duplicate XSD ${label}: ${value.name}`,
        message: `${value.name} is declared in both ${existing.sourceLabel} and ${value.sourceLabel}. Rename or remove one declaration so references are not ambiguous.`,
        range: value.range,
        sourceId: value.sourceId,
        sourceLabel: value.sourceLabel,
      });
      continue;
    }

    target.set(key, value);
  }
};

const parseExternalReference = (tag: TagNode, context: SourceContext): XsdExternalReference => ({
  kind: tag.localName === 'include' ? 'include' : 'import',
  schemaLocation: readAttribute(tag.attributes, 'schemaLocation'),
  namespace: readAttribute(tag.attributes, 'namespace'),
  range: tag.range,
  sourceId: context.sourceId,
  sourceLabel: context.sourceLabel,
});

const unresolvedReferenceIssue = (reference: XsdExternalReference): XsdUnsupportedFeature => {
  const target = reference.schemaLocation ?? reference.namespace ?? 'referenced schema';
  return {
    code: reference.kind === 'include' ? 'unresolved-xsd-include' : 'unresolved-xsd-import',
    title: `Missing XSD ${reference.kind}: ${target}`,
    message: `The schema references ${target}, but no matching XSD source has been added in the schema bundle. Add that XSD in the Sources tab or remove the ${reference.kind}.`,
    range: reference.range,
    sourceId: reference.sourceId,
    sourceLabel: reference.sourceLabel,
  };
};

const parseElement = (
  tag: TagNode,
  document: ParsedXsdDocument,
  rangeLocator: XsdRangeLocator,
  context: SourceContext,
  fallbackName?: string,
): XsdElementDecl => {
  const refName = readAttribute(tag.attributes, 'ref');
  const name = readAttribute(tag.attributes, 'name') ?? (refName ? localName(refName) : (fallbackName ?? 'anonymous'));
  let typeName = readAttribute(tag.attributes, 'type')
    ? normalizeTypeName(readAttribute(tag.attributes, 'type') ?? '')
    : undefined;

  for (const child of tag.children) {
    const childTag = toTagNode(child, rangeLocator);
    if (!childTag) {
      continue;
    }

    if (childTag.localName === 'complexType') {
      const inlineName = inlineTypeName(name, tag.range);
      document.complexTypes.set(inlineName, parseComplexType(childTag, inlineName, document, rangeLocator, context));
      typeName = inlineName;
    } else if (childTag.localName === 'simpleType') {
      const inlineName = inlineTypeName(name, tag.range);
      document.simpleTypes.set(inlineName, parseSimpleType(childTag, inlineName, rangeLocator, context));
      typeName = inlineName;
    }
  }

  return {
    name,
    refName: refName ? normalizeTypeName(refName) : undefined,
    typeName: typeName ?? (refName ? undefined : 'xs:string'),
    nillable: readAttribute(tag.attributes, 'nillable') === 'true',
    minOccurs: parseOccurs(readAttribute(tag.attributes, 'minOccurs'), 1),
    maxOccurs: parseMaxOccurs(readAttribute(tag.attributes, 'maxOccurs')),
    range: tag.range,
    sourceId: context.sourceId,
    sourceLabel: context.sourceLabel,
  };
};

const parseComplexType = (
  tag: TagNode,
  name: string,
  document: ParsedXsdDocument,
  rangeLocator: XsdRangeLocator,
  context: SourceContext,
): XsdComplexType => {
  const attributes: XsdAttributeDecl[] = [];
  let group: XsdParticleGroup | undefined;

  if (readAttribute(tag.attributes, 'mixed') === 'true') {
    document.unsupportedFeatures.push({
      code: 'xsd-mixed-content',
      title: 'Unsupported mixed XSD content',
      message: `Complex type ${name} uses mixed content, which cannot be validated safely in the browser validator yet.`,
      range: tag.range,
      sourceId: context.sourceId,
      sourceLabel: context.sourceLabel,
    });
  }

  for (const child of tag.children) {
    const childTag = toTagNode(child, rangeLocator);
    if (!childTag) {
      continue;
    }

    if (['sequence', 'choice', 'all'].includes(childTag.localName)) {
      group = parseParticleGroup(childTag, document, rangeLocator, context);
    } else if (childTag.localName === 'attribute') {
      attributes.push(parseAttribute(childTag, document, rangeLocator, context));
    } else if (['complexContent', 'simpleContent'].includes(childTag.localName)) {
      document.unsupportedFeatures.push({
        code: 'xsd-content-derivation',
        title: 'Unsupported XSD type derivation',
        message: `Complex type ${name} uses ${childTag.localName}, so validation would be incomplete without deriving the base type.`,
        range: childTag.range,
        sourceId: context.sourceId,
        sourceLabel: context.sourceLabel,
      });
    }
  }

  return { name, group, attributes, range: tag.range, sourceId: context.sourceId, sourceLabel: context.sourceLabel };
};

const parseParticleGroup = (
  tag: TagNode,
  document: ParsedXsdDocument,
  rangeLocator: XsdRangeLocator,
  context: SourceContext,
): XsdParticleGroup => {
  const elements: XsdElementDecl[] = [];

  for (const child of tag.children) {
    const childTag = toTagNode(child, rangeLocator);
    if (!childTag) {
      continue;
    }

    if (childTag.localName === 'element') {
      elements.push(parseElement(childTag, document, rangeLocator, context));
    } else if (['sequence', 'choice', 'all', 'group', 'any'].includes(childTag.localName)) {
      document.unsupportedFeatures.push({
        code: 'xsd-nested-particle',
        title: 'Unsupported nested XSD particle',
        message: `Nested xs:${childTag.localName} particles are not expanded by this validator yet.`,
        range: childTag.range,
        sourceId: context.sourceId,
        sourceLabel: context.sourceLabel,
      });
    }
  }

  return {
    kind: tag.localName as XsdParticleGroup['kind'],
    elements,
    minOccurs: parseOccurs(readAttribute(tag.attributes, 'minOccurs'), 1),
    maxOccurs: parseMaxOccurs(readAttribute(tag.attributes, 'maxOccurs')),
    range: tag.range,
    sourceId: context.sourceId,
    sourceLabel: context.sourceLabel,
  };
};

const parseAttribute = (
  tag: TagNode,
  document: ParsedXsdDocument,
  rangeLocator: XsdRangeLocator,
  context: SourceContext,
): XsdAttributeDecl => {
  const refName = readAttribute(tag.attributes, 'ref');
  const name = readAttribute(tag.attributes, 'name') ?? (refName ? localName(refName) : 'anonymous');
  let typeName = readAttribute(tag.attributes, 'type')
    ? normalizeTypeName(readAttribute(tag.attributes, 'type') ?? '')
    : undefined;

  for (const child of tag.children) {
    const childTag = toTagNode(child, rangeLocator);
    if (!childTag) {
      continue;
    }

    if (childTag.localName === 'simpleType') {
      const inlineName = inlineTypeName(`@${name}`, tag.range);
      document.simpleTypes.set(inlineName, parseSimpleType(childTag, inlineName, rangeLocator, context));
      typeName = inlineName;
    }
  }

  return {
    name,
    refName: refName ? normalizeTypeName(refName) : undefined,
    typeName: typeName ?? (refName ? undefined : 'xs:string'),
    required: readAttribute(tag.attributes, 'use') === 'required',
    prohibited: readAttribute(tag.attributes, 'use') === 'prohibited',
    range: tag.range,
    sourceId: context.sourceId,
    sourceLabel: context.sourceLabel,
  };
};

const parseSimpleType = (
  tag: TagNode,
  name: string,
  rangeLocator: XsdRangeLocator,
  context: SourceContext,
): XsdSimpleType => {
  const restrictionTag = tag.children
    .map((child) => toTagNode(child, rangeLocator))
    .find((child) => child?.localName === 'restriction');

  if (!restrictionTag) {
    return {
      name,
      baseType: 'xs:string',
      restrictions: [],
      range: tag.range,
      sourceId: context.sourceId,
      sourceLabel: context.sourceLabel,
    };
  }

  const restrictions: XsdRestriction[] = [];
  for (const child of restrictionTag.children) {
    const restriction = toTagNode(child, rangeLocator);
    if (!restriction || !restrictionKinds.has(restriction.localName as XsdRestrictionKind)) {
      continue;
    }

    const value = readAttribute(restriction.attributes, 'value');
    if (value !== undefined) {
      restrictions.push({
        kind: restriction.localName as XsdRestrictionKind,
        value,
        range: restriction.range,
        sourceId: context.sourceId,
        sourceLabel: context.sourceLabel,
      });
    }
  }

  return {
    name,
    baseType: normalizeTypeName(readAttribute(restrictionTag.attributes, 'base') ?? 'xs:string'),
    restrictions,
    range: tag.range,
    sourceId: context.sourceId,
    sourceLabel: context.sourceLabel,
  };
};

const restrictionKinds = new Set<XsdRestrictionKind>([
  'enumeration',
  'pattern',
  'length',
  'minLength',
  'maxLength',
  'minInclusive',
  'maxInclusive',
  'minExclusive',
  'maxExclusive',
  'totalDigits',
  'fractionDigits',
]);

const findUnsupportedFeatures = (schemaText: string, context: SourceContext): XsdUnsupportedFeature[] => {
  const features: Array<{ localName: string; title: string; message: string }> = [
    {
      localName: 'redefine',
      title: 'XSD redefine is unsupported',
      message: 'xs:redefine can change type definitions and is not expanded.',
    },
    {
      localName: 'group',
      title: 'XSD groups are unsupported',
      message: 'xs:group references are not expanded by this validator yet.',
    },
    {
      localName: 'any',
      title: 'XSD wildcards are unsupported',
      message: 'xs:any wildcards cannot be validated safely yet.',
    },
    {
      localName: 'anyAttribute',
      title: 'XSD attribute wildcards are unsupported',
      message: 'xs:anyAttribute wildcards cannot be validated safely yet.',
    },
    {
      localName: 'key',
      title: 'XSD identity constraints are unsupported',
      message: 'xs:key constraints are not evaluated.',
    },
    {
      localName: 'keyref',
      title: 'XSD key references are unsupported',
      message: 'xs:keyref constraints are not evaluated.',
    },
    {
      localName: 'unique',
      title: 'XSD uniqueness constraints are unsupported',
      message: 'xs:unique constraints are not evaluated.',
    },
    {
      localName: 'complexContent',
      title: 'XSD complexContent is unsupported',
      message: 'complexContent extension/restriction is not derived by this validator yet.',
    },
    {
      localName: 'simpleContent',
      title: 'XSD simpleContent is unsupported',
      message: 'simpleContent extension/restriction is not derived by this validator yet.',
    },
    {
      localName: 'extension',
      title: 'XSD extension is unsupported',
      message: 'xs:extension base types are not expanded.',
    },
    {
      localName: 'list',
      title: 'XSD list simple types are unsupported',
      message: 'xs:list simple types are not expanded by this validator yet.',
    },
    {
      localName: 'union',
      title: 'XSD union simple types are unsupported',
      message: 'xs:union simple types are not expanded by this validator yet.',
    },
  ];

  const unsupported: XsdUnsupportedFeature[] = [];
  for (const feature of features) {
    const pattern = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${feature.localName}\\b[^>]*>`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(schemaText))) {
      unsupported.push({
        code: `unsupported-${feature.localName}`,
        title: feature.title,
        message: feature.message,
        range: rangeFromOffset(schemaText, match.index, match[0].length),
        sourceId: context.sourceId,
        sourceLabel: context.sourceLabel,
      });
    }
  }

  const attrPatterns: Array<{ pattern: RegExp; title: string; message: string }> = [
    {
      pattern: /\bsubstitutionGroup\s*=\s*["'][^"']+["']/gi,
      title: 'XSD substitution groups are unsupported',
      message: 'substitutionGroup can change which elements are valid and is not expanded yet.',
    },
    {
      pattern: /\babstract\s*=\s*["']true["']/gi,
      title: 'XSD abstract declarations are unsupported',
      message: 'Abstract elements and types require substitution/derivation support that is not available yet.',
    },
  ];

  for (const { pattern, title, message } of attrPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(schemaText))) {
      unsupported.push({
        code: 'unsupported-xsd-attribute',
        title,
        message,
        range: rangeFromOffset(schemaText, match.index, match[0].length),
        sourceId: context.sourceId,
        sourceLabel: context.sourceLabel,
      });
    }
  }

  return unsupported;
};

const toTagNode = (node: RawNode, rangeLocator: XsdRangeLocator): TagNode | undefined => {
  const tagName = Object.keys(node).find((key) => key !== ATTRIBUTE_KEY && key !== TEXT_KEY);
  if (!tagName || tagName.startsWith('?') || tagName.startsWith('!')) {
    return undefined;
  }

  const value = node[tagName];
  return {
    tagName,
    localName: localName(tagName),
    attributes: normalizeAttributes(isRecord(node[ATTRIBUTE_KEY]) ? node[ATTRIBUTE_KEY] : {}),
    children: Array.isArray(value) ? (value as RawNode[]) : [],
    range: rangeLocator.next(localName(tagName)),
  };
};

const normalizeAttributes = (attributes: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key.replace(/^@_/, ''), String(value)]));

const readAttribute = (attributes: Record<string, string>, name: string) =>
  attributes[name] ?? attributes[Object.keys(attributes).find((key) => localName(key) === name) ?? ''];

const inlineTypeName = (name: string, range: TextRange) =>
  `#inline/${name}/${range.startLineNumber}/${range.startColumn}`;

export const normalizeTypeName = (typeName: string) => {
  if (/^xsd:/i.test(typeName)) {
    return typeName.replace(/^xsd:/i, 'xs:');
  }

  if (/^xs:/i.test(typeName)) {
    return typeName;
  }

  return localName(typeName);
};

export const localName = (name: string) => name.replace(/^@_/, '').split(':').at(-1) ?? name;

export const parseOccurs = (value: string | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export const parseMaxOccurs = (value: string | undefined): XsdMaxOccurs => {
  if (value === 'unbounded') {
    return Number.POSITIVE_INFINITY;
  }

  return parseOccurs(value, 1);
};

export const formatMaxOccurs = (value: XsdMaxOccurs) =>
  value === Number.POSITIVE_INFINITY ? 'unbounded' : String(value);

const sourceMatchesLocation = (source: XsdSchemaSourceInfo, location: string) => {
  const expected = normalizeLocation(location);
  const expectedBase = basename(expected);
  const candidates = [source.schemaLocation, source.label, source.id]
    .filter(Boolean)
    .map((value) => normalizeLocation(String(value)));
  return candidates.some((candidate) => candidate === expected || basename(candidate) === expectedBase);
};

const normalizeLocation = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '').trim().toLowerCase();
const basename = (value: string) => normalizeLocation(value).split('/').filter(Boolean).at(-1) ?? normalizeLocation(value);
const oneOrUndefined = <TValue,>(values: TValue[]) => (values.length === 1 ? values[0] : undefined);
const stableSourceId = (label: string | undefined, schemaLocation: string | undefined) =>
  `xsd-source-${hashString(`${label ?? ''}:${schemaLocation ?? ''}`)}`;

const hashString = (value: string) => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

class XsdRangeLocator {
  private cursor = 0;

  constructor(private readonly source: string) {}

  next(localTagName: string): TextRange {
    if (!this.source) {
      return { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 };
    }

    const tagPattern = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${escapeRegExp(localTagName)}\\b[^>]*>`, 'gi');
    tagPattern.lastIndex = this.cursor;
    const match = tagPattern.exec(this.source) ?? findFromStart(this.source, localTagName);
    if (!match) {
      return wholeDocumentRange(this.source);
    }

    this.cursor = match.index + match[0].length;
    return rangeFromOffset(this.source, match.index, match[0].length);
  }
}

const findFromStart = (source: string, localTagName: string) => {
  const pattern = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${escapeRegExp(localTagName)}\\b[^>]*>`, 'i');
  return pattern.exec(source);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
