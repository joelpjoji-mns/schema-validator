import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { findRegexRange, makeIssue, rangeFromLineColumn, summarizeIssues, wholeDocumentRange } from '../textRanges';
import type { TextRange, ValidationIssue, ValidationRequest, ValidationResult, ValidatorAdapter } from '../types';

interface XsdChildRule {
  name: string;
  type: string;
  minOccurs: number;
  maxOccurs: number;
  range: TextRange;
}

interface XsdAttributeRule {
  name: string;
  type: string;
  required: boolean;
  range: TextRange;
}

interface XsdRootRule {
  name: string;
  containerType: 'sequence' | 'choice' | 'all';
  range: TextRange;
  children: XsdChildRule[];
  attributes: XsdAttributeRule[];
}

export const xmlXsdAdapter: ValidatorAdapter = {
  id: 'xml-xsd',
  label: 'XML + XSD',
  schemaFormats: ['xsd'],
  messageFormats: ['xml'],
  validate: (request) => validateXmlXsd(request),
};

export const validateXmlXsd = (request: ValidationRequest): ValidationResult => {
  const start = performance.now();
  const issues: ValidationIssue[] = [];

  if (!request.schemaText.trim()) {
    issues.push(
      makeIssue({
        code: 'empty-xsd',
        title: 'Empty XSD schema',
        message: 'Paste or upload an XSD schema before validating XML.',
        schemaRange: wholeDocumentRange(request.schemaText),
      }),
    );
  }

  if (!request.messageText.trim()) {
    issues.push(
      makeIssue({
        code: 'empty-xml',
        title: 'Empty XML message',
        message: 'Paste or upload an XML message before validating.',
        messageRange: wholeDocumentRange(request.messageText),
      }),
    );
  }

  if (issues.length > 0) {
    return resultFromIssues(start, issues);
  }

  const xsdSyntax = XMLValidator.validate(request.schemaText, { allowBooleanAttributes: true });
  if (xsdSyntax !== true) {
    const err = xsdSyntax.err;
    issues.push(
      makeIssue({
        code: 'malformed-xsd',
        title: 'Malformed XSD',
        message: err.msg,
        schemaRange: rangeFromLineColumn(request.schemaText, err.line, err.col),
        hint: 'Fix the highlighted XSD syntax before validating the XML instance.',
      }),
    );
    return resultFromIssues(start, issues);
  }

  const xmlSyntax = XMLValidator.validate(request.messageText, { allowBooleanAttributes: true });
  if (xmlSyntax !== true) {
    const err = xmlSyntax.err;
    issues.push(
      makeIssue({
        code: 'malformed-xml',
        title: 'Malformed XML',
        message: err.msg,
        messageRange: rangeFromLineColumn(request.messageText, err.line, err.col),
        hint: 'The XML parser stopped at the highlighted character, so schema validation cannot continue yet.',
      }),
    );
    return resultFromIssues(start, issues);
  }

  const rootRule = extractRootRule(request.schemaText);
  if (!rootRule) {
    issues.push(
      makeIssue({
        code: 'xsd-root-not-found',
        title: 'No root element rule found',
        message:
          'This XSD-lite validator could not find a top-level xs:element declaration to use as the document root.',
        schemaRange: wholeDocumentRange(request.schemaText),
        hint: 'Add a top-level xs:element or choose a schema with an explicit root element.',
      }),
    );
    return resultFromIssues(start, issues);
  }

  const rootName = getXmlRootName(request.messageText);
  if (!rootName) {
    issues.push(
      makeIssue({
        code: 'xml-root-not-found',
        title: 'No XML root element found',
        message: 'The XML parser accepted the document, but no root element could be located.',
        messageRange: wholeDocumentRange(request.messageText),
      }),
    );
    return resultFromIssues(start, issues);
  }

  if (rootName !== rootRule.name) {
    issues.push(
      makeIssue({
        code: 'xml-root-mismatch',
        title: `Wrong XML root: ${rootName}`,
        message: `The XML root is <${rootName}>, but the XSD declares <${rootRule.name}> as the root element.`,
        expected: `<${rootRule.name}>`,
        actual: `<${rootName}>`,
        schemaRange: rootRule.range,
        messageRange: findElementRange(request.messageText, rootName) ?? wholeDocumentRange(request.messageText),
      }),
    );
    return resultFromIssues(start, issues);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
  });
  const parsed = parser.parse(request.messageText) as Record<string, unknown>;
  const parsedRootKey = findLocalKey(parsed, rootRule.name);
  const rootValue = parsedRootKey ? (parsed[parsedRootKey] as Record<string, unknown> | string | undefined) : undefined;
  const rootObject = typeof rootValue === 'object' && rootValue !== null ? rootValue : {};

  for (const attribute of rootRule.attributes) {
    const value = getAttributeValue(rootObject, attribute.name);
    if (attribute.required && value === undefined) {
      issues.push(
        makeIssue({
          code: 'missing-xml-attribute',
          title: `Missing required attribute: ${attribute.name}`,
          message: `The root element is missing the required "${attribute.name}" attribute.`,
          expected: `@${attribute.name}`,
          actual: 'Missing attribute',
          schemaRange: attribute.range,
          messageRange: findElementRange(request.messageText, rootRule.name) ?? wholeDocumentRange(request.messageText),
          hint: `Add ${attribute.name}="..." to the highlighted XML element.`,
        }),
      );
    } else if (value !== undefined && !valueMatchesXsdType(String(value), attribute.type)) {
      issues.push(
        makeIssue({
          code: 'xml-attribute-type',
          title: `Attribute has wrong type: ${attribute.name}`,
          message: `The "${attribute.name}" attribute must be ${attribute.type}, but the highlighted value is not valid for that type.`,
          expected: attribute.type,
          actual: String(value),
          schemaRange: attribute.range,
          messageRange:
            findAttributeRange(request.messageText, rootRule.name, attribute.name) ??
            findElementRange(request.messageText, rootRule.name),
        }),
      );
    }
  }

  const childStates = rootRule.children.map((child) => {
    const value = getChildValue(rootObject, child.name);
    const values = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
    return {
      child,
      value,
      values,
      isMissing: values.length === 0,
    };
  });

  if (rootRule.containerType === 'choice') {
    const presentChoices = childStates.filter((state) => !state.isMissing);
    if (presentChoices.length === 0 && rootRule.children.some((child) => child.minOccurs > 0)) {
      issues.push(
        makeIssue({
          code: 'xsd-choice-missing',
          title: 'Missing XML choice element',
          message: `The XSD choice requires one of these elements inside <${rootRule.name}>: ${rootRule.children
            .map((child) => `<${child.name}>`)
            .join(', ')}.`,
          expected: rootRule.children.map((child) => `<${child.name}>`).join(' or '),
          actual: 'No choice element present',
          schemaRange: rootRule.range,
          messageRange: findElementRange(request.messageText, rootRule.name) ?? wholeDocumentRange(request.messageText),
        }),
      );
    } else if (presentChoices.length > 1) {
      issues.push(
        makeIssue({
          code: 'xsd-choice-too-many',
          title: 'Too many XML choice elements',
          message: `The XSD choice allows only one of ${rootRule.children
            .map((child) => `<${child.name}>`)
            .join(', ')}, but the XML includes ${presentChoices.length}.`,
          expected: 'Exactly one choice element',
          actual: presentChoices.map((state) => `<${state.child.name}>`).join(', '),
          schemaRange: rootRule.range,
          messageRange:
            findElementRange(request.messageText, presentChoices[1]?.child.name ?? rootRule.name) ??
            wholeDocumentRange(request.messageText),
        }),
      );
    }
  }

  for (const { child, values, isMissing } of childStates) {
    if (rootRule.containerType !== 'choice' && child.minOccurs > 0 && isMissing) {
      issues.push(
        makeIssue({
          code: 'missing-xml-element',
          title: `Missing required element: ${child.name}`,
          message: `The XSD requires <${child.name}> inside <${rootRule.name}>, but the XML message does not contain it.`,
          expected: `<${child.name}>`,
          actual: 'Missing element',
          schemaRange: child.range,
          messageRange: findElementRange(request.messageText, rootRule.name) ?? wholeDocumentRange(request.messageText),
          hint: `Add <${child.name}>...</${child.name}> inside the highlighted parent element.`,
        }),
      );
      continue;
    }

    if (!isMissing) {
      if (values.length > child.maxOccurs) {
        issues.push(
          makeIssue({
            code: 'xsd-max-occurs',
            title: `Too many XML elements: ${child.name}`,
            message: `<${child.name}> appears ${values.length} times, but the XSD allows at most ${formatMaxOccurs(child.maxOccurs)}.`,
            expected: `maxOccurs=${formatMaxOccurs(child.maxOccurs)}`,
            actual: `${values.length} occurrence${values.length === 1 ? '' : 's'}`,
            schemaRange: child.range,
            messageRange:
              findElementRange(request.messageText, child.name, child.maxOccurs) ??
              findElementRange(request.messageText, child.name) ??
              findElementRange(request.messageText, rootRule.name),
          }),
        );
      }

      values.forEach((item, itemIndex) => {
        const textValue = xmlTextValue(item);
        const messageRange =
          findElementRange(request.messageText, child.name, itemIndex) ??
          findElementRange(request.messageText, rootRule.name);

        if (isPrimitiveXsdType(child.type) && hasXmlChildElements(item)) {
          issues.push(
            makeIssue({
              code: 'xml-element-type',
              title: `Element has wrong type: ${child.name}`,
              message: `<${child.name}> must be ${child.type}, but it contains nested XML elements instead of a simple text value.`,
              expected: child.type,
              actual: 'Nested XML elements',
              schemaRange: child.range,
              messageRange,
              hint: 'Replace the nested XML with a simple text value or update the XSD element type.',
            }),
          );
        } else if (!hasXmlContent(item, child.type) && child.minOccurs > 0) {
          issues.push(
            makeIssue({
              code: 'empty-xml-element',
              title: `Empty required element: ${child.name}`,
              message: `<${child.name}> is present but empty.`,
              expected: child.type,
              actual: 'Empty value',
              schemaRange: child.range,
              messageRange,
            }),
          );
        } else if (!valueMatchesXsdType(textValue, child.type)) {
          issues.push(
            makeIssue({
              code: 'xml-element-type',
              title: `Element has wrong type: ${child.name}`,
              message: `<${child.name}> must be ${child.type}, but "${textValue}" is not valid for that type.`,
              expected: child.type,
              actual: textValue,
              schemaRange: child.range,
              messageRange,
              hint: 'Change the highlighted XML text or update the XSD element type.',
            }),
          );
        }
      });
    }
  }

  const allowedChildren = new Set(rootRule.children.map((child) => child.name));
  for (const key of Object.keys(rootObject)) {
    const keyName = localName(key);
    if (!key.startsWith('@_') && key !== '#text' && !allowedChildren.has(keyName)) {
      issues.push(
        makeIssue({
          code: 'unexpected-xml-element',
          title: `Unexpected XML element: ${keyName}`,
          message: `<${keyName}> appears under <${rootRule.name}>, but the XSD sequence does not declare it.`,
          expected: [...allowedChildren].join(', ') || 'No child elements',
          actual: `<${keyName}>`,
          schemaRange: rootRule.range,
          messageRange: findElementRange(request.messageText, keyName) ?? wholeDocumentRange(request.messageText),
          hint: 'Remove the highlighted element or add it to the XSD sequence.',
        }),
      );
    }
  }

  return resultFromIssues(start, issues);
};

