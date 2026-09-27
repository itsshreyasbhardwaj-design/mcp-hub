/**
 * Machine-readable error codes. These are part of the public API contract:
 * clients switch on `error.code`, never on the message text.
 */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'SERVER_NOT_FOUND',
  'VERSION_NOT_FOUND',
  'TOOL_NOT_FOUND',
  'CONFLICT',
  'VERSION_IMMUTABLE',
  'SLUG_TAKEN',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'APPROVAL_REQUIRED',
  'PERMISSION_DENIED',
  'TRANSPORT_BLOCKED',
  'UPSTREAM_ERROR',
  'UPSTREAM_TIMEOUT',
  'NOT_IMPLEMENTED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SERVER_NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,
  TOOL_NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_IMMUTABLE: 409,
  SLUG_TAKEN: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  APPROVAL_REQUIRED: 403,
  PERMISSION_DENIED: 403,
  TRANSPORT_BLOCKED: 400,
  UPSTREAM_ERROR: 502,
  UPSTREAM_TIMEOUT: 504,
  NOT_IMPLEMENTED: 501,
  INTERNAL: 500,
};

export interface HubErrorOptions {
  /** Structured, non-sensitive detail surfaced to API clients. */
  details?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * The single error type crossing service boundaries. Anything else that reaches
 * the HTTP layer is reported as INTERNAL with the stack kept server-side.
 */
export class HubError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, options: HubErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'HubError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details;
  }

  static badRequest(message: string, details?: Record<string, unknown>): HubError {
    return new HubError('BAD_REQUEST', message, { details });
  }
  static notFound(message: string, details?: Record<string, unknown>): HubError {
    return new HubError('NOT_FOUND', message, { details });
  }
  static forbidden(message: string, details?: Record<string, unknown>): HubError {
    return new HubError('FORBIDDEN', message, { details });
  }
  static unauthenticated(message = 'Authentication is required.'): HubError {
    return new HubError('UNAUTHENTICATED', message);
  }
  static conflict(message: string, details?: Record<string, unknown>): HubError {
    return new HubError('CONFLICT', message, { details });
  }
  static internal(message = 'An unexpected error occurred.', cause?: unknown): HubError {
    return new HubError('INTERNAL', message, { cause });
  }
}

export function isHubError(value: unknown): value is HubError {
  return value instanceof HubError;
}

/** Wire format for every non-2xx API response. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Converts any thrown value into a client-safe payload. Unknown errors are
 * flattened to INTERNAL so stack traces and driver messages never leak.
 */
export function toApiError(err: unknown, requestId: string): ApiErrorBody {
  if (isHubError(err)) {
    return {
      error: {
        code: err.code,
        message: err.message,
        requestId,
        ...(err.details ? { details: err.details } : {}),
      },
    };
  }
  return {
    error: { code: 'INTERNAL', message: 'An unexpected error occurred.', requestId },
  };
}
