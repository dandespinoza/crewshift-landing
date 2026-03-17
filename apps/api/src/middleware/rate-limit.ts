import type { RateLimitPluginOptions } from '@fastify/rate-limit';

// ── Per-category rate-limit configurations ──────────────────────────────────
//
// These are expressed as { max, timeWindow } pairs where `max` is the number
// of allowed requests inside the `timeWindow` (in milliseconds or shorthand).
// All limits are **per IP** by default; the server-level plugin configuration
// can override the key generator to use `request.userId` for authenticated
// routes.

export interface RateLimitConfig {
  /** Maximum number of requests in the window. */
  max: number;
  /** Window duration in ms. */
  timeWindow: number;
}

/** Auth endpoints: login, signup, password reset, etc. */
export const AUTH_LIMIT: RateLimitConfig = {
  max: 10,
  timeWindow: 60_000, // 1 min
};

/** AI copilot — limits vary by subscription plan. */
export const COPILOT_LIMITS: Record<string, RateLimitConfig> = {
  starter: { max: 10, timeWindow: 60_000 },
  pro: { max: 30, timeWindow: 60_000 },
  business: { max: 60, timeWindow: 60_000 },
};

/** Standard read / list endpoints. */
export const READ_LIMIT: RateLimitConfig = {
  max: 120,
  timeWindow: 60_000,
};

/** Mutation endpoints: create, update, delete. */
export const WRITE_LIMIT: RateLimitConfig = {
  max: 30,
  timeWindow: 60_000,
};

/** Inbound webhook receivers (Stripe, QuickBooks, etc.). */
export const WEBHOOK_LIMIT: RateLimitConfig = {
  max: 500,
  timeWindow: 60_000,
};

/** File upload endpoints. */
export const UPLOAD_LIMIT: RateLimitConfig = {
  max: 10,
  timeWindow: 60_000,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a Fastify route-level `config.rateLimit` object from one of
 * the predefined category configs above.
 *
 * ```ts
 * app.get('/jobs', {
 *   config: { rateLimit: createRouteRateLimit(READ_LIMIT) },
 *   preHandler: [authMiddleware],
 * }, listJobsHandler);
 * ```
 */
export function createRouteRateLimit(
  config: RateLimitConfig,
): RateLimitPluginOptions {
  return {
    max: config.max,
    timeWindow: config.timeWindow,
  };
}

/**
 * Build the **global** rate-limit plugin options.
 *
 * These serve as the server-wide default; individual routes can override
 * them with their own `config.rateLimit` values.
 */
export function createGlobalRateLimit(): RateLimitPluginOptions {
  return {
    max: READ_LIMIT.max,
    timeWindow: READ_LIMIT.timeWindow,
    // Return a standard JSON error envelope on limit breach
    errorResponseBuilder: (_request, context) => ({
      error: {
        code: 'RATE_LIMITED',
        message: `Rate limit exceeded — retry after ${Math.ceil(context.ttl / 1000)}s`,
      },
    }),
  };
}
