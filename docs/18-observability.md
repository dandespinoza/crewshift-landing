# 18 — Observability & Monitoring

> **Related Docs:** [01-project-structure.md](./01-project-structure.md) (service layout), [10-ai-service.md](./10-ai-service.md) (Python AI service), [14-queue-system.md](./14-queue-system.md) (BullMQ workers), [22-error-handling.md](./22-error-handling.md) (error handling & resilience), [21-deployment.md](./21-deployment.md) (Railway deployment)

---

## Overview

CrewShift runs two services (Node.js API + Python AI service) with Redis-backed queues and a Supabase PostgreSQL database. Observability covers structured logging, request tracing across both services, key metrics, health checks, error tracking, and alerting. The strategy is designed for a small team at early scale — minimal infrastructure, maximum signal.

**Philosophy:** Log everything structured, alert on what matters, defer expensive monitoring infrastructure until scale warrants it. Railway's built-in logging handles the first 1,000 customers. Axiom or Datadog enters the picture when the team is large enough to have someone looking at dashboards.

---

## Logging Strategy

### Principles

1. **JSON-structured logs everywhere.** Both services emit JSON to stdout. No free-form text logs. Every log line is machine-parseable.
2. **Consistent fields across services.** Both Node and Python include the same core fields: `request_id`, `org_id`, `timestamp`, `level`, `service`. This enables cross-service correlation.
3. **Log the "why", not just the "what".** Bad: `"invoice created"`. Good: `{ event: "invoice.created", org_id: "uuid", invoice_id: "uuid", amount_cents: 184000, agent_type: "invoice", trigger: "job.completed", duration_ms: 2100 }`.
4. **No secrets in logs.** Token values, API keys, passwords, and PII (customer emails, phone numbers) are never logged. References (IDs, types) are logged instead.

### Log Levels

| Level | When to Use | Examples |
|-------|------------|---------|
| `debug` | Detailed diagnostic info. Off in production by default. | Step-by-step agent execution, full context window contents, SQL queries |
| `info` | Normal operations that are worth recording. | Request received, agent execution started/completed, sync completed, notification sent |
| `warn` | Something unexpected but not broken. | Slow query (>1s), provider fallback triggered, rate limit approached, token refresh near expiry |
| `error` | Something failed and needs attention. | Agent execution failed, AI service unreachable, integration sync failed, 5xx response |

**Production default level:** `info`. Debug logging is enabled per-request by passing `X-Debug: true` header (requires admin role) or per-service via the `LOG_LEVEL` environment variable.

---

## Node Logging (Pino)

Fastify uses Pino as its default logger. Pino was chosen because it is the fastest JSON logger in the Node.js ecosystem and integrates natively with Fastify — zero configuration overhead.

### Configuration

```typescript
// src/utils/logger.ts

import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL ?? 'info',
  transport: env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
    : undefined, // JSON to stdout in production (Railway captures stdout)

  // Base fields included in every log line
  base: {
    service: 'crewshift-api',
    env: env.NODE_ENV,
    version: env.APP_VERSION ?? '0.0.0',
  },

  // Custom serializers to control what gets logged for requests/responses
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      request_id: req.headers['x-request-id'] ?? req.id,
      org_id: req.orgId,           // set by auth middleware
      user_id: req.userId,         // set by auth middleware
      role: req.role,              // set by auth middleware
      user_agent: req.headers['user-agent'],
      content_length: req.headers['content-length'],
    }),
    res: (res) => ({
      status_code: res.statusCode,
    }),
    err: pino.stdSerializers.err,   // includes stack trace
  },

  // Redact sensitive fields that might accidentally appear in logs
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'access_token',
      'refresh_token',
      'api_key',
      'secret',
    ],
    censor: '[REDACTED]',
  },

  // Timestamp format
  timestamp: pino.stdTimeFunctions.isoTime,
});
```

### Fastify Integration

```typescript
// src/server.ts

import Fastify from 'fastify';
import { logger } from './utils/logger';

const app = Fastify({
  logger,                         // Pino instance passed directly to Fastify
  requestIdHeader: 'x-request-id', // Use incoming X-Request-ID or generate one
  genReqId: (req) => req.headers['x-request-id'] as string ?? crypto.randomUUID(),
  disableRequestLogging: false,   // Fastify auto-logs request/response
});

// Fastify automatically logs:
// - "incoming request" at info level (with serialized req)
// - "request completed" at info level (with serialized res + responseTime)
```

### Example Log Output (Production JSON)

```json
{
  "level": 30,
  "time": "2026-03-04T14:30:00.123Z",
  "service": "crewshift-api",
  "env": "production",
  "version": "1.2.0",
  "req": {
    "method": "POST",
    "url": "/api/copilot/message",
    "request_id": "req_abc123def456",
    "org_id": "org_uuid_here",
    "user_id": "user_uuid_here",
    "role": "owner"
  },
  "msg": "incoming request"
}
```

