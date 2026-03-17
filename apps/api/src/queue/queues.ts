import { Queue } from 'bullmq';
import type { ConnectionOptions, QueueOptions } from 'bullmq';
import { createBullConnection } from '../config/redis.js';
import { logger } from '../utils/logger.js';

// ── Queue Name Constants ──────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  AGENT_EXECUTION: 'agent-execution',
  INTEGRATION_SYNC: 'integration-sync',
  NOTIFICATION: 'notification',
  SCHEDULED: 'scheduled',
  PDF_GENERATION: 'pdf-generation',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ── Default Job Options Per Queue ─────────────────────────────────────────────

const QUEUE_CONFIGS: Record<QueueName, QueueOptions['defaultJobOptions']> = {
  [QUEUE_NAMES.AGENT_EXECUTION]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800 },
  },

  [QUEUE_NAMES.INTEGRATION_SYNC]: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800 },
  },

  [QUEUE_NAMES.NOTIFICATION]: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 1_000 },
    removeOnComplete: { age: 86_400, count: 5_000 },
    removeOnFail: { age: 604_800 },
  },

  [QUEUE_NAMES.SCHEDULED]: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 60_000 },
    removeOnComplete: { age: 86_400, count: 500 },
    removeOnFail: { age: 604_800 },
  },

  [QUEUE_NAMES.PDF_GENERATION]: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 3_000 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800 },
  },
};

// ── Lazy Singleton Map ────────────────────────────────────────────────────────

let queues: Map<QueueName, Queue> | null = null;

/**
 * Returns a `Map` of all CrewShift queues, lazily creating them on first call.
 * Each queue gets its own Redis connection (BullMQ best-practice).
 */
export function getQueues(): Map<QueueName, Queue> {
  if (queues) return queues;

  queues = new Map();

  for (const name of Object.values(QUEUE_NAMES)) {
    const connection = createBullConnection() as ConnectionOptions;
    const queue = new Queue(name, {
      connection,
      defaultJobOptions: QUEUE_CONFIGS[name],
    });

    queue.on('error', (err) => {
      logger.error({ queue: name, err }, `[queue:${name}] error`);
    });

    queues.set(name, queue);
    logger.info(`[queue] registered queue "${name}"`);
  }

  return queues;
}

/**
 * Convenience helper to retrieve a single queue by name.
 */
export function getQueue(name: QueueName): Queue {
  const q = getQueues().get(name);
  if (!q) throw new Error(`Queue "${name}" not found`);
  return q;
}

/**
 * Gracefully close all queue connections.
 * Call this during server shutdown.
 */
export async function closeQueues(): Promise<void> {
  if (!queues) return;

  const closing = [...queues.entries()].map(async ([name, queue]) => {
    try {
      await queue.close();
      logger.info(`[queue] closed "${name}"`);
    } catch (err) {
      logger.error({ queue: name, err }, `[queue] error closing "${name}"`);
    }
  });

  await Promise.allSettled(closing);
  queues = null;
  logger.info('[queue] all queues closed');
}
