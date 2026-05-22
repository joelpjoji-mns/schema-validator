import { describe, expect, it } from 'vitest';
import { validateRequest } from '../registry';

const orderSchema = `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="id" type="xs:string" maxOccurs="1" />
        <xs:element name="quantity" type="xs:integer" />
      </xs:sequence>
      <xs:attribute name="status" type="xs:string" use="required" />
    </xs:complexType>
  </xs:element>
</xs:schema>`;

const shipmentSchema = `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="ShipmentNotification">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Header" type="HeaderType" />
        <xs:element name="Payload" type="ShipmentType" />
      </xs:sequence>
    </xs:complexType>
  </xs:element>
  <xs:complexType name="HeaderType">
    <xs:sequence>
      <xs:element name="CorrelationID" type="xs:string" />
      <xs:element name="CreatedTimestamp" type="xs:string" />
    </xs:sequence>
  </xs:complexType>
  <xs:complexType name="ShipmentType">
    <xs:sequence>
      <xs:element name="ShipmentID" type="xs:string" />
    </xs:sequence>
  </xs:complexType>
</xs:schema>`;

describe('XML/XSD lite edge cases', () => {
  it('accepts namespace-prefixed XML when local names match the XSD', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: orderSchema,
      messageText: `<ns:order xmlns:ns="https://example.test/order" status="">
  <ns:id>ORD-42</ns:id>
  <ns:quantity>3</ns:quantity>
</ns:order>`,
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('reports maxOccurs violations', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: orderSchema,
      messageText: `<order status="paid">
  <id>ORD-42</id>
  <id>ORD-43</id>
  <quantity>3</quantity>
</order>`,
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('xsd-max-occurs');
  });

  it('validates root-level choice cardinality', async () => {
    const schemaText = `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="contact">
    <xs:complexType>
      <xs:choice>
        <xs:element name="email" type="xs:string" />
        <xs:element name="phone" type="xs:string" />
      </xs:choice>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText,
      messageText: `<contact>
  <email>a@example.com</email>
  <phone>555-0100</phone>
</contact>`,
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('xsd-choice-too-many');
  });

  it('does not mark required complex elements with nested children as empty', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: shipmentSchema,
      messageText: `<ShipmentNotification>
  <Header>
    <CorrelationID>ORD-42</CorrelationID>
    <CreatedTimestamp>2026-05-22T13:00:00Z</CreatedTimestamp>
  </Header>
  <Payload>
    <ShipmentID>SHP-100</ShipmentID>
  </Payload>
</ShipmentNotification>`,
    });

    expect(result.issues.filter((issue) => issue.code === 'empty-xml-element')).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it('still reports self-closing and whitespace-only required complex elements as empty', async () => {
    const selfClosing = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: shipmentSchema,
      messageText: `<ShipmentNotification>
  <Header />
  <Payload>
    <ShipmentID>SHP-100</ShipmentID>
  </Payload>
</ShipmentNotification>`,
    });
    const whitespaceOnly = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: shipmentSchema,
      messageText: `<ShipmentNotification>
  <Header>   </Header>
  <Payload>
    <ShipmentID>SHP-100</ShipmentID>
  </Payload>
</ShipmentNotification>`,
    });

    expect(selfClosing.issues.map((issue) => issue.code)).toContain('empty-xml-element');
    expect(whitespaceOnly.issues.map((issue) => issue.code)).toContain('empty-xml-element');
  });

  it('rejects nested XML inside primitive typed elements', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: orderSchema,
      messageText: `<order status="paid">
  <id><value>ORD-42</value></id>
  <quantity>3</quantity>
</order>`,
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('xml-element-type');
  });
});
