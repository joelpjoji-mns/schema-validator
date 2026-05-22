import { expect, test } from '@playwright/test';

const setEditorText = async (page: import('@playwright/test').Page, paneTitle: string, text: string) => {
  const pane = page.locator('.editor-pane').filter({ has: page.getByRole('heading', { name: paneTitle }) });
  await pane.locator('.monaco-editor').click();
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
