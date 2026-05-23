import { XMLParser } from 'fast-xml-parser';
import { makeIssue, rangeFromOffset, wholeDocumentRange } from '../../textRanges';
import type { TextRange, ValidationIssue, ValidationRequest } from '../../types';
import { formatMaxOccurs, localName, normalizeTypeName } from './parseXsdModel';
import type { XsdElementDecl, XsdParticleGroup, XsdSchemaModel } from './types';

const ATTRIBUTE_KEY = ':@';
const TEXT_KEY = '#text';

type RawNode = Record<string, unknown>;

export interface XmllintIssueEntry {
  issue: ValidationIssue;
  rawMessage: string;
}

export interface EnrichXmllintIssuesInput {
  issues: XmllintIssueEntry[];
  request: ValidationRequest;
  model?: XsdSchemaModel;
}

interface XmlElementNode {
  name: string;
  localName: string;
  children: XmlElementNode[];
  text: string;
  range: TextRange;
  parent?: XmlElementNode;
}

interface SchemaElementContext {
  node: XmlElementNode;
  declaration: XsdElementDecl;
  path: string;
  group?: XsdParticleGroup;
}

interface EnrichmentContext {
  model: XsdSchemaModel;
  root?: XmlElementNode;
  xmlText: string;
}

export const enrichXmllintIssues = ({ issues, request, model }: EnrichXmllintIssuesInput): ValidationIssue[] => {
  if (!model) {
    return issues.map((entry) => entry.issue);
  }

  const root = parseXmlInstance(request.messageText);
  const context: EnrichmentContext = { model, root, xmlText: request.messageText };
  return issues.map((entry) => enrichXmllintIssue(entry, context));
};

export const enrichXmllintIssue = (entry: XmllintIssueEntry, context: EnrichmentContext): ValidationIssue => {
  const { issue } = entry;
  if (!context.root || !issue.messageRange) {
    return enrichConstraintIssue(entry, context) ?? issue;
  }

  if (issue.code === 'unexpected-xml-element') {
    return enrichUnexpectedElement(entry, context) ?? issue;
  }

  if (issue.code === 'missing-xml-element') {
    return enrichMissingElement(entry, context) ?? issue;
  }

  if (issue.code === 'missing-xml-attribute') {
    return enrichMissingAttribute(entry, context) ?? issue;
  }

  return enrichConstraintIssue(entry, context) ?? issue;
};

