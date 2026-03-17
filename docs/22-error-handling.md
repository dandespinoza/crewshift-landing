# 22 - Error Handling and Resilience

> **Permanent reference** for how CrewShift handles failures, retries, circuit breaking, degraded operation, and error reporting across every layer of the system.
> Cross-references: [04-api-standards](./04-api-standards.md) | [06-agent-runtime](./06-agent-runtime.md) | [09-integrations](./09-integrations.md) | [10-ai-service](./10-ai-service.md) | [14-queue-system](./14-queue-system.md) | [18-observability](./18-observability.md)

---

## 1. Error Handling Philosophy

Four principles govern error handling across CrewShift:

1. **Fail gracefully, never crash.** A failure in one agent must not take down the API. A failure in one integration must not prevent other integrations from working. The system must always degrade to a known, safe state.

2. **Never lose data.** If an agent execution fails, the input data is preserved. If a webhook arrives during an outage, it is queued and retried. If a write to QuickBooks fails, the data stays in CrewShift's database and is retried later. The contractor's data is sacred.

3. **Always log with full context.** Every error is logged with `org_id`, `user_id`, `request_id`, agent type, input data, and stack trace. When something fails at 2 AM, the engineer debugging it at 9 AM must have everything they need in the logs.

4. **Users see friendly errors.** Internal stack traces, database constraint names, and provider error codes never reach the frontend. Every error is mapped to a human-readable message. The contractor sees "We couldn't generate your invoice right now. Our team has been notified." -- never `TypeError: Cannot read properties of undefined`.

---

## 2. AI Service Circuit Breaker

The `api` service calls the `ai-service` for all LLM operations. If the AI service is down or slow, the circuit breaker prevents cascading failures by short-circuiting requests and returning a fallback response.

### Implementation

```typescript
// apps/api/src/ai/ai-client.ts

import CircuitBreaker from 'opossum';
import { logger } from '../utils/logger';

interface AIClientOptions {
  baseUrl: string;
  timeout: number;
}

export class AIClient implements AIClientInterface {
  private circuitBreaker: CircuitBreaker;
  private baseUrl: string;

  constructor(options: AIClientOptions) {
    this.baseUrl = options.baseUrl;

    // Create circuit breaker around the HTTP call function
    this.circuitBreaker = new CircuitBreaker(this.callAIService.bind(this), {
      timeout: 30000,                  // 30 second timeout per call
      errorThresholdPercentage: 50,    // Open circuit if 50% of calls fail
      resetTimeout: 30000,             // Try again after 30 seconds
      volumeThreshold: 5,              // Minimum 5 calls before evaluating error rate
      rollingCountTimeout: 60000,      // 60 second rolling window for error rate calculation
      rollingCountBuckets: 6,          // 6 x 10-second buckets = 60 second window
      name: 'ai-service',
    });

    // Fallback: return a degraded response instead of throwing
    this.circuitBreaker.fallback((endpoint: string, payload: any) => {
      logger.warn({ endpoint, circuitState: this.circuitBreaker.status.name }, 'AI service circuit breaker fallback triggered');
      return {
        status: 'ai_unavailable',
        message: 'AI service temporarily unavailable. Request has been queued for retry.',
        fallback: true,
      };
    });

    // Logging for circuit state changes
    this.circuitBreaker.on('open', () => {
      logger.error('AI service circuit breaker OPENED — all AI calls will use fallback');
    });
    this.circuitBreaker.on('halfOpen', () => {
      logger.info('AI service circuit breaker HALF-OPEN — testing if AI service recovered');
    });
    this.circuitBreaker.on('close', () => {
      logger.info('AI service circuit breaker CLOSED — AI service healthy again');
    });
    this.circuitBreaker.on('timeout', () => {
      logger.warn('AI service call timed out');
    });
  }

  // The actual HTTP call (wrapped by circuit breaker)
  private async callAIService(endpoint: string, payload: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': payload.request_id ?? '',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new AIServiceError(
        `AI service returned ${response.status}: ${error.detail ?? 'Unknown error'}`,
        response.status,
        error,
      );
    }

    return response.json();
  }

  // Public methods use the circuit breaker
  async reason(request: ReasonRequest): Promise<ReasonResponse> {
    return this.circuitBreaker.fire('/ai/reason', request);
  }

  async classify(request: ClassifyRequest): Promise<ClassifyResponse> {
    return this.circuitBreaker.fire('/ai/classify', request);
  }

  async extract(request: ExtractRequest): Promise<ExtractResponse> {
    return this.circuitBreaker.fire('/ai/extract', request);
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    return this.circuitBreaker.fire('/ai/embed', request);
  }

  async health(): Promise<{ status: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/ai/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok ? { status: 'ok' } : { status: 'degraded' };
    } catch {
      return { status: 'down' };
    }
  }

  // Expose circuit breaker status for health checks
  getCircuitStatus(): { state: string; stats: any } {
    return {
      state: this.circuitBreaker.status.name, // 'closed', 'open', 'halfOpen'
      stats: this.circuitBreaker.stats,
    };
  }
}
```

### Configuration Parameters Explained

| Parameter | Value | Why |
|---|---|---|
| `timeout` | 30,000 ms (30s) | LLM calls can take 10-20 seconds for complex reasoning. 30s allows for this while catching truly stuck calls. |
| `errorThresholdPercentage` | 50% | If half the calls are failing, something is seriously wrong. Open the circuit to protect the rest of the system. |
| `resetTimeout` | 30,000 ms (30s) | Wait 30 seconds before trying again. This gives the AI service time to recover from transient issues (cold start, rate limit). |
| `volumeThreshold` | 5 | Do not evaluate the error rate until at least 5 calls have been made. A single failed call should not open the circuit. |
| `rollingCountTimeout` | 60,000 ms (60s) | Evaluate error rate over the last 60 seconds. Old failures do not count. |

