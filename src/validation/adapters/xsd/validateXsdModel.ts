import { XMLParser } from 'fast-xml-parser';
import { findRegexRange, makeIssue, rangeFromOffset, wholeDocumentRange } from '../../textRanges';
import type { TextRange, ValidationIssue } from '../../types';
import { formatMaxOccurs, localName, normalizeTypeName } from './parseXsdModel';
import type {
    XsdAttributeDecl,
    XsdComplexType,
    XsdElementDecl,
    XsdParticleGroup,
    XsdRestriction,
    XsdSchemaModel,
} from './types';

const ATTRIBUTE_KEY = ':@';
const TEXT_KEY = '#text';
const MAX_RECURSION_DEPTH = 80;
const MAX_VALIDATION_NODES = 20_000;

type RawNode = Record<string, unknown>;

interface XmlAttributeValue {
  name: string;
  value: string;
  range?: TextRange;
}

interface XmlElementNode {
  name: string;
  localName: string;
  attributes: Map<string, XmlAttributeValue>;
  children: XmlElementNode[];
  text: string;
  range: TextRange;
}

interface ResolvedElement {
  declaration: XsdElementDecl;
  occurrence: Pick<XsdElementDecl, 'minOccurs' | 'maxOccurs' | 'range' | 'sourceId' | 'sourceLabel'>;
  missingRef?: string;
}

interface ResolvedAttribute {
  declaration: XsdAttributeDecl;
  use: Pick<XsdAttributeDecl, 'required' | 'prohibited' | 'range' | 'sourceId' | 'sourceLabel'>;
  missingRef?: string;
}

interface SchemaSourceOwner {
  sourceId: string;
  sourceLabel: string;
}

export const validateXmlAgainstXsdModel = (model: XsdSchemaModel, xmlText: string): ValidationIssue[] => {
  const root = parseXmlInstance(xmlText);
  const validator = new XsdModelValidator(model, xmlText, root);
  return validator.validate();
};

class XsdModelValidator {
  private readonly issues: ValidationIssue[] = [];
  private readonly activeTypes = new Set<string>();
  private visitedNodes = 0;

  constructor(
    private readonly model: XsdSchemaModel,
    private readonly xmlText: string,
    private readonly root?: XmlElementNode,
  ) {}

  validate(): ValidationIssue[] {
    this.addUnsupportedFeatureIssues();

    if (!this.root) {
      this.issues.push(
        makeIssue({
          code: 'xml-root-not-found',
          title: 'No XML root element found',
          message: 'The XML parser accepted the document, but no root element could be located.',
          messageRange: wholeDocumentRange(this.xmlText),
        }),
      );
      return this.issues;
    }

    const rootDeclaration = this.rootDeclaration(this.root.localName);
    if (!rootDeclaration) {
      this.issues.push(
        makeIssue({
          code: 'xsd-root-not-found',
          title: 'No root element rule found',
          message: 'The XSD does not contain a top-level xs:element declaration to use as the XML document root.',
          schemaRange: wholeDocumentRange(this.model.schemaText),
          schemaSourceId: this.model.primarySourceId,
          schemaSourceLabel: this.sourceLabel(this.model.primarySourceId),
          messageRange: this.root.range,
        }),
      );
      return this.issues;
    }

    if (this.root.localName !== rootDeclaration.name) {
      this.issues.push(
        makeIssue({
          code: 'xml-root-mismatch',
          title: `Wrong XML root: ${this.root.localName}`,
          message: `The XML root is <${this.root.localName}>, but the XSD declares <${rootDeclaration.name}> as the root element.`,
          expected: `<${rootDeclaration.name}>`,
          actual: `<${this.root.localName}>`,
          schemaRange: rootDeclaration.range,
          ...schemaSource(rootDeclaration),
          messageRange: this.root.range,
        }),
      );
      return this.issues;
    }

    this.validateElementOccurrences(rootDeclaration, [this.root], '', 0);
    return this.issues;
  }

  private addUnsupportedFeatureIssues() {
    for (const feature of this.model.unsupportedFeatures) {
      if (feature.code === 'xsd-nested-particle') {
        continue;
      }

      this.issues.push(
        makeIssue({
          code: 'unsupported-xsd-feature',
          title: feature.title,
          message: feature.message,
          schemaRange: feature.range,
          schemaSourceId: feature.sourceId,
          schemaSourceLabel: feature.sourceLabel,
          messageRange: this.root?.range,
          hint: 'Validation fails closed so this schema is not incorrectly reported as passing.',
        }),
      );
    }
  }

  private rootDeclaration(xmlRootName: string) {
    const matchingRoot = this.model.globalElements.get(normalizeTypeName(xmlRootName));
    if (matchingRoot) {
      return matchingRoot;
    }

    if (!this.model.rootElementName) {
      return undefined;
    }

    return this.model.globalElements.get(normalizeTypeName(this.model.rootElementName));
  }

