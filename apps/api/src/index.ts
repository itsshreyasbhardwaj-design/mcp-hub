#!/usr/bin/env node
/**
 * Standalone API server.
 *
 * Mounts exactly the same route table the Next.js app serves, so a
 * self-hosted deployment can run the API without the dashboard — and so the
 * HTTP layer stays framework-agnostic rather than drifting into Next-specific
 * shapes.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { apiRouter, fromWebRequest, getContext } from '@mcp-hub/api';
import { getConfig } from '@mcp-hub/config';
import { HubError, toApiError } from '@mcp-hub/core';
import { logger } from '@mcp-hub/observability';

const config = getConfig();
const port = Number.parseInt(process.env['PORT'] ?? '3001', 10);
const host = process.env['HOST'] ?? '0.0.0.0';

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Buffer);
    total += buffer.byteLength;
    if (total > 2 * 1024 * 1024)
      throw new HubError('PAYLOAD_TOO_LARGE', 'Request body exceeds 2 MiB.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function toWebRequest(req: IncomingMessage, body: Buffer): Request {
  const protocol = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  const url = new URL(req.url ?? '/', `${protocol}://${req.headers.host ?? 'localhost'}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const method = req.method ?? 'GET';
  return new Request(url, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body }),
  });
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
    try {
      const body = await readBody(req);
      const hubRequest = await fromWebRequest(toWebRequest(req, body));
      const response = await apiRouter.handle(hubRequest);
      res.writeHead(response.status, response.headers);
      res.end(response.body === null ? undefined : JSON.stringify(response.body));
    } catch (err) {
      const status = err instanceof HubError ? err.status : 500;
      const payload = toApiError(err, 'req_unhandled');
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    }
  })();
});

// Fail fast if the database or configuration is unusable.
await getContext();

server.listen(port, host, () => {
  logger.info('MCP Hub API listening', {
    url: `http://${host}:${port}`,
    routes: apiRouter.describe().length,
    authProvider: config.auth.provider,
    database: config.database.driver,
  });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('Shutting down');
    server.close(() => process.exit(0));
  });
}
