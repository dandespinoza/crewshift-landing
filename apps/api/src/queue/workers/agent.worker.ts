import { Worker, Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { createBullConnection } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';
import { QUEUE_NAMES } from '../queues.js';
import type { AgentExecutionJob } from '../jobs.js';

let worker: Worker<AgentExecutionJob> | null = null;

/**
 * Processes agent execution jobs.
 *
 * TODO Sprint 2:
 * 1. Check idempotency key -- skip if already completed
 * 2. Load agent definition from registry
 * 3. Gather input data from DB + integrations
 * 4. Call Python AI service for reasoning
 * 5. Validate output against rules
 * 6. Check autonomy rules (auto/review/escalate)
 * 7. Execute actions (write to DB, sync to external)
 * 8. Fire chain events
 * 9. Log execution in agent_executions table
 */
async function processAgentExecution(job: Job<AgentExecutionJob>): Promise<{ success: boolean }> {
  const { orgId, agentType, triggerType, idempotencyKey } = job.data;

  logger.info(
    { jobId: job.id, orgId, agentType, triggerType, idempotencyKey },
    `[agent-worker] processing agent execution`,
  );

  // Stub: real implementation will follow the TODO steps above
  logger.info({ jobId: job.id }, '[agent-worker] job completed (stub)');
  return { success: true };
}

/**
 * Start the agent-execution worker.
 * Call once during server bootstrap.
 */
export function startAgentWorker(): Worker<AgentExecutionJob> {
  if (worker) return worker;

  const connection = createBullConnection() as ConnectionOptions;

  worker = new Worker<AgentExecutionJob>(
    QUEUE_NAMES.AGENT_EXECUTION,
    processAgentExecution,
    {
      connection,
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job?.id }, '[agent-worker] job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err },
      '[agent-worker] job failed',
    );
  });

  worker.on('error', (err) => {
    logger.error({ err }, '[agent-worker] worker error');
  });

  logger.info('[agent-worker] started');
  return worker;
}

/**
 * Gracefully stop the agent-execution worker.
 * Waits for the current job to finish before closing.
 */
export async function stopAgentWorker(): Promise<void> {
  if (!worker) return;

  logger.info('[agent-worker] shutting down...');
  await worker.close();
  worker = null;
  logger.info('[agent-worker] stopped');
}
