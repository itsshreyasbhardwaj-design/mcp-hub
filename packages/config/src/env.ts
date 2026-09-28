import { HubError } from '@mcp-hub/core';

export type AuthProviderName = 'dev' | 'clerk';
export type QueueDriverName = 'database' | 'redis';
export type LlmProviderName = 'grounded' | 'openrouter';
export type DatabaseDriverName = 'pglite' | 'postgres';

export interface HubConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly appUrl: string;
  readonly logLevel: string;
  readonly dataDir: string;

  readonly database: {
    readonly driver: DatabaseDriverName;
    readonly url: string | null;
    readonly directUrl: string | null;
    /** Filesystem location for the embedded PGlite database. */
    readonly embeddedPath: string;
    readonly poolSize: number;
    readonly statementTimeoutMs: number;
  };

  readonly auth: {
    readonly provider: AuthProviderName;
    readonly clerkSecretKey: string | null;
    readonly clerkPublishableKey: string | null;
  };

  readonly security: {
    /** 32 raw bytes. Derived from env, or from a dev key file. */
    readonly encryptionKey: Buffer;
    readonly encryptionKeySource: 'env' | 'generated-dev-key';
    readonly allowStdioTransport: boolean;
    readonly stdioAllowedCommands: readonly string[];
    readonly allowPrivateNetwork: boolean;
    readonly maxToolPayloadBytes: number;
    readonly outboundTimeoutMs: number;
  };

  readonly queue: {
    readonly driver: QueueDriverName;
    readonly redisUrl: string | null;
    readonly pollIntervalMs: number;
    readonly concurrency: number;
  };

  readonly llm: {
    readonly provider: LlmProviderName;
    readonly openRouterApiKey: string | null;
    readonly model: string;
  };

  readonly rateLimit: {
    readonly windowMs: number;
    readonly maxRequests: number;
    readonly maxToolExecutions: number;
  };
}

function str(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function bool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = str(env, key);
  if (raw === null) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(raw.toLowerCase())) return false;
  throw HubError.badRequest(`Environment variable ${key} must be a boolean, received "${raw}".`);
}

function int(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = str(env, key);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw HubError.badRequest(`Environment variable ${key} must be an integer, received "${raw}".`);
  }
  return parsed;
}

function oneOf<T extends string>(
  env: NodeJS.ProcessEnv,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = str(env, key);
  if (raw === null) return fallback;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw HubError.badRequest(
      `Environment variable ${key} must be one of ${allowed.join(', ')}; received "${raw}".`,
    );
  }
  return raw as T;
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  /** Injected so the loader stays pure and testable. */
  resolveDevEncryptionKey?: (dataDir: string) => Buffer;
}

/**
 * Parses and validates the process environment exactly once. Invalid values
 * fail loudly at boot rather than at the first request that needs them.
 */