const extractRootRule = (xsdText: string): XsdRootRule | undefined => {
  const elementMatch = /<(?:xs|xsd):element\b([^>]*)>/i.exec(xsdText);
  if (!elementMatch) {
    return undefined;
  }

  const name = getXmlAttribute(elementMatch[1], 'name');
  if (!name) {
    return undefined;
  }

  const rootStart = elementMatch.index;
  const rootEnd = findClosingTagOffset(xsdText, rootStart, 'element') ?? elementMatch.index + elementMatch[0].length;
  const rootBlock = xsdText.slice(rootStart, rootEnd);
  const rootRange = rangeFromOffsetSafe(xsdText, rootStart, rootEnd - rootStart);
  const containerType = rootBlock.includes(':choice') ? 'choice' : rootBlock.includes(':all') ? 'all' : 'sequence';

  const children: XsdChildRule[] = [];
  const childPattern = /<(?:xs|xsd):element\b([^>]*?)\/?>(?!\s*<(?:xs|xsd):complexType)/gi;
  let childMatch: RegExpExecArray | null;

  while ((childMatch = childPattern.exec(rootBlock))) {
    const absoluteStart = rootStart + childMatch.index;
    if (absoluteStart === rootStart) {
      continue;
    }

    const attributes = childMatch[1];
    const childName = getXmlAttribute(attributes, 'name');
    if (!childName) {
      continue;
    }

    children.push({
      name: childName,
      type: normalizeXsdType(getXmlAttribute(attributes, 'type') ?? 'xs:string'),
      minOccurs: parseOccurs(getXmlAttribute(attributes, 'minOccurs'), 1),
      maxOccurs: parseMaxOccurs(getXmlAttribute(attributes, 'maxOccurs')),
      range: rangeFromOffsetSafe(xsdText, absoluteStart, childMatch[0].length),
    });
  }

  const attributes: XsdAttributeRule[] = [];
  const attributePattern = /<(?:xs|xsd):attribute\b([^>]*?)\/?>(?:<\/(?:xs|xsd):attribute>)?/gi;
  let attributeMatch: RegExpExecArray | null;

  while ((attributeMatch = attributePattern.exec(rootBlock))) {
    const attributesText = attributeMatch[1];
    const attributeName = getXmlAttribute(attributesText, 'name');
    if (!attributeName) {
      continue;
    }

    attributes.push({
      name: attributeName,
      type: normalizeXsdType(getXmlAttribute(attributesText, 'type') ?? 'xs:string'),
      required: getXmlAttribute(attributesText, 'use') === 'required',
      range: rangeFromOffsetSafe(xsdText, rootStart + attributeMatch.index, attributeMatch[0].length),
    });
  }

  return { name, containerType, range: rootRange, children, attributes };
};