  private validateElementOccurrences(
    declaration: XsdElementDecl,
    values: XmlElementNode[],
    parentPath: string,
    depth: number,
  ) {
    const resolved = this.resolveElement(declaration);
    if (resolved.missingRef) {
      this.issues.push(
        makeIssue({
          code: 'xsd-reference-not-found',
          title: `Missing XSD element reference: ${resolved.missingRef}`,
          message: `The schema references ${resolved.missingRef}, but no global element with that name was found.`,
          expected: resolved.missingRef,
          actual: 'Missing global element',
          schemaRange: declaration.range,
          ...schemaSource(declaration),
          messageRange: values[0]?.range ?? this.root?.range,
        }),
      );
      return;
    }

    const element = resolved.declaration;
    const occurrence = resolved.occurrence;
    const path = `${parentPath}/${element.name}`;

    if (values.length < occurrence.minOccurs) {
      this.issues.push(
        makeIssue({
          code: 'missing-xml-element',
          title: `Missing required element: ${element.name}`,
          message: `The XSD requires <${element.name}> at ${path}, but the XML message does not contain enough occurrences.`,
          path,
          expected: `minOccurs=${occurrence.minOccurs}`,
          actual: `${values.length} occurrence${values.length === 1 ? '' : 's'}`,
          schemaRange: occurrence.range,
          ...schemaSource(occurrence),
          messageRange: this.parentMessageRange(parentPath),
          hint: `Add <${element.name}>...</${element.name}> inside the highlighted parent element.`,
        }),
      );
      return;
    }

    if (values.length > occurrence.maxOccurs) {
      this.issues.push(
        makeIssue({
          code: 'xsd-max-occurs',
          title: `Too many XML elements: ${element.name}`,
          message: `<${element.name}> appears ${values.length} times, but the XSD allows at most ${formatMaxOccurs(occurrence.maxOccurs)}.`,
          path,
          expected: `maxOccurs=${formatMaxOccurs(occurrence.maxOccurs)}`,
          actual: `${values.length} occurrence${values.length === 1 ? '' : 's'}`,
          schemaRange: occurrence.range,
          ...schemaSource(occurrence),
          messageRange: values[firstExtraIndex(occurrence.maxOccurs)]?.range ?? values.at(-1)?.range,
        }),
      );
    }

    values.forEach((value) => this.validateElementValue(element, value, path, depth + 1));
  }

  private validateElementValue(element: XsdElementDecl, value: XmlElementNode, path: string, depth: number) {
    if (!this.canContinue(element, value, path, depth)) {
      return;
    }

    if (this.validateNilElement(element, value, path)) {
      return;
    }

    const typeName = element.typeName ? normalizeTypeName(element.typeName) : 'xs:string';
    const complexType = this.model.complexTypes.get(typeName);
    const simpleType = this.model.simpleTypes.get(typeName);

    if (complexType) {
      this.validateComplexElement(element, complexType, value, path, depth);
    } else if (simpleType) {
      this.validateSimpleValue(
        value.text.trim(),
        simpleType.baseType,
        simpleType.restrictions,
        element.name,
        element.range,
        value.range,
        path,
        simpleType,
      );
      if (value.children.length > 0) {
        this.addPrimitiveChildIssue(element.name, typeName, value, element.range, path, element);
      }
    } else if (isBuiltinType(typeName)) {
      this.validateSimpleValue(
        value.text.trim(),
        typeName,
        [],
        element.name,
        element.range,
        value.range,
        path,
        element,
      );
      if (value.children.length > 0) {
        this.addPrimitiveChildIssue(element.name, typeName, value, element.range, path, element);
      }
    } else {
      this.issues.push(
        makeIssue({
          code: 'xsd-type-not-found',
          title: `XSD type not found: ${typeName}`,
          message: `The schema references type ${typeName}, but this type is not declared in the XSD.`,
          path,
          expected: typeName,
          actual: 'Missing type declaration',
          schemaRange: element.range,
          ...schemaSource(element),
          messageRange: value.range,
        }),
      );
    }
  }

