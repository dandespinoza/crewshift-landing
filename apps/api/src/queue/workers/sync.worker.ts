import { Worker, Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { createBullConnection } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';
import { QUEUE_NAMES } from '../queues.js';
import type { IntegrationSyncJob } from '../jobs.js';
import { runSync } from '../../integrations/sync.service.js';
import { eventBus } from '../../agents/event-bus.js';
import { supabaseAdmin } from '../../config/supabase.js';

let worker: Worker<IntegrationSyncJob> | null = null;

/**
 * Processes integration sync jobs.
 *
 * 1. Resolves the integration adapter for the given provider (via registry)
 * 2. Calls runSync() which handles token decryption, adapter calls, DB upserts
 * 3. Emits events for downstream agents if data changed
 * 4. Updates integration status back to 'connected' after sync
 */
async function processIntegrationSync(job: Job<IntegrationSyncJob>): Promise<{ success: boolean }> {
  const { orgId, provider, syncType } = job.data;

  logger.info(
    { jobId: job.id, orgId, provider, syncType },
    '[sync-worker] processing integration sync',
  );

  try {
    // Update integration status to 'syncing'
    await supabaseAdmin
      .from('integrations')
      .update({ status: 'syncing' })
      .eq('org_id', orgId)
      .eq('provider', provider);

    // Run the sync
    const summary = await runSync({
      orgId,
      provider,
      syncType: syncType === 'webhook' ? 'incremental' : syncType,
    });

    logger.info(
      { jobId: job.id, orgId, provider, summary },
      '[sync-worker] job completed successfully',
    );

    return { success: true };
  } catch (err) {
    logger.error(
      { jobId: job.id, orgId, provider, err },
      '[sync-worker] job failed',
    );

    // Update integration status back to 'connected' (not 'syncing')
    await supabaseAdmin
      .from('integrations')
      .update({ status: 'connected' })
      .eq('org_id', orgId)
      .eq('provider', provider);

    // Create a failed sync_log entry
    await supabaseAdmin.from('sync_logs').insert({
      org_id: orgId,
      provider,
      sync_type: syncType,
      status: 'failed',
      direction: 'inbound',
      records_created: 0,
      records_updated: 0,
      records_skipped: 0,
      records_failed: 0,
      error_message: (err as Error).message,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 0,
    });

    // Emit failure event
    eventBus.emitEvent({
      type: 'integration.sync_failed',
      orgId,
      data: { provider, error: (err as Error).message },
      source: 'sync-worker',
      timestamp: new Date().toISOString(),
    });

    throw err; // Re-throw so BullMQ records it as failed and can retry
  }
}

/**
 * Start the integration-sync worker.
 * Call once during server bootstrap.
 */
export function startSyncWorker(): Worker<IntegrationSyncJob> {
  if (worker) return worker;

  const connection = createBullConnection() as ConnectionOptions;

  worker = new Worker<IntegrationSyncJob>(
    QUEUE_NAMES.INTEGRATION_SYNC,
    processIntegrationSync,
    {
      connection,
      concurrency: 3,
    },
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job?.id }, '[sync-worker] job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err },
      '[sync-worker] job failed',
    );
  });

  worker.on('error', (err) => {
    logger.error({ err }, '[sync-worker] worker error');
  });

  logger.info('[sync-worker] started');
  return worker;
}

/**
 * Gracefully stop the integration-sync worker.
 * Waits for the current job to finish before closing.
 */
export async function stopSyncWorker(): Promise<void> {
  if (!worker) return;

  logger.info('[sync-worker] shutting down...');
  await worker.close();
  worker = null;
  logger.info('[sync-worker] stopped');
}