### Circuit Breaker States

```
CLOSED (normal operation)
  │
  │  50% of calls fail within 60s (minimum 5 calls)
  │
  ▼
OPEN (all calls short-circuited to fallback)
  │
  │  After 30s, allow ONE test call through
  │
  ▼
HALF-OPEN (testing)
  │
  ├── Test call succeeds ──▶ CLOSED (resume normal operation)
  │
  └── Test call fails ──▶ OPEN (back to fallback for another 30s)
```

---

## 3. Graceful Degradation Table

When the AI service is unhealthy, CrewShift does not shut down. It degrades gracefully -- CRUD operations, dashboards, and integration syncs continue to work. Only AI-dependent features are affected.

| AI Service Status | What Works Normally | What Degrades | User Experience |
|---|---|---|---|
| **Healthy** | Everything | Nothing | Full platform functionality |
| **Degraded (slow, >10s latency)** | Everything | Agent execution takes longer, copilot responses slower | "Responses may be slower than usual" banner |
| **Down (circuit breaker open)** | CRUD operations (create/read/update/delete jobs, invoices, customers), Dashboard (all metrics, agent history), Integration sync (read from external, write queued), Manual invoice/estimate creation, File upload/download, Team management, Notifications (in-app, email, SMS) | Agent execution queued for retry, Copilot returns "temporarily unavailable", Automatic estimate generation paused, Proactive insights paused, Workflow steps requiring AI reasoning paused | "AI features temporarily unavailable. Your data is safe and all manual operations work. AI will resume automatically." |
| **Extended outage (>5 min)** | Same as Down | Same as Down, plus: weekly digest skipped, data anonymization skipped | Same message plus email alert to admin |

### Implementation: AI-Down Fallback in Routes

```typescript
// apps/api/src/routes/copilot.routes.ts

app.post('/api/copilot/message', async (request, reply) => {
  // Check circuit breaker status before starting SSE
  const aiStatus = aiClient.getCircuitStatus();

  if (aiStatus.state === 'open') {
    // Return non-streaming degraded response
    return reply.status(503).send({
      error: {
        code: 'AI_UNAVAILABLE',
        message: 'AI assistant is temporarily unavailable. Your message has been saved and will be processed when the service recovers. All manual operations continue to work normally.',
      },
    });
  }

  // Normal copilot flow (SSE streaming)
  // ...
});
```

```typescript
// apps/api/src/agents/runtime.ts

async function executeAgent(definition: AgentDefinition, input: AgentInput): Promise<AgentExecution> {
  try {
    // Step: AI reasoning
    const aiResponse = await aiClient.reason({
      prompt_template: definition.type,
      context: input,
    });

    if (aiResponse.fallback) {
      // AI service is down -- queue for retry instead of failing
      logger.warn({ agentType: definition.type }, 'AI unavailable, queueing agent execution for retry');

      return createExecution({
        status: 'pending',
        input_data: input,
        error: 'AI service temporarily unavailable. Queued for retry.',
      });
    }

    // Continue normal execution...
  } catch (error) {
    // Unexpected error -- still don't crash, still preserve data
    return createExecution({
      status: 'failed',
      input_data: input,
      error: error.message,
    });
  }
}
```

---

## 4. BullMQ Retry Configuration

Each queue has different retry behavior tuned for its workload. Failed jobs are preserved in dead letter storage for inspection and manual retry.

```typescript
// apps/api/src/queue/queues.ts

import { Queue, QueueOptions } from 'bullmq';
import { redis } from '../config/redis';

// ===== PER-QUEUE RETRY CONFIGURATIONS =====

const QUEUE_CONFIGS: Record<string, QueueOptions['defaultJobOptions']> = {

  // AGENT EXECUTION: Moderate retries, exponential backoff
  // Rationale: Agent failures are usually AI service issues (transient).
  // 3 retries with exponential backoff gives the AI service time to recover.
  'agent-execution': {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,               // 2s → 4s → 8s
    },
    removeOnComplete: {
      age: 86400,                // Keep completed jobs for 24 hours
      count: 1000,               // Or max 1000 completed jobs
    },
    removeOnFail: {
      age: 604800,               // Keep failed jobs for 7 days (dead letter)
    },
  },

  // INTEGRATION SYNC: More retries, longer backoff
  // Rationale: External APIs have rate limits, maintenance windows, and transient errors.
  // 5 retries with 5s base delay gives external services time to recover.
  'integration-sync': {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,               // 5s → 10s → 20s → 40s → 80s
    },
    removeOnComplete: {
      age: 86400,
      count: 500,
    },
    removeOnFail: {
      age: 604800,
    },
  },

  // NOTIFICATION: Quick retries, fixed interval
  // Rationale: Email/SMS delivery failures should retry quickly.
  // If Resend/Twilio is down for more than a few seconds, it's a real outage.
  'notification': {
    attempts: 3,
    backoff: {
      type: 'fixed',
      delay: 1000,               // 1s → 1s → 1s
    },
    removeOnComplete: {
      age: 3600,                 // Keep completed for 1 hour
      count: 500,
    },
    removeOnFail: {
      age: 259200,               // Keep failed for 3 days
    },
  },

  // SCHEDULED JOBS: Minimal retries, long delay
  // Rationale: Cron jobs (overdue detection, compliance checks) run daily.
  // If the first attempt fails, retry once after 1 minute. If that fails too,
  // the next daily run will pick it up. No point in aggressive retrying.
  'scheduled': {
    attempts: 2,
    backoff: {
      type: 'fixed',
      delay: 60000,              // 60s → 60s
    },
    removeOnComplete: {
      age: 86400,
      count: 200,
    },
    removeOnFail: {
      age: 604800,
    },
  },

  // PDF GENERATION: Moderate retries, exponential backoff
  // Rationale: Puppeteer can fail due to memory pressure or Chrome crashes.
  // Exponential backoff gives the system time to free resources.
  'pdf-generation': {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 3000,               // 3s → 6s → 12s
    },
    removeOnComplete: {
      age: 86400,
      count: 500,
    },
    removeOnFail: {
      age: 604800,
    },
  },
};

// ===== CREATE QUEUES =====

export const agentQueue = new Queue('agent-execution', {
  connection: redis,
  defaultJobOptions: QUEUE_CONFIGS['agent-execution'],
});

export const syncQueue = new Queue('integration-sync', {
  connection: redis,
  defaultJobOptions: QUEUE_CONFIGS['integration-sync'],
});

export const notificationQueue = new Queue('notification', {
  connection: redis,
  defaultJobOptions: QUEUE_CONFIGS['notification'],
});

export const scheduledQueue = new Queue('scheduled', {
  connection: redis,
  defaultJobOptions: QUEUE_CONFIGS['scheduled'],
});

export const pdfQueue = new Queue('pdf-generation', {
  connection: redis,
  defaultJobOptions: QUEUE_CONFIGS['pdf-generation'],
});
```