  private validateComplexElement(
    element: XsdElementDecl,
    complexType: XsdComplexType,
    value: XmlElementNode,
    path: string,
    depth: number,
  ) {
    const hasContent = value.children.length > 0 || value.text.trim() !== '' || value.attributes.size > 0;
    if (!hasContent && element.minOccurs > 0) {
      this.issues.push(
        makeIssue({
          code: 'empty-xml-element',
          title: `Empty required element: ${element.name}`,
          message: `<${element.name}> is present but empty.`,
          path,
          expected: complexType.name,
          actual: 'Empty value',
          schemaRange: element.range,
          ...schemaSource(element),
          messageRange: value.range,
        }),
      );
    }

    if (this.activeTypes.has(complexType.name)) {
      this.issues.push(
        makeIssue({
          code: 'xsd-recursive-type',
          title: `Recursive XSD type: ${complexType.name}`,
          message: `Type ${complexType.name} refers back to itself. This branch is not expanded to avoid an infinite validation loop.`,
          path,
          schemaRange: complexType.range,
          ...schemaSource(complexType),
          messageRange: value.range,
          hint: 'Validation fails closed for recursive types until recursive validation is explicitly supported.',
        }),
      );
      return;
    }

    this.activeTypes.add(complexType.name);
    if (complexType.simpleContent) {
      this.validateAttributes(complexType, value, path);
      this.validateSimpleValue(
        value.text.trim(),
        complexType.simpleContent.baseType,
        [],
        element.name,
        complexType.simpleContent.range,
        value.range,
        path,
        complexType.simpleContent,
      );
      if (value.children.length > 0) {
        this.addPrimitiveChildIssue(
          element.name,
          complexType.simpleContent.baseType,
          value,
          complexType.simpleContent.range,
          path,
          complexType.simpleContent,
        );
      }
      this.activeTypes.delete(complexType.name);
      return;
    }

    this.validateAttributes(complexType, value, path);
    if (complexType.group) {
      this.validateParticleGroup(complexType.group, value, path, depth + 1);
    } else if (value.children.length > 0) {
      for (const child of value.children) {
        this.issues.push(
          makeIssue({
            code: 'unexpected-xml-element',
            title: `Unexpected XML element: ${child.localName}`,
            message: `<${child.localName}> appears under ${path}, but the XSD type ${complexType.name} does not declare child elements.`,
            path: `${path}/${child.localName}`,
            expected: 'No child elements',
            actual: `<${child.localName}>`,
            schemaRange: complexType.range,
            ...schemaSource(complexType),
            messageRange: child.range,
          }),
        );
      }
    }
    this.activeTypes.delete(complexType.name);
  }

  private validateAttributes(complexType: XsdComplexType, value: XmlElementNode, path: string) {
    const allowed = new Set<string>();

    for (const attribute of complexType.attributes) {
      const resolved = this.resolveAttribute(attribute);
      if (resolved.missingRef) {
        this.issues.push(
          makeIssue({
            code: 'xsd-reference-not-found',
            title: `Missing XSD attribute reference: ${resolved.missingRef}`,
            message: `The schema references attribute ${resolved.missingRef}, but no global attribute with that name was found.`,
            path,
            schemaRange: attribute.range,
            ...schemaSource(attribute),
            messageRange: value.range,
          }),
        );
        continue;
      }

      const declaration = resolved.declaration;
      allowed.add(declaration.name);
      const actual = value.attributes.get(declaration.name);
      if (actual && resolved.use.prohibited) {
        this.issues.push(
          makeIssue({
            code: 'xsd-prohibited-attribute',
            title: `Prohibited attribute: ${declaration.name}`,
            message: `The XSD prohibits @${declaration.name} on ${path}.`,
            path: `${path}/@${declaration.name}`,
            expected: `No @${declaration.name}`,
            actual: `@${declaration.name}`,
            schemaRange: resolved.use.range,
            ...schemaSource(resolved.use),
            messageRange: actual.range ?? value.range,
          }),
        );
      } else if (!actual && resolved.use.required) {
        this.issues.push(
          makeIssue({
            code: 'missing-xml-attribute',
            title: `Missing required attribute: ${declaration.name}`,
            message: `The XSD requires @${declaration.name} on ${path}.`,
            path: `${path}/@${declaration.name}`,
            expected: `@${declaration.name}`,
            actual: 'Missing attribute',
            schemaRange: resolved.use.range,
            ...schemaSource(resolved.use),
            messageRange: value.range,
          }),
        );
      } else if (actual) {
        this.validateAttributeValue(declaration, actual, `${path}/@${declaration.name}`);
      }
    }

    for (const attribute of value.attributes.values()) {
      if (!attribute.name.startsWith('xmlns') && !allowed.has(attribute.name)) {
        this.issues.push(
          makeIssue({
            code: 'unexpected-xml-attribute',
            title: `Unexpected XML attribute: ${attribute.name}`,
            message: `@${attribute.name} appears on ${path}, but the XSD type ${complexType.name} does not declare it.`,
            path: `${path}/@${attribute.name}`,
            expected: [...allowed].join(', ') || 'No attributes',
            actual: `@${attribute.name}`,
            schemaRange: complexType.range,
            ...schemaSource(complexType),
            messageRange: attribute.range ?? value.range,
          }),
        );
      }
    }
  }