const getXmlRootName = (xmlText: string) => /<(?!\?|!)(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)\b/.exec(xmlText)?.[1];

const getXmlAttribute = (source: string, name: string) =>
  new RegExp(`${escapeRegExp(name)}\\s*=\\s*["']([^"']*)["']`, 'i').exec(source)?.[1];

const findClosingTagOffset = (source: string, start: number, localName: string) => {
  const closePattern = new RegExp(`</(?:xs|xsd):${localName}>`, 'i');
  const close = closePattern.exec(source.slice(start));
  return close ? start + close.index + close[0].length : undefined;
};

const normalizeXsdType = (type: string) => type.replace(/^xsd:/, 'xs:');

const parseOccurs = (value: string | undefined, fallback: number) => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const parseMaxOccurs = (value: string | undefined) => {
  if (value === 'unbounded') {
    return Number.POSITIVE_INFINITY;
  }

  return parseOccurs(value, 1);
};

const formatMaxOccurs = (value: number) => (value === Number.POSITIVE_INFINITY ? 'unbounded' : String(value));

const primitiveXsdTypes = new Set([
  'xs:string',
  'string',
  'xs:integer',
  'xs:int',
  'xs:long',
  'xs:short',
  'integer',
  'int',
  'xs:decimal',
  'xs:double',
  'xs:float',
  'decimal',
  'double',
  'float',
  'xs:boolean',
  'boolean',
  'xs:date',
  'date',
  'xs:dateTime',
  'dateTime',
]);

