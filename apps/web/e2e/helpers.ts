import { expect, type Page } from '@playwright/test';

export const USERS = {
  owner: 'owner@example.com',
  admin: 'admin@example.com',
  developer: 'dev@example.com',
  viewer: 'viewer@example.com',
} as const;

/**
 * Signs in through the development provider and lands on the overview.
 *
 * Cookies are cleared first so the helper also works as "switch user": with a
 * live session, /sign-in redirects straight to the dashboard.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('/', { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/sign-in/, { timeout: 30_000 });
}

/** Screenshots used in the README; written on every successful run. */
export async function capture(page: Page, name: string): Promise<void> {
  if (!process.env['E2E_SCREENSHOTS']) return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: `../../docs/screenshots/${name}.png`, fullPage: false });
}