  private validateAttributeValue(attribute: XsdAttributeDecl, value: XmlAttributeValue, path: string) {
    const typeName = attribute.typeName ? normalizeTypeName(attribute.typeName) : 'xs:string';
    const simpleType = this.model.simpleTypes.get(typeName);
    if (simpleType) {
      this.validateSimpleValue(
        value.value.trim(),
        simpleType.baseType,
        simpleType.restrictions,
        `@${attribute.name}`,
        attribute.range,
        value.range,
        path,
        simpleType,
      );
    } else if (isBuiltinType(typeName)) {
      this.validateSimpleValue(
        value.value.trim(),
        typeName,
        [],
        `@${attribute.name}`,
        attribute.range,
        value.range,
        path,
        attribute,
      );
    } else {
      this.issues.push(
        makeIssue({
          code: 'xsd-type-not-found',
          title: `XSD type not found: ${typeName}`,
          message: `The schema references type ${typeName}, but this type is not declared in the XSD.`,
          path,
          schemaRange: attribute.range,
          ...schemaSource(attribute),
          messageRange: value.range,
        }),
      );
    }
  }

  private validateParticleGroup(group: XsdParticleGroup, value: XmlElementNode, path: string, depth: number) {
    const allowedNames = new Set(group.elements.map((element) => this.resolvedElementName(element)));
    const childElements = value.children;
    const presentAllowed = childElements.filter((child) => allowedNames.has(child.localName));

    for (const child of childElements) {
      if (!allowedNames.has(child.localName)) {
        this.issues.push(
          makeIssue({
            code: 'unexpected-xml-element',
            title: `Unexpected XML element: ${child.localName}`,
            message: `<${child.localName}> appears under ${path}, but the XSD ${group.kind} does not declare it.`,
            path: `${path}/${child.localName}`,
            expected: [...allowedNames].join(', ') || 'No child elements',
            actual: `<${child.localName}>`,
            schemaRange: group.range,
            ...schemaSource(group),
            messageRange: child.range,
          }),
        );
      }
    }

    if (group.kind === 'choice') {
      if (presentAllowed.length < group.minOccurs) {
        this.issues.push(
          makeIssue({
            code: 'xsd-choice-missing',
            title: 'Missing XML choice element',
            message: `The XSD choice requires one of these elements inside ${path}: ${[...allowedNames].join(', ')}.`,
            path,
            expected: [...allowedNames].join(' or '),
            actual: 'No choice element present',
            schemaRange: group.range,
            ...schemaSource(group),
            messageRange: value.range,
          }),
        );
      } else if (presentAllowed.length > group.maxOccurs) {
        this.issues.push(
          makeIssue({
            code: 'xsd-choice-too-many',
            title: 'Too many XML choice elements',
            message: `The XSD choice allows at most ${formatMaxOccurs(group.maxOccurs)} of ${[...allowedNames].join(', ')}, but the XML includes ${presentAllowed.length}.`,
            path,
            expected: `maxOccurs=${formatMaxOccurs(group.maxOccurs)}`,
            actual: `${presentAllowed.length} choice elements`,
            schemaRange: group.range,
            ...schemaSource(group),
            messageRange: presentAllowed[group.maxOccurs]?.range ?? presentAllowed.at(-1)?.range ?? value.range,
          }),
        );
      }

      for (const element of group.elements) {
        const targetName = this.resolvedElementName(element);
        const matches = childElements.filter((child) => child.localName === targetName);
        if (matches.length > 0) {
          this.validateElementOccurrences({ ...element, minOccurs: 0 }, matches, path, depth + 1);
        }
      }
      return;
    }

    if (group.kind === 'sequence') {
      this.validateSequenceOrder(group, presentAllowed, path);
    }

    for (const element of group.elements) {
      const targetName = this.resolvedElementName(element);
      const matches = childElements.filter((child) => child.localName === targetName);
      this.validateElementOccurrences(element, matches, path, depth + 1);
    }
  }

  private validateSequenceOrder(group: XsdParticleGroup, presentChildren: XmlElementNode[], path: string) {
    let lastIndex = -1;
    for (const child of presentChildren) {
      const index = group.elements.findIndex((element) => this.resolvedElementName(element) === child.localName);
      if (index < lastIndex) {
        this.issues.push(
          makeIssue({
            code: 'xsd-sequence-order',
            title: `XML element is out of order: ${child.localName}`,
            message: `<${child.localName}> appears too late or too early for the XSD sequence at ${path}.`,
            path: `${path}/${child.localName}`,
            expected: group.elements.map((element) => `<${this.resolvedElementName(element)}>`).join(' then '),
            actual: presentChildren.map((element) => `<${element.localName}>`).join(', '),
            schemaRange: group.range,
            ...schemaSource(group),
            messageRange: child.range,
            hint: 'Move the highlighted element so the XML child order matches the XSD sequence order.',
          }),
        );
        return;
      }
      lastIndex = Math.max(lastIndex, index);
    }
  }

