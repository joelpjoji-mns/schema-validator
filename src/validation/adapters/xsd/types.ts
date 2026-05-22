import type { TextRange, ValidationIssue } from '../../types';

export type XsdContainerKind = 'sequence' | 'choice' | 'all';
export type XsdMaxOccurs = number;

export interface XsdOccurrence {
  minOccurs: number;
  maxOccurs: XsdMaxOccurs;
}

export interface XsdParticleGroup extends XsdOccurrence {
  kind: XsdContainerKind;
  elements: XsdElementDecl[];
  range: TextRange;
}

export interface XsdElementDecl extends XsdOccurrence {
  name: string;
  typeName?: string;
  refName?: string;
  nillable: boolean;
  range: TextRange;
}

export interface XsdAttributeDecl {
  name: string;
  typeName?: string;
  refName?: string;
  required: boolean;
  prohibited: boolean;
  range: TextRange;
}

export interface XsdComplexType {
  name: string;
  group?: XsdParticleGroup;
  attributes: XsdAttributeDecl[];
  range: TextRange;
}

export type XsdRestrictionKind =
  | 'enumeration'
  | 'pattern'
  | 'length'
  | 'minLength'
  | 'maxLength'
  | 'minInclusive'
  | 'maxInclusive'
  | 'minExclusive'
  | 'maxExclusive'
  | 'totalDigits'
  | 'fractionDigits';

export interface XsdRestriction {
  kind: XsdRestrictionKind;
  value: string;
  range: TextRange;
}

export interface XsdSimpleType {
  name: string;
  baseType: string;
  restrictions: XsdRestriction[];
  range: TextRange;
}

export interface XsdUnsupportedFeature {
  code: string;
  title: string;
  message: string;
  range: TextRange;
}

export interface XsdSchemaModel {
  schemaText: string;
  rootElementName?: string;
  globalElements: Map<string, XsdElementDecl>;
  complexTypes: Map<string, XsdComplexType>;
  simpleTypes: Map<string, XsdSimpleType>;
  attributes: Map<string, XsdAttributeDecl>;
  unsupportedFeatures: XsdUnsupportedFeature[];
}

export type XsdModelParseResult = { ok: true; model: XsdSchemaModel } | { ok: false; issues: ValidationIssue[] };
