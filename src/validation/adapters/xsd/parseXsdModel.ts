import { XMLParser } from 'fast-xml-parser';
import { makeIssue, rangeFromOffset, wholeDocumentRange } from '../../textRanges';
import type { TextRange } from '../../types';
import type {
    XsdAttributeDecl,
    XsdComplexType,
    XsdElementDecl,
    XsdMaxOccurs,
    XsdModelParseResult,
    XsdParticleGroup,
    XsdRestriction,
    XsdRestrictionKind,
    XsdSchemaModel,
    XsdSimpleType,
    XsdUnsupportedFeature,
} from './types';

const ATTRIBUTE_KEY = ':@';
const TEXT_KEY = '#text';
type RawNode = Record<string, unknown>;

interface TagNode {
  tagName: string;
  localName: string;
  attributes: Record<string, string>;
  children: RawNode[];
  range: TextRange;
}

export const parseXsdModel = (schemaText: string): XsdModelParseResult => {
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
    parsed = parser.parse(schemaText) as RawNode[];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The XSD could not be parsed.';
    return {
      ok: false,
      issues: [
        makeIssue({
          code: 'malformed-xsd',
          title: 'Malformed XSD',
          message,
          schemaRange: wholeDocumentRange(schemaText),
        }),
      ],
    };
  }

  const rangeLocator = new XsdRangeLocator(schemaText);
  const schemaNode = parsed.map((node) => toTagNode(node, rangeLocator)).find((node) => node?.localName === 'schema');
  if (!schemaNode) {
    return {
      ok: false,
      issues: [
        makeIssue({
          code: 'xsd-schema-not-found',
          title: 'No XSD schema root found',
          message: 'The schema must contain an xs:schema or xsd:schema root element.',
          schemaRange: wholeDocumentRange(schemaText),
        }),
      ],
    };
  }

  const model: XsdSchemaModel = {
    schemaText,
    globalElements: new Map(),
    complexTypes: new Map(),
    simpleTypes: new Map(),
    attributes: new Map(),
    unsupportedFeatures: findUnsupportedFeatures(schemaText),
  };

  for (const child of schemaNode.children) {
    const tag = toTagNode(child, rangeLocator);
    if (!tag) {
      continue;
    }

    if (tag.localName === 'element') {
      const element = parseElement(tag, model, rangeLocator);
      if (element.name) {
        model.globalElements.set(normalizeTypeName(element.name), element);
        model.rootElementName ??= element.name;
      }
    } else if (tag.localName === 'attribute') {
      const attribute = parseAttribute(tag, model, rangeLocator);
      if (attribute.name) {
        model.attributes.set(normalizeTypeName(attribute.name), attribute);
      }
    } else if (tag.localName === 'complexType') {
      const typeName = readAttribute(tag.attributes, 'name');
      if (typeName) {
        model.complexTypes.set(
          normalizeTypeName(typeName),
          parseComplexType(tag, normalizeTypeName(typeName), model, rangeLocator),
        );
      }
    } else if (tag.localName === 'simpleType') {
      const typeName = readAttribute(tag.attributes, 'name');
      if (typeName) {
        model.simpleTypes.set(normalizeTypeName(typeName), parseSimpleType(tag, normalizeTypeName(typeName), rangeLocator));
      }
    }
  }

  return { ok: true, model };
};

const parseElement = (
  tag: TagNode,
  model: XsdSchemaModel,
  rangeLocator: XsdRangeLocator,
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
      model.complexTypes.set(inlineName, parseComplexType(childTag, inlineName, model, rangeLocator));
      typeName = inlineName;
    } else if (childTag.localName === 'simpleType') {
      const inlineName = inlineTypeName(name, tag.range);
      model.simpleTypes.set(inlineName, parseSimpleType(childTag, inlineName, rangeLocator));
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
  };
};

