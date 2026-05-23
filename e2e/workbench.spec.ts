import { expect, test } from '@playwright/test';

const setEditorText = async (page: import('@playwright/test').Page, paneTitle: string, text: string) => {
  const pane = page.locator('.editor-pane').filter({ has: page.getByRole('heading', { name: paneTitle }) });
  await pane.locator('.monaco-editor').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(text);
};

const setSourceEditorText = async (page: import('@playwright/test').Page, text: string) => {
  await page.locator('.source-editor-frame .monaco-editor').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(text);
};

test('starts empty, detects XSD, and shows the schema summary tree', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Schema Validator Workbench' })).toBeVisible();
  await expect(page.getByText(/Run validation to see diagnostics/i)).toBeVisible();
  await expect(page.getByLabel(/fixture/i)).toHaveCount(0);

  await setEditorText(
    page,
    'Schema',
    `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="ShipmentNotification">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Header" type="xs:string" />
        <xs:element name="Payload" type="xs:string" minOccurs="0" />
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`,
  );

  await expect(page.getByText(/Detected: XSD/i)).toBeVisible();
  await page.getByRole('tab', { name: /summary/i }).click();
  await expect(page.getByRole('tree')).toContainText('ShipmentNotification');
  await expect(page.getByRole('tree')).toContainText('Header');
  await expect(page.getByLabel('Required')).toBeChecked();
  await expect(page.getByLabel('Optional')).toBeChecked();
  await expect(page.getByLabel('Types')).not.toBeChecked();
  await expect(page.getByLabel('Order')).not.toBeChecked();
  await expect(page.getByRole('tree').getByText(/xs:string/)).toHaveCount(0);
  await page.getByLabel('Types').check();
  await expect(
    page
      .getByRole('tree')
      .getByText(/xs:string/)
      .first(),
  ).toBeVisible();
});

test('reruns validation after the message changes', async ({ page }) => {
  await page.goto('/');
  await setEditorText(
    page,
    'Schema',
    JSON.stringify({
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
      additionalProperties: false,
    }),
  );
  await setEditorText(page, 'Message', '{"name":"Joel"}');

  await expect(page.getByRole('heading', { name: /validation passed/i })).toBeVisible();

  await setEditorText(page, 'Message', '{}');

  await expect(page.getByText(/Missing required field: name/i)).toBeVisible();
});

test('shows recursive XSD summary references without expansion warnings', async ({ page }) => {
  await page.goto('/');
  await setEditorText(
    page,
    'Schema',
    `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Shipment" type="ShipmentType" />
  <xs:complexType name="ShipmentType">
    <xs:sequence>
      <xs:element name="ShipmentID" type="xs:string" />
      <xs:element name="ChildShipment" type="ShipmentType" minOccurs="0" />
    </xs:sequence>
  </xs:complexType>
</xs:schema>`,
  );

  await expect(page.getByText(/Detected: XSD/i)).toBeVisible();
  await page.getByRole('tab', { name: /summary/i }).click();
  await expect(page.getByRole('button', { name: /field ShipmentID/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /field ChildShipment/i })).toBeVisible();
  await expect(page.getByText('recursive ref')).toBeVisible();

  await page.getByRole('checkbox', { name: 'Warnings' }).click();
  await expect(page.getByText('Recursive reference to ShipmentType.')).toBeVisible();
  await expect(page.getByText(/Recursive XSD type ShipmentType was not expanded again/i)).toHaveCount(0);
});

test('resolves an XSD include from the Sources tab', async ({ page }) => {
  await page.goto('/');
  await setEditorText(
    page,
    'Schema',
    `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:include schemaLocation="header-types.xsd" />
  <xs:element name="ShipmentNotification">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Header" type="HeaderType" />
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`,
  );
  await setEditorText(
    page,
    'Message',
    '<ShipmentNotification><Header><EnvelopeVersion>1.0</EnvelopeVersion><Filter>Level2</Filter></Header></ShipmentNotification>',
  );

  await expect(page.getByText(/XSD schema error/i).first()).toBeVisible();

  await page.getByRole('tab', { name: /sources/i }).click();
  await page.getByRole('button', { name: /add missing include source header-types\.xsd/i }).click();
  await expect(page.getByLabel('schemaLocation')).toHaveValue('header-types.xsd');
  await setSourceEditorText(
    page,
    `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:complexType name="HeaderType">
    <xs:sequence>
      <xs:element name="EnvelopeVersion" type="xs:string" />
      <xs:sequence>
        <xs:element name="Filter" type="xs:string" />
      </xs:sequence>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`,
  );

  await expect(page.getByRole('heading', { name: /validation passed/i })).toBeVisible();
  await expect(page.getByText(/Unsupported nested XSD particle/i)).toHaveCount(0);
  await expect(page.locator('.source-status.is-resolved', { hasText: 'Resolved' })).toBeVisible();

  await page.getByRole('tab', { name: /summary/i }).click();
  await expect(page.getByRole('button', { name: /field Header/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /field EnvelopeVersion/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /field Filter/i })).toBeVisible();
});

test('prefills a missing XSD import from the detected namespace', async ({ page }) => {
  await page.goto('/');
  await setEditorText(
    page,
    'Schema',
    `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:common="https://example.test/common">
  <xs:import namespace="https://example.test/common" />
  <xs:element name="Envelope" type="common:EnvelopeType" />
</xs:schema>`,
  );

  await expect(page.getByText(/Detected: XSD/i)).toBeVisible();
  await page.getByRole('tab', { name: /sources/i }).click();
  await page.getByRole('button', { name: /add missing import source https:\/\/example\.test\/common/i }).click();

  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('example-test-common.xsd');
  await expect(page.getByLabel('schemaLocation')).toHaveValue('');
  await expect(page.getByLabel('Namespace', { exact: true })).toHaveValue('https://example.test/common');
});

test('uses command palette, preview, insights, and diagnostic filters', async ({ page }) => {
  await page.goto('/');
  await setEditorText(
    page,
    'Schema',
    JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' }, email: { type: 'string' } },
      additionalProperties: false,
    }),
  );
  await setEditorText(page, 'Message', '{"email":"joel@example.test"}');

  await expect(page.getByText(/Missing required field: name/i)).toBeVisible();
  await page.getByLabel('Search diagnostics').fill('required');
  await page.getByLabel('Diagnostic filters').getByLabel('Group').selectOption('code');
  await expect(page.getByText(/missing-required-field/i).first()).toBeVisible();

  await page.getByRole('tab', { name: /preview/i }).click();
  await expect(page.getByText(/JSON structure/i)).toBeVisible();

  await page.getByRole('tab', { name: /insights/i }).click();
  await expect(page.getByText('Metrics')).toBeVisible();
  await expect(page.getByText(/Message Coverage/i)).toBeVisible();

  await page.keyboard.press('ControlOrMeta+K');
  await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /toggle theme/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
