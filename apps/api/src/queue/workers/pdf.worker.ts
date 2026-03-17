import { Worker, Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { createBullConnection } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';
import { QUEUE_NAMES } from '../queues.js';
import type { PDFGenerationJob } from '../jobs.js';

let worker: Worker<PDFGenerationJob> | null = null;

/**
 * Processes PDF generation jobs.
 *
 * TODO Sprint 2:
 * 1. Load the template (invoice / estimate) from the template registry
 * 2. Fetch the record data from the database by recordId + recordType
 * 3. Render the HTML template with the record data
 * 4. Launch Puppeteer, navigate to the rendered HTML, and generate PDF
 * 5. Upload the PDF to S3 / Cloudflare R2
 * 6. Update the database record with the PDF URL and generation timestamp
 * 7. Optionally enqueue a notification job to inform the user
 */
async function processPDFGeneration(job: Job<PDFGenerationJob>): Promise<{ success: boolean }> {
  const { orgId, template, recordId, recordType } = job.data;

  logger.info(
    { jobId: job.id, orgId, template, recordId, recordType },
    '[pdf-worker] processing PDF generation',
  );

  // Stub: real implementation will render template with Puppeteer
  logger.info({ jobId: job.id }, '[pdf-worker] job completed (stub)');
  return { success: true };
}

/**
 * Start the pdf-generation worker.
 * Call once during server bootstrap.
 */
export function startPDFWorker(): Worker<PDFGenerationJob> {
  if (worker) return worker;

  const connection = createBullConnection() as ConnectionOptions;

  worker = new Worker<PDFGenerationJob>(
    QUEUE_NAMES.PDF_GENERATION,
    processPDFGeneration,
    {
      connection,
      concurrency: 2,
    },
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job?.id }, '[pdf-worker] job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err },
      '[pdf-worker] job failed',
    );
  });

  worker.on('error', (err) => {
    logger.error({ err }, '[pdf-worker] worker error');
  });

  logger.info('[pdf-worker] started');
  return worker;
}

/**
 * Gracefully stop the pdf-generation worker.
 * Waits for the current job to finish before closing.
 */
export async function stopPDFWorker(): Promise<void> {
  if (!worker) return;

  logger.info('[pdf-worker] shutting down...');
  await worker.close();
  worker = null;
  logger.info('[pdf-worker] stopped');
}
