import { expect, test } from '@playwright/test';

const PAGES: [string, string][] = [
  ['/dashboard', 'Overview'],
  ['/designs', 'Design Studio'],
  ['/collections', 'Collections'],
  ['/products', 'Products'],
  ['/listings', 'Listings'],
  ['/orders', 'Orders'],
  ['/fulfillment', 'POD Fulfillment'],
  ['/digital', 'Digital Delivery'],
  ['/customers', 'Customers'],
  ['/amazon-merch', 'Amazon Merch on Demand'],
  ['/finance', 'Finance'],
  ['/analytics', 'Analytics'],
  ['/automation', 'Automation'],
  ['/settings', 'Settings'],
];

test('every section renders without errors or horizontal overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const [path, heading] of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});
