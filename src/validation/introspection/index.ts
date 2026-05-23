import {
    buildSchema,
    getNamedType,
    isEnumType,
    isInputObjectType,
    isInterfaceType,
    isListType,
    isNonNullType,
    isObjectType,
    isScalarType,
    type GraphQLNamedType,
    type GraphQLType,
} from 'graphql';
import protobuf from 'protobufjs';
import { parseSchemaDocument, type SourceDocument } from '../structuredParsers';
import {
    findTextRange,
    getValueAtPath,
    isRecord,
    pointerToSegments,
    segmentsToPointer,
    wholeDocumentRange,
} from '../textRanges';
import { formatMaxOccurs, normalizeTypeName, parseXsdModel, PRIMARY_XSD_SOURCE_ID } from '../adapters/xsd/parseXsdModel';
import type {
  XsdAttributeDecl,
  XsdAttributeGroupRef,
  XsdComplexContent,
  XsdComplexType,
  XsdElementDecl,
  XsdGroupRef,
  XsdParticleGroup,
  XsdParticleGroupItem,
  XsdSchemaModel,
  XsdSimpleType,
  XsdUnsupportedFeature,
} from '../adapters/xsd/types';
import type { RelatedSchemaDocument, SchemaFormat, TextRange } from '../types';
import type { SchemaConstraint, SchemaSummary, SchemaSummaryNode, SchemaSummaryRequest } from './types';

const MAX_SUMMARY_DEPTH = 24;
const MAX_SUMMARY_NODES = 900;

interface BuildState {
  count: number;
  warnings: string[];
  maxDepth: number;
}

interface JsonWalkState extends BuildState {
  root: unknown;
  document?: SourceDocument;
  refStack: Set<string>;
}

export const introspectSchema = ({ schemaText, schemaFormat, relatedSchemas }: SchemaSummaryRequest): SchemaSummary => {
  const text = schemaText.trim();
  if (!text) {
    return createSummary(schemaFormat, 'Schema summary', undefined, ['Paste or upload a schema to build a summary.']);
  }

  try {
    if (schemaFormat === 'xsd') {
      return introspectXsd(schemaText, schemaFormat, relatedSchemas);
    }
    if (schemaFormat === 'graphql') {
      return introspectGraphql(schemaText, schemaFormat);
    }
    if (schemaFormat === 'protobuf') {
      return introspectProtobuf(schemaText, schemaFormat);
    }

    const parsed = parseSchemaDocument(schemaText);
    if (!parsed.ok) {
      return createSummary(
        schemaFormat,
        'Schema summary',
        undefined,
        [],
        parsed.issues.map((issue) => issue.message),
      );
    }

    if (schemaFormat === 'openapi') {
      return introspectOpenApi(parsed.document, schemaFormat);
    }
    if (schemaFormat === 'avro') {
      return introspectAvro(parsed.document, schemaFormat);
    }
    if (schemaFormat === 'table-schema') {
      return introspectTableSchema(parsed.document, schemaFormat);
    }
    if (schemaFormat === 'key-value-rules') {
      return introspectKeyValueRules(parsed.document, schemaFormat);
    }

    return introspectJsonSchema(parsed.document, schemaFormat);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Schema summary could not be built.';
    return createSummary(schemaFormat, 'Schema summary', undefined, [], [message]);
  }
};

const introspectJsonSchema = (document: SourceDocument, schemaFormat: SchemaFormat, title = 'JSON Schema summary') => {
  const state: JsonWalkState = {
    count: 0,
    warnings: [],
    maxDepth: 0,
    root: document.data,
    document,
    refStack: new Set(),
  };
  const root = walkJsonSchema(document.data, {
    name: schemaTitle(document.data) ?? 'root',
    path: [],
    required: true,
    order: 1,
    kind: 'root',
    state,
    depth: 0,
  });

  return createSummary(schemaFormat, title, root, state.warnings);
};

const introspectOpenApi = (document: SourceDocument, schemaFormat: SchemaFormat): SchemaSummary => {
  const candidate = findOpenApiSchema(document.data);
  if (!candidate) {
    return createSummary(schemaFormat, 'OpenAPI schema summary', undefined, [
      'No request, response, or component schema was found to summarize.',
    ]);
  }

  const resolved = resolveLocalRef(document.data, candidate.schema, candidate.path);
  const state: JsonWalkState = {
    count: 0,
    warnings: [],
    maxDepth: 0,
    root: document.data,
    document,
    refStack: new Set(),
  };
  const root = walkJsonSchema(resolved.schema, {
    name: candidate.path.join('.') || 'OpenAPI schema',
    path: resolved.path,
    required: true,
    order: 1,
    kind: 'root',
    state,
    depth: 0,
  });

  state.warnings.unshift(`Summarizing first discovered schema at ${segmentsToPointer(candidate.path)}.`);
  return createSummary(schemaFormat, 'OpenAPI schema summary', root, state.warnings);
};

interface JsonWalkOptions {
  name: string;
  path: string[];
  required: boolean;
  order?: number;
  kind: SchemaSummaryNode['kind'];
  state: JsonWalkState;
  depth: number;
}