  private validateSimpleValue(
    value: string,
    typeName: string,
    restrictions: XsdRestriction[],
    label: string,
    schemaRange: TextRange,
    messageRange: TextRange | undefined,
    path: string,
    schemaOwner: SchemaSourceOwner,
    seenTypes = new Set<string>(),
  ) {
    const normalizedType = normalizeTypeName(typeName);
    const customType = this.model.simpleTypes.get(normalizedType);
    if (customType) {
      if (seenTypes.has(normalizedType)) {
        this.issues.push(
          makeIssue({
            code: 'xsd-recursive-type',
            title: `Recursive simple type: ${normalizedType}`,
            message: `Simple type ${normalizedType} refers back to itself.`,
            path,
            schemaRange: customType.range,
            ...schemaSource(customType),
            messageRange,
          }),
        );
        return;
      }
      const nextSeen = new Set(seenTypes).add(normalizedType);
      this.validateSimpleValue(
        value,
        customType.baseType,
        customType.restrictions,
        label,
        customType.range,
        messageRange,
        path,
        customType,
        nextSeen,
      );
      return;
    }

    if (!isBuiltinType(normalizedType)) {
      this.issues.push(
        makeIssue({
          code: 'xsd-type-not-found',
          title: `XSD type not found: ${normalizedType}`,
          message: `The schema references type ${normalizedType}, but this type is not declared in the XSD.`,
          path,
          expected: normalizedType,
          actual: 'Missing type declaration',
          schemaRange,
          ...schemaSource(schemaOwner),
          messageRange,
        }),
      );
      return;
    }

    if (!valueMatchesBuiltinType(value, normalizedType)) {
      this.issues.push(
        makeIssue({
          code: 'xml-element-type',
          title: `Value has wrong type: ${label}`,
          message: `${label} must be ${normalizedType}, but "${value}" is not valid for that type.`,
          path,
          expected: normalizedType,
          actual: value,
          schemaRange,
          ...schemaSource(schemaOwner),
          messageRange,
        }),
      );
      return;
    }

    for (const restriction of restrictions) {
      this.validateRestriction(value, restriction, label, schemaRange, messageRange, path);
    }
  }

  private validateRestriction(
    value: string,
    restriction: XsdRestriction,
    label: string,
    fallbackSchemaRange: TextRange,
    messageRange: TextRange | undefined,
    path: string,
  ) {
    const schemaRange = restriction.range ?? fallbackSchemaRange;
    if (restriction.kind === 'enumeration' && value !== restriction.value) {
      const sameKind = this.collectRestrictionValues(restriction, 'enumeration');
      if (this.isFirstRestrictionOfKind(restriction, 'enumeration') && !sameKind.includes(value)) {
        this.issues.push(
          makeIssue({
            code: 'xsd-enumeration',
            title: `Value is not allowed: ${label}`,
            message: `${label} must be one of ${sameKind.join(', ')}, but the XML value is "${value}".`,
            path,
            expected: sameKind.join(', '),
            actual: value,
            schemaRange,
            ...schemaSource(restriction),
            messageRange,
          }),
        );
      }
    } else if (restriction.kind === 'pattern') {
      try {
        const pattern = new RegExp(`^(?:${restriction.value})$`);
        if (!pattern.test(value)) {
          this.issues.push(
            makeIssue({
              code: 'xsd-pattern',
              title: `Value does not match pattern: ${label}`,
              message: `${label} must match ${restriction.value}, but the XML value is "${value}".`,
              path,
              expected: restriction.value,
              actual: value,
              schemaRange,
              ...schemaSource(restriction),
              messageRange,
            }),
          );
        }
      } catch {
        this.issues.push(
          makeIssue({
            code: 'unsupported-xsd-feature',
            title: `Unsupported XSD pattern: ${label}`,
            message: `The XSD pattern ${restriction.value} cannot be compiled by the browser validator.`,
            path,
            schemaRange,
            ...schemaSource(restriction),
            messageRange,
          }),
        );
      }
    } else if (restriction.kind === 'length' && value.length !== Number(restriction.value)) {
      this.addLimitIssue(
        'xsd-length',
        `${label} has the wrong length`,
        value,
        restriction,
        schemaRange,
        messageRange,
        path,
      );
    } else if (restriction.kind === 'minLength' && value.length < Number(restriction.value)) {
      this.addLimitIssue(
        'xsd-min-length',
        `${label} is too short`,
        value,
        restriction,
        schemaRange,
        messageRange,
        path,
      );
    } else if (restriction.kind === 'maxLength' && value.length > Number(restriction.value)) {
      this.addLimitIssue('xsd-max-length', `${label} is too long`, value, restriction, schemaRange, messageRange, path);
    } else if (restriction.kind === 'minInclusive' && Number(value) < Number(restriction.value)) {
      this.addLimitIssue(
        'xsd-min-inclusive',
        `${label} is below the minimum`,
        value,
        restriction,
        schemaRange,
        messageRange,
        path,
      );
    } else if (restriction.kind === 'maxInclusive' && Number(value) > Number(restriction.value)) {
      this.addLimitIssue(
        'xsd-max-inclusive',
        `${label} is above the maximum`,
        value,
        restriction,
        schemaRange,
        messageRange,
        path,
      );
    } else if (restriction.kind === 'minExclusive' && Number(value) <= Number(restriction.value)) {
      this.addLimitIssue(
        'xsd-min-exclusive',
        `${label} must be greater than the minimum`,
        value,
        restriction,
        schemaRange,
        messageRange,
        path,
      );
    } else if (restriction.kind === 'maxExclusive' && Number(value) >= Number(restriction.value)) {
      this.addLimitIssue(
        'xsd-max-exclusive',
        `${label} must be below the maximum`,
        value,
        restriction,
        schemaRange,
        messageRange,
        path,
      );
    } else if (restriction.kind === 'totalDigits' && totalDigits(value) > Number(restriction.value)) {
      this.addLimitIssue(
        'xsd-total-digits',
        `${label} has too many digits`,
        value,
        restriction,
        schemaRange,
        messageRange,
        path,
      );
    } else if (restriction.kind === 'fractionDigits' && fractionDigits(value) > Number(restriction.value)) {
      this.addLimitIssue(
        'xsd-fraction-digits',
        `${label} has too many fractional digits`,
        value,
        restriction,
        schemaRange,
        messageRange,
        path,
      );
    }
  }

