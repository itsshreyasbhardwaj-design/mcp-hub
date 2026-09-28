import { expect, test } from '@playwright/test';
import { USERS, capture, signIn } from './helpers';

/**
 * Every section renders, has a unique page heading, and is reachable from the
 * sidebar. This is the cheapest test that catches a whole page failing to
 * render server-side.
 */
const SECTIONS: Array<{ href: string; heading: string }> = [
  { href: '/', heading: 'Overview' },
  { href: '/servers', heading: 'Servers' },
  { href: '/discover', heading: 'Discover' },
  { href: '/tools', heading: 'Tool explorer' },
  { href: '/testing', heading: 'Testing' },
  { href: '/monitoring', heading: 'Monitoring' },
  { href: '/versions', heading: 'Versions' },
  { href: '/security', heading: 'Security' },
  { href: '/analytics', heading: 'Analytics' },
  { href: '/activity', heading: 'Activity' },
  { href: '/team', heading: 'Team' },
  { href: '/settings', heading: 'Settings' },
  { href: '/api', heading: 'API' },
];

test('every section renders', async ({ page }) => {
  await signIn(page, USERS.owner);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  for (const section of SECTIONS) {
    await page.goto(section.href);
    await expect(page.getByRole('heading', { name: section.heading, level: 1 })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('the overview renders charts from recorded events', async ({ page }) => {
  await signIn(page, USERS.owner);
  await expect(page.getByText('Registered servers')).toBeVisible();
  await expect(page.getByText('Requests over time')).toBeVisible();
  await capture(page, 'overview');
});

test('search finds a seeded server', async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto('/discover');

  await page.getByLabel('Search the registry').fill('warehouse');
  await expect(page.getByText('DEMO Warehouse').first()).toBeVisible({ timeout: 20_000 });
  await capture(page, 'discover');
});

test('the tool explorer lists tools across servers', async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto('/tools');

  await expect(page.getByRole('heading', { name: 'Tool explorer' })).toBeVisible();
  await expect(page.getByText('drop_table').first()).toBeVisible();
  await expect(page.getByText('DESTRUCTIVE').first()).toBeVisible();
  await capture(page, 'tool-explorer');
});

test('demo data is labelled everywhere it appears', async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto('/servers');
  await expect(page.getByText('Demo data').first()).toBeVisible();

  await page.goto('/servers/demo-warehouse?tab=playground');
  await expect(page.getByText('Demo servers cannot be executed')).toBeVisible();
});

test('keyboard navigation reaches the main content', async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
});