const parseComplexType = (
  tag: TagNode,
  name: string,
  model: XsdSchemaModel,
  rangeLocator: XsdRangeLocator,
): XsdComplexType => {
  const attributes: XsdAttributeDecl[] = [];
  let group: XsdParticleGroup | undefined;

  if (readAttribute(tag.attributes, 'mixed') === 'true') {
    model.unsupportedFeatures.push({
      code: 'xsd-mixed-content',
      title: 'Unsupported mixed XSD content',
      message: `Complex type ${name} uses mixed content, which cannot be validated safely in the browser validator yet.`,
      range: tag.range,
    });
  }

  for (const child of tag.children) {
    const childTag = toTagNode(child, rangeLocator);
    if (!childTag) {
      continue;
    }

    if (['sequence', 'choice', 'all'].includes(childTag.localName)) {
      group = parseParticleGroup(childTag, model, rangeLocator);
    } else if (childTag.localName === 'attribute') {
      attributes.push(parseAttribute(childTag, model, rangeLocator));
    } else if (['complexContent', 'simpleContent'].includes(childTag.localName)) {
      model.unsupportedFeatures.push({
        code: 'xsd-content-derivation',
        title: 'Unsupported XSD type derivation',
        message: `Complex type ${name} uses ${childTag.localName}, so validation would be incomplete without deriving the base type.`,
        range: childTag.range,
      });
    }
  }

  return { name, group, attributes, range: tag.range };
};

const parseParticleGroup = (tag: TagNode, model: XsdSchemaModel, rangeLocator: XsdRangeLocator): XsdParticleGroup => {
  const elements: XsdElementDecl[] = [];

  for (const child of tag.children) {
    const childTag = toTagNode(child, rangeLocator);
    if (!childTag) {
      continue;
    }

    if (childTag.localName === 'element') {
      elements.push(parseElement(childTag, model, rangeLocator));
    } else if (['sequence', 'choice', 'all', 'group', 'any'].includes(childTag.localName)) {
      model.unsupportedFeatures.push({
        code: 'xsd-nested-particle',
        title: 'Unsupported nested XSD particle',
        message: `Nested xs:${childTag.localName} particles are not expanded by this validator yet.`,
        range: childTag.range,
      });
    }
  }

  return {
    kind: tag.localName as XsdParticleGroup['kind'],
    elements,
    minOccurs: parseOccurs(readAttribute(tag.attributes, 'minOccurs'), 1),
    maxOccurs: parseMaxOccurs(readAttribute(tag.attributes, 'maxOccurs')),
    range: tag.range,
  };
};

const parseAttribute = (tag: TagNode, model: XsdSchemaModel, rangeLocator: XsdRangeLocator): XsdAttributeDecl => {
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
      model.simpleTypes.set(inlineName, parseSimpleType(childTag, inlineName, rangeLocator));
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
  };
};

const parseSimpleType = (tag: TagNode, name: string, rangeLocator: XsdRangeLocator): XsdSimpleType => {
  const restrictionTag = tag.children
    .map((child) => toTagNode(child, rangeLocator))
    .find((child) => child?.localName === 'restriction');

  if (!restrictionTag) {
    return { name, baseType: 'xs:string', restrictions: [], range: tag.range };
  }

  const restrictions: XsdRestriction[] = [];
  for (const child of restrictionTag.children) {
    const restriction = toTagNode(child, rangeLocator);
    if (!restriction || !restrictionKinds.has(restriction.localName as XsdRestrictionKind)) {
      continue;
    }

    const value = readAttribute(restriction.attributes, 'value');
    if (value !== undefined) {
      restrictions.push({ kind: restriction.localName as XsdRestrictionKind, value, range: restriction.range });
    }
  }

  return {
    name,
    baseType: normalizeTypeName(readAttribute(restrictionTag.attributes, 'base') ?? 'xs:string'),
    restrictions,
    range: tag.range,
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

const findUnsupportedFeatures = (schemaText: string): XsdUnsupportedFeature[] => {
  const features: Array<{ localName: string; title: string; message: string }> = [
    {
      localName: 'include',
      title: 'External XSD include is unsupported',
      message:
        'This schema uses xs:include. Provide a bundled schema or use a backend/full XSD engine before trusting validation.',
    },
    {
      localName: 'import',
      title: 'External XSD import is unsupported',
      message: 'This schema uses xs:import. External schema loading is not available in the static browser validator.',
    },
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
      });
    }
  }

  return unsupported;
};

const toTagNode = (node: RawNode, rangeLocator: XsdRangeLocator): TagNode | undefined => {
  const tagName = Object.keys(node).find((key) => key !== ATTRIBUTE_KEY && key !== TEXT_KEY);
  if (!tagName) {
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