```json
{
  "level": 30,
  "time": "2026-03-04T14:30:02.456Z",
  "service": "crewshift-api",
  "env": "production",
  "version": "1.2.0",
  "req": {
    "method": "POST",
    "url": "/api/copilot/message",
    "request_id": "req_abc123def456",
    "org_id": "org_uuid_here",
    "user_id": "user_uuid_here"
  },
  "res": {
    "status_code": 200
  },
  "responseTime": 2333,
  "msg": "request completed"
}
```

### Custom Log Events

Beyond Fastify's auto-logged request/response, custom events are logged at key points:

```typescript
// Agent execution lifecycle
logger.info({ orgId, agentType, executionId, trigger }, 'Agent execution started');
logger.info({ orgId, agentType, executionId, durationMs, aiModel, tokenCount, costCents }, 'Agent execution completed');
logger.error({ orgId, agentType, executionId, error: err.message, stack: err.stack }, 'Agent execution failed');

// Integration sync
logger.info({ orgId, provider, recordsSynced }, 'Integration sync completed');
logger.warn({ orgId, provider, error: err.message }, 'Integration sync failed, will retry');

// AI service communication
logger.info({ orgId, endpoint, modelTier, requestId }, 'AI service request sent');
logger.warn({ orgId, endpoint, latencyMs, requestId }, 'AI service slow response');
logger.error({ orgId, endpoint, statusCode, requestId }, 'AI service request failed');

// Notification delivery
logger.info({ orgId, channel, type, notificationId }, 'Notification sent');
logger.error({ orgId, channel, error: err.message }, 'Notification delivery failed');

// Usage limits
logger.warn({ orgId, resource, current, limit, percentage }, 'Usage limit warning (80%)');
logger.warn({ orgId, resource, current, limit }, 'Usage limit reached (100%)');
```

---

## Python Logging (structlog)

The Python AI service uses structlog for structured JSON logging. structlog was chosen because it is the standard for structured logging in Python, it produces JSON output natively, and it integrates cleanly with FastAPI's async request lifecycle.

### Configuration

```python
# apps/ai-service/app/config.py

import structlog
import logging
import sys
import os

def configure_logging():
    """Configure structlog for JSON output."""

    shared_processors = [
        structlog.contextvars.merge_contextvars,    # Merge request-scoped context
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    if os.getenv("ENVIRONMENT") == "development":
        # Pretty-print in development
        structlog.configure(
            processors=[
                *shared_processors,
                structlog.dev.ConsoleRenderer(),
            ],
            wrapper_class=structlog.make_filtering_bound_logger(logging.DEBUG),
            context_class=dict,
            logger_factory=structlog.PrintLoggerFactory(),
            cache_logger_on_first_use=True,
        )
    else:
        # JSON to stdout in production
        structlog.configure(
            processors=[
                *shared_processors,
                structlog.processors.JSONRenderer(),
            ],
            wrapper_class=structlog.make_filtering_bound_logger(
                getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper())
            ),
            context_class=dict,
            logger_factory=structlog.PrintLoggerFactory(),
            cache_logger_on_first_use=True,
        )

logger = structlog.get_logger(service="crewshift-ai-service")
```

### FastAPI Middleware for Request Context

```python
# apps/ai-service/app/middleware.py

import structlog
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
import time

class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Extract or generate request ID
        request_id = request.headers.get("x-request-id", str(uuid.uuid4()))

        # Extract org_id from request (passed by Node API)
        org_id = request.headers.get("x-org-id", "unknown")

        # Bind context for all log lines in this request
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            org_id=org_id,
            method=request.method,
            path=request.url.path,
        )

        logger = structlog.get_logger()
        start_time = time.time()

        logger.info("request_started")

        try:
            response = await call_next(request)
            latency_ms = int((time.time() - start_time) * 1000)

            logger.info(
                "request_completed",
                status_code=response.status_code,
                latency_ms=latency_ms,
            )

            # Add request ID to response headers
            response.headers["x-request-id"] = request_id

            return response
        except Exception as e:
            latency_ms = int((time.time() - start_time) * 1000)
            logger.error(
                "request_failed",
                error=str(e),
                latency_ms=latency_ms,
                exc_info=True,
            )
            raise
```

### Every AI Call Logs Core Fields