const enrichUnexpectedElement = (entry: XmllintIssueEntry, context: EnrichmentContext) => {
  const { issue, rawMessage } = entry;
  const actualName = diagnosticLocalName(elementNameFromRawMessage(rawMessage) ?? elementAtIssueLine(issue, context)?.localName ?? '');
  const expectedNames = expectedElementNames(rawMessage || issue.message || (issue.expected ?? ''));
  const actualNode = elementAtIssueLine(issue, context);
  const parentNode = actualNode?.parent;
  if (!actualName || expectedNames.length === 0 || !parentNode) {
    return undefined;
  }

  const parentContext = schemaContextForNode(context.model, context.root, parentNode);
  if (!parentContext?.group) {
    return undefined;
  }

  const sequence = groupSequence(context.model, parentContext.group);
  const actualIndex = sequence.findIndex((item) => namesEqual(item.name, actualName));
  const expectedItem = sequence.find((item) => expectedNames.some((name) => namesEqual(item.name, name)));
  const expectedIndex = expectedItem ? sequence.indexOf(expectedItem) : -1;

  if (expectedItem && actualIndex >= 0 && expectedIndex >= 0 && expectedIndex < actualIndex && expectedItem.required) {
    const expectedName = expectedItem.name;
    return makeIssue({
      ...baseWithoutId(issue),
      code: 'missing-xml-element',
      title: `${expectedName} is missing before ${actualName}`,
      message: `<${expectedName}> is required before <${actualName}> under ${parentContext.path}.`,
      path: `${parentContext.path}/${expectedName}`,
      expected: `<${expectedName}> before <${actualName}>`,
      actual: `<${actualName}>`,
      schemaRange: expectedItem.element.range,
      schemaSourceId: expectedItem.element.sourceId,
      schemaSourceLabel: expectedItem.element.sourceLabel,
      messageRange: actualNode.range,
      hint: `Add <${expectedName}>...</${expectedName}> before <${actualName}>, or reorder the XML to match the XSD sequence.`,
    });
  }

  if (expectedItem && actualIndex > expectedIndex && expectedIndex >= 0) {
    return makeIssue({
      ...baseWithoutId(issue),
      code: 'xsd-sequence-order',
      title: `${actualName} is in the wrong sequence position`,
      message: `<${actualName}> is declared in the XSD, but it appears in the wrong order under ${parentContext.path}.`,
      path: `${parentContext.path}/${actualName}`,
      expected: formatSequence(sequence),
      actual: `<${actualName}>`,
      schemaRange: parentContext.group.range,
      schemaSourceId: parentContext.group.sourceId,
      schemaSourceLabel: parentContext.group.sourceLabel,
      messageRange: actualNode.range,
      hint: `Reorder the XML children under ${parentContext.path} to match the XSD sequence: ${formatSequence(sequence)}.`,
    });
  }

  if (sequence.length > 0) {
    return makeIssue({
      ...baseWithoutId(issue),
      title: `Unexpected XML element: ${actualName}`,
      message: `<${actualName}> is not declared under ${parentContext.path}.`,
      path: `${parentContext.path}/${actualName}`,
      expected: sequence.map((item) => `<${item.name}>`).join(', '),
      actual: `<${actualName}>`,
      schemaRange: parentContext.group.range,
      schemaSourceId: parentContext.group.sourceId,
      schemaSourceLabel: parentContext.group.sourceLabel,
      messageRange: actualNode.range,
      hint: `Remove <${actualName}> or add it to the XSD model for ${parentContext.path}.`,
    });
  }

  return undefined;
};

const enrichMissingElement = (entry: XmllintIssueEntry, context: EnrichmentContext) => {
  const { issue, rawMessage } = entry;
  const expectedName = expectedElementNames(rawMessage || issue.message || (issue.expected ?? ''))[0];
  const parentNode = elementAtIssueLine(issue, context);
  if (!expectedName || !parentNode) {
    return undefined;
  }

  const parentContext = schemaContextForNode(context.model, context.root, parentNode);
  const expectedItem = parentContext?.group
    ? groupSequence(context.model, parentContext.group).find((item) => namesEqual(item.name, expectedName))
    : undefined;
  if (!parentContext || !expectedItem) {
    return undefined;
  }

  const minOccurs = expectedItem.element.minOccurs;
  return makeIssue({
    ...baseWithoutId(issue),
    title: `Missing required XML element: ${expectedItem.name}`,
    message: `<${expectedItem.name}> is required under ${parentContext.path}.`,
    path: `${parentContext.path}/${expectedItem.name}`,
    expected: minOccurs > 1 ? `<${expectedItem.name}> at least ${minOccurs} times` : `<${expectedItem.name}>`,
    actual: 'Missing element',
    schemaRange: expectedItem.element.range,
    schemaSourceId: expectedItem.element.sourceId,
    schemaSourceLabel: expectedItem.element.sourceLabel,
    messageRange: parentNode.range,
    hint: `Add <${expectedItem.name}>...</${expectedItem.name}> inside ${parentContext.path}.`,
  });
};

