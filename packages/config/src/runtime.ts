import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { HubConfig } from './env.js';
import { loadConfig } from './env.js';

/**
 * Development-only key material. Generated once into the data directory so
 * that restarting the dev server does not invalidate stored credentials.
 * Production refuses to boot without MCP_HUB_ENCRYPTION_KEY.
 */
function resolveDevEncryptionKey(dataDir: string): Buffer {
  const keyPath = resolve(join(dataDir, 'encryption.key'));
  if (existsSync(keyPath)) {
    const decoded = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
    if (decoded.length === 32) return decoded;
  }
  mkdirSync(dirname(keyPath), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString('base64'), { mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    // Best effort: some filesystems (e.g. mounted volumes) reject chmod.
  }
  return key;
}

let cached: HubConfig | null = null;

/** Returns the process-wide configuration, loading it on first use. */
export function getConfig(): HubConfig {
  cached ??= loadConfig({ resolveDevEncryptionKey });
  return cached;
}

/** Test helper: forces the next getConfig() call to re-read the environment. */
export function resetConfigCache(): void {
  cached = null;
}
