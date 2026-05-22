import type { MessageFormat, SchemaFormat } from '../validation/types';

export interface ValidationSample {
  id: string;
  label: string;
  schemaFormat: SchemaFormat;
  messageFormat: MessageFormat;
  expected: 'pass' | 'fail';
  schemaText: string;
  messageText: string;
}

export const samples: ValidationSample[] = [
  {
    id: 'json-schema-missing-field',
    label: 'JSON Schema: missing required field',
    schemaFormat: 'json-schema',
    messageFormat: 'json',
    expected: 'fail',
    schemaText: `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["id", "email", "quantity"],
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "minLength": 3 },
    "email": { "type": "string", "format": "email" },
    "quantity": { "type": "integer", "minimum": 1 },
    "status": { "enum": ["new", "paid", "shipped"] }
  }
}`,
    messageText: `{
  "id": "A7",
  "email": "not-an-email",
  "status": "lost",
  "debug": true
}`,
  },
  {
    id: 'json-schema-valid',
    label: 'JSON Schema: valid order',
    schemaFormat: 'json-schema',
    messageFormat: 'json',
    expected: 'pass',
    schemaText: `{
  "type": "object",
  "required": ["id", "email", "quantity"],
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "minLength": 3 },
    "email": { "type": "string", "format": "email" },
    "quantity": { "type": "integer", "minimum": 1 }
  }
}`,
    messageText: `{
  "id": "ORD-42",
  "email": "buyer@example.com",
  "quantity": 3
}`,
  },
  {
    id: 'yaml-schema-fail',
    label: 'YAML payload: wrong type',
    schemaFormat: 'json-schema',
    messageFormat: 'yaml',
    expected: 'fail',
    schemaText: `type: object
required:
  - service
  - replicas
properties:
  service:
    type: string
  replicas:
    type: integer
    minimum: 1
  region:
    enum: [us-east, eu-west]`,
    messageText: `service: checkout
replicas: many
region: moon-base`,
  },
  {
    id: 'xml-xsd-fail',
    label: 'XML/XSD: missing element and bad type',
    schemaFormat: 'xsd',
    messageFormat: 'xml',
    expected: 'fail',
    schemaText: `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="id" type="xs:string" />
        <xs:element name="quantity" type="xs:integer" />
        <xs:element name="shipDate" type="xs:date" minOccurs="0" />
      </xs:sequence>
      <xs:attribute name="status" type="xs:string" use="required" />
    </xs:complexType>
  </xs:element>
</xs:schema>`,
    messageText: `<order>
  <id>ORD-42</id>
  <quantity>three</quantity>
  <extra>remove me</extra>
</order>`,
  },
  {
    id: 'xml-xsd-valid',
    label: 'XML/XSD: valid order',
    schemaFormat: 'xsd',
    messageFormat: 'xml',
    expected: 'pass',
    schemaText: `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="id" type="xs:string" />
        <xs:element name="quantity" type="xs:integer" />
      </xs:sequence>
      <xs:attribute name="status" type="xs:string" use="required" />
    </xs:complexType>
  </xs:element>
</xs:schema>`,
    messageText: `<order status="paid">
  <id>ORD-42</id>
  <quantity>3</quantity>
</order>`,
  },
  {
    id: 'openapi-example-fail',
    label: 'OpenAPI: response example fails',
    schemaFormat: 'openapi',
    messageFormat: 'json',
    expected: 'fail',
    schemaText: `openapi: 3.1.0
info:
  title: Orders
  version: 1.0.0
paths:
  /orders/{id}:
    get:
      responses:
        '200':
          description: Order
          content:
            application/json:
              schema:
                type: object
                required: [id, total]
                properties:
                  id:
                    type: string
                  total:
                    type: number
                  status:
                    enum: [new, paid, shipped]`,
    messageText: `{
  "id": "ORD-42",
  "total": "free",
  "status": "lost"
}`,
  },
  {
    id: 'graphql-fail',
    label: 'GraphQL: invalid field',
    schemaFormat: 'graphql',
    messageFormat: 'graphql',
    expected: 'fail',
    schemaText: `type Query {
  order(id: ID!): Order
}

type Order {
  id: ID!
  total: Float!
  status: String!
}`,
    messageText: `query OrderDetails {
  order(id: "ORD-42") {
    id
    total
    trackingNumber
  }
}`,
  },
  {
    id: 'protobuf-fail',
    label: 'Protobuf: wrong JSON field type',
    schemaFormat: 'protobuf',
    messageFormat: 'json',
    expected: 'fail',
    schemaText: `syntax = "proto3";

message Order {
  string id = 1;
  int32 quantity = 2;
  string status = 3;
}`,
    messageText: `{
  "id": "ORD-42",
  "quantity": "three",
  "status": "paid",
  "debug": true
}`,
  },
  {
    id: 'avro-fail',
    label: 'Avro: record type mismatch',
    schemaFormat: 'avro',
    messageFormat: 'json',
    expected: 'fail',
    schemaText: `{
  "type": "record",
  "name": "Order",
  "fields": [
    { "name": "id", "type": "string" },
    { "name": "quantity", "type": "int" }
  ]
}`,
    messageText: `{
  "id": "ORD-42",
  "quantity": "three"
}`,
  },
  {
    id: 'csv-fail',
    label: 'CSV: required cell and type errors',
    schemaFormat: 'table-schema',
    messageFormat: 'csv',
    expected: 'fail',
    schemaText: `{
  "fields": [
    { "name": "id", "type": "string", "required": true },
    { "name": "quantity", "type": "integer", "required": true },
    { "name": "paid", "type": "boolean" }
  ]
}`,
    messageText: `id,quantity,paid
ORD-42,three,yes
ORD-43,,maybe`,
  },
  {
    id: 'toml-fail',
    label: 'TOML: JSON Schema rules fail',
    schemaFormat: 'toml-schema',
    messageFormat: 'toml',
    expected: 'fail',
    schemaText: `{
  "type": "object",
  "required": ["service", "port"],
  "properties": {
    "service": { "type": "string" },
    "port": { "type": "integer", "minimum": 1024 }
  }
}`,
    messageText: `service = "api"
port = "eighty"`,
  },
  {
    id: 'key-value-fail',
    label: 'INI/ENV: missing and invalid values',
    schemaFormat: 'key-value-rules',
    messageFormat: 'properties',
    expected: 'fail',
    schemaText: `{
  "required": ["DATABASE_URL", "PORT"],
  "properties": {
    "DATABASE_URL": { "type": "string", "required": true, "pattern": "^postgres://" },
    "PORT": { "type": "integer", "required": true },
    "NODE_ENV": { "enum": ["development", "test", "production"] }
  }
}`,
    messageText: `DATABASE_URL=mysql://localhost
PORT=abc
NODE_ENV=staging
NODE_ENV=production`,
  },
];

export const defaultSample = samples[0];
