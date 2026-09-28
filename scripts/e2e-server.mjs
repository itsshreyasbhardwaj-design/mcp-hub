#!/usr/bin/env node
/**
 * Boots the app for the end-to-end suite.
 *
 * Each run gets its own throwaway data directory and its own seeded database,
 * so E2E never depends on — or damages — a developer's working data, and a
 * failing run can be reproduced from scratch.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = process.argv[2] ?? '3210';
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dataDir = mkdtempSync(join(tmpdir(), 'mcp-hub-e2e-'));

const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: port,
  MCP_HUB_DATA_DIR: dataDir,
  MCP_HUB_AUTH_PROVIDER: 'dev',
  MCP_HUB_ALLOW_STDIO: 'true',
  MCP_HUB_RATE_MAX_REQUESTS: '100000',
  MCP_HUB_RATE_MAX_TOOL_EXECUTIONS: '100000',
  LOG_LEVEL: 'warn',
  NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
  MCP_HUB_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env, cwd: repoRoot, ...options });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}

let server;
function shutdown() {
  server?.kill('SIGTERM');
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // The directory is in the OS temp dir; leaving it is harmless.
  }
}
process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

const nextBin = join(repoRoot, 'apps/web/node_modules/.bin/next');
const webDir = join(repoRoot, 'apps/web');

// NODE_ENV=production refuses the dev auth provider, so seeding runs as test.
await run('node', ['scripts/db.ts', 'reset'], { env: { ...env, NODE_ENV: 'test' } });

// Build unless one is already present, so a local re-run is fast.
if (!existsSync(join(webDir, '.next/BUILD_ID'))) {
  await run(nextBin, ['build'], { cwd: webDir });
}

server = spawn(nextBin, ['start', '--port', port], {
  stdio: 'inherit',
  cwd: webDir,
  // The dev auth provider is what the suite signs in with.
  env: { ...env, NODE_ENV: 'test' },
});
server.on('exit', (code) => {
  shutdown();
  process.exit(code ?? 0);
});
