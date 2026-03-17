# 17 — Cost Tracking & Usage Metering

> **Related Docs:** [06-agent-runtime.md](./06-agent-runtime.md) (agent execution pipeline), [10-ai-service.md](./10-ai-service.md) (Python AI service & provider routing), [14-queue-system.md](./14-queue-system.md) (BullMQ workers), [03-api-routes.md](./03-api-routes.md) (dashboard usage endpoint)

---

## Why Track Costs

Cost tracking serves four purposes in CrewShift:

1. **Tier limit enforcement** — Each pricing tier (Starter, Pro, Business, Enterprise) has monthly caps on agent executions, copilot messages, integration syncs, and file storage. Without metering, there is no way to enforce these limits.

2. **Billing data** — Even though CrewShift uses flat-rate pricing (no usage-based billing), cost data is essential for understanding unit economics. If the average Pro customer costs $42/month in AI spend and generates $299 in revenue, the $257 gross margin is healthy. If AI costs creep to $80, we have a problem. Tracking identifies the problem before it becomes a crisis.

3. **Cost optimization** — Knowing which AI models consume the most tokens and cost allows intelligent model routing. If 60% of Invoice Agent executions use Claude Sonnet but could use a cheaper model with equivalent quality, the savings are significant at scale.

4. **Provider analysis** — Multi-provider AI architecture means we need to know which provider handles which workload. If Anthropic is down and all traffic routes to OpenAI, the cost profile changes. Tracking makes this visible.

**Decision rationale:** We track costs at the individual execution level (not just aggregated monthly) because:
- It enables per-agent cost analysis (which agent is most expensive?)
- It supports per-model cost analysis (which model is most expensive?)
- It provides the granularity needed for future usage-based billing if we ever implement it
- It creates the audit trail needed for enterprise customers who want to understand AI spend

---

## agent_executions Cost Fields

Every agent execution records its AI cost. These three fields are populated by the AI service response:

```sql
-- In the agent_executions table (see 02-database-schema.md for full table)

ai_model_used TEXT,        -- e.g., 'claude-sonnet-4-20260514', 'gpt-5-nano-20260301'
ai_tokens_used INTEGER,    -- total tokens (input + output)
ai_cost_cents INTEGER,     -- cost in cents (e.g., 15 = $0.15)
```

### Field Details

| Field | Type | Set By | Example Values | Notes |
|-------|------|--------|----------------|-------|
| `ai_model_used` | TEXT | Python AI service response | `claude-sonnet-4-20260514`, `gpt-5-nano-20260301`, `gemini-2.5-flash-vision` | The actual model ID used, not the routing tier. Includes version date for tracking model changes. |
| `ai_tokens_used` | INTEGER | Python AI service response | `1200`, `4500`, `850` | Total tokens = input tokens + output tokens. Stored as a single sum for simplicity. Input/output breakdown is in `metadata.token_breakdown`. |
| `ai_cost_cents` | INTEGER | Python AI service response | `2`, `15`, `1` | Cost in whole cents. Calculated server-side by the Python service using the model's per-token pricing. Integer avoids floating-point precision issues. |

### Why Cents (Not Dollars)

**Decision rationale:** Most individual agent executions cost between $0.01 and $0.30. Storing as dollars with decimal places introduces floating-point comparison issues (`0.1 + 0.2 !== 0.3` in JavaScript). Storing as integer cents eliminates this entirely. Display formatting (`$0.15`) is a presentation concern handled by the frontend.

---

## Per-Request Cost Calculation

### How the Python AI Service Returns Cost Data

Every response from the Python AI service includes cost metadata:

```python
# apps/ai-service/app/providers/base.py

from dataclasses import dataclass

@dataclass
class AIResponse:
    content: str                    # The generated text / structured output
    model: str                      # Actual model ID used
    provider: str                   # 'anthropic', 'openai', 'google'
    tokens_input: int               # Input tokens consumed
    tokens_output: int              # Output tokens generated
    tokens_total: int               # tokens_input + tokens_output
    cost_cents: int                 # Calculated cost in cents
    latency_ms: int                 # Time from request to response
    cached: bool = False            # Whether prompt caching was used

# Cost calculation happens inside each provider implementation:

# apps/ai-service/app/providers/anthropic.py

class AnthropicProvider(AIProvider):
    # Pricing per 1M tokens (as of model versions in use)
    PRICING = {
        'claude-sonnet-4-20260514': {'input': 3.00, 'output': 15.00},      # $3/M input, $15/M output
        'claude-opus-4-20260514':   {'input': 15.00, 'output': 75.00},     # $15/M input, $75/M output
        'claude-sonnet-4-20260514-cached': {'input': 0.30, 'output': 15.00}, # Cached input pricing
    }

    async def reason(self, request: ReasonRequest) -> AIResponse:
        start_time = time.time()

        response = await self.client.messages.create(
            model=request.model or 'claude-sonnet-4-20260514',
            max_tokens=request.max_tokens or 4096,
            system=request.system_prompt,
            messages=request.messages,
        )

        latency_ms = int((time.time() - start_time) * 1000)

        # Extract token counts
        tokens_input = response.usage.input_tokens
        tokens_output = response.usage.output_tokens
        tokens_total = tokens_input + tokens_output
        model = response.model

        # Calculate cost
        pricing = self.PRICING.get(model, self.PRICING['claude-sonnet-4-20260514'])
        cost_input = (tokens_input / 1_000_000) * pricing['input']
        cost_output = (tokens_output / 1_000_000) * pricing['output']
        cost_cents = max(1, round((cost_input + cost_output) * 100))  # minimum 1 cent

        return AIResponse(
            content=response.content[0].text,
            model=model,
            provider='anthropic',
            tokens_input=tokens_input,
            tokens_output=tokens_output,
            tokens_total=tokens_total,
            cost_cents=cost_cents,
            latency_ms=latency_ms,
        )
```

```python
# apps/ai-service/app/providers/openai.py

class OpenAIProvider(AIProvider):
    PRICING = {
        'gpt-5-nano-20260301':  {'input': 0.10, 'output': 0.40},   # $0.10/M input, $0.40/M output
        'gpt-5.2-20260301':     {'input': 5.00, 'output': 15.00},  # $5/M input, $15/M output
    }

    async def reason(self, request: ReasonRequest) -> AIResponse:
        # Similar implementation, using openai.ChatCompletion
        # response.usage.prompt_tokens, response.usage.completion_tokens
        # Cost calculation follows same pattern
        ...
```

```python
# apps/ai-service/app/providers/google.py

class GoogleProvider(AIProvider):
    PRICING = {
        'gemini-2.5-flash':        {'input': 0.075, 'output': 0.30},
        'gemini-2.5-flash-vision': {'input': 0.075, 'output': 0.30},
        'gemini-embedding-001':    {'input': 0.00, 'output': 0.00},  # Free tier
    }
    ...
```

### How Node Stores Cost Data

The Node API receives the cost data from the Python service response and stores it in the agent execution record:

```typescript
// src/queue/workers/agent.worker.ts (relevant section)

async function processAgentExecution(job: Job): Promise<void> {
  const { orgId, agentType, executionId, inputData } = job.data;

  // ... gather data, validate inputs ...

  // Call Python AI service
  const aiResponse = await aiClient.reason({
    agentType,
    promptTemplate: agentDefinition.steps.find(s => s.type === 'ai_reason')?.config.prompt_template,
    context: gatheredData,
    modelTier: agentDefinition.steps.find(s => s.type === 'ai_reason')?.config.model_tier,
    orgId,
  });

  // Store execution result with cost data
  await supabase
    .from('agent_executions')
    .update({
      status: 'completed',
      output_data: aiResponse.content,
      confidence_score: aiResponse.confidence,
      ai_model_used: aiResponse.model,           // from Python response
      ai_tokens_used: aiResponse.tokens_total,    // from Python response
      ai_cost_cents: aiResponse.cost_cents,       // from Python response
      duration_ms: aiResponse.latency_ms,
      completed_at: new Date(),
      metadata: {
        ...existingMetadata,
        token_breakdown: {
          input: aiResponse.tokens_input,
          output: aiResponse.tokens_output,
        },
        provider: aiResponse.provider,
        cached: aiResponse.cached,
      },
    })
    .eq('id', executionId);
}
```

### Copilot Message Cost Tracking

Copilot messages also incur AI costs. These are tracked differently — copilot does not create `agent_executions` rows for simple queries. Instead, cost is tracked in the `messages` table:

```typescript
// src/services/copilot.service.ts

async function processMessage(orgId: string, userId: string, content: string): Promise<void> {
  // 1. Classify intent (fast model — cheap)
  const classifyResponse = await aiClient.classify({ text: content, orgId });

  // 2. If agents dispatched, their costs are tracked in agent_executions
  // 3. Generate response (capable model — more expensive)
  const responseAI = await aiClient.reason({
    promptTemplate: 'copilot',
    context: { ... },
    modelTier: 'capable',
    orgId,
  });

  // 4. Store message with cost metadata
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    org_id: orgId,
    role: 'assistant',
    content: responseAI.content,
    metadata: {
      classify_cost_cents: classifyResponse.cost_cents,
      classify_model: classifyResponse.model,
      response_cost_cents: responseAI.cost_cents,
      response_model: responseAI.model,
      total_cost_cents: classifyResponse.cost_cents + responseAI.cost_cents,
      total_tokens: classifyResponse.tokens_total + responseAI.tokens_total,
    },
  });
}
```

---

## org_monthly_usage Materialized View

A materialized view aggregates per-org usage data for the current billing period. This powers the usage dashboard and tier limit enforcement.

### Full SQL Definition

```sql
CREATE MATERIALIZED VIEW org_monthly_usage AS
SELECT
  -- Organization
  o.id AS org_id,
  o.tier,

  -- Period
  DATE_TRUNC('month', NOW()) AS period,

  -- Agent Executions
  COUNT(ae.id) FILTER (
    WHERE ae.created_at >= DATE_TRUNC('month', NOW())
  ) AS total_executions,

  -- Copilot Messages (assistant messages only — user messages are free)
  (
    SELECT COUNT(*)
    FROM messages m
    WHERE m.org_id = o.id
      AND m.role = 'assistant'
      AND m.created_at >= DATE_TRUNC('month', NOW())
  ) AS copilot_messages,

  -- Integration Syncs
  (
    SELECT COUNT(*)
    FROM integration_sync_log isl
    WHERE isl.org_id = o.id
      AND isl.created_at >= DATE_TRUNC('month', NOW())
  ) AS integration_syncs,

  -- Token Usage
  COALESCE(SUM(ae.ai_tokens_used) FILTER (
    WHERE ae.created_at >= DATE_TRUNC('month', NOW())
  ), 0) AS total_tokens,

  -- Cost
  COALESCE(SUM(ae.ai_cost_cents) FILTER (
    WHERE ae.created_at >= DATE_TRUNC('month', NOW())
  ), 0) AS total_cost_cents,

  -- Cost from copilot (stored in messages.metadata)
  (
    SELECT COALESCE(SUM((m.metadata->>'total_cost_cents')::int), 0)
    FROM messages m
    WHERE m.org_id = o.id
      AND m.role = 'assistant'
      AND m.created_at >= DATE_TRUNC('month', NOW())
      AND m.metadata ? 'total_cost_cents'
  ) AS copilot_cost_cents,

  -- Executions by Model (for provider analysis)
  (
    SELECT JSONB_OBJECT_AGG(
      COALESCE(ae2.ai_model_used, 'unknown'),
      cnt
    )
    FROM (
      SELECT ai_model_used, COUNT(*) AS cnt
      FROM agent_executions
      WHERE org_id = o.id
        AND created_at >= DATE_TRUNC('month', NOW())
      GROUP BY ai_model_used
    ) ae2
  ) AS executions_by_model,

  -- Executions by Agent Type (for agent-level analysis)
  (
    SELECT JSONB_OBJECT_AGG(ae3.agent_type, cnt)
    FROM (
      SELECT agent_type, COUNT(*) AS cnt
      FROM agent_executions
      WHERE org_id = o.id
        AND created_at >= DATE_TRUNC('month', NOW())
      GROUP BY agent_type
    ) ae3
  ) AS executions_by_agent,

  -- Cost by Provider (for provider analysis)
  (
    SELECT JSONB_OBJECT_AGG(
      COALESCE(ae4.metadata->>'provider', 'unknown'),
      total_cost
    )
    FROM (
      SELECT
        metadata->>'provider' AS provider,
        SUM(ai_cost_cents) AS total_cost
      FROM agent_executions
      WHERE org_id = o.id
        AND created_at >= DATE_TRUNC('month', NOW())
      GROUP BY metadata->>'provider'
    ) ae4
  ) AS cost_by_provider

FROM organizations o
LEFT JOIN agent_executions ae ON ae.org_id = o.id
GROUP BY o.id, o.tier;

-- Index for fast lookup
CREATE UNIQUE INDEX ON org_monthly_usage(org_id);
```

### Refresh Schedule

```sql
-- Refresh hourly via pg_cron (Supabase supports pg_cron)
SELECT cron.schedule(
  'refresh-monthly-usage',
  '0 * * * *',  -- every hour at minute 0
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY org_monthly_usage$$
);
```

**Why hourly refresh, not real-time:**
- Materialized view refresh on every insert would be too expensive (each agent execution triggers a full refresh)
- Hourly is sufficient for dashboard display — users check usage occasionally, not continuously
- Tier limit enforcement uses a **separate real-time counter** (see below), not the materialized view

**Why `CONCURRENTLY`:** The `CONCURRENTLY` keyword allows the view to be refreshed without locking it. Dashboard queries can still read the old data while the refresh is in progress. This requires the unique index on `org_id`.

---

## Monthly Tier Limits

### Limits by Tier

| Resource | Starter | Pro | Business | Enterprise |
|----------|---------|-----|----------|------------|
| Agent executions/month | 500 | 5,000 | 20,000 | Unlimited |
| Copilot messages/month | 200 | 2,000 | 10,000 | Unlimited |
| Integration syncs/month | 1,000 | 10,000 | 50,000 | Unlimited |
| File storage | 1 GB | 10 GB | 50 GB | Custom |

```typescript
// src/config/tier-limits.ts

interface TierLimits {
  agent_executions: number;
  copilot_messages: number;
  integration_syncs: number;
  file_storage_bytes: number;
}

const TIER_LIMITS: Record<string, TierLimits> = {
  starter: {
    agent_executions: 500,
    copilot_messages: 200,
    integration_syncs: 1000,
    file_storage_bytes: 1 * 1024 * 1024 * 1024,        // 1 GB
  },
  pro: {
    agent_executions: 5000,
    copilot_messages: 2000,
    integration_syncs: 10000,
    file_storage_bytes: 10 * 1024 * 1024 * 1024,       // 10 GB
  },
  business: {
    agent_executions: 20000,
    copilot_messages: 10000,
    integration_syncs: 50000,
    file_storage_bytes: 50 * 1024 * 1024 * 1024,       // 50 GB
  },
  enterprise: {
    agent_executions: Infinity,
    copilot_messages: Infinity,
    integration_syncs: Infinity,
    file_storage_bytes: Infinity,                        // Custom — managed per contract
  },
};

export function getTierLimits(tier: string): TierLimits {
  return TIER_LIMITS[tier] ?? TIER_LIMITS.starter;
}
```

---

## Limit Enforcement

### usage.service.ts

Limit checks use Redis counters for real-time accuracy (not the materialized view, which may be up to 1 hour stale):

```typescript
// src/services/usage.service.ts

import { redis } from '../config/redis';
import { getTierLimits } from '../config/tier-limits';
import { createNotification } from '../notifications/notification.service';

type UsageResource = 'agent_executions' | 'copilot_messages' | 'integration_syncs';

interface UsageCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  percentage: number;
  warning: boolean;       // true if at 80%+
  upgrade_needed: boolean; // true if at 100%
}

async function checkUsageLimit(
  orgId: string,
  tier: string,
  resource: UsageResource
): Promise<UsageCheckResult> {
  const limits = getTierLimits(tier);
  const limit = limits[resource];

  // Enterprise has no limits
  if (limit === Infinity) {
    return { allowed: true, current: 0, limit: Infinity, percentage: 0, warning: false, upgrade_needed: false };
  }

  // Redis key: usage:{org_id}:{resource}:{YYYY-MM}
  const period = new Date().toISOString().slice(0, 7); // e.g., '2026-03'
  const key = `usage:${orgId}:${resource}:${period}`;

  const current = parseInt(await redis.get(key) ?? '0', 10);
  const percentage = Math.round((current / limit) * 100);

  const result: UsageCheckResult = {
    allowed: current < limit,
    current,
    limit,
    percentage,
    warning: percentage >= 80 && percentage < 100,
    upgrade_needed: percentage >= 100,
  };

  // Send warning notification at 80% (once per period)
  if (result.warning) {
    const warningKey = `usage_warning:${orgId}:${resource}:${period}`;
    const alreadyWarned = await redis.get(warningKey);
    if (!alreadyWarned) {
      await redis.set(warningKey, '1', 'EX', 86400 * 30); // expire after 30 days
      await createNotification({
        orgId,
        type: 'alert',
        title: `Approaching ${formatResourceName(resource)} limit`,
        body: `You've used ${percentage}% of your monthly ${formatResourceName(resource)} (${current} of ${limit}). Upgrade your plan to avoid interruption.`,
        actionUrl: '/settings/billing',
        metadata: {
          urgency: 'medium',
          resource,
          current,
          limit,
          percentage,
        },
      });
    }
  }

  // Send hard-limit notification at 100%
  if (result.upgrade_needed) {
    const hardLimitKey = `usage_hard:${orgId}:${resource}:${period}`;
    const alreadyNotified = await redis.get(hardLimitKey);
    if (!alreadyNotified) {
      await redis.set(hardLimitKey, '1', 'EX', 86400 * 30);
      await createNotification({
        orgId,
        type: 'alert',
        title: `${formatResourceName(resource)} limit reached`,
        body: `You've reached your monthly ${formatResourceName(resource)} limit (${limit}). Upgrade to continue using this feature.`,
        actionUrl: '/settings/billing',
        metadata: {
          urgency: 'high',
          resource,
          current,
          limit,
          percentage: 100,
        },
      });
    }
  }

  return result;
}

async function incrementUsage(orgId: string, resource: UsageResource): Promise<void> {
  const period = new Date().toISOString().slice(0, 7);
  const key = `usage:${orgId}:${resource}:${period}`;

  const newCount = await redis.incr(key);

  // Set TTL on first increment (auto-expire after 35 days — covers the full month + buffer)
  if (newCount === 1) {
    await redis.expire(key, 35 * 24 * 60 * 60);
  }
}

function formatResourceName(resource: UsageResource): string {
  const names: Record<string, string> = {
    agent_executions: 'agent executions',
    copilot_messages: 'copilot messages',
    integration_syncs: 'integration syncs',
  };
  return names[resource] ?? resource;
}

export { checkUsageLimit, incrementUsage };
```

### Soft Warning at 80%

When usage reaches 80% of the tier limit:
- A notification is created (type: `alert`, urgency: `medium`)
- The dashboard shows a yellow warning banner
- The warning is sent once per resource per billing period (Redis dedup key)

### Hard Stop at 100%

When usage reaches 100%:
- A notification is created (type: `alert`, urgency: `high`)
- The resource is blocked — agent executions are rejected, copilot returns an error, syncs are skipped
- The dashboard shows a red banner with an upgrade prompt
- The API returns a specific error code: `USAGE_LIMIT_EXCEEDED`

```typescript
// Error response when limit is reached
{
  "error": {
    "code": "USAGE_LIMIT_EXCEEDED",
    "message": "Monthly agent execution limit reached (500/500). Upgrade to Pro for 5,000 executions/month.",
    "details": {
      "resource": "agent_executions",
      "current": 500,
      "limit": 500,
      "tier": "starter",
      "upgrade_url": "/settings/billing"
    }
  }
}
```

---

## Where Limits Are Checked

### In agent.worker.ts (Before Execution)

```typescript
// src/queue/workers/agent.worker.ts

async function processAgentExecution(job: Job): Promise<void> {
  const { orgId, agentType, executionId } = job.data;

  // Get org tier
  const { data: org } = await supabase
    .from('organizations')
    .select('tier')
    .eq('id', orgId)
    .single();

  // Check usage limit BEFORE doing any AI work
  const usageCheck = await checkUsageLimit(orgId, org.tier, 'agent_executions');

  if (!usageCheck.allowed) {
    // Update execution status to failed with limit reason
    await supabase
      .from('agent_executions')
      .update({
        status: 'failed',
        error: `Monthly agent execution limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade required.`,
        completed_at: new Date(),
      })
      .eq('id', executionId);

    return; // Do not proceed with AI call
  }

  // Increment usage counter BEFORE execution (optimistic — if it fails, we still counted)
  await incrementUsage(orgId, 'agent_executions');

  // Proceed with agent execution...
}
```

### In copilot.routes.ts (Before Processing)

```typescript
// src/routes/copilot.routes.ts

app.post('/api/copilot/message', async (request, reply) => {
  const orgId = request.orgId;
  const { data: org } = await supabase.from('organizations').select('tier').eq('id', orgId).single();

  // Check copilot message limit
  const usageCheck = await checkUsageLimit(orgId, org.tier, 'copilot_messages');

  if (!usageCheck.allowed) {
    return reply.status(429).send({
      error: {
        code: 'USAGE_LIMIT_EXCEEDED',
        message: `Monthly copilot message limit reached (${usageCheck.current}/${usageCheck.limit}).`,
        details: {
          resource: 'copilot_messages',
          current: usageCheck.current,
          limit: usageCheck.limit,
          tier: org.tier,
        },
      },
    });
  }

  await incrementUsage(orgId, 'copilot_messages');

  // Process message...
});
```

### In sync.worker.ts (Before Syncing)

```typescript
// src/queue/workers/sync.worker.ts

async function processSync(job: Job): Promise<void> {
  const { orgId, provider, integrationId } = job.data;

  const { data: org } = await supabase.from('organizations').select('tier').eq('id', orgId).single();

  const usageCheck = await checkUsageLimit(orgId, org.tier, 'integration_syncs');

  if (!usageCheck.allowed) {
    logger.warn({ orgId, provider }, 'Integration sync limit reached, skipping');
    return;
  }

  await incrementUsage(orgId, 'integration_syncs');

  // Proceed with sync...
}
```

---

## Cost Allocation by Provider

### Tracking Provider Distribution

The `agent_executions.metadata.provider` field records which AI provider handled each execution. Combined with the materialized view's `cost_by_provider` JSONB column, this enables provider-level cost analysis.

```sql
-- Cost distribution by provider for an org in the current month
SELECT
  metadata->>'provider' AS provider,
  COUNT(*) AS executions,
  SUM(ai_tokens_used) AS total_tokens,
  SUM(ai_cost_cents) AS total_cost_cents,
  ROUND(AVG(ai_cost_cents), 1) AS avg_cost_per_execution,
  ROUND(AVG(duration_ms)) AS avg_latency_ms
FROM agent_executions
WHERE org_id = $1
  AND created_at >= DATE_TRUNC('month', NOW())
GROUP BY metadata->>'provider'
ORDER BY total_cost_cents DESC;

-- Example output:
-- provider   | executions | total_tokens | total_cost_cents | avg_cost | avg_latency
-- anthropic  | 342        | 456000       | 892              | 2.6      | 2100
-- openai     | 1205       | 185000       | 145              | 0.1      | 450
-- google     | 89         | 45000        | 12               | 0.1      | 800
```

### Provider Fallback Cost Impact

When the primary provider is down and traffic routes to the fallback, costs may change. The system tracks fallback events:

```typescript
// In Python AI service — when fallback occurs
logger.warn({
  primary_provider: 'anthropic',
  fallback_provider: 'openai',
  reason: 'primary_timeout',
  cost_impact: 'fallback may have different per-token pricing',
  request_id: request_id,
}, 'Provider fallback triggered');
```

---

## Usage Dashboard API

### GET /api/dashboard/usage

Returns current month usage data for the authenticated user's organization.

```typescript
// Request
GET /api/dashboard/usage
Authorization: Bearer <jwt>

// Response
{
  "data": {
    "period": "2026-03",
    "tier": "pro",

    "usage": {
      "agent_executions": {
        "current": 1247,
        "limit": 5000,
        "percentage": 25
      },
      "copilot_messages": {
        "current": 389,
        "limit": 2000,
        "percentage": 19
      },
      "integration_syncs": {
        "current": 2340,
        "limit": 10000,
        "percentage": 23
      },
      "file_storage": {
        "current_bytes": 524288000,
        "limit_bytes": 10737418240,
        "current_formatted": "500 MB",
        "limit_formatted": "10 GB",
        "percentage": 5
      }
    },

    "cost": {
      "total_cost_cents": 1049,
      "total_cost_formatted": "$10.49",
      "agent_cost_cents": 892,
      "copilot_cost_cents": 157,
      "cost_by_provider": {
        "anthropic": 892,
        "openai": 145,
        "google": 12
      },
      "cost_by_agent": {
        "invoice": 312,
        "estimate": 245,
        "collections": 89,
        "customer": 156,
        "insights": 90
      }
    },

    "executions_by_agent": {
      "invoice": 342,
      "estimate": 189,
      "collections": 256,
      "customer": 310,
      "bookkeeping": 98,
      "insights": 32,
      "field-ops": 15,
      "compliance": 5
    },

    "executions_by_model": {
      "claude-sonnet-4-20260514": 342,
      "gpt-5-nano-20260301": 789,
      "gemini-2.5-flash-vision": 89,
      "gpt-5.2-20260301": 27
    }
  }
}
```

### Route Implementation

```typescript
// src/routes/dashboard.routes.ts (usage endpoint)

app.get('/api/dashboard/usage', async (request, reply) => {
  const orgId = request.orgId;

  // Get org tier
  const { data: org } = await supabase
    .from('organizations')
    .select('tier')
    .eq('id', orgId)
    .single();

  const limits = getTierLimits(org.tier);
  const period = new Date().toISOString().slice(0, 7);

  // Get real-time counts from Redis (more accurate than materialized view)
  const [executions, copilotMsgs, syncs] = await Promise.all([
    redis.get(`usage:${orgId}:agent_executions:${period}`),
    redis.get(`usage:${orgId}:copilot_messages:${period}`),
    redis.get(`usage:${orgId}:integration_syncs:${period}`),
  ]);

  // Get cost data from materialized view (hourly refresh is fine for cost display)
  const { data: usageData } = await supabase
    .from('org_monthly_usage')
    .select('*')
    .eq('org_id', orgId)
    .single();

  // Get file storage usage
  const storageUsed = await calculateStorageUsage(orgId);

  const currentExecs = parseInt(executions ?? '0', 10);
  const currentMsgs = parseInt(copilotMsgs ?? '0', 10);
  const currentSyncs = parseInt(syncs ?? '0', 10);

  return reply.send({
    data: {
      period,
      tier: org.tier,
      usage: {
        agent_executions: {
          current: currentExecs,
          limit: limits.agent_executions,
          percentage: Math.round((currentExecs / limits.agent_executions) * 100),
        },
        copilot_messages: {
          current: currentMsgs,
          limit: limits.copilot_messages,
          percentage: Math.round((currentMsgs / limits.copilot_messages) * 100),
        },
        integration_syncs: {
          current: currentSyncs,
          limit: limits.integration_syncs,
          percentage: Math.round((currentSyncs / limits.integration_syncs) * 100),
        },
        file_storage: {
          current_bytes: storageUsed,
          limit_bytes: limits.file_storage_bytes,
          current_formatted: formatBytes(storageUsed),
          limit_formatted: formatBytes(limits.file_storage_bytes),
          percentage: Math.round((storageUsed / limits.file_storage_bytes) * 100),
        },
      },
      cost: {
        total_cost_cents: (usageData?.total_cost_cents ?? 0) + (usageData?.copilot_cost_cents ?? 0),
        total_cost_formatted: formatCurrency(((usageData?.total_cost_cents ?? 0) + (usageData?.copilot_cost_cents ?? 0)) / 100),
        agent_cost_cents: usageData?.total_cost_cents ?? 0,
        copilot_cost_cents: usageData?.copilot_cost_cents ?? 0,
        cost_by_provider: usageData?.cost_by_provider ?? {},
        cost_by_agent: usageData?.executions_by_agent ?? {}, // TODO: separate cost_by_agent view
      },
      executions_by_agent: usageData?.executions_by_agent ?? {},
      executions_by_model: usageData?.executions_by_model ?? {},
    },
  });
});
```

---

## Cost Optimization Strategies

### Model Tiering

Use the cheapest model that produces acceptable quality for each task:

| Task | Model | Cost per 1M tokens | Rationale |
|------|-------|--------------------|-----------|
| Intent classification | GPT-5 Nano | ~$0.50 | Structured output, <500ms, classification does not need reasoning depth |
| Entity extraction | GPT-5 Nano | ~$0.50 | Simple extraction from structured text |
| Invoice generation | Claude Sonnet 4 | ~$9.00 avg | Needs reasoning about line items, pricing, context. Quality matters — this is customer-facing. |
| Estimate generation | Claude Sonnet 4 | ~$9.00 avg | Same reasoning requirements as invoice |
| Complex reasoning (reports, insights) | Claude Opus 4 | ~$45.00 avg | Only for weekly digest deep analysis, pricing optimization, complex multi-factor decisions |
| Vision/OCR | Gemini 2.5 Flash | ~$0.37 avg | Best price/performance for image analysis |
| Embeddings | Voyage-finance-2 | ~$0.00 | Effectively free at our volume |

**Rule of thumb:** 80% of AI calls should go through fast/cheap models (classification, extraction, routing). Only 20% should use capable/expensive models (generation, reasoning).

### Prompt Caching

Anthropic and OpenAI support prompt caching — if the system prompt is identical across calls, the cached portion is charged at reduced rates:

```python
# apps/ai-service/app/providers/anthropic.py

# Enable prompt caching for agent system prompts
# System prompts for each agent type are stable (they change only when we update them)
# Input context (job data, customer data) changes per call
# Caching saves ~90% on the system prompt portion

