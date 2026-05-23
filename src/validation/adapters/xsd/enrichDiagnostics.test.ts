import { describe, expect, it } from 'vitest';
import { makeIssue, rangeFromLineColumn, wholeDocumentRange } from '../../textRanges';
import type { ValidationRequest } from '../../types';
import { enrichXmllintIssues } from './enrichDiagnostics';
import { parseXsdModel } from './parseXsdModel';

const sequenceSchema = `
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
</xs:schema>`;

const outOfOrderXml = `<ShipmentNotification>
  <Header>
    <CreatedTimestamp>2026-05-23T18:30:00Z</CreatedTimestamp>
  </Header>
</ShipmentNotification>`;

const request: ValidationRequest = {
  schemaFormat: 'xsd',
  messageFormat: 'xml',
  schemaText: sequenceSchema,
  messageText: outOfOrderXml,
};

const parsedModel = parseXsdModel(sequenceSchema);
if (!parsedModel.ok) {
  throw new Error('Expected test XSD to parse.');
}

describe('enrichXmllintIssues', () => {
  it('explains a required element missing before the unexpected sequence element', () => {
    const [issue] = enrichXmllintIssues({
      request,
      model: parsedModel.model,
      issues: [
        {
          rawMessage: "Element 'CreatedTimestamp': This element is not expected. Expected is ( MessageId ).",
          issue: makeIssue({
            code: 'unexpected-xml-element',
            title: 'Unexpected XML element',
            message: 'This element is not expected. Expected is ( MessageId ).',
            expected: 'MessageId',
            schemaRange: wholeDocumentRange(sequenceSchema),
            messageRange: rangeFromLineColumn(outOfOrderXml, 3, 1),
            schemaSourceLabel: 'Main schema',
          }),
        },
      ],
    });

    expect(issue.code).toBe('missing-xml-element');
    expect(issue.title).toBe('MessageId is missing before CreatedTimestamp');
    expect(issue.message).toBe('<MessageId> is required before <CreatedTimestamp> under /ShipmentNotification/Header.');
    expect(issue.path).toBe('/ShipmentNotification/Header/MessageId');
    expect(issue.expected).toBe('<MessageId> before <CreatedTimestamp>');
    expect(issue.actual).toBe('<CreatedTimestamp>');
    expect(issue.hint).toMatch(/Add <MessageId>/);
  });

  it('keeps a true unexpected element as unexpected while listing allowed children', () => {
    const badXml = `<ShipmentNotification><Header><Extra /></Header></ShipmentNotification>`;
    const [issue] = enrichXmllintIssues({
      request: { ...request, messageText: badXml },
      model: parsedModel.model,
      issues: [
        {
          rawMessage: "Element 'Extra': This element is not expected. Expected is ( MessageId ).",
          issue: makeIssue({
            code: 'unexpected-xml-element',
            title: 'Unexpected XML element',
            message: 'This element is not expected. Expected is ( MessageId ).',
            expected: 'MessageId',
            schemaRange: wholeDocumentRange(sequenceSchema),
            messageRange: rangeFromLineColumn(badXml, 1, 33),
            schemaSourceLabel: 'Main schema',
          }),
        },
      ],
    });

    expect(issue.code).toBe('unexpected-xml-element');
    expect(issue.title).toBe('Unexpected XML element: Extra');
    expect(issue.expected).toContain('<MessageId>');
    expect(issue.actual).toBe('<Extra>');
    expect(issue.hint).toMatch(/Remove <Extra>/);
  });

  it('formats enumeration values as expected and actual diagnostic context', () => {
    const [issue] = enrichXmllintIssues({
      request,
      model: parsedModel.model,
      issues: [
        {
          rawMessage:
            "Element 'Status': [facet 'enumeration'] The value 'BROKEN' is not an element of the set {'ORIGINAL', 'UPDATE', 'CANCELLED'}.",
          issue: makeIssue({
            code: 'xsd-enumeration',
            title: 'Value is not allowed by the XSD enumeration',
            message: "The value 'BROKEN' is not an element of the set {'ORIGINAL', 'UPDATE', 'CANCELLED'}.",
            actual: 'BROKEN',
            schemaRange: wholeDocumentRange(sequenceSchema),
            messageRange: rangeFromLineColumn(outOfOrderXml, 3, 1),
            schemaSourceLabel: 'Main schema',
          }),
        },
      ],
    });

    expect(issue.expected).toBe('ORIGINAL, UPDATE, CANCELLED');
    expect(issue.actual).toBe('BROKEN');
    expect(issue.message).toContain('ORIGINAL, UPDATE, or CANCELLED');
  });
});
