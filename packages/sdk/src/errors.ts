/** Error codes the API can return. Kept in sync with the server's taxonomy. */
export type McpHubErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'SERVER_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'TOOL_NOT_FOUND'
  | 'CONFLICT'
  | 'VERSION_IMMUTABLE'
  | 'SLUG_TAKEN'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'APPROVAL_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'TRANSPORT_BLOCKED'
  | 'UPSTREAM_ERROR'
  | 'UPSTREAM_TIMEOUT'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL';

/** Base class for every error the SDK raises, so `catch` can be narrow. */
export class McpHubError extends Error {
  readonly code: McpHubErrorCode;
  readonly status: number;
  readonly requestId: string | null;
  readonly details: Record<string, unknown> | undefined;

  constructor(options: {
    code: McpHubErrorCode;
    message: string;
    status: number;
    requestId?: string | null;
    details?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = 'McpHubError';
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId ?? null;
    this.details = options.details;
  }
}

export class AuthenticationError extends McpHubError {
  constructor(message: string, requestId?: string | null) {
    super({ code: 'UNAUTHENTICATED', message, status: 401, requestId: requestId ?? null });
    this.name = 'AuthenticationError';
  }
}

export class PermissionError extends McpHubError {
  constructor(
    code: 'FORBIDDEN' | 'PERMISSION_DENIED' | 'APPROVAL_REQUIRED',
    message: string,
    requestId?: string | null,
    details?: Record<string, unknown>,
  ) {
    super({
      code,
      message,
      status: 403,
      requestId: requestId ?? null,
      ...(details ? { details } : {}),
    });
    this.name = 'PermissionError';
  }
}

export class RateLimitError extends McpHubError {
  /** When the current rate-limit window resets, when the server reported it. */
  readonly resetAt: Date | null;
  constructor(message: string, requestId?: string | null, resetAt?: string | null) {
    super({ code: 'RATE_LIMITED', message, status: 429, requestId: requestId ?? null });
    this.name = 'RateLimitError';
    this.resetAt = resetAt ? new Date(resetAt) : null;
  }
}

export class NotFoundError extends McpHubError {
  constructor(code: McpHubErrorCode, message: string, requestId?: string | null) {
    super({ code, message, status: 404, requestId: requestId ?? null });
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends McpHubError {
  readonly issues: Array<{ path: string; message: string }>;
  constructor(
    message: string,
    issues: Array<{ path: string; message: string }>,
    requestId?: string | null,
  ) {
    super({ code: 'VALIDATION_FAILED', message, status: 422, requestId: requestId ?? null });
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    details?: Record<string, unknown>;
  };
}

/** Maps an error response onto the most specific error class available. */
export function errorFromResponse(
  status: number,
  body: unknown,
  requestId: string | null,
): McpHubError {
  const payload = (body ?? {}) as ApiErrorBody;
  const code = (payload.error?.code ?? 'INTERNAL') as McpHubErrorCode;
  const message = payload.error?.message ?? `The request failed with status ${status}.`;
  const details = payload.error?.details;

  switch (code) {
    case 'UNAUTHENTICATED':
      return new AuthenticationError(message, requestId);
    case 'FORBIDDEN':
    case 'PERMISSION_DENIED':
    case 'APPROVAL_REQUIRED':
      return new PermissionError(code, message, requestId, details);
    case 'RATE_LIMITED':
      return new RateLimitError(message, requestId, (details?.['resetAt'] as string) ?? null);
    case 'NOT_FOUND':
    case 'SERVER_NOT_FOUND':
    case 'VERSION_NOT_FOUND':
    case 'TOOL_NOT_FOUND':
      return new NotFoundError(code, message, requestId);
    case 'VALIDATION_FAILED':
      return new ValidationError(
        message,
        (details?.['issues'] as Array<{ path: string; message: string }>) ?? [],
        requestId,
      );
    default:
      return new McpHubError({
        code,
        message,
        status,
        requestId,
        ...(details ? { details } : {}),
      });
  }
}
