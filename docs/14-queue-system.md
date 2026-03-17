# 14 — Queue System (BullMQ + Redis)

> BullMQ is the task queue backbone of CrewShift. It handles agent execution, integration syncs, notification delivery, PDF generation, scheduled jobs (cron), and workflow delay steps. Every background operation flows through BullMQ — nothing heavy runs in the HTTP request path.

**Cross-references:** [06-agent-runtime.md](./06-agent-runtime.md) (agent execution dispatched via agent-execution queue), [09-integrations.md](./09-integrations.md) (sync jobs via integration-sync queue), [11-workflow-engine.md](./11-workflow-engine.md) (delay steps use delayed jobs), [12-file-storage.md](./12-file-storage.md) (pdf.worker.ts in pdf-generation queue), [15-notifications.md](./15-notifications.md) (notification delivery via notification queue)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Why BullMQ](#why-bullmq)
3. [Queue Definitions](#queue-definitions)
4. [Per-Queue Configuration](#per-queue-configuration)
5. [Workers](#workers)
6. [Job Types (TypeScript Interfaces)](#job-types)
7. [Retry Strategy](#retry-strategy)
8. [Dead Letter Queue](#dead-letter-queue)
9. [Scheduled Jobs (Cron)](#scheduled-jobs-cron)
10. [BullMQ Dashboard](#bullmq-dashboard)
11. [Redis Configuration](#redis-configuration)
12. [Implementation](#implementation)
13. [Decision Rationale](#decision-rationale)

---

## Architecture Overview

```
HTTP Request Path                      Background Processing (BullMQ + Redis)
─────────────────                      ──────────────────────────────────────

Fastify Route Handler                  Redis (queue storage)
  │                                    ┌──────────────────────────────────┐
  │ 1. Validate request                │  Queue: agent-execution          │
  │ 2. Save to DB                      │  Queue: integration-sync         │
  │ 3. Enqueue background job ────────▶│  Queue: notification             │
  │ 4. Return 200 immediately          │  Queue: scheduled                │
  │                                    │  Queue: pdf-generation           │
  │                                    └──────────────┬───────────────────┘
  │                                                   │
                                                      ▼
                                       Workers (run in same Node.js process)
                                       ┌──────────────────────────────────┐
                                       │  agent.worker.ts                 │
                                       │  sync.worker.ts                  │
                                       │  notification.worker.ts          │
                                       │  scheduled.worker.ts             │
                                       │  pdf.worker.ts                   │
                                       └──────────────────────────────────┘
```

**Key principle:** The HTTP request path is thin and fast. It validates input, saves data to the DB, enqueues a BullMQ job, and returns immediately. All heavy lifting (AI calls, integration syncs, PDF generation, email/SMS delivery) happens in workers.

---

## Why BullMQ

| Consideration | BullMQ | Inngest | Trigger.dev |
|---|---|---|---|
| Self-hosted | Yes (Redis) | Cloud-only (or self-hosted) | Cloud-only (or self-hosted) |
| Node.js native | Yes | Yes | Yes |
| Cost | Free + Redis cost | Free tier, then $0.20-0.50/job | Free tier, then usage-based |
| Delayed jobs | Native (precise scheduling) | Native | Native |
| Cron/repeatable jobs | Native | Native | Native |
| Retry with backoff | Native (exponential, fixed, custom) | Native | Native |
| Dashboard | Bull Board (open source) | Built-in dashboard | Built-in dashboard |
| Vendor lock-in | None (Redis is portable) | Some (proprietary event format) | Some |
| Complexity | Low (simple API, well-documented) | Low-medium (event-driven paradigm) | Medium |
| Battle-tested | Very (millions of production installs) | Growing | Growing |

**Why BullMQ over Inngest/Trigger.dev:**

1. **Zero vendor dependency.** BullMQ runs on any Redis instance. We already have Redis on Railway for caching. No additional service to manage or pay for.
2. **Full control.** We own the queue infrastructure. No rate limits, no vendor outages, no pricing changes.
3. **Simplicity.** BullMQ's API is straightforward: `queue.add()` to enqueue, `new Worker()` to process. No learning curve for a new abstraction layer.
4. **Cost at scale.** At 1,000 orgs with 5,000 agent executions/month, Inngest would cost ~$1,000-2,500/month. BullMQ + Redis costs the Redis instance (~$20-50/month on Railway).
5. **Delayed jobs for workflow engine.** BullMQ's delayed jobs are precise (millisecond-level scheduling), persistent (survive restarts), and observable (visible in Bull Board). This is critical for the workflow engine's delay steps.

**Why not Kafka, RabbitMQ, or SQS?**

Kafka is for stream processing at massive scale (millions of events/second) — overkill for our volume. RabbitMQ is a separate service to manage with its own protocol. SQS requires AWS infrastructure. BullMQ on Redis is the simplest, most Node.js-native solution that covers all our needs.

---

## Queue Definitions

### All Queues

```typescript
// queue/queues.ts
import { Queue, QueueOptions } from 'bullmq';
import { redisConnection } from '../config/redis';

/**
 * Queue configuration object.
 * Each queue has its own retry settings, cleanup policies, and rate limits.
 */
const QUEUE_CONFIGS: Record<string, QueueOptions['defaultJobOptions']> = {
  'agent-execution': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },   // 2s → 4s → 8s
    removeOnComplete: { age: 86400, count: 1000 },    // Keep 24h or 1000 completed jobs
    removeOnFail: { age: 604800 },                     // Keep failed jobs 7 days
  },
  'integration-sync': {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },   // 5s → 10s → 20s → 40s → 80s
    removeOnComplete: { age: 3600, count: 500 },      // Keep 1h or 500 completed
    removeOnFail: { age: 604800 },                     // Keep failed 7 days
  },
  'notification': {
    attempts: 3,
    backoff: { type: 'fixed', delay: 1000 },          // 1s fixed retry
    removeOnComplete: { age: 3600, count: 500 },       // Keep 1h or 500
    removeOnFail: { age: 259200 },                     // Keep failed 3 days
  },
  'scheduled': {
    attempts: 2,
    backoff: { type: 'fixed', delay: 60000 },         // 1 minute retry for crons
    removeOnComplete: { age: 86400, count: 200 },      // Keep 24h or 200
    removeOnFail: { age: 604800 },                     // Keep failed 7 days
  },
  'pdf-generation': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },   // 3s → 6s → 12s
    removeOnComplete: { age: 3600, count: 200 },       // Keep 1h or 200
    removeOnFail: { age: 604800 },                     // Keep failed 7 days
  },
};

// Create queue instances
export const agentQueue = new Queue('agent-execution', {
  connection: redisConnection,
  defaultJobOptions: QUEUE_CONFIGS['agent-execution'],
});

export const syncQueue = new Queue('integration-sync', {
  connection: redisConnection,
  defaultJobOptions: QUEUE_CONFIGS['integration-sync'],
});

export const notificationQueue = new Queue('notification', {
  connection: redisConnection,
  defaultJobOptions: QUEUE_CONFIGS['notification'],
});

export const scheduledQueue = new Queue('scheduled', {
  connection: redisConnection,
  defaultJobOptions: QUEUE_CONFIGS['scheduled'],
});

export const pdfQueue = new Queue('pdf-generation', {
  connection: redisConnection,
  defaultJobOptions: QUEUE_CONFIGS['pdf-generation'],
});
```

### Queue Purposes

| Queue | Purpose | Producers | Consumer Worker |
|---|---|---|---|
| `agent-execution` | Agent runtime execution (AI reasoning, data gathering, validation, write-back) | Event bus, copilot dispatcher, workflow engine | `agent.worker.ts` |
| `integration-sync` | Integration data sync (pull from external APIs, webhook processing) | Webhook routes, manual sync trigger, token refresh cron | `sync.worker.ts` |
| `notification` | Notification delivery (email, SMS, push, in-app) | Agent runtime, workflow engine, cron jobs, copilot | `notification.worker.ts` |
| `scheduled` | Scheduled/cron job execution | BullMQ repeatable jobs (configured at startup) | `scheduled.worker.ts` |
| `pdf-generation` | Invoice and estimate PDF generation (Puppeteer) | Agent runtime (after invoice/estimate creation) | `pdf.worker.ts` |

---

## Per-Queue Configuration

### agent-execution

```typescript
{
  attempts: 3,                              // Retry up to 3 times
  backoff: { type: 'exponential', delay: 2000 }, // 2s → 4s → 8s
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: { age: 604800 },
}
```

**Rationale:**
- 3 attempts with exponential backoff because AI service calls can have transient failures (rate limits, timeouts). Exponential backoff avoids hammering the AI service.
- 2-second initial delay gives the AI service time to recover from a momentary spike.
- Completed jobs kept for 24 hours for debugging. Failed jobs kept for 7 days for investigation.

**Concurrency:** 10 (process up to 10 agent executions simultaneously)

### integration-sync

```typescript
{
  attempts: 5,                              // More retries — external APIs are flaky
  backoff: { type: 'exponential', delay: 5000 }, // 5s → 10s → 20s → 40s → 80s
  removeOnComplete: { age: 3600, count: 500 },
  removeOnFail: { age: 604800 },
}
```

**Rationale:**
- 5 attempts because external APIs (QuickBooks, Jobber, Stripe) can have extended outages. More retries with longer backoff gives them time to recover.
- 5-second initial delay because external API rate limits often reset within a few seconds.
- More aggressive cleanup (1 hour) because sync jobs are high-volume and low-importance for debugging.

**Concurrency:** 5 (external APIs often have per-connection rate limits)

### notification

```typescript
{
  attempts: 3,
  backoff: { type: 'fixed', delay: 1000 },  // 1s fixed retry
  removeOnComplete: { age: 3600, count: 500 },
  removeOnFail: { age: 259200 },
}
```

**Rationale:**
- Fixed delay (not exponential) because notification delivery failures are usually permanent (invalid phone number, bounced email) or very transient (Twilio/Resend brief hiccup). Exponential backoff doesn't help for permanent failures.
- 1-second retry is fast enough to catch transient issues without delaying notifications significantly.
- Failed jobs kept only 3 days — notification failures are less critical to investigate than agent failures.

**Concurrency:** 20 (notifications should be sent quickly)

### scheduled

```typescript
{
  attempts: 2,
  backoff: { type: 'fixed', delay: 60000 }, // 1 minute retry
  removeOnComplete: { age: 86400, count: 200 },
  removeOnFail: { age: 604800 },
}
```

**Rationale:**
- Only 2 attempts because cron jobs will fire again on the next schedule. If the daily overdue invoice check fails twice, it'll run again tomorrow. No need for aggressive retrying.
- 1-minute retry delay because cron handlers often process data across all orgs — a transient DB issue at minute 0 is likely resolved by minute 1.

**Concurrency:** 3 (cron jobs are not time-critical and shouldn't compete with user-triggered work)

### pdf-generation

```typescript
{
  attempts: 3,
  backoff: { type: 'exponential', delay: 3000 }, // 3s → 6s → 12s
  removeOnComplete: { age: 3600, count: 200 },
  removeOnFail: { age: 604800 },
}
```

**Rationale:**
- 3 attempts because Puppeteer can fail due to memory pressure, Chrome crash, or R2 upload timeout. These are usually transient.
- 3-second initial delay gives the system time to reclaim memory from a crashed Chrome process.
- Low concurrency (2) because each Puppeteer page uses ~50-100MB RAM.

**Concurrency:** 2 (Puppeteer is memory-heavy — see [12-file-storage.md](./12-file-storage.md))

---

## Workers

### agent.worker.ts

**Processes:** `agent-execution` queue

**What it does:**
1. Receives a job with `{ agent_type, trigger_type, trigger_source, input_data, org_id }`
2. Loads the agent definition from the registry
3. Executes the agent pipeline: gather data -> call AI service -> validate -> autonomy check -> write results -> chain
4. Updates `agent_executions` table with status, output, actions taken, tokens used, cost

```typescript
// queue/workers/agent.worker.ts
import { Worker, Job } from 'bullmq';
import { redisConnection } from '../../config/redis';
import { agentRegistry } from '../../agents/registry';
import { agentRuntime } from '../../agents/runtime';
import { logger } from '../../utils/logger';

interface AgentJobData {
  agent_type: string;        // 'invoice', 'estimate', 'collections', etc.
  trigger_type: string;      // 'event', 'chat', 'schedule', 'chain', 'workflow'
  trigger_source: string;    // event name, message id, cron job name
  input_data: Record<string, any>;  // trigger-specific data
  org_id: string;
  execution_id?: string;     // pre-created execution record ID
  idempotency_key?: string;  // prevent duplicate executions
}

const agentWorker = new Worker<AgentJobData>(
  'agent-execution',
  async (job: Job<AgentJobData>) => {
    const { agent_type, trigger_type, trigger_source, input_data, org_id, execution_id, idempotency_key } = job.data;

    logger.info('agent_worker_processing', {
      agent_type, trigger_type, org_id,
      job_id: job.id,
      attempt: job.attemptsMade + 1,
    });

    // Idempotency check
    if (idempotency_key) {
      const existing = await db.queryOne(
        `SELECT id, status FROM agent_executions
         WHERE org_id = $1 AND input_data->>'idempotency_key' = $2 AND status = 'completed'`,
        [org_id, idempotency_key],
      );
      if (existing) {
        logger.info('agent_worker_idempotent_skip', { idempotency_key, existing_id: existing.id });
        return existing; // Skip — already processed
      }
    }

    // Get agent definition
    const definition = agentRegistry.get(agent_type);
    if (!definition) {
      throw new Error(`Unknown agent type: ${agent_type}`);
    }

    // Execute the full agent pipeline
    const result = await agentRuntime.execute({
      definition,
      trigger: { type: trigger_type, source: trigger_source },
      input: input_data,
      org_id,
      execution_id,
    });

    logger.info('agent_worker_completed', {
      agent_type, org_id,
      status: result.status,
      duration_ms: result.duration_ms,
      ai_tokens: result.ai_tokens_used,
      ai_cost_cents: result.ai_cost_cents,
    });

    return result;
  },
  {
    connection: redisConnection,
    concurrency: 10,
    // Stalled jobs: if a worker crashes mid-execution, the job is retried after 30s
    stalledInterval: 30000,
    maxStalledCount: 2,
  },
);

// Error handling
agentWorker.on('failed', (job, error) => {
  logger.error('agent_worker_failed', {
    job_id: job?.id,
    agent_type: job?.data.agent_type,
    org_id: job?.data.org_id,
    error: error.message,
    attempts: job?.attemptsMade,
  });
});

agentWorker.on('completed', (job, result) => {
  // Emit events for agent chaining
  if (result?.chain_events) {
    for (const event of result.chain_events) {
      eventBus.emit(event.name, event.data);
    }
  }
});

export { agentWorker };
```

### sync.worker.ts

**Processes:** `integration-sync` queue

**What it does:**
1. Handles webhook event processing (Stripe, QuickBooks, Jobber webhooks are enqueued here after signature verification)
2. Handles full/incremental syncs (pull data from external API, transform to unified model, upsert in DB)
3. Handles token refresh (proactive OAuth token refresh for expiring tokens)

```typescript
// queue/workers/sync.worker.ts
import { Worker, Job } from 'bullmq';

type SyncJobData =
  | { type: 'webhook'; provider: string; payload: any; received_at: number }
  | { type: 'full_sync'; provider: string; org_id: string; integration_id: string }
  | { type: 'incremental_sync'; provider: string; org_id: string; integration_id: string; since: string }
  | { type: 'token_refresh'; provider: string; org_id: string; integration_id: string };

const syncWorker = new Worker<SyncJobData>(
  'integration-sync',
  async (job: Job<SyncJobData>) => {
    const { type, provider } = job.data;

    switch (type) {
      case 'webhook':
        return await processWebhook(job.data);
      case 'full_sync':
        return await runFullSync(job.data);
      case 'incremental_sync':
        return await runIncrementalSync(job.data);
      case 'token_refresh':
        return await refreshToken(job.data);
    }
  },
  {
    connection: redisConnection,
    concurrency: 5,
  },
);
```

### notification.worker.ts

**Processes:** `notification` queue

**What it does:**
1. Routes notifications to the correct delivery channel (email via Resend, SMS via Twilio, push, in-app)
2. Creates the `notifications` DB record (triggers Supabase Realtime for in-app delivery)
3. Tracks delivery status

```typescript
// queue/workers/notification.worker.ts
import { Worker, Job } from 'bullmq';

interface NotificationJobData {
  org_id: string;
  user_id?: string;          // null = org owner
  type: string;              // 'agent_action', 'review_needed', 'alert', 'digest'
  title: string;
  body: string;
  channel: 'in_app' | 'email' | 'sms' | 'push';
  action_url?: string;
  metadata?: Record<string, any>;
}

const notificationWorker = new Worker<NotificationJobData>(
  'notification',
  async (job: Job<NotificationJobData>) => {
    const { org_id, user_id, type, title, body, channel, action_url, metadata } = job.data;

    // Determine recipient
    const recipient = user_id
      ? await db.queryOne('SELECT * FROM profiles WHERE id = $1', [user_id])
      : await db.queryOne('SELECT * FROM profiles WHERE org_id = $1 AND role = $2', [org_id, 'owner']);

    if (!recipient) {
      logger.warn('notification_no_recipient', { org_id, user_id });
      return { delivered: false, reason: 'no_recipient' };
    }

    // Insert notification record (triggers Supabase Realtime for in-app)
    const notification = await db.insert('notifications', {
      org_id, user_id: recipient.id, type, title, body, channel, action_url, metadata,
    });

    // Deliver via external channel
    switch (channel) {
      case 'email':
        await emailService.send({
          to: recipient.email || (await getOrgOwnerEmail(org_id)),
          subject: title,
          body,
        });
        break;
      case 'sms':
        if (recipient.phone) {
          await smsService.send({ to: recipient.phone, message: `${title}: ${body}` });
        }
        break;
      case 'push':
        // Push notification via FCM/APNs (Phase 2)
        break;
      case 'in_app':
        // Already handled by DB insert + Supabase Realtime
        break;
    }

    return { delivered: true, notification_id: notification.id };
  },
  {
    connection: redisConnection,
    concurrency: 20,
  },
);
```

### scheduled.worker.ts

**Processes:** `scheduled` queue

**What it does:**
Processes all cron/repeatable jobs. Each scheduled job type has a handler function that runs the actual logic. The worker is a dispatcher — it receives the job type and calls the appropriate handler.

```typescript
// queue/workers/scheduled.worker.ts
import { Worker, Job } from 'bullmq';

interface ScheduledJobData {
  handler: string;   // Handler function name
  org_id?: string;   // Some jobs run per-org, some run globally
}

// Handler registry
const HANDLERS: Record<string, (data: ScheduledJobData) => Promise<any>> = {
  detectOverdueInvoices,
  checkComplianceDeadlines,
  checkLowStock,
  refreshExpiringTokens,
  anonymizeNewExecutions,
  generateWeeklyDigest,
  summarizeLongConversations,
  generateDailyDigest,
  processCollectionsSequences,
};

const scheduledWorker = new Worker<ScheduledJobData>(
  'scheduled',
  async (job: Job<ScheduledJobData>) => {
    const { handler } = job.data;
    const handlerFn = HANDLERS[handler];

    if (!handlerFn) {
      throw new Error(`Unknown scheduled handler: ${handler}`);
    }

    logger.info('scheduled_job_started', { handler, job_id: job.id });
    const result = await handlerFn(job.data);
    logger.info('scheduled_job_completed', { handler, job_id: job.id, result });

    return result;
  },
  {
    connection: redisConnection,
    concurrency: 3,
  },
);
```

### pdf.worker.ts

**Processes:** `pdf-generation` queue

Documented in full in [12-file-storage.md](./12-file-storage.md#pdf-generation-pipeline). Uses Puppeteer to render HTML templates into PDFs, uploads to R2, and updates the DB record with the PDF URL.

**Concurrency:** 2 (Puppeteer is memory-intensive)

---

## Job Types

### TypeScript Interfaces for Job Payloads

```typescript
// queue/jobs.ts — type definitions for all job payloads

/**
 * Agent execution job.
 * Dispatched by: event bus, copilot, workflow engine
 */
export interface AgentExecutionJob {
  agent_type: string;
  trigger_type: 'event' | 'chat' | 'schedule' | 'chain' | 'workflow';
  trigger_source: string;
  input_data: Record<string, any>;
  org_id: string;
  execution_id?: string;
  idempotency_key?: string;
}

/**
 * Integration sync job.
 * Dispatched by: webhook routes, manual sync, token refresh cron
 */
export type IntegrationSyncJob =
  | {
      type: 'webhook';
      provider: string;
      payload: Record<string, any>;
      received_at: number;
    }
  | {
      type: 'full_sync';
      provider: string;
      org_id: string;
      integration_id: string;
    }
  | {
      type: 'incremental_sync';
      provider: string;
      org_id: string;
      integration_id: string;
      since: string;  // ISO timestamp
    }
  | {
      type: 'token_refresh';
      provider: string;
      org_id: string;
      integration_id: string;
    };

/**
 * Notification delivery job.
 * Dispatched by: agent runtime, workflow engine, cron jobs
 */
export interface NotificationJob {
  org_id: string;
  user_id?: string;
  type: 'agent_action' | 'review_needed' | 'alert' | 'digest' | 'workflow';
  title: string;
  body: string;
  channel: 'in_app' | 'email' | 'sms' | 'push';
  action_url?: string;
  metadata?: Record<string, any>;
}

/**
 * Scheduled job (cron).
 * Dispatched by: BullMQ repeatable job scheduler
 */
export interface ScheduledJob {
  handler: string;
  org_id?: string;
}

/**
 * PDF generation job.
 * Dispatched by: agent runtime (after invoice/estimate creation)
 */
export interface PDFGenerationJob {
  type: 'invoice' | 'estimate';
  entity_id: string;
  org_id: string;
}

/**
 * Workflow resume job (after delay step).
 * Dispatched by: workflow engine when a delay step is reached
 */
export interface WorkflowResumeJob {
  execution_id: string;
  workflow_id: string;
  org_id: string;
  next_step: string;
  context: Record<string, any>;
}
```

---

## Retry Strategy

### Per-Queue Retry Configuration

| Queue | Max Attempts | Backoff Type | Backoff Delay | Rationale |
|---|---|---|---|---|
| `agent-execution` | 3 | Exponential | 2s, 4s, 8s | AI service may be temporarily overloaded. Exponential backoff prevents pile-up. |
| `integration-sync` | 5 | Exponential | 5s, 10s, 20s, 40s, 80s | External APIs can have extended rate limits. Patient retrying with escalating delays. |
| `notification` | 3 | Fixed | 1s, 1s, 1s | Notification failures are usually permanent (bad phone number) or instantly transient. No benefit from exponential. |
| `scheduled` | 2 | Fixed | 60s | Cron jobs run again on schedule. One 60s retry catches transient issues; beyond that, next schedule run handles it. |
| `pdf-generation` | 3 | Exponential | 3s, 6s, 12s | Puppeteer memory issues need time to clear. Exponential gives the system breathing room. |

### How BullMQ Retries Work

```
Job attempt 1: Execute
  │ Success → Job complete, result stored
  │ Failure → Wait backoff delay, then...
  │
Job attempt 2: Execute
  │ Success → Job complete
  │ Failure → Wait longer backoff delay, then...
  │
Job attempt 3: Execute
  │ Success → Job complete
  │ Failure → All attempts exhausted → Job moved to FAILED state
```

**Important:** Each retry attempt runs the entire job from scratch. There is no checkpoint/resume within a job. If an agent execution fails at step 3 of 5, the retry starts from step 1. This is why idempotency keys are critical — the first two steps must be idempotent (checking for existing results before re-executing).

### Backoff Types Explained

**Exponential:** Each retry waits `delay * 2^(attempt - 1)`. For delay=2000: 2s, 4s, 8s. Useful when the failure might be due to temporary overload — spreading retries over increasing intervals reduces pressure.

**Fixed:** Each retry waits the same `delay`. For delay=1000: 1s, 1s, 1s. Useful when failures are either permanent (don't benefit from waiting longer) or very transient (fixed to within a second).

---

## Dead Letter Queue

When a job exhausts all retry attempts, it enters the FAILED state. BullMQ keeps failed jobs in Redis for the duration specified by `removeOnFail.age`.

### What Happens When All Retries Fail

```
Job fails final attempt
  │
  ├── 1. Job moves to FAILED state in BullMQ
  │      (visible in Bull Board dashboard)
  │
  ├── 2. Worker 'failed' event fires
  │      → Structured log: agent_worker_failed { job_id, error, attempts }
  │
  ├── 3. For agent-execution failures:
  │      → agent_executions.status updated to 'failed'
  │      → agent_executions.error updated with error message
  │      → Notification sent to org owner: "Invoice Agent failed: {error}"
  │
  └── 4. For integration-sync failures:
         → integrations.status updated to 'error'
         → Notification: "QuickBooks sync failed. We'll retry on the next schedule."
```

### Inspecting Dead Letters

Failed jobs are visible in the Bull Board dashboard (see below) and can be inspected for:
- Original job data (input parameters)
- Error message and stack trace
- Number of attempts made
- Timestamps for each attempt

### Retrying Dead Letters

Failed jobs can be retried manually via Bull Board or programmatically:

```typescript
// Retry all failed jobs in a queue
const failedJobs = await agentQueue.getFailed(0, 100);
for (const job of failedJobs) {
  await job.retry();
  logger.info('dead_letter_retried', { job_id: job.id, queue: 'agent-execution' });
}

// Retry a specific failed job
const job = await agentQueue.getJob('specific-job-id');
if (job && await job.isFailed()) {
  await job.retry();
}
```

### Cleanup

Failed jobs are automatically removed after the `removeOnFail.age` period:

| Queue | Failed Job Retention |
|---|---|
| agent-execution | 7 days |
| integration-sync | 7 days |
| notification | 3 days |
| scheduled | 7 days |
| pdf-generation | 7 days |

---

## Scheduled Jobs (Cron)

All scheduled jobs are defined as BullMQ repeatable jobs, processed by `scheduled.worker.ts`. They're configured at application startup.

### Complete Scheduled Job Definitions

```typescript
// queue/scheduled-jobs.ts
import { scheduledQueue } from './queues';
import { logger } from '../utils/logger';

/**
 * All scheduled (cron) jobs for CrewShift.
 *
 * BullMQ repeatable jobs are idempotent — if the server restarts,
 * BullMQ reconciles the schedule and doesn't create duplicates.
 *
 * Cron expressions use UTC timezone. Comments show approximate local time
 * for US Eastern for reference.
 */
export const SCHEDULED_JOBS = [
  // ═══════════════════════════════════════════
  // DAILY JOBS
  // ═══════════════════════════════════════════

  {
    name: 'invoice-overdue-detection',
    cron: '0 9 * * *',              // Daily at 9:00 AM UTC (~5 AM ET)
    handler: 'detectOverdueInvoices',
    description: 'Scan all invoices where due_date < NOW() and status not in (paid, void). For each overdue invoice, emit invoice.overdue event which triggers Collections Agent to send appropriate follow-up based on days overdue.',
  },
  {
    name: 'compliance-deadline-check',
    cron: '0 9 * * *',              // Daily at 9:00 AM UTC
    handler: 'checkComplianceDeadlines',
    description: 'Scan business_context and integration data for upcoming expirations: tech certifications (OSHA, EPA), vehicle registrations, insurance policies, permits. Flag items expiring within 30/14/7 days. Emit compliance.deadline event to trigger Compliance Agent.',
  },
  {
    name: 'inventory-low-stock-check',
    cron: '0 9 * * *',              // Daily at 9:00 AM UTC
    handler: 'checkLowStock',
    description: 'Scan parts table where quantity_on_hand < reorder_point. Emit inventory.low_stock event for each low-stock item, triggering Inventory Agent to generate reorder alerts and supplier price comparisons.',
  },
  {
    name: 'token-refresh',
    cron: '0 */4 * * *',            // Every 4 hours (0:00, 4:00, 8:00, 12:00, 16:00, 20:00 UTC)
    handler: 'refreshExpiringTokens',
    description: 'Scan integrations table where token_expires_at < NOW() + interval 1 hour. Proactively refresh OAuth tokens before they expire. Enqueue a token_refresh job in the integration-sync queue for each expiring token.',
  },
  {
    name: 'data-anonymization',
    cron: '0 2 * * *',              // Daily at 2:00 AM UTC (~10 PM ET)
    handler: 'anonymizeNewExecutions',
    description: 'Process new agent_executions from opted-in orgs (data_consent.consented = true). Strip PII, normalize data, and insert into training_data table. Runs at low-traffic time to minimize DB load.',
  },
  {
    name: 'daily-digest',
    cron: '0 13 * * *',             // Daily at 1:00 PM UTC (~8-9 AM ET/CT)
    handler: 'generateDailyDigest',
    description: 'Generate a daily digest notification for each org. Summarizes: agent activity from past 24h, outstanding items needing attention, upcoming deadlines, proactive insights. Uses Insights Agent for summary generation. Delivered as in-app + optional email.',
  },
  {
    name: 'collections-followup',
    cron: '0 14 * * *',             // Daily at 2:00 PM UTC (~10 AM ET)
    handler: 'processCollectionsSequences',
    description: 'Collections Agent checks all active collection sequences. For invoices in follow-up sequences, determine if the next escalation step is due based on the collection timeline. Send the next follow-up message (friendly reminder -> firm notice -> final notice -> lien warning). Also check state-specific preliminary notice deadlines.',
  },

  // ═══════════════════════════════════════════
  // WEEKLY JOBS
  // ═══════════════════════════════════════════

  {
    name: 'weekly-digest',
    cron: '0 13 * * 1',             // Mondays at 1:00 PM UTC (~9 AM ET)
    handler: 'generateWeeklyDigest',
    description: 'Generate a comprehensive weekly summary for each org. Includes: total revenue, job count, agent actions taken, invoices sent/paid, estimates sent/accepted, margin analysis, week-over-week comparison. Dispatches Insights Agent for summary generation. Delivered as email + in-app notification.',
  },
  {
    name: 'conversation-summarization',
    cron: '0 3 * * 0',              // Sundays at 3:00 AM UTC
    handler: 'summarizeLongConversations',
    description: 'Find all conversations with > 50 messages that dont have a recent summary. Use fast LLM model to generate a summary of the conversation (key decisions, actions taken, preferences expressed). Store in conversations.summary for medium-term memory. Runs during lowest-traffic period.',
  },
];

/**
 * Register all scheduled jobs with BullMQ.
 * Called once at application startup.
 *
 * BullMQ handles deduplication — if a repeatable job with the same name
 * already exists, it updates the schedule rather than creating a duplicate.
 */
export async function registerScheduledJobs(): Promise<void> {
  for (const job of SCHEDULED_JOBS) {
    await scheduledQueue.add(
      job.name,
      { handler: job.handler },
      {
        repeat: { pattern: job.cron },
        jobId: `scheduled:${job.name}`, // Idempotent — same ID prevents duplicates
      },
    );

    logger.info('scheduled_job_registered', {
      name: job.name,
      cron: job.cron,
      handler: job.handler,
    });
  }

  logger.info('all_scheduled_jobs_registered', { count: SCHEDULED_JOBS.length });
}
```

### Scheduled Job Handler Implementations (Summaries)

#### detectOverdueInvoices

```typescript
async function detectOverdueInvoices(): Promise<{ overdue_count: number }> {
  // Query all invoices that are past due and not yet marked overdue
  const overdueInvoices = await db.query(`
    SELECT i.*, c.name as customer_name, c.payment_score
    FROM invoices i
    JOIN customers c ON c.id = i.customer_id
    WHERE i.due_date < NOW()::date
      AND i.status NOT IN ('paid', 'void', 'overdue')
  `);

  let count = 0;
  for (const invoice of overdueInvoices) {
    // Update status to overdue
    await db.query(
      "UPDATE invoices SET status = 'overdue', updated_at = NOW() WHERE id = $1",
      [invoice.id],
    );

    // Calculate days overdue
    const daysOverdue = Math.floor(
      (Date.now() - new Date(invoice.due_date).getTime()) / (1000 * 60 * 60 * 24)
    );

    // Emit event (triggers Collections Agent)
    eventBus.emit('invoice.overdue', {
      invoice: { ...invoice, days_overdue: daysOverdue },
      customer: { name: invoice.customer_name, payment_score: invoice.payment_score },
      org_id: invoice.org_id,
    });

    count++;
  }

  return { overdue_count: count };
}
```

#### checkComplianceDeadlines

```typescript
async function checkComplianceDeadlines(): Promise<{ alerts_generated: number }> {
  // Check for expiring items across all orgs
  const expiringItems = await db.query(`
    SELECT bc.org_id, bc.category, bc.key, bc.value
    FROM business_context bc
    WHERE bc.category = 'compliance'
      AND (bc.value->>'expiration_date')::date <= NOW()::date + interval '30 days'
  `);

  let alertCount = 0;
  for (const item of expiringItems) {
    const expirationDate = new Date(item.value.expiration_date);
    const daysUntilExpiry = Math.ceil(
      (expirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );

    // Only alert at 30, 14, 7, 3, 1 day thresholds
    if ([30, 14, 7, 3, 1].includes(daysUntilExpiry)) {
      eventBus.emit('compliance.deadline', {
        org_id: item.org_id,
        item_type: item.key,
        item_data: item.value,
        days_until_expiry: daysUntilExpiry,
      });
      alertCount++;
    }
  }

  return { alerts_generated: alertCount };
}
```

#### refreshExpiringTokens

```typescript
async function refreshExpiringTokens(): Promise<{ refreshed: number; failed: number }> {
  // Find tokens expiring within 1 hour
  const expiringIntegrations = await db.query(`
    SELECT id, org_id, provider
    FROM integrations
    WHERE token_expires_at < NOW() + interval '1 hour'
      AND status = 'connected'
  `);

  let refreshed = 0;
  let failed = 0;

  for (const integration of expiringIntegrations) {
    // Enqueue token refresh in the sync queue
    await syncQueue.add('token-refresh', {
      type: 'token_refresh',
      provider: integration.provider,
      org_id: integration.org_id,
      integration_id: integration.id,
    });
    refreshed++;
  }

  return { refreshed, failed };
}
```

### Scheduled Job Summary Table

| Job Name | Cron Expression | Time (UTC) | Handler | Description |
|---|---|---|---|---|
| `invoice-overdue-detection` | `0 9 * * *` | Daily 9:00 AM | `detectOverdueInvoices` | Scan for overdue invoices, update status, trigger Collections Agent |
| `compliance-deadline-check` | `0 9 * * *` | Daily 9:00 AM | `checkComplianceDeadlines` | Check for expiring certifications, insurance, permits (30/14/7/3/1 day warnings) |
| `inventory-low-stock-check` | `0 9 * * *` | Daily 9:00 AM | `checkLowStock` | Check parts below reorder point, trigger Inventory Agent |
| `token-refresh` | `0 */4 * * *` | Every 4 hours | `refreshExpiringTokens` | Proactively refresh OAuth tokens expiring within 1 hour |
| `data-anonymization` | `0 2 * * *` | Daily 2:00 AM | `anonymizeNewExecutions` | Anonymize agent execution data for opted-in orgs, store in training_data |
| `daily-digest` | `0 13 * * *` | Daily 1:00 PM | `generateDailyDigest` | Proactive daily summary: agent activity, outstanding items, insights |
| `collections-followup` | `0 14 * * *` | Daily 2:00 PM | `processCollectionsSequences` | Process collections escalation sequences, send next follow-up |
| `weekly-digest` | `0 13 * * 1` | Mondays 1:00 PM | `generateWeeklyDigest` | Comprehensive weekly business summary with insights |
| `conversation-summarization` | `0 3 * * 0` | Sundays 3:00 AM | `summarizeLongConversations` | Summarize long conversations (>50 messages) for medium-term memory |

---

## BullMQ Dashboard

### Bull Board

Bull Board is an open-source dashboard for monitoring BullMQ queues. It provides real-time visibility into:

- Queue depth (waiting, active, completed, failed, delayed jobs)
- Individual job details (input data, error messages, attempt history)
- Job retry (manually retry failed jobs)
- Queue metrics (throughput, latency)

### Setup

```typescript
// server.ts — add Bull Board to the Fastify app
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';

// Only enable in non-production (or protect with auth in production)
if (env.NODE_ENV !== 'production' || env.ENABLE_BULL_BOARD === 'true') {
  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [
      new BullMQAdapter(agentQueue),
      new BullMQAdapter(syncQueue),
      new BullMQAdapter(notificationQueue),
      new BullMQAdapter(scheduledQueue),
      new BullMQAdapter(pdfQueue),
    ],
    serverAdapter,
  });

  // Register Bull Board routes (protected by admin auth)
  app.register(serverAdapter.registerPlugin(), {
    prefix: '/admin/queues',
    // Protected by requireRole('owner') middleware
  });
}
```

**Access:** `https://api.crewshift.com/admin/queues` — protected by owner-only authentication.

**Production access:** In production, Bull Board is either disabled or protected behind a strong authentication layer. Queue metrics are also available via structured logs (parsed by Railway or Axiom).

---

## Redis Configuration

### Connection

```typescript
// config/redis.ts
import { Redis } from 'ioredis';

/**
 * Redis connection used by BullMQ.
 *
 * On Railway, Redis is a managed addon with a connection string.
 * Locally, Redis runs in Docker via docker-compose.
 *
 * BullMQ requires a dedicated Redis connection (not shared with caching)
 * because it uses blocking operations (BRPOPLPUSH) that can interfere
 * with regular GET/SET caching operations.
 */
export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,  // Required by BullMQ (it handles retries itself)
  enableReadyCheck: false,      // Faster startup
  retryStrategy: (times) => {
    // Reconnect with exponential backoff, max 30 seconds
    return Math.min(times * 500, 30000);
  },
});

// Separate connection for general caching (rate limiting, idempotency, etc.)
export const cacheRedis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

// Log connection events
redisConnection.on('connect', () => logger.info('redis_connected'));
redisConnection.on('error', (err) => logger.error('redis_error', { error: err.message }));
redisConnection.on('reconnecting', () => logger.warn('redis_reconnecting'));
```

### Environment Variables

```env
# Local development
REDIS_URL=redis://localhost:6379

# Railway (managed Redis addon)
REDIS_URL=redis://default:password@containers-us-east-X.railway.app:6379
```

### Memory Configuration

| Setting | Value | Rationale |
|---|---|---|
| `maxmemory` | 256MB (Railway starter), 512MB+ (production) | BullMQ jobs are small (< 10KB each). 256MB holds hundreds of thousands of jobs. |
| `maxmemory-policy` | `noeviction` | BullMQ requires `noeviction` — Redis must never evict job data. If memory is full, writes fail (and we get an alert). |
| Persistence | AOF (append-only file) | Railway Redis enables AOF by default. Jobs survive Redis restarts. |

**Memory usage estimation:**

- Average job payload: ~2KB (JSON with org_id, input_data, etc.)
- 10,000 active/recent jobs: ~20MB
- BullMQ metadata overhead: ~50MB
- Rate limiting keys: ~10MB
- Total typical usage: ~80MB (well within 256MB)

### Redis Data Categories

| Data | TTL | Purpose |
|---|---|---|
| BullMQ job data | Managed by removeOnComplete/removeOnFail settings | Active, completed, and failed jobs |
| BullMQ repeatable job schedules | Permanent | Cron job definitions |
| BullMQ delayed job scores | Until execution time | Workflow delay steps, scheduled future jobs |
| Rate limit counters | 60 seconds | Sliding window rate limiting |
| Webhook dedup keys | 24 hours | Prevent duplicate webhook processing |
| Idempotency keys | 24 hours | Prevent duplicate agent executions |

---

## Implementation

### Startup Registration

```typescript
// server.ts — register all queues and scheduled jobs at startup
import { registerScheduledJobs } from './queue/scheduled-jobs';
import { agentWorker } from './queue/workers/agent.worker';
import { syncWorker } from './queue/workers/sync.worker';
import { notificationWorker } from './queue/workers/notification.worker';
import { scheduledWorker } from './queue/workers/scheduled.worker';
import { pdfWorker } from './queue/workers/pdf.worker';

// Workers start processing automatically when imported.
// Scheduled jobs need explicit registration.
await registerScheduledJobs();

logger.info('all_workers_started', {
  workers: ['agent', 'sync', 'notification', 'scheduled', 'pdf'],
  scheduled_jobs: SCHEDULED_JOBS.length,
});
```

### Enqueuing Jobs from Route Handlers

```typescript
// Example: enqueue agent execution from the event bus
eventBus.on('job.completed', async (eventData) => {
  // Find all agents that trigger on job.completed
  const matchingAgents = agentRegistry.findByTrigger('event', 'job.completed');

  for (const agent of matchingAgents) {
    await agentQueue.add(
      `${agent.type}:${eventData.job.id}`,  // Job name (for dashboard readability)
      {
        agent_type: agent.type,
        trigger_type: 'event',
        trigger_source: 'job.completed',
        input_data: eventData,
        org_id: eventData.org_id,
        idempotency_key: `${agent.type}:${eventData.job.id}:${Date.now()}`,
      },
      {
        priority: agent.type === 'invoice' ? 1 : 5,  // Invoice Agent gets priority
      },
    );
  }
});

// Example: enqueue PDF generation after invoice creation
eventBus.on('invoice.created', async (eventData) => {
  await pdfQueue.add(
    `invoice-pdf:${eventData.invoice.id}`,
    {
      type: 'invoice',
      entity_id: eventData.invoice.id,
      org_id: eventData.org_id,
    },
  );
});
```

### Graceful Shutdown

```typescript
// server.ts — graceful shutdown
async function shutdown() {
  logger.info('shutting_down');

  // 1. Stop accepting new HTTP requests
  await app.close();

  // 2. Close all workers (finish current jobs, don't pick up new ones)
  await agentWorker.close();
  await syncWorker.close();
  await notificationWorker.close();
  await scheduledWorker.close();
  await pdfWorker.close();

  // 3. Close Redis connections
  await redisConnection.quit();
  await cacheRedis.quit();

  logger.info('shutdown_complete');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

**BullMQ graceful shutdown behavior:** When `worker.close()` is called, the worker finishes processing any active jobs (up to a timeout) but stops picking up new jobs from the queue. This prevents data loss — in-flight jobs complete, pending jobs wait in Redis for the worker to restart.

---

## Decision Rationale

| Decision | Choice | Alternatives Considered | Why |
|---|---|---|---|
| Task queue | BullMQ | Inngest, Trigger.dev, RabbitMQ, SQS, pg-boss | BullMQ is Node-native, Redis-backed (we already have Redis), free, battle-tested, and gives us full control. No vendor lock-in, no usage-based pricing. See detailed comparison above. |
| Workers in same process | Workers run alongside the Fastify server | Separate worker service, Lambda functions | Single process is simpler to deploy and manage on Railway. Workers and the API share the same codebase and dependencies. Separate services add deployment complexity for no benefit at our scale. If worker load grows, we can split later. |
| Redis for BullMQ | Shared Redis instance (separate connections) | Separate Redis for queues, PostgreSQL-based queue (pg-boss) | One Redis instance is simpler. BullMQ and caching use separate ioredis connections to avoid blocking interference. pg-boss would add queue logic to PostgreSQL, mixing concerns. |
| Exponential backoff for AI/external calls | Per-queue backoff configs | Global retry policy, no retries | Different queues have different failure characteristics. AI service failures benefit from exponential backoff (rate limits). Notifications benefit from fixed retry (usually permanent or instant). Global policy can't optimize for both. |
| Bull Board for monitoring | Open-source dashboard | Datadog APM, custom dashboard, no dashboard | Bull Board is free, zero-config, and provides exactly what we need: job inspection, retry, and queue health. Datadog is overkill at this stage. Custom dashboard is unnecessary work. |
| Cron jobs via BullMQ repeatables | Repeatable job scheduler | node-cron, pg_cron, separate cron service | BullMQ repeatable jobs are persistent (survive restarts), idempotent (no duplicates), and observable (visible in Bull Board). node-cron loses schedules on restart. pg_cron is PostgreSQL-level, harder to integrate with app logic. |
| No separate DLQ | Failed jobs stay in their queue's failed list | Dedicated dead-letter queue per queue | BullMQ's built-in failed job management is sufficient. Failed jobs are visible, retryable, and auto-cleaned after the retention period. A separate DLQ adds complexity for the same functionality. |
