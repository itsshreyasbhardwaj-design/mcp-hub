/**
 * Keys whose values are never written to a log line, an audit record or an
 * error payload. Matching is case-insensitive and substring based, because
 * upstream servers name their fields inconsistently.
 */
const SECRET_KEY_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'accesskey',
  'access_key',
  'authorization',
  'auth',
  'credential',
  'privatekey',
  'private_key',
  'sessiontoken',
  'sessionid',
  'sessionsecret',
  'sessionkey',
  'cookie',
  'signature',
  'bearer',
  'clientsecret',
  'client_secret',
  'encryption',
  'salt',
  'otp',
  'pin',
];

/** Values that look like credentials regardless of the key they sit under. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI / OpenRouter style
  /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/g, // Clerk / Stripe style
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\bmch_[A-Za-z0-9_-]{24,}\b/g, // MCP Hub API keys
  /postgres(?:ql)?:\/\/[^\s"']+/gi,
  /redis(?:s)?:\/\/[^\s"']+/gi,
];

export const REDACTED = '[redacted]';

export function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z_]/g, '');
  return SECRET_KEY_PATTERNS.some((p) => normalized.includes(p.replace(/[^a-z_]/g, '')));
}

export function redactString(value: string): string {
  let out = value;
  for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

/**
 * Deep-redacts a structure. Cycles are broken, depth is bounded and long
 * strings are truncated so a hostile MCP server cannot blow up the log volume.
 */
export function redact(value: unknown, maxDepth = 6, maxStringLength = 2000): unknown {
  return walk(value, maxDepth, maxStringLength, new WeakSet());
}

function walk(
  value: unknown,
  depth: number,
  maxStringLength: number,
  seen: WeakSet<object>,
): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    const redacted = redactString(value);
    return redacted.length > maxStringLength
      ? `${redacted.slice(0, maxStringLength)}…[truncated ${redacted.length - maxStringLength}]`
      : redacted;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (typeof value !== 'object') return String(value);
  if (depth <= 0) return '[depth-limit]';
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    const limited = value.slice(0, 100).map((v) => walk(v, depth - 1, maxStringLength, seen));
    if (value.length > 100) limited.push(`[+${value.length - 100} more]`);
    return limited;
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) ? REDACTED : walk(child, depth - 1, maxStringLength, seen);
  }
  return out;
}
