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

const complexShipmentSchema = `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="ShipmentNotification" type="ShipmentNotificationType" />

  <xs:complexType name="ShipmentNotificationType">
    <xs:sequence>
      <xs:element name="Header" type="HeaderType" />
      <xs:element name="Payload" type="PayloadType" />
      <xs:element name="Signature" type="xs:string" minOccurs="0" />
    </xs:sequence>
    <xs:attribute name="version" type="VersionType" use="required" />
  </xs:complexType>

  <xs:complexType name="HeaderType">
    <xs:sequence>
      <xs:element name="ShipmentID" type="ShipmentIDType" />
      <xs:element name="Status" type="StatusType" />
      <xs:element name="CreatedTimestamp" type="xs:dateTime" />
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="PayloadType">
    <xs:sequence>
      <xs:element name="CarrierReference" type="CarrierReferenceType" />
      <xs:element name="LOAD" type="LoadType" maxOccurs="unbounded" />
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="CarrierReferenceType">
    <xs:sequence>
      <xs:element name="CarrierCode" type="CarrierCodeType" />
      <xs:element name="CarrierName" type="xs:string" minOccurs="0" />
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="LoadType">
    <xs:sequence>
      <xs:element name="LoadID" type="LoadIDType" />
      <xs:element name="Quantity" type="QuantityType" />
      <xs:element name="Weight" type="WeightType" minOccurs="0" />
    </xs:sequence>
    <xs:attribute name="unit" type="UnitType" use="required" />
  </xs:complexType>

  <xs:simpleType name="StatusType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="ORIGINAL" />
      <xs:enumeration value="UPDATE" />
      <xs:enumeration value="CANCELLED" />
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="ShipmentIDType">
    <xs:restriction base="xs:string">
      <xs:pattern value="SHP-[0-9]{5}" />
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="LoadIDType">
    <xs:restriction base="xs:string">
      <xs:minLength value="3" />
      <xs:maxLength value="12" />
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="QuantityType">
    <xs:restriction base="xs:integer">
      <xs:minInclusive value="1" />
      <xs:maxInclusive value="1000" />
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="WeightType">
    <xs:restriction base="xs:decimal">
      <xs:minExclusive value="0" />
      <xs:totalDigits value="6" />
      <xs:fractionDigits value="2" />
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="CarrierCodeType">
    <xs:restriction base="xs:string">
      <xs:pattern value="[A-Z]{4}" />
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="VersionType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="1.0" />
      <xs:enumeration value="2.0" />
    </xs:restriction>
  </xs:simpleType>

  <xs:simpleType name="UnitType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="KG" />
      <xs:enumeration value="LB" />
    </xs:restriction>
  </xs:simpleType>
</xs:schema>`;