```python
# apps/ai-service/app/providers/router.py

async def reason(self, request: ReasonRequest) -> AIResponse:
    logger = structlog.get_logger()

    # These fields are included via contextvars (from middleware):
    # request_id, org_id, method, path

    # Log the AI call with provider and model details
    provider_name = self.select_provider(request)
    provider = self.providers[provider_name]
    model = request.model or self.default_models[provider_name]

    logger.info(
        "ai_call_started",
        provider=provider_name,
        model=model,
        prompt_template=request.prompt_template,
        model_tier=request.model_tier,
    )

    start_time = time.time()

    try:
        response = await provider.reason(request)
        latency_ms = int((time.time() - start_time) * 1000)

        logger.info(
            "ai_call_completed",
            provider=response.provider,
            model=response.model,
            latency_ms=latency_ms,
            tokens_input=response.tokens_input,
            tokens_output=response.tokens_output,
            tokens_total=response.tokens_total,
            cost_cents=response.cost_cents,
            cached=response.cached,
        )

        return response

    except ProviderError as e:
        latency_ms = int((time.time() - start_time) * 1000)

        logger.warn(
            "ai_call_failed_attempting_fallback",
            provider=provider_name,
            model=model,
            latency_ms=latency_ms,
            error=str(e),
        )

        # Try fallback provider
        fallback_name = self.get_fallback(provider_name)
        if fallback_name:
            fallback_response = await self.providers[fallback_name].reason(request)
            logger.info(
                "ai_fallback_succeeded",
                primary_provider=provider_name,
                fallback_provider=fallback_name,
                model=fallback_response.model,
            )
            return fallback_response

        raise
```

### Example Log Output (Python, Production JSON)

```json
{
  "service": "crewshift-ai-service",
  "timestamp": "2026-03-04T14:30:00.789Z",
  "level": "info",
  "event": "ai_call_completed",
  "request_id": "req_abc123def456",
  "org_id": "org_uuid_here",
  "method": "POST",
  "path": "/ai/reason",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20260514",
  "latency_ms": 2100,
  "tokens_input": 1200,
  "tokens_output": 850,
  "tokens_total": 2050,
  "cost_cents": 15,
  "cached": false
}
```

---

## Request ID Tracing

### How It Works

A single request ID traces a user action across both services:

```
                        X-Request-ID: req_abc123def456
                              |
Frontend ──POST /api/copilot/message──> Node API
                              |
                    Node generates req_abc123def456
                    (or uses incoming X-Request-ID)
                              |
              Logs: { request_id: "req_abc123def456", ... }
                              |
              Node calls Python AI service
              with header: X-Request-ID: req_abc123def456
                              |
                         Python AI Service
              Logs: { request_id: "req_abc123def456", ... }
                              |
              Python calls Anthropic API
              (request_id in metadata for Anthropic's logs)
                              |
                         Response flows back
                              |
              agent_executions.metadata.request_id = "req_abc123def456"
```

### Generation

```typescript
// Node: src/server.ts
// Fastify generates UUID if X-Request-ID header is not present
const app = Fastify({
  genReqId: (req) => req.headers['x-request-id'] as string ?? `req_${crypto.randomUUID()}`,
});
```

### Propagation to Python AI Service

```typescript
// Node: src/ai/ai-client.ts

class AIClient {
  async reason(params: ReasonParams): Promise<AIResponse> {
    const response = await fetch(`${env.AI_SERVICE_URL}/ai/reason`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': params.requestId,    // propagated from incoming request
        'X-Org-ID': params.orgId,            // org context for Python logging
      },
      body: JSON.stringify(params),
    });

    return response.json();
  }
}
```

### Storage in agent_executions

```typescript
// The request_id is stored in execution metadata for post-hoc debugging
await supabase
  .from('agent_executions')
  .update({
    metadata: {
      ...metadata,
      request_id: requestId,   // enables searching logs by execution
    },
  })
  .eq('id', executionId);
```

### Searching by Request ID

To debug a specific agent execution, search logs across both services:

```bash
# Railway CLI log search (or grep Railway's log stream)
# Find all log lines for a specific request
railway logs --filter "req_abc123def456"

# Or in Axiom/Datadog (when adopted):
# request_id:"req_abc123def456" | sort timestamp
```

---

## Key Metrics

### Metrics Table

| Metric Name | Source | What It Measures | Alert Threshold | Collection Method |
|-------------|--------|-----------------|-----------------|-------------------|
| `agent.success_rate` | `agent_executions` table | % of executions with status `completed` vs total | < 95% over 1 hour | SQL query on scheduled interval |
| `agent.execution_duration_p50` | `agent_executions.duration_ms` | Median agent execution time | > 10,000ms | SQL percentile query |
| `agent.execution_duration_p99` | `agent_executions.duration_ms` | 99th percentile execution time | > 30,000ms | SQL percentile query |
| `ai.latency_p50` | Python logs (`latency_ms` field) | Median AI provider response time | > 5,000ms | Log aggregation |
| `ai.latency_p99` | Python logs (`latency_ms` field) | 99th percentile AI response time | > 10,000ms | Log aggregation |
| `ai.fallback_rate` | Python logs (`ai_fallback_succeeded` event) | % of AI calls that used fallback provider | > 5% over 1 hour | Log count ratio |
| `queue.depth` | BullMQ `getWaitingCount()` | Number of jobs waiting in each queue | > 100 (agent), > 500 (notification) | BullMQ API polling |
| `queue.processing_time_p50` | BullMQ job `processedOn - timestamp` | Median time from enqueue to complete | > 30,000ms | BullMQ event listener |
| `sync.failure_rate` | `integration_sync_log` or worker logs | % of sync jobs that fail | > 3 consecutive failures per org | Worker event tracking |
| `api.error_rate` | Fastify response logs (status >= 500) | % of API requests returning 5xx | > 1% over 5 minutes | Log aggregation |
| `api.latency_p50` | Fastify `responseTime` field | Median API response time | > 500ms | Log aggregation |
| `api.latency_p99` | Fastify `responseTime` field | 99th percentile API response time | > 3,000ms | Log aggregation |

