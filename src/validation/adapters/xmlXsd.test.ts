import { describe, expect, it } from 'vitest';
import { validateRequest } from '../registry';
import { parseXsdModel } from './xsd/parseXsdModel';
import { validateXmlAgainstXsdModel } from './xsd/validateXsdModel';

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
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:tns="https://example.test/shipment" targetNamespace="https://example.test/shipment" elementFormDefault="qualified">
  <xs:element name="ShipmentNotification" type="tns:ShipmentNotificationType" />

  <xs:complexType name="ShipmentNotificationType">
    <xs:sequence>
      <xs:element name="Header" type="tns:HeaderType" />
      <xs:element name="Payload" type="tns:PayloadType" />
      <xs:element name="Signature" type="xs:string" minOccurs="0" />
    </xs:sequence>
    <xs:attribute name="version" type="tns:VersionType" use="required" />
  </xs:complexType>

  <xs:complexType name="HeaderType">
    <xs:sequence>
      <xs:element name="ShipmentID" type="tns:ShipmentIDType" />
      <xs:element name="Status" type="tns:StatusType" />
      <xs:element name="CreatedTimestamp" type="xs:dateTime" />
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="PayloadType">
    <xs:sequence>
      <xs:element name="CarrierReference" type="tns:CarrierReferenceType" />
      <xs:element name="LOAD" type="tns:LoadType" maxOccurs="unbounded" />
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="CarrierReferenceType">
    <xs:sequence>
      <xs:element name="CarrierCode" type="tns:CarrierCodeType" />
      <xs:element name="CarrierName" type="xs:string" minOccurs="0" />
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="LoadType">
    <xs:sequence>
      <xs:element name="LoadID" type="tns:LoadIDType" />
      <xs:element name="Quantity" type="tns:QuantityType" />
      <xs:element name="Weight" type="tns:WeightType" minOccurs="0" />
    </xs:sequence>
    <xs:attribute name="unit" type="tns:UnitType" use="required" />
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
  it('accepts namespace-prefixed XML when the XSD declares the target namespace', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="https://example.test/order" elementFormDefault="qualified">
  <xs:element name="order">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="id" type="xs:string" maxOccurs="1" />
        <xs:element name="quantity" type="xs:integer" />
      </xs:sequence>
      <xs:attribute name="status" type="xs:string" use="required" />
    </xs:complexType>
  </xs:element>
</xs:schema>`,
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
    expect(result.issues.map((issue) => issue.code)).toContain('unexpected-xml-element');
  });

  it('explains a required sequence element missing before the next XML element', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="ShipmentNotification">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Header" type="HeaderType" />
      </xs:sequence>
    </xs:complexType>
  </xs:element>
  <xs:complexType name="HeaderType">
    <xs:sequence>
      <xs:element name="MessageId" type="xs:string" />
      <xs:element name="CreatedTimestamp" type="xs:dateTime" />
    </xs:sequence>
  </xs:complexType>
</xs:schema>`,
      messageText: `<ShipmentNotification>
  <Header>
    <CreatedTimestamp>2026-05-23T18:30:00Z</CreatedTimestamp>
  </Header>
</ShipmentNotification>`,
    });

    expect(result.ok).toBe(false);
    const issue = result.issues.find((item) => item.title.includes('MessageId'));
    expect(issue).toMatchObject({
      code: 'missing-xml-element',
      title: 'MessageId is missing before CreatedTimestamp',
      path: '/ShipmentNotification/Header/MessageId',
      expected: '<MessageId> before <CreatedTimestamp>',
      actual: '<CreatedTimestamp>',
    });
    expect(issue?.message).toContain('<MessageId> is required before <CreatedTimestamp>');
    expect(issue?.hint).toContain('Add <MessageId>');
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
    expect(result.issues.map((issue) => issue.code)).toContain('unexpected-xml-element');
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

  it('reports missing child elements for empty required complex elements', async () => {
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

    expect(selfClosing.issues.map((issue) => issue.code)).toContain('missing-xml-element');
    expect(whitespaceOnly.issues.map((issue) => issue.code)).toContain('missing-xml-element');
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
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:tns="https://example.test/types" targetNamespace="https://example.test/types" elementFormDefault="qualified">
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
      messageText:
        '<record xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><note xsi:nil="true" /><status>open</status></record>',
    });
    const invalid = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText,
      messageText:
        '<record xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><note>ok</note><status xsi:nil="true" /></record>',
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
    expect(result.issues.map((issue) => issue.code)).toContain('unexpected-xml-attribute');
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
    expect(result.issues.map((issue) => issue.title).join('\n')).toContain('Quantity');
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

  it('validates simpleContent extension declared in an included XSD source', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:include schemaLocation="header-types.xsd" />
  <xs:element name="Header" type="HeaderType" />
</xs:schema>`,
      relatedSchemas: [
        {
          id: 'header-types',
          label: 'header-types.xsd',
          schemaLocation: 'header-types.xsd',
          text: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:complexType name="HeaderType">
    <xs:simpleContent>
      <xs:extension base="xs:string">
        <xs:attribute name="version" type="xs:string" use="required" />
      </xs:extension>
    </xs:simpleContent>
  </xs:complexType>
</xs:schema>`,
        },
      ],
      messageText: '<Header version="2.0">Shipment header</Header>',
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('enforces simpleContent extension base type and required attributes', async () => {
    const schemaText = `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Weight">
    <xs:complexType>
      <xs:simpleContent>
        <xs:extension base="xs:decimal">
          <xs:attribute name="unit" type="xs:string" use="required" />
        </xs:extension>
      </xs:simpleContent>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

    const invalidText = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText,
      messageText: '<Weight unit="KG">heavy</Weight>',
    });
    const missingAttribute = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText,
      messageText: '<Weight>12.50</Weight>',
    });

    expect(invalidText.ok).toBe(false);
    expect(invalidText.issues.map((issue) => issue.code)).toContain('xml-element-type');
    expect(missingAttribute.ok).toBe(false);
    expect(missingAttribute.issues.map((issue) => issue.code)).toContain('missing-xml-attribute');
  });

  it('applies named simpleType facets through simpleContent extension bases', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Status" type="StatusWithSource" />
  <xs:simpleType name="StatusBase">
    <xs:restriction base="xs:string">
      <xs:enumeration value="ORIGINAL" />
      <xs:enumeration value="UPDATE" />
    </xs:restriction>
  </xs:simpleType>
  <xs:complexType name="StatusWithSource">
    <xs:simpleContent>
      <xs:extension base="StatusBase">
        <xs:attribute name="source" type="xs:string" />
      </xs:extension>
    </xs:simpleContent>
  </xs:complexType>
</xs:schema>`,
      messageText: '<Status source="EDI">CANCELLED</Status>',
    });

    expect(result.ok).toBe(false);
    expect(result.issues.filter((issue) => issue.code === 'xsd-enumeration')).toHaveLength(1);
  });

  it('rejects child elements inside simpleContent extension values', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Reference">
    <xs:complexType>
      <xs:simpleContent>
        <xs:extension base="xs:string">
          <xs:attribute name="type" type="xs:string" />
        </xs:extension>
      </xs:simpleContent>
    </xs:complexType>
  </xs:element>
</xs:schema>`,
      messageText: '<Reference type="carrier"><Value>ABC</Value></Reference>',
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('xml-element-type');
  });

  it('reports invalid simpleContent restriction schemas through the full engine', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Code">
    <xs:complexType>
      <xs:simpleContent>
        <xs:restriction base="xs:string" />
      </xs:simpleContent>
    </xs:complexType>
  </xs:element>
</xs:schema>`,
      messageText: '<Code>ABC</Code>',
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('xsd-schema-error');
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
    expect(result.issues.map((issue) => issue.code)).toContain('unexpected-xml-element');
  });

  it('validates complexContent extension with inherited base elements', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:complexType name="BaseShipment">
    <xs:sequence>
      <xs:element name="ShipmentID" type="xs:string" />
    </xs:sequence>
  </xs:complexType>
  <xs:complexType name="ExtendedShipment">
    <xs:complexContent>
      <xs:extension base="BaseShipment">
        <xs:sequence>
          <xs:element name="Status" type="xs:string" />
        </xs:sequence>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>
  <xs:element name="Shipment" type="ExtendedShipment" />
</xs:schema>`,
      messageText: '<Shipment><ShipmentID>SHP-1</ShipmentID><Status>ORIGINAL</Status></Shipment>',
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('validates xs:group and xs:attributeGroup references', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:group name="NameGroup">
    <xs:sequence>
      <xs:element name="FirstName" type="xs:string" />
      <xs:element name="LastName" type="xs:string" />
    </xs:sequence>
  </xs:group>
  <xs:attributeGroup name="AuditAttributes">
    <xs:attribute name="source" type="xs:string" use="required" />
  </xs:attributeGroup>
  <xs:element name="Person">
    <xs:complexType>
      <xs:sequence>
        <xs:group ref="NameGroup" />
      </xs:sequence>
      <xs:attributeGroup ref="AuditAttributes" />
    </xs:complexType>
  </xs:element>
</xs:schema>`,
      messageText: '<Person source="master"><FirstName>Joel</FirstName><LastName>Joseph</LastName></Person>',
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('validates list and union simple types with XSD semantics', async () => {
    const valid = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:simpleType name="NumberList">
    <xs:list itemType="xs:integer" />
  </xs:simpleType>
  <xs:simpleType name="CodeType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="ABC" />
      <xs:enumeration value="XYZ" />
    </xs:restriction>
  </xs:simpleType>
  <xs:simpleType name="CodeOrNumber">
    <xs:union memberTypes="CodeType xs:integer" />
  </xs:simpleType>
  <xs:element name="Record">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Numbers" type="NumberList" />
        <xs:element name="Code" type="CodeOrNumber" />
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`,
      messageText: '<Record><Numbers>1 2 3</Numbers><Code>ABC</Code></Record>',
    });
    const invalid = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:simpleType name="NumberList"><xs:list itemType="xs:integer" /></xs:simpleType>
  <xs:element name="Numbers" type="NumberList" />
</xs:schema>`,
      messageText: '<Numbers>1 nope 3</Numbers>',
    });

    expect(valid.ok).toBe(true);
    expect(invalid.ok).toBe(false);
    expect(invalid.issues.map((issue) => issue.code)).toContain('xml-element-type');
  });

  it('validates identity constraints such as xs:unique', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Items">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Item" maxOccurs="unbounded">
          <xs:complexType>
            <xs:attribute name="id" type="xs:string" use="required" />
          </xs:complexType>
        </xs:element>
      </xs:sequence>
    </xs:complexType>
    <xs:unique name="uniqueItemId">
      <xs:selector xpath="Item" />
      <xs:field xpath="@id" />
    </xs:unique>
  </xs:element>
</xs:schema>`,
      messageText: '<Items><Item id="A" /><Item id="A" /></Items>',
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.message).join('\n')).toContain('uniqueItemId');
  });

  it('resolves nested schemaLocation paths through Sources tab preloads', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:include schemaLocation="types/header-types.xsd" />
  <xs:element name="Header" type="HeaderType" />
</xs:schema>`,
      relatedSchemas: [
        {
          id: 'header-types',
          label: 'header-types.xsd',
          schemaLocation: 'types/header-types.xsd',
          text: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:complexType name="HeaderType">
    <xs:simpleContent>
      <xs:extension base="xs:string">
        <xs:attribute name="version" type="xs:string" use="required" />
      </xs:extension>
    </xs:simpleContent>
  </xs:complexType>
</xs:schema>`,
        },
      ],
      messageText: '<Header version="2.0">ok</Header>',
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('validates nested particles declared inside an included XSD source', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:include schemaLocation="header-types.xsd" />
  <xs:element name="ShipmentNotification">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Header" type="HeaderType" />
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`,
      relatedSchemas: [
        {
          id: 'header-types',
          label: 'header-types.xsd',
          schemaLocation: 'header-types.xsd',
          text: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:complexType name="HeaderType">
    <xs:sequence>
      <xs:element name="EnvelopeVersion" type="xs:string" />
      <xs:sequence>
        <xs:element name="Filter" type="xs:string" />
      </xs:sequence>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`,
        },
      ],
      messageText:
        '<ShipmentNotification><Header><EnvelopeVersion>1.0</EnvelopeVersion><Filter>Level2</Filter></Header></ShipmentNotification>',
    });

    expect(result.ok).toBe(true);
    expect(result.issues.map((issue) => issue.title).join('\n')).not.toContain('Unsupported nested XSD particle');
  });

  it('expands nested sequence, choice, and all particles in the TypeScript fallback model', async () => {
    const schemaText = `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Header" type="HeaderType" />
  <xs:complexType name="HeaderType">
    <xs:sequence>
      <xs:element name="EnvelopeVersion" type="xs:string" />
      <xs:sequence>
        <xs:element name="Filter" type="xs:string" />
      </xs:sequence>
      <xs:choice>
        <xs:element name="Level1" type="xs:string" />
        <xs:element name="Level2" type="xs:string" />
      </xs:choice>
      <xs:all>
        <xs:element name="BatchId" type="xs:string" />
      </xs:all>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`;
    const parsed = parseXsdModel({
      primary: {
        id: 'primary-schema',
        label: 'Main schema',
        text: schemaText,
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const issues = validateXmlAgainstXsdModel(
      parsed.model,
      '<Header><EnvelopeVersion>1.0</EnvelopeVersion><Filter>Level2</Filter><Level2>yes</Level2><BatchId>B-1</BatchId></Header>',
    );

    expect(parsed.model.unsupportedFeatures.map((feature) => feature.title).join('\n')).not.toContain(
      'Unsupported nested XSD particle',
    );
    expect(issues.map((issue) => issue.title).join('\n')).not.toContain('Unsupported nested XSD particle');
    expect(issues).toHaveLength(0);
  });

  it('validates wildcard elements and wildcard attributes', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Envelope">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Header" type="xs:string" />
        <xs:any namespace="##other" processContents="skip" minOccurs="0" maxOccurs="unbounded" />
      </xs:sequence>
      <xs:anyAttribute namespace="##any" processContents="skip" />
    </xs:complexType>
  </xs:element>
</xs:schema>`,
      messageText:
        '<Envelope xmlns:ext="https://example.test/ext" ext:trace="abc"><Header>ok</Header><ext:Audit>kept</ext:Audit></Envelope>',
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('validates complexContent restriction and simpleContent restriction schemas', async () => {
    const complexRestriction = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:complexType name="BaseDocument">
    <xs:sequence>
      <xs:element name="Title" type="xs:string" />
      <xs:element name="Notes" type="xs:string" minOccurs="0" />
    </xs:sequence>
  </xs:complexType>
  <xs:complexType name="RestrictedDocument">
    <xs:complexContent>
      <xs:restriction base="BaseDocument">
        <xs:sequence>
          <xs:element name="Title" type="xs:string" />
        </xs:sequence>
      </xs:restriction>
    </xs:complexContent>
  </xs:complexType>
  <xs:element name="Document" type="RestrictedDocument" />
</xs:schema>`,
      messageText: '<Document><Title>Shipment</Title></Document>',
    });
    const simpleRestriction = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:complexType name="BaseCode">
    <xs:simpleContent>
      <xs:extension base="xs:string">
        <xs:attribute name="scheme" type="xs:string" use="required" />
      </xs:extension>
    </xs:simpleContent>
  </xs:complexType>
  <xs:complexType name="RestrictedCode">
    <xs:simpleContent>
      <xs:restriction base="BaseCode">
        <xs:simpleType>
          <xs:restriction base="xs:string">
            <xs:enumeration value="ABC" />
          </xs:restriction>
        </xs:simpleType>
        <xs:attribute name="scheme" type="xs:string" use="required" />
      </xs:restriction>
    </xs:simpleContent>
  </xs:complexType>
  <xs:element name="Code" type="RestrictedCode" />
</xs:schema>`,
      messageText: '<Code scheme="carrier">ABC</Code>',
    });

    expect(complexRestriction.ok).toBe(true);
    expect(simpleRestriction.ok).toBe(true);
  });

  it('validates substitution groups and keyref identity constraints', async () => {
    const substitution = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:complexType name="PaymentType">
    <xs:sequence>
      <xs:element name="Amount" type="xs:decimal" />
    </xs:sequence>
  </xs:complexType>
  <xs:element name="Payment" type="PaymentType" abstract="true" />
  <xs:element name="CardPayment" type="PaymentType" substitutionGroup="Payment" />
  <xs:element name="Order">
    <xs:complexType>
      <xs:sequence>
        <xs:element ref="Payment" />
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`,
      messageText: '<Order><CardPayment><Amount>10.50</Amount></CardPayment></Order>',
    });
    const keyref = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Order">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Item" maxOccurs="unbounded">
          <xs:complexType>
            <xs:attribute name="id" type="xs:string" use="required" />
          </xs:complexType>
        </xs:element>
        <xs:element name="Line" maxOccurs="unbounded">
          <xs:complexType>
            <xs:attribute name="itemId" type="xs:string" use="required" />
          </xs:complexType>
        </xs:element>
      </xs:sequence>
    </xs:complexType>
    <xs:key name="itemIds">
      <xs:selector xpath="Item" />
      <xs:field xpath="@id" />
    </xs:key>
    <xs:keyref name="lineItemRef" refer="itemIds">
      <xs:selector xpath="Line" />
      <xs:field xpath="@itemId" />
    </xs:keyref>
  </xs:element>
</xs:schema>`,
      messageText: '<Order><Item id="A" /><Line itemId="B" /></Order>',
    });

    expect(substitution.ok).toBe(true);
    expect(keyref.ok).toBe(false);
    expect(keyref.issues.map((issue) => issue.message).join('\n')).toContain('lineItemRef');
  });

  it('fails closed when external schema imports are not supplied', async () => {
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
    expect(result.issues.map((issue) => issue.code)).toContain('xsd-schema-error');
  });

  it('resolves xs:include from user supplied XSD sources', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:include schemaLocation="header-types.xsd" />
  <xs:element name="ShipmentNotification">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Header" type="HeaderType" />
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`,
      relatedSchemas: [
        {
          id: 'header-types',
          label: 'header-types.xsd',
          schemaLocation: 'header-types.xsd',
          text: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:complexType name="HeaderType">
    <xs:sequence>
      <xs:element name="EnvelopeVersion" type="xs:string" />
    </xs:sequence>
  </xs:complexType>
</xs:schema>`,
        },
      ],
      messageText:
        '<ShipmentNotification><Header><EnvelopeVersion>1.0</EnvelopeVersion></Header></ShipmentNotification>',
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('resolves xs:import by namespace and schemaLocation', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:common="https://example.test/common">
  <xs:import namespace="https://example.test/common" schemaLocation="common.xsd" />
  <xs:element name="Envelope" type="common:EnvelopeType" />
</xs:schema>`,
      relatedSchemas: [
        {
          id: 'common',
          label: 'common.xsd',
          schemaLocation: 'common.xsd',
          namespace: 'https://example.test/common',
          text: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="https://example.test/common">
  <xs:complexType name="EnvelopeType">
    <xs:sequence>
      <xs:element name="MessageId" type="xs:string" />
    </xs:sequence>
  </xs:complexType>
</xs:schema>`,
        },
      ],
      messageText: '<Envelope><MessageId>MSG-1</MessageId></Envelope>',
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('fails closed for unresolved includes until the source is added', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:include schemaLocation="missing-types.xsd" />
  <xs:element name="root" type="MissingType" />
</xs:schema>`,
      messageText: '<root />',
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('xsd-schema-error');
    expect(result.issues.map((issue) => issue.message).join('\n')).toContain('missing-types.xsd');
  });

  it('reports namespace mismatches for included schemas', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="https://example.test/main">
  <xs:include schemaLocation="other.xsd" />
  <xs:element name="root" type="xs:string" />
</xs:schema>`,
      relatedSchemas: [
        {
          id: 'other',
          label: 'other.xsd',
          schemaLocation: 'other.xsd',
          namespace: 'https://example.test/other',
          text: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="https://example.test/other">
  <xs:complexType name="OtherType" />
</xs:schema>`,
        },
      ],
      messageText: '<root>ok</root>',
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('xsd-schema-error');
    expect(result.issues.map((issue) => issue.message).join('\n')).toContain('namespace');
  });

  it('validates facets from included simple types', async () => {
    const result = await validateRequest({
      schemaFormat: 'xsd',
      messageFormat: 'xml',
      schemaText: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:include schemaLocation="status-types.xsd" />
  <xs:element name="Status" type="StatusType" />
</xs:schema>`,
      relatedSchemas: [
        {
          id: 'status-types',
          label: 'status-types.xsd',
          schemaLocation: 'status-types.xsd',
          text: `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:simpleType name="StatusType">
    <xs:restriction base="xs:string">
      <xs:enumeration value="ORIGINAL" />
      <xs:enumeration value="UPDATE" />
    </xs:restriction>
  </xs:simpleType>
</xs:schema>`,
        },
      ],
      messageText: '<Status>INVALID</Status>',
    });

    const enumIssue = result.issues.find((issue) => issue.code === 'xsd-enumeration');
    expect(result.ok).toBe(false);
    expect(enumIssue?.messageRange).toBeDefined();
  });
});