  private collectRestrictionValues(restriction: XsdRestriction, kind: XsdRestriction['kind']) {
    const simpleType = [...this.model.simpleTypes.values()].find((type) => type.restrictions.includes(restriction));
    return (
      simpleType?.restrictions.filter((item) => item.kind === kind).map((item) => item.value) ?? [restriction.value]
    );
  }

  private isFirstRestrictionOfKind(restriction: XsdRestriction, kind: XsdRestriction['kind']) {
    const simpleType = [...this.model.simpleTypes.values()].find((type) => type.restrictions.includes(restriction));
    return simpleType?.restrictions.find((item) => item.kind === kind) === restriction;
  }

  private addLimitIssue(
    code: string,
    title: string,
    value: string,
    restriction: XsdRestriction,
    schemaRange: TextRange,
    messageRange: TextRange | undefined,
    path: string,
  ) {
    this.issues.push(
      makeIssue({
        code,
        title,
        message: `${title}. Expected ${restriction.kind}=${restriction.value}, but the XML value is "${value}".`,
        path,
        expected: `${restriction.kind}=${restriction.value}`,
        actual: value,
        schemaRange,
        ...schemaSource(restriction),
        messageRange,
      }),
    );
  }

  private resolveElement(declaration: XsdElementDecl): ResolvedElement {
    if (!declaration.refName) {
      return { declaration, occurrence: declaration };
    }

    const referenced = this.model.globalElements.get(normalizeTypeName(declaration.refName));
    if (!referenced) {
      return { declaration, occurrence: declaration, missingRef: declaration.refName };
    }

    return { declaration: referenced, occurrence: declaration };
  }

  private resolveAttribute(attribute: XsdAttributeDecl): ResolvedAttribute {
    if (!attribute.refName) {
      return { declaration: attribute, use: attribute };
    }

    const referenced = this.model.attributes.get(normalizeTypeName(attribute.refName));
    if (!referenced) {
      return { declaration: attribute, use: attribute, missingRef: attribute.refName };
    }

    return { declaration: referenced, use: attribute };
  }

  private resolvedElementName(element: XsdElementDecl) {
    return this.resolveElement(element).declaration.name;
  }

  private canContinue(element: XsdElementDecl, value: XmlElementNode, path: string, depth: number) {
    this.visitedNodes += 1;
    if (depth > MAX_RECURSION_DEPTH) {
      this.issues.push(
        makeIssue({
          code: 'xsd-validation-depth',
          title: 'XSD validation reached the safe depth limit',
          message: `Validation stopped at ${path} to avoid freezing the browser.`,
          path,
          schemaRange: element.range,
          ...schemaSource(element),
          messageRange: value.range,
        }),
      );
      return false;
    }

    if (this.visitedNodes > MAX_VALIDATION_NODES) {
      this.issues.push(
        makeIssue({
          code: 'xsd-validation-size',
          title: 'XSD validation reached the safe node limit',
          message: 'The XML message is too large for safe in-browser validation in this pass.',
          path,
          schemaRange: element.range,
          ...schemaSource(element),
          messageRange: value.range,
        }),
      );
      return false;
    }

    return true;
  }

  private validateNilElement(element: XsdElementDecl, value: XmlElementNode, path: string) {
    const nilAttribute = value.attributes.get('nil');
    const isNil = nilAttribute?.value.trim() === 'true' || nilAttribute?.value.trim() === '1';
    if (!isNil) {
      return false;
    }

    if (!element.nillable) {
      this.issues.push(
        makeIssue({
          code: 'xsd-nillable',
          title: `Element cannot be nil: ${element.name}`,
          message: `<${element.name}> uses xsi:nil, but the XSD element is not declared nillable.`,
          path,
          expected: 'nillable="true"',
          actual: 'xsi:nil="true"',
          schemaRange: element.range,
          ...schemaSource(element),
          messageRange: nilAttribute?.range ?? value.range,
        }),
      );
      return true;
    }

    if (value.children.length > 0 || value.text.trim() !== '') {
      this.issues.push(
        makeIssue({
          code: 'xsd-nil-content',
          title: `Nil element has content: ${element.name}`,
          message: `<${element.name}> is marked xsi:nil="true", so it must not contain child elements or text.`,
          path,
          expected: 'Empty nil element',
          actual: 'Element content',
          schemaRange: element.range,
          ...schemaSource(element),
          messageRange: value.range,
        }),
      );
    }

    return true;
  }