### Metric Collection

At early scale, metrics are derived from logs and database queries rather than a dedicated metrics pipeline:

```typescript
// src/services/metrics.service.ts

class MetricsService {
  // Called by scheduled.worker.ts every 5 minutes
  async collectMetrics(): Promise<void> {
    const window = new Date(Date.now() - 5 * 60 * 1000); // last 5 minutes

    // Agent success rate
    const { data: executions } = await supabase
      .from('agent_executions')
      .select('status')
      .gte('created_at', window.toISOString());

    const total = executions?.length ?? 0;
    const succeeded = executions?.filter(e => e.status === 'completed').length ?? 0;
    const successRate = total > 0 ? (succeeded / total) * 100 : 100;

    if (successRate < 95 && total >= 10) {
      logger.error({
        metric: 'agent.success_rate',
        value: successRate,
        threshold: 95,
        total_executions: total,
        failed_executions: total - succeeded,
      }, 'Agent success rate below threshold');

      // Trigger alert notification
      await createAlertNotification('Agent success rate below 95%', {
        successRate,
        total,
        failed: total - succeeded,
      });
    }

    // Queue depth check
    const queues = ['agent-execution', 'notifications', 'integration-sync'];
    for (const queueName of queues) {
      const queue = getQueue(queueName);
      const waiting = await queue.getWaitingCount();
      const active = await queue.getActiveCount();

      if (waiting > 100) {
        logger.warn({
          metric: 'queue.depth',
          queue: queueName,
          waiting,
          active,
        }, 'Queue depth elevated');
      }
    }

    // Log metrics summary
    logger.info({
      metric: 'metrics_snapshot',
      agent_success_rate: successRate,
      agent_executions_5m: total,
    }, 'Metrics collection completed');
  }
}
```

---

## Health Check Endpoints

### GET /health (Node API)

Checks all critical dependencies. Returns 200 if healthy, 503 if any dependency is down.

```typescript
// src/routes/health.routes.ts

app.get('/health', async (request, reply) => {
  const checks: Record<string, { status: string; latency_ms?: number; error?: string }> = {};

  // 1. Database (Supabase PostgreSQL)
  const dbStart = Date.now();
  try {
    const { data, error } = await supabase.from('organizations').select('id').limit(1);
    checks.database = {
      status: error ? 'unhealthy' : 'healthy',
      latency_ms: Date.now() - dbStart,
      ...(error && { error: error.message }),
    };
  } catch (err) {
    checks.database = { status: 'unhealthy', latency_ms: Date.now() - dbStart, error: err.message };
  }

  // 2. Redis (BullMQ)
  const redisStart = Date.now();
  try {
    await redis.ping();
    checks.redis = { status: 'healthy', latency_ms: Date.now() - redisStart };
  } catch (err) {
    checks.redis = { status: 'unhealthy', latency_ms: Date.now() - redisStart, error: err.message };
  }

  // 3. AI Service (Python)
  const aiStart = Date.now();
  try {
    const response = await fetch(`${env.AI_SERVICE_URL}/ai/health`, { signal: AbortSignal.timeout(5000) });
    const aiHealth = await response.json();
    checks.ai_service = {
      status: response.ok ? 'healthy' : 'degraded',
      latency_ms: Date.now() - aiStart,
      ...(aiHealth.providers && { providers: aiHealth.providers }),
    };
  } catch (err) {
    checks.ai_service = { status: 'unhealthy', latency_ms: Date.now() - aiStart, error: err.message };
  }

  // Overall status
  const isHealthy = Object.values(checks).every(c => c.status === 'healthy');
  const isDegraded = Object.values(checks).some(c => c.status === 'degraded');
  const overallStatus = isHealthy ? 'healthy' : isDegraded ? 'degraded' : 'unhealthy';

  const statusCode = overallStatus === 'unhealthy' ? 503 : 200;

  return reply.status(statusCode).send({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    service: 'crewshift-api',
    version: env.APP_VERSION ?? '0.0.0',
    uptime_seconds: Math.floor(process.uptime()),
    checks,
  });
});
```

