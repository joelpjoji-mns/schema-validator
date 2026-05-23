import type { RelatedSchemaDocument, SchemaFormat, TextRange } from '../types';

export type SchemaSummaryNodeKind =
  | 'root'
  | 'field'
  | 'attribute'
  | 'column'
  | 'message'
  | 'enum'
  | 'choice'
  | 'union'
  | 'item'
  | 'definition'
  | 'operation'
  | 'warning';

export type SchemaSummaryDataType =
  | 'unknown'
  | 'null'
  | 'boolean'
  | 'integer'
  | 'number'
  | 'string'
  | 'date'
  | 'datetime'
  | 'array'
  | 'object'
  | 'enum'
  | 'union'
  | 'ref'
  | 'choice'
  | 'map'
  | 'scalar';

export interface SchemaConstraint {
  kind: string;
  label: string;
  value?: string;
}

export interface SchemaSummaryNode {
  id: string;
  name: string;
  kind: SchemaSummaryNodeKind;
  dataType: SchemaSummaryDataType | string;
  required: boolean;
  order?: number;
  description?: string;
  constraints: SchemaConstraint[];
  children: SchemaSummaryNode[];
  sourceRange?: TextRange;
  warnings?: string[];
}

export interface SchemaSummaryStats {
  nodes: number;
  required: number;
  optional: number;
  warnings: number;
  maxDepth: number;
}

export interface SchemaSummary {
  ok: boolean;
  schemaFormat: SchemaFormat;
  title: string;
  formatVersion?: string;
  root?: SchemaSummaryNode;
  warnings: string[];
  errors: string[];
  stats: SchemaSummaryStats;
}

export interface SchemaSummaryRequest {
  schemaText: string;
  schemaFormat: SchemaFormat;
  relatedSchemas?: RelatedSchemaDocument[];
}
