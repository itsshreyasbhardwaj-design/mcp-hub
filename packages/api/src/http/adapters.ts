import { HubError } from '@mcp-hub/core';
import type { HttpMethod, HubRequest, HubResponse } from './types.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function parseCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) out.set(name, decodeURIComponent(value));
  }
  return out;
}

/** Converts a WHATWG Request (Next.js, Bun, Deno, workers) into a HubRequest. */
export async function fromWebRequest(request: Request): Promise<HubRequest> {
  const method = request.method.toUpperCase() as HttpMethod;
  let rawBody = '';
  let body: unknown;

  if (method !== 'GET' && method !== 'DELETE') {
    rawBody = await request.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      throw new HubError('PAYLOAD_TOO_LARGE', 'The request body exceeds 2 MiB.');
    }
    if (rawBody.trim().length > 0) {
      const contentType = request.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        throw HubError.badRequest('This endpoint accepts application/json only.');
      }
      try {
        body = JSON.parse(rawBody);
      } catch {
        throw HubError.badRequest('The request body is not valid JSON.');
      }
    }
  }

  return {
    method,
    url: new URL(request.url),
    headers: request.headers,
    cookies: parseCookies(request.headers.get('cookie')),
    body,
    rawBody,
    params: {},
    ip:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      null,
  };
}

export function toWebResponse(response: HubResponse): Response {
  if (response.status === 204 || response.body === null) {
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: response.headers,
  });
}
