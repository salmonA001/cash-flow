import { expect, test } from '@playwright/test';

test('redirects anonymous visitors to login', async ({ page }) => {
  await page.goto('/orders');
  await expect(page).toHaveURL(/\/login\?next=%2Forders/);
});

test('rejects wrong credentials with a visible error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Invalid email or password')).toBeVisible();
});
