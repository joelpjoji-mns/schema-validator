import { expect, test } from '@playwright/test';

test('validates the default failing JSON Schema fixture and selects diagnostics', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Schema Validator Workbench' })).toBeVisible();
  await expect(page.getByText(/validation failed/i)).toBeVisible();
  await expect(page.getByText(/Missing required field: quantity/i)).toBeVisible();

  await page.getByRole('button', { name: /Missing required field: quantity/i }).click();
  await expect(page.locator('.issue-item.is-active')).toContainText('Missing required field: quantity');
});

test('loads a passing fixture on mobile sized viewports', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/fixture/i).selectOption('json-schema-valid');

  await expect(page.getByRole('heading', { name: /validation passed/i })).toBeVisible();
  await expect(page.getByText(/No diagnostics/i)).toBeVisible();
});
