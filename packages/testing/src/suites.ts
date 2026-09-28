import {
  type CaseOutcome,
  type CompatibilityCaseResult,
  type CompatibilitySuite,
  newId,
} from '@mcp-hub/core';
import type { McpClient } from '@mcp-hub/mcp-client';
import { inspectSchema } from '@mcp-hub/validator';
import { scanForInjection } from '@mcp-hub/security';

export interface SuiteContext {
  client: McpClient;
  /** Bounds a single test case so one hung call cannot stall a run. */
  caseTimeoutMs: number;
}

export interface TestCaseDefinition {
  suite: CompatibilitySuite;
  key: string;
  title: string;
  /** Explains what a failure would mean, shown next to the result. */
  rationale: string;
  run: (context: SuiteContext) => Promise<CaseResult>;
}

export interface CaseResult {
  outcome: CaseOutcome;
  message: string | null;
  evidence?: Record<string, unknown>;
}

const ok = (message: string, evidence?: Record<string, unknown>): CaseResult => ({
  outcome: 'passed',
  message,
  ...(evidence ? { evidence } : {}),
});
const warn = (message: string, evidence?: Record<string, unknown>): CaseResult => ({
  outcome: 'warning',
  message,
  ...(evidence ? { evidence } : {}),
});
const fail = (message: string, evidence?: Record<string, unknown>): CaseResult => ({
  outcome: 'failed',
  message,
  ...(evidence ? { evidence } : {}),
});
const skip = (message: string): CaseResult => ({ outcome: 'skipped', message });

/**
 * The compatibility suites.
 *
 * These run against a live server. Everything here is read-only or uses
 * deliberately invalid input: the suites never call a tool with arguments
 * that could cause a side effect, because a compatibility run must be safe to
 * execute against production.
 */
