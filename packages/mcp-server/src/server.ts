import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCPHub, McpHubError } from '@mcp-hub/sdk';
import { z } from 'zod';

export interface HubMcpServerOptions {
  apiKey: string;
  baseUrl?: string;
  organizationId?: string;
}

/**
 * MCP Hub, exposed over MCP.
 *
 * Every tool here is read-only. An agent can discover what is registered,
 * inspect schemas, read health and diff versions — but it cannot register,
 * publish, change a permission or execute anything. Those actions go through
 * the authenticated UI or the REST API where a human is accountable for them.
 *
 * The server authenticates with a normal MCP Hub API key, so it is bounded by
 * that key's scopes and organization as well: an agent can never see more
 * than the credential it was given.
 */
export function createHubMcpServer(options: HubMcpServerOptions): McpServer {
  const hub = new MCPHub({
    apiKey: options.apiKey,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.organizationId ? { organizationId: options.organizationId } : {}),
    userAgent: '@mcp-hub/mcp-server/0.1.0',
  });

  const server = new McpServer(
    { name: 'mcp-hub', version: '0.1.0', title: 'MCP Hub' },
    {
      capabilities: { tools: {} },
      instructions: [
        'MCP Hub is a control plane for MCP servers.',
        'Every tool exposed here is read-only: you can search the registry, inspect',
        'tool schemas, read health and compare versions, but you cannot register,',
        'publish, execute or change permissions through this server.',
        'Risk classifications are heuristics recorded by MCP Hub, not guarantees.',
      ].join(' '),
    },
  );

  const asText = (
    value: Record<string, unknown>,
  ): {
    content: Array<{ type: 'text'; text: string }>;
    structuredContent: Record<string, unknown>;
  } => ({
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  });

  const failure = (
    err: unknown,
  ): { content: Array<{ type: 'text'; text: string }>; isError: true } => ({
    content: [
      {
        type: 'text',
        text:
          err instanceof McpHubError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'The request failed.',
      },
    ],
    isError: true,
  });

  server.registerTool(
    'search_servers',
    {
      title: 'Search MCP servers',
      description:
        'Searches the registry for MCP servers by name, description, tags or documentation text.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe('Free-text search, e.g. "postgres" or "browser automation"'),
        limit: z.number().int().min(1).max(50).default(10).describe('Maximum results'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      try {
        const results = await hub.search.query(query, { type: ['server'], limit });
        return asText({
          total: results.total ?? results.data.length,
          results: results.data.map((hit) => ({
            serverId: hit.serverId,
            title: hit.title,
            snippet: hit.snippet,
            tags: hit.tags,
            matchKind: hit.matchKind,
          })),
        });
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'get_server',
    {
      title: 'Get an MCP server',
      description:
        'Returns a registered server with its recommended version, tools, resources and prompts.',
      inputSchema: { server: z.string().min(1).describe('Server id or slug') },
      annotations: { readOnlyHint: true },
    },
    async ({ server: ref }) => {
      try {
        const detail = await hub.servers.get(ref);
        return asText({
          server: {
            id: detail.server.id,
            slug: detail.server.slug,
            name: detail.server.name,
            description: detail.server.description,
            status: detail.server.status,
            healthStatus: detail.server.healthStatus,
            tags: detail.server.tags,
            repositoryUrl: detail.server.repositoryUrl,
            isDemo: detail.server.isDemo,
          },
          version: detail.latestVersion
            ? {
                id: detail.latestVersion.id,
                version: detail.latestVersion.version,
                published: detail.latestVersion.published,
                protocolVersion: detail.latestVersion.protocolVersion,
              }
            : null,
          toolCount: detail.tools.length,
          resourceCount: detail.resources.length,
          promptCount: detail.prompts.length,
        });
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'list_tools',
    {
      title: 'List the tools of a server',
      description: 'Returns every tool a server version exposes, with its risk classification.',
      inputSchema: {
        server: z.string().min(1).describe('Server id or slug'),
        version_id: z
          .string()
          .optional()
          .describe('Specific version; defaults to the recommended one'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ server: ref, version_id }) => {
      try {
        const result = await hub.servers.listTools(ref, version_id);
        return asText({
          version: result.version?.version ?? null,
          tools: result.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            riskClass: tool.riskOverride ?? tool.riskClass,
            riskIsOverridden: tool.riskOverride !== null,
            requiredParameters: Array.isArray(tool.inputSchema['required'])
              ? tool.inputSchema['required']
              : [],
          })),
        });
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'get_tool_schema',
    {
      title: 'Get a tool input schema',
      description: 'Returns the full JSON Schema for one tool, so a client can build a valid call.',
      inputSchema: {
        server: z.string().min(1).describe('Server id or slug'),
        tool: z.string().min(1).describe('Tool name'),
        version_id: z.string().optional().describe('Specific version'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ server: ref, tool: toolName, version_id }) => {
      try {
        const result = await hub.servers.listTools(ref, version_id);
        const tool = result.tools.find((candidate) => candidate.name === toolName);
        if (!tool) {
          return {
            content: [
              { type: 'text', text: `No tool named "${toolName}" on this server version.` },
            ],
            isError: true,
          };
        }
        return asText({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          riskClass: tool.riskOverride ?? tool.riskClass,
          riskReason: tool.riskReason,
        });
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'search_tools',
    {
      title: 'Search tools across every server',
      description:
        'Finds tools by name or description across the whole registry, independently of which server provides them.',
      inputSchema: {
        query: z.string().min(1).describe('Tool name or capability, e.g. "create_issue"'),
        risk: z
          .array(
            z.enum(['READ', 'WRITE', 'NETWORK', 'CREDENTIAL', 'DESTRUCTIVE', 'ADMIN', 'UNKNOWN']),
          )
          .optional()
          .describe('Restrict to these risk classifications'),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, risk, limit }) => {
      try {
        const result = await hub.tools.list({ q: query, ...(risk ? { risk } : {}), limit });
        return asText({
          total: result.total,
          tools: result.rows.map((row) => ({
            server: row.serverSlug,
            name: row.name,
            version: row.version,
            description: row.description,
            riskClass: row.riskClass,
          })),
        });
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'validate_server',
    {
      title: 'Read the latest validation result',
      description:
        'Returns the most recent validation findings for a server. This reads a stored result; it does not connect to the server.',
      inputSchema: { server: z.string().min(1).describe('Server id or slug') },
      annotations: { readOnlyHint: true },
    },
    async ({ server: ref }) => {
      try {
        const run = await hub.validation.run(ref);
        return asText({
          outcome: run.outcome,
          errors: run.errorCount,
          warnings: run.warningCount,
          findings: run.findings.slice(0, 25).map((finding) => ({
            severity: finding.severity,
            rule: finding.rule,
            location: finding.location,
            message: finding.message,
            suggestion: finding.suggestion,
          })),
        });
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'get_server_health',
    {
      title: 'Get server health',
      description: 'Returns uptime, latency and open incidents for a server, from recorded checks.',
      inputSchema: {
        server: z.string().min(1).describe('Server id or slug'),
        range: z.enum(['24h', '7d', '30d', '90d']).default('24h'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ server: ref, range }) => {
      try {
        const health = await hub.health.history(ref, range);
        return asText({
          summary: health.summary,
          openIncidents: health.incidents
            .filter((incident) => incident.status !== 'resolved')
            .map((incident) => ({
              kind: incident.kind,
              title: incident.title,
              startedAt: incident.startedAt,
              evidence: incident.evidence,
            })),
        });
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'get_version_changes',
    {
      title: 'Compare two versions',
      description:
        'Returns the structured diff between two versions of a server, including which changes are breaking and why.',
      inputSchema: {
        from_version_id: z.string().min(1).describe('The earlier version id'),
        to_version_id: z.string().min(1).describe('The later version id'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ from_version_id, to_version_id }) => {
      try {
        const diff = await hub.versions.compare(from_version_id, to_version_id);
        return asText({
          from: diff.fromVersion,
          to: diff.toVersion,
          summary: {
            toolsAdded: diff.toolsAdded,
            toolsRemoved: diff.toolsRemoved,
            toolsRenamed: diff.toolsRenamed,
            schemasChanged: diff.schemasChanged,
            breakingChanges: diff.breakingChanges,
          },
          changes: diff.changes.slice(0, 40).map((change) => ({
            kind: change.kind,
            subject: change.subject,
            breaking: change.breaking,
            rule: change.rule,
            detail: change.detail,
          })),
        });
      } catch (err) {
        return failure(err);
      }
    },
  );

  return server;
}