const enrichMissingAttribute = (entry: XmllintIssueEntry, context: EnrichmentContext) => {
  const { issue, rawMessage } = entry;
  const attributeName = /attribute '([^']+)'/i.exec(rawMessage)?.[1];
  const targetNode = elementAtIssueLine(issue, context);
  const targetContext = targetNode ? schemaContextForNode(context.model, context.root, targetNode) : undefined;
  if (!attributeName || !targetNode || !targetContext) {
    return undefined;
  }

  return makeIssue({
    ...baseWithoutId(issue),
    title: `Missing required XML attribute: ${localName(attributeName)}`,
    message: `<${targetNode.localName}> requires @${localName(attributeName)} at ${targetContext.path}.`,
    path: `${targetContext.path}/@${localName(attributeName)}`,
    expected: `@${localName(attributeName)}`,
    actual: 'Missing attribute',
    hint: `Add ${localName(attributeName)}="..." to <${targetNode.localName}>.`,
  });
};

const enrichConstraintIssue = (entry: XmllintIssueEntry, context: EnrichmentContext) => {
  const { issue, rawMessage } = entry;
  const targetNode = elementAtIssueLine(issue, context);
  const targetContext = targetNode ? schemaContextForNode(context.model, context.root, targetNode) : undefined;
  const label = targetNode?.localName ?? issue.path?.split('/').filter(Boolean).at(-1) ?? 'Value';

  if (issue.code === 'xsd-enumeration') {
    const values = enumValuesFromMessage(rawMessage || issue.message);
    const actual = issue.actual ?? quotedValue(rawMessage || issue.message);
    if (values.length === 0 || !actual) {
      return undefined;
    }

    return makeIssue({
      ...baseWithoutId(issue),
      title: `Value is not allowed: ${label}`,
      message: `${label} must be one of ${formatList(values)}, but the XML value is "${actual}".`,
      path: targetContext?.path ?? issue.path,
      expected: values.join(', '),
      actual,
      messageRange: targetNode?.range ?? issue.messageRange,
      hint: `Change <${label}> to one of: ${formatList(values)}.`,
    });
  }

  if (issue.code === 'xml-element-type') {
    const expectedType = typeNameFromMessage(rawMessage || issue.message) ?? issue.expected;
    const actual = issue.actual ?? quotedValue(rawMessage || issue.message) ?? targetNode?.text.trim();
    if (!expectedType) {
      return undefined;
    }

    return makeIssue({
      ...baseWithoutId(issue),
      title: `Value has wrong type: ${label}`,
      message: `${label} must be ${expectedType}${actual ? `, but the XML value is "${actual}"` : ''}.`,
      path: targetContext?.path ?? issue.path,
      expected: expectedType,
      actual,
      messageRange: targetNode?.range ?? issue.messageRange,
      hint: typeHint(expectedType, label),
    });
  }

  return undefined;
};

const elementAtIssueLine = (issue: ValidationIssue, context: EnrichmentContext) => {
  if (!context.root || !issue.messageRange) {
    return undefined;
  }
  return deepestElementAtLine(context.root, issue.messageRange.startLineNumber);
};

const deepestElementAtLine = (node: XmlElementNode, line: number): XmlElementNode | undefined => {
  if (!lineInRange(node.range, line)) {
    return undefined;
  }

  for (const child of node.children) {
    const match = deepestElementAtLine(child, line);
    if (match) {
      return match;
    }
  }

  return node;
};

const schemaContextForNode = (
  model: XsdSchemaModel,
  root: XmlElementNode | undefined,
  target: XmlElementNode,
): SchemaElementContext | undefined => {
  if (!root) {
    return undefined;
  }

  const rootDeclaration = model.globalElements.get(normalizeTypeName(root.localName)) ??
    (model.rootElementName ? model.globalElements.get(normalizeTypeName(model.rootElementName)) : undefined);
  if (!rootDeclaration) {
    return undefined;
  }

  return visitSchemaContext(model, rootDeclaration, root, target, '');
};

