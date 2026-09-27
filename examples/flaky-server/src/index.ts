#!/usr/bin/env node
/**
 * Example MCP server that misbehaves on purpose.
 *
 * MCP Hub's health monitoring, incident detection and error-path handling need
 * a server that actually fails, times out and changes its capability surface.
 * Behaviour is driven by environment variables so the same binary can play
 * several roles in tests and demos:
 *
 *   FLAKY_FAILURE_RATE   0..1, probability that a tool call returns an error
 *   FLAKY_LATENCY_MS     artificial delay added to every tool call
 *   FLAKY_HANG_TOOL      name of a tool that never responds
 *   FLAKY_HIDE_TOOL      omit this tool from tools/list (simulates a removal)
 *   FLAKY_FAIL_INIT      when "1", refuse the initialize handshake
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const failureRate = Number.parseFloat(process.env['FLAKY_FAILURE_RATE'] ?? '0');
const latencyMs = Number.parseInt(process.env['FLAKY_LATENCY_MS'] ?? '0', 10);
const hangTool = process.env['FLAKY_HANG_TOOL'] ?? '';
const hideTool = process.env['FLAKY_HIDE_TOOL'] ?? '';

if (process.env['FLAKY_FAIL_INIT'] === '1') {
  process.stderr.write('flaky-server: refusing to start (FLAKY_FAIL_INIT=1)\n');
  process.exit(1);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function behave(toolName: string): Promise<void> {
  if (toolName === hangTool) await new Promise(() => undefined);
  if (latencyMs > 0) await sleep(latencyMs);
  if (failureRate > 0 && Math.random() < failureRate) {
    throw new Error(`flaky-server: synthetic failure in ${toolName}`);
  }
}

const server = new McpServer(
  { name: 'example-flaky-server', version: '0.4.1' },
  { capabilities: { tools: {} } },
);

if (hideTool !== 'stable_ping') {
  server.registerTool(
    'stable_ping',
    {
      title: 'Ping',
      description: 'Returns pong. Subject to the configured failure rate and latency.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      await behave('stable_ping');
      return { content: [{ type: 'text', text: 'pong' }] };
    },
  );
}

if (hideTool !== 'slow_report') {
  server.registerTool(
    'slow_report',
    {
      title: 'Slow report',
      description: 'Sleeps for the requested number of milliseconds, then returns.',
      inputSchema: { delay_ms: z.number().int().min(0).max(120000).default(1500) },
      annotations: { readOnlyHint: true },
    },
    async ({ delay_ms }) => {
      await behave('slow_report');
      await sleep(delay_ms);
      return { content: [{ type: 'text', text: `slept ${delay_ms}ms` }] };
    },
  );
}

if (hideTool !== 'purge_everything') {
  server.registerTool(
    'purge_everything',
    {
      title: 'Purge everything',
      description: 'Permanently destroys all server state. Irreversible.',
      inputSchema: { confirm: z.boolean().default(false) },
      annotations: { destructiveHint: true },
    },
    async ({ confirm }) => {
      await behave('purge_everything');
      return {
        content: [{ type: 'text', text: confirm ? 'purged' : 'refused: confirm was false' }],
        isError: !confirm,
      };
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