const walkJsonSchema = (schema: unknown, options: JsonWalkOptions): SchemaSummaryNode => {
  const { name, path, required, order, kind, state, depth } = options;
  if (!canAddNode(state, depth)) {
    return warningNode(path, name, 'Summary truncated for safety.', order);
  }

  if (isRecord(schema) && typeof schema.$ref === 'string' && schema.$ref.startsWith('#')) {
    const refPath = pointerToSegments(schema.$ref);
    const refPointer = segmentsToPointer(refPath);
    if (state.refStack.has(refPointer)) {
      state.warnings.push(`Circular $ref skipped at ${refPointer}.`);
      return node({
        id: nodeId(path, name),
        name,
        kind,
        dataType: 'ref',
        required,
        order,
        sourceRange: sourceRange(state, path),
        constraints: [constraint('ref', '$ref', schema.$ref)],
        warnings: ['Circular reference skipped.'],
      });
    }

    const resolved = getValueAtPath(state.root, refPath);
    if (resolved !== undefined) {
      state.refStack.add(refPointer);
      const resolvedNode = walkJsonSchema(resolved, { ...options, path: refPath, depth: depth + 1 });
      state.refStack.delete(refPointer);
      return {
        ...resolvedNode,
        id: nodeId(path, name),
        name,
        required,
        order,
        sourceRange: sourceRange(state, path),
        constraints: [constraint('ref', '$ref', schema.$ref), ...resolvedNode.constraints],
      };
    }
  }

  const record = isRecord(schema) ? schema : {};
  const dataType = normalizeJsonSchemaType(record);
  const children: SchemaSummaryNode[] = [];
  const requiredFields = new Set(Array.isArray(record.required) ? record.required.map(String) : []);

  if (isRecord(record.properties)) {
    Object.entries(record.properties).forEach(([propertyName, propertySchema], index) => {
      children.push(
        walkJsonSchema(propertySchema, {
          name: propertyName,
          path: [...path, 'properties', propertyName],
          required: requiredFields.has(propertyName),
          order: index + 1,
          kind: 'field',
          state,
          depth: depth + 1,
        }),
      );
    });
  }

  if (isRecord(record.patternProperties)) {
    Object.entries(record.patternProperties).forEach(([propertyName, propertySchema], index) => {
      children.push(
        walkJsonSchema(propertySchema, {
          name: `/${propertyName}/`,
          path: [...path, 'patternProperties', propertyName],
          required: false,
          order: children.length + index + 1,
          kind: 'field',
          state,
          depth: depth + 1,
        }),
      );
    });
  }

  if ('items' in record) {
    children.push(
      walkJsonSchema(record.items, {
        name: 'items',
        path: [...path, 'items'],
        required: false,
        order: children.length + 1,
        kind: 'item',
        state,
        depth: depth + 1,
      }),
    );
  }

  if (Array.isArray(record.prefixItems)) {
    record.prefixItems.forEach((itemSchema, index) => {
      children.push(
        walkJsonSchema(itemSchema, {
          name: `prefixItems[${index}]`,
          path: [...path, 'prefixItems', String(index)],
          required: false,
          order: children.length + 1,
          kind: 'item',
          state,
          depth: depth + 1,
        }),
      );
    });
  }

  ['oneOf', 'anyOf', 'allOf'].forEach((keyword) => {
    const variants = record[keyword];
    if (Array.isArray(variants)) {
      const variantChildren = variants.map((variant, index) =>
        walkJsonSchema(variant, {
          name: `${keyword}[${index}]`,
          path: [...path, keyword, String(index)],
          required,
          order: index + 1,
          kind: keyword === 'allOf' ? 'definition' : 'choice',
          state,
          depth: depth + 2,
        }),
      );
      children.push(
        node({
          id: nodeId([...path, keyword], keyword),
          name: keyword,
          kind: keyword === 'allOf' ? 'definition' : 'choice',
          dataType: keyword === 'allOf' ? 'object' : 'choice',
          required,
          order: children.length + 1,
          constraints: [constraint('composition', keyword, `${variants.length} option(s)`)],
          children: variantChildren,
          sourceRange: sourceRange(state, [...path, keyword]),
        }),
      );
    }
  });

  const definitions = isRecord(record.$defs)
    ? record.$defs
    : isRecord(record.definitions)
      ? record.definitions
      : undefined;
  if (definitions && depth === 0) {
    const definitionChildren = Object.entries(definitions).map(([definitionName, definitionSchema], index) =>
      walkJsonSchema(definitionSchema, {
        name: definitionName,
        path: [...path, record.$defs ? '$defs' : 'definitions', definitionName],
        required: false,
        order: index + 1,
        kind: 'definition',
        state,
        depth: depth + 2,
      }),
    );
    children.push(
      node({
        id: 'definitions',
        name: 'definitions',
        kind: 'definition',
        dataType: 'object',
        required: false,
        order: children.length + 1,
        constraints: [],
        children: definitionChildren,
        sourceRange: sourceRange(state, [...path, record.$defs ? '$defs' : 'definitions']),
      }),
    );
  }

  return node({
    id: nodeId(path, name),
    name,
    kind,
    dataType,
    required,
    order,
    description: stringValue(record.description ?? record.title ?? record.$comment),
    constraints: jsonConstraints(record),
    children,
    sourceRange: sourceRange(state, path),
  });
};

const normalizeJsonSchemaType = (schema: Record<string, unknown>) => {
  if (typeof schema.$ref === 'string') {
    return 'ref';
  }
  if (Array.isArray(schema.enum)) {
    return 'enum';
  }
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    return 'union';
  }
  if (typeof schema.type === 'string') {
    return normalizeDataType(schema.type);
  }
  if (Array.isArray(schema.type)) {
    return schema.type.map((item) => normalizeDataType(String(item))).join(' | ');
  }
  if ('properties' in schema || 'additionalProperties' in schema) {
    return 'object';
  }
  if ('items' in schema || 'prefixItems' in schema) {
    return 'array';
  }
  return 'unknown';
};

const jsonConstraints = (schema: Record<string, unknown>): SchemaConstraint[] => {
  const constraints: SchemaConstraint[] = [];
  const keywordMap: Array<[string, string]> = [
    ['format', 'format'],
    ['pattern', 'pattern'],
    ['minimum', 'min'],
    ['maximum', 'max'],
    ['exclusiveMinimum', 'exclusive min'],
    ['exclusiveMaximum', 'exclusive max'],
    ['minLength', 'min length'],
    ['maxLength', 'max length'],
    ['minItems', 'min items'],
    ['maxItems', 'max items'],
    ['minContains', 'min contains'],
    ['maxContains', 'max contains'],
    ['multipleOf', 'multiple of'],
  ];

  keywordMap.forEach(([key, label]) => {
    if (schema[key] !== undefined) {
      constraints.push(constraint(key, label, schema[key]));
    }
  });

  if (Array.isArray(schema.enum)) {
    constraints.push(constraint('enum', 'enum', schema.enum.map((item) => JSON.stringify(item)).join(', ')));
  }
  if (schema.const !== undefined) {
    constraints.push(constraint('const', 'const', JSON.stringify(schema.const)));
  }
  if (schema.default !== undefined) {
    constraints.push(constraint('default', 'default', JSON.stringify(schema.default)));
  }
  if (schema.additionalProperties === false) {
    constraints.push(constraint('additionalProperties', 'no extra fields'));
  }
  if (schema.deprecated === true) {
    constraints.push(constraint('deprecated', 'deprecated'));
  }

  return constraints;
};

