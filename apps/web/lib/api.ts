'use client';

/**
 * Browser-side API access.
 *
 * Client components never touch a repository. They call the same REST API an
 * external consumer would, over the session cookie, which means every
 * interactive action in the dashboard is subject to exactly the same
 * authorisation checks as an API key.
 */
export interface ApiErrorShape {
  code: string;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, payload: ApiErrorShape) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code;
    this.requestId = payload.requestId;
    this.details = payload.details;
  }
}

export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  // This is browser code calling our own same-origin API; the restriction
  // guards server-side egress, which is a different concern.
  // eslint-disable-next-line no-restricted-globals
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    credentials: 'same-origin',
  });

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const shape = (payload as { error?: ApiErrorShape } | null)?.error;
    throw new ApiError(
      response.status,
      shape ?? { code: 'INTERNAL', message: 'The request failed.', requestId: 'unknown' },
    );
  }
  return payload as T;
}