### Retry Timeline Visualization

```
agent-execution (3 attempts, exponential 2s):
  Attempt 1: immediate
  Attempt 2: +2s
  Attempt 3: +4s (6s total)
  DEAD LETTER after 6s total

integration-sync (5 attempts, exponential 5s):
  Attempt 1: immediate
  Attempt 2: +5s
  Attempt 3: +10s (15s total)
  Attempt 4: +20s (35s total)
  Attempt 5: +40s (75s total)
  DEAD LETTER after 75s total

notification (3 attempts, fixed 1s):
  Attempt 1: immediate
  Attempt 2: +1s
  Attempt 3: +1s (2s total)
  DEAD LETTER after 2s total

scheduled (2 attempts, fixed 60s):
  Attempt 1: immediate
  Attempt 2: +60s
  DEAD LETTER after 60s total
```

---

## 5. Dead Letter Queue

When all retry attempts are exhausted, failed jobs are preserved in BullMQ's failed job storage. The `removeOnFail.age` setting keeps them for 7 days (3 days for notifications). This functions as a dead letter queue.

### Inspecting Failed Jobs

```typescript
// apps/api/src/services/admin.service.ts

async function getFailedJobs(queueName: string, limit = 50): Promise<FailedJob[]> {
  const queue = getQueue(queueName);
  const failed = await queue.getFailed(0, limit);

  return failed.map(job => ({
    id: job.id,
    name: job.name,
    data: job.data,
    failedReason: job.failedReason,
    attemptsMade: job.attemptsMade,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    stacktrace: job.stacktrace,
  }));
}
```

### Retrying Failed Jobs

```typescript
// apps/api/src/services/admin.service.ts

async function retryFailedJob(queueName: string, jobId: string): Promise<void> {
  const queue = getQueue(queueName);
  const job = await queue.getJob(jobId);

  if (!job) {
    throw new NotFoundError(`Job ${jobId} not found in queue ${queueName}`);
  }

  // Move job back to waiting state
  await job.retry('failed');

  logger.info({ queueName, jobId }, 'Failed job manually retried');
}

async function retryAllFailed(queueName: string): Promise<number> {
  const queue = getQueue(queueName);
  const failed = await queue.getFailed();

  let retried = 0;
  for (const job of failed) {
    await job.retry('failed');
    retried++;
  }

  logger.info({ queueName, retriedCount: retried }, 'All failed jobs retried');
  return retried;
}
```

### Admin API Routes

```typescript
// apps/api/src/routes/admin.routes.ts (owner-only)

app.get('/api/admin/queues/:name/failed', {
  preHandler: [authMiddleware, requireRole('owner', 'admin')],
}, async (request, reply) => {
  const failed = await getFailedJobs(request.params.name);
  return reply.send({ data: failed });
});

app.post('/api/admin/queues/:name/retry/:jobId', {
  preHandler: [authMiddleware, requireRole('owner', 'admin')],
}, async (request, reply) => {
  await retryFailedJob(request.params.name, request.params.jobId);
  return reply.send({ data: { status: 'retried' } });
});
```

---

## 6. Idempotency

Idempotency prevents duplicate actions when the same event fires twice (due to retries, duplicate webhooks, or race conditions). This is critical for financial operations -- sending the same invoice twice to QuickBooks is not acceptable.

### Idempotency Key Format

```
agent_type:entity_id:timestamp_bucket

Examples:
  invoice:job_abc123:2026-03-04T14       (Invoice Agent for job abc123, hour bucket)
  collections:inv_def456:2026-03-04      (Collections Agent for invoice def456, day bucket)
  customer:job_abc123:2026-03-04T14      (Customer Agent for job abc123, hour bucket)
  bookkeeping:inv_def456:2026-03-04      (Bookkeeping Agent for invoice def456, day bucket)
```

The timestamp bucket prevents stale idempotency keys from blocking legitimate retriggers (e.g., a job is re-completed after being reopened).

### Check-Before-Execute Pattern