const introspectAvro = (document: SourceDocument, schemaFormat: SchemaFormat): SchemaSummary => {
  const state: BuildState = { count: 0, warnings: [], maxDepth: 0 };
  const root = walkAvro(document.data, 'root', [], true, 1, state, document, 0);
  return createSummary(schemaFormat, 'Avro schema summary', root, state.warnings);
};

const walkAvro = (
  schema: unknown,
  name: string,
  path: string[],
  required: boolean,
  order: number,
  state: BuildState,
  document: SourceDocument,
  depth: number,
): SchemaSummaryNode => {
  if (!canAddNode(state, depth)) {
    return warningNode(path, name, 'Summary truncated for safety.', order);
  }

  if (typeof schema === 'string') {
    return node({
      id: nodeId(path, name),
      name,
      kind: 'field',
      dataType: normalizeDataType(schema),
      required,
      order,
      constraints: [],
      children: [],
      sourceRange: document.rangeForPath(path),
    });
  }

  if (Array.isArray(schema)) {
    return node({
      id: nodeId(path, name),
      name,
      kind: 'union',
      dataType: 'union',
      required: required && !schema.includes('null'),
      order,
      constraints: [constraint('union', 'union', schema.map(avroTypeLabel).join(' | '))],
      children: schema.map((branch, index) =>
        walkAvro(branch, avroTypeLabel(branch), [...path, String(index)], false, index + 1, state, document, depth + 1),
      ),
      sourceRange: document.rangeForPath(path),
    });
  }

  if (!isRecord(schema)) {
    return node({
      id: nodeId(path, name),
      name,
      kind: 'field',
      dataType: 'unknown',
      required,
      order,
      constraints: [],
      children: [],
      sourceRange: document.rangeForPath(path),
    });
  }

  const schemaType = schema.type;
  if (Array.isArray(schemaType) || isRecord(schemaType)) {
    return walkAvro(schemaType, name, [...path, 'type'], required, order, state, document, depth + 1);
  }

  const typeName = String(schemaType ?? 'unknown');
  const children: SchemaSummaryNode[] = [];
  if (typeName === 'record' && Array.isArray(schema.fields)) {
    schema.fields.filter(isRecord).forEach((field, index) => {
      children.push(
        walkAvro(
          field.type,
          String(field.name ?? `field-${index + 1}`),
          [...path, 'fields', String(index)],
          !('default' in field) && !avroAllowsNull(field.type),
          index + 1,
          state,
          document,
          depth + 1,
        ),
      );
    });
  } else if (typeName === 'array') {
    children.push(walkAvro(schema.items, 'items', [...path, 'items'], false, 1, state, document, depth + 1));
  } else if (typeName === 'map') {
    children.push(walkAvro(schema.values, 'values', [...path, 'values'], false, 1, state, document, depth + 1));
  }

  return node({
    id: nodeId(path, name),
    name: stringValue(schema.name) ?? name,
    kind: typeName === 'enum' ? 'enum' : 'field',
    dataType: typeName === 'enum' ? 'enum' : normalizeDataType(typeName),
    required,
    order,
    description: stringValue(schema.doc),
    constraints: avroConstraints(schema),
    children,
    sourceRange: document.rangeForPath(path),
  });
};

const avroConstraints = (schema: Record<string, unknown>): SchemaConstraint[] => {
  const constraints: SchemaConstraint[] = [];
  if (Array.isArray(schema.symbols)) {
    constraints.push(constraint('symbols', 'symbols', schema.symbols.map(String).join(', ')));
  }
  if (schema.logicalType !== undefined) {
    constraints.push(constraint('logicalType', 'logical type', schema.logicalType));
  }
  if (schema.default !== undefined) {
    constraints.push(constraint('default', 'default', JSON.stringify(schema.default)));
  }
  return constraints;
};

const introspectTableSchema = (document: SourceDocument, schemaFormat: SchemaFormat): SchemaSummary => {
  const fields =
    isRecord(document.data) && Array.isArray(document.data.fields) ? document.data.fields.filter(isRecord) : [];
  const children = fields.map((field, index) =>
    node({
      id: `field-${field.name ?? index}`,
      name: String(field.name ?? `column-${index + 1}`),
      kind: 'column',
      dataType: normalizeDataType(String(field.type ?? 'string')),
      required: Boolean(field.required),
      order: index + 1,
      description: stringValue(field.description ?? field.title),
      constraints: jsonConstraints(field),
      children: [],
      sourceRange: document.rangeForKey(String(field.name ?? '')) ?? document.rangeForPath(['fields', String(index)]),
    }),
  );
  const root = node({
    id: 'table',
    name: 'CSV table',
    kind: 'root',
    dataType: 'array',
    required: true,
    order: 1,
    constraints: [constraint('columns', 'columns', children.length)],
    children,
    sourceRange: document.rootRange,
  });
  return createSummary(
    schemaFormat,
    'CSV table schema summary',
    root,
    fields.length === 0 ? ['No fields array was found.'] : [],
  );
};

const introspectKeyValueRules = (document: SourceDocument, schemaFormat: SchemaFormat): SchemaSummary => {
  const required =
    isRecord(document.data) && Array.isArray(document.data.required)
      ? new Set(document.data.required.map(String))
      : new Set<string>();
  const properties = isRecord(document.data) && isRecord(document.data.properties) ? document.data.properties : {};
  const children = Object.entries(properties).map(([key, value], index) => {
    const rule = isRecord(value) ? value : {};
    return node({
      id: `key-${key}`,
      name: key,
      kind: 'field',
      dataType: normalizeDataType(String(rule.type ?? 'string')),
      required: Boolean(rule.required) || required.has(key),
      order: index + 1,
      constraints: jsonConstraints(rule),
      children: [],
      sourceRange: document.rangeForKey(key),
    });
  });
  required.forEach((key) => {
    if (!children.some((child) => child.name === key)) {
      children.push(
        node({
          id: `key-${key}`,
          name: key,
          kind: 'field',
          dataType: 'string',
          required: true,
          order: children.length + 1,
          constraints: [constraint('required', 'required')],
          children: [],
          sourceRange: document.rangeForKey(key),
        }),
      );
    }
  });
  const root = node({
    id: 'key-value-rules',
    name: 'INI / ENV rules',
    kind: 'root',
    dataType: 'object',
    required: true,
    order: 1,
    constraints: [constraint('keys', 'keys', children.length)],
    children,
    sourceRange: document.rootRange,
  });
  return createSummary(
    schemaFormat,
    'Key-value rules summary',
    root,
    children.length === 0 ? ['No key rules were found.'] : [],
  );
};

