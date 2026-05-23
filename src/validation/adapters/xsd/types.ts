import type { RelatedSchemaDocument, TextRange, ValidationIssue } from '../../types';

export type XsdContainerKind = 'sequence' | 'choice' | 'all';
export type XsdMaxOccurs = number;

export interface XsdOccurrence {
  minOccurs: number;
  maxOccurs: XsdMaxOccurs;
}

export interface XsdParticleGroup extends XsdOccurrence {
  kind: XsdContainerKind;
  elements: XsdElementDecl[];
  particles?: XsdParticleGroupItem[];
  range: TextRange;
  sourceId: string;
  sourceLabel: string;
}

export type XsdParticleGroupItem =
  | { kind: 'element'; element: XsdElementDecl }
  | { kind: 'groupRef'; groupRef: XsdGroupRef };

export interface XsdGroupRef extends XsdOccurrence {
  refName: string;
  range: TextRange;
  sourceId: string;
  sourceLabel: string;
}

export interface XsdElementDecl extends XsdOccurrence {
  name: string;
  typeName?: string;
  refName?: string;
  nillable: boolean;
  range: TextRange;
  sourceId: string;
  sourceLabel: string;
}

export interface XsdAttributeDecl {
  name: string;
  typeName?: string;
  refName?: string;
  required: boolean;
  prohibited: boolean;
  range: TextRange;
  sourceId: string;
  sourceLabel: string;
}

export interface XsdAttributeGroupRef {
  refName: string;
  range: TextRange;
  sourceId: string;
  sourceLabel: string;
}

export interface XsdAttributeGroup {
  name: string;
  attributes: XsdAttributeDecl[];
  attributeGroupRefs: XsdAttributeGroupRef[];
  range: TextRange;
  sourceId: string;
  sourceLabel: string;
}

export interface XsdSimpleContent {
  baseType: string;
  range: TextRange;
  sourceId: string;
  sourceLabel: string;
}

export interface XsdComplexContent {
  baseType: string;
  derivation: 'extension' | 'restriction';
  group?: XsdParticleGroup;
  attributes: XsdAttributeDecl[];
  attributeGroupRefs: XsdAttributeGroupRef[];
  range: TextRange;
  sourceId: string;
  sourceLabel: string;
}

export interface XsdComplexType {
  name: string;
  group?: XsdParticleGroup;
  simpleContent?: XsdSimpleContent;
  complexContent?: XsdComplexContent;
  attributes: XsdAttributeDecl[];
  attributeGroupRefs: XsdAttributeGroupRef[];
  range: TextRange;
  sourceId: string;
  sourceLabel: string;
}

export interface XsdNamedGroup {
  name: string;
  group: XsdParticleGroup;
  range: TextRange;
  sourceId: string;
  sourceLabel: string;
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
  sourceId: string;
  sourceLabel: string;
}

export interface XsdSimpleType {
  name: string;
  baseType: string;
  restrictions: XsdRestriction[];
  range: TextRange;
  sourceId: string;
  sourceLabel: string;
}

export interface XsdUnsupportedFeature {
  code: string;
  title: string;
  message: string;
  range: TextRange;
  sourceId: string;
  sourceLabel: string;
}

export interface XsdSchemaSourceInfo extends RelatedSchemaDocument {
  isPrimary: boolean;
  targetNamespace?: string;
}

export interface XsdExternalReference {
  kind: 'include' | 'import';
  schemaLocation?: string;
  namespace?: string;
  range: TextRange;
  sourceId: string;
  sourceLabel: string;
  resolvedSourceId?: string;
  resolvedSourceLabel?: string;
}

export interface XsdSchemaModel {
  schemaText: string;
  primarySourceId: string;
  sources: XsdSchemaSourceInfo[];
  externalReferences: XsdExternalReference[];
  rootElementName?: string;
  globalElements: Map<string, XsdElementDecl>;
  complexTypes: Map<string, XsdComplexType>;
  simpleTypes: Map<string, XsdSimpleType>;
  attributes: Map<string, XsdAttributeDecl>;
  groups: Map<string, XsdNamedGroup>;
  attributeGroups: Map<string, XsdAttributeGroup>;
  unsupportedFeatures: XsdUnsupportedFeature[];
}

export type XsdModelParseResult = { ok: true; model: XsdSchemaModel } | { ok: false; issues: ValidationIssue[] };