```typescript
// apps/api/src/agents/runtime.ts

async function executeWithIdempotency(
  agentType: string,
  entityId: string,
  input: AgentInput,
): Promise<AgentExecution> {
  // 1. Generate idempotency key
  const hourBucket = new Date().toISOString().substring(0, 13); // '2026-03-04T14'
  const idempotencyKey = `${agentType}:${entityId}:${hourBucket}`;

  // 2. Check if this execution already exists
  const existing = await db
    .select()
    .from(agentExecutions)
    .where(
      and(
        eq(agentExecutions.org_id, input.org_id),
        sql`metadata->>'idempotency_key' = ${idempotencyKey}`,
      )
    )
    .first();

  if (existing) {
    // Already executed (or in progress)
    switch (existing.status) {
      case 'completed':
      case 'awaiting_review':
        // Already done -- return existing result
        logger.info({ idempotencyKey, existingId: existing.id }, 'Idempotent execution: returning existing result');
        return existing;

      case 'running':
      case 'pending':
        // Still in progress -- return existing execution
        logger.info({ idempotencyKey, existingId: existing.id }, 'Idempotent execution: already in progress');
        return existing;

      case 'failed':
      case 'rejected':
        // Previous attempt failed -- allow retry
        logger.info({ idempotencyKey, existingId: existing.id }, 'Previous execution failed, allowing retry');
        break;

      default:
        return existing;
    }
  }

  // 3. Create new execution with idempotency key
  const execution = await createExecution({
    org_id: input.org_id,
    agent_type: agentType,
    trigger_type: input.trigger_type,
    trigger_source: input.trigger_source,
    status: 'pending',
    input_data: input,
    metadata: { idempotency_key: idempotencyKey },
  });

  // 4. Execute the agent
  return runAgentPipeline(execution, input);
}
```

### Handling Duplicate Webhooks

External services (Stripe, QuickBooks) may send the same webhook multiple times. Deduplication uses the webhook event ID stored in Redis with a 24-hour TTL.

```typescript
// apps/api/src/integrations/webhook.processor.ts

async function processWebhookWithDedup(
  provider: string,
  payload: any,
  eventId: string,
): Promise<{ processed: boolean; reason?: string }> {
  // 1. Check if this webhook event was already processed
  const deduplicationKey = `webhook:${provider}:${eventId}`;
  const alreadyProcessed = await redis.get(deduplicationKey);

  if (alreadyProcessed) {
    logger.info({ provider, eventId }, 'Duplicate webhook event, skipping');
    return { processed: false, reason: 'duplicate' };
  }

  // 2. Mark as processing BEFORE processing (prevents race condition)
  // SET NX = only set if not exists (atomic check-and-set)
  const acquired = await redis.set(deduplicationKey, 'processing', 'EX', 86400, 'NX');

  if (!acquired) {
    // Another worker got it first (race condition between replicas)
    logger.info({ provider, eventId }, 'Webhook event claimed by another worker');
    return { processed: false, reason: 'claimed' };
  }

  try {
    // 3. Process the webhook
    await handleWebhookEvent(provider, payload);

    // 4. Mark as completed
    await redis.set(deduplicationKey, 'completed', 'EX', 86400);

    return { processed: true };
  } catch (error) {
    // 5. On failure, remove the lock so it can be retried
    await redis.del(deduplicationKey);
    throw error;
  }
}
```

---

## 7. Webhook Resilience

Webhooks are the primary mechanism for real-time data from external services. They must be handled with maximum reliability.

### Core Principles

1. **Return 200 immediately.** Never process a webhook inline. The external service has a timeout (usually 5-10 seconds). If we do not respond in time, they will retry and create duplicates.

2. **Async processing.** Queue the webhook payload for background processing via BullMQ.

3. **Signature verification before queuing.** Verify the HMAC signature synchronously (fast) before adding to the queue. Never process an unverified webhook.

4. **Replay protection.** Check the webhook timestamp. Reject events older than 5 minutes (Stripe standard). This prevents replay attacks where an attacker resubmits an old, valid webhook.

5. **Event ID deduplication.** Store the event ID in Redis with a 24-hour TTL. Ignore duplicates.

### Full Webhook Route Implementation

```typescript
// apps/api/src/routes/webhooks.routes.ts

app.post('/api/webhooks/:provider', {
  // Use raw body for signature verification (JSON parsing destroys the original bytes)
  config: { rawBody: true },
}, async (request, reply) => {
  const { provider } = request.params as { provider: string };
  const signature = extractSignature(provider, request.headers);
  const rawBody = request.rawBody;

  // ===== Step 1: Verify signature (sync, fast) =====
  if (!rawBody || !signature) {
    logger.warn({ provider }, 'Webhook missing body or signature');
    return reply.status(401).send();
  }

  const isValid = verifyWebhookSignature(provider, rawBody, signature);
  if (!isValid) {
    logger.warn({ provider }, 'Webhook signature verification failed');
    return reply.status(401).send();
  }

  const payload = JSON.parse(rawBody.toString());

  // ===== Step 2: Replay protection (check timestamp) =====
  const eventTimestamp = extractTimestamp(provider, payload, request.headers);
  if (eventTimestamp) {
    const ageSeconds = (Date.now() - eventTimestamp * 1000);
    if (ageSeconds > 300000) { // 5 minutes
      logger.warn({ provider, ageSeconds }, 'Webhook timestamp too old, rejecting');
      return reply.status(401).send();
    }
  }

  // ===== Step 3: Extract event ID for deduplication =====
  const eventId = extractEventId(provider, payload);

  // ===== Step 4: Enqueue for async processing =====
  await syncQueue.add('webhook', {
    provider,
    payload,
    event_id: eventId,
    received_at: Date.now(),
    signature_verified: true,
  }, {
    // Webhook-specific job options: higher priority
    priority: 1,
  });

  // ===== Step 5: Return 200 immediately =====
  return reply.status(200).send({ received: true });
});


// ===== SIGNATURE VERIFICATION =====

function verifyWebhookSignature(provider: string, rawBody: Buffer, signature: string): boolean {
  switch (provider) {
    case 'stripe':
      try {
        stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
        return true;
      } catch {
        return false;
      }

    case 'quickbooks':
      const expected = crypto
        .createHmac('sha256', env.QUICKBOOKS_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('base64');
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

    case 'jobber':
      const jobberExpected = crypto
        .createHmac('sha256', env.JOBBER_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(jobberExpected));

    default:
      logger.warn({ provider }, 'Unknown webhook provider');
      return false;
  }
}

function extractSignature(provider: string, headers: Record<string, string>): string | null {
  switch (provider) {
    case 'stripe': return headers['stripe-signature'] ?? null;
    case 'quickbooks': return headers['intuit-signature'] ?? null;
    case 'jobber': return headers['x-jobber-hmac-sha256'] ?? null;
    default: return headers['x-webhook-signature'] ?? null;
  }
}

function extractEventId(provider: string, payload: any): string {
  switch (provider) {
    case 'stripe': return payload.id;                              // 'evt_xxx'
    case 'quickbooks': return payload.eventNotifications?.[0]?.dataChangeEvent?.id ?? crypto.randomUUID();
    case 'jobber': return payload.event_id ?? crypto.randomUUID();
    default: return crypto.randomUUID();
  }
}

function extractTimestamp(provider: string, payload: any, headers: Record<string, string>): number | null {
  switch (provider) {
    case 'stripe': return payload.created;                         // Unix timestamp
    case 'quickbooks': return null;                                // QBO doesn't include timestamp
    case 'jobber': return payload.occurred_at ? new Date(payload.occurred_at).getTime() / 1000 : null;
    default: return null;
  }
}
```