const introspectGraphql = (schemaText: string, schemaFormat: SchemaFormat): SchemaSummary => {
  const schema = buildSchema(schemaText);
  const typeMap = schema.getTypeMap();
  const children = Object.values(typeMap)
    .filter((type) => !type.name.startsWith('__'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((type, index) => graphqlTypeNode(type, schemaText, index + 1));
  const root = node({
    id: 'graphql-schema',
    name: 'GraphQL schema',
    kind: 'root',
    dataType: 'object',
    required: true,
    order: 1,
    constraints: [constraint('types', 'types', children.length)],
    children,
    sourceRange: wholeDocumentRange(schemaText),
  });
  return createSummary(schemaFormat, 'GraphQL schema summary', root, []);
};

const graphqlTypeNode = (type: GraphQLNamedType, schemaText: string, order: number): SchemaSummaryNode => {
  if (isObjectType(type) || isInputObjectType(type) || isInterfaceType(type)) {
    const fields = Object.values(type.getFields()).map((field, index) => {
      const fieldType = field.type as GraphQLType;
      const args: Array<{
        name: string;
        type: GraphQLType;
        description?: string | null;
        defaultValue?: unknown;
      }> = 'args' in field && Array.isArray(field.args) ? field.args : [];

      return node({
        id: `${type.name}.${field.name}`,
        name: field.name,
        kind: 'field',
        dataType: graphqlTypeLabel(fieldType),
        required: isNonNullType(fieldType),
        order: index + 1,
        description: field.description ?? undefined,
        constraints: [
          ...(isListType(unwrapNonNull(fieldType)) ? [constraint('list', 'list')] : []),
          ...(field.deprecationReason ? [constraint('deprecated', 'deprecated', field.deprecationReason)] : []),
        ],
        children:
          args.length > 0
            ? args.map((arg, argIndex) =>
                node({
                  id: `${type.name}.${field.name}.${arg.name}`,
                  name: `arg ${arg.name}`,
                  kind: 'field',
                  dataType: graphqlTypeLabel(arg.type),
                  required: isNonNullType(arg.type),
                  order: argIndex + 1,
                  description: arg.description ?? undefined,
                  constraints:
                    arg.defaultValue !== undefined
                      ? [constraint('default', 'default', JSON.stringify(arg.defaultValue))]
                      : [],
                  children: [],
                }),
              )
            : [],
        sourceRange: findTextRange(schemaText, field.name),
      });
    });
    return node({
      id: type.name,
      name: type.name,
      kind: 'definition',
      dataType: isInputObjectType(type) ? 'object' : 'object',
      required: true,
      order,
      description: type.description ?? undefined,
      constraints: [],
      children: fields,
      sourceRange:
        findTextRange(schemaText, `${graphqlKindKeyword(type)} ${type.name}`) ?? findTextRange(schemaText, type.name),
    });
  }

  if (isEnumType(type)) {
    const children = type.getValues().map((value, index) =>
      node({
        id: `${type.name}.${value.name}`,
        name: value.name,
        kind: 'enum',
        dataType: 'enum',
        required: false,
        order: index + 1,
        description: value.description ?? undefined,
        constraints: value.deprecationReason ? [constraint('deprecated', 'deprecated', value.deprecationReason)] : [],
        children: [],
        sourceRange: findTextRange(schemaText, value.name),
      }),
    );
    return node({
      id: type.name,
      name: type.name,
      kind: 'enum',
      dataType: 'enum',
      required: true,
      order,
      description: type.description ?? undefined,
      constraints: [],
      children,
      sourceRange: findTextRange(schemaText, `enum ${type.name}`) ?? findTextRange(schemaText, type.name),
    });
  }

  const maybeUnion = type as GraphQLNamedType & { getTypes?: () => GraphQLNamedType[] };
  if (typeof maybeUnion.getTypes === 'function') {
    const children = maybeUnion.getTypes().map((childType, index) =>
      node({
        id: `${maybeUnion.name}.${childType.name}`,
        name: childType.name,
        kind: 'union',
        dataType: 'object',
        required: false,
        order: index + 1,
        constraints: [],
        children: [],
        sourceRange: findTextRange(schemaText, childType.name),
      }),
    );
    return node({
      id: type.name,
      name: type.name,
      kind: 'union',
      dataType: 'union',
      required: true,
      order,
      description: type.description ?? undefined,
      constraints: [],
      children,
      sourceRange: findTextRange(schemaText, `union ${type.name}`) ?? findTextRange(schemaText, type.name),
    });
  }

  if (isScalarType(type)) {
    return node({
      id: type.name,
      name: type.name,
      kind: 'definition',
      dataType: 'scalar',
      required: true,
      order,
      description: type.description ?? undefined,
      constraints: [],
      children: [],
      sourceRange: findTextRange(schemaText, type.name),
    });
  }

  return node({
    id: type.name,
    name: type.name,
    kind: 'definition',
    dataType: 'unknown',
    required: true,
    order,
    constraints: [],
    children: [],
    sourceRange: findTextRange(schemaText, type.name),
  });
};

const introspectProtobuf = (schemaText: string, schemaFormat: SchemaFormat): SchemaSummary => {
  const rootNamespace = protobuf.parse(schemaText, { keepCase: true }).root;
  const state: BuildState = { count: 0, warnings: [], maxDepth: 0 };
  const children = protobufChildren(rootNamespace, schemaText, state, 0);
  const root = node({
    id: 'protobuf-root',
    name: 'Protocol Buffers',
    kind: 'root',
    dataType: 'object',
    required: true,
    order: 1,
    constraints: [constraint('definitions', 'definitions', children.length)],
    children,
    sourceRange: wholeDocumentRange(schemaText),
  });
  return createSummary(schemaFormat, 'Protocol Buffers summary', root, state.warnings);
};

const protobufChildren = (
  namespace: protobuf.NamespaceBase,
  schemaText: string,
  state: BuildState,
  depth: number,
): SchemaSummaryNode[] => {
  if (!canAddNode(state, depth)) {
    return [warningNode(['protobuf'], 'truncated', 'Summary truncated for safety.')];
  }

  return Object.values(namespace.nested ?? {}).flatMap((nested, index) => {
    if (nested instanceof protobuf.Type) {
      const fields = Object.values(nested.fields).sort((left, right) => left.id - right.id);
      return [
        node({
          id: nested.fullName,
          name: nested.name,
          kind: 'message',
          dataType: 'object',
          required: true,
          order: index + 1,
          constraints: [constraint('fields', 'fields', fields.length)],
          children: fields.map((field) =>
            node({
              id: `${nested.fullName}.${field.name}`,
              name: field.name,
              kind: 'field',
              dataType: field.map
                ? `map<${(field as unknown as protobuf.MapField).keyType}, ${field.type}>`
                : normalizeDataType(field.type),
              required: Boolean(field.required),
              order: field.id,
              constraints: [
                constraint('fieldNumber', 'field #', field.id),
                ...(field.repeated ? [constraint('repeated', 'repeated')] : []),
                ...(field.partOf ? [constraint('oneof', 'oneof', field.partOf.name)] : []),
              ],
              children: [],
              sourceRange: findTextRange(schemaText, field.name),
            }),
          ),
          sourceRange: findTextRange(schemaText, `message ${nested.name}`) ?? findTextRange(schemaText, nested.name),
        }),
      ];
    }

    if (nested instanceof protobuf.Enum) {
      return [
        node({
          id: nested.fullName,
          name: nested.name,
          kind: 'enum',
          dataType: 'enum',
          required: true,
          order: index + 1,
          constraints: [],
          children: Object.entries(nested.values).map(([name, value]) =>
            node({
              id: `${nested.fullName}.${name}`,
              name,
              kind: 'enum',
              dataType: 'enum',
              required: false,
              order: value,
              constraints: [constraint('number', 'number', value)],
              children: [],
              sourceRange: findTextRange(schemaText, name),
            }),
          ),
          sourceRange: findTextRange(schemaText, `enum ${nested.name}`) ?? findTextRange(schemaText, nested.name),
        }),
      ];
    }

    if (nested instanceof protobuf.Namespace) {
      return [
        node({
          id: nested.fullName,
          name: nested.name,
          kind: 'definition',
          dataType: 'object',
          required: true,
          order: index + 1,
          constraints: [],
          children: protobufChildren(nested, schemaText, state, depth + 1),
          sourceRange: findTextRange(schemaText, `package ${nested.name}`) ?? findTextRange(schemaText, nested.name),
        }),
      ];
    }

    return [];
  });
};

const introspectXsd = (
  schemaText: string,
  schemaFormat: SchemaFormat,
  relatedSchemas: RelatedSchemaDocument[] = [],
): SchemaSummary => {
  const parsed = parseXsdModel({
    primary: {
      id: PRIMARY_XSD_SOURCE_ID,
      label: 'Main schema',
      text: schemaText,
    },
    relatedSchemas,
  });

  if (!parsed.ok) {
    return createSummary(
      schemaFormat,
      'XSD summary',
      undefined,
      [],
      parsed.issues.map((issue) => issue.message),
    );
  }

  const state: BuildState = { count: 0, warnings: xsdSummaryWarnings(parsed.model), maxDepth: 0 };
  const rootElementName = parsed.model.rootElementName ? normalizeTypeName(parsed.model.rootElementName) : undefined;
  const rootElement = rootElementName ? parsed.model.globalElements.get(rootElementName) : undefined;
  if (!rootElement) {
    return createSummary(schemaFormat, 'XSD summary', undefined, ['No top-level xs:element was found.']);
  }

  const root = xsdElementNodeFromModel(rootElement, {
    model: parsed.model,
    state,
    activeTypePath: [],
    depth: 0,
    required: true,
    order: 1,
    kind: 'root',
  });
  return createSummary(schemaFormat, 'XSD summary', root, state.warnings);
};

interface XsdElementSummaryOptions {
  model: XsdSchemaModel;
  state: BuildState;
  activeTypePath: string[];
  depth: number;
  required: boolean;
  order: number;
  kind: SchemaSummaryNode['kind'];
}

interface XsdComplexChildrenOptions {
  model: XsdSchemaModel;
  state: BuildState;
  activeTypePath: string[];
  depth: number;
}

const xsdElementNodeFromModel = (
  element: XsdElementDecl,
  options: XsdElementSummaryOptions,
): SchemaSummaryNode => {
  const { model, state, activeTypePath, depth, required, order, kind } = options;
  const resolved = resolveXsdElement(model, element);
  const declaration = resolved.declaration;
  if (!canAddNode(state, depth)) {
    return warningNode(['xsd', declaration.name], declaration.name, 'Summary truncated for safety.', order);
  }

  const typeName = normalizeTypeName(declaration.typeName ?? 'xs:string');
  const complexType = model.complexTypes.get(typeName);
  const simpleType = model.simpleTypes.get(typeName);
  const constraints: SchemaConstraint[] = [
    constraint('minOccurs', 'min', String(element.minOccurs)),
    constraint('maxOccurs', 'max', formatMaxOccurs(element.maxOccurs)),
  ];

  if (element.refName) {
    constraints.push(constraint('ref', 'ref', element.refName));
  }
  if (resolved.missingRef) {
    constraints.push(constraint('missingRef', 'missing ref', resolved.missingRef));
  }
  if (simpleType) {
    constraints.push(...xsdSimpleTypeConstraintsFromModel(simpleType));
  }
  if (complexType?.simpleContent) {
    const baseSimpleType = model.simpleTypes.get(normalizeTypeName(complexType.simpleContent.baseType));
    if (baseSimpleType) {
      constraints.push(...xsdSimpleTypeConstraintsFromModel(baseSimpleType));
    }
    constraints.push(constraint('simpleContent', 'text base', complexType.simpleContent.baseType));
  }
  if (complexType?.complexContent) {
    constraints.push(
      constraint('derivation', complexType.complexContent.derivation, complexType.complexContent.baseType),
    );
  }

  if (complexType) {
    const cycleStart = activeTypePath.indexOf(complexType.name);
    if (cycleStart >= 0) {
      const cyclePath = [...activeTypePath.slice(cycleStart), complexType.name].join(' -> ');
      return node({
        id: xsdNodeId('element', element, order, 'recursive'),
        name: declaration.name,
        kind,
        dataType: typeName,
        required,
        order,
        constraints: [
          ...constraints,
          constraint('recursive', 'recursive ref', typeName),
          constraint('cycle', 'cycle', cyclePath),
        ],
        children: [],
        sourceRange: xsdSourceRange(model, element),
        warnings: [`Recursive reference to ${typeName}.`],
      });
    }
  }

  const children = complexType
    ? xsdComplexTypeChildren(complexType, {
        model,
        state,
        activeTypePath: [...activeTypePath, complexType.name],
        depth: depth + 1,
      })
    : [];

  return node({
    id: xsdNodeId('element', element, order),
    name: declaration.name,
    kind,
    dataType: typeName,
    required,
    order,
    constraints,
    children,
    sourceRange: xsdSourceRange(model, element),
    warnings: resolved.missingRef ? [`Missing XSD element reference ${resolved.missingRef}.`] : undefined,
  });
};

const xsdComplexTypeChildren = (
  complexType: XsdComplexType,
  options: XsdComplexChildrenOptions,
): SchemaSummaryNode[] => {
  const children: SchemaSummaryNode[] = [];

  if (complexType.complexContent) {
    const content = complexType.complexContent;
    const baseType = options.model.complexTypes.get(normalizeTypeName(content.baseType));
    if (content.derivation === 'extension' && baseType) {
      const baseIsRecursive = options.activeTypePath.includes(baseType.name);
      children.push(
        ...(baseIsRecursive
          ? [xsdRecursiveTypeNode(baseType.name, content, children.length + 1, options)]
          : xsdComplexTypeChildren(baseType, {
              ...options,
              activeTypePath: [...options.activeTypePath, baseType.name],
            })),
      );
    } else if (content.derivation === 'extension' && !baseType && !isBuiltinXsdType(content.baseType)) {
      children.push(xsdMissingTypeNode(content.baseType, content, children.length + 1));
    }

    if (content.group) {
      children.push(...xsdParticleGroupChildren(content.group, { ...options, orderOffset: children.length }));
    }
    children.push(
      ...xsdAttributeChildren(content.attributes, content.attributeGroupRefs, {
        ...options,
        orderOffset: children.length,
      }),
    );
    return children;
  }

  if (complexType.group) {
    children.push(...xsdParticleGroupChildren(complexType.group, { ...options, orderOffset: children.length }));
  }
  children.push(
    ...xsdAttributeChildren(complexType.attributes, complexType.attributeGroupRefs, {
      ...options,
      orderOffset: children.length,
    }),
  );

  return children;
};

const xsdParticleGroupChildren = (
  group: XsdParticleGroup,
  options: XsdComplexChildrenOptions & { orderOffset: number; parentRequired?: boolean },
): SchemaSummaryNode[] => {
  const children: SchemaSummaryNode[] = [];
  const groupRequired = (options.parentRequired ?? true) && group.minOccurs > 0;
  const particles: XsdParticleGroupItem[] = group.particles ?? group.elements.map((element) => ({ kind: 'element' as const, element }));

  for (const particle of particles) {
    if (particle.kind === 'element') {
      const childRequired = group.kind === 'choice' ? false : groupRequired && particle.element.minOccurs > 0;
      children.push(
        xsdElementNodeFromModel(particle.element, {
          model: options.model,
          state: options.state,
          activeTypePath: options.activeTypePath,
          depth: options.depth,
          required: childRequired,
          order: options.orderOffset + children.length + 1,
          kind: 'field',
        }),
      );
    } else {
      const referencedGroup = options.model.groups.get(normalizeTypeName(particle.groupRef.refName));
      if (!referencedGroup) {
        children.push(xsdMissingGroupNode(particle.groupRef, options.orderOffset + children.length + 1));
        continue;
      }

      children.push(
        ...xsdParticleGroupChildren(referencedGroup.group, {
          ...options,
          orderOffset: options.orderOffset + children.length,
          parentRequired: groupRequired && particle.groupRef.minOccurs > 0,
        }),
      );
    }
  }

  return children;
};

const xsdAttributeChildren = (
  attributes: XsdAttributeDecl[],
  attributeGroupRefs: XsdAttributeGroupRef[],
  options: XsdComplexChildrenOptions & { orderOffset: number; activeAttributeGroups?: string[] },
): SchemaSummaryNode[] => {
  const children = attributes.map((attribute, index) =>
    xsdAttributeNode(attribute, options.model, options.orderOffset + index + 1),
  );

  for (const attributeGroupRef of attributeGroupRefs) {
    const groupName = normalizeTypeName(attributeGroupRef.refName);
    if (options.activeAttributeGroups?.includes(groupName)) {
      children.push(xsdMissingAttributeGroupNode(attributeGroupRef, options.orderOffset + children.length + 1, true));
      continue;
    }

    const attributeGroup = options.model.attributeGroups.get(groupName);
    if (!attributeGroup) {
      children.push(xsdMissingAttributeGroupNode(attributeGroupRef, options.orderOffset + children.length + 1));
      continue;
    }

    children.push(
      ...xsdAttributeChildren(attributeGroup.attributes, attributeGroup.attributeGroupRefs, {
        ...options,
        orderOffset: options.orderOffset + children.length,
        activeAttributeGroups: [...(options.activeAttributeGroups ?? []), groupName],
      }),
    );
  }

  return children;
};

const xsdAttributeNode = (attribute: XsdAttributeDecl, model: XsdSchemaModel, order: number): SchemaSummaryNode => {
  const resolved = resolveXsdAttribute(model, attribute);
  const declaration = resolved.declaration;
  const typeName = normalizeTypeName(declaration.typeName ?? 'xs:string');
  const simpleType = model.simpleTypes.get(typeName);
  const use = attribute.prohibited ? 'prohibited' : attribute.required ? 'required' : 'optional';
  const constraints = [
    constraint('use', 'use', use),
    ...(attribute.refName ? [constraint('ref', 'ref', attribute.refName)] : []),
    ...(resolved.missingRef ? [constraint('missingRef', 'missing ref', resolved.missingRef)] : []),
    ...(simpleType ? xsdSimpleTypeConstraintsFromModel(simpleType) : []),
  ];

  return node({
    id: xsdNodeId('attribute', attribute, order),
    name: `@${declaration.name}`,
    kind: 'attribute',
    dataType: typeName,
    required: attribute.required && !attribute.prohibited,
    order,
    constraints,
    children: [],
    sourceRange: xsdSourceRange(model, attribute),
    warnings: resolved.missingRef ? [`Missing XSD attribute reference ${resolved.missingRef}.`] : undefined,
  });
};

const xsdSimpleTypeConstraintsFromModel = (simpleType: XsdSimpleType): SchemaConstraint[] =>
  simpleType.restrictions.map((restriction) => constraint(restriction.kind, xsdRestrictionLabel(restriction.kind), restriction.value));

const xsdRestrictionLabel = (kind: string) =>
  ({
    enumeration: 'enum',
    pattern: 'pattern',
    length: 'length',
    minLength: 'min length',
    maxLength: 'max length',
    minInclusive: 'min',
    maxInclusive: 'max',
    minExclusive: 'exclusive min',
    maxExclusive: 'exclusive max',
    totalDigits: 'total digits',
    fractionDigits: 'fraction digits',
  })[kind] ?? kind;

const resolveXsdElement = (
  model: XsdSchemaModel,
  declaration: XsdElementDecl,
): { declaration: XsdElementDecl; missingRef?: string } => {
  if (!declaration.refName) {
    return { declaration };
  }

  const referenced = model.globalElements.get(normalizeTypeName(declaration.refName));
  return referenced ? { declaration: referenced } : { declaration, missingRef: declaration.refName };
};

const resolveXsdAttribute = (
  model: XsdSchemaModel,
  attribute: XsdAttributeDecl,
): { declaration: XsdAttributeDecl; missingRef?: string } => {
  if (!attribute.refName) {
    return { declaration: attribute };
  }

  const referenced = model.attributes.get(normalizeTypeName(attribute.refName));
  return referenced ? { declaration: referenced } : { declaration: attribute, missingRef: attribute.refName };
};

const xsdRecursiveTypeNode = (
  typeName: string,
  declaration: XsdComplexContent,
  order: number,
  options: XsdComplexChildrenOptions,
): SchemaSummaryNode => {
  const cycleStart = options.activeTypePath.indexOf(typeName);
  const cyclePath = [...options.activeTypePath.slice(Math.max(0, cycleStart)), typeName].join(' -> ');
  return node({
    id: xsdNodeId('recursive', declaration, order),
    name: typeName,
    kind: 'field',
    dataType: typeName,
    required: false,
    order,
    constraints: [constraint('recursive', 'recursive ref', typeName), constraint('cycle', 'cycle', cyclePath)],
    warnings: [`Recursive reference to ${typeName}.`],
  });
};

const xsdMissingTypeNode = (typeName: string, declaration: XsdComplexContent, order: number): SchemaSummaryNode =>
  node({
    id: xsdNodeId('missing-type', declaration, order),
    name: typeName,
    kind: 'warning',
    dataType: 'unknown',
    required: false,
    order,
    constraints: [constraint('missingType', 'missing type', typeName)],
    warnings: [`XSD type ${typeName} is referenced but not declared in the loaded schema bundle.`],
  });

const xsdMissingGroupNode = (groupRef: XsdGroupRef, order: number): SchemaSummaryNode =>
  node({
    id: xsdNodeId('missing-group', groupRef, order),
    name: groupRef.refName,
    kind: 'warning',
    dataType: 'unknown',
    required: false,
    order,
    constraints: [constraint('missingGroup', 'missing group', groupRef.refName)],
    warnings: [`XSD group ${groupRef.refName} is referenced but not declared in the loaded schema bundle.`],
  });

const xsdMissingAttributeGroupNode = (
  attributeGroupRef: XsdAttributeGroupRef,
  order: number,
  recursive = false,
): SchemaSummaryNode =>
  node({
    id: xsdNodeId(recursive ? 'recursive-attribute-group' : 'missing-attribute-group', attributeGroupRef, order),
    name: attributeGroupRef.refName,
    kind: 'warning',
    dataType: 'unknown',
    required: false,
    order,
    constraints: [
      constraint(recursive ? 'recursive' : 'missingAttributeGroup', recursive ? 'recursive ref' : 'missing group', attributeGroupRef.refName),
    ],
    warnings: [
      recursive
        ? `Recursive attribute group reference to ${attributeGroupRef.refName}.`
        : `XSD attribute group ${attributeGroupRef.refName} is referenced but not declared in the loaded schema bundle.`,
    ],
  });

const xsdSummaryWarnings = (model: XsdSchemaModel) => {
  const summarizedFeatureCodes = new Set(['unsupported-group', 'unsupported-complexContent']);
  const seen = new Set<string>();
  return model.unsupportedFeatures
    .filter((feature) => !summarizedFeatureCodes.has(feature.code))
    .map((feature) => xsdFeatureWarning(feature))
    .filter((warning) => {
      if (seen.has(warning)) {
        return false;
      }
      seen.add(warning);
      return true;
    });
};

const xsdFeatureWarning = (feature: XsdUnsupportedFeature) => `${feature.title}: ${feature.message}`;

const xsdSourceRange = (model: XsdSchemaModel, declaration: { sourceId: string; range: TextRange }) =>
  declaration.sourceId === model.primarySourceId ? declaration.range : undefined;

const xsdNodeId = (prefix: string, declaration: { sourceId: string; range: TextRange }, order: number, suffix = '') =>
  ['xsd', prefix, declaration.sourceId, declaration.range.startLineNumber, declaration.range.startColumn, order, suffix]
    .filter((part) => part !== '')
    .join('-');

const isBuiltinXsdType = (typeName: string) => normalizeTypeName(typeName).startsWith('xs:');

const findOpenApiSchema = (root: unknown): { schema: unknown; path: string[] } | undefined => {
  const queue: Array<{ schema: unknown; path: string[]; depth: number }> = [{ schema: root, path: [], depth: 0 }];
  const visited = new WeakSet<object>();
  let fallback: { schema: unknown; path: string[] } | undefined;
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > 50) {
      continue;
    }
    if (typeof current.schema === 'object' && current.schema !== null) {
      if (visited.has(current.schema)) {
        continue;
      }
      visited.add(current.schema);
    }
    if (Array.isArray(current.schema)) {
      current.schema.forEach((item, index) =>
        queue.push({ schema: item, path: [...current.path, String(index)], depth: current.depth + 1 }),
      );
      continue;
    }
    if (!isRecord(current.schema)) {
      continue;
    }
    if (current.path.at(-1) === 'schema' && looksLikeJsonSchema(current.schema)) {
      return current;
    }
    if (!fallback && current.path.includes('schemas') && looksLikeJsonSchema(current.schema)) {
      fallback = current;
    }
    Object.entries(current.schema).forEach(([key, value]) => {
      if (isRecord(value) || Array.isArray(value)) {
        queue.push({ schema: value, path: [...current.path, key], depth: current.depth + 1 });
      }
    });
  }
  return fallback;
};