export const TEST_CASES: TestCaseDefinition[] = [
  // --- connection ---------------------------------------------------------
  {
    suite: 'connection',
    key: 'connection.initialize',
    title: 'Completes the initialize handshake',
    rationale: 'Without a successful handshake no client can use the server at all.',
    run: async ({ client }) => {
      const info = client.info;
      if (!info) return fail('The client is not connected.');
      return ok(`Handshake completed in ${info.handshakeMs}ms.`, {
        protocolVersion: info.protocolVersion,
        serverInfo: info.serverInfo,
        handshakeMs: info.handshakeMs,
      });
    },
  },
  {
    suite: 'connection',
    key: 'connection.protocol-version',
    title: 'Negotiates a known protocol revision',
    rationale: 'An unrecognised revision means clients may mis-parse responses.',
    run: async ({ client }) => {
      const version = client.info?.protocolVersion;
      if (!version) return fail('No protocol version was negotiated.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) {
        return fail(`"${version}" is not an MCP protocol revision date.`, {
          protocolVersion: version,
        });
      }
      const known = ['2025-06-18', '2025-03-26', '2024-11-05'];
      return known.includes(version)
        ? ok(`Negotiated ${version}.`, { protocolVersion: version })
        : warn(`Negotiated ${version}, which this build does not recognise.`, {
            protocolVersion: version,
            known,
          });
    },
  },
  {
    suite: 'connection',
    key: 'connection.server-info',
    title: 'Reports a name and version',
    rationale: 'Clients display this, and MCP Hub uses it to detect identity changes.',
    run: async ({ client }) => {
      const info = client.info?.serverInfo;
      if (!info?.name) return fail('serverInfo.name is missing.');
      if (!info.version) return warn('serverInfo.version is missing.', { serverInfo: info });
      return ok(`${info.name} ${info.version}`, { serverInfo: info });
    },
  },
  {
    suite: 'connection',
    key: 'connection.ping',
    title: 'Responds to ping',
    rationale: 'Health monitoring uses ping as the cheapest liveness probe.',
    run: async ({ client }) => {
      const started = performance.now();
      try {
        await client.ping();
        return ok(`Responded in ${Math.round(performance.now() - started)}ms.`);
      } catch (err) {
        // ping is optional in practice; many servers do not implement it.
        return warn(`ping is not supported: ${errorMessage(err)}.`);
      }
    },
  },

  // --- capabilities -------------------------------------------------------
  {
    suite: 'capabilities',
    key: 'capabilities.declared',
    title: 'Advertises at least one capability',
    rationale: 'A server advertising nothing cannot be used for anything.',
    run: async ({ client }) => {
      const capabilities = client.info?.capabilities ?? {};
      const keys = Object.keys(capabilities);
      if (keys.length === 0) return fail('The server advertised no capabilities.');
      return ok(`Advertises: ${keys.join(', ')}.`, { capabilities });
    },
  },
  {
    suite: 'capabilities',
    key: 'capabilities.tools-discoverable',
    title: 'tools/list succeeds when tools are advertised',
    rationale: 'Clients enumerate tools on connect; a failure here breaks every client.',
    run: async ({ client }) => {
      if (!client.info?.capabilities?.['tools'])
        return skip('The server does not advertise tools.');
      const tools = await client.listTools();
      if (tools.length === 0) {
        return warn('tools/list returned an empty list although tools are advertised.');
      }
      return ok(`Discovered ${tools.length} tool(s).`, { tools: tools.map((t) => t.name) });
    },
  },
  {
    suite: 'capabilities',
    key: 'capabilities.resources-discoverable',
    title: 'resources/list succeeds when resources are advertised',
    rationale: 'Advertising resources that cannot be listed breaks resource-aware clients.',
    run: async ({ client }) => {
      if (!client.info?.capabilities?.['resources']) {
        return skip('The server does not advertise resources.');
      }
      const resources = await client.listResources();
      return resources.length === 0
        ? warn('resources/list returned an empty list although resources are advertised.')
        : ok(`Discovered ${resources.length} resource(s).`, {
            resources: resources.map((r) => r.uri),
          });
    },
  },
  {
    suite: 'capabilities',
    key: 'capabilities.prompts-discoverable',
    title: 'prompts/list succeeds when prompts are advertised',
    rationale: 'Same contract as tools and resources.',
    run: async ({ client }) => {
      if (!client.info?.capabilities?.['prompts']) {
        return skip('The server does not advertise prompts.');
      }
      const prompts = await client.listPrompts();
      return prompts.length === 0
        ? warn('prompts/list returned an empty list although prompts are advertised.')
        : ok(`Discovered ${prompts.length} prompt(s).`, { prompts: prompts.map((p) => p.name) });
    },
  },
  {
    suite: 'capabilities',
    key: 'capabilities.undeclared-surface',
    title: 'Does not expose undeclared capabilities',
    rationale: 'Strict clients never call a capability that was not advertised.',
    run: async ({ client }) => {
      const capabilities = client.info?.capabilities ?? {};
      const problems: string[] = [];
      if (!capabilities['tools']) {
        const tools = await client.listTools().catch(() => []);
        if (tools.length > 0) problems.push(`${tools.length} tools`);
      }
      if (!capabilities['prompts']) {
        const prompts = await client.listPrompts().catch(() => []);
        if (prompts.length > 0) problems.push(`${prompts.length} prompts`);
      }
      return problems.length === 0
        ? ok('Everything exposed is advertised.')
        : fail(`Exposed without being advertised: ${problems.join(', ')}.`);
    },
  },

  // --- schemas ------------------------------------------------------------
  {
    suite: 'schemas',
    key: 'schemas.tool-input-valid',
    title: 'Every tool input schema is structurally valid',
    rationale: 'A malformed schema prevents clients from rendering a form or validating a call.',
    run: async ({ client }) => {
      const tools = await client.listTools();
      if (tools.length === 0) return skip('No tools to check.');
      const errors: Array<{ tool: string; path: string; message: string }> = [];
      for (const tool of tools) {
        for (const issue of inspectSchema(tool.inputSchema, `tools.${tool.name}.inputSchema`, {
          requireObjectRoot: true,
        })) {
          if (issue.severity === 'error') {
            errors.push({ tool: tool.name, path: issue.path, message: issue.message });
          }
        }
      }
      return errors.length === 0
        ? ok(`All ${tools.length} input schema(s) are valid.`)
        : fail(`${errors.length} schema error(s).`, { errors: errors.slice(0, 20) });
    },
  },
  {
    suite: 'schemas',
    key: 'schemas.tool-documented',
    title: 'Tools and their parameters are documented',
    rationale: 'Models pick tools almost entirely from descriptions.',
    run: async ({ client }) => {
      const tools = await client.listTools();
      if (tools.length === 0) return skip('No tools to check.');
      const undocumented = tools.filter((t) => !t.description?.trim()).map((t) => t.name);
      const undocumentedFields: string[] = [];
      for (const tool of tools) {
        for (const issue of inspectSchema(tool.inputSchema, `tools.${tool.name}.inputSchema`)) {
          if (issue.message.includes('has no description')) undocumentedFields.push(issue.path);
        }
      }
      if (undocumented.length === 0 && undocumentedFields.length === 0) {
        return ok('Every tool and parameter carries a description.');
      }
      return warn(
        `${undocumented.length} undocumented tool(s), ${undocumentedFields.length} undocumented parameter(s).`,
        { undocumented, undocumentedFields: undocumentedFields.slice(0, 20) },
      );
    },
  },
  {
    suite: 'schemas',
    key: 'schemas.names-unique',
    title: 'Tool names are unique and well-formed',
    rationale: 'Duplicate or malformed names make tools unaddressable.',
    run: async ({ client }) => {
      const tools = await client.listTools();
      if (tools.length === 0) return skip('No tools to check.');
      const seen = new Set<string>();
      const duplicates: string[] = [];
      const malformed: string[] = [];
      for (const tool of tools) {
        if (seen.has(tool.name)) duplicates.push(tool.name);
        seen.add(tool.name);
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(tool.name)) malformed.push(tool.name);
      }
      if (duplicates.length === 0 && malformed.length === 0)
        return ok('Names are unique and valid.');
      return fail(`${duplicates.length} duplicate(s), ${malformed.length} malformed name(s).`, {
        duplicates,
        malformed,
      });
    },
  },
  {
    suite: 'schemas',
    key: 'schemas.metadata-clean',
    title: 'Tool metadata contains no model-directed instructions',
    rationale:
      'Tool descriptions reach a model verbatim. Text that addresses the model is a prompt-injection vector.',
    run: async ({ client }) => {
      const tools = await client.listTools();
      if (tools.length === 0) return skip('No tools to check.');
      const signals = tools.flatMap((tool) =>
        scanForInjection(tool.description ?? '', `tools.${tool.name}.description`).map((s) => ({
          tool: tool.name,
          rule: s.rule,
          title: s.title,
          excerpt: s.excerpt,
        })),
      );
      return signals.length === 0
        ? ok('No injection signals in tool metadata.')
        : fail(`${signals.length} injection signal(s) found.`, { signals: signals.slice(0, 10) });
    },
  },

  // --- behaviour ----------------------------------------------------------
  {
    suite: 'behaviour',
    key: 'behaviour.rejects-unknown-tool',
    title: 'Rejects a call to a tool that does not exist',
    rationale:
      'A server that silently succeeds on an unknown tool will mask client bugs and can mislead an agent.',
    run: async ({ client }) => {
      const probe = `__mcp_hub_probe_${Date.now().toString(36)}`;
      try {
        const result = await client.callTool(probe, {});
        return result.isError
          ? ok('Reported an error for the unknown tool.', { isError: true })
          : fail('Returned success for a tool that does not exist.', { result });
      } catch {
        // A JSON-RPC error is equally correct.
        return ok('Raised a protocol error for the unknown tool.');
      }
    },
  },
  {
    suite: 'behaviour',
    key: 'behaviour.rejects-malformed-arguments',
    title: 'Rejects arguments that violate the declared schema',
    rationale:
      'If a server accepts input its own schema forbids, the schema cannot be relied on for safety checks.',
    run: async ({ client }) => {
      const tools = await client.listTools();
      const candidate = tools.find((tool) => {
        const schema = tool.inputSchema as { required?: unknown; properties?: unknown };
        return Array.isArray(schema.required) && schema.required.length > 0;
      });
      if (!candidate) return skip('No tool declares a required parameter.');

      const required = (candidate.inputSchema as { required: string[] }).required;
      try {
        // Send a value of deliberately wrong type for a required field.
        const result = await client.callTool(candidate.name, {
          [required[0] as string]: { __mcp_hub_invalid: true },
        });
        return result.isError
          ? ok(`"${candidate.name}" rejected an argument of the wrong type.`, {
              tool: candidate.name,
            })
          : warn(`"${candidate.name}" accepted an argument that violates its schema.`, {
              tool: candidate.name,
              required,
            });
      } catch {
        return ok(`"${candidate.name}" raised a protocol error for invalid arguments.`, {
          tool: candidate.name,
        });
      }
    },
  },
  {
    suite: 'behaviour',
    key: 'behaviour.list-is-stable',
    title: 'tools/list returns the same surface twice in a row',
    rationale:
      'A capability surface that changes between calls makes caching, permissions and diffing unreliable.',
    run: async ({ client }) => {
      if (!client.info?.capabilities?.['tools'])
        return skip('The server does not advertise tools.');
      const first = (await client.listTools()).map((t) => t.name).sort();
      const second = (await client.listTools()).map((t) => t.name).sort();
      if (first.join(',') === second.join(',')) {
        return ok(`Stable across two calls (${first.length} tool(s)).`);
      }
      return fail('tools/list returned a different set on the second call.', { first, second });
    },
  },
  {
    suite: 'behaviour',
    key: 'behaviour.resource-readable',
    title: 'The first advertised resource can be read',
    rationale: 'Advertising a resource that cannot be read breaks resource-aware clients.',
    run: async ({ client }) => {
      if (!client.info?.capabilities?.['resources']) return skip('No resources advertised.');
      const resources = await client.listResources();
      const first = resources[0];
      if (!first) return skip('No resources to read.');
      try {
        const result = await client.readResource(first.uri);
        return result.contents.length > 0
          ? ok(`Read ${first.uri}.`, { uri: first.uri, blocks: result.contents.length })
          : warn(`${first.uri} returned no content.`, { uri: first.uri });
      } catch (err) {
        return fail(`Could not read ${first.uri}: ${errorMessage(err)}`, { uri: first.uri });
      }
    },
  },
  {
    suite: 'behaviour',
    key: 'behaviour.latency',
    title: 'Responds to tools/list within a reasonable time',
    rationale: 'Slow discovery shows up as timeouts in every client that connects.',
    run: async ({ client }) => {
      const started = performance.now();
      await client.listTools();
      const elapsed = Math.round(performance.now() - started);
      if (elapsed > 5000) return fail(`tools/list took ${elapsed}ms.`, { durationMs: elapsed });
      if (elapsed > 1500) return warn(`tools/list took ${elapsed}ms.`, { durationMs: elapsed });
      return ok(`tools/list took ${elapsed}ms.`, { durationMs: elapsed });
    },
  },
];

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function newCaseResult(
  definition: TestCaseDefinition,
  result: CaseResult,
  durationMs: number,
): CompatibilityCaseResult {
  return {
    id: newId('compatibilityCase'),
    suite: definition.suite,
    key: definition.key,
    title: definition.title,
    outcome: result.outcome,
    durationMs,
    message: result.message,
    evidence: result.evidence ?? null,
  };
}
