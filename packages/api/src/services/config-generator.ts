import { type Id, type Principal, type ServerVersionRecord, HubError } from '@mcp-hub/core';
import type { AppContext } from '../context.js';
import { requireScope } from '../auth/resolve.js';

export type ConfigFormat = 'claude-desktop' | 'mcp-json' | 'env' | 'vscode' | 'raw';

export interface GeneratedConfig {
  format: ConfigFormat;
  filename: string;
  language: 'json' | 'bash';
  content: string;
  /** Placeholder names the operator still has to fill in. */
  placeholders: string[];
  notes: string[];
}

/**
 * Generates client configuration.
 *
 * Credential values are never emitted. Every secret appears as a
 * `${PLACEHOLDER}` token, and the generated file is accompanied by the list
 * of names the operator must supply — so a config can be committed to a repo
 * without leaking anything.
 */
export async function generateConfig(
  context: AppContext,
  principal: Principal,
  input: {
    versionId: Id<'version'>;
    format: ConfigFormat;
    environmentId?: Id<'environment'> | null;
    serverKey?: string;
  },
): Promise<GeneratedConfig> {
  requireScope(principal, 'servers:read');

  const version = await context.repositories.registry.findVersionById(
    principal.organizationId,
    input.versionId,
  );
  if (!version) throw new HubError('VERSION_NOT_FOUND', 'The requested version does not exist.');
  const server = await context.repositories.registry.findServerById(
    principal.organizationId,
    version.serverId,
  );
  if (!server) throw new HubError('SERVER_NOT_FOUND', 'The requested MCP server does not exist.');

  let transport = version.transport;
  if (input.environmentId) {
    const environment = await context.repositories.registry.findEnvironment(
      principal.organizationId,
      input.environmentId,
    );
    if (!environment) throw HubError.notFound('That environment does not exist.');
    transport = environment.transportOverride ?? transport;
  }

  const key = input.serverKey ?? server.slug;
  const placeholders = collectPlaceholders(version, transport);
  const notes = buildNotes(version, placeholders);

  switch (input.format) {
    case 'claude-desktop':
      return {
        format: input.format,
        filename: 'claude_desktop_config.json',
        language: 'json',
        content: JSON.stringify(
          { mcpServers: { [key]: entryFor(transport, placeholders) } },
          null,
          2,
        ),
        placeholders,
        notes: [
          ...notes,
          'Place this at ~/Library/Application Support/Claude/claude_desktop_config.json on macOS.',
        ],
      };
    case 'vscode':
      return {
        format: input.format,
        filename: '.vscode/mcp.json',
        language: 'json',
        content: JSON.stringify({ servers: { [key]: entryFor(transport, placeholders) } }, null, 2),
        placeholders,
        notes,
      };
    case 'mcp-json':
      return {
        format: input.format,
        filename: 'mcp.json',
        language: 'json',
        content: JSON.stringify(
          { mcpServers: { [key]: entryFor(transport, placeholders) } },
          null,
          2,
        ),
        placeholders,
        notes,
      };
    case 'env':
      return {
        format: input.format,
        filename: `.env.${server.slug}`,
        language: 'bash',
        content: [
          `# Credentials for ${server.name} ${version.version}`,
          '# Fill in each value; never commit the completed file.',
          ...placeholders.map((name) => `${name}=`),
        ].join('\n'),
        placeholders,
        notes,
      };
    case 'raw':
      return {
        format: input.format,
        filename: `${server.slug}-${version.version}.json`,
        language: 'json',
        content: JSON.stringify(
          {
            name: server.name,
            slug: server.slug,
            version: version.version,
            transport: entryFor(transport, placeholders),
            environment: version.environment,
            capabilities: version.capabilities,
          },
          null,
          2,
        ),
        placeholders,
        notes,
      };
    default:
      throw HubError.badRequest(`Unknown configuration format "${String(input.format)}".`);
  }
}

function entryFor(
  transport: ServerVersionRecord['transport'],
  placeholders: string[],
): Record<string, unknown> {
  if (transport.kind === 'stdio') {
    const env: Record<string, string> = {};
    for (const key of transport.envKeys) env[key] = `\${${key}}`;
    return {
      command: transport.command,
      args: transport.args,
      ...(placeholders.length > 0 ? { env } : {}),
    };
  }
  const headers: Record<string, string> = {};
  for (const key of transport.headerKeys) headers[key] = `\${${key}}`;
  return {
    type: 'http',
    url: transport.url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

function collectPlaceholders(
  version: ServerVersionRecord,
  transport: ServerVersionRecord['transport'],
): string[] {
  const fromTransport = transport.kind === 'stdio' ? transport.envKeys : transport.headerKeys;
  const declared = version.environment
    .filter((req) => req.required || req.secret)
    .map((req) => req.key);
  return [...new Set([...fromTransport, ...declared])];
}

function buildNotes(version: ServerVersionRecord, placeholders: string[]): string[] {
  const notes: string[] = [];
  if (placeholders.length > 0) {
    notes.push(
      `Replace ${placeholders.map((p) => `\${${p}}`).join(', ')} before use. MCP Hub never writes credential values into generated configuration.`,
    );
  }
  if (version.transport.kind === 'stdio') {
    notes.push('This is a stdio server: the client will launch it as a local process.');
  }
  if (version.deprecated) {
    notes.push(`Version ${version.version} is marked deprecated.`);
  }
  return notes;
}