const resolveLocalRef = (
  root: unknown,
  schema: unknown,
  path: string[],
  visited = new Set<string>(),
  depth = 0,
): { schema: unknown; path: string[] } => {
  if (depth > 50) {
    return { schema, path };
  }
  if (isRecord(schema) && typeof schema.$ref === 'string' && schema.$ref.startsWith('#')) {
    const refPath = pointerToSegments(schema.$ref);
    const refPointer = segmentsToPointer(refPath);
    if (visited.has(refPointer)) {
      return { schema, path };
    }
    const resolved = getValueAtPath(root, refPath);
    if (resolved !== undefined) {
      visited.add(refPointer);
      return resolveLocalRef(root, resolved, refPath, visited, depth + 1);
    }
  }
  return { schema, path };
};

const looksLikeJsonSchema = (value: Record<string, unknown>) =>
  typeof value.type === 'string' || 'properties' in value || 'items' in value || 'required' in value || '$ref' in value;

const createSummary = (
  schemaFormat: SchemaFormat,
  title: string,
  root?: SchemaSummaryNode,
  warnings: string[] = [],
  errors: string[] = [],
): SchemaSummary => ({
  ok: errors.length === 0,
  schemaFormat,
  title,
  root,
  warnings,
  errors,
  stats: root
    ? collectStats(root, warnings.length)
    : { nodes: 0, required: 0, optional: 0, warnings: warnings.length, maxDepth: 0 },
});

