import { expect, test } from '@playwright/test';
import { USERS, capture, signIn } from './helpers';

/**
 * The full demo flow, driven through the browser.
 *
 * Sign in → register → discover a real MCP server → inspect a schema → run
 * compatibility tests → validate → execute a tool → publish → compare
 * versions → read the audit log. Nothing in this path is stubbed: the server
 * being discovered is the example MCP server in examples/notes-server, and it
 * is spoken to over real stdio JSON-RPC.
 */
test.describe.configure({ mode: 'serial' });

const SLUG = `e2e-notes-${Date.now().toString(36)}`;
const NOTES_ENTRY = '../../examples/notes-server/dist/index.js';

test('registers an MCP server', async ({ page }) => {
  await signIn(page, USERS.developer);

  await page.goto('/servers/new');
  await expect(page.getByRole('heading', { name: 'Register an MCP server' })).toBeVisible();

  await page.getByLabel('Name').fill('E2E Notes Server');
  await page.getByLabel('Slug').fill(SLUG);
  await page
    .getByLabel('Description')
    .fill('Registered by the end-to-end suite against the real example server.');
  await page.getByLabel('Transport').selectOption('stdio');
  await page.getByLabel('Command').fill('node');
  await page.getByLabel('Arguments').fill(NOTES_ENTRY);
  await capture(page, 'register-server');

  await page.getByRole('button', { name: 'Register server' }).click();
  await page.waitForURL(`**/servers/${SLUG}`, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: /E2E Notes Server/ })).toBeVisible();
});

test('discovers the real capability surface', async ({ page }) => {
  await signIn(page, USERS.developer);
  await page.goto(`/servers/${SLUG}`);

  await page.getByRole('button', { name: 'Discover' }).click();
  await expect(page.getByText(/Discovered 5 tool\(s\)/)).toBeVisible({ timeout: 45_000 });

  // The reported identity comes from the live server's initialize result.
  await expect(page.getByText('example-notes-server')).toBeVisible();
  await capture(page, 'server-detail');
});

test('classifies tools and shows the schema', async ({ page }) => {
  await signIn(page, USERS.developer);
  await page.goto(`/servers/${SLUG}?tab=tools`);

  await expect(page.getByText('list_notes', { exact: true })).toBeVisible();
  await expect(page.getByText('delete_note', { exact: true })).toBeVisible();

  // delete_note must be DESTRUCTIVE, not merely WRITE.
  const destructive = page.locator('li', { hasText: 'delete_note' }).first();
  await expect(destructive.getByText('DESTRUCTIVE')).toBeVisible();

  await page
    .getByRole('button', { name: /search_notes/ })
    .first()
    .click();
  await expect(page.getByText('Input schema')).toBeVisible();
  await expect(page.getByText('query', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('required').first()).toBeVisible();
  await capture(page, 'tools');
});

test('runs compatibility tests against the live server', async ({ page }) => {
  await signIn(page, USERS.developer);
  await page.goto(`/servers/${SLUG}`);

  await page.getByRole('button', { name: 'Run tests' }).click();
  await expect(page.getByText(/\d+ passed/)).toBeVisible({ timeout: 90_000 });

  await page.goto('/testing');
  await expect(page.getByRole('heading', { name: 'Testing' })).toBeVisible();
  await page.getByRole('link', { name: SLUG }).first().click();
  await expect(page.getByText('Completes the initialize handshake')).toBeVisible();
  await capture(page, 'testing');
});

test('validates the server and reports findings by rule', async ({ page }) => {
  await signIn(page, USERS.developer);
  await page.goto(`/servers/${SLUG}`);

  await page.getByRole('button', { name: 'Validate' }).click();
  await expect(page.getByText(/Validation (pass|warning|error)/)).toBeVisible({ timeout: 30_000 });
});

test('executes a READ tool through the playground', async ({ page }) => {
  await signIn(page, USERS.developer);
  await page.goto(`/servers/${SLUG}?tab=playground`);

  await page.getByLabel('Tool').selectOption('search_notes');
  await expect(page.getByText('This call is allowed')).toBeVisible({ timeout: 20_000 });

  await page.getByLabel('Arguments').fill('{"query": "coffee"}');
  await page.getByRole('button', { name: 'Run tool' }).click();

  await expect(page.getByText('success')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Structured output')).toBeVisible();
  await capture(page, 'playground');
});

test('refuses a DESTRUCTIVE tool without acknowledgement or approval', async ({ page }) => {
  await signIn(page, USERS.developer);
  await page.goto(`/servers/${SLUG}?tab=playground`);

  await page.getByLabel('Tool').selectOption('delete_note');
  await expect(page.getByText('This call requires approval')).toBeVisible({ timeout: 20_000 });

  // The run button stays disabled until the risk is acknowledged.
  await expect(page.getByRole('button', { name: 'Run tool' })).toBeDisabled();

  await page.getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: 'Run tool' })).toBeEnabled();

  // Acknowledged, but still not approved: the server refuses.
  await page.getByRole('button', { name: 'Run tool' }).click();
  await expect(page.getByText(/APPROVAL_REQUIRED/)).toBeVisible({ timeout: 30_000 });
});

test('an administrator approves the exact payload and it then runs', async ({ page }) => {
  await signIn(page, USERS.developer);
  await page.goto(`/servers/${SLUG}?tab=playground`);
  await page.getByLabel('Tool').selectOption('delete_note');
  await expect(page.getByText('This call requires approval')).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Arguments').fill('{"id": "note-2"}');
  await page.getByRole('button', { name: 'Request approval' }).click();
  await expect(page.getByText(/An administrator must approve/)).toBeVisible({ timeout: 20_000 });

  // The requester cannot approve their own request.
  await page.goto('/security');
  await expect(
    page.getByText('You requested this, so someone else has to decide it.'),
  ).toBeVisible();

  await signIn(page, USERS.admin);
  await page.goto('/security');
  await expect(page.getByRole('heading', { name: 'Security', level: 1 })).toBeVisible();
  await capture(page, 'security');
  await page.getByRole('button', { name: 'Approve' }).first().click();
  await expect(page.getByText('approved').first()).toBeVisible({ timeout: 20_000 });

  await signIn(page, USERS.developer);
  await page.goto(`/servers/${SLUG}?tab=playground`);
  await page.getByLabel('Tool').selectOption('delete_note');
  await page.getByLabel('Arguments').fill('{"id": "note-2"}');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Run tool' }).click();
  await expect(page.getByText('success')).toBeVisible({ timeout: 45_000 });

  // The approval is single-use: the identical call is refused again.
  await page.getByRole('button', { name: 'Run tool' }).click();
  await expect(page.getByText(/APPROVAL_REQUIRED/)).toBeVisible({ timeout: 30_000 });
});

test('publishes a version and freezes its surface', async ({ page }) => {
  await signIn(page, USERS.developer);
  await page.goto(`/servers/${SLUG}?tab=versions`);

  await page.getByRole('button', { name: 'Publish' }).first().click();
  await expect(page.getByText('published').first()).toBeVisible({ timeout: 20_000 });

  // Discovery is refused once a version is published.
  await page.goto(`/servers/${SLUG}`);
  await expect(page.getByRole('button', { name: 'Discover' })).toBeDisabled();
});

test('records the whole flow in the audit log', async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto('/activity');
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();

  for (const action of [
    'server.registered',
    'capabilities.discovered',
    'tool.invoked',
    'approval.decided',
    'version.published',
  ]) {
    await expect(page.getByText(action, { exact: true }).first()).toBeVisible();
  }
  await capture(page, 'activity');
});
