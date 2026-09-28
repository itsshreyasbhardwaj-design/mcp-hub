import { describe, expect, it, vi } from 'vitest';
import { MCPHub } from '../client.js';
import {
  AuthenticationError,
  McpHubError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ValidationError,
  errorFromResponse,
} from '../errors.js';

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_test', ...headers },
  });
}

const apiError = (code: string, message = 'nope', details?: Record<string, unknown>) => ({
  error: { code, message, requestId: 'req_test', ...(details ? { details } : {}) },
});

function hub(fetchImpl: typeof globalThis.fetch, options: Record<string, unknown> = {}) {
  return new MCPHub({
    apiKey: 'mch_test',
    baseUrl: 'https://hub.test',
    fetch: fetchImpl,
    maxRetries: 2,
    ...options,
  });
}

describe('construction', () => {
  it('refuses to start without an API key', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate misuse
    expect(() => new MCPHub({ apiKey: '' } as any)).toThrow(McpHubError);
  });

  it('sends the key and content type on every request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: [], nextCursor: null }));
    await hub(fetchMock).servers.list();

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer mch_test');
    expect(headers['user-agent']).toContain('@mcp-hub/sdk');
  });

  it('sends the organization header when one is configured', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {}));
    await hub(fetchMock, { organizationId: 'org_9' }).health.status();
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>)['x-organization-id']).toBe('org_9');
  });
});

describe('request building', () => {
  it('serialises array query parameters as repeats', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: [], nextCursor: null }));
    await hub(fetchMock).servers.list({ status: ['active', 'draft'], limit: 10 });

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.getAll('status')).toEqual(['active', 'draft']);
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('omits undefined parameters entirely', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: [], nextCursor: null }));
    await hub(fetchMock).servers.list({ q: undefined });
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.search).toBe('');
  });

  it('escapes a slug in the path', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {}));
    await hub(fetchMock).servers.get('weird/slug');
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.pathname).toBe('/api/v1/servers/weird%2Fslug');
  });

  it('returns undefined for 204 responses', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(hub(fetchMock).servers.delete('x')).resolves.toBeUndefined();
  });
});

describe('error mapping', () => {
  it.each([
    ['UNAUTHENTICATED', 401, AuthenticationError],
    ['FORBIDDEN', 403, PermissionError],
    ['APPROVAL_REQUIRED', 403, PermissionError],
    ['SERVER_NOT_FOUND', 404, NotFoundError],
    ['RATE_LIMITED', 429, RateLimitError],
    ['VALIDATION_FAILED', 422, ValidationError],
  ])('maps %s onto a catchable class', (code, status, expected) => {
    const error = errorFromResponse(status, apiError(code), 'req_test');
    expect(error).toBeInstanceOf(expected);
    expect(error.code).toBe(code);
    expect(error.requestId).toBe('req_test');
  });

  it('exposes validation issues', () => {
    const error = errorFromResponse(
      422,
      apiError('VALIDATION_FAILED', 'bad', { issues: [{ path: 'name', message: 'required' }] }),
      'req_test',
    ) as ValidationError;
    expect(error.issues).toEqual([{ path: 'name', message: 'required' }]);
  });

  it('exposes the rate-limit reset time', () => {
    const error = errorFromResponse(
      429,
      apiError('RATE_LIMITED', 'slow down', { resetAt: '2026-09-28T12:00:00.000Z' }),
      'req_test',
    ) as RateLimitError;
    expect(error.resetAt?.toISOString()).toBe('2026-09-28T12:00:00.000Z');
  });

  it('falls back to INTERNAL for an unparseable body', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>502</html>', { status: 502 }));
    await expect(hub(fetchMock, { maxRetries: 0 }).health.status()).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });
});

describe('retry policy', () => {
  it('retries a read on a transient failure', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls < 3
        ? jsonResponse(503, apiError('INTERNAL'))
        : jsonResponse(200, { status: 'ok' });
    });

    await expect(hub(fetchMock).health.status()).resolves.toMatchObject({ status: 'ok' });
    expect(calls).toBe(3);
  });

  it('does not retry a read on a client error', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return jsonResponse(404, apiError('SERVER_NOT_FOUND'));
    });

    await expect(hub(fetchMock).servers.get('nope')).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toBe(1);
  });

  it('never retries a tool execution, even on a transient failure', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return jsonResponse(503, apiError('INTERNAL'));
    });

    await expect(
      hub(fetchMock).tools.execute({ versionId: 'ver_1', toolName: 'delete_everything' }),
    ).rejects.toBeInstanceOf(McpHubError);
    // Replaying a destructive call is worse than failing it once.
    expect(calls).toBe(1);
  });

  it('never retries an approval decision', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return jsonResponse(503, apiError('INTERNAL'));
    });
    await expect(hub(fetchMock).approvals.decide('apr_1', 'approved')).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('gives up after maxRetries', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return jsonResponse(503, apiError('INTERNAL'));
    });
    await expect(hub(fetchMock, { maxRetries: 1 }).health.status()).rejects.toThrow();
    expect(calls).toBe(2);
  });
});

describe('pagination', () => {
  it('walks every page', async () => {
    const pages = [
      { data: [{ slug: 'a' }, { slug: 'b' }], nextCursor: 'c1' },
      { data: [{ slug: 'c' }], nextCursor: null },
    ];
    let index = 0;
    const fetchMock = vi.fn(async () => jsonResponse(200, pages[index++]));

    const client = hub(fetchMock);
    const slugs: string[] = [];
    for await (const server of client.paginate((cursor) => client.servers.list({ cursor }))) {
      slugs.push((server as { slug: string }).slug);
    }
    expect(slugs).toEqual(['a', 'b', 'c']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops immediately on an empty first page', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: [], nextCursor: null }));
    const client = hub(fetchMock);
    const seen: unknown[] = [];
    for await (const item of client.paginate((cursor) => client.servers.list({ cursor }))) {
      seen.push(item);
    }
    expect(seen).toEqual([]);
  });
});

describe('timeouts', () => {
  it('reports a timeout rather than hanging', async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matching the fetch signature
    ) as any;

    await expect(
      hub(fetchMock, { timeoutMs: 30, maxRetries: 0 }).health.status(),
    ).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
  });
});
