import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../env.js';

const KEY = randomBytes(32).toString('base64');
const devKey = (): Buffer => randomBytes(32);

const load = (env: Record<string, string | undefined>) =>
  loadConfig({ env: env as NodeJS.ProcessEnv, resolveDevEncryptionKey: devKey });

describe('defaults', () => {
  it('runs entirely locally with an empty environment', () => {
    const config = load({});
    expect(config.database.driver).toBe('pglite');
    expect(config.auth.provider).toBe('dev');
    expect(config.llm.provider).toBe('grounded');
    expect(config.queue.driver).toBe('database');
    expect(config.nodeEnv).toBe('development');
  });

  it('defaults to the safe side on every security switch', () => {
    const config = load({});
    expect(config.security.allowStdioTransport).toBe(false);
    expect(config.security.allowPrivateNetwork).toBe(false);
    expect(config.security.maxToolPayloadBytes).toBeGreaterThan(0);
    expect(config.security.outboundTimeoutMs).toBeGreaterThan(0);
  });

  it('uses PostgreSQL as soon as a URL is supplied', () => {
    const config = load({ DATABASE_URL: 'postgresql://localhost:5432/mcp_hub' });
    expect(config.database.driver).toBe('postgres');
    expect(config.database.directUrl).toBe('postgresql://localhost:5432/mcp_hub');
  });
});

describe('production refuses to boot unsafely', () => {
  it('rejects the development auth provider', () => {
    expect(() =>
      load({ NODE_ENV: 'production', MCP_HUB_AUTH_PROVIDER: 'dev', MCP_HUB_ENCRYPTION_KEY: KEY }),
    ).toThrow(/cannot be used with NODE_ENV=production/);
  });

  it('rejects a missing encryption key', () => {
    expect(() =>
      load({
        NODE_ENV: 'production',
        MCP_HUB_AUTH_PROVIDER: 'clerk',
        CLERK_SECRET_KEY: 'sk',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk',
      }),
    ).toThrow(/MCP_HUB_ENCRYPTION_KEY is required/);
  });

  it('accepts a correctly configured production environment', () => {
    const config = load({
      NODE_ENV: 'production',
      MCP_HUB_AUTH_PROVIDER: 'clerk',
      CLERK_SECRET_KEY: 'sk_live_x',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_x',
      MCP_HUB_ENCRYPTION_KEY: KEY,
      DATABASE_URL: 'postgresql://db/app',
    });
    expect(config.security.encryptionKeySource).toBe('env');
    expect(config.auth.provider).toBe('clerk');
  });
});

describe('validation happens at boot, not at first use', () => {
  it('rejects an encryption key of the wrong length', () => {
    expect(() => load({ MCP_HUB_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(
      /exactly 32 bytes/,
    );
  });

  it('rejects Clerk without its keys', () => {
    expect(() => load({ MCP_HUB_AUTH_PROVIDER: 'clerk' })).toThrow(/requires both/);
  });

  it('rejects OpenRouter without an API key', () => {
    expect(() => load({ MCP_HUB_LLM_PROVIDER: 'openrouter' })).toThrow(
      /requires OPENROUTER_API_KEY/,
    );
  });

  it('rejects an unknown enum value', () => {
    expect(() => load({ MCP_HUB_AUTH_PROVIDER: 'ldap' })).toThrow(/must be one of/);
    expect(() => load({ MCP_HUB_QUEUE_DRIVER: 'rabbitmq' })).toThrow(/must be one of/);
  });

  it('rejects a non-boolean flag rather than treating it as false', () => {
    expect(() => load({ MCP_HUB_ALLOW_STDIO: 'yes please' })).toThrow(/must be a boolean/);
  });

  it('rejects a non-numeric limit', () => {
    expect(() => load({ MCP_HUB_MAX_PAYLOAD_BYTES: 'lots' })).toThrow(/must be an integer/);
  });

  it('accepts the usual spellings of a boolean', () => {
    for (const value of ['true', 'TRUE', '1', 'yes', 'on']) {
      expect(load({ MCP_HUB_ALLOW_STDIO: value }).security.allowStdioTransport, value).toBe(true);
    }
    for (const value of ['false', '0', 'no', 'off']) {
      expect(load({ MCP_HUB_ALLOW_STDIO: value }).security.allowStdioTransport, value).toBe(false);
    }
  });
});

describe('the stdio allowlist', () => {
  it('has a conservative default', () => {
    expect(load({}).security.stdioAllowedCommands).toEqual([
      'node',
      'npx',
      'python3',
      'uvx',
      'deno',
      'bun',
    ]);
  });

  it('can be narrowed', () => {
    const config = load({ MCP_HUB_STDIO_ALLOWED_COMMANDS: 'node, deno ' });
    expect(config.security.stdioAllowedCommands).toEqual(['node', 'deno']);
  });
});

describe('immutability', () => {
  it('freezes the configuration so nothing can widen it at runtime', () => {
    const config = load({});
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.security)).toBe(true);
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate mutation attempt
      (config.security as any).allowStdioTransport = true;
    }).toThrow();
  });
});