export function loadConfig(options: LoadConfigOptions = {}): HubConfig {
  const env = options.env ?? process.env;
  const nodeEnv = oneOf(
    env,
    'NODE_ENV',
    ['development', 'test', 'production'] as const,
    'development',
  );
  const dataDir = str(env, 'MCP_HUB_DATA_DIR') ?? '.mcp-hub';
  const databaseUrl = str(env, 'DATABASE_URL');

  const authProvider = oneOf(env, 'MCP_HUB_AUTH_PROVIDER', ['dev', 'clerk'] as const, 'dev');
  const clerkSecret = str(env, 'CLERK_SECRET_KEY');
  const clerkPublishable = str(env, 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
  if (authProvider === 'clerk' && (!clerkSecret || !clerkPublishable)) {
    throw HubError.badRequest(
      'MCP_HUB_AUTH_PROVIDER=clerk requires both CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.',
    );
  }
  if (authProvider === 'dev' && nodeEnv === 'production') {
    throw HubError.badRequest(
      'The dev auth provider cannot be used with NODE_ENV=production. Set MCP_HUB_AUTH_PROVIDER=clerk.',
    );
  }

  const llmProvider = oneOf(
    env,
    'MCP_HUB_LLM_PROVIDER',
    ['grounded', 'openrouter'] as const,
    'grounded',
  );
  const openRouterApiKey = str(env, 'OPENROUTER_API_KEY');
  if (llmProvider === 'openrouter' && !openRouterApiKey) {
    throw HubError.badRequest('MCP_HUB_LLM_PROVIDER=openrouter requires OPENROUTER_API_KEY.');
  }

  const rawKey = str(env, 'MCP_HUB_ENCRYPTION_KEY');
  let encryptionKey: Buffer;
  let encryptionKeySource: 'env' | 'generated-dev-key';
  if (rawKey) {
    encryptionKey = Buffer.from(rawKey, 'base64');
    if (encryptionKey.length !== 32) {
      throw HubError.badRequest(
        'MCP_HUB_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 of 32 random bytes).',
      );
    }
    encryptionKeySource = 'env';
  } else {
    if (nodeEnv === 'production') {
      throw HubError.badRequest('MCP_HUB_ENCRYPTION_KEY is required when NODE_ENV=production.');
    }
    const resolver = options.resolveDevEncryptionKey;
    if (!resolver) {
      throw HubError.badRequest(
        'MCP_HUB_ENCRYPTION_KEY is unset and no development key resolver was provided.',
      );
    }
    encryptionKey = resolver(dataDir);
    encryptionKeySource = 'generated-dev-key';
  }

  const stdioCommands = (
    str(env, 'MCP_HUB_STDIO_ALLOWED_COMMANDS') ?? 'node,npx,python3,uvx,deno,bun'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return Object.freeze({
    nodeEnv,
    appUrl: str(env, 'NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000',
    logLevel: str(env, 'LOG_LEVEL') ?? 'info',
    dataDir,
    database: Object.freeze({
      driver: (databaseUrl ? 'postgres' : 'pglite') as DatabaseDriverName,
      url: databaseUrl,
      directUrl: str(env, 'DIRECT_URL') ?? databaseUrl,
      embeddedPath: `${dataDir}/postgres`,
      poolSize: int(env, 'MCP_HUB_DB_POOL_SIZE', 10),
      statementTimeoutMs: int(env, 'MCP_HUB_DB_STATEMENT_TIMEOUT_MS', 15_000),
    }),
    auth: Object.freeze({
      provider: authProvider,
      clerkSecretKey: clerkSecret,
      clerkPublishableKey: clerkPublishable,
    }),
    security: Object.freeze({
      encryptionKey,
      encryptionKeySource,
      allowStdioTransport: bool(env, 'MCP_HUB_ALLOW_STDIO', false),
      stdioAllowedCommands: Object.freeze(stdioCommands),
      allowPrivateNetwork: bool(env, 'MCP_HUB_ALLOW_PRIVATE_NETWORK', false),
      maxToolPayloadBytes: int(env, 'MCP_HUB_MAX_PAYLOAD_BYTES', 1_048_576),
      outboundTimeoutMs: int(env, 'MCP_HUB_OUTBOUND_TIMEOUT_MS', 20_000),
    }),
    queue: Object.freeze({
      driver: oneOf(env, 'MCP_HUB_QUEUE_DRIVER', ['database', 'redis'] as const, 'database'),
      redisUrl: str(env, 'REDIS_URL'),
      pollIntervalMs: int(env, 'MCP_HUB_QUEUE_POLL_MS', 2_000),
      concurrency: int(env, 'MCP_HUB_QUEUE_CONCURRENCY', 4),
    }),
    llm: Object.freeze({
      provider: llmProvider,
      openRouterApiKey,
      model: str(env, 'MCP_HUB_LLM_MODEL') ?? 'anthropic/claude-sonnet-5',
    }),
    rateLimit: Object.freeze({
      windowMs: int(env, 'MCP_HUB_RATE_WINDOW_MS', 60_000),
      maxRequests: int(env, 'MCP_HUB_RATE_MAX_REQUESTS', 300),
      maxToolExecutions: int(env, 'MCP_HUB_RATE_MAX_TOOL_EXECUTIONS', 30),
    }),
  });
}