const isPrimitiveXsdType = (type: string) => primitiveXsdTypes.has(normalizeXsdType(type));

const valueMatchesXsdType = (value: string, type: string) => {
  const normalized = normalizeXsdType(type);
  if (['xs:string', 'string'].includes(normalized)) {
    return true;
  }
  if (['xs:integer', 'xs:int', 'xs:long', 'xs:short', 'integer', 'int'].includes(normalized)) {
    return /^[-+]?\d+$/.test(value.trim());
  }
  if (['xs:decimal', 'xs:double', 'xs:float', 'decimal', 'double', 'float'].includes(normalized)) {
    return /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim());
  }
  if (['xs:boolean', 'boolean'].includes(normalized)) {
    return /^(true|false|0|1)$/.test(value.trim());
  }
  if (['xs:date', 'date'].includes(normalized)) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  }
  if (['xs:dateTime', 'dateTime'].includes(normalized)) {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value.trim());
  }
  return true;
};

const xmlTextValue = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'object' && '#text' in value) {
    return String((value as Record<string, unknown>)['#text']);
  }
  return String(value);
};

const isXmlObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasXmlChildElements = (value: unknown) =>
  isXmlObject(value) && Object.keys(value).some((key) => !key.startsWith('@_') && key !== '#text');

const hasXmlAttributes = (value: unknown) =>
  isXmlObject(value) && Object.keys(value).some((key) => key.startsWith('@_'));