### GET /ai/health (Python AI Service)

```python
# apps/ai-service/app/routers/health.py

from fastapi import APIRouter
import time
import asyncio

router = APIRouter()

@router.get("/ai/health")
async def health_check():
    checks = {}

    # Check each AI provider with a lightweight call
    providers_to_check = {
        "anthropic": check_anthropic,
        "openai": check_openai,
        "google": check_google,
    }

    results = await asyncio.gather(
        *[check_fn() for check_fn in providers_to_check.values()],
        return_exceptions=True,
    )

    for (name, _), result in zip(providers_to_check.items(), results):
        if isinstance(result, Exception):
            checks[name] = {"status": "unhealthy", "error": str(result)}
        else:
            checks[name] = result

    # Overall status
    all_healthy = all(c["status"] == "healthy" for c in checks.values())
    any_healthy = any(c["status"] == "healthy" for c in checks.values())

    if all_healthy:
        overall = "healthy"
    elif any_healthy:
        overall = "degraded"  # At least one provider works (fallback available)
    else:
        overall = "unhealthy"  # No AI providers available

    return {
        "status": overall,
        "timestamp": time.time(),
        "service": "crewshift-ai-service",
        "providers": checks,
    }


async def check_anthropic() -> dict:
    """Lightweight Anthropic API check."""
    start = time.time()
    try:
        # Use the messages API with a minimal request
        # Anthropic doesn't have a dedicated health endpoint
        # A minimal count_tokens call is the cheapest way to verify connectivity
        response = await anthropic_client.messages.count_tokens(
            model="claude-sonnet-4-20260514",
            messages=[{"role": "user", "content": "health check"}],
        )
        return {"status": "healthy", "latency_ms": int((time.time() - start) * 1000)}
    except Exception as e:
        return {"status": "unhealthy", "latency_ms": int((time.time() - start) * 1000), "error": str(e)}


async def check_openai() -> dict:
    """Lightweight OpenAI API check."""
    start = time.time()
    try:
        # List models is a cheap, authenticated call
        await openai_client.models.list()
        return {"status": "healthy", "latency_ms": int((time.time() - start) * 1000)}
    except Exception as e:
        return {"status": "unhealthy", "latency_ms": int((time.time() - start) * 1000), "error": str(e)}


async def check_google() -> dict:
    """Lightweight Google AI API check."""
    start = time.time()
    try:
        await google_client.list_models()
        return {"status": "healthy", "latency_ms": int((time.time() - start) * 1000)}
    except Exception as e:
        return {"status": "unhealthy", "latency_ms": int((time.time() - start) * 1000), "error": str(e)}
```

### Health Check Response Example

```json
{
  "status": "degraded",
  "timestamp": "2026-03-04T14:30:00.000Z",
  "service": "crewshift-api",
  "version": "1.2.0",
  "uptime_seconds": 86423,
  "checks": {
    "database": {
      "status": "healthy",
      "latency_ms": 12
    },
    "redis": {
      "status": "healthy",
      "latency_ms": 3
    },
    "ai_service": {
      "status": "degraded",
      "latency_ms": 450,
      "providers": {
        "anthropic": { "status": "unhealthy", "error": "timeout" },
        "openai": { "status": "healthy", "latency_ms": 200 },
        "google": { "status": "healthy", "latency_ms": 180 }
      }
    }
  }
}
```

**Decision rationale:** Health checks return `degraded` (200) instead of `unhealthy` (503) when at least one AI provider is available. This prevents Railway from restarting the service when the system can still function via fallback. Only return 503 when the system truly cannot serve requests (DB or Redis down).

---

## Error Tracking

### How 5xx Errors Are Logged

Every unhandled error in Fastify produces a structured error log:

```typescript
// src/server.ts — global error handler

app.setErrorHandler((error, request, reply) => {
  const statusCode = error.statusCode ?? 500;

  // Log all 5xx errors at error level
  if (statusCode >= 500) {
    request.log.error({
      err: error,                            // includes stack trace via Pino serializer
      request_id: request.id,
      org_id: request.orgId,
      user_id: request.userId,
      method: request.method,
      url: request.url,
      status_code: statusCode,
    }, `Server error: ${error.message}`);
  } else if (statusCode >= 400) {
    // Log 4xx at warn level (client errors, validation failures)
    request.log.warn({
      err: { message: error.message, code: error.code },
      request_id: request.id,
      org_id: request.orgId,
      status_code: statusCode,
    }, `Client error: ${error.message}`);
  }

  // Send standard error response
  reply.status(statusCode).send({
    error: {
      code: error.code ?? 'INTERNAL_ERROR',
      message: statusCode >= 500
        ? 'An unexpected error occurred'        // Don't leak internal details to client
        : error.message,
      ...(env.NODE_ENV === 'development' && { stack: error.stack }),
    },
  });
});
```