const collectStats = (root: SchemaSummaryNode, warningCount: number): SchemaSummary['stats'] => {
  const visit = (current: SchemaSummaryNode, depth: number): SchemaSummary['stats'] => {
    const childStats = current.children.map((child) => visit(child, depth + 1));
    return childStats.reduce(
      (acc, stats) => ({
        nodes: acc.nodes + stats.nodes,
        required: acc.required + stats.required,
        optional: acc.optional + stats.optional,
        warnings: acc.warnings + stats.warnings,
        maxDepth: Math.max(acc.maxDepth, stats.maxDepth),
      }),
      {
        nodes: 1,
        required: current.required ? 1 : 0,
        optional: current.required ? 0 : 1,
        warnings: (current.warnings?.length ?? 0) + (current.kind === 'warning' ? 1 : 0),
        maxDepth: depth,
      },
    );
  };
  const stats = visit(root, 0);
  return { ...stats, warnings: stats.warnings + warningCount };
};

const node = (
  value: Omit<SchemaSummaryNode, 'constraints' | 'children'> &
    Partial<Pick<SchemaSummaryNode, 'constraints' | 'children'>>,
): SchemaSummaryNode => ({
  constraints: [],
  children: [],
  ...value,
});

const warningNode = (path: string[], name: string, message: string, order = 1): SchemaSummaryNode =>
  node({
    id: nodeId(path, name),
    name,
    kind: 'warning',
    dataType: 'unknown',
    required: false,
    order,
    constraints: [],
    children: [],
    warnings: [message],
  });

