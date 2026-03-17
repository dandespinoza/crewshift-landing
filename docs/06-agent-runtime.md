# 06 — Agent Runtime Engine

> Permanent reference for the CrewShift agent runtime. Covers the core engine, type system, execution pipeline, event bus, agent registry, chaining, human-in-the-loop review queue, idempotency, execution lifecycle, and error handling within agent execution.

---

## Table of Contents

1. [Design Principle](#1-design-principle)
2. [Core TypeScript Interfaces](#2-core-typescript-interfaces)
3. [Execution Pipeline (9 Steps)](#3-execution-pipeline-9-steps)
4. [Event Bus](#4-event-bus)
5. [Agent Registry](#5-agent-registry)
6. [Agent Chaining](#6-agent-chaining)
7. [Human-in-the-Loop Review Queue](#7-human-in-the-loop-review-queue)
8. [Idempotency](#8-idempotency)
9. [Agent Execution Lifecycle](#9-agent-execution-lifecycle)
10. [Error Handling Within Agent Execution](#10-error-handling-within-agent-execution)

---

## 1. Design Principle

You are not building 9 separate products. You are building **one agent runtime** that executes 9 different configurations. The framework is the product. Individual agents are instances of it.

**Why a custom runtime (not LangGraph, CrewAI, or AutoGen)?**
- Trade workflows are **deterministic enough** that a full LLM-orchestration framework adds unnecessary complexity, latency, and cost
- Full control over execution flow, cost tracking, and retry behavior
- No dependency on a fast-moving open-source framework that might break or change direction
- Our runtime is purpose-built for the event-driven, multi-tenant, autonomy-tiered pattern that CrewShift needs
- Agent definitions are declarative JSON/TypeScript configs, not imperative code chains

**Architecture summary:**

```
Events (job.completed, chat messages, cron ticks, chain events)
    |
    v
Event Bus (Node EventEmitter) --> matches events to agent triggers
    |
    v
Agent Registry (lookup agent definitions by trigger)
    |
    v
Agent Runtime Engine (executes the 9-step pipeline)
    |
    v
Outputs (DB records, external syncs, PDFs, notifications)
    |
    v
Chain Events (trigger downstream agents)
```

---

## 2. Core TypeScript Interfaces

These interfaces define the complete type system for agent definitions, triggers, steps, inputs, outputs, autonomy rules, and chain rules.

```typescript
// src/agents/types.ts

// ============================================================
// AGENT DEFINITION — The top-level configuration for an agent
// ============================================================

export interface AgentDefinition {
  /** Unique agent type identifier: 'invoice', 'estimate', 'collections', etc. */
  type: string;

  /** Human-readable agent name: 'Invoice Agent', 'Estimate Agent', etc. */
  name: string;

  /** Agent category for grouping in the UI */
  category: 'money-admin' | 'field-ops' | 'customer-sales' | 'growth';

  /** What activates this agent */
  triggers: AgentTrigger[];

  /** What data the agent needs to execute */
  inputs: AgentInput[];

  /** The execution pipeline — ordered sequence of steps */
  steps: AgentStep[];

  /** What the agent produces */
  outputs: AgentOutput[];

  /** Rules governing auto-execution vs human review */
  autonomy: AutonomyRules;

  /** What other agents to trigger after completion */
  chains: ChainRule[];
}


// ============================================================
// AGENT TRIGGER — What activates an agent
// ============================================================

export interface AgentTrigger {
  /** How this agent is triggered */
  type: 'event' | 'chat' | 'schedule' | 'chain';

  /**
   * Event name that triggers this agent.
   * Only used when type = 'event' or type = 'chain'.
   * Examples: 'job.completed', 'invoice.overdue', 'estimate.accepted'
   */
  event?: string;

  /**
   * Intent that routes to this agent from copilot.
   * Only used when type = 'chat'.
   * Examples: 'create-invoice', 'check-collections', 'schedule-job'
   */
  intent?: string;

  /**
   * Cron expression for scheduled triggers.
   * Only used when type = 'schedule'.
   * Examples: '0 9 * * *' (daily at 9am), '0 9 * * 1' (every Monday at 9am)
   */
  cron?: string;

  /**
   * Optional condition expression evaluated against the event payload.
   * Agent only triggers if this evaluates to true.
   * Examples: 'job.total_amount > 0', 'invoice.status === "overdue"'
   */
  condition?: string;
}


// ============================================================
// AGENT STEP — A single step in the execution pipeline
// ============================================================

export interface AgentStep {
  /** Unique step identifier within this agent */
  id: string;

  /** Step type determines what the runtime does */
  type: 'ai_reason' | 'lookup' | 'validate' | 'integrate' | 'notify' | 'autonomy_check' | 'transform';

  /**
   * Step-specific configuration.
   * Structure depends on the step type:
   *
   * 'lookup': { table, fields, relation, filters }
   * 'ai_reason': { endpoint, prompt_template, model_tier, output_schema }
   * 'validate': { rules: string[] }
   * 'autonomy_check': {} (uses agent's autonomy rules)
   * 'integrate': { action, target, sync_to }
   * 'notify': { channel, title, body }
   * 'transform': { mapping }
   */
  config: Record<string, any>;

  /**
   * Optional: maximum time this step can take (milliseconds).
   * Default: 30000 (30 seconds) for ai_reason, 10000 (10 seconds) for others.
   */
  timeout?: number;

  /**
   * Optional: number of retry attempts for this step.
   * Default: 0 for ai_reason (handled by circuit breaker), 2 for integrate, 0 for others.
   */
  retries?: number;

  /**
   * Optional: if true, step failure does not stop the pipeline.
   * Default: false. Use for non-critical steps like notifications.
   */
  optional?: boolean;
}


// ============================================================
// AGENT INPUT — What data the agent needs
// ============================================================

export interface AgentInput {
  /** Where the data comes from */
  source: 'db' | 'context' | 'integration' | 'event_payload' | 'user_message';

  /**
   * For source='db': the table to query.
   * Examples: 'jobs', 'customers', 'invoices', 'organizations'
   */
  table?: string;

  /**
   * For source='db': which fields to select.
   * ['*'] for all fields, or specific field names.
   */
  fields?: string[];

  /**
   * For source='db': how to join/relate this data to the trigger context.
   * Examples: 'trigger.job_id', 'job.customer_id'
   */
  relation?: string;

  /**
   * For source='context': the business context key to look up.
   * Examples: 'pricing', 'invoice_preferences', 'customer_history'
   */
  key?: string;

  /**
   * For source='integration': the provider to query.
   * Examples: 'quickbooks', 'jobber'
   */
  provider?: string;
}


// ============================================================
// AGENT OUTPUT — What the agent produces
// ============================================================

export interface AgentOutput {
  /** Type of output */
  type: 'db_record' | 'external_sync' | 'pdf' | 'notification' | 'email' | 'sms' | 'event';

  /**
   * For type='db_record': the table to write to.
   * Examples: 'invoices', 'estimates', 'notifications'
   */
  table?: string;

  /**
   * For type='external_sync': the provider to sync with.
   * Examples: 'quickbooks', 'xero', 'stripe'
   */
  provider?: string;

  /**
   * For type='pdf': where to store the PDF.
   * Examples: 's3', 'r2'
   */
  storage?: string;

  /**
   * For type='event': the event name to emit.
   * Examples: 'invoice.created', 'estimate.generated'
   */
  event?: string;
}


// ============================================================
// AUTONOMY RULES — What requires human review
// ============================================================

export interface AutonomyRules {
  /**
   * Actions that execute without human review.
   * These are low-risk, high-confidence actions.
   * Examples:
   *   'create_invoice where total < 500 AND confidence > 0.9'
   *   'generate_pdf'
   *   'sync_to_quickbooks'
   *   'deduct_inventory'
   *   'categorize_expense'
   */
  auto: string[];

  /**
   * Actions that go to the review queue for human approval.
   * Agent drafts the output, human approves or edits before execution.
   * Examples:
   *   'create_invoice where total >= 500'
   *   'create_invoice where confidence < 0.9'
   *   'send_to_customer'
   *   'send_collection_notice'
   */
  review: string[];

  /**
   * Actions that are flagged and stopped. Human must handle.
   * For high-risk, low-confidence, or exceptional situations.
   * Examples:
   *   'create_invoice where confidence < 0.6'
   *   'create_invoice where total > 10000'
   *   'customer_dispute'
   *   'data_anomaly'
   */
  escalate: string[];

  /**
   * Numeric thresholds that override the auto/review/escalate rules.
   * If an action matches multiple rules, the most restrictive wins.
   */
  thresholds?: {
    /** Review if the monetary amount exceeds this value */
    amount_over?: number;

    /** Review if AI confidence score is below this value (0-1) */
    confidence_below?: number;

    /** Escalate if monetary amount exceeds this value */
    escalate_amount_over?: number;

    /** Escalate if AI confidence is below this value (0-1) */
    escalate_confidence_below?: number;
  };
}


// ============================================================
// CHAIN RULE — What other agents to trigger after completion
// ============================================================

export interface ChainRule {
  /**
   * The event to emit when this agent completes.
   * Other agents listen for this event via their triggers.
   * Examples: 'invoice.created', 'invoice.sent', 'estimate.generated'
   */
  event: string;

  /**
   * Which agent types should receive this chain event.
   * Examples: ['collections', 'bookkeeping'], ['customer']
   */
  targets: string[];

  /**
   * Optional condition: only chain if this evaluates to true.
   * Evaluated against the current agent's output.
   * Examples: 'output.total > 0', 'output.status === "sent"'
   */
  condition?: string;
}


// ============================================================
// EXECUTION CONTEXT — Runtime state during agent execution
// ============================================================

export interface AgentExecutionContext {
  /** Unique execution ID (UUID) */
  executionId: string;

  /** Organization this execution belongs to */
  orgId: string;

  /** Agent type being executed */
  agentType: string;

  /** How this execution was triggered */
  triggerType: 'event' | 'chat' | 'schedule' | 'chain';

  /** Source of the trigger (event name, message ID, cron expression, etc.) */
  triggerSource: string;

  /** The raw event/message payload that triggered this execution */
  triggerPayload: Record<string, any>;

  /** Idempotency key to prevent duplicate executions */
  idempotencyKey: string;

  /** Accumulated data gathered during the GATHER step */
  inputData: Record<string, any>;

  /** The AI-generated output from the REASON step */
  reasoningOutput: Record<string, any> | null;

  /** Confidence score from AI reasoning (0-1) */
  confidenceScore: number | null;

  /** Actions taken during the EXECUTE step */
  actionsTaken: AgentAction[];

  /** Current execution status */
  status: AgentExecutionStatus;

  /** Error message if execution failed */
  error: string | null;

  /** Which AI model was used */
  aiModelUsed: string | null;

  /** Total AI tokens consumed */
  aiTokensUsed: number;

  /** Total AI cost in cents */
  aiCostCents: number;

  /** Execution start time */
  startedAt: Date;

  /** Execution end time */
  completedAt: Date | null;
}

export interface AgentAction {
  type: string;           // 'create_record', 'sync_external', 'send_notification', 'generate_pdf'
  target: string;         // 'invoices', 'quickbooks', 'email', 's3'
  data: Record<string, any>;
  timestamp: Date;
}

export type AgentExecutionStatus =
  | 'pending'
  | 'running'
  | 'awaiting_review'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'failed';
```

---

## 3. Execution Pipeline (9 Steps)

Every agent execution follows the same 9-step pipeline. The runtime engine orchestrates these steps.

```
1. TRIGGER  -->  Event bus receives event / copilot routes intent / cron fires / chain fires
2. MATCH    -->  Registry finds which agent(s) match this trigger
3. GATHER   -->  Agent collects required input data from DB + integrations + business context
4. REASON   -->  Sends gathered data to Python AI service for LLM processing
5. VALIDATE -->  Checks AI output against validation rules
6. AUTONOMY CHECK  -->  Determines: auto-execute, send to review queue, or escalate
7. EXECUTE  -->  Writes results (DB records, external syncs, PDFs, emails)
8. CHAIN    -->  Fires events that trigger downstream agents
9. LOG      -->  Records full execution in agent_executions table
```

### Step 1: TRIGGER

The entry point. Something happens that could activate an agent.

```typescript
// src/agents/runtime.ts

import { EventBus } from './event-bus';
import { AgentRegistry } from './registry';
import { logger } from '../utils/logger';

export class AgentRuntime {
  constructor(
    private eventBus: EventBus,
    private registry: AgentRegistry,
  ) {
    // Subscribe to all events
    this.eventBus.onAny((eventName: string, payload: any) => {
      this.handleEvent(eventName, payload);
    });
  }

  /**
   * Entry point for event-triggered execution.
   * Also called by the copilot service (type='chat') and
   * the scheduler (type='schedule').
   */
  async handleEvent(eventName: string, payload: any): Promise<void> {
    const matchedAgents = this.registry.findByEvent(eventName, payload);

    for (const agentDef of matchedAgents) {
      // Each matched agent gets its own execution
      const idempotencyKey = this.generateIdempotencyKey(agentDef.type, eventName, payload);
      await this.executeAgent(agentDef, 'event', eventName, payload, idempotencyKey);
    }
  }

  /**
   * Entry point for chat-triggered execution.
   * Called by the copilot service after intent classification.
   */
  async handleChatIntent(
    intent: string,
    entities: Record<string, any>,
    orgId: string,
    userId: string
  ): Promise<AgentExecutionContext> {
    const agentDef = this.registry.findByIntent(intent);
    if (!agentDef) throw new Error(`No agent registered for intent: ${intent}`);

    const payload = { intent, entities, orgId, userId };
    const idempotencyKey = `chat:${intent}:${orgId}:${Date.now()}`;
    return this.executeAgent(agentDef, 'chat', intent, payload, idempotencyKey);
  }

  private generateIdempotencyKey(agentType: string, event: string, payload: any): string {
    // Use stable identifiers from the payload to prevent duplicate processing
    const entityId = payload.job_id || payload.invoice_id || payload.customer_id || payload.id || '';
    return `${agentType}:${event}:${entityId}:${new Date().toISOString().slice(0, 13)}`; // hour-level granularity
  }
}
```

### Step 2: MATCH

The registry checks which agents have triggers matching the incoming event, and evaluates any conditions.

```typescript
// Inside AgentRegistry (detailed in Section 5)
findByEvent(eventName: string, payload: any): AgentDefinition[] {
  return this.agents.filter((agent) =>
    agent.triggers.some((trigger) => {
      if (trigger.type !== 'event' && trigger.type !== 'chain') return false;
      if (trigger.event !== eventName) return false;
      if (trigger.condition && !this.evaluateCondition(trigger.condition, payload)) return false;
      return true;
    })
  );
}
```

### Step 3: GATHER

Collects all data the agent needs. Reads from the database, business context, integration data, and the event payload.

```typescript
private async gatherInputs(
  agentDef: AgentDefinition,
  payload: any,
  orgId: string
): Promise<Record<string, any>> {
  const gathered: Record<string, any> = {};

  for (const input of agentDef.inputs) {
    switch (input.source) {
      case 'db': {
        // Query the specified table, following the relation chain
        const data = await this.dbLookup(input.table!, input.fields!, input.relation!, payload, orgId);
        gathered[input.table!] = data;
        break;
      }
      case 'context': {
        // Look up business context for this org
        const ctx = await this.businessContextRepo.findByKey(orgId, input.key!);
        gathered[`context_${input.key}`] = ctx;
        break;
      }
      case 'integration': {
        // Fetch data from an external system via its adapter
        const adapter = this.adapterRegistry.get(input.provider!);
        const integration = await this.integrationRepo.findByProvider(orgId, input.provider!);
        if (adapter && integration) {
          gathered[`integration_${input.provider}`] = await adapter.fetchData(integration, input);
        }
        break;
      }
      case 'event_payload': {
        gathered['event_payload'] = payload;
        break;
      }
      case 'user_message': {
        gathered['user_message'] = payload.message || payload.content;
        break;
      }
    }
  }

  return gathered;
}
```

### Step 4: REASON

Sends the gathered data to the Python AI service for LLM processing. This is where the AI generates the actual output (invoice line items, estimate details, collection message, etc.).

```typescript
private async reason(
  step: AgentStep,
  inputData: Record<string, any>,
  orgId: string
): Promise<{ output: Record<string, any>; confidence: number; model: string; tokens: number; cost: number }> {
  const { endpoint, prompt_template, model_tier, output_schema } = step.config;

  const response = await this.aiClient.reason({
    endpoint: endpoint || '/ai/reason',
    prompt_template,
    model_tier: model_tier || 'capable',
    input_data: inputData,
    output_schema,
    org_id: orgId,
  });

  return {
    output: response.result,
    confidence: response.confidence,
    model: response.model_used,
    tokens: response.tokens_used,
    cost: response.cost_cents,
  };
}
```

### Step 5: VALIDATE

Checks the AI output against validation rules to catch obvious errors before execution.

```typescript
private validate(
  rules: string[],
  output: Record<string, any>,
  inputData: Record<string, any>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const rule of rules) {
    // Rules are simple expressions evaluated against output + input data
    // Examples:
    //   'line_items.length > 0'
    //   'subtotal === sum(line_items.total)'
    //   'total === subtotal + tax_amount'
    //   'total > 0'
    //   'total <= job.total_amount * 1.5'

    const context = { ...output, ...inputData };
    const result = this.evaluateExpression(rule, context);

    if (!result) {
      errors.push(`Validation failed: ${rule}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
```

### Step 6: AUTONOMY CHECK

The core of the human-in-the-loop system. Determines whether the action should auto-execute, go to review, or be escalated.

```typescript
private checkAutonomy(
  autonomy: AutonomyRules,
  orgAutonomyOverrides: Record<string, any>, // from agent_configs table
  output: Record<string, any>,
  confidence: number
): 'auto' | 'review' | 'escalate' {
  // Org-level overrides take precedence over agent defaults
  const effectiveRules = this.mergeAutonomyRules(autonomy, orgAutonomyOverrides);

  // Check escalation first (most restrictive)
  if (effectiveRules.thresholds?.escalate_confidence_below && confidence < effectiveRules.thresholds.escalate_confidence_below) {
    return 'escalate';
  }
  if (effectiveRules.thresholds?.escalate_amount_over && output.total > effectiveRules.thresholds.escalate_amount_over) {
    return 'escalate';
  }
  for (const rule of effectiveRules.escalate) {
    if (this.evaluateAutonomyRule(rule, output, confidence)) {
      return 'escalate';
    }
  }

  // Check review (medium restriction)
  if (effectiveRules.thresholds?.confidence_below && confidence < effectiveRules.thresholds.confidence_below) {
    return 'review';
  }
  if (effectiveRules.thresholds?.amount_over && output.total > effectiveRules.thresholds.amount_over) {
    return 'review';
  }
  for (const rule of effectiveRules.review) {
    if (this.evaluateAutonomyRule(rule, output, confidence)) {
      return 'review';
    }
  }

  // Auto-execute (least restrictive)
  return 'auto';
}
```

### Step 7: EXECUTE

Writes results to the database, syncs to external systems, generates PDFs, sends notifications.

```typescript
private async execute(
  agentDef: AgentDefinition,
  output: Record<string, any>,
  orgId: string,
  ctx: AgentExecutionContext
): Promise<AgentAction[]> {
  const actions: AgentAction[] = [];

  for (const step of agentDef.steps.filter(s => s.type === 'integrate' || s.type === 'notify')) {
    try {
      switch (step.type) {
        case 'integrate': {
          const action = await this.executeIntegrationStep(step, output, orgId);
          actions.push(action);
          break;
        }
        case 'notify': {
          const action = await this.executeNotifyStep(step, output, orgId);
          actions.push(action);
          break;
        }
      }
    } catch (error) {
      if (step.optional) {
        logger.warn({ step: step.id, error }, 'Optional step failed, continuing');
        actions.push({
          type: 'step_failed',
          target: step.id,
          data: { error: (error as Error).message, optional: true },
          timestamp: new Date(),
        });
      } else {
        throw error; // Non-optional step failure stops execution
      }
    }
  }

  return actions;
}
```

### Step 8: CHAIN

After successful execution, emit events that trigger downstream agents.

```typescript
private async chain(
  agentDef: AgentDefinition,
  output: Record<string, any>,
  orgId: string
): Promise<void> {
  for (const chainRule of agentDef.chains) {
    // Evaluate condition if present
    if (chainRule.condition && !this.evaluateExpression(chainRule.condition, { output })) {
      continue;
    }

    // Emit the chain event with the agent's output as payload
    this.eventBus.emit(chainRule.event, {
      orgId,
      source_agent: agentDef.type,
      ...output,
    });

    logger.info({
      agent: agentDef.type,
      chainEvent: chainRule.event,
      targets: chainRule.targets,
    }, 'Chain event emitted');
  }
}
```

### Step 9: LOG

Record the full execution in the `agent_executions` table for audit, observability, and the dashboard.

```typescript
private async logExecution(ctx: AgentExecutionContext): Promise<void> {
  await this.executionRepo.upsert({
    id: ctx.executionId,
    org_id: ctx.orgId,
    agent_type: ctx.agentType,
    trigger_type: ctx.triggerType,
    trigger_source: ctx.triggerSource,
    status: ctx.status,
    input_data: ctx.inputData,
    output_data: ctx.reasoningOutput,
    actions_taken: ctx.actionsTaken,
    confidence_score: ctx.confidenceScore,
    error: ctx.error,
    duration_ms: ctx.completedAt
      ? ctx.completedAt.getTime() - ctx.startedAt.getTime()
      : null,
    ai_model_used: ctx.aiModelUsed,
    ai_tokens_used: ctx.aiTokensUsed,
    ai_cost_cents: ctx.aiCostCents,
    created_at: ctx.startedAt,
    completed_at: ctx.completedAt,
  });
}
```

### Complete executeAgent Method

Ties all 9 steps together:

```typescript
async executeAgent(
  agentDef: AgentDefinition,
  triggerType: 'event' | 'chat' | 'schedule' | 'chain',
  triggerSource: string,
  payload: any,
  idempotencyKey: string
): Promise<AgentExecutionContext> {
  const orgId = payload.orgId || payload.org_id;

  // STEP 0: IDEMPOTENCY CHECK
  const existingExecution = await this.executionRepo.findByIdempotencyKey(idempotencyKey);
  if (existingExecution && existingExecution.status === 'completed') {
    logger.info({ idempotencyKey }, 'Skipping duplicate execution');
    return existingExecution;
  }

  // Initialize execution context
  const ctx: AgentExecutionContext = {
    executionId: crypto.randomUUID(),
    orgId,
    agentType: agentDef.type,
    triggerType,
    triggerSource,
    triggerPayload: payload,
    idempotencyKey,
    inputData: {},
    reasoningOutput: null,
    confidenceScore: null,
    actionsTaken: [],
    status: 'pending',
    error: null,
    aiModelUsed: null,
    aiTokensUsed: 0,
    aiCostCents: 0,
    startedAt: new Date(),
    completedAt: null,
  };

  try {
    // STEP 2-3: GATHER (match already happened to get here)
    ctx.status = 'running';
    await this.logExecution(ctx);

    ctx.inputData = await this.gatherInputs(agentDef, payload, orgId);

    // STEP 4: REASON
    const reasonStep = agentDef.steps.find(s => s.type === 'ai_reason');
    if (reasonStep) {
      const result = await this.reason(reasonStep, ctx.inputData, orgId);
      ctx.reasoningOutput = result.output;
      ctx.confidenceScore = result.confidence;
      ctx.aiModelUsed = result.model;
      ctx.aiTokensUsed = result.tokens;
      ctx.aiCostCents = result.cost;
    }

    // STEP 5: VALIDATE
    const validateStep = agentDef.steps.find(s => s.type === 'validate');
    if (validateStep && ctx.reasoningOutput) {
      const validation = this.validate(validateStep.config.rules, ctx.reasoningOutput, ctx.inputData);
      if (!validation.valid) {
        ctx.status = 'failed';
        ctx.error = `Validation failed: ${validation.errors.join(', ')}`;
        ctx.completedAt = new Date();
        await this.logExecution(ctx);
        return ctx;
      }
    }

    // STEP 6: AUTONOMY CHECK
    const orgConfig = await this.agentConfigRepo.findByType(orgId, agentDef.type);
    const autonomyResult = this.checkAutonomy(
      agentDef.autonomy,
      orgConfig?.autonomy_rules || {},
      ctx.reasoningOutput || {},
      ctx.confidenceScore || 0
    );

    if (autonomyResult === 'review') {
      ctx.status = 'awaiting_review';
      await this.logExecution(ctx);
      await this.reviewQueue.add(ctx);
      return ctx;
    }

    if (autonomyResult === 'escalate') {
      ctx.status = 'awaiting_review';
      await this.logExecution(ctx);
      await this.reviewQueue.addEscalation(ctx);
      return ctx;
    }

    // STEP 7: EXECUTE (auto mode)
    ctx.actionsTaken = await this.execute(agentDef, ctx.reasoningOutput || {}, orgId, ctx);

    // STEP 8: CHAIN
    await this.chain(agentDef, ctx.reasoningOutput || {}, orgId);

    // STEP 9: LOG
    ctx.status = 'completed';
    ctx.completedAt = new Date();
    await this.logExecution(ctx);

    return ctx;
  } catch (error) {
    ctx.status = 'failed';
    ctx.error = (error as Error).message;
    ctx.completedAt = new Date();
    await this.logExecution(ctx);

    logger.error({
      executionId: ctx.executionId,
      agent: ctx.agentType,
      error: ctx.error,
    }, 'Agent execution failed');

    return ctx;
  }
}
```

---

## 4. Event Bus

### Implementation

The event bus is a simple in-process Node.js `EventEmitter`. There is no need for Kafka, RabbitMQ, or any external message broker at this scale.

**Why EventEmitter and not an external broker?**
- CrewShift is a monolith-first architecture (single Node.js process)
- Event volume is manageable: dozens/hundreds of events per org per day, not millions
- Simplicity: no infrastructure to manage, no serialization overhead, no network latency
- If we need to scale beyond a single process in the future, we can switch to Redis Pub/Sub or BullMQ events with minimal code changes

```typescript
// src/agents/event-bus.ts

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export class EventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50); // Allow many agents to listen
  }

  /**
   * Emit an event with a payload.
   * All registered listeners for this event will be called.
   */
  emit(event: string, payload: any): void {
    logger.info({ event, orgId: payload?.orgId }, `Event emitted: ${event}`);
    this.emitter.emit(event, payload);
    // Also emit on the wildcard for the runtime's onAny handler
    this.emitter.emit('*', event, payload);
  }

  /**
   * Register a listener for a specific event.
   */
  on(event: string, handler: (payload: any) => void): void {
    this.emitter.on(event, handler);
  }

  /**
   * Register a listener that fires for every event.
   * Used by the AgentRuntime to catch all events and route to matching agents.
   */
  onAny(handler: (event: string, payload: any) => void): void {
    this.emitter.on('*', handler);
  }

  /**
   * Remove a listener.
   */
  off(event: string, handler: (payload: any) => void): void {
    this.emitter.off(event, handler);
  }

  /**
   * Remove all listeners for an event (used in tests).
   */
  removeAll(event?: string): void {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
  }
}
```

### All Events and Which Agents They Trigger

| Event | Emitted When | Triggers Agent(s) | Payload |
|---|---|---|---|
| `job.completed` | Job marked complete via API or integration sync | Invoice Agent, Customer Agent, Inventory Agent, Bookkeeping Agent | `{ orgId, job_id, customer_id, total_amount, line_items, materials, labor_hours, assigned_tech_id }` |
| `job.scheduled` | New job scheduled via API or Field Ops Agent | Field Ops Agent, Customer Agent | `{ orgId, job_id, customer_id, scheduled_start, scheduled_end, assigned_tech_id, address }` |
| `job.updated` | Job details changed | Field Ops Agent (if schedule changed) | `{ orgId, job_id, changes }` |
| `invoice.created` | Invoice record created in DB | Collections Agent (starts monitoring), Bookkeeping Agent | `{ orgId, invoice_id, customer_id, total, due_date, generated_by }` |
| `invoice.sent` | Invoice sent to customer | Customer Agent (send confirmation) | `{ orgId, invoice_id, customer_id, sent_via }` |
| `invoice.paid` | Payment received | Bookkeeping Agent, Customer Agent (thank you message) | `{ orgId, invoice_id, customer_id, amount_paid, payment_method }` |
| `invoice.overdue` | Invoice past due date (detected by scheduled job) | Collections Agent (send follow-up) | `{ orgId, invoice_id, customer_id, days_overdue, total, due_date }` |
| `estimate.requested` | Estimate creation requested via API or copilot | Estimate Agent | `{ orgId, customer_id, scope_description, photos, type }` |
| `estimate.generated` | Estimate created by agent | Customer Agent (send to customer if auto-send) | `{ orgId, estimate_id, customer_id, total, confidence }` |
| `estimate.accepted` | Customer accepts estimate | Invoice Agent (create invoice from estimate), Customer Agent | `{ orgId, estimate_id, customer_id, total }` |
| `estimate.rejected` | Customer rejects estimate | Customer Agent (follow-up), Insights Agent (track win/loss) | `{ orgId, estimate_id, customer_id, total, reason }` |
| `customer.lead.inbound` | New lead arrives (web form, call, email) | Customer Agent (respond, score, route) | `{ orgId, customer_id, source, message, contact_info }` |
| `customer.created` | New customer record created | Customer Agent (welcome sequence) | `{ orgId, customer_id, name, email, phone, source }` |
| `inventory.low_stock` | Part quantity drops below reorder point | Inventory Agent (reorder alert) | `{ orgId, part_id, name, quantity_on_hand, reorder_point }` |
| `inventory.used` | Parts deducted after job completion | Inventory Agent (update stock, check reorder) | `{ orgId, job_id, materials: [{ part_id, quantity }] }` |
| `compliance.deadline` | Upcoming deadline detected by scheduled job | Compliance Agent | `{ orgId, type, entity_id, deadline_date, description }` |
| `payment.received` | Payment processed via Stripe or marked manually | Bookkeeping Agent, Collections Agent (update status) | `{ orgId, invoice_id, amount, payment_method, stripe_payment_id }` |
| `copilot.message` | User sends a message to the copilot | (Intent classification, then routed to appropriate agent) | `{ orgId, userId, conversationId, message, intent, entities }` |
| `workflow.trigger` | Custom workflow trigger condition met | Workflow Engine | `{ orgId, workflow_id, trigger_data }` |
| `sync.completed` | Integration sync finished | (Various agents depending on what changed) | `{ orgId, provider, records_synced, changes }` |
| `agent.execution.completed` | Any agent finishes execution | (Used internally for copilot aggregation) | `{ orgId, executionId, agentType, status, output }` |

### Event Payload Schema

All event payloads follow a common base shape:

```typescript
interface BaseEventPayload {
  /** Organization ID — always required */
  orgId: string;

  /** Timestamp when the event occurred */
  timestamp?: string;

  /** Source of the event (API, agent, integration, schedule) */
  source?: string;
}
```

---

## 5. Agent Registry

The registry holds all agent definitions and provides lookup methods for the runtime.

### How Agent Definitions Are Registered

Agent definitions are registered at application startup. Each agent's definition file exports a constant that conforms to the `AgentDefinition` interface.

```typescript
// src/agents/registry.ts

import { AgentDefinition, AgentTrigger } from './types';
import { logger } from '../utils/logger';

export class AgentRegistry {
  private agents: Map<string, AgentDefinition> = new Map();

  /**
   * Register an agent definition.
   * Called once at startup for each of the 9 agents.
   */
  register(agent: AgentDefinition): void {
    if (this.agents.has(agent.type)) {
      throw new Error(`Agent '${agent.type}' is already registered`);
    }
    this.agents.set(agent.type, agent);
    logger.info({ agentType: agent.type, triggers: agent.triggers.length }, `Agent registered: ${agent.name}`);
  }

  /**
   * Get an agent definition by type.
   */
  get(type: string): AgentDefinition | undefined {
    return this.agents.get(type);
  }

  /**
   * Get all registered agent definitions.
   */
  getAll(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /**
   * Find agents that match an event trigger.
   * Evaluates trigger conditions against the event payload.
   */
  findByEvent(eventName: string, payload: any): AgentDefinition[] {
    const matched: AgentDefinition[] = [];

    for (const agent of this.agents.values()) {
      for (const trigger of agent.triggers) {
        if (trigger.type !== 'event' && trigger.type !== 'chain') continue;
        if (trigger.event !== eventName) continue;

        // Evaluate condition if present
        if (trigger.condition) {
          if (!this.evaluateCondition(trigger.condition, payload)) continue;
        }

        matched.push(agent);
        break; // Don't double-match the same agent
      }
    }

    return matched;
  }

  /**
   * Find the agent that handles a specific copilot intent.
   */
  findByIntent(intent: string): AgentDefinition | undefined {
    for (const agent of this.agents.values()) {
      for (const trigger of agent.triggers) {
        if (trigger.type !== 'chat') continue;
        if (trigger.intent === intent) return agent;
      }
    }
    return undefined;
  }

  /**
   * Find agents with schedule triggers (for cron registration).
   */
  findScheduled(): Array<{ agent: AgentDefinition; trigger: AgentTrigger }> {
    const scheduled: Array<{ agent: AgentDefinition; trigger: AgentTrigger }> = [];

    for (const agent of this.agents.values()) {
      for (const trigger of agent.triggers) {
        if (trigger.type === 'schedule' && trigger.cron) {
          scheduled.push({ agent, trigger });
        }
      }
    }

    return scheduled;
  }

  /**
   * Evaluate a condition expression against a data context.
   * Conditions are simple JavaScript expressions.
   */
  private evaluateCondition(condition: string, context: any): boolean {
    try {
      // Safe evaluation: only allow property access and comparisons
      // This uses a sandboxed evaluator, NOT eval()
      const fn = new Function('ctx', `with(ctx) { return ${condition}; }`);
      return Boolean(fn(context));
    } catch {
      logger.warn({ condition }, 'Failed to evaluate trigger condition');
      return false;
    }
  }
}
```

### Startup Registration

```typescript
// src/agents/index.ts — Agent registration at app startup

import { AgentRegistry } from './registry';
import { invoiceAgent } from './definitions/invoice.agent';
import { estimateAgent } from './definitions/estimate.agent';
import { collectionsAgent } from './definitions/collections.agent';
import { bookkeepingAgent } from './definitions/bookkeeping.agent';
import { insightsAgent } from './definitions/insights.agent';
import { fieldOpsAgent } from './definitions/field-ops.agent';
import { complianceAgent } from './definitions/compliance.agent';
import { inventoryAgent } from './definitions/inventory.agent';
import { customerAgent } from './definitions/customer.agent';

export function registerAllAgents(registry: AgentRegistry): void {
  // Money & Admin
  registry.register(invoiceAgent);
  registry.register(estimateAgent);
  registry.register(collectionsAgent);
  registry.register(bookkeepingAgent);
  registry.register(insightsAgent);

  // Field Operations
  registry.register(fieldOpsAgent);
  registry.register(complianceAgent);
  registry.register(inventoryAgent);

  // Customer & Sales
  registry.register(customerAgent);
}
```

---

## 6. Agent Chaining

### Declarative Chain Rules

Agents chain together through **declarative rules**, not hardcoded logic. The chain rules are part of each agent's definition (the `chains` field).

When an agent completes, the runtime checks its chain rules and emits events. Other agents that listen for those events are triggered through the normal event bus flow.

### How Events Propagate

```
Job Completed Event
  |
  v
Event Bus: 'job.completed'
  |
  +--> Invoice Agent (trigger: event='job.completed')
  |      |
  |      v  (executes, creates invoice)
  |      |
  |      +--> Emits 'invoice.created'  (chain rule)
  |      |      |
  |      |      +--> Collections Agent (trigger: event='invoice.created')
  |      |      +--> Bookkeeping Agent (trigger: event='invoice.created')
  |      |
  |      +--> Emits 'invoice.sent'  (chain rule, if auto-sent)
  |             |
  |             +--> Customer Agent (trigger: event='invoice.sent')
  |
  +--> Customer Agent (trigger: event='job.completed')
  |      |
  |      v  (sends completion message, queues review request)
  |
  +--> Inventory Agent (trigger: event='job.completed')
  |      |
  |      v  (deducts parts used)
  |      |
  |      +--> Emits 'inventory.used' (chain rule)
  |             |
  |             +--> Inventory Agent (trigger: event='inventory.used', checks reorder)
  |
  +--> Bookkeeping Agent (trigger: event='job.completed')
         |
         v  (categorizes revenue + expenses)
```

### Fan-Out Execution

Chain events support fan-out: one event can trigger multiple agents simultaneously. Each triggered agent gets its own independent execution context.

```typescript
// Chain execution is fan-out by default
// If invoice.created chains to ['collections', 'bookkeeping'],
// both agents are triggered independently via the event bus.

// The chain rule's 'targets' field is documentation/metadata only.
// The actual routing happens through event bus trigger matching.
// This means any agent can listen for any event — the targets field
// just makes the intended chain visible in the agent definition.
```

### Chain Depth Protection

To prevent infinite loops (Agent A chains to B, B chains to A), the runtime tracks chain depth:

```typescript
private async handleEvent(eventName: string, payload: any): Promise<void> {
  const chainDepth = payload._chainDepth || 0;

  if (chainDepth > 5) {
    logger.warn({ eventName, chainDepth }, 'Maximum chain depth exceeded, stopping propagation');
    return;
  }

  const matchedAgents = this.registry.findByEvent(eventName, payload);

  for (const agentDef of matchedAgents) {
    const enrichedPayload = { ...payload, _chainDepth: chainDepth + 1 };
    await this.executeAgent(agentDef, chainDepth > 0 ? 'chain' : 'event', eventName, enrichedPayload, /*...*/);
  }
}
```

---

## 7. Human-in-the-Loop Review Queue

### How Items Enter the Queue

Items enter the review queue during Step 6 (AUTONOMY CHECK) of the execution pipeline. When the autonomy check returns `'review'` or `'escalate'`, the execution is paused and added to the queue.

```typescript
// src/agents/review-queue.ts

import { AgentExecutionContext } from './types';
import { logger } from '../utils/logger';

export class ReviewQueue {
  constructor(
    private executionRepo: AgentExecutionRepository,
    private notificationService: NotificationService,
  ) {}

  /**
   * Add an execution to the review queue.
   * The execution's status is already 'awaiting_review' when this is called.
   */
  async add(ctx: AgentExecutionContext): Promise<void> {
    // The execution record already exists in agent_executions with status='awaiting_review'
    // We just need to notify the org's admins/members

    await this.notificationService.send({
      orgId: ctx.orgId,
      type: 'review_needed',
      title: `${ctx.agentType} Agent needs review`,
      body: this.formatReviewBody(ctx),
      channel: 'in_app',
      actionUrl: `/agents/review/${ctx.executionId}`,
      metadata: {
        executionId: ctx.executionId,
        agentType: ctx.agentType,
        confidenceScore: ctx.confidenceScore,
      },
    });

    logger.info({
      executionId: ctx.executionId,
      agent: ctx.agentType,
      confidence: ctx.confidenceScore,
    }, 'Execution added to review queue');
  }

  /**
   * Add an escalated execution to the review queue with higher urgency.
   */
  async addEscalation(ctx: AgentExecutionContext): Promise<void> {
    // Same as add, but with more urgent notification
    await this.notificationService.send({
      orgId: ctx.orgId,
      type: 'review_needed',
      title: `ESCALATED: ${ctx.agentType} Agent needs attention`,
      body: this.formatEscalationBody(ctx),
      channel: 'in_app',  // Also sends push notification
      actionUrl: `/agents/review/${ctx.executionId}`,
      metadata: {
        executionId: ctx.executionId,
        agentType: ctx.agentType,
        confidenceScore: ctx.confidenceScore,
        escalated: true,
      },
    });

    // For escalations, also send push/SMS to owner
    await this.notificationService.send({
      orgId: ctx.orgId,
      type: 'alert',
      title: `${ctx.agentType} Agent escalation`,
      body: `Requires your attention. Confidence: ${((ctx.confidenceScore || 0) * 100).toFixed(0)}%`,
      channel: 'push',
    });
  }

  private formatReviewBody(ctx: AgentExecutionContext): string {
    const amount = ctx.reasoningOutput?.total
      ? `$${ctx.reasoningOutput.total.toLocaleString()}`
      : '';
    const confidence = ctx.confidenceScore
      ? `${(ctx.confidenceScore * 100).toFixed(0)}% confidence`
      : '';
    return `Review ${ctx.agentType} output${amount ? ` for ${amount}` : ''}. ${confidence}`;
  }

  private formatEscalationBody(ctx: AgentExecutionContext): string {
    return `${this.formatReviewBody(ctx)} — This was escalated due to low confidence or high value.`;
  }
}
```

### Approval/Rejection Flow

When a user approves or rejects a review queue item, the API endpoint resumes or cancels the execution.

```typescript
// src/routes/agents.routes.ts — Approve endpoint

async function approveExecutionHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: { edits?: Record<string, any> } }>,
  reply: FastifyReply
) {
  const { id } = request.params;
  const { edits } = request.body || {};

  const execution = await executionRepo.findById(id);
  if (!execution) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Execution not found' } });
  if (execution.org_id !== request.orgId) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Execution not found' } });
  if (execution.status !== 'awaiting_review') {
    return reply.status(422).send({ error: { code: 'UNPROCESSABLE', message: 'Execution is not awaiting review' } });
  }

  // Update execution status
  await executionRepo.update(id, {
    status: 'approved',
    reviewed_by: request.userId,
    reviewed_at: new Date(),
    // If user made edits, merge them into the output
    output_data: edits ? { ...execution.output_data, ...edits } : execution.output_data,
  });

  // Resume the execution pipeline from Step 7 (EXECUTE)
  const agentDef = registry.get(execution.agent_type)!;
  const output = edits ? { ...execution.output_data, ...edits } : execution.output_data;

  const actions = await runtime.execute(agentDef, output, execution.org_id, execution);
  await runtime.chain(agentDef, output, execution.org_id);

  // Mark as completed
  await executionRepo.update(id, {
    status: 'completed',
    actions_taken: actions,
    completed_at: new Date(),
  });

  return reply.send({ data: { executionId: id, status: 'completed', actions } });
}

// Reject endpoint

async function rejectExecutionHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>,
  reply: FastifyReply
) {
  const { id } = request.params;
  const { reason } = request.body || {};

  const execution = await executionRepo.findById(id);
  if (!execution) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Execution not found' } });
  if (execution.org_id !== request.orgId) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Execution not found' } });
  if (execution.status !== 'awaiting_review') {
    return reply.status(422).send({ error: { code: 'UNPROCESSABLE', message: 'Execution is not awaiting review' } });
  }

  await executionRepo.update(id, {
    status: 'rejected',
    reviewed_by: request.userId,
    reviewed_at: new Date(),
    error: reason || 'Rejected by user',
    completed_at: new Date(),
  });

  return reply.send({ data: { executionId: id, status: 'rejected' } });
}
```

### Auto-Autonomy Upgrade Suggestions

The system tracks approval patterns and suggests upgrading autonomy when accuracy proves out.

```typescript
// Runs as a weekly scheduled job: autonomy-upgrade-suggestions

async function checkAutonomyUpgrades(): Promise<void> {
  // For each org, for each agent type
  const orgs = await orgRepo.findAll();

  for (const org of orgs) {
    const agentTypes = ['invoice', 'estimate', 'collections', 'bookkeeping', 'customer', 'field-ops', 'compliance', 'inventory', 'insights'];

    for (const agentType of agentTypes) {
      // Count recent review queue items: approved vs rejected
      const recentReviews = await executionRepo.findRecentReviewed(org.id, agentType, 50);

      if (recentReviews.length < 30) continue; // Need enough data

      const approved = recentReviews.filter(e => e.status === 'completed').length;
      const approvalRate = approved / recentReviews.length;

      if (approvalRate >= 0.90) {
        // 90%+ approval rate: suggest upgrading to auto
        const approvedWithoutEdits = recentReviews.filter(
          e => e.status === 'completed' && !e.metadata?.had_edits
        ).length;
        const noEditRate = approvedWithoutEdits / recentReviews.length;

        if (noEditRate >= 0.85) {
          await notificationService.send({
            orgId: org.id,
            type: 'agent_action',
            title: `${agentType} Agent autonomy upgrade available`,
            body: `You've approved ${approved} of your last ${recentReviews.length} ${agentType} Agent drafts without changes. Want to switch to auto-execute for routine items?`,
            channel: 'in_app',
            actionUrl: `/agents/${agentType}/settings`,
            metadata: {
              suggestion: 'autonomy_upgrade',
              agentType,
              approvalRate,
              noEditRate,
            },
          });
        }
      }
    }
  }
}
```

---

## 8. Idempotency

### How Idempotency Keys Work

Every agent execution has an idempotency key. This prevents duplicate processing when:
- A BullMQ job is retried after a transient failure
- The same event fires twice (e.g., webhook delivered twice)
- A chain event reaches an agent that already processed the same trigger

```typescript
interface AgentExecutionInput {
  idempotencyKey: string;
  // Examples:
  //   'invoice:job_123:2026-03-04T14'     (hour-level for event triggers)
  //   'collections:invoice_456:followup_1' (specific action within a sequence)
  //   'chat:create-invoice:org_789:1709500000' (timestamp for chat triggers)
}
```

### Idempotency Check Logic

```typescript
// Before executing: check if idempotency key exists in agent_executions
async function checkIdempotency(key: string): Promise<AgentExecutionContext | null> {
  const existing = await executionRepo.findByIdempotencyKey(key);

  if (!existing) {
    // Not found: proceed with execution
    return null;
  }

  switch (existing.status) {
    case 'completed':
      // Already completed successfully: skip, return existing result
      logger.info({ key }, 'Idempotent skip: execution already completed');
      return existing;

    case 'failed':
      // Previously failed: allow retry (return null to proceed)
      logger.info({ key }, 'Idempotent retry: previous execution failed');
      return null;

    case 'running':
      // Currently running: skip to prevent concurrent duplicate
      logger.info({ key }, 'Idempotent skip: execution currently running');
      return existing;

    case 'awaiting_review':
      // In review queue: skip
      logger.info({ key }, 'Idempotent skip: execution awaiting review');
      return existing;

    default:
      return null;
  }
}
```

### Preventing Duplicate Invoices (Example)

The most critical idempotency case: a completed job should generate exactly one invoice.

```typescript
// Invoice agent idempotency key includes the job ID
// This means: one invoice per job, regardless of how many times the event fires
const idempotencyKey = `invoice:${payload.job_id}:create`;

// If the same job.completed event fires twice (webhook retry, duplicate message, etc.),
// the second execution finds the first one already completed and returns early.
```

### Idempotency Key Patterns by Agent

| Agent | Key Pattern | Prevents |
|---|---|---|
| Invoice | `invoice:${job_id}:create` | Duplicate invoices for the same job |
| Estimate | `estimate:${customer_id}:${scope_hash}:create` | Duplicate estimates for the same scope |
| Collections | `collections:${invoice_id}:followup_${sequence}` | Duplicate follow-up messages |
| Bookkeeping | `bookkeeping:${source_type}:${source_id}:categorize` | Duplicate expense categorizations |
| Customer | `customer:${customer_id}:${action}:${date}` | Duplicate review requests, duplicate confirmations |
| Field Ops | `fieldops:${job_id}:dispatch` | Duplicate scheduling/dispatch |
| Compliance | `compliance:${entity_id}:${deadline_type}` | Duplicate deadline alerts |
| Inventory | `inventory:${job_id}:deduct` | Duplicate stock deductions |
| Insights | `insights:${org_id}:${report_type}:${period}` | Duplicate report generation |

---

## 9. Agent Execution Lifecycle

### State Machine

```
                    +-----------+
                    |  pending  |  (execution created, not yet started)
                    +-----+-----+
                          |
                          v
                    +-----------+
                    |  running  |  (gathering data, reasoning, validating)
                    +-----+-----+
                          |
              +-----------+-----------+
              |           |           |
              v           v           v
     +--------+--+  +----+-------+  +--+------+
     | completed  |  | awaiting_  |  |  failed |
     |            |  |  review    |  |         |
     +------------+  +-----+-----+  +---------+
                           |
                     +-----+-----+
                     |           |
                     v           v
               +---------+  +----------+
               | approved|  | rejected |
               +----+----+  +----------+
                    |
                    v
               +---------+
               |completed|
               +---------+
```

### State Transitions

| From | To | Trigger |
|---|---|---|
| `pending` | `running` | Runtime begins the gather step |
| `running` | `completed` | All steps succeed, autonomy=auto, execution done |
| `running` | `awaiting_review` | Autonomy check returns 'review' or 'escalate' |
| `running` | `failed` | Any non-optional step throws an error, or validation fails |
| `awaiting_review` | `approved` | User approves in the review queue |
| `awaiting_review` | `rejected` | User rejects in the review queue |
| `approved` | `completed` | Post-approval execution steps succeed |
| `approved` | `failed` | Post-approval execution steps fail |

### Database Record

Every state transition updates the `agent_executions` table:

```sql
-- The agent_executions table tracks the full lifecycle
SELECT
  id,
  org_id,
  agent_type,
  trigger_type,          -- 'event', 'chat', 'schedule', 'chain'
  trigger_source,        -- event name, intent, cron expression
  status,                -- 'pending', 'running', 'awaiting_review', 'approved', 'rejected', 'completed', 'failed'
  input_data,            -- JSONB: all gathered input data
  output_data,           -- JSONB: AI-generated output
  actions_taken,         -- JSONB: [{ type, target, data, timestamp }]
  confidence_score,      -- 0-1 float
  reviewed_by,           -- UUID of the user who approved/rejected
  reviewed_at,
  error,                 -- error message if failed
  duration_ms,           -- total execution time
  ai_model_used,         -- which AI model was used
  ai_tokens_used,        -- total tokens consumed
  ai_cost_cents,         -- total AI cost in cents
  created_at,
  completed_at
FROM agent_executions
WHERE org_id = $1 AND agent_type = $2
ORDER BY created_at DESC;
```

---

## 10. Error Handling Within Agent Execution

### What Happens When Each Step Fails

| Step | Failure Mode | Behavior | Recovery |
|---|---|---|---|
| **GATHER** (Step 3) | DB query fails | Execution fails immediately. Status = 'failed'. | BullMQ retry with exponential backoff (2s, 4s, 8s). Max 3 attempts. |
| **GATHER** (Step 3) | Integration data unavailable | If integration input is required, execution fails. If optional, proceeds without it. | Retry. If integration is persistently down, agent runs with DB data only. |
| **REASON** (Step 4) | AI service timeout (>30s) | Circuit breaker records failure. Execution fails. | Retry up to 3 times. If circuit breaker opens, all AI calls return degraded response for 30s. |
| **REASON** (Step 4) | AI service returns error | Execution fails. Error logged. | Retry with fallback provider (Claude fails -> GPT). |
| **REASON** (Step 4) | AI returns malformed output | Proceeds to VALIDATE step, which will catch it. | Validation fails, execution fails. No retry (bad prompt, needs fixing). |
| **VALIDATE** (Step 5) | Validation rules fail | Execution fails with specific validation errors. | No automatic retry. Bad AI output requires prompt tuning or manual intervention. |
| **AUTONOMY CHECK** (Step 6) | Cannot determine autonomy | Defaults to 'review' (safest option). | Not a failure state. Item enters review queue. |
| **EXECUTE** (Step 7) | DB write fails | Execution fails. No partial writes (transaction). | Retry. Idempotency key prevents duplicates. |
| **EXECUTE** (Step 7) | External sync fails (QuickBooks down) | If sync is a required step, execution fails. If optional (most syncs), execution completes with a note. | Sync retry via separate queue. Invoice exists in CrewShift, sync catches up later. |
| **EXECUTE** (Step 7) | PDF generation fails | Optional step. Execution completes without PDF. | PDF regenerated via separate retry job. |
| **CHAIN** (Step 8) | Chain event emission fails | Logged but does not fail the parent execution. Chains are fire-and-forget. | Chain events are retried independently. |
| **LOG** (Step 9) | Logging fails | Execution result is still valid. Logging failure is non-blocking. | Background retry for the log write. |

### Retry Logic

Agent executions are processed by the `agent.worker.ts` BullMQ worker with these retry settings:

```typescript
const AGENT_QUEUE_CONFIG = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,  // 2s, 4s, 8s
  },
  removeOnComplete: { age: 86400, count: 1000 },  // Keep 24h or 1000 jobs
  removeOnFail: { age: 604800 },                    // Keep failed 7 days
};
```

### Circuit Breaker for AI Service

```typescript
// src/ai/ai-client.ts

import CircuitBreaker from 'opossum';

class AIClient {
  private circuitBreaker: CircuitBreaker;

  constructor() {
    this.circuitBreaker = new CircuitBreaker(this.callAIService.bind(this), {
      timeout: 30000,                    // 30s timeout per call
      errorThresholdPercentage: 50,      // Open circuit if 50% of calls fail
      resetTimeout: 30000,               // Try again after 30s
      volumeThreshold: 5,                // Minimum 5 calls before evaluating
    });

    // Fallback: return degraded response instead of crashing
    this.circuitBreaker.fallback(() => ({
      status: 'ai_unavailable',
      message: 'AI service temporarily unavailable. Action queued for retry.',
      result: null,
      confidence: 0,
      model_used: 'none',
      tokens_used: 0,
      cost_cents: 0,
    }));

    // Observability
    this.circuitBreaker.on('open', () => {
      logger.warn('AI service circuit breaker OPENED');
    });
    this.circuitBreaker.on('halfOpen', () => {
      logger.info('AI service circuit breaker HALF-OPEN (testing)');
    });
    this.circuitBreaker.on('close', () => {
      logger.info('AI service circuit breaker CLOSED (recovered)');
    });
  }

  async reason(request: ReasonRequest): Promise<ReasonResponse> {
    return this.circuitBreaker.fire(request) as Promise<ReasonResponse>;
  }

  private async callAIService(request: ReasonRequest): Promise<ReasonResponse> {
    const response = await fetch(`${env.AI_SERVICE_URL}/ai/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`AI service error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }
}
```

### Graceful Degradation

When the AI service is down, the system degrades gracefully:

| Component | AI Service Healthy | AI Service Down |
|---|---|---|
| CRUD operations (API) | Normal | Normal (no AI needed) |
| Dashboard | Full insights | Static data only, no AI-generated insights |
| Copilot | Full functionality | Returns "AI temporarily unavailable" message |
| Agent execution (event-triggered) | Normal | Queued in BullMQ for retry when AI recovers |
| Agent execution (chat-triggered) | Normal | Returns error to user, suggests trying later |
| Integration sync | Normal | Normal (no AI needed for data sync) |
| Manual invoice/estimate creation | Normal | Normal (CRUD, no AI) |

---

## Cross-References

- **Agent definitions (all 9 agents):** See [07-agent-definitions.md](./07-agent-definitions.md)
- **Copilot orchestration (how chat triggers route to agents):** See [08-copilot.md](./08-copilot.md)
- **Queue system (BullMQ workers that process agent jobs):** See [14-queue-system.md](./14-queue-system.md)
- **Error handling & resilience (circuit breaker, retries):** See [22-error-handling.md](./22-error-handling.md)
- **Database schema (agent_executions, agent_configs tables):** See [02-database-schema.md](./02-database-schema.md)
- **Security (RLS, service-role bypass for workers):** See [05-security.md](./05-security.md)