---

## 8. Integration Failure Handling

### What Happens When QuickBooks Is Down

External API failures are expected. The system handles them without data loss.

```
Agent creates invoice in CrewShift DB (SUCCESS)
  │
  ├── Attempt to sync to QuickBooks
  │     │
  │     └── QuickBooks returns 5xx or timeout
  │           │
  │           ├── Job moves to retry queue (exponential backoff: 5s, 10s, 20s, 40s, 80s)
  │           │
  │           ├── After 5 retries (75s total), job moves to dead letter
  │           │
  │           ├── Notification sent to org: "QuickBooks sync failed for Invoice #1042.
  │           │     The invoice is saved in CrewShift. We'll retry automatically."
  │           │
  │           └── Integration status updated to 'error' in integrations table
  │
  └── Invoice is safe in CrewShift DB regardless of QuickBooks status
```

### Token Expiration Handling

OAuth tokens expire. The system proactively refreshes them and handles expiration gracefully.

```typescript
// apps/api/src/integrations/oauth.service.ts

async function getValidToken(integration: Integration): Promise<string> {
  // 1. Check if token is still valid
  const expiresAt = new Date(integration.token_expires_at);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // 5 minute buffer

  if (expiresAt.getTime() - now.getTime() > bufferMs) {
    // Token is still valid
    return decryptToken(integration.access_token);
  }

  // 2. Token is expired or about to expire -- refresh it
  logger.info({ provider: integration.provider, orgId: integration.org_id }, 'Refreshing expired OAuth token');

  try {
    const adapter = getAdapter(integration.provider);
    const newTokens = await adapter.refreshToken(integration);

    // 3. Store new tokens (encrypted)
    await db.update(integrations).set({
      access_token: encryptToken(newTokens.access_token),
      refresh_token: encryptToken(newTokens.refresh_token),
      token_expires_at: newTokens.expires_at,
      status: 'connected',
    }).where(eq(integrations.id, integration.id));

    return newTokens.access_token;
  } catch (error) {
    // 4. Refresh failed -- mark integration as error
    logger.error({ provider: integration.provider, orgId: integration.org_id, error }, 'Token refresh failed');

    await db.update(integrations).set({
      status: 'error',
    }).where(eq(integrations.id, integration.id));

    // 5. Notify the user
    await notificationQueue.add('send', {
      org_id: integration.org_id,
      type: 'alert',
      title: `${integration.provider} connection needs attention`,
      body: `Your ${integration.provider} connection has expired. Please reconnect in Settings > Integrations.`,
      channel: 'in_app',
    });

    throw new IntegrationError(`${integration.provider} token refresh failed. Reconnection required.`);
  }
}
```

### Proactive Token Refresh

A scheduled job runs every 4 hours to refresh tokens that will expire within 1 hour:

```typescript
// In scheduled-jobs.ts
{
  name: 'token-refresh',
  cron: '0 */4 * * *',  // Every 4 hours
  handler: async () => {
    const expiringIntegrations = await db
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.status, 'connected'),
          lte(integrations.token_expires_at, sql`NOW() + interval '1 hour'`),
        )
      );

    for (const integration of expiringIntegrations) {
      try {
        await getValidToken(integration);
      } catch (error) {
        logger.error({ integrationId: integration.id, error }, 'Proactive token refresh failed');
      }
    }
  },
}
```

---

## 9. Database Error Handling

### Connection Pool Exhaustion

When all database connections are in use, new queries queue until a connection is available or the timeout is reached.

```typescript
// apps/api/src/config/supabase.ts

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,                       // Max connections (Railway container: 20 is reasonable)
  idleTimeoutMillis: 30000,      // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Fail if no connection available within 5s
});

// Monitor pool health
pool.on('error', (err) => {
  logger.error({ error: err }, 'Unexpected database pool error');
});

pool.on('connect', () => {
  logger.debug('New database connection created');
});

// Expose pool stats for health checks
export function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}
```

### Transaction Deadlock Handling

When two transactions attempt to lock the same rows in different orders, PostgreSQL detects the deadlock and terminates one of them. The terminated transaction should be retried.

```typescript
// apps/api/src/utils/db-helpers.ts

async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; retryDelay?: number } = {},
): Promise<T> {
  const { maxRetries = 3, retryDelay = 100 } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isDeadlock = error.code === '40P01';          // PostgreSQL deadlock detected
      const isSerializationFailure = error.code === '40001'; // Serialization failure
      const isRetryable = isDeadlock || isSerializationFailure;

      if (isRetryable && attempt < maxRetries) {
        logger.warn({ error: error.code, attempt }, 'Retryable DB error, retrying');
        await sleep(retryDelay * attempt); // Linear backoff
        continue;
      }

      throw error;
    }
  }

  throw new Error('withRetry: unreachable');
}
```

