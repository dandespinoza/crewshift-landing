import { Worker, Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { createBullConnection } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';
import { QUEUE_NAMES } from '../queues.js';
import type { NotificationJob } from '../jobs.js';

let worker: Worker<NotificationJob> | null = null;

/**
 * Processes notification jobs.
 *
 * TODO Sprint 2:
 * 1. Route to the correct channel handler based on job.channel:
 *    - in_app: Insert into notifications table for real-time delivery
 *    - email:  Send via Resend (transactional email provider)
 *    - sms:    Send via Twilio
 *    - push:   Send via web-push / FCM
 * 2. Check user notification preferences before sending
 * 3. Rate-limit per user/channel to prevent notification fatigue
 * 4. Record delivery status in notification_logs table
 */
async function processNotification(job: Job<NotificationJob>): Promise<{ success: boolean }> {
  const { orgId, userId, type, channel, title } = job.data;

  logger.info(
    { jobId: job.id, orgId, userId, type, channel, title },
    '[notification-worker] processing notification',
  );

  // Stub: real implementation will route to email/SMS/push/in-app
  logger.info({ jobId: job.id }, '[notification-worker] job completed (stub)');
  return { success: true };
}

/**
 * Start the notification worker.
 * Call once during server bootstrap.
 */
export function startNotificationWorker(): Worker<NotificationJob> {
  if (worker) return worker;

  const connection = createBullConnection() as ConnectionOptions;

  worker = new Worker<NotificationJob>(
    QUEUE_NAMES.NOTIFICATION,
    processNotification,
    {
      connection,
      concurrency: 10,
    },
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job?.id }, '[notification-worker] job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err },
      '[notification-worker] job failed',
    );
  });

  worker.on('error', (err) => {
    logger.error({ err }, '[notification-worker] worker error');
  });

  logger.info('[notification-worker] started');
  return worker;
}

/**
 * Gracefully stop the notification worker.
 * Waits for the current job to finish before closing.
 */
export async function stopNotificationWorker(): Promise<void> {
  if (!worker) return;

  logger.info('[notification-worker] shutting down...');
  await worker.close();
  worker = null;
  logger.info('[notification-worker] stopped');
}
