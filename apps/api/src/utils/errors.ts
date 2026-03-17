/**
 * Structured application error hierarchy.
 *
 * Every error carries a numeric HTTP `statusCode`, a machine-readable `code`
 * string, a human-readable `message`, and an optional `details` payload
 * (typically Zod validation issues).
 */

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — request body / query / params failed validation */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

/** 401 — missing or invalid authentication token */
export class AuthError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'AUTH_REQUIRED', message);
    this.name = 'AuthError';
  }
}

/** 403 — authenticated but not authorised for this action */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
    this.name = 'ForbiddenError';
  }
}

/** 404 — requested resource does not exist */
export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

/** 409 — resource state conflict (e.g. duplicate key) */
export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(409, 'CONFLICT', message);
    this.name = 'ConflictError';
  }
}

/** 422 — semantically invalid even though syntactically correct */
export class UnprocessableError extends AppError {
  constructor(message = 'Unprocessable entity', details?: unknown) {
    super(422, 'UNPROCESSABLE', message, details);
    this.name = 'UnprocessableError';
  }
}

/** 429 — rate limit exceeded */
export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded') {
    super(429, 'RATE_LIMITED', message);
    this.name = 'RateLimitError';
  }
}

/** 503 — AI / ML service temporarily unavailable */
export class AIUnavailableError extends AppError {
  constructor(message = 'AI service unavailable') {
    super(503, 'AI_UNAVAILABLE', message);
    this.name = 'AIUnavailableError';
  }
}
