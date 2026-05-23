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
  await expect(page.getByRole('tree').getByText(/xs:string/).first()).toBeVisible();
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
  await page.getByRole('button', { name: /add xsd/i }).click();
  await page.getByLabel('schemaLocation').fill('header-types.xsd');
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
});