const visitSchemaContext = (
  model: XsdSchemaModel,
  declaration: XsdElementDecl,
  node: XmlElementNode,
  target: XmlElementNode,
  parentPath: string,
): SchemaElementContext | undefined => {
  const resolved = resolveElement(model, declaration);
  const path = `${parentPath}/${resolved.name}`;
  const group = groupForElement(model, resolved);
  const context: SchemaElementContext = { node, declaration: resolved, path, group };
  if (node === target) {
    return context;
  }

  if (!group) {
    return undefined;
  }

  for (const child of node.children) {
    const childDeclaration = group.elements.find((element) => namesEqual(resolvedElementName(model, element), child.localName));
    if (!childDeclaration) {
      continue;
    }
    const match = visitSchemaContext(model, childDeclaration, child, target, path);
    if (match) {
      return match;
    }
  }

  return undefined;
};

const groupForElement = (model: XsdSchemaModel, element: XsdElementDecl) => {
  const typeName = element.typeName ? normalizeTypeName(element.typeName) : undefined;
  const complexType = typeName ? model.complexTypes.get(typeName) : undefined;
  return complexType?.group ?? complexType?.complexContent?.group;
};

const groupSequence = (model: XsdSchemaModel, group: XsdParticleGroup) =>
  group.elements.map((element) => {
    const resolved = resolveElement(model, element);
    return {
      name: resolved.name,
      element,
      required: element.minOccurs > 0,
      occurrence: `${element.minOccurs}..${formatMaxOccurs(element.maxOccurs)}`,
    };
  });

const resolveElement = (model: XsdSchemaModel, element: XsdElementDecl) => {
  if (!element.refName) {
    return element;
  }
  return model.globalElements.get(normalizeTypeName(element.refName)) ?? element;
};

const resolvedElementName = (model: XsdSchemaModel, element: XsdElementDecl) => resolveElement(model, element).name;

const parseXmlInstance = (xmlText: string): XmlElementNode | undefined => {
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

  try {
    const parsed = parser.parse(xmlText) as RawNode[];
    const locator = new XmlRangeLocator(xmlText);
    return parsed.map((node) => toXmlElement(node, locator, xmlText)).find(Boolean);
  } catch {
    return undefined;
  }
};

const toXmlElement = (
  node: RawNode,
  locator: XmlRangeLocator,
  xmlText: string,
  parent?: XmlElementNode,
): XmlElementNode | undefined => {
  const tagName = Object.keys(node).find((key) => key !== ATTRIBUTE_KEY && key !== TEXT_KEY);
  if (!tagName || tagName.startsWith('?') || tagName.startsWith('!')) {
    return undefined;
  }

  const local = localName(tagName);
  const element: XmlElementNode = {
    name: tagName,
    localName: local,
    children: [],
    text: '',
    range: locator.next(local),
    parent,
  };

  const rawChildren = Array.isArray(node[tagName]) ? (node[tagName] as RawNode[]) : [];
  const text: string[] = [];
  for (const child of rawChildren) {
    if (typeof child[TEXT_KEY] === 'string') {
      text.push(String(child[TEXT_KEY]));
      continue;
    }
    const childElement = toXmlElement(child, locator, xmlText, element);
    if (childElement) {
      element.children.push(childElement);
    }
  }
  element.text = text.join('');
  return element;
};

class XmlRangeLocator {
  private cursor = 0;

  constructor(private readonly source: string) {}

  next(localTagName: string): TextRange {
    const tagPattern = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${escapeRegExp(localTagName)}\\b[^>]*>`, 'gi');
    tagPattern.lastIndex = this.cursor;
    const match = tagPattern.exec(this.source) ?? findTagFromStart(this.source, localTagName);
    if (!match) {
      return wholeDocumentRange(this.source);
    }

    const selfClosingPattern = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${escapeRegExp(localTagName)}\\b[^>]*/>`, 'i');
    const closing = selfClosingPattern.test(match[0]) ? undefined : findClosingTagOffset(this.source, match.index, localTagName);
    const end = closing ?? match.index + match[0].length;
    this.cursor = match.index + match[0].length;
    return rangeFromOffset(this.source, match.index, end - match.index);
  }
}