### Error Context

Every error log includes:

| Field | Purpose |
|-------|---------|
| `err.message` | What went wrong |
| `err.stack` | Where in the code it happened |
| `request_id` | Correlate with other log lines in the same request |
| `org_id` | Which tenant was affected |
| `user_id` | Which user triggered it |
| `method` + `url` | Which endpoint failed |
| `status_code` | HTTP status returned |

### BullMQ Worker Error Logging

Worker errors are not HTTP errors — they are logged separately:

```typescript
// src/queue/workers/agent.worker.ts

agentWorker.on('failed', (job, error) => {
  logger.error({
    worker: 'agent',
    job_id: job?.id,
    job_name: job?.name,
    org_id: job?.data?.orgId,
    agent_type: job?.data?.agentType,
    execution_id: job?.data?.executionId,
    attempts: job?.attemptsMade,
    max_attempts: job?.opts?.attempts,
    error: error.message,
    stack: error.stack,
  }, 'Agent worker job failed');
});

// Same pattern for all workers: sync.worker, notification.worker, scheduled.worker, pdf.worker
```

---

## Performance Tracking

### Request Duration Logging

Fastify automatically logs `responseTime` (in ms) for every request. No additional code needed:

```json
{
  "level": 30,
  "time": "2026-03-04T14:30:02.456Z",
  "req": { "method": "GET", "url": "/api/invoices" },
  "res": { "status_code": 200 },
  "responseTime": 45,
  "msg": "request completed"
}
```

### Slow Query Detection

Queries exceeding 1 second are logged at warn level:

```typescript
// src/db/repositories/base.repo.ts

async function timedQuery<T>(
  queryName: string,
  queryFn: () => Promise<T>,
  context?: Record<string, any>
): Promise<T> {
  const start = Date.now();
  const result = await queryFn();
  const duration = Date.now() - start;

  if (duration > 1000) {
    logger.warn({
      query: queryName,
      duration_ms: duration,
      ...context,
    }, 'Slow query detected');
  } else if (duration > 500) {
    logger.debug({
      query: queryName,
      duration_ms: duration,
    }, 'Query duration above threshold');
  }

  return result;
}

// Usage:
const invoices = await timedQuery(
  'getInvoicesByOrg',
  () => supabase.from('invoices').select('*').eq('org_id', orgId),
  { orgId }
);
```

### AI Service Latency Tracking

The Python AI service logs latency for every provider call. The Node API also tracks the total round-trip time to the AI service:

```typescript
// src/ai/ai-client.ts

async function callAIService(endpoint: string, payload: any, requestId: string): Promise<any> {
  const start = Date.now();

  try {
    const response = await fetch(`${env.AI_SERVICE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000), // 30s timeout
    });

    const latencyMs = Date.now() - start;

    if (latencyMs > 10000) {
      logger.warn({ endpoint, latencyMs, requestId }, 'AI service response exceeded 10s');
    }

    logger.info({
      endpoint,
      latency_ms: latencyMs,
      status_code: response.status,
      request_id: requestId,
    }, 'AI service call completed');

    return response.json();
  } catch (error) {
    const latencyMs = Date.now() - start;
    logger.error({
      endpoint,
      latency_ms: latencyMs,
      error: error.message,
      request_id: requestId,
    }, 'AI service call failed');
    throw error;
  }
}
```

---

## Platform Choices

### Current Stack (Phase 1)

| Tool | Purpose | Why |
|------|---------|-----|
| **Railway built-in logging** | Log aggregation and search | Free with Railway deployment. Captures stdout/stderr from both services. Supports basic search and filtering. Good enough for a small team debugging production issues. |
| **BetterUptime (or similar)** | External uptime monitoring | Pings `/health` every 60 seconds. Alerts on downtime via Slack/email. ~$20/month. Catches issues that internal monitoring cannot (entire Railway region down). |
| **Bull Board** | BullMQ queue dashboard | Open-source, embedded in the Node API. Provides real-time visibility into queue depth, processing times, failed jobs. Zero additional infrastructure. |
| **Supabase Dashboard** | Database metrics | Built into Supabase. Shows query performance, connection count, storage usage, replication lag. Free. |

### Future Stack (When Scale Warrants)

| Tool | Purpose | When to Adopt | Why This Over Alternatives |
|------|---------|---------------|---------------------------|
| **Axiom** | Log aggregation + metrics + dashboards | > 1,000 customers or > 5 team members | Generous free tier (500 GB/month), excellent query language (APL), built-in dashboards. Cheaper than Datadog for startups. |
| **Datadog** | Full APM + traces + metrics + logs | > 5,000 customers or Series A funding | Industry standard. Distributed tracing, APM, custom dashboards, anomaly detection. Expensive ($15+/host/month) but comprehensive. |
| **Sentry** | Error tracking + session replay | When error volume exceeds what log search can handle | Automatic error grouping, release tracking, performance monitoring. Free tier covers early stage. |
| **PagerDuty / OpsGenie** | On-call alerting + escalation | When there is a dedicated on-call rotation | Structured escalation policies, phone call alerts for critical incidents. Not needed until team > 3 engineers. |

**Decision rationale:** At early scale (< 1,000 customers), Railway logs + BetterUptime + Bull Board provide sufficient observability for a 1-3 person team. The cost of Datadog or Axiom is not justified when the primary engineer can grep Railway logs in real time. The logging strategy (JSON structured, consistent fields, request IDs) is designed to be forward-compatible — when we adopt Axiom or Datadog, the log format requires zero changes. Just point the log drain at the new destination.

---

## Dashboard Monitoring

### Bull Board (BullMQ Dashboard)

Bull Board provides a web UI for monitoring all BullMQ queues:

```typescript
// src/server.ts — Bull Board setup

