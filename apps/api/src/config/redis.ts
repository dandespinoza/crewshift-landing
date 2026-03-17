import Redis from 'ioredis';
import type { ConnectionOptions } from 'bullmq';
import { env } from './env.js';

/**
 * Shared Redis instance for caching, pub/sub, and general key-value usage.
 *
 * Connections are lazy — the socket is established on first command.
 * The `maxRetriesPerRequest` is set to `null` for BullMQ compatibility
 * (BullMQ requires it to be null so it can handle retries itself).
 */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy(times: number) {
    // Exponential backoff capped at 10 s
    const delay = Math.min(times * 200, 10_000);
    return delay;
  },
});

redis.on('error', (err) => {
  console.error('[redis] connection error:', err.message);
});

redis.on('connect', () => {
  console.log('[redis] connected');
});

/**
 * Returns connection options suitable for BullMQ `Queue` / `Worker`
 * constructors.  Each BullMQ entity should use its own connection, so this
 * function creates a **new** Redis instance every time it is called.
 */
export function createBullConnection(): ConnectionOptions {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 10_000);
      return delay;
    },
  }) as any;
}