  private parentMessageRange(path: string) {
    if (!path || path === '/') {
      return this.root?.range;
    }

    const target = path.split('/').filter(Boolean).at(-1);
    if (!target) {
      return this.root?.range;
    }

    return findElementRange(this.xmlText, target) ?? this.root?.range;
  }

  private addPrimitiveChildIssue(
    label: string,
    typeName: string,
    value: XmlElementNode,
    schemaRange: TextRange,
    path: string,
    schemaOwner: SchemaSourceOwner,
  ) {
    this.issues.push(
      makeIssue({
        code: 'xml-element-type',
        title: `Element has wrong type: ${label}`,
        message: `<${label}> must be ${typeName}, but it contains nested XML elements instead of a simple text value.`,
        path,
        expected: typeName,
        actual: 'Nested XML elements',
        schemaRange,
        ...schemaSource(schemaOwner),
        messageRange: value.range,
        hint: 'Replace the nested XML with a simple text value or update the XSD element type.',
      }),
    );
  }

  private sourceLabel(sourceId: string | undefined) {
    return this.model.sources.find((source) => source.id === sourceId)?.label;
  }
}

const schemaSource = (source: SchemaSourceOwner) => ({
  schemaSourceId: source.sourceId,
  schemaSourceLabel: source.sourceLabel,
});

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
  const parsed = parser.parse(xmlText) as RawNode[];
  const locator = new XmlRangeLocator(xmlText);
  return parsed.map((node) => toXmlElement(node, locator, xmlText)).find(Boolean);
};

const toXmlElement = (node: RawNode, locator: XmlRangeLocator, xmlText: string): XmlElementNode | undefined => {
  const tagName = Object.keys(node).find((key) => key !== ATTRIBUTE_KEY && key !== TEXT_KEY);
  if (!tagName || tagName.startsWith('?') || tagName.startsWith('!')) {
    return undefined;
  }

  const local = localName(tagName);
  const range = locator.next(local);
  const rawAttributes = isRecord(node[ATTRIBUTE_KEY]) ? node[ATTRIBUTE_KEY] : {};
  const attributes = new Map<string, XmlAttributeValue>();
  for (const [rawName, rawValue] of Object.entries(rawAttributes)) {
    const rawAttributeName = rawName.replace(/^@_/, '');
    const name =
      rawAttributeName === 'xmlns' || rawAttributeName.startsWith('xmlns:')
        ? rawAttributeName
        : localName(rawAttributeName);
    attributes.set(name, {
      name,
      value: String(rawValue),
      range: findAttributeRange(xmlText, local, name),
    });
  }

  const rawChildren = Array.isArray(node[tagName]) ? (node[tagName] as RawNode[]) : [];
  const children: XmlElementNode[] = [];
  const text: string[] = [];
  for (const child of rawChildren) {
    if (typeof child[TEXT_KEY] === 'string') {
      text.push(String(child[TEXT_KEY]));
      continue;
    }
    const childElement = toXmlElement(child, locator, xmlText);
    if (childElement) {
      children.push(childElement);
    }
  }

  return { name: tagName, localName: local, attributes, children, text: text.join(''), range };
};

const isBuiltinType = (typeName: string) => builtinTypes.has(normalizeTypeName(typeName));

const builtinTypes = new Set([
  'xs:string',
  'string',
  'xs:normalizedString',
  'xs:token',
  'token',
  'xs:language',
  'xs:Name',
  'xs:NCName',
  'xs:NMTOKEN',
  'xs:NMTOKENS',
  'xs:ID',
  'xs:IDREF',
  'xs:IDREFS',
  'xs:ENTITY',
  'xs:ENTITIES',
  'xs:integer',
  'xs:int',
  'xs:long',
  'xs:short',
  'xs:byte',
  'integer',
  'int',
  'xs:nonNegativeInteger',
  'xs:positiveInteger',
  'xs:nonPositiveInteger',
  'xs:negativeInteger',
  'xs:unsignedLong',
  'xs:unsignedInt',
  'xs:unsignedShort',
  'xs:unsignedByte',
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
  'xs:time',
  'xs:gYearMonth',
  'xs:gYear',
  'xs:gMonthDay',
  'xs:gDay',
  'xs:gMonth',
  'xs:duration',
  'xs:hexBinary',
  'xs:base64Binary',
  'xs:anyURI',
  'xs:QName',
  'xs:NOTATION',
]);