### Constraint Violation Handling

```typescript
// apps/api/src/utils/errors.ts

function handleDatabaseError(error: any): never {
  // Unique constraint violation
  if (error.code === '23505') {
    const match = error.detail?.match(/Key \((.+?)\)=\((.+?)\) already exists/);
    const field = match?.[1] ?? 'unknown';
    throw new ConflictError(`A record with this ${field} already exists`);
  }

  // Foreign key violation
  if (error.code === '23503') {
    throw new ValidationError('Referenced record does not exist');
  }

  // Not null violation
  if (error.code === '23502') {
    const column = error.column ?? 'unknown';
    throw new ValidationError(`${column} is required`);
  }

  // Check constraint violation
  if (error.code === '23514') {
    throw new ValidationError('Value does not meet validation requirements');
  }

  // Unknown database error
  logger.error({ error }, 'Unhandled database error');
  throw new InternalError('A database error occurred');
}
```

---

## 10. Validation Errors

### Request Body Validation (Zod)

Every API route validates the request body using Zod schemas. Validation errors are caught and returned as structured error responses.

```typescript
// apps/api/src/routes/invoices.routes.ts

import { z } from 'zod';

const CreateInvoiceSchema = z.object({
  job_id: z.string().uuid('Invalid job ID format'),
  customer_id: z.string().uuid('Invalid customer ID format'),
  line_items: z.array(z.object({
    description: z.string().min(1, 'Line item description is required'),
    quantity: z.number().positive('Quantity must be positive'),
    unit_price: z.number().min(0, 'Unit price cannot be negative'),
    total: z.number().min(0, 'Total cannot be negative'),
  })).min(1, 'At least one line item is required'),
  tax_rate: z.number().min(0).max(1).optional(),
  due_date: z.string().datetime().optional(),
  notes: z.string().max(5000).optional(),
});

app.post('/api/invoices', {
  preHandler: [authMiddleware],
}, async (request, reply) => {
  const parsed = CreateInvoiceSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request body validation failed',
        details: parsed.error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      },
    });
  }

  // Proceed with validated data
  const invoice = await invoiceService.create(request.orgId, parsed.data);
  return reply.status(201).send({ data: invoice });
});
```

### Agent Output Validation

After the AI service returns a response, the agent runtime validates it against the agent definition's output rules. This catches AI hallucinations and structural errors before data is written to the database.

```typescript
// apps/api/src/agents/runtime.ts (validation step)

interface ValidationRule {
  expression: string;
  message: string;
}

const INVOICE_VALIDATION_RULES: ValidationRule[] = [
  {
    expression: 'output.line_items.length > 0',
    message: 'Invoice must have at least one line item',
  },
  {
    expression: 'Math.abs(output.subtotal - output.line_items.reduce((s, i) => s + i.total, 0)) < 0.01',
    message: 'Subtotal must equal sum of line item totals',
  },
  {
    expression: 'Math.abs(output.total - (output.subtotal + output.tax_amount)) < 0.01',
    message: 'Total must equal subtotal + tax amount',
  },
  {
    expression: 'output.total > 0',
    message: 'Invoice total must be positive',
  },
  {
    expression: 'output.total <= input.job.total_amount * 1.5',
    message: 'Invoice total cannot exceed 150% of job amount (sanity check)',
  },
  {
    expression: 'output.line_items.every(i => i.quantity > 0)',
    message: 'All line item quantities must be positive',
  },
  {
    expression: 'output.line_items.every(i => i.unit_price >= 0)',
    message: 'All line item prices must be non-negative',
  },
];

function validateAgentOutput(output: any, input: any, rules: ValidationRule[]): ValidationResult {
  const failures: string[] = [];

  for (const rule of rules) {
    try {
      // Evaluate the expression in a sandboxed context
      const fn = new Function('output', 'input', `return ${rule.expression}`);
      const result = fn(output, input);

      if (!result) {
        failures.push(rule.message);
      }
    } catch (error) {
      failures.push(`Validation rule error: ${rule.expression} - ${error.message}`);
    }
  }

  return {
    valid: failures.length === 0,
    failures,
  };
}
```

---

## 11. Error Response Format

All errors follow a consistent shape. The frontend never needs to guess the structure of an error response.

### Standard ApiError Shape

```typescript
// apps/api/src/utils/errors.ts

interface ApiErrorResponse {
  error: {
    code: string;           // Machine-readable: 'VALIDATION_ERROR', 'NOT_FOUND', etc.
    message: string;        // Human-readable: "Invoice not found"
    details?: any;          // Optional: field-level validation errors, additional context
    request_id?: string;    // Request ID for support/debugging reference
  };
}
```

### Error Codes and HTTP Status Mapping

| HTTP Status | Error Code | When Used | Example Message |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | Request body fails Zod schema validation | "Request body validation failed" |
| 401 | `AUTH_REQUIRED` | Missing or expired JWT token | "Authentication required" |
| 401 | `AUTH_INVALID` | Malformed or tampered JWT | "Invalid authentication token" |
| 403 | `FORBIDDEN` | User role lacks permission for this action | "You don't have permission to perform this action" |
| 403 | `NO_ORG` | JWT missing org_id claim | "No organization associated with this account" |
| 404 | `NOT_FOUND` | Resource does not exist (or belongs to different org) | "Invoice not found" |
| 409 | `CONFLICT` | Duplicate resource (unique constraint or idempotency key hit) | "An invoice for this job already exists" |
| 422 | `UNPROCESSABLE` | Valid request but cannot process (business rule violation) | "Cannot send an invoice that has not been generated" |
| 429 | `RATE_LIMITED` | Too many requests within the rate limit window | "Too many requests. Please try again in 30 seconds." |
| 500 | `INTERNAL_ERROR` | Unexpected server error (catch-all) | "An unexpected error occurred. Our team has been notified." |
| 503 | `AI_UNAVAILABLE` | AI service down, circuit breaker open | "AI features temporarily unavailable" |
| 503 | `INTEGRATION_ERROR` | External integration temporarily unavailable | "QuickBooks is temporarily unreachable. Your data is saved." |

