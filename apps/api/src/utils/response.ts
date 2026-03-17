import type { AppError } from './errors.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PaginationMeta {
  limit: number;
  has_more: boolean;
  next_cursor?: string;
  total?: number;
}

export interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Wrap a successful payload in the standard API envelope.
 *
 * ```ts
 * reply.send(success(rows, { limit: 25, has_more: true, next_cursor: '…' }));
 * ```
 */
export function success<T>(data: T, meta?: PaginationMeta): ApiResponse<T> {
  const response: ApiResponse<T> = { data };
  if (meta) {
    response.meta = meta;
  }
  return response;
}

/**
 * Wrap an `AppError` in the standard error envelope.
 *
 * ```ts
 * reply.status(err.statusCode).send(error(err));
 * ```
 */
export function error(err: AppError): ApiError {
  const payload: ApiError = {
    error: {
      code: err.code,
      message: err.message,
    },
  };

  if (err.details !== undefined) {
    payload.error.details = err.details;
  }

  return payload;
}