const validComplexShipmentXml = `<ns:ShipmentNotification xmlns:ns="https://example.test/shipment" version="2.0">
  <ns:Header>
    <ns:ShipmentID>SHP-12345</ns:ShipmentID>
    <ns:Status>ORIGINAL</ns:Status>
    <ns:CreatedTimestamp>2026-05-22T13:00:00Z</ns:CreatedTimestamp>
  </ns:Header>
  <ns:Payload>
    <ns:CarrierReference>
      <ns:CarrierCode>ABCD</ns:CarrierCode>
      <ns:CarrierName>Example Carrier</ns:CarrierName>
    </ns:CarrierReference>
    <ns:LOAD unit="KG">
      <ns:LoadID>LOAD-100</ns:LoadID>
      <ns:Quantity>25</ns:Quantity>
      <ns:Weight>123.45</ns:Weight>
    </ns:LOAD>
    <ns:LOAD unit="LB">
      <ns:LoadID>LD2</ns:LoadID>
      <ns:Quantity>1</ns:Quantity>
    </ns:LOAD>
  </ns:Payload>
</ns:ShipmentNotification>`;

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

  it('accepts a single valid choice branch without requiring the other alternatives', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="contact">
    <xs:complexType>
      <xs:choice>
        <xs:element name="email" type="xs:string" />
        <xs:element name="phone" type="xs:string" />
      </xs:choice>
    </xs:complexType>
  </xs:element>
</xs:schema>`,
      messageText: '<contact><email>a@example.com</email></contact>',
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
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

  it('validates named complex types, deep nesting, namespaces, attributes, and unbounded arrays', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: complexShipmentSchema,
      messageText: validComplexShipmentXml,
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('resolves target namespace prefixes and validates the matching global XML root', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:tns="https://example.test/types" targetNamespace="https://example.test/types">
  <xs:element name="Envelope" type="tns:EnvelopeType" />
  <xs:element name="Alternate" type="tns:AlternateType" />
  <xs:complexType name="EnvelopeType">
    <xs:sequence>
      <xs:element name="id" type="xs:string" />
    </xs:sequence>
  </xs:complexType>
  <xs:complexType name="AlternateType">
    <xs:sequence>
      <xs:element name="value" type="xs:int" />
    </xs:sequence>
  </xs:complexType>
</xs:schema>`,
      messageText: '<ns:Alternate xmlns:ns="https://example.test/types"><ns:value>42</ns:value></ns:Alternate>',
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('ignores XML declarations before the message root', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: orderSchema,
      messageText: `<?xml version="1.0" encoding="UTF-8"?>
<order status="paid"><id>ORD-42</id><quantity>3</quantity></order>`,
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('supports xsi:nil for nillable elements and rejects it elsewhere', async () => {
    const schemaText = `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="record">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="note" type="xs:string" nillable="true" />
        <xs:element name="status" type="xs:string" />
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

    const valid = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText,
      messageText: '<record xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><note xsi:nil="true" /><status>open</status></record>',
    });
    const invalid = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText,
      messageText: '<record xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><note>ok</note><status xsi:nil="true" /></record>',
    });

    expect(valid.ok).toBe(true);
    expect(invalid.ok).toBe(false);
    expect(invalid.issues.map((issue) => issue.code)).toContain('xsd-nillable');
  });

  it('rejects prohibited attributes declared by the XSD', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="record">
    <xs:complexType>
      <xs:attribute name="legacy" use="prohibited" />
    </xs:complexType>
  </xs:element>
</xs:schema>`,
      messageText: '<record legacy="true" />',
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('xsd-prohibited-attribute');
  });

  it('reports one enum issue for a value outside all allowed values', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="color" type="ColorType" />
  <xs:simpleType name="ColorType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="red" />
      <xs:enumeration value="green" />
      <xs:enumeration value="blue" />
    </xs:restriction>
  </xs:simpleType>
</xs:schema>`,
      messageText: '<color>yellow</color>',
    });

    expect(result.ok).toBe(false);
    expect(result.issues.filter((issue) => issue.code === 'xsd-enumeration')).toHaveLength(1);
  });

  it('reports missing nested required elements inside named complex types', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: complexShipmentSchema,
      messageText: validComplexShipmentXml.replace('<ns:Quantity>25</ns:Quantity>', ''),
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('missing-xml-element');
    expect(result.issues.map((issue) => issue.path)).toContain('/ShipmentNotification/Payload/LOAD/Quantity');
  });

  it('enforces simpleType enum, pattern, length, and numeric restrictions', async () => {
    const invalidXml = validComplexShipmentXml
      .replace('<ns:Status>ORIGINAL</ns:Status>', '<ns:Status>INVALID</ns:Status>')
      .replace('<ns:ShipmentID>SHP-12345</ns:ShipmentID>', '<ns:ShipmentID>BAD-12345</ns:ShipmentID>')
      .replace('<ns:LoadID>LD2</ns:LoadID>', '<ns:LoadID>XY</ns:LoadID>')
      .replace('<ns:Quantity>25</ns:Quantity>', '<ns:Quantity>0</ns:Quantity>')
      .replace('<ns:Weight>123.45</ns:Weight>', '<ns:Weight>1234.567</ns:Weight>')
      .replace('version="2.0"', 'version="3.0"')
      .replace('unit="KG"', 'unit="STONE"');

    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: complexShipmentSchema,
      messageText: invalidXml,
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'xsd-enumeration',
        'xsd-pattern',
        'xsd-min-length',
        'xsd-min-inclusive',
        'xsd-fraction-digits',
      ]),
    );
  });

  it('reports unexpected nested elements and sequence order violations', async () => {
    const invalidXml = validComplexShipmentXml
      .replace('<ns:Status>ORIGINAL</ns:Status>', '<ns:Unexpected>nope</ns:Unexpected><ns:Status>ORIGINAL</ns:Status>')
      .replace(
        '<ns:CarrierReference>',
        '<ns:LOAD unit="KG"><ns:LoadID>EARLY</ns:LoadID><ns:Quantity>2</ns:Quantity></ns:LOAD><ns:CarrierReference>',
      );

    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: complexShipmentSchema,
      messageText: invalidXml,
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['unexpected-xml-element', 'xsd-sequence-order']),
    );
  });

  it('fails closed when unsupported external schema imports could affect correctness', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:include schemaLocation="shared-types.xsd" />
  <xs:element name="order" type="SharedOrderType" />
</xs:schema>`,
      messageText: '<order />',
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('unsupported-xsd-feature');
  });
});