const baseWithoutId = (issue: ValidationIssue): Omit<ValidationIssue, 'id'> => ({
  severity: issue.severity,
  code: issue.code,
  title: issue.title,
  message: issue.message,
  hint: issue.hint,
  path: issue.path,
  expected: issue.expected,
  actual: issue.actual,
  schemaRange: issue.schemaRange,
  messageRange: issue.messageRange,
  schemaPointer: issue.schemaPointer,
  messagePointer: issue.messagePointer,
  schemaSourceId: issue.schemaSourceId,
  schemaSourceLabel: issue.schemaSourceLabel,
});

const elementNameFromRawMessage = (message: string) => /Element '([^']+)'/i.exec(message)?.[1];

const expectedElementNames = (message: string) => {
  const expected = /Expected is \(([^)]+)\)/i.exec(message)?.[1] ?? /Expected is ([^.]+)/i.exec(message)?.[1];
  if (!expected) {
    return [];
  }
  return expected
    .split(/[|,]/)
    .map((value) => diagnosticLocalName(value.replace(/[()<>]/g, '').trim()))
    .filter(Boolean);
};

const enumValuesFromMessage = (message: string) => {
  const set = /\{([^}]+)\}/.exec(message)?.[1];
  if (!set) {
    return [];
  }
  return set
    .split(',')
    .map((value) => value.replace(/^['\s]+|['\s]+$/g, ''))
    .filter(Boolean);
};

const quotedValue = (message: string) => /value '([^']+)'/i.exec(message)?.[1] ?? /The value '([^']+)'/i.exec(message)?.[1];

const typeNameFromMessage = (message: string) =>
  /type definition '([^']+)'/i.exec(message)?.[1] ??
  /atomic type '([^']+)'/i.exec(message)?.[1] ??
  /type '([^']+)'/i.exec(message)?.[1];

const typeHint = (typeName: string, label: string) => {
  const normalized = normalizeTypeName(typeName);
  const examples: Record<string, string> = {
    'xs:date': '2026-05-23',
    date: '2026-05-23',
    'xs:dateTime': '2026-05-23T18:30:00Z',
    dateTime: '2026-05-23T18:30:00Z',
    'xs:time': '18:30:00Z',
    'xs:integer': '42',
    integer: '42',
    'xs:int': '42',
    int: '42',
    'xs:decimal': '42.5',
    decimal: '42.5',
    'xs:boolean': 'true',
    boolean: 'true',
  };
  const example = examples[normalized];
  return example
    ? `Change <${label}> to a valid ${typeName} value, for example ${example}.`
    : `Change <${label}> to a valid ${typeName} value.`;
};

const formatList = (values: string[]) => {
  if (values.length <= 2) {
    return values.join(' or ');
  }
  return `${values.slice(0, -1).join(', ')}, or ${values.at(-1)}`;
};

const formatSequence = (sequence: Array<{ name: string; required: boolean; occurrence: string }>) =>
  sequence
    .map((item, index) => `${index + 1}. <${item.name}>${item.required ? '' : ' optional'} (${item.occurrence})`)
    .join(' -> ');

const diagnosticLocalName = (name: string) => localName(name).replace(/^.*}/, '');

const namesEqual = (left: string, right: string) =>
  diagnosticLocalName(left).toLowerCase() === diagnosticLocalName(right).toLowerCase();

const lineInRange = (range: TextRange, line: number) =>
  line >= range.startLineNumber && line <= range.endLineNumber;

const findClosingTagOffset = (source: string, start: number, localTagName: string) => {
  const tagName = `(?:[A-Za-z_][\\w.-]*:)?${escapeRegExp(localTagName)}`;
  const closePattern = new RegExp(`</${tagName}>`, 'i');
  const match = closePattern.exec(source.slice(start));
  return match ? start + match.index + match[0].length : undefined;
};

const findTagFromStart = (source: string, localTagName: string) => {
  const pattern = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${escapeRegExp(localTagName)}\\b[^>]*>`, 'i');
  return pattern.exec(source);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');