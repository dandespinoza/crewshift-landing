# 11 — Workflow Execution Engine

> The workflow engine allows contractors to create custom automations beyond the pre-built agent chains. Workflows combine agent actions, conditional logic, delays, notifications, and webhooks into multi-step automations. They can be created visually (workflow builder UI), through natural language via the copilot ("Build me a workflow that..."), or directly via the API.

**Cross-references:** [06-agent-runtime.md](./06-agent-runtime.md) (agent chains vs workflows — different systems), [07-agent-definitions.md](./07-agent-definitions.md) (agents referenced by workflows), [08-copilot.md](./08-copilot.md) (natural language workflow creation), [14-queue-system.md](./14-queue-system.md) (BullMQ handles delay steps and execution), [03-api-routes.md](./03-api-routes.md) (workflow CRUD routes)

---

## Table of Contents

1. [Workflow vs Agent Chains](#workflow-vs-agent-chains)
2. [Workflow Definition Schema](#workflow-definition-schema)
3. [Workflow Triggers](#workflow-triggers)
4. [Step Types](#step-types)
5. [Step Execution Model](#step-execution-model)
6. [Conditional Branching](#conditional-branching)
7. [Delay Steps](#delay-steps)
8. [Workflow Execution Tracking](#workflow-execution-tracking)
9. [Natural Language Workflow Creation](#natural-language-workflow-creation)
10. [Workflow Validation](#workflow-validation)
11. [Example Workflows](#example-workflows)
12. [API Routes](#api-routes)
13. [Implementation Details](#implementation-details)
14. [Decision Rationale](#decision-rationale)

---

## Workflow vs Agent Chains

CrewShift has two systems for multi-step automation. They serve different purposes and are designed for different users.

| Feature | Agent Chains | Custom Workflows |
|---|---|---|
| **Defined by** | Agent definitions in code (developer) | Users via UI, copilot, or API (contractor) |
| **Trigger source** | Events emitted by agent output | Events, schedules, or manual trigger |
| **Step types** | Agent-to-agent only | Agent, condition, delay, notify, webhook |
| **Branching** | No branching — fan-out only (multiple agents fire in parallel) | Yes — if/else conditions route to different steps |
| **Delay support** | No — all steps execute immediately | Yes — "wait 24 hours, then..." |
| **Customizable per org** | No — same chains for all orgs (configurable via autonomy rules) | Yes — each org creates their own workflows |
| **Stored in** | Agent definition code (`chains` property) | `workflows` table (JSONB `steps` column) |
| **Tracked in** | `agent_executions` table (individual agent runs) | `workflow_executions` table (full workflow run) |
| **Example** | `job.completed` triggers Invoice + Inventory + Customer agents simultaneously | "When invoice > $5K is created, text me the margin. If margin < 30%, also create a Slack alert." |

**When to use which:**

- **Agent chains** handle standard, universal workflows that every trades business needs (job completed triggers invoice + inventory deduction + customer notification). These are hardcoded because they should "just work" out of the box.
- **Custom workflows** handle business-specific automations that vary by contractor. One plumber wants a text when margins are low. Another wants a review request 48 hours after job completion. These can't be hardcoded.

**Boundary rule:** If an automation is universal to all trades businesses, it belongs in agent chain definitions. If it's specific to how one business operates, it belongs in the workflow engine.

---

## Workflow Definition Schema

### Database: `workflows` Table

```sql
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  description TEXT,
  trigger JSONB NOT NULL,           -- { type, conditions } — what starts this workflow
  steps JSONB NOT NULL DEFAULT '[]', -- [WorkflowStep, ...] — ordered list of steps
  enabled BOOLEAN DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookup of enabled workflows by trigger type
CREATE INDEX idx_workflows_org_enabled ON workflows(org_id, enabled) WHERE enabled = true;
CREATE INDEX idx_workflows_trigger ON workflows USING GIN (trigger);
```

### TypeScript Interface: WorkflowStep

```typescript
/**
 * WorkflowStep — a single step in a workflow definition.
 *
 * Steps are stored in the `workflows.steps` JSONB column as an ordered array.
 * Each step has a unique `id` (string), a `type` determining what it does,
 * a `config` object with type-specific parameters, and an optional `next`
 * pointer to the next step.
 *
 * For linear flows, steps execute in array order (step[0] → step[1] → step[2]).
 * For branching flows, condition steps use `then_step` and `else_step` to
 * route execution to specific step IDs.
 */
interface WorkflowStep {
  /** Unique identifier for this step within the workflow. Used for branching references. */
  id: string;

  /** Step type — determines what this step does. */
  type: 'agent' | 'condition' | 'delay' | 'notify' | 'webhook';

  /** Type-specific configuration. */
  config: AgentStepConfig | ConditionStepConfig | DelayStepConfig | NotifyStepConfig | WebhookStepConfig;

  /** Next step ID for linear flow. Null = end of workflow. */
  next?: string | null;
}

/**
 * Agent step — executes an agent action.
 * The workflow engine dispatches this to the agent runtime.
 */
interface AgentStepConfig {
  /** Which agent to run: 'invoice', 'estimate', 'collections', 'customer', etc. */
  agent_type: string;

  /** Specific action within the agent.
   *  Examples:
   *    - Invoice Agent: 'generate', 'send'
   *    - Customer Agent: 'send_review_request', 'send_completion_message'
   *    - Collections Agent: 'send_followup', 'check_status'
   *    - Insights Agent: 'generate_report', 'calculate_margin'
   */
  action: string;

  /**
   * Parameters passed to the agent.
   * Can reference trigger data and previous step outputs using template syntax:
   *   {{trigger.job_id}} — value from the trigger event
   *   {{steps.step_1.output.total}} — output from a previous step
   *   {{org.settings.tax_rate}} — org settings
   */
  params?: Record<string, any>;
}

/**
 * Condition step — evaluates an expression and branches.
 * If the expression is true, execution continues to `then_step`.
 * If false, execution continues to `else_step`.
 * If neither is specified, execution continues to `next` (true) or stops (false).
 */
interface ConditionStepConfig {
  /**
   * JavaScript-like expression that evaluates to boolean.
   * Has access to:
   *   - trigger: the trigger event data
   *   - steps: { [step_id]: { output, status } } — previous step results
   *   - org: organization data
   *
   * Examples:
   *   'trigger.invoice.total > 5000'
   *   'steps.calculate_margin.output.margin < 0.30'
   *   'trigger.job.type === "emergency"'
   *   'trigger.customer.payment_score < 0.5'
   */
  expression: string;

  /** Step ID to execute if expression is true. */
  then_step?: string;

  /** Step ID to execute if expression is false. */
  else_step?: string;
}

/**
 * Delay step — pauses workflow execution for a specified duration.
 * Implemented via BullMQ delayed jobs (not setTimeout or sleep).
 */
interface DelayStepConfig {
  /**
   * Duration string. Supported formats:
   *   '30m' — 30 minutes
   *   '1h' — 1 hour
   *   '24h' — 24 hours
   *   '48h' — 48 hours
   *   '7d' — 7 days
   *   '30d' — 30 days
   */
  duration: string;
}

/**
 * Notify step — sends a notification to the org owner/admin.
 */
interface NotifyStepConfig {
  /**
   * Notification channel:
   *   'sms' — via Twilio
   *   'email' — via Resend
   *   'in_app' — in-app notification bell
   *   'push' — mobile push notification
   */
  channel: string;

  /**
   * Message template. Supports variable interpolation:
   *   'Invoice {{steps.generate_invoice.output.invoice_number}} created for {{trigger.customer.name}} — ${{steps.generate_invoice.output.total}}'
   */
  template: string;

  /** Optional: specific user to notify. Defaults to org owner. */
  user_id?: string;
}

/**
 * Webhook step — makes an HTTP request to an external URL.
 * Used for integrations that don't have a native adapter (Slack, custom APIs, etc.).
 */
interface WebhookStepConfig {
  /** URL to call. */
  url: string;

  /** HTTP method. Default: 'POST'. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';

  /**
   * Request headers. API keys can be stored here for authenticated webhooks.
   * Values support template interpolation.
   */
  headers?: Record<string, string>;

  /**
   * Request body template. Supports variable interpolation.
   * Sent as JSON.
   */
  body?: Record<string, any>;

  /** Timeout in milliseconds. Default: 10000 (10 seconds). */
  timeout_ms?: number;
}
```

---

## Workflow Triggers

The `trigger` field in the `workflows` table defines what activates a workflow. It's a JSONB object with a `type` and `conditions` array.

### Trigger Schema

```typescript
interface WorkflowTrigger {
  /**
   * Trigger type:
   *   'event' — fires when a specific system event occurs
   *   'schedule' — fires on a cron schedule
   *   'manual' — fired explicitly via API or copilot
   */
  type: 'event' | 'schedule' | 'manual';

  /**
   * For 'event' type: the event name to listen for.
   * Standard events:
   *   'job.completed', 'job.scheduled', 'job.created'
   *   'invoice.created', 'invoice.sent', 'invoice.paid', 'invoice.overdue'
   *   'estimate.created', 'estimate.sent', 'estimate.accepted', 'estimate.rejected'
   *   'customer.created', 'customer.lead.inbound'
   *   'payment.received'
   */
  event?: string;

  /**
   * For 'schedule' type: cron expression.
   * Examples:
   *   '0 9 * * *' — daily at 9am
   *   '0 9 * * 1' — Mondays at 9am
   *   '0 9 1 * *' — 1st of every month at 9am
   */
  cron?: string;

  /**
   * Conditions that must ALL be true for the workflow to fire.
   * Conditions are evaluated against the trigger event data.
   * If any condition is false, the workflow does not execute.
   *
   * Examples:
   *   { field: 'job.total_amount', operator: '>', value: 5000 }
   *   { field: 'invoice.status', operator: '===', value: 'overdue' }
   *   { field: 'invoice.days_overdue', operator: '>=', value: 30 }
   *   { field: 'job.type', operator: '===', value: 'emergency' }
   */
  conditions?: TriggerCondition[];
}

interface TriggerCondition {
  /** Dot-notation path to the field in the trigger event data. */
  field: string;

  /** Comparison operator. */
  operator: '===' | '!==' | '>' | '>=' | '<' | '<=' | 'in' | 'not_in' | 'contains';

  /** Value to compare against. */
  value: string | number | boolean | string[];
}
```

### Trigger Examples (JSONB)

**Event trigger with conditions:**
```json
{
  "type": "event",
  "event": "job.completed",
  "conditions": [
    { "field": "job.total_amount", "operator": ">", "value": 5000 }
  ]
}
```

**Schedule trigger:**
```json
{
  "type": "schedule",
  "cron": "0 10 * * *"
}
```

**Manual trigger (no conditions — fired explicitly):**
```json
{
  "type": "manual"
}
```

### How Event Triggers Work

```
System Event (e.g., job.completed)
  │
  ├── Event Bus: fires to registered agent triggers (agent chains)
  │
  └── Workflow Matcher: queries enabled workflows for this event
      │
      SELECT * FROM workflows
      WHERE org_id = $1
        AND enabled = true
        AND trigger->>'event' = 'job.completed'
      │
      For each matching workflow:
        ├── Evaluate conditions against event data
        │   (all conditions must be true)
        ├── If all conditions pass:
        │   └── Enqueue workflow execution via BullMQ
        └── If any condition fails:
            └── Skip (logged at debug level)
```

---

## Step Types

### 1. Agent Step (`type: 'agent'`)

Executes an agent action through the agent runtime. The workflow engine doesn't run the agent itself — it dispatches a job to the agent runtime via the event bus.

```typescript
// Example: Generate an invoice for the completed job
{
  id: 'generate_invoice',
  type: 'agent',
  config: {
    agent_type: 'invoice',
    action: 'generate',
    params: {
      job_id: '{{trigger.job.id}}',
      customer_id: '{{trigger.job.customer_id}}'
    }
  },
  next: 'check_margin'
}
```

**How it executes:**
1. Workflow engine resolves template variables (`{{trigger.job.id}}` becomes the actual UUID)
2. Dispatches to agent runtime via `eventBus.emit('agent.execute', { agent_type, action, params })`
3. Waits for agent execution to complete (via BullMQ job completion callback)
4. Stores agent output in `step_results` for use by subsequent steps
5. Moves to the `next` step

### 2. Condition Step (`type: 'condition'`)

Evaluates a boolean expression and branches execution. Does not perform any action — purely routing logic.

```typescript
// Example: Check if the invoice margin is below 30%
{
  id: 'check_margin',
  type: 'condition',
  config: {
    expression: 'steps.generate_invoice.output.margin < 0.30',
    then_step: 'alert_low_margin',  // margin is low → alert
    else_step: 'send_summary'       // margin is fine → just text summary
  }
}
```

### 3. Delay Step (`type: 'delay'`)

Pauses workflow execution for a specified duration. Implemented using BullMQ delayed jobs — the workflow state is persisted in `workflow_executions`, and a delayed job is enqueued that will resume the workflow when the delay expires.

```typescript
// Example: Wait 24 hours before sending a review request
{
  id: 'wait_24h',
  type: 'delay',
  config: {
    duration: '24h'
  },
  next: 'send_review'
}
```

### 4. Notify Step (`type: 'notify'`)

Sends a notification to the contractor. Supports SMS, email, in-app, and push.

```typescript
// Example: Text the owner with the job margin
{
  id: 'send_margin_text',
  type: 'notify',
  config: {
    channel: 'sms',
    template: 'Job for {{trigger.customer.name}} completed. Total: ${{steps.generate_invoice.output.total}}. Margin: {{steps.calculate_margin.output.margin_percent}}%.'
  },
  next: null  // end of workflow
}
```

### 5. Webhook Step (`type: 'webhook'`)

Makes an HTTP call to an external service. Used for custom integrations (Slack, Zapier, custom CRMs, etc.).

```typescript
// Example: Post to a Slack webhook
{
  id: 'slack_alert',
  type: 'webhook',
  config: {
    url: 'https://hooks.slack.com/services/T00/B00/xxxx',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      text: 'Low margin alert: Job for {{trigger.customer.name}} had only {{steps.calculate_margin.output.margin_percent}}% margin (${{steps.generate_invoice.output.total}} total).'
    },
    timeout_ms: 5000
  },
  next: null
}
```

---

## Step Execution Model

### Default: Sequential Execution

Steps execute sequentially by default. Each step runs after the previous step completes. Step N's output is available to step N+1 via the `steps` object.

```
Step 1 (agent: generate_invoice)
  │ output: { invoice_number: "1247", total: 1840, margin: 0.35 }
  ▼
Step 2 (condition: total > 5000?)
  │ expression evaluates to: false
  │ routes to: else_step → 'send_summary'
  ▼
Step 3 (notify: send_summary via SMS)
  │ template resolves to: "Invoice #1247 for Henderson — $1,840 (35% margin)"
  ▼
[Workflow complete]
```

### Data Flow Between Steps

Every step's output is stored in `workflow_executions.step_results` as a JSONB object keyed by step ID:

```json
{
  "generate_invoice": {
    "status": "completed",
    "output": {
      "invoice_id": "uuid",
      "invoice_number": "1247",
      "total": 1840.00,
      "margin": 0.35,
      "margin_percent": 35
    },
    "completed_at": "2026-03-04T15:30:00Z"
  },
  "check_margin": {
    "status": "completed",
    "output": {
      "expression_result": false,
      "routed_to": "send_summary"
    },
    "completed_at": "2026-03-04T15:30:01Z"
  },
  "send_summary": {
    "status": "completed",
    "output": {
      "notification_id": "uuid",
      "channel": "sms",
      "delivered": true
    },
    "completed_at": "2026-03-04T15:30:02Z"
  }
}
```

### Template Variable Resolution

Template variables use double-curly-brace syntax `{{path.to.value}}` and are resolved at step execution time (not at workflow creation time).

Available namespaces:

| Namespace | Description | Example |
|---|---|---|
| `trigger` | The event data that triggered this workflow | `{{trigger.job.id}}`, `{{trigger.customer.name}}`, `{{trigger.invoice.total}}` |
| `steps` | Outputs from previously completed steps | `{{steps.generate_invoice.output.total}}`, `{{steps.calculate_margin.output.margin_percent}}` |
| `org` | Organization settings and data | `{{org.settings.tax_rate}}`, `{{org.name}}`, `{{org.trade_type}}` |

```typescript
// Template resolution implementation
function resolveTemplate(template: string, context: WorkflowContext): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const value = getNestedValue(context, path.trim());
    if (value === undefined) {
      logger.warn('template_variable_missing', { path, template });
      return match; // Leave unresolved if value is missing
    }
    return String(value);
  });
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}
```

---

## Conditional Branching

### Expression Evaluation

Condition step expressions are evaluated using a safe expression evaluator — NOT `eval()`. The evaluator supports:

| Operator | Example | Description |
|---|---|---|
| `>`, `>=`, `<`, `<=` | `trigger.invoice.total > 5000` | Numeric comparison |
| `===`, `!==` | `trigger.job.type === 'emergency'` | Strict equality |
| `&&`, `||` | `trigger.invoice.total > 5000 && steps.margin.output.value < 0.3` | Logical AND/OR |
| `!` | `!trigger.customer.has_paid_before` | Logical NOT |
| `in` | `trigger.job.status in ['completed', 'invoiced']` | Array membership |

```typescript
// Safe expression evaluator (NOT eval)
import { evaluate } from './expression-evaluator';

interface EvalContext {
  trigger: Record<string, any>;
  steps: Record<string, { output: Record<string, any> }>;
  org: Record<string, any>;
}

function evaluateCondition(expression: string, context: EvalContext): boolean {
  try {
    const result = evaluate(expression, context);
    return Boolean(result);
  } catch (error) {
    logger.error('condition_eval_error', { expression, error: error.message });
    return false; // Fail closed — condition fails, workflow follows else_step or stops
  }
}
```

**Why not `eval()`?** Workflow expressions come from user input (either typed directly or generated by the copilot). Using JavaScript `eval()` would be a code injection vulnerability — a user could write `process.exit(1)` as a condition expression. The safe evaluator only supports comparison operators and logical operators against the provided context object.

### Branching Execution Flow

```
                        ┌─────────────────┐
                        │ condition step   │
                        │ expression:      │
                        │ total > 5000     │
                        └────────┬────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
              true (then_step)          false (else_step)
                    │                         │
           ┌────────▼────────┐       ┌────────▼────────┐
           │ alert_owner     │       │ send_summary    │
           │ (notify: sms)   │       │ (notify: sms)   │
           └────────┬────────┘       └────────┬────────┘
                    │                         │
                    └─────────┬───────────────┘
                              │
                     [workflow continues or ends]
```

If a condition step has neither `then_step` nor `else_step`, the workflow:
- Continues to `next` if the expression is true
- Ends if the expression is false (no path to follow)

---

## Delay Steps

Delay steps are the critical feature that differentiates workflows from agent chains. They enable time-based automations like "send a review request 24 hours after job completion."

### Implementation: BullMQ Delayed Jobs

Delays are NOT implemented with `setTimeout` or `sleep`. The workflow execution is paused, its state is persisted, and a BullMQ delayed job is enqueued that will resume the workflow when the delay expires.

```typescript
// workflow.service.ts — handling a delay step
async function executeDelayStep(
  execution: WorkflowExecution,
  step: WorkflowStep,
  context: WorkflowContext,
): Promise<void> {
  const durationMs = parseDuration(step.config.duration);

  // 1. Update execution status to 'paused'
  await updateWorkflowExecution(execution.id, {
    status: 'paused',
    current_step: step.id,
    step_results: {
      ...execution.step_results,
      [step.id]: {
        status: 'waiting',
        resume_at: new Date(Date.now() + durationMs).toISOString(),
      },
    },
  });

  // 2. Enqueue a delayed BullMQ job that will resume the workflow
  await workflowQueue.add(
    'resume-workflow',
    {
      execution_id: execution.id,
      workflow_id: execution.workflow_id,
      org_id: execution.org_id,
      next_step: step.next,
      context, // Full context is persisted so the workflow can resume
    },
    {
      delay: durationMs, // BullMQ will process this job after the delay
      jobId: `workflow-resume:${execution.id}:${step.id}`, // Idempotency key
    },
  );

  logger.info('workflow_delayed', {
    execution_id: execution.id,
    step_id: step.id,
    duration: step.config.duration,
    resume_at: new Date(Date.now() + durationMs).toISOString(),
  });
}

// Duration parser
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(m|h|d)$/);
  if (!match) throw new Error(`Invalid duration: ${duration}`);

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: throw new Error(`Invalid duration unit: ${unit}`);
  }
}
```

**Why BullMQ delayed jobs?**

- **Persistent:** If the server restarts during a 24-hour delay, the job survives in Redis and executes on time
- **Reliable:** BullMQ handles scheduling, retry on failure, and dead-letter queuing
- **Observable:** Delayed jobs are visible in the BullMQ dashboard — you can see when each workflow will resume
- **Scalable:** Works across multiple worker instances

**What happens if the server restarts mid-delay?**

The delayed job is stored in Redis with its precise execution timestamp. When the server comes back up and the BullMQ worker reconnects, any overdue delayed jobs execute immediately. There is no data loss.

---

## Workflow Execution Tracking

### Database: `workflow_executions` Table

```sql
CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  trigger_data JSONB,                   -- the event/data that triggered this run
  status TEXT NOT NULL DEFAULT 'running', -- 'running', 'completed', 'failed', 'paused'
  current_step TEXT,                     -- step id currently executing (or paused on)
  step_results JSONB DEFAULT '{}',      -- { step_id: { status, output, timestamp } }
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error TEXT                             -- error message if status = 'failed'
);

-- Index for finding active executions
CREATE INDEX idx_workflow_executions_status ON workflow_executions(org_id, status)
  WHERE status IN ('running', 'paused');

-- Index for finding executions by workflow
CREATE INDEX idx_workflow_executions_workflow ON workflow_executions(workflow_id, started_at DESC);
```

### Execution Status Lifecycle

```
┌──────────┐     step succeeds     ┌───────────┐
│ running  ├──────────────────────▶│ running   │ (next step)
└──────┬───┘                       └───────────┘
       │
       │ delay step
       ▼
┌──────────┐     delay expires     ┌───────────┐
│ paused   ├──────────────────────▶│ running   │ (resume)
└──────────┘                       └───────────┘
       │
       │ last step completes
       ▼
┌──────────────┐
│ completed    │
└──────────────┘

       │ any step fails (after retries)
       ▼
┌──────────────┐
│ failed       │
└──────────────┘
```

### step_results JSONB Structure

The `step_results` column is a running record of every step's execution in this workflow run. It grows as each step completes:

```json
{
  "generate_invoice": {
    "status": "completed",
    "output": {
      "invoice_id": "8f2a3b1c-...",
      "invoice_number": "1247",
      "total": 6200.00,
      "margin": 0.28
    },
    "started_at": "2026-03-04T15:30:00Z",
    "completed_at": "2026-03-04T15:30:03Z",
    "duration_ms": 3000
  },
  "check_margin": {
    "status": "completed",
    "output": {
      "expression": "steps.generate_invoice.output.margin < 0.30",
      "result": true,
      "routed_to": "alert_low_margin"
    },
    "started_at": "2026-03-04T15:30:03Z",
    "completed_at": "2026-03-04T15:30:03Z",
    "duration_ms": 5
  },
  "alert_low_margin": {
    "status": "completed",
    "output": {
      "notification_id": "abc123",
      "channel": "sms",
      "message": "Low margin alert: Henderson job at 28% ($6,200 total)",
      "delivered": true
    },
    "started_at": "2026-03-04T15:30:03Z",
    "completed_at": "2026-03-04T15:30:04Z",
    "duration_ms": 1200
  }
}
```

---

## Natural Language Workflow Creation

The copilot can translate natural language descriptions into workflow definitions. This is how contractors who don't want to use a visual builder can create automations.

### Flow

```
Contractor says: "Build me a workflow that sends me a text with the
margin breakdown after every completed job over $5,000"

  1. Copilot classifies intent as 'create-workflow'

  2. Copilot sends to /ai/reason with the workflow-creation prompt:
     - System prompt: "You are a workflow builder. Translate the user's
       description into a workflow definition JSON."
     - User prompt: the contractor's message
     - Output schema: WorkflowDefinition
     - Business context: available agents, notification channels, org settings

  3. AI returns a workflow definition:
     {
       name: "High-value job margin alert",
       description: "Text owner with margin breakdown for jobs over $5K",
       trigger: { type: "event", event: "job.completed", conditions: [...] },
       steps: [...]
     }

  4. Copilot presents the workflow to the contractor for confirmation:
     "Here's the workflow I created:
      - Triggers: When a job over $5,000 is completed
      - Step 1: Calculate job margin (Insights Agent)
      - Step 2: Send SMS with margin breakdown
      Want me to enable it?"

  5. Contractor confirms → workflow saved to DB → enabled
```

### Workflow Creation Prompt (summarized)

The prompt includes:
- Available agent types and their actions
- Available notification channels
- Available trigger events
- Constraint: steps must be one of the five types (agent, condition, delay, notify, webhook)
- Examples of well-formed workflow definitions
- The contractor's natural language description

The AI must output valid JSON matching the `WorkflowDefinition` schema. The output goes through validation (see next section) before being saved.

### Copilot Confirmation UX

The copilot never silently creates and enables a workflow. It always:

1. Generates the workflow definition
2. Describes what the workflow will do in plain English
3. Asks the contractor to confirm
4. Only saves and enables after explicit confirmation

This is a human-in-the-loop checkpoint for workflow creation — you don't want an AI-generated workflow silently sending SMS to customers at 3am because it misunderstood the request.

---

## Workflow Validation

Every workflow goes through validation before being saved or enabled. This catches errors at definition time, not at execution time.

### Validation Checks

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

async function validateWorkflow(workflow: WorkflowDefinition): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // 1. TRIGGER VALIDATION
  if (!workflow.trigger.type) {
    errors.push({ field: 'trigger.type', message: 'Trigger type is required' });
  }
  if (workflow.trigger.type === 'event' && !workflow.trigger.event) {
    errors.push({ field: 'trigger.event', message: 'Event name required for event triggers' });
  }
  if (workflow.trigger.type === 'schedule' && !isValidCron(workflow.trigger.cron)) {
    errors.push({ field: 'trigger.cron', message: 'Invalid cron expression' });
  }

  // 2. STEP VALIDATION
  if (!workflow.steps || workflow.steps.length === 0) {
    errors.push({ field: 'steps', message: 'Workflow must have at least one step' });
  }

  const stepIds = new Set<string>();
  for (const step of workflow.steps) {
    // Unique step IDs
    if (stepIds.has(step.id)) {
      errors.push({ field: `steps.${step.id}`, message: `Duplicate step ID: ${step.id}` });
    }
    stepIds.add(step.id);

    // Valid step type
    if (!['agent', 'condition', 'delay', 'notify', 'webhook'].includes(step.type)) {
      errors.push({ field: `steps.${step.id}.type`, message: `Invalid step type: ${step.type}` });
    }

    // Agent step: valid agent_type
    if (step.type === 'agent') {
      const validAgents = ['invoice', 'estimate', 'collections', 'bookkeeping', 'insights', 'field-ops', 'compliance', 'inventory', 'customer'];
      if (!validAgents.includes(step.config.agent_type)) {
        errors.push({ field: `steps.${step.id}.agent_type`, message: `Unknown agent: ${step.config.agent_type}` });
      }
    }

    // Condition step: expression is parseable
    if (step.type === 'condition') {
      try {
        parseExpression(step.config.expression); // Syntax check only
      } catch {
        errors.push({ field: `steps.${step.id}.expression`, message: 'Invalid expression syntax' });
      }
    }

    // Delay step: valid duration
    if (step.type === 'delay') {
      if (!isValidDuration(step.config.duration)) {
        errors.push({ field: `steps.${step.id}.duration`, message: `Invalid duration: ${step.config.duration}` });
      }
      if (parseDuration(step.config.duration) > 30 * 24 * 60 * 60 * 1000) {
        warnings.push({ field: `steps.${step.id}.duration`, message: 'Delay exceeds 30 days — is this intentional?' });
      }
    }

    // Notify step: valid channel
    if (step.type === 'notify') {
      if (!['sms', 'email', 'in_app', 'push'].includes(step.config.channel)) {
        errors.push({ field: `steps.${step.id}.channel`, message: `Invalid channel: ${step.config.channel}` });
      }
    }

    // Webhook step: valid URL
    if (step.type === 'webhook') {
      try {
        new URL(step.config.url);
      } catch {
        errors.push({ field: `steps.${step.id}.url`, message: 'Invalid webhook URL' });
      }
    }
  }

  // 3. GRAPH VALIDATION — no orphan steps, no infinite loops
  // Verify all referenced step IDs (next, then_step, else_step) exist
  for (const step of workflow.steps) {
    if (step.next && !stepIds.has(step.next)) {
      errors.push({ field: `steps.${step.id}.next`, message: `References non-existent step: ${step.next}` });
    }
    if (step.config.then_step && !stepIds.has(step.config.then_step)) {
      errors.push({ field: `steps.${step.id}.then_step`, message: `References non-existent step: ${step.config.then_step}` });
    }
    if (step.config.else_step && !stepIds.has(step.config.else_step)) {
      errors.push({ field: `steps.${step.id}.else_step`, message: `References non-existent step: ${step.config.else_step}` });
    }
  }

  // Cycle detection (DFS)
  if (hasCycle(workflow.steps)) {
    errors.push({ field: 'steps', message: 'Workflow contains a cycle (infinite loop)' });
  }

  // 4. LIMITS
  if (workflow.steps.length > 20) {
    errors.push({ field: 'steps', message: 'Workflow cannot exceed 20 steps' });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
```

---

## Example Workflows

### Example 1: "After every completed job over $5K, text me the margin"

```json
{
  "name": "High-value job margin alert",
  "description": "Text owner with margin breakdown for completed jobs over $5,000",
  "trigger": {
    "type": "event",
    "event": "job.completed",
    "conditions": [
      { "field": "job.total_amount", "operator": ">", "value": 5000 }
    ]
  },
  "steps": [
    {
      "id": "calculate_margin",
      "type": "agent",
      "config": {
        "agent_type": "insights",
        "action": "calculate_margin",
        "params": {
          "job_id": "{{trigger.job.id}}"
        }
      },
      "next": "send_text"
    },
    {
      "id": "send_text",
      "type": "notify",
      "config": {
        "channel": "sms",
        "template": "Job for {{trigger.customer.name}} completed (${{trigger.job.total_amount}}). Margin: {{steps.calculate_margin.output.margin_percent}}%. Revenue: ${{steps.calculate_margin.output.revenue}}, Costs: ${{steps.calculate_margin.output.costs}}."
      },
      "next": null
    }
  ],
  "enabled": true
}
```

**Execution trace:**

1. `job.completed` event fires for a $6,200 Henderson job
2. Trigger condition `job.total_amount > 5000` evaluates to `true`
3. Step `calculate_margin`: Insights Agent calculates margin (revenue $6,200, costs $4,464, margin 28%)
4. Step `send_text`: SMS sent to owner: "Job for Henderson completed ($6200). Margin: 28%. Revenue: $6200, Costs: $4464."
5. Workflow execution status: `completed`

### Example 2: "24 hours after job completion, send review request"

```json
{
  "name": "Post-job review request",
  "description": "Send customer a review request 24 hours after job is completed",
  "trigger": {
    "type": "event",
    "event": "job.completed"
  },
  "steps": [
    {
      "id": "wait_24h",
      "type": "delay",
      "config": {
        "duration": "24h"
      },
      "next": "send_review"
    },
    {
      "id": "send_review",
      "type": "agent",
      "config": {
        "agent_type": "customer",
        "action": "send_review_request",
        "params": {
          "customer_id": "{{trigger.job.customer_id}}",
          "job_id": "{{trigger.job.id}}"
        }
      },
      "next": null
    }
  ],
  "enabled": true
}
```

**Execution trace:**

1. `job.completed` event fires at 3:00 PM on Monday
2. Step `wait_24h`: Workflow paused. BullMQ delayed job scheduled for 3:00 PM Tuesday.
3. Workflow execution status: `paused`, current_step: `wait_24h`
4. 3:00 PM Tuesday: delayed job fires, workflow resumes
5. Step `send_review`: Customer Agent sends Google/Yelp review request to customer
6. Workflow execution status: `completed`

### Example 3: "When invoice is overdue 30 days, escalate to collections with phone call"

```json
{
  "name": "30-day collections escalation",
  "description": "When an invoice hits 30 days overdue, escalate to collections and notify owner",
  "trigger": {
    "type": "event",
    "event": "invoice.overdue",
    "conditions": [
      { "field": "invoice.days_overdue", "operator": ">=", "value": 30 }
    ]
  },
  "steps": [
    {
      "id": "check_payment_history",
      "type": "agent",
      "config": {
        "agent_type": "collections",
        "action": "check_status",
        "params": {
          "invoice_id": "{{trigger.invoice.id}}",
          "customer_id": "{{trigger.invoice.customer_id}}"
        }
      },
      "next": "check_if_paid"
    },
    {
      "id": "check_if_paid",
      "type": "condition",
      "config": {
        "expression": "steps.check_payment_history.output.has_pending_payment === false",
        "then_step": "escalate",
        "else_step": null
      }
    },
    {
      "id": "escalate",
      "type": "agent",
      "config": {
        "agent_type": "collections",
        "action": "send_followup",
        "params": {
          "invoice_id": "{{trigger.invoice.id}}",
          "escalation_level": 4,
          "include_lien_warning": true
        }
      },
      "next": "notify_owner"
    },
    {
      "id": "notify_owner",
      "type": "notify",
      "config": {
        "channel": "sms",
        "template": "Collections escalation: {{trigger.customer.name}} invoice #{{trigger.invoice.invoice_number}} (${{trigger.invoice.total}}) is 30+ days overdue. Final notice sent with lien warning."
      },
      "next": "webhook_crm"
    },
    {
      "id": "webhook_crm",
      "type": "webhook",
      "config": {
        "url": "https://hooks.zapier.com/hooks/catch/12345/abcdef/",
        "method": "POST",
        "body": {
          "event": "collections_escalation",
          "customer_name": "{{trigger.customer.name}}",
          "invoice_number": "{{trigger.invoice.invoice_number}}",
          "amount": "{{trigger.invoice.total}}",
          "days_overdue": "{{trigger.invoice.days_overdue}}"
        },
        "timeout_ms": 5000
      },
      "next": null
    }
  ],
  "enabled": true
}
```

---

## API Routes

```
# WORKFLOW CRUD
GET    /api/workflows                 # List all workflows for the org
POST   /api/workflows                 # Create a new workflow
GET    /api/workflows/:id             # Get workflow detail
PATCH  /api/workflows/:id             # Update workflow (name, steps, trigger)
DELETE /api/workflows/:id             # Delete workflow
POST   /api/workflows/:id/enable      # Enable workflow
POST   /api/workflows/:id/disable     # Disable workflow
POST   /api/workflows/:id/test        # Test-run workflow with mock trigger data

# WORKFLOW EXECUTIONS (read-only — executions are created by the system)
GET    /api/workflows/:id/executions  # List executions for a workflow
GET    /api/workflows/executions/:id  # Get execution detail (with step_results)
```

### Create Workflow: POST /api/workflows

```typescript
// Request body
{
  name: string;              // Required
  description?: string;
  trigger: WorkflowTrigger;  // Required
  steps: WorkflowStep[];     // Required, min 1 step
  enabled?: boolean;         // Default: false (create disabled, user enables explicitly)
}

// Response (after validation passes)
{
  data: {
    id: "uuid",
    name: "High-value job margin alert",
    description: "...",
    trigger: { ... },
    steps: [ ... ],
    enabled: false,
    created_by: "user-uuid",
    created_at: "2026-03-04T15:30:00Z"
  }
}

// Response (if validation fails)
{
  error: {
    code: "VALIDATION_ERROR",
    message: "Workflow validation failed",
    details: {
      errors: [
        { field: "steps.0.agent_type", message: "Unknown agent: foo" }
      ],
      warnings: []
    }
  }
}
```

### RBAC for Workflows

| Action | owner | admin | member | tech |
|---|---|---|---|---|
| List workflows | yes | yes | yes | no |
| Create workflow | yes | yes | yes | no |
| Update workflow | yes | yes | yes (own only) | no |
| Delete workflow | yes | yes | no | no |
| Enable/disable | yes | yes | no | no |
| View executions | yes | yes | yes | no |

---

## Implementation Details

### Workflow Executor Service

```typescript
// workflow.service.ts — core execution engine

import { EventEmitter } from 'events';
import { Queue } from 'bullmq';

class WorkflowExecutor {
  constructor(
    private db: Database,
    private eventBus: EventEmitter,
    private agentRuntime: AgentRuntime,
    private notificationService: NotificationService,
    private workflowQueue: Queue,
  ) {}

  /**
   * Start executing a workflow from its first step.
   * Called when a trigger event matches an enabled workflow.
   */
  async startExecution(
    workflow: Workflow,
    triggerData: Record<string, any>,
  ): Promise<WorkflowExecution> {
    // Create execution record
    const execution = await this.db.insert('workflow_executions', {
      org_id: workflow.org_id,
      workflow_id: workflow.id,
      trigger_data: triggerData,
      status: 'running',
      current_step: workflow.steps[0]?.id,
      step_results: {},
    });

    // Start executing from step 0
    await this.executeStep(execution, workflow.steps[0], {
      trigger: triggerData,
      steps: {},
      org: await this.db.getOrg(workflow.org_id),
    });

    return execution;
  }

  /**
   * Execute a single step and advance to the next.
   */
  async executeStep(
    execution: WorkflowExecution,
    step: WorkflowStep,
    context: WorkflowContext,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Update current step
      await this.updateExecution(execution.id, { current_step: step.id });

      let output: Record<string, any>;

      switch (step.type) {
        case 'agent':
          output = await this.executeAgentStep(step, context, execution.org_id);
          break;
        case 'condition':
          output = await this.executeConditionStep(step, context);
          break;
        case 'delay':
          // Delay step pauses execution — returns without advancing
          await this.executeDelayStep(execution, step, context);
          return; // Important: do NOT advance to next step here
        case 'notify':
          output = await this.executeNotifyStep(step, context, execution.org_id);
          break;
        case 'webhook':
          output = await this.executeWebhookStep(step, context);
          break;
        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }

      // Record step result
      const stepResult = {
        status: 'completed',
        output,
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      };

      const updatedResults = {
        ...execution.step_results,
        [step.id]: stepResult,
      };

      await this.updateExecution(execution.id, {
        step_results: updatedResults,
      });

      // Update context with this step's output
      context.steps[step.id] = { output };

      // Determine next step
      let nextStepId: string | null = null;

      if (step.type === 'condition') {
        // Condition step routes via then_step / else_step
        nextStepId = output.result ? step.config.then_step : step.config.else_step;
      } else {
        nextStepId = step.next || null;
      }

      // If there's a next step, execute it
      if (nextStepId) {
        const nextStep = this.findStep(execution.workflow_id, nextStepId);
        if (nextStep) {
          await this.executeStep(execution, nextStep, context);
        } else {
          throw new Error(`Step not found: ${nextStepId}`);
        }
      } else {
        // No next step — workflow complete
        await this.updateExecution(execution.id, {
          status: 'completed',
          completed_at: new Date().toISOString(),
        });
      }

    } catch (error) {
      // Step failed — mark workflow as failed
      const stepResult = {
        status: 'failed',
        error: error.message,
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
      };

      await this.updateExecution(execution.id, {
        status: 'failed',
        step_results: { ...execution.step_results, [step.id]: stepResult },
        error: `Step ${step.id} failed: ${error.message}`,
      });

      logger.error('workflow_step_failed', {
        execution_id: execution.id,
        step_id: step.id,
        error: error.message,
      });
    }
  }

  private async executeAgentStep(step: WorkflowStep, context: WorkflowContext, orgId: string) {
    const resolvedParams = resolveTemplates(step.config.params || {}, context);
    const result = await this.agentRuntime.executeAgent({
      agent_type: step.config.agent_type,
      action: step.config.action,
      params: resolvedParams,
      org_id: orgId,
      trigger_type: 'workflow',
    });
    return result.output_data;
  }

  private async executeConditionStep(step: WorkflowStep, context: WorkflowContext) {
    const result = evaluateCondition(step.config.expression, context);
    return {
      expression: step.config.expression,
      result,
      routed_to: result ? step.config.then_step : step.config.else_step,
    };
  }

  private async executeNotifyStep(step: WorkflowStep, context: WorkflowContext, orgId: string) {
    const message = resolveTemplate(step.config.template, context);
    const notificationId = await this.notificationService.send({
      org_id: orgId,
      channel: step.config.channel,
      message,
      user_id: step.config.user_id,
    });
    return { notification_id: notificationId, channel: step.config.channel, delivered: true };
  }

  private async executeWebhookStep(step: WorkflowStep, context: WorkflowContext) {
    const resolvedBody = resolveTemplates(step.config.body || {}, context);
    const response = await fetch(step.config.url, {
      method: step.config.method || 'POST',
      headers: { 'Content-Type': 'application/json', ...(step.config.headers || {}) },
      body: JSON.stringify(resolvedBody),
      signal: AbortSignal.timeout(step.config.timeout_ms || 10000),
    });
    return { status: response.status, ok: response.ok };
  }
}
```

---

## Decision Rationale

| Decision | Choice | Alternatives Considered | Why |
|---|---|---|---|
| Workflow steps in JSONB | Single JSONB array column | Separate `workflow_steps` table with FK | JSONB keeps the entire workflow definition in one row — simpler queries, atomic updates. Workflows have < 20 steps, so JSONB size is not a concern. A separate table adds join complexity for no benefit at this scale. |
| BullMQ for delays | Delayed jobs | pg_cron, setTimeout, node-schedule | BullMQ delayed jobs survive server restarts (persisted in Redis). setTimeout is lost on restart. pg_cron is for DB-level scheduling, not app workflow delays. |
| Safe expression evaluator | Custom parser | JavaScript eval(), jsonata, json-logic | eval() is a security vulnerability (user-provided expressions). jsonata/json-logic add dependencies for simple comparisons. A custom parser supporting `>`, `<`, `===`, `&&`, `||` covers all needed cases. |
| Validation at save time | Pre-save validation | Runtime-only validation, no validation | Catching errors at save time (broken step references, invalid agent types, infinite loops) prevents deploying broken workflows. Runtime errors are harder to debug and damage trust. |
| Workflows stored per-org | org_id FK | Global workflow templates | Every workflow is org-specific because conditions, thresholds, and notification preferences vary by business. Global templates could be a Phase 2 feature (marketplace of pre-built workflows). |
| Copilot confirmation for NL creation | Always confirm before enabling | Auto-enable AI-generated workflows | Workflows can send SMS, trigger agents, and call webhooks. Auto-enabling an AI-generated workflow without confirmation risks unintended actions (e.g., sending SMS to customers at 3am). Always confirm. |