import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';

const serverAdapter = new FastifyAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(agentExecutionQueue),
    new BullMQAdapter(notificationQueue),
    new BullMQAdapter(integrationSyncQueue),
    new BullMQAdapter(scheduledJobQueue),
    new BullMQAdapter(pdfQueue),
  ],
  serverAdapter,
});

// Protect with admin auth
app.register(serverAdapter.registerPlugin(), {
  prefix: '/admin/queues',
  preHandler: [authMiddleware, requireRole('owner')], // Only org owners can access
});
```

Bull Board shows:
- **Waiting** — Jobs in queue, not yet picked up
- **Active** — Jobs currently being processed
- **Completed** — Successfully processed jobs (with result data)
- **Failed** — Failed jobs (with error message and stack trace)
- **Delayed** — Jobs scheduled for future execution
- **Paused** — Queues that have been manually paused

### Supabase Dashboard

The Supabase dashboard (https://supabase.com/dashboard) provides:
- **Database metrics:** Query counts, avg query time, connections, disk usage
- **Realtime metrics:** Active subscriptions, messages/second
- **Auth metrics:** Sign-ups, sign-ins, active sessions
- **Storage metrics:** Object count, storage used

These are monitored passively (check when investigating an issue) rather than actively (automated alerts).

---

## Alerting Rules

### When to Alert

| Condition | Severity | Action | Notification Channel |
|-----------|----------|--------|---------------------|
| Agent failure rate > 5% over 1 hour | Critical | Investigate immediately — agents are the core product | Slack + SMS to on-call |
| AI latency > 10s (p99) over 5 min | High | Check provider status, consider switching to fallback | Slack |
| Queue depth > 100 (agent queue) | High | Workers may be stuck or overwhelmed. Check for stuck jobs. | Slack |
| Queue depth > 500 (notification queue) | Medium | Notification delivery is backed up. Usually self-resolves. | Slack |
| Sync failures > 3 consecutive (same org) | Medium | Integration likely disconnected or token expired. | Slack + in-app notification to org owner |
| API error rate > 1% over 5 min | High | Something is broken for users. Check error logs immediately. | Slack + SMS to on-call |
| Health check fails (BetterUptime) | Critical | Service is completely down. | Slack + SMS + phone call |
| API latency > 3s (p99) over 5 min | Medium | Performance degradation. Check DB queries and AI service latency. | Slack |
| Disk usage > 80% (Supabase) | Medium | Database storage approaching limits. | Slack + email |

### Alert Implementation

At early scale, alerts are triggered by the metrics collection job and sent as notifications:

```typescript
// src/services/alerting.service.ts

interface AlertRule {
  name: string;
  check: () => Promise<AlertCheckResult>;
  severity: 'critical' | 'high' | 'medium' | 'low';
  cooldown_minutes: number;  // Don't re-alert within this window
}

interface AlertCheckResult {
  triggered: boolean;
  value: number;
  threshold: number;
  details?: Record<string, any>;
}

