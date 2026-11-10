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

test('opens the liquid playground without a session', async ({ page }) => {
  await page.goto('/playground');
  await expect(page.getByRole('heading', { name: 'Liquid playground' })).toBeVisible();
  await expect(page.getByLabel('3D liquid tank')).toBeVisible();
  await expect(page.getByText('3,000 of 5,000 particles')).toBeVisible();
  await page.getByRole('button', { name: 'Hold to pour' }).dispatchEvent('pointerdown');
  await expect(page.getByText('3,000 of 5,000 particles')).toBeHidden();
});
