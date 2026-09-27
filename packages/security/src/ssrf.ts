import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { HubError } from '@mcp-hub/core';

/**
 * Outbound request guard.
 *
 * MCP Hub connects to endpoints that users supply, which makes every remote
 * transport a server-side request forgery primitive unless it is fenced off.
 * The rules below are deliberately deny-by-default: a URL must clear scheme,
 * port, hostname and *resolved address* checks, and the address is re-checked
 * on every redirect hop to defeat DNS rebinding.
 */

export interface SsrfPolicy {
  /** Permit loopback and RFC1918 targets. Only ever true in local dev. */
  allowPrivateNetwork: boolean;
  allowedSchemes?: readonly string[];
  /** When set, only these hostnames are reachable at all. */
  hostAllowlist?: readonly string[];
  maxRedirects?: number;
}

export const DEFAULT_ALLOWED_SCHEMES = ['https:', 'http:'] as const;

/** Ports commonly bound by internal infrastructure; blocked outright. */
const BLOCKED_PORTS = new Set([
  22, 23, 25, 110, 143, 445, 993, 995, 1433, 1521, 2049, 2375, 2376, 3306, 5432, 5984, 6379, 6380,
  8086, 9042, 9200, 9300, 11211, 27017, 27018, 50070,
]);

/** Cloud metadata endpoints. Reaching these is instant credential theft. */
const METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  '100.100.100.200',
  'fd00:ec2::254',
]);

export function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // Unparseable means "do not trust".
  }
  const [a = 0, b = 0] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

export function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(normalized)) return true; // unique local
  // IPv4-mapped (::ffff:a.b.c.d) inherits the IPv4 verdict.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
  return false;
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true;
}

export interface UrlCheckResult {
  url: URL;
  /** Addresses the hostname resolved to at check time. */
  addresses: string[];
}

/**
 * Validates a URL against the policy, including DNS resolution. Throws
 * `TRANSPORT_BLOCKED` with a specific reason rather than a generic failure,
 * because operators need to know *why* an endpoint was refused.
 */
export async function assertUrlAllowed(
  rawUrl: string,
  policy: SsrfPolicy,
  resolver: (host: string) => Promise<string[]> = defaultResolver,
): Promise<UrlCheckResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HubError('TRANSPORT_BLOCKED', 'The endpoint is not a valid absolute URL.', {
      details: { url: rawUrl },
    });
  }

  const schemes = policy.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;
  if (!schemes.includes(url.protocol)) {
    throw new HubError(
      'TRANSPORT_BLOCKED',
      `Scheme "${url.protocol}" is not permitted for MCP endpoints.`,
      { details: { allowed: schemes } },
    );
  }

  if (url.username || url.password) {
    throw new HubError('TRANSPORT_BLOCKED', 'Credentials embedded in the URL are not permitted.');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (METADATA_HOSTS.has(hostname)) {
    throw new HubError('TRANSPORT_BLOCKED', 'Cloud metadata endpoints are never reachable.');
  }

  if (policy.hostAllowlist && policy.hostAllowlist.length > 0) {
    const allowed = policy.hostAllowlist.some(
      (entry) => hostname === entry.toLowerCase() || hostname.endsWith(`.${entry.toLowerCase()}`),
    );
    if (!allowed) {
      throw new HubError('TRANSPORT_BLOCKED', `Host "${hostname}" is not on the allowlist.`, {
        details: { hostname },
      });
    }
  }

  const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80;
  if (BLOCKED_PORTS.has(port)) {
    throw new HubError('TRANSPORT_BLOCKED', `Port ${port} is not permitted for MCP endpoints.`, {
      details: { port },
    });
  }

  const addresses = isIP(hostname) ? [hostname] : await resolver(hostname);
  if (addresses.length === 0) {
    throw new HubError('TRANSPORT_BLOCKED', `Host "${hostname}" did not resolve.`, {
      details: { hostname },
    });
  }

  if (!policy.allowPrivateNetwork) {
    const blocked = addresses.filter((address) => isPrivateAddress(address));
    if (blocked.length > 0) {
      throw new HubError(
        'TRANSPORT_BLOCKED',
        `Host "${hostname}" resolves to a private or loopback address. ` +
          'Set MCP_HUB_ALLOW_PRIVATE_NETWORK=true only for local development.',
        { details: { hostname, addresses: blocked } },
      );
    }
  }

  return { url, addresses };
}

async function defaultResolver(host: string): Promise<string[]> {
  try {
    const results = await lookup(host, { all: true, verbatim: true });
    return results.map((r) => r.address);
  } catch {
    return [];
  }
}

export interface SafeFetchOptions extends Omit<RequestInit, 'redirect' | 'signal'> {
  policy: SsrfPolicy;
  timeoutMs: number;
  /** Aborts the read once this many bytes have arrived. */
  maxBytes: number;
  resolver?: (host: string) => Promise<string[]>;
}

export interface SafeFetchResult {
  status: number;
  headers: Headers;
  body: string;
  truncated: boolean;
}

/**
 * The only outbound HTTP entry point in the codebase. Redirects are followed
 * manually so that every hop is re-validated, the body is size-capped, and the
 * whole exchange is time-bounded.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const maxRedirects = options.policy.maxRedirects ?? 3;
  let currentUrl = rawUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const checked = await assertUrlAllowed(currentUrl, options.policy, options.resolver);
      const { policy: _policy, timeoutMs: _timeoutMs, maxBytes, resolver: _resolver, ...init } = options;

      const response = await globalThis.fetch(checked.url, {
        ...init,
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new HubError('UPSTREAM_ERROR', 'Upstream returned a redirect without a location.');
        }
        currentUrl = new URL(location, checked.url).toString();
        continue;
      }

      const { body, truncated } = await readCapped(response, maxBytes);
      return { status: response.status, headers: response.headers, body, truncated };
    }
    throw new HubError('TRANSPORT_BLOCKED', `Exceeded ${maxRedirects} redirects.`);
  } catch (err) {
    if (err instanceof HubError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HubError('UPSTREAM_TIMEOUT', `Request timed out after ${options.timeoutMs}ms.`);
    }
    throw new HubError('UPSTREAM_ERROR', 'The upstream request failed.', { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ body: string; truncated: boolean }> {
  if (!response.body) return { body: '', truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      chunks.push(value.slice(0, Math.max(0, value.byteLength - (total - maxBytes))));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }

  return { body: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'), truncated };
}