### Error Classes

```typescript
// apps/api/src/utils/errors.ts

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: any;

  constructor(message: string, statusCode: number, code: string, details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class AuthError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTH_REQUIRED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to perform this action") {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string) {
    super(message, 422, 'UNPROCESSABLE');
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter: number) {
    super(`Too many requests. Please try again in ${retryAfter} seconds.`, 429, 'RATE_LIMITED');
  }
}

export class AIUnavailableError extends AppError {
  constructor() {
    super('AI features temporarily unavailable. Your data is safe and all manual operations work normally.', 503, 'AI_UNAVAILABLE');
  }
}

export class IntegrationError extends AppError {
  constructor(message: string) {
    super(message, 503, 'INTEGRATION_ERROR');
  }
}

export class InternalError extends AppError {
  constructor(message = 'An unexpected error occurred. Our team has been notified.') {
    super(message, 500, 'INTERNAL_ERROR');
  }
}
```

### Global Error Handler

```typescript
// apps/api/src/server.ts

app.setErrorHandler((error, request, reply) => {
  const requestId = request.id;

  // Known application errors
  if (error instanceof AppError) {
    logger.warn({
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      request_id: requestId,
      org_id: request.orgId,
      user_id: request.userId,
      url: request.url,
      method: request.method,
    }, 'Application error');

    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        request_id: requestId,
      },
    });
  }

  // Fastify validation errors (from schema validation)
  if (error.validation) {
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.validation,
        request_id: requestId,
      },
    });
  }

  // Unknown errors -- log full context, return generic message
  logger.error({
    error: error.message,
    stack: error.stack,
    request_id: requestId,
    org_id: request.orgId,
    user_id: request.userId,
    url: request.url,
    method: request.method,
    body: request.body,
    params: request.params,
    query: request.query,
  }, 'Unhandled error');

  return reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Our team has been notified.',
      request_id: requestId,
    },
  });
});
```

---

## 12. Error Logging

Every error is logged with full context. The structured logging format ensures every log line is searchable and correlatable.

### What Gets Logged

| Field | Source | Purpose |
|---|---|---|
| `request_id` | `X-Request-ID` header (or auto-generated) | Correlate logs across api + ai-service |
| `org_id` | JWT custom claim | Identify which organization was affected |
| `user_id` | JWT `sub` claim | Identify which user triggered the action |
| `error.code` | AppError class | Machine-readable error type |
| `error.message` | Error message | Human-readable description |
| `error.stack` | Stack trace | Where the error originated (internal errors only) |
| `url` | Request URL | Which endpoint was hit |
| `method` | HTTP method | GET, POST, PATCH, etc. |
| `body` | Request body | What data was submitted (scrubbed of tokens/passwords) |
| `agent_type` | Agent execution context | Which agent was running (if applicable) |
| `provider` | Integration context | Which external service was involved (if applicable) |
| `duration_ms` | Timer | How long the request took before failing |
| `level` | Log level | `error` for 5xx, `warn` for 4xx |

### Log Scrubbing

Sensitive fields are redacted before logging:

```typescript
// apps/api/src/utils/logger.ts

const SCRUB_FIELDS = [
  'password', 'access_token', 'refresh_token', 'api_key',
  'secret', 'authorization', 'cookie', 'stripe_secret',
];

function scrubSensitiveData(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  const scrubbed = { ...obj };
  for (const key of Object.keys(scrubbed)) {
    if (SCRUB_FIELDS.some(f => key.toLowerCase().includes(f))) {
      scrubbed[key] = '[REDACTED]';
    } else if (typeof scrubbed[key] === 'object') {
      scrubbed[key] = scrubSensitiveData(scrubbed[key]);
    }
  }
  return scrubbed;
}
```

---

## 13. User-Facing Errors

Internal error details (stack traces, database constraint names, provider error messages) are never exposed to users. Every internal error is mapped to a friendly message.

### Internal-to-Friendly Mapping

```typescript
// apps/api/src/utils/error-messages.ts

const FRIENDLY_MESSAGES: Record<string, string> = {
  // Database errors
  '23505': 'This record already exists.',
  '23503': 'A required related record was not found.',
  '23502': 'A required field is missing.',

  // AI errors
  'AI_TIMEOUT': 'The AI is taking longer than usual. Please try again in a moment.',
  'AI_UNAVAILABLE': 'AI features are temporarily unavailable. Your data is safe and all manual operations work normally.',

  // Integration errors
  'QUICKBOOKS_AUTH': 'Your QuickBooks connection needs to be refreshed. Go to Settings > Integrations to reconnect.',
  'STRIPE_INVALID': 'The payment could not be processed. Please verify the payment details.',
  'INTEGRATION_SYNC_FAILED': 'We could not sync with your connected tools right now. We will retry automatically.',

  // Generic
  'INTERNAL': 'Something went wrong on our end. Our team has been notified and is looking into it.',
};

export function getFriendlyMessage(errorCode: string): string {
  return FRIENDLY_MESSAGES[errorCode] ?? FRIENDLY_MESSAGES['INTERNAL'];
}
```

### What Users See vs. What Engineers See

