# TypeScript SDK

```bash
pnpm add @mcp-hub/sdk
```

```ts
import { MCPHub } from '@mcp-hub/sdk';

const hub = new MCPHub({
  apiKey: process.env.MCP_HUB_API_KEY!,
  baseUrl: 'https://hub.example.com',
});
```

| Option | Default | Notes |
| --- | --- | --- |
| `apiKey` | required | Created under Settings → API |
| `baseUrl` | `http://localhost:3000` | |
| `organizationId` | — | When a key spans several organizations |
| `timeoutMs` | `30000` | Per request |
| `maxRetries` | `2` | Reads only; see below |
| `fetch` | global | Inject your own for tests or proxying |

## Retries

Deliberately asymmetric:

- `GET` requests retry on `429`, `502`, `503` and `504` with exponential backoff.
- **Tool execution never retries.** Replaying a destructive call is worse than
  failing one. `approvals.request`, `approvals.decide`, `testing.run`,
  `health.check` and `apiKeys.create` are also non-idempotent and never retried.

## Resources

### `servers`

```ts
await hub.servers.list({ status: ['active'], limit: 50 });
await hub.servers.get('github');
await hub.servers.create({ name: 'GitHub', version: { version: '1.0.0', transport } });
await hub.servers.update('github', { status: 'active' });
await hub.servers.delete('github');
await hub.servers.listTools('github');
await hub.servers.listVersions('github');
await hub.servers.createVersion('github', { version: '1.1.0', transport });
await hub.servers.generateConfig('github', { versionId, format: 'claude-desktop' });
```

### `versions`

```ts
await hub.versions.discover(versionId);
await hub.versions.publish(versionId);
await hub.versions.update(versionId, { deprecated: true });
await hub.versions.compare(fromVersionId, toVersionId);
```

### `tools`

```ts
await hub.tools.list({ q: 'create_issue', risk: ['WRITE'] });
await hub.tools.preview({ versionId, toolName: 'delete_branch' });
await hub.tools.execute({ versionId, toolName: 'search_code', arguments: { query: 'TODO' } });
await hub.tools.overrideRisk(toolId, { riskClass: 'READ', reason: 'Audited; read-only.' });
```

### `validation`, `testing`, `health`

```ts
await hub.validation.run('github');
await hub.validation.rules();
await hub.testing.run('github', { versionId, suites: ['connection', 'schemas'] });
await hub.health.check('github');
await hub.health.history('github', '7d');
await hub.health.incidents(['investigating']);
await hub.health.status();
```

### `approvals`, `permissions`

```ts
const approval = await hub.approvals.request({ versionId, toolName: 'delete_branch', arguments: { branch: 'tmp' } });
await hub.approvals.decide(approval.id, 'approved', 'Reviewed.');
await hub.permissions.create({ effect: 'deny', toolName: 'drop_*', description: 'Never.' });
```

### `analytics`, `search`, `apiKeys`, `assistant`

```ts
await hub.analytics.overview('7d');
await hub.analytics.activity({ action: 'tool.invoked' });
await hub.search.query('postgres', { type: ['server'] });
const { plaintext } = await hub.apiKeys.create({ name: 'CI', scopes: ['servers:read'] });
await hub.assistant.ask('Why is the github server failing?');
```

## Pagination

```ts
for await (const server of hub.paginate((cursor) => hub.servers.list({ cursor }))) {
  console.log(server.slug, server.healthStatus);
}
```

## Errors

Every failure is an `McpHubError` or a narrower subclass, so `catch` can be
specific:

```ts
import { ApprovalRequiredError, PermissionError, RateLimitError } from '@mcp-hub/sdk';

try {
  await hub.tools.execute({ versionId, toolName: 'delete_branch', arguments: { branch: 'tmp' } });
} catch (error) {
  if (error instanceof PermissionError && error.code === 'APPROVAL_REQUIRED') {
    const approval = await hub.approvals.request({ versionId, toolName: 'delete_branch', arguments: { branch: 'tmp' } });
    console.log(`Waiting on approval ${approval.id}`);
  } else if (error instanceof RateLimitError) {
    console.log(`Retry after ${error.resetAt?.toISOString()}`);
  } else {
    throw error;
  }
}
```

Classes: `McpHubError` · `AuthenticationError` · `PermissionError` ·
`NotFoundError` · `ValidationError` (with `.issues`) · `RateLimitError`
(with `.resetAt`). Every one carries `.code`, `.status` and `.requestId`.

## A worked example: safe execution

```ts
async function runSafely(versionId: string, toolName: string, args: unknown) {
  const preview = await hub.tools.preview({ versionId, toolName });

  if (preview.decision.effect === 'deny') {
    throw new Error(`Refused: ${preview.decision.reason}`);
  }

  if (preview.decision.effect === 'require_approval') {
    const approval = await hub.approvals.request({ versionId, toolName, arguments: args });
    throw new Error(`Approval ${approval.id} is required before this can run.`);
  }

  return hub.tools.execute({
    versionId,
    toolName,
    arguments: args,
    // Required for DESTRUCTIVE, CREDENTIAL, ADMIN and UNKNOWN tools.
    acknowledgeRisk: preview.requiresAcknowledgement,
  });
}
```
