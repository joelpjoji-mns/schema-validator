import { describe, expect, it } from 'vitest';
import { introspectSchema } from './index';

describe('introspectSchema', () => {
  it('summarizes JSON Schema fields, required flags, and limits', () => {
    const summary = introspectSchema({
      schemaFormat: 'json-schema',
      schemaText: JSON.stringify({
        title: 'Order',
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', minLength: 3 },
          quantity: { type: 'integer', minimum: 1 },
        },
        additionalProperties: false,
      }),
    });

    expect(summary.ok).toBe(true);
    expect(summary.root?.name).toBe('Order');
    expect(summary.root?.children.map((child) => child.name)).toEqual(['id', 'quantity']);
    expect(summary.root?.children[0].required).toBe(true);
    expect(summary.root?.children[1].constraints.map((item) => item.kind)).toContain('minimum');
  });

  it('summarizes XSD hierarchy with attributes', () => {
    const summary = introspectSchema({
      schemaFormat: 'xsd',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="ShipmentNotification">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Header" type="HeaderType" />
        <xs:element name="Payload" type="ShipmentType" minOccurs="0" />
      </xs:sequence>
      <xs:attribute name="version" type="xs:string" use="required" />
    </xs:complexType>
  </xs:element>
  <xs:complexType name="HeaderType">
    <xs:sequence>
      <xs:element name="CorrelationID" type="xs:string" />
    </xs:sequence>
  </xs:complexType>
  <xs:complexType name="ShipmentType">
    <xs:sequence>
      <xs:element name="ShipmentID" type="xs:string" />
    </xs:sequence>
  </xs:complexType>
</xs:schema>`,
    });

    const names = summary.root?.children.map((child) => child.name);
    expect(summary.ok).toBe(true);
    expect(summary.root?.name).toBe('ShipmentNotification');
    expect(names).toContain('Header');
    expect(names).toContain('Payload');
    expect(names).toContain('@version');
    expect(summary.root?.children.find((child) => child.name === 'Payload')?.required).toBe(false);
  });

  it('summarizes GraphQL SDL', () => {
    const summary = introspectSchema({
      schemaFormat: 'graphql',
      schemaText: 'type Query { order(id: ID!): Order } type Order { id: ID! status: String } enum Status { NEW SENT }',
    });

    expect(summary.ok).toBe(true);
    expect(summary.root?.children.map((child) => child.name)).toContain('Order');
    expect(summary.root?.children.find((child) => child.name === 'Status')?.kind).toBe('enum');
  });

  it('summarizes Protobuf messages and enums', () => {
    const summary = introspectSchema({
      schemaFormat: 'protobuf',
      schemaText:
        'syntax = "proto3"; message Order { string id = 1; repeated string tags = 2; } enum Status { STATUS_UNSPECIFIED = 0; SENT = 1; }',
    });

    expect(summary.ok).toBe(true);
    expect(summary.root?.children.map((child) => child.name)).toEqual(expect.arrayContaining(['Order', 'Status']));
    expect(
      summary.root?.children.find((child) => child.name === 'Order')?.children.map((child) => child.name),
    ).toContain('id');
  });

  it('summarizes OpenAPI, Avro, table schema, and key-value rules', () => {
    const openApi = introspectSchema({
      schemaFormat: 'openapi',
      schemaText: JSON.stringify({
        openapi: '3.1.0',
        paths: {},
        components: { schemas: { Order: { type: 'object', properties: { id: { type: 'string' } } } } },
      }),
    });
    const avro = introspectSchema({
      schemaFormat: 'avro',
      schemaText: '{"type":"record","name":"Order","fields":[{"name":"id","type":"string"}]}',
    });
    const table = introspectSchema({
      schemaFormat: 'table-schema',
      schemaText: '{"fields":[{"name":"id","type":"string","required":true}]}',
    });
    const keyValue = introspectSchema({
      schemaFormat: 'key-value-rules',
      schemaText: '{"properties":{"PORT":{"type":"integer","minimum":1,"required":true}}}',
    });

    expect(openApi.root?.children.map((child) => child.name)).toContain('id');
    expect(avro.root?.children.map((child) => child.name)).toContain('id');
    expect(table.root?.children[0].name).toBe('id');
    expect(keyValue.root?.children[0].name).toBe('PORT');
  });
});
