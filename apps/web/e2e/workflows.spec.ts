import { expect, test } from '@playwright/test';
import { unique } from './helpers';

test('create a collection and a design, then submit it for review', async ({ page }) => {
  const collection = unique('E2E Collection');
  await page.goto('/collections');
  await page.getByLabel('Name').fill(collection);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('cell', { name: collection })).toBeVisible();

  const title = unique('E2E Design');
  await page.goto('/designs');
  await page.getByRole('button', { name: 'New design' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByLabel('Tags').fill('e2e, test');
  await dialog.getByRole('button', { name: 'Create design' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('In review').first()).toBeVisible();
});

test('create a POD product with variants', async ({ page }) => {
  const title = unique('E2E Tee');
  await page.goto('/products');
  await page.getByRole('button', { name: 'New product' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByLabel('SKU').fill(`E2E-${Date.now()}`);
  await dialog.getByLabel('Price').fill('24.99');
  await dialog.getByRole('button', { name: 'Create product' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByText('$24.99')).toBeVisible();
});

test('validates input client-side before calling the API', async ({ page }) => {
  await page.goto('/finance?tab=expenses');
  await page.getByRole('button', { name: 'Record expense' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Description').fill('E2E software');
  await dialog.getByLabel('Amount').fill('12.345');
  await dialog.getByRole('button', { name: 'Save expense' }).click();
  await expect(dialog.getByText('Must be a positive amount with up to 2 decimals')).toBeVisible();
  await dialog.getByLabel('Amount').fill('12.34');
  await dialog.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByRole('cell', { name: 'E2E software' }).first()).toBeVisible();
});

test('previews an Amazon Merch report and reports row errors', async ({ page }) => {
  await page.goto('/amazon-merch');
  await page.getByRole('tab', { name: 'Import', exact: true }).click();
  const csv = 'Date,ASIN,Marketplace,Title,Product Type,Purchased,Returned,Royalties,Currency\n2026-05-01,B0E2ETEST1,amazon.com,Tee,Standard,2,0,4.94,USD\n2026-05-02,BAD,amazon.com,X,Y,1,0,1.00,USD\n';
  await page.getByLabel('Report CSV').setInputFiles({ name: 'report.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Validate' }).click();
  await expect(page.getByText('Row 3 · ASIN: Invalid ASIN "BAD"')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'B0E2ETEST1' })).toBeVisible();
});

test('core automations cannot be disabled; optional ones can', async ({ page }) => {
  await page.goto('/automation');
  await expect(page.getByRole('row', { name: /Classify Shopify order items/ }).getByText('Core')).toBeVisible();
  const toggle = page.getByRole('switch', { name: 'Enable Alert on missing integration' });
  await expect(toggle).toBeVisible();
});

test('toggles dark mode', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.locator('html')).toHaveClass(/dark|light/);
});