const ALERT_RULES: AlertRule[] = [
  {
    name: 'agent_failure_rate_high',
    severity: 'critical',
    cooldown_minutes: 30,
    check: async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const { data } = await supabase
        .from('agent_executions')
        .select('status')
        .gte('created_at', oneHourAgo.toISOString());

      const total = data?.length ?? 0;
      if (total < 10) return { triggered: false, value: 0, threshold: 5 };

      const failed = data?.filter(e => e.status === 'failed').length ?? 0;
      const failureRate = (failed / total) * 100;

      return {
        triggered: failureRate > 5,
        value: failureRate,
        threshold: 5,
        details: { total, failed },
      };
    },
  },
  {
    name: 'queue_depth_high',
    severity: 'high',
    cooldown_minutes: 15,
    check: async () => {
      const waiting = await agentExecutionQueue.getWaitingCount();
      return {
        triggered: waiting > 100,
        value: waiting,
        threshold: 100,
      };
    },
  },
  {
    name: 'api_error_rate_high',
    severity: 'high',
    cooldown_minutes: 10,
    check: async () => {
      // This would read from a Redis counter updated by the error handler
      const fiveMinAgo = Math.floor(Date.now() / 1000) - 300;
      const errorCount = parseInt(await redis.get(`api_errors:5m:${fiveMinAgo}`) ?? '0', 10);
      const totalCount = parseInt(await redis.get(`api_requests:5m:${fiveMinAgo}`) ?? '1', 10);
      const errorRate = (errorCount / totalCount) * 100;

      return {
        triggered: errorRate > 1 && totalCount > 50,
        value: errorRate,
        threshold: 1,
        details: { errorCount, totalCount },
      };
    },
  },
];

async function runAlertChecks(): Promise<void> {
  for (const rule of ALERT_RULES) {
    // Check cooldown
    const cooldownKey = `alert_cooldown:${rule.name}`;
    const inCooldown = await redis.get(cooldownKey);
    if (inCooldown) continue;

    const result = await rule.check();

    if (result.triggered) {
      logger.error({
        alert: rule.name,
        severity: rule.severity,
        value: result.value,
        threshold: result.threshold,
        details: result.details,
      }, `Alert triggered: ${rule.name}`);

      // Set cooldown
      await redis.set(cooldownKey, '1', 'EX', rule.cooldown_minutes * 60);

      // Send alert (Slack webhook, or notification to system admin)
      await sendAlertNotification(rule, result);
    }
  }
}

// Run every 5 minutes via scheduled worker
// scheduled-jobs.ts:
// { name: 'alert-checks', cron: '*/5 * * * *', handler: 'runAlertChecks' }
```

---

## On-Call

### Current State (Pre-Production)

No formal on-call rotation. The founding engineer(s) monitor Slack alerts during business hours and respond to critical BetterUptime alerts 24/7 via SMS.

### Future Consideration (Production Scale)

When the team grows to 3+ engineers:
- Adopt PagerDuty or OpsGenie for structured on-call rotation
- Weekly rotation, 1 engineer on-call at a time
- Escalation path: Slack alert (5 min) -> SMS (10 min) -> Phone call (15 min) -> Secondary on-call
- Post-incident reviews for any outage > 5 minutes

---

## Log Retention

### Railway Default

Railway retains logs for **7 days** on the standard plan. This is sufficient for immediate debugging but not for historical analysis.

### Recommendations by Scale

| Scale | Retention Strategy | Cost |
|-------|-------------------|------|
| < 500 customers | Railway default (7 days). Export critical alerts to a Google Sheet manually. | Free |
| 500 - 2,000 customers | Configure Railway log drain to Axiom. Axiom free tier retains 30 days, 500 GB/month. | Free |
| 2,000+ customers | Axiom paid plan (90 day retention) or Datadog. Log structured data to a time-series database for long-term metrics. | $25-200/month |

### What to Retain Long-Term (Even at Early Scale)

Even without a log drain, these records persist in the database indefinitely:
- `agent_executions` — complete audit trail of every agent action
- `notifications` — all notifications ever sent
- `messages` — all copilot conversations
- `workflow_executions` — all workflow runs

These tables are the primary debugging resource for customer issues. Logs are for operational debugging; the database is for business debugging.

---

## Implementation Notes

1. **Log volume management.** At 1,000 active orgs with 50 agent executions/day each, the system generates ~50,000 agent execution log lines + ~200,000 API request log lines per day. At ~500 bytes per JSON log line, that is approximately 125 MB/day. Well within Railway and Axiom free tier limits.

2. **No sampling.** At current scale, every log line is retained. Sampling (e.g., log only 10% of requests) is only needed at > 10,000 customers when log volume becomes expensive.

3. **Structured logs are queryable.** Because every log line is JSON with consistent fields, searching is straightforward. `jq` in Railway CLI, or Axiom/Datadog query languages, can filter by `org_id`, `request_id`, `agent_type`, `error`, etc.

4. **Health check frequency.** BetterUptime pings `/health` every 60 seconds. This is aggressive enough to detect outages within 2 minutes but not so aggressive that it adds meaningful load. The health check itself takes < 200ms (3 lightweight checks in parallel).

5. **Alert fatigue prevention.** Every alert rule has a cooldown period. If agent failure rate is high, the team gets alerted once, not every 5 minutes. The cooldown resets only after the condition clears.

6. **No APM in Phase 1.** Application Performance Monitoring (distributed traces, flame graphs) is deferred. At early scale, structured logs with request IDs provide sufficient trace capability. APM becomes valuable when request flows span 5+ services — with 2 services (Node + Python), log correlation is sufficient.