| Scenario | User Sees | Engineer Sees (in logs) |
|---|---|---|
| Database constraint violation | "This record already exists." | `{ code: '23505', detail: 'Key (org_id, agent_type)=(abc, invoice) already exists', table: 'agent_configs' }` |
| AI service timeout | "The AI is taking longer than usual. Please try again in a moment." | `{ error: 'ETIMEDOUT', url: '/ai/reason', timeout: 30000, org_id: 'abc', agent_type: 'invoice' }` |
| QuickBooks API 500 | "We could not sync with your connected tools right now. We'll retry automatically." | `{ provider: 'quickbooks', status: 500, body: '{"Fault":{"Error":{"code":"1000"...}}}', org_id: 'abc' }` |
| Null reference in code | "Something went wrong on our end. Our team has been notified." | `{ error: "Cannot read properties of undefined (reading 'total')", stack: '...', org_id: 'abc', agent_type: 'invoice', input: {...} }` |

---

## 14. Recovery Patterns

### Auto-Retry for Transient Failures

| Failure Type | Pattern | Example |
|---|---|---|
| AI service timeout | Circuit breaker + BullMQ retry | LLM call takes >30s, retried 3 times with exponential backoff |
| External API 5xx | BullMQ retry (integration-sync queue) | QuickBooks returns 500, retried 5 times over 75 seconds |
| Database connection timeout | pg Pool auto-reconnect | Connection dropped, pool creates new connection |
| Redis connection lost | ioredis auto-reconnect | Redis restarts, BullMQ reconnects automatically |
| Network blip | HTTP client retry | Fetch fails, retried by circuit breaker |

### Manual Retry for Permanent Failures (Review Queue)

When auto-retry is exhausted, the failed operation moves to the dead letter queue. Admins can inspect and retry from the admin panel or API.

```
Failed job in dead letter
  │
  ├── Admin inspects via GET /api/admin/queues/:name/failed
  │
  ├── Admin fixes the root cause (e.g., reconnects QuickBooks)
  │
  └── Admin retries via POST /api/admin/queues/:name/retry/:jobId
```

### Circuit Breaker for Cascading Failures

The circuit breaker prevents the Node API from being overwhelmed by timeouts when the AI service is down.

```
Without circuit breaker:
  API receives 100 requests/min
  Each waits 30s for AI service timeout
  100 x 30s = 3000 seconds of blocked connections
  API thread pool exhausted → ENTIRE API DOWN

With circuit breaker:
  AI service fails 3 of 5 calls → circuit OPENS
  Subsequent calls immediately return fallback (5ms)
  CRUD, dashboard, integrations continue working
  After 30s → circuit tests → if AI is back → resume
```

---

## 15. Monitoring Integration

Error handling ties directly into the observability stack (see [18-observability.md](./18-observability.md)).

### Error Rate Metrics

| Metric | Source | Alert Threshold | Action |
|---|---|---|---|
| API 5xx error rate | Fastify error handler | > 1% over 5 minutes | Page on-call engineer |
| Agent execution failure rate | `agent_executions` table | > 5% over 5 minutes | Review failing agent type |
| AI service circuit breaker opens | Circuit breaker event | Any open event | Check AI service health |
| Integration sync failure rate | `integration-sync` queue | > 3 consecutive failures per provider | Check provider status page |
| Dead letter queue depth | BullMQ failed count | > 10 jobs in any queue | Inspect and triage |
| Webhook verification failure rate | Webhook route | > 10% | Possible security issue (invalid signatures) |

### Error Alerting

```typescript
// apps/api/src/utils/alerting.ts

// Check error rates periodically and trigger alerts
async function checkErrorRates() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  // Agent failure rate
  const totalExecutions = await db.select({ count: sql`COUNT(*)` })
    .from(agentExecutions)
    .where(gte(agentExecutions.created_at, fiveMinutesAgo));

  const failedExecutions = await db.select({ count: sql`COUNT(*)` })
    .from(agentExecutions)
    .where(and(
      gte(agentExecutions.created_at, fiveMinutesAgo),
      eq(agentExecutions.status, 'failed'),
    ));

  const failureRate = failedExecutions[0].count / Math.max(totalExecutions[0].count, 1);

  if (failureRate > 0.05) {
    logger.error({
      metric: 'agent_failure_rate',
      value: failureRate,
      threshold: 0.05,
      window: '5m',
    }, 'ALERT: Agent failure rate exceeds threshold');
  }
}
```

---

## 16. Summary

| Concern | Solution | Reference |
|---|---|---|
| AI service down | Circuit breaker (opossum) with fallback response | Section 2 |
| Gradual AI degradation | Graceful degradation table -- CRUD works, AI features queued | Section 3 |
| Queue job failure | Per-queue retry configs with exponential/fixed backoff | Section 4 |
| Exhausted retries | Dead letter queue (7-day retention) with manual retry | Section 5 |
| Duplicate agent execution | Idempotency keys: `agent_type:entity_id:timestamp_bucket` | Section 6 |
| Duplicate webhooks | Event ID deduplication via Redis (24h TTL) | Section 7 |
| External API down | Queue write-back, retry later, notify user | Section 8 |
| OAuth token expiration | Proactive refresh (every 4 hours), graceful degradation | Section 8 |
| Database errors | Connection pooling, deadlock retry, constraint handling | Section 9 |
| Invalid request data | Zod schema validation on all request bodies | Section 10 |
| Invalid AI output | Agent validation rules (math checks, range checks, sanity checks) | Section 10 |
| Error response shape | Standard `ApiError` format with code, message, details | Section 11 |
| Error logging | Full context: org_id, user_id, request_id, stack trace, input data | Section 12 |
| User-facing errors | Internal errors mapped to friendly messages, never expose internals | Section 13 |
| Recovery | Auto-retry (transient), manual retry (permanent), circuit breaker (cascading) | Section 14 |
| Error monitoring | Error rate metrics, alerting thresholds, dead letter queue depth | Section 15 |

The error handling strategy ensures that CrewShift is resilient to every category of failure: AI provider outages, external API downtime, database issues, invalid data, and unexpected code errors. The contractor's experience degrades gracefully -- they always know what happened, their data is always safe, and the system recovers automatically when possible.
