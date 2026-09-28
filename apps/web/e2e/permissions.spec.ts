import { expect, test } from '@playwright/test';
import { USERS, signIn } from './helpers';

/**
 * Permission boundaries, from the browser.
 *
 * These assert what each role cannot do. The UI hides controls a role cannot
 * use, but the checks that matter are server-side, so the tests also confirm
 * the API refuses the same actions when they are requested directly.
 */
test.describe('role boundaries', () => {
  test('a viewer cannot register a server or use the playground', async ({ page }) => {
    await signIn(page, USERS.viewer);

    await page.goto('/servers/new');
    await page.getByLabel('Name').fill('Viewer attempt');
    await page.getByRole('button', { name: 'Register server' }).click();
    await expect(page.getByText(/requires the developer role/i)).toBeVisible();

    // The same action through the API is refused with 403.
    const response = await page.request.post('/api/v1/servers', {
      data: { name: 'Viewer attempt via API' },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).error.code).toBe('FORBIDDEN');
  });

  test('a viewer sees the playground closed to them', async ({ page }) => {
    await signIn(page, USERS.viewer);
    await page.goto('/servers/local-notes-server?tab=playground');
    await expect(page.getByText('Your role cannot execute tools')).toBeVisible();
  });

  test('a developer cannot manage API keys or permission rules', async ({ page }) => {
    await signIn(page, USERS.developer);

    await page.goto('/api');
    await expect(page.getByText('Only administrators can view or create API keys.')).toBeVisible();

    const key = await page.request.post('/api/v1/api-keys', {
      data: { name: 'escalation', scopes: ['admin'] },
    });
    expect(key.status()).toBe(403);

    const rule = await page.request.post('/api/v1/permissions', {
      data: { effect: 'allow', riskClass: 'DESTRUCTIVE' },
    });
    expect(rule.status()).toBe(403);
  });

  test('an administrator can create a permission rule', async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto('/security');

    await page.getByRole('button', { name: 'New rule' }).click();
    await page.getByLabel('Effect').selectOption('deny');
    await page.getByLabel('Tool').fill('purge_*');
    await page.getByLabel('Description').fill('E2E: never allow purge tools.');
    await page.getByRole('button', { name: 'Add rule' }).click();

    await expect(page.getByText('E2E: never allow purge tools.')).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('unauthenticated access', () => {
  test('redirects to sign-in and refuses the API', async ({ page, context }) => {
    await context.clearCookies();

    await page.goto('/servers');
    await page.waitForURL(/\/sign-in/, { timeout: 20_000 });

    const response = await page.request.get('/api/v1/servers');
    expect(response.status()).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
  });

  test('serves the health probe without authentication', async ({ page, context }) => {
    await context.clearCookies();
    const response = await page.request.get('/api/v1/health');
    expect(response.ok()).toBe(true);
    expect((await response.json()).status).toBe('ok');
  });
});

test.describe('SSRF protection from the UI', () => {
  test('refuses to discover a loopback endpoint', async ({ page }) => {
    await signIn(page, USERS.developer);

    const slug = `e2e-loopback-${Date.now().toString(36)}`;
    const created = await page.request.post('/api/v1/servers', {
      data: {
        name: 'Loopback probe',
        slug,
        version: {
          version: '1.0.0',
          transport: { kind: 'streamable-http', url: 'http://127.0.0.1:9/mcp', headerKeys: [] },
        },
      },
    });
    expect(created.status()).toBe(201);

    await page.goto(`/servers/${slug}`);
    await page.getByRole('button', { name: 'Discover' }).click();
    await expect(page.getByText(/private or loopback address/i)).toBeVisible({ timeout: 30_000 });
  });
});