const hasXmlContent = (value: unknown, type: string) => {
  if (xmlTextValue(value).trim() !== '') {
    return true;
  }

  return !isPrimitiveXsdType(type) && (hasXmlChildElements(value) || hasXmlAttributes(value));
};

const localName = (name: string) => name.split(':').at(-1) ?? name;

const findLocalKey = (record: Record<string, unknown>, name: string) =>
  Object.keys(record).find((key) => localName(key.replace(/^@_/, '')) === name);

const getChildValue = (record: Record<string, unknown>, name: string) => {
  const key = Object.keys(record).find((candidate) => !candidate.startsWith('@_') && localName(candidate) === name);
  return key ? record[key] : undefined;
};

const getAttributeValue = (record: Record<string, unknown>, name: string) => {
  const key = Object.keys(record).find(
    (candidate) => candidate.startsWith('@_') && localName(candidate.slice(2)) === name,
  );
  return key ? record[key] : undefined;
};

const findElementRange = (xmlText: string, name: string, occurrence = 0) => {
  const tagName = `(?:[A-Za-z_][\\w.-]*:)?${escapeRegExp(localName(name))}`;
  const pattern = new RegExp(`<${tagName}\\b[^>]*>(?:[\\s\\S]*?<\\/${tagName}>)?|<${tagName}\\b[^>]*/>`, 'g');
  let match: RegExpExecArray | null;
  let current = 0;

  while ((match = pattern.exec(xmlText))) {
    if (current === occurrence) {
      return rangeFromOffsetSafe(xmlText, match.index, match[0].length);
    }
    current += 1;
  }

  return undefined;
};

const findAttributeRange = (xmlText: string, elementName: string, attributeName: string) =>
  findRegexRange(
    xmlText,
    new RegExp(
      `<(?:[A-Za-z_][\\w.-]*:)?${escapeRegExp(localName(elementName))}\\b[^>]*((?:[A-Za-z_][\\w.-]*:)?${escapeRegExp(localName(attributeName))}\\s*=\\s*["'][^"']*["'])`,
      'i',
    ),
    1,
  );

const rangeFromOffsetSafe = (text: string, offset: number, length: number): TextRange => {
  const linesBefore = text.slice(0, offset).split(/\r?\n/);
  const startLineNumber = linesBefore.length;
  const startColumn = (linesBefore.at(-1) ?? '').length + 1;
  const chunk = text.slice(offset, offset + Math.max(length, 1));
  const chunkLines = chunk.split(/\r?\n/);
  const endLineNumber = startLineNumber + chunkLines.length - 1;
  const endColumn = chunkLines.length === 1 ? startColumn + chunk.length : (chunkLines.at(-1) ?? '').length + 1;

  return { startLineNumber, startColumn, endLineNumber, endColumn: Math.max(endColumn, startColumn + 1) };
};

const resultFromIssues = (startedAt: number, issues: ValidationIssue[]): ValidationResult => ({
  ok: issues.length === 0,
  adapterId: 'xml-xsd',
  summary: summarizeIssues(issues, 'XML + XSD'),
  durationMs: Math.max(0, performance.now() - startedAt),
  issues,
});

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
