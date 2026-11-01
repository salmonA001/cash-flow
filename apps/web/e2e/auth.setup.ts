import { expect, test as setup } from '@playwright/test';
import { EMAIL, PASSWORD } from './helpers';

setup('sign in once', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.context().storageState({ path: 'e2e/.auth/owner.json' });
});
