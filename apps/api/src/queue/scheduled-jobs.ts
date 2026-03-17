import { logger } from '../utils/logger.js';
import { getQueue, QUEUE_NAMES } from './queues.js';
import type { ScheduledJob } from './jobs.js';

// ── Scheduled Job Definitions ─────────────────────────────────────────────────

interface ScheduledJobDefinition {
  /** Human-readable name used as the BullMQ repeatable job key. */
  name: string;
  /** The handler function name that the scheduled worker dispatches to. */
  handler: string;
  /** Cron expression (UTC). */
  cron: string;
}

const SCHEDULED_JOBS: ScheduledJobDefinition[] = [
  {
    name: 'invoice-overdue-detection',
    handler: 'invoiceOverdueDetection',
    cron: '0 9 * * *', // daily at 09:00 UTC
  },
  {
    name: 'compliance-deadline-check',
    handler: 'complianceDeadlineCheck',
    cron: '0 9 * * *', // daily at 09:00 UTC
  },
  {
    name: 'inventory-low-stock-check',
    handler: 'inventoryLowStockCheck',
    cron: '0 9 * * *', // daily at 09:00 UTC
  },
  {
    name: 'token-refresh',
    handler: 'tokenRefresh',
    cron: '0 */4 * * *', // every 4 hours
  },
  {
    name: 'data-anonymization',
    handler: 'dataAnonymization',
    cron: '0 2 * * *', // daily at 02:00 UTC
  },
  {
    name: 'weekly-digest',
    handler: 'weeklyDigest',
    cron: '0 9 * * 1', // every Monday at 09:00 UTC
  },
  {
    name: 'conversation-summarization',
    handler: 'conversationSummarization',
    cron: '0 3 * * 0', // every Sunday at 03:00 UTC
  },
  {
    name: 'daily-digest',
    handler: 'dailyDigest',
    cron: '0 8 * * *', // daily at 08:00 UTC
  },
  {
    name: 'collections-followup',
    handler: 'collectionsFollowup',
    cron: '0 10 * * *', // daily at 10:00 UTC
  },
];

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Registers all repeatable (cron) jobs on the `scheduled` queue.
 *
 * BullMQ de-duplicates repeatable jobs by their repeat key, so calling this
 * function multiple times (e.g. across server restarts) is safe and idempotent.
 */
export async function registerScheduledJobs(): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.SCHEDULED);

  for (const def of SCHEDULED_JOBS) {
    const jobData: ScheduledJob = {
      name: def.name,
      handler: def.handler,
    };

    await queue.add(def.name, jobData, {
      repeat: { pattern: def.cron },
      jobId: def.name, // stable ID for de-duplication
    });

    logger.info(
      { job: def.name, cron: def.cron },
      `[scheduled-jobs] registered "${def.name}"`,
    );
  }

  logger.info(
    `[scheduled-jobs] ${SCHEDULED_JOBS.length} repeatable jobs registered`,
  );
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

/**
 * Removes all repeatable jobs from the `scheduled` queue.
 * Useful for tests or when tearing down the scheduler.
 */
export async function clearScheduledJobs(): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.SCHEDULED);
  const repeatableJobs = await queue.getRepeatableJobs();

  for (const rj of repeatableJobs) {
    await queue.removeRepeatableByKey(rj.key);
    logger.info(
      { job: rj.name, key: rj.key },
      `[scheduled-jobs] removed repeatable job "${rj.name}"`,
    );
  }

  logger.info('[scheduled-jobs] all repeatable jobs cleared');
}
