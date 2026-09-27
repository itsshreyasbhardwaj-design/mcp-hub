import {
  type EnvironmentRequirement,
  type Principal,
  type TransportConfig,
  HubError,
  toSlug,
} from '@mcp-hub/core';
import { describeTransport } from '@mcp-hub/security';
import type { AppContext } from '../context.js';
import { requireRole } from '../auth/resolve.js';
import { registerServer } from './registry.js';

export interface ImportCandidate {
  key: string;
  name: string;
  slug: string;
  transport: TransportConfig;
  environment: EnvironmentRequirement[];
  /** What the operator is agreeing to, in plain language. */
  summary: string;
  warnings: string[];
  alreadyRegistered: boolean;
}

export interface ImportPreview {
  source: 'claude-desktop' | 'mcp-json' | 'unknown';
  candidates: ImportCandidate[];
  errors: string[];
}

/**
 * Parses a client configuration file into registry candidates.
 *
 * This step never registers anything and never executes anything. It exists
 * so that an operator sees exactly what a config would add — including which
 * entries would launch a local process — before confirming.
 */
export function previewImport(raw: string): ImportPreview {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      source: 'unknown',
      candidates: [],
      errors: [`The file is not valid JSON: ${err instanceof Error ? err.message : 'parse error'}.`],
    };
  }

  const root = parsed as Record<string, unknown>;
  const entries =
    (root['mcpServers'] as Record<string, unknown> | undefined) ??
    (root['servers'] as Record<string, unknown> | undefined);
  if (!entries || typeof entries !== 'object') {
    return {
      source: 'unknown',
      candidates: [],
      errors: ['No "mcpServers" or "servers" object was found in the file.'],
    };
  }

  const source: ImportPreview['source'] = root['mcpServers'] ? 'claude-desktop' : 'mcp-json';
  const candidates: ImportCandidate[] = [];

  for (const [key, value] of Object.entries(entries)) {
    if (!value || typeof value !== 'object') {
      errors.push(`Entry "${key}" is not an object.`);
      continue;
    }
    const entry = value as Record<string, unknown>;
    const warnings: string[] = [];

    let transport: TransportConfig;
    const url = typeof entry['url'] === 'string' ? entry['url'] : null;
    if (url) {
      const headers = (entry['headers'] as Record<string, string> | undefined) ?? {};
      transport = { kind: 'streamable-http', url, headerKeys: Object.keys(headers) };
      for (const [header, headerValue] of Object.entries(headers)) {
        if (!/^\$\{[^}]+\}$/.test(String(headerValue))) {
          warnings.push(
            `Header "${header}" contains a literal value. It will NOT be imported — store it as a credential instead.`,
          );
        }
      }
      if (url.startsWith('http://')) warnings.push('The endpoint uses plaintext HTTP.');
    } else {
      const command = typeof entry['command'] === 'string' ? entry['command'] : null;
      if (!command) {
        errors.push(`Entry "${key}" has neither a "url" nor a "command".`);
        continue;
      }
      const args = Array.isArray(entry['args']) ? entry['args'].map(String) : [];
      const env = (entry['env'] as Record<string, string> | undefined) ?? {};
      transport = { kind: 'stdio', command, args, envKeys: Object.keys(env) };
      warnings.push(
        'This entry launches a local process. MCP Hub will not execute it unless MCP_HUB_ALLOW_STDIO is enabled and the command is allowlisted.',
      );
      for (const [name, envValue] of Object.entries(env)) {
        if (!/^\$\{[^}]+\}$/.test(String(envValue))) {
          warnings.push(
            `Environment variable "${name}" contains a literal value. It will NOT be imported — store it as a credential instead.`,
          );
        }
      }
    }

    const environment: EnvironmentRequirement[] = (
      transport.kind === 'stdio' ? transport.envKeys : transport.headerKeys
    ).map((name) => ({
      key: name,
      description: null,
      required: true,
      secret: /key|token|secret|password|auth/i.test(name),
    }));

    candidates.push({
      key,
      name: key,
      slug: toSlug(key),
      transport,
      environment,
      summary: describeTransport(transport),
      warnings,
      alreadyRegistered: false,
    });
  }

  return { source, candidates, errors };
}

/** Marks candidates whose slug already exists, so the UI can offer a rename. */
export async function annotateImport(
  context: AppContext,
  principal: Principal,
  preview: ImportPreview,
): Promise<ImportPreview> {
  const candidates = await Promise.all(
    preview.candidates.map(async (candidate) => ({
      ...candidate,
      alreadyRegistered: Boolean(
        await context.repositories.registry.findServerBySlug(
          principal.organizationId,
          candidate.slug,
        ),
      ),
    })),
  );
  return { ...preview, candidates };
}

export interface ConfirmImportInput {
  candidates: Array<{
    slug: string;
    name: string;
    transport: TransportConfig;
    environment: EnvironmentRequirement[];
    version?: string;
  }>;
}

/**
 * Registers the candidates the operator confirmed. Nothing is connected to
 * and nothing is executed: discovery remains a separate, explicit action.
 */
export async function confirmImport(
  context: AppContext,
  principal: Principal,
  input: ConfirmImportInput,
): Promise<Array<{ slug: string; serverId: string; versionId: string | null }>> {
  requireRole(principal, 'developer');
  if (input.candidates.length === 0) {
    throw HubError.badRequest('Select at least one server to import.');
  }
  if (input.candidates.length > 50) {
    throw HubError.badRequest('Import at most 50 servers at a time.');
  }

  const results: Array<{ slug: string; serverId: string; versionId: string | null }> = [];
  for (const candidate of input.candidates) {
    const { server, versionId } = await registerServer(context, principal, {
      name: candidate.name,
      slug: candidate.slug,
      description: `Imported from a client configuration file.`,
      status: 'draft',
      version: {
        version: candidate.version ?? '0.1.0',
        transport: candidate.transport,
        environment: candidate.environment,
      },
    });
    results.push({ slug: server.slug, serverId: server.id, versionId });
  }
  return results;
}
