import { Worker, Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { createBullConnection } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';
import { QUEUE_NAMES } from '../queues.js';
import type { ScheduledJob } from '../jobs.js';

let worker: Worker<ScheduledJob> | null = null;

/**
 * Processes scheduled / cron jobs.
 *
 * TODO Sprint 2:
 * 1. Look up the handler function by job.handler name from a registry map
 * 2. If orgId is provided, scope the handler execution to that org
 * 3. If orgId is absent, run as a global / system-level job
 * 4. Execute the handler with appropriate error boundaries
 * 5. Log execution results in scheduled_job_runs table
 * 6. Emit events if the handler produces actionable output
 *    (e.g., overdue invoices detected -> enqueue notification jobs)
 */
async function processScheduledJob(job: Job<ScheduledJob>): Promise<{ success: boolean }> {
  const { name, handler, orgId } = job.data;

  logger.info(
    { jobId: job.id, name, handler, orgId },
    '[scheduled-worker] processing scheduled job',
  );

  // Stub: real implementation will dispatch to handler functions
  logger.info({ jobId: job.id }, '[scheduled-worker] job completed (stub)');
  return { success: true };
}

/**
 * Start the scheduled-jobs worker.
 * Call once during server bootstrap.
 */
export function startScheduledWorker(): Worker<ScheduledJob> {
  if (worker) return worker;

  const connection = createBullConnection() as ConnectionOptions;

  worker = new Worker<ScheduledJob>(
    QUEUE_NAMES.SCHEDULED,
    processScheduledJob,
    {
      connection,
      concurrency: 2,
    },
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job?.id }, '[scheduled-worker] job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err },
      '[scheduled-worker] job failed',
    );
  });

  worker.on('error', (err) => {
    logger.error({ err }, '[scheduled-worker] worker error');
  });

  logger.info('[scheduled-worker] started');
  return worker;
}

/**
 * Gracefully stop the scheduled-jobs worker.
 * Waits for the current job to finish before closing.
 */
export async function stopScheduledWorker(): Promise<void> {
  if (!worker) return;

  logger.info('[scheduled-worker] shutting down...');
  await worker.close();
  worker = null;
  logger.info('[scheduled-worker] stopped');
}
