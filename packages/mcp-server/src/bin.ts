#!/usr/bin/env node
/**
 * Runs MCP Hub as an MCP server over stdio.
 *
 *   MCP_HUB_API_KEY=mch_... MCP_HUB_URL=https://hub.example.com mcp-hub-server
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHubMcpServer } from './server.js';

const apiKey = process.env['MCP_HUB_API_KEY'];
if (!apiKey) {
  process.stderr.write(
    'MCP_HUB_API_KEY is required. Create a read-only key in MCP Hub under Settings → API.\n',
  );
  process.exit(1);
}

const server = createHubMcpServer({
  apiKey,
  baseUrl: process.env['MCP_HUB_URL'] ?? 'http://localhost:3000',
  ...(process.env['MCP_HUB_ORGANIZATION_ID']
    ? { organizationId: process.env['MCP_HUB_ORGANIZATION_ID'] }
    : {}),
});

await server.connect(new StdioServerTransport());
