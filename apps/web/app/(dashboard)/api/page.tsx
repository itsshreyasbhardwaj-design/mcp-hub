import type { Metadata } from 'next';
import { Card, CardBody, CardHeader, Note, PageHeader } from '@mcp-hub/ui';
import { apiRouter } from '@mcp-hub/api';
import { requireSession } from '@/lib/session';
import { ApiKeyManager } from '@/components/api/api-key-manager';
import { CodeBlock } from '@/components/code-block';
import { RouteTable } from '@/components/api/route-table';

export const metadata: Metadata = { title: 'API' };
export const dynamic = 'force-dynamic';

export default async function ApiPage() {
  const session = await requireSession();
  const isAdmin = ['owner', 'admin'].includes(session.principal.role);
  const routes = apiRouter.describe();
  const baseUrl = session.app.config.appUrl;

  const keys = isAdmin
    ? await session.app.repositories.apiKeys.list(session.principal.organizationId)
    : [];

  return (
    <>
      <PageHeader
        title="API"
        description="The dashboard, the SDK and MCP Hub's own MCP server all use this API. Nothing in the product has a private path around it."
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <ApiKeyManager
          canManage={isAdmin}
          keys={keys.map((key) => ({
            id: key.id,
            name: key.name,
            prefix: key.prefix,
            scopes: key.scopes,
            lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
            expiresAt: key.expiresAt?.toISOString() ?? null,
            revokedAt: key.revokedAt?.toISOString() ?? null,
            createdAt: key.createdAt.toISOString(),
          }))}
        />

        <div className="space-y-3">
          <Card>
            <CardHeader title="TypeScript SDK" description="@mcp-hub/sdk" />
            <CardBody className="space-y-3">
              <CodeBlock
                language="bash"
                code={`pnpm add @mcp-hub/sdk`}
              />
              <CodeBlock
                language="typescript"
                code={`import { MCPHub } from '@mcp-hub/sdk';

const hub = new MCPHub({
  apiKey: process.env.MCP_HUB_API_KEY!,
  baseUrl: '${baseUrl}',
});

// List every registered server, following pagination.
for await (const server of hub.paginate((cursor) => hub.servers.list({ cursor }))) {
  console.log(server.slug, server.healthStatus);
}

// Inspect a tool before calling it.
const preview = await hub.tools.preview({
  versionId: 'ver_...',
  toolName: 'delete_branch',
});
console.log(preview.decision.effect, preview.decision.reason);

// Execution goes through the permission and approval gates.
const result = await hub.tools.execute({
  versionId: 'ver_...',
  toolName: 'search_notes',
  arguments: { query: 'coffee' },
});`}
              />
              <Note>
                The SDK never retries a tool execution: replaying a destructive call is worse than
                failing one. Reads retry with backoff on transient status codes.
              </Note>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="MCP integration"
              description="Query MCP Hub itself through MCP."
            />
            <CardBody className="space-y-3">
              <CodeBlock
                language="json"
                code={JSON.stringify(
                  {
                    mcpServers: {
                      'mcp-hub': {
                        command: 'npx',
                        args: ['-y', '@mcp-hub/mcp-server'],
                        env: {
                          MCP_HUB_API_KEY: '${MCP_HUB_API_KEY}',
                          MCP_HUB_URL: baseUrl,
                        },
                      },
                    },
                  },
                  null,
                  2,
                )}
              />
              <Note>
                Every tool it exposes is read-only: search_servers, get_server, list_tools,
                get_tool_schema, search_tools, validate_server, get_server_health and
                get_version_changes. There is no execute, register or delete tool, and the server
                is additionally bounded by the scopes of the key you give it.
              </Note>
            </CardBody>
          </Card>
        </div>
      </div>

      <Card className="mt-3">
        <CardHeader
          title="Endpoints"
          description={`${routes.length} routes. Authentication is a Bearer API key or the session cookie; errors share one envelope with a stable code and a request id.`}
        />
        <RouteTable routes={routes} />
      </Card>

      <Card className="mt-3">
        <CardHeader title="Error format" />
        <CardBody className="space-y-3">
          <CodeBlock
            language="json"
            code={`{
  "error": {
    "code": "SERVER_NOT_FOUND",
    "message": "The requested MCP server does not exist.",
    "requestId": "req_9f1c2d3e4a5b6c7d8e9f0a1b"
  }
}`}
          />
          <Note>
            Clients switch on <code className="font-mono">error.code</code>, never on the message.
            Unexpected failures are reported as <code className="font-mono">INTERNAL</code> with the
            stack kept server-side, and the request id appears in the logs for that request.
          </Note>
        </CardBody>
      </Card>
    </>
  );
}