const constraint = (kind: string, label: string, value?: unknown): SchemaConstraint => ({
  kind,
  label,
  value: value === undefined ? undefined : String(value),
});

const canAddNode = (state: BuildState, depth: number) => {
  state.maxDepth = Math.max(state.maxDepth, depth);
  state.count += 1;
  if (depth > MAX_SUMMARY_DEPTH) {
    state.warnings.push('Schema summary reached the maximum safe depth.');
    return false;
  }
  if (state.count > MAX_SUMMARY_NODES) {
    state.warnings.push('Schema summary reached the maximum safe node count.');
    return false;
  }
  return true;
};

const nodeId = (path: string[], name: string) => [...path, name].filter(Boolean).join('/') || 'root';
const sourceRange = (state: JsonWalkState, path: string[]) =>
  state.document?.rangeForPath(path) ?? (path.length === 0 ? state.document?.rootRange : undefined);
const schemaTitle = (schema: unknown) =>
  isRecord(schema) ? stringValue(schema.title ?? schema.$id ?? schema.name) : undefined;
const stringValue = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);
const normalizeDataType = (type: string): string => {
  if (['int', 'long'].includes(type)) {
    return 'integer';
  }
  if (['float', 'double', 'decimal'].includes(type)) {
    return 'number';
  }
  if (type === 'dateTime') {
    return 'datetime';
  }
  return type;
};

const avroAllowsNull = (schema: unknown): boolean =>
  schema === 'null' ||
  (Array.isArray(schema) && schema.some(avroAllowsNull)) ||
  (isRecord(schema) && avroAllowsNull(schema.type));
const avroTypeLabel = (schema: unknown): string => {
  if (typeof schema === 'string') {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map(avroTypeLabel).join(' | ');
  }
  if (isRecord(schema)) {
    return String(schema.name ?? schema.type ?? 'record');
  }
  return 'unknown';
};

const unwrapNonNull = (type: GraphQLType): GraphQLType => (isNonNullType(type) ? type.ofType : type);
const graphqlTypeLabel = (type: GraphQLType): string => {
  if (isNonNullType(type)) {
    return `${graphqlTypeLabel(type.ofType)}!`;
  }
  if (isListType(type)) {
    return `[${graphqlTypeLabel(type.ofType)}]`;
  }
  return getNamedType(type).name;
};
const graphqlKindKeyword = (type: GraphQLNamedType) => {
  if (isInputObjectType(type)) {
    return 'input';
  }
  if (isInterfaceType(type)) {
    return 'interface';
  }
  return 'type';
};

export type { SchemaSummary, SchemaSummaryNode } from './types';