response = await self.client.messages.create(
    model='claude-sonnet-4-20260514',
    system=[
        {
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"}  # Cache this portion
        }
    ],
    messages=messages,
)
```

### Caching Frequent Queries

Common copilot queries like "What's outstanding?" or "How many jobs today?" do not need a full LLM call. These are routed to DB queries directly:

```typescript
// If intent is classified as a simple DB query, skip the LLM reasoning step
// and query the database directly. This saves ~$0.01-0.05 per query.
const DIRECT_QUERY_INTENTS = [
  'query.outstanding_invoices',
  'query.todays_jobs',
  'query.customer_lookup',
  'query.invoice_status',
  'query.job_count',
];
```

### Batching Non-Urgent Work

The daily digest, weekly digest, data anonymization, and conversation summarization jobs are batched and run during off-peak hours (2am-6am). This avoids AI provider rate limits and takes advantage of any off-peak pricing.

### Fine-Tuned Models (Phase 2)

Phase 2 introduces fine-tuned open-source models for high-volume, low-complexity tasks:

| Task | Current Model | Phase 2 Model | Cost Reduction |
|------|--------------|---------------|----------------|
| Intent classification | GPT-5 Nano ($0.50/M) | SetFit / Semantic Router (self-hosted) | ~99% (compute only) |
| Expense categorization | Claude Sonnet ($9/M) | Fine-tuned DeepSeek V3.2 (self-hosted) | ~95% |
| Invoice line item extraction | Claude Sonnet ($9/M) | Fine-tuned model | ~90% |

---

## Billing Pipeline (Future)

### Current State: Flat-Rate Stripe Subscriptions

```typescript
// Current: simple Stripe subscription management
// Each tier maps to a Stripe Price ID

const STRIPE_PRICE_IDS = {
  starter_monthly: 'price_starter_monthly_99',
  starter_annual: 'price_starter_annual_948',    // $79/mo billed annually
  pro_monthly: 'price_pro_monthly_299',
  pro_annual: 'price_pro_annual_2988',            // $249/mo billed annually
  business_monthly: 'price_business_monthly_499',
  business_annual: 'price_business_annual_4788',  // $399/mo billed annually
  // enterprise: custom pricing, manual invoicing
};
```

### Future: Usage-Based Overages (If Ever Implemented)

The cost tracking infrastructure supports usage-based overages if the business model ever shifts. This is **not planned** — flat-rate pricing is a core differentiator ("No per-tech pricing, no usage-based pricing"). But the data is there if needed:

```typescript
// Hypothetical overage calculation (NOT IMPLEMENTED)
// If Starter tier exceeds 500 agent executions:
// $0.05 per additional execution

// This is why we track per-execution costs — the data exists to calculate overages
// without any schema changes. We just choose not to charge them.
```

---

## Cost Alerts

### Notification Triggers

| Alert | Trigger | Recipients | Channel |
|-------|---------|------------|---------|
| 80% usage warning | `checkUsageLimit()` returns `warning: true` | Org owner + admins | in_app, email |
| 100% usage hard stop | `checkUsageLimit()` returns `upgrade_needed: true` | Org owner + admins | in_app, email, sms |
| Weekly cost summary (Enterprise) | `weekly-digest` scheduled job | Org owner | email |
| Cost spike alert | Daily cost > 2x average daily cost | Org owner | in_app, email |

### Weekly Cost Summary for Enterprise Tier

Enterprise customers get an additional section in their weekly digest:

```typescript
// Added to weekly digest generation for enterprise orgs

if (org.tier === 'enterprise') {
  const costSummary = {
    total_cost_cents: usageData.total_cost_cents + usageData.copilot_cost_cents,
    cost_by_provider: usageData.cost_by_provider,
    cost_by_agent: getCostByAgent(orgId),
    cost_trend: calculateCostTrend(orgId, 4), // last 4 weeks
    projected_monthly: projectMonthlyCost(orgId),
  };

  // Include in weekly digest email
  weeklyDigestData.costSummary = costSummary;
}
```

---

## Implementation Notes

1. **Redis counters are the source of truth for limit enforcement.** The materialized view is for display only. If Redis loses data (restart), the counters reset to 0 for the remainder of the month — this is an acceptable trade-off because it's a brief window and benefits the customer (they get a temporary limit reset). The materialized view can be used to backfill Redis if needed.

2. **Cost data is eventually consistent.** The agent_executions `ai_cost_cents` is set when the execution completes. The materialized view refreshes hourly. The dashboard API blends real-time Redis counters (for usage limits) with the materialized view (for cost breakdowns). Minor inconsistencies are acceptable.

3. **Minimum cost is 1 cent.** Even a fast classification call that costs $0.001 is recorded as 1 cent. This simplifies integer math and ensures every execution has a non-zero cost for tracking purposes.

4. **File storage is calculated on demand.** Unlike execution counts (which are incrementally tracked), file storage is calculated by querying the files table for total size. This is acceptable because storage changes infrequently compared to execution counts.

5. **No per-user cost tracking.** Costs are tracked at the org level, not the user level. A Starter org with 3 team members shares one pool of 500 agent executions. This aligns with the flat-rate pricing model.

6. **Billing period resets on the 1st of each month.** Redis keys use the `YYYY-MM` format, so counters naturally reset when the month changes. The materialized view's `DATE_TRUNC('month', NOW())` filter does the same for cost aggregation.