const valueMatchesBuiltinType = (value: string, typeName: string) => {
  const normalized = normalizeTypeName(typeName);
  if (stringLikeTypes.has(normalized)) {
    return true;
  }
  if (
    [
      'xs:integer',
      'xs:int',
      'xs:long',
      'xs:short',
      'xs:byte',
      'integer',
      'int',
      'xs:nonNegativeInteger',
      'xs:positiveInteger',
      'xs:nonPositiveInteger',
      'xs:negativeInteger',
      'xs:unsignedLong',
      'xs:unsignedInt',
      'xs:unsignedShort',
      'xs:unsignedByte',
    ].includes(normalized)
  ) {
    if (!/^[-+]?\d+$/.test(value.trim())) {
      return false;
    }
    const number = Number(value);
    if (normalized === 'xs:nonNegativeInteger') {
      return number >= 0;
    }
    if (normalized === 'xs:positiveInteger') {
      return number > 0;
    }
    if (normalized === 'xs:nonPositiveInteger') {
      return number <= 0;
    }
    if (normalized === 'xs:negativeInteger') {
      return number < 0;
    }
    if (normalized.startsWith('xs:unsigned')) {
      return number >= 0;
    }
    return true;
  }
  if (['xs:decimal', 'xs:double', 'xs:float', 'decimal', 'double', 'float'].includes(normalized)) {
    return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(value.trim());
  }
  if (['xs:boolean', 'boolean'].includes(normalized)) {
    return /^(true|false|0|1)$/.test(value.trim());
  }
  if (['xs:date', 'date'].includes(normalized)) {
    return /^\d{4}-\d{2}-\d{2}(?:Z|[+-]\d{2}:\d{2})?$/.test(value.trim());
  }
  if (['xs:dateTime', 'dateTime'].includes(normalized)) {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value.trim());
  }
  if (normalized === 'xs:time') {
    return /^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value.trim());
  }
  if (normalized === 'xs:gYearMonth') {
    return /^\d{4}-\d{2}(?:Z|[+-]\d{2}:\d{2})?$/.test(value.trim());
  }
  if (normalized === 'xs:gYear') {
    return /^\d{4}(?:Z|[+-]\d{2}:\d{2})?$/.test(value.trim());
  }
  if (normalized === 'xs:gMonthDay') {
    return /^--\d{2}-\d{2}(?:Z|[+-]\d{2}:\d{2})?$/.test(value.trim());
  }
  if (normalized === 'xs:gDay') {
    return /^---\d{2}(?:Z|[+-]\d{2}:\d{2})?$/.test(value.trim());
  }
  if (normalized === 'xs:gMonth') {
    return /^--\d{2}(?:Z|[+-]\d{2}:\d{2})?$/.test(value.trim());
  }
  if (normalized === 'xs:hexBinary') {
    return /^(?:[0-9a-fA-F]{2})*$/.test(value.trim());
  }
  if (normalized === 'xs:base64Binary') {
    return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.trim());
  }
  return true;
};

const stringLikeTypes = new Set([
  'xs:string',
  'string',
  'xs:normalizedString',
  'xs:token',
  'token',
  'xs:language',
  'xs:Name',
  'xs:NCName',
  'xs:NMTOKEN',
  'xs:NMTOKENS',
  'xs:ID',
  'xs:IDREF',
  'xs:IDREFS',
  'xs:ENTITY',
  'xs:ENTITIES',
  'xs:duration',
  'xs:anyURI',
  'xs:QName',
  'xs:NOTATION',
]);

const firstExtraIndex = (maxOccurs: number) => {
  if (maxOccurs === Number.POSITIVE_INFINITY) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Math.max(0, maxOccurs);
};

const totalDigits = (value: string) => value.replace(/[-+.]/g, '').length;
const fractionDigits = (value: string) =>
  value.includes('.') ? (value.split('.')[1]?.replace(/[^0-9]/g, '').length ?? 0) : 0;

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

    const closePattern = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${escapeRegExp(localTagName)}\\b[^>]*/>`, 'i');
    const closing = closePattern.test(match[0])
      ? undefined
      : findClosingTagOffset(this.source, match.index, localTagName);
    const end = closing ?? match.index + match[0].length;
    this.cursor = match.index + match[0].length;
    return rangeFromOffset(this.source, match.index, end - match.index);
  }
}

const findElementRange = (xmlText: string, name: string) => {
  const tagName = `(?:[A-Za-z_][\\w.-]*:)?${escapeRegExp(localName(name))}`;
  const pattern = new RegExp(`<${tagName}\\b[^>]*>(?:[\\s\\S]*?<\\/${tagName}>)?|<${tagName}\\b[^>]*/>`, 'i');
  const match = pattern.exec(xmlText);
  return match ? rangeFromOffset(xmlText, match.index, match[0].length) : undefined;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
