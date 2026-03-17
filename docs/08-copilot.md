# 08 — AI Copilot

> Permanent reference for the CrewShift AI Copilot. Covers the message processing pipeline, intent classification, intent-to-agent routing, multi-agent dispatch, SSE streaming, context window management, direct answer vs agent dispatch, conversation memory architecture, business context graph, and proactive intelligence.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Message Processing Pipeline](#2-message-processing-pipeline)
3. [Intent Classification](#3-intent-classification)
4. [Intent-to-Agent Routing Map](#4-intent-to-agent-routing-map)
5. [Multi-Agent Dispatch](#5-multi-agent-dispatch)
6. [SSE Streaming](#6-sse-streaming)
7. [Context Window Management](#7-context-window-management)
8. [Direct Answer vs Agent Dispatch](#8-direct-answer-vs-agent-dispatch)
9. [Conversation Memory Architecture](#9-conversation-memory-architecture)
10. [Business Context Graph](#10-business-context-graph)
11. [Proactive Intelligence](#11-proactive-intelligence)

---

## 1. Overview

The AI copilot is the single interface that ties all agents together. It is **not a chatbot** — it is an operations coordinator that speaks English. The contractor talks to it like they would talk to their office manager. Text or voice.

**What the copilot does:**
- Classifies user intent and routes to the appropriate agent(s)
- Orchestrates multi-agent dispatch when a single message requires multiple agents
- Streams responses in real-time via SSE
- Maintains short-term, medium-term, and long-term memory
- Answers questions directly when no agent is needed (DB lookups, general knowledge)
- Proactively surfaces insights and action items

**What the copilot is NOT:**
- It is not a wrapper around ChatGPT. It has access to all business data and agent capabilities.
- It does not have general-purpose conversation abilities beyond business operations.
- It does not replace the dashboard — it complements it with natural language interaction.

---

## 2. Message Processing Pipeline

### Flow Diagram

```
User sends message to POST /api/copilot/message
         |
         v
+========================+
| 1. CLASSIFY INTENT     |   --> Python /ai/classify (fast model: GPT-5 Nano / Gemini Flash-Lite)
| Returns:               |       Target: < 500ms
|   - intent             |
|   - entities           |
|   - confidence         |
+===========+============+
            |
     +------v------+
     | Intent type? |
     +--+---+---+--+
        |   |   |
   +----+   |   +----+
   |        |        |
   v        v        v
+------+ +------+ +--------+
|Query | |Agent | |Workflow|
|      | |Disp. | |Create  |
+--+---+ +--+---+ +---+----+
   |        |          |
   v        v          v
DB lookup  Agent      Workflow
(direct)  Runtime     Engine
   |        |          |
   +--------+----------+
            |
  +---------v---------+
  | 2. AGGREGATE      |   Collect results from all dispatched agents/queries
  |    RESULTS        |   Handle partial failures (3 of 4 succeed)
  +---------+---------+   Timeout: 30 seconds per agent
            |
  +---------v---------+
  | 3. GENERATE       |   --> Python /ai/reason (capable model: Claude Sonnet / GPT-5.2)
  |    RESPONSE       |   Synthesize agent results into natural language
  +---------+---------+   Include context: org data, conversation history
            |
  +---------v---------+
  | 4. STREAM         |   --> SSE on the same HTTP connection
  |    RESPONSE       |   Token-by-token streaming to the client
  +-------------------+   Events: status, agent_result, token, done
```

### Detailed Step Walkthrough

**Step 1 — CLASSIFY:** The user's message is sent to the Python AI service (`POST /ai/classify`) using a fast, cheap model (GPT-5 Nano or Gemini Flash-Lite). This returns an intent label, extracted entities, and a confidence score. Target latency: under 500ms.

**Step 2 — ROUTE:** Based on the classified intent, the copilot decides:
- **Query**: Direct DB lookup. No agent needed. Fast answer.
- **Agent Dispatch**: Route to one or more agents via the Agent Runtime.
- **Workflow Creation**: Route to the Workflow Engine for custom automation.
- **General Question**: Answer directly with LLM (no DB or agent).
- **Multi-Action**: Dispatch multiple agents in parallel.

**Step 3 — AGGREGATE:** If multiple agents were dispatched, collect their results. Handle partial failures (if 3 of 4 agents complete, return partial results + status for the pending one). Timeout: 30 seconds per agent.

**Step 4 — GENERATE:** Feed the aggregated results to the Python AI service (`POST /ai/reason`) with the capable model. The LLM synthesizes a natural-language response from the raw agent outputs.

**Step 5 — STREAM:** Stream the response back to the client via SSE. The client receives status updates, agent results, and the final response token-by-token.

---

## 3. Intent Classification

### How It Works

Intent classification runs on the Python AI service at `POST /ai/classify`. It uses a **fast, cheap model** (GPT-5 Nano or Gemini Flash-Lite) because classification must be sub-second.

```python
# apps/ai-service/app/routers/classify.py

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

class ClassifyRequest(BaseModel):
    message: str
    org_context: dict  # trade_type, connected_integrations, etc.
    recent_intents: list[str] = []  # last 3 intents for context

class ClassifyResponse(BaseModel):
    intent: str
    entities: dict
    confidence: float
    is_multi_action: bool

@router.post("/ai/classify")
async def classify_intent(request: ClassifyRequest) -> ClassifyResponse:
    """
    Classify a user message into an intent category.
    Uses a fast model for sub-500ms response.
    """
    system_prompt = f"""You are an intent classifier for a {request.org_context.get('trade_type', 'trades')} business AI assistant.

Classify the user's message into exactly one intent from this list:
- query.job_status: asking about a specific job's status/details
- query.invoice_status: asking about a specific invoice
- query.customer_info: asking about a customer
- query.schedule: asking about today's/this week's schedule
- query.inventory: asking about parts/stock levels
- query.financial: asking about revenue, margins, outstanding amounts
- create-invoice: wants to create/generate an invoice
- generate-invoice: same as create-invoice
- create-estimate: wants to create an estimate
- create-change-order: wants to create a change order
- create-proposal: wants to create a proposal
- check-collections: wants to check outstanding/overdue invoices
- outstanding-invoices: same as check-collections
- send-reminder: wants to send a payment reminder
- schedule-job: wants to schedule or book a job
- dispatch-tech: wants to assign a tech to a job
- reschedule-job: wants to change a job's schedule
- check-schedule: wants to see the schedule
- business-report: wants a business performance report
- how-did-we-do: same as business-report
- pricing-analysis: wants pricing recommendations
- demand-forecast: wants demand/workload prediction
- check-inventory: wants to check stock levels
- order-parts: wants to order/reorder parts
- inventory-report: wants an inventory summary
- customer-info: wants customer details/history
- send-review-request: wants to request a customer review
- send-message-to-customer: wants to send a message
- check-leads: wants to see new/scored leads
- customer-follow-up: wants to follow up with a customer
- check-compliance: wants compliance status
- upcoming-deadlines: wants to see upcoming deadlines/renewals
- certification-status: wants tech certification info
- categorize-expense: wants to categorize an expense
- revenue-report: wants revenue breakdown
- payroll-report: wants payroll/hours data
- create-workflow: wants to create a custom workflow/automation
- multi-action: message implies multiple agent actions (e.g., "job is done")
- general-question: general knowledge question, no agent needed

Also extract entities:
- customer_name, job_id, invoice_id, tech_name, date, amount, part_name

Return JSON: {{ "intent": "...", "entities": {{...}}, "confidence": 0.0-1.0, "is_multi_action": false }}
"""

    response = await provider_router.classify(
        text=request.message,
        system=system_prompt,
        model_tier="fast",  # GPT-5 Nano or Gemini Flash-Lite
    )

    return ClassifyResponse(**response)
```

### Intent Taxonomy

| Category | Intent | Description | Example Message |
|---|---|---|---|
| **Query** | `query.job_status` | Look up a specific job | "What time is the Henderson job?" |
| **Query** | `query.invoice_status` | Look up a specific invoice | "Did the Johnson invoice go out?" |
| **Query** | `query.customer_info` | Look up customer details | "What's Johnson's address?" |
| **Query** | `query.schedule` | Look up today's/week's schedule | "What's on for today?" |
| **Query** | `query.inventory` | Look up stock levels | "How much copper pipe do we have?" |
| **Query** | `query.financial` | Look up financial data | "What's our revenue this month?" |
| **Invoice** | `create-invoice` / `generate-invoice` | Create an invoice | "Invoice the Henderson job" |
| **Estimate** | `create-estimate` | Create an estimate | "Build an estimate for a furnace replacement" |
| **Estimate** | `create-change-order` | Create a change order | "Henderson job needs a change order, extra $500 for ductwork" |
| **Estimate** | `create-proposal` | Create a formal proposal | "Create a proposal for the commercial HVAC install" |
| **Collections** | `check-collections` / `outstanding-invoices` | Check outstanding invoices | "What's overdue?" |
| **Collections** | `send-reminder` | Send a payment reminder | "Send Henderson a reminder about invoice 1234" |
| **Field Ops** | `schedule-job` | Schedule a job | "Schedule Mike for Henderson tomorrow at 2pm" |
| **Field Ops** | `dispatch-tech` | Assign a tech | "Send Mike to the emergency call on 5th St" |
| **Field Ops** | `reschedule-job` | Change a schedule | "Move the Henderson job to Thursday" |
| **Field Ops** | `check-schedule` | View the schedule | "What's Mike doing tomorrow?" |
| **Insights** | `business-report` / `how-did-we-do` | Get performance report | "How did we do last month?" |
| **Insights** | `pricing-analysis` | Get pricing recommendations | "Are we charging enough for furnace installs?" |
| **Insights** | `demand-forecast` | Get demand prediction | "What does next month look like?" |
| **Inventory** | `check-inventory` | Check stock levels | "How much copper pipe left?" |
| **Inventory** | `order-parts` | Order/reorder parts | "Order more 1/2 inch copper fittings" |
| **Inventory** | `inventory-report` | Get inventory summary | "Give me an inventory report" |
| **Customer** | `customer-info` | Get customer details | "Tell me about the Henderson account" |
| **Customer** | `send-review-request` | Request a review | "Send Henderson a review request" |
| **Customer** | `send-message-to-customer` | Send a message | "Text Henderson that we're running 30 min late" |
| **Customer** | `check-leads` | Check new leads | "Any new leads this week?" |
| **Customer** | `customer-follow-up` | Follow up with customer | "Follow up on the rejected estimate for Henderson" |
| **Compliance** | `check-compliance` | Check compliance status | "Are we current on everything?" |
| **Compliance** | `upcoming-deadlines` | View upcoming deadlines | "What deadlines are coming up?" |
| **Compliance** | `certification-status` | Check certifications | "When does Mike's OSHA-10 expire?" |
| **Bookkeeping** | `categorize-expense` | Categorize an expense | "The $450 at Johnstone Supply is parts for the Henderson job" |
| **Bookkeeping** | `revenue-report` | Get revenue breakdown | "Revenue breakdown by tech this month" |
| **Bookkeeping** | `payroll-report` | Get payroll data | "How many hours did each tech work this week?" |
| **Workflow** | `create-workflow` | Create an automation | "Build a workflow that texts me for every job over $5k" |
| **Multi** | `multi-action` | Multiple agents needed | "Henderson job is done, Mike finished at 3, used 200ft copper pipe" |
| **General** | `general-question` | No agent needed | "What's OSHA-10?" |

### Confidence Thresholds

| Confidence | Action |
|---|---|
| >= 0.85 | Route directly to the matched intent |
| 0.6 - 0.85 | Route to intent but include a "Did you mean..." confirmation in the response |
| < 0.6 | Ask the user to clarify before routing |

---

## 4. Intent-to-Agent Routing Map

### Complete Routing Table

| Intent | Routes To | Type | Notes |
|---|---|---|---|
| `query.job_status` | DB lookup (no agent) | Query | Direct SQL: `SELECT * FROM jobs WHERE id = $1 AND org_id = $2` |
| `query.invoice_status` | DB lookup (no agent) | Query | Direct SQL: `SELECT * FROM invoices WHERE ...` |
| `query.customer_info` | DB lookup (no agent) | Query | Direct SQL: `SELECT * FROM customers WHERE ...` |
| `query.schedule` | DB lookup (no agent) | Query | Direct SQL: `SELECT * FROM jobs WHERE scheduled_start >= $date AND org_id = $org` |
| `query.inventory` | DB lookup (no agent) | Query | Direct SQL: `SELECT * FROM parts WHERE name ILIKE $search AND org_id = $org` |
| `query.financial` | DB lookup + light AI | Query | SQL aggregation + AI for natural language summary |
| `create-invoice` | Invoice Agent | Agent dispatch | Full agent execution pipeline |
| `generate-invoice` | Invoice Agent | Agent dispatch | Same as create-invoice |
| `create-estimate` | Estimate Agent | Agent dispatch | Full agent execution |
| `create-change-order` | Estimate Agent | Agent dispatch | With type='change_order' |
| `create-proposal` | Estimate Agent | Agent dispatch | With type='proposal' |
| `check-collections` | Collections Agent (query mode) | Agent dispatch | Read-only: returns outstanding data |
| `outstanding-invoices` | Collections Agent (query mode) | Agent dispatch | Same as check-collections |
| `send-reminder` | Collections Agent | Agent dispatch | Action mode: sends follow-up |
| `schedule-job` | Field Ops Agent | Agent dispatch | Full scheduling |
| `dispatch-tech` | Field Ops Agent | Agent dispatch | Emergency or immediate dispatch |
| `reschedule-job` | Field Ops Agent | Agent dispatch | Modify existing schedule |
| `check-schedule` | DB lookup (no agent) | Query | Direct SQL query for schedule |
| `business-report` | Insights Agent | Agent dispatch | Full analysis report |
| `how-did-we-do` | Insights Agent | Agent dispatch | Same as business-report |
| `pricing-analysis` | Insights Agent | Agent dispatch | Pricing-specific analysis |
| `demand-forecast` | Insights Agent | Agent dispatch | Demand forecasting |
| `check-inventory` | DB lookup (no agent) | Query | Direct SQL for stock levels |
| `order-parts` | Inventory Agent | Agent dispatch | Reorder action |
| `inventory-report` | Inventory Agent | Agent dispatch | Full inventory analysis |
| `customer-info` | DB lookup (no agent) | Query | Direct SQL for customer data |
| `send-review-request` | Customer Agent | Agent dispatch | Review request action |
| `send-message-to-customer` | Customer Agent | Agent dispatch | Send message action |
| `check-leads` | DB lookup + Customer Agent | Hybrid | DB for data, agent for scoring |
| `customer-follow-up` | Customer Agent | Agent dispatch | Follow-up action |
| `check-compliance` | Compliance Agent | Agent dispatch | Compliance assessment |
| `upcoming-deadlines` | Compliance Agent | Agent dispatch | Deadline scan |
| `certification-status` | DB lookup (no agent) | Query | Direct lookup in business_context |
| `categorize-expense` | Bookkeeping Agent | Agent dispatch | Expense categorization |
| `revenue-report` | Bookkeeping Agent | Agent dispatch | Revenue analysis |
| `payroll-report` | Bookkeeping Agent | Agent dispatch | Payroll data |
| `create-workflow` | Workflow Engine | Workflow | Workflow creation |
| `multi-action` | Multiple Agents | Multi-dispatch | See Section 5 |
| `general-question` | Direct LLM Answer | LLM | No agent, no DB. Direct response. |

### Router Implementation

```typescript
// src/services/copilot.service.ts

import { AgentRuntime } from '../agents/runtime';
import { ClassifyResponse } from '../ai/types';

export class CopilotService {
  constructor(
    private runtime: AgentRuntime,
    private aiClient: AIClient,
    private db: DatabaseClient,
  ) {}

  async routeIntent(
    classification: ClassifyResponse,
    orgId: string,
    userId: string,
    conversationId: string
  ): Promise<RouteResult> {
    const { intent, entities, confidence, is_multi_action } = classification;

    // Multi-action: dispatch multiple agents
    if (is_multi_action || intent === 'multi-action') {
      return this.handleMultiAction(entities, orgId, userId);
    }

    // Query intents: direct DB lookup
    if (intent.startsWith('query.')) {
      return this.handleQuery(intent, entities, orgId);
    }

    // General question: direct LLM answer
    if (intent === 'general-question') {
      return { type: 'direct_llm', data: null };
    }

    // Workflow creation: route to workflow engine
    if (intent === 'create-workflow') {
      return this.handleWorkflowCreation(entities, orgId, userId);
    }

    // Agent dispatch: route to the appropriate agent
    const execution = await this.runtime.handleChatIntent(
      intent,
      entities,
      orgId,
      userId
    );

    return {
      type: 'agent_dispatch',
      data: {
        executionId: execution.executionId,
        agentType: execution.agentType,
        status: execution.status,
        output: execution.reasoningOutput,
      },
    };
  }

  private async handleQuery(
    intent: string,
    entities: Record<string, any>,
    orgId: string
  ): Promise<RouteResult> {
    // Direct database lookups for query intents
    let data: any;

    switch (intent) {
      case 'query.job_status':
        data = await this.db.query(
          'SELECT * FROM jobs WHERE org_id = $1 AND (id::text = $2 OR description ILIKE $3)',
          [orgId, entities.job_id, `%${entities.customer_name || ''}%`]
        );
        break;

      case 'query.invoice_status':
        data = await this.db.query(
          'SELECT i.*, c.name as customer_name FROM invoices i JOIN customers c ON i.customer_id = c.id WHERE i.org_id = $1 AND (i.id::text = $2 OR i.invoice_number = $3 OR c.name ILIKE $4)',
          [orgId, entities.invoice_id, entities.invoice_number, `%${entities.customer_name || ''}%`]
        );
        break;

      case 'query.customer_info':
        data = await this.db.query(
          'SELECT * FROM customers WHERE org_id = $1 AND name ILIKE $2',
          [orgId, `%${entities.customer_name}%`]
        );
        break;

      case 'query.schedule':
        data = await this.db.query(
          `SELECT j.*, c.name as customer_name, p.full_name as tech_name
           FROM jobs j
           LEFT JOIN customers c ON j.customer_id = c.id
           LEFT JOIN profiles p ON j.assigned_tech_id = p.id
           WHERE j.org_id = $1 AND j.scheduled_start >= $2 AND j.scheduled_start < $3
           ORDER BY j.scheduled_start ASC`,
          [orgId, entities.date_start || 'today', entities.date_end || 'tomorrow']
        );
        break;

      case 'query.inventory':
        data = await this.db.query(
          'SELECT * FROM parts WHERE org_id = $1 AND name ILIKE $2',
          [orgId, `%${entities.part_name || ''}%`]
        );
        break;

      case 'query.financial':
        data = await this.db.query(
          `SELECT
            COUNT(*) as total_invoices,
            SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) as revenue,
            SUM(CASE WHEN status IN ('sent', 'overdue') THEN total ELSE 0 END) as outstanding,
            COUNT(CASE WHEN status = 'overdue' THEN 1 END) as overdue_count
           FROM invoices
           WHERE org_id = $1 AND created_at >= $2`,
          [orgId, entities.date_start || 'first_of_month']
        );
        break;
    }

    return { type: 'query', data };
  }
}
```

---

## 5. Multi-Agent Dispatch

### When It Happens

Multi-agent dispatch occurs when a single user message implies actions for multiple agents. The most common example:

> "The Henderson job is done. Mike finished around 3pm. Materials were 200 feet of copper pipe and 4 elbows."

This triggers:
1. **Invoice Agent** -- generate invoice with labor (8am-3pm) + materials
2. **Inventory Agent** -- deduct 200ft copper pipe + 4 elbows
3. **Customer Agent** -- send completion notification, queue review request (24h delay)
4. **Bookkeeping Agent** -- categorize revenue + material costs

### Parallel Execution

All matched agents execute concurrently via BullMQ. They do not wait for each other.

```typescript
// src/services/copilot.service.ts

private async handleMultiAction(
  entities: Record<string, any>,
  orgId: string,
  userId: string
): Promise<RouteResult> {
  // Determine which agents to dispatch based on entities
  const agentsToDispatch: string[] = [];

  if (entities.job_completed || entities.job_id) {
    agentsToDispatch.push('invoice', 'customer', 'bookkeeping');
  }
  if (entities.materials && entities.materials.length > 0) {
    agentsToDispatch.push('inventory');
  }

  // Dispatch all agents in parallel
  const executionPromises = agentsToDispatch.map((agentType) =>
    this.runtime.handleChatIntent(
      `multi-action:${agentType}`,
      { ...entities, multi_action: true },
      orgId,
      userId
    ).catch((error) => ({
      agentType,
      status: 'failed' as const,
      error: error.message,
    }))
  );

  // Wait for all with timeout
  const results = await Promise.allSettled(
    executionPromises.map((p) =>
      Promise.race([
        p,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Agent timeout')), 30000)
        ),
      ])
    )
  );

  return {
    type: 'multi_dispatch',
    data: {
      agents: agentsToDispatch,
      results: results.map((r, i) => ({
        agentType: agentsToDispatch[i],
        status: r.status === 'fulfilled' ? 'completed' : 'failed',
        output: r.status === 'fulfilled' ? (r.value as any).reasoningOutput : null,
        error: r.status === 'rejected' ? r.reason?.message : null,
      })),
    },
  };
}
```

### Timeout Handling

- Each agent has a 30-second timeout
- If an agent does not complete within 30 seconds, it is marked as "still processing" in the response
- The response streams partial results immediately as agents complete

### Partial Success

If 3 of 4 agents complete successfully:

```
Response: "Invoice #1247 generated for $1,840 and sent to QuickBooks.
Inventory updated: 200ft copper pipe and 4 elbows deducted.
Henderson will get a completion notification now and a review request tomorrow.
(Bookkeeping Agent is still processing...)"
```

### Result Aggregation

All agent results are collected and passed to the LLM for synthesis:

```typescript
private async aggregateAndRespond(
  results: AgentResult[],
  originalMessage: string,
  context: CopilotContext
): Promise<string> {
  const prompt = `The user said: "${originalMessage}"

The following agents were dispatched and returned these results:

${results.map(r => `${r.agentType} Agent (${r.status}): ${JSON.stringify(r.output)}`).join('\n\n')}

Synthesize these results into a clear, natural-language response for the contractor.
Be concise but complete. Mention specific numbers (invoice amount, parts deducted, etc.).
If any agents failed or are still processing, mention that.`;

  return this.aiClient.reason({
    prompt,
    system: context.system_prompt,
    model_tier: 'capable',
  });
}
```

---

## 6. SSE Streaming

### Implementation Detail

The copilot uses **Server-Sent Events (SSE)** on `POST /api/copilot/message`. The same HTTP connection is used for the entire response lifecycle — from classification through streaming.

```typescript
// src/routes/copilot.routes.ts

import { FastifyRequest, FastifyReply } from 'fastify';

interface CopilotMessageBody {
  message: string;
  conversation_id?: string;
}

app.post('/api/copilot/message', {
  preHandler: [authMiddleware],
}, async (request: FastifyRequest<{ Body: CopilotMessageBody }>, reply: FastifyReply) => {
  const { message, conversation_id } = request.body;
  const { orgId, userId } = request;

  // Set SSE headers
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',  // Disable nginx buffering
  });

  // Helper to send SSE events
  const sendEvent = (eventType: string, data: any) => {
    reply.raw.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Phase 1: Classification
    sendEvent('status', { phase: 'classifying', message: 'Understanding your request...' });

    const classification = await copilotService.classifyIntent(message, orgId);

    sendEvent('status', {
      phase: 'classified',
      intent: classification.intent,
      confidence: classification.confidence,
    });

    // Phase 2: Routing + Dispatch
    if (classification.intent.startsWith('query.')) {
      sendEvent('status', { phase: 'querying', message: 'Looking that up...' });
    } else if (classification.is_multi_action) {
      sendEvent('status', { phase: 'dispatching', message: 'Dispatching multiple agents...' });
    } else {
      const agentName = getAgentName(classification.intent);
      sendEvent('status', { phase: 'dispatching', message: `Running ${agentName}...` });
    }

    const routeResult = await copilotService.routeIntent(
      classification,
      orgId,
      userId,
      conversation_id || ''
    );

    // Phase 3: Send agent results
    if (routeResult.type === 'multi_dispatch') {
      for (const result of routeResult.data.results) {
        sendEvent('agent_result', {
          agent: result.agentType,
          status: result.status,
          output: result.output,
        });
      }
    } else if (routeResult.type === 'agent_dispatch') {
      sendEvent('agent_result', {
        agent: routeResult.data.agentType,
        status: routeResult.data.status,
        output: routeResult.data.output,
      });
    }

    // Phase 4: Generate and stream the natural-language response
    sendEvent('status', { phase: 'generating', message: 'Composing response...' });

    const context = await copilotService.buildContext(orgId, userId, conversation_id);

    const responseStream = await copilotService.generateStreamingResponse(
      message,
      routeResult,
      context
    );

    // Stream tokens as they arrive from the AI service
    for await (const token of responseStream) {
      sendEvent('token', { text: token });
    }

    // Phase 5: Done
    sendEvent('done', {
      message: routeResult.fullResponse,
      execution_ids: routeResult.executionIds,
      actions_taken: routeResult.actionsSummary,
      follow_up_suggestions: routeResult.suggestions,
    });

    // Save message to conversation
    await copilotService.saveMessage(orgId, userId, conversation_id, message, routeResult);

  } catch (error) {
    sendEvent('error', {
      code: 'COPILOT_ERROR',
      message: 'Something went wrong. Your request may have been partially processed.',
    });
    logger.error({ error, orgId, userId }, 'Copilot error');
  } finally {
    reply.raw.end();
  }
});
```

### SSE Event Types

| Event | When | Payload |
|---|---|---|
| `status` | Phase transitions | `{ phase, message }` |
| `agent_result` | An agent completes | `{ agent, status, output }` |
| `token` | LLM generates a token | `{ text }` |
| `done` | Final response complete | `{ message, execution_ids, actions_taken, follow_up_suggestions }` |
| `error` | Something went wrong | `{ code, message }` |

### How Fastify Handles SSE

Fastify does not natively support SSE, but it exposes the raw Node.js response object via `reply.raw`. We write directly to this stream:

- `reply.raw.writeHead(200, headers)` — set SSE headers
- `reply.raw.write(data)` — send SSE events
- `reply.raw.end()` — close the connection

The `X-Accel-Buffering: no` header is important for Railway/nginx deployments — it prevents the reverse proxy from buffering the stream.

---

## 7. Context Window Management

### CopilotContext Interface

```typescript
// src/services/copilot.service.ts

interface CopilotContext {
  // === ALWAYS INCLUDED ===

  /** Copilot persona + capabilities description */
  system_prompt: string;

  /** Organization context from the organizations table */
  org_context: {
    name: string;
    trade_type: string;
    size: string;
    tier: string;
    settings: Record<string, any>;
    connected_integrations: string[];
  };

  // === SHORT-TERM MEMORY ===

  /** Last N messages in the current conversation */
  recent_messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
  }>;

  // === MEDIUM-TERM MEMORY ===

  /** AI-generated summary of the conversation so far */
  conversation_summary?: string;

  // === LONG-TERM MEMORY ===

  /** Relevant business context from the business_context table */
  business_context: Array<{
    category: string;
    key: string;
    value: any;
    confidence: number;
  }>;

  /** Vector search results from the embeddings table */
  semantic_results?: Array<{
    content: string;
    source_type: string;
    relevance_score: number;
  }>;

  // === AGENT OUTPUTS (if dispatching) ===

  /** Results from dispatched agents in this turn */
  agent_outputs?: Array<{
    agent_type: string;
    status: string;
    output: Record<string, any>;
  }>;
}
```

### What Gets Included and Priority Order

The context window has a budget of approximately **6,000 tokens** for context, with the rest reserved for the LLM response.

**Priority order (highest to lowest):**

| Priority | Component | Approximate Tokens | Always Included? |
|---|---|---|---|
| 1 | System prompt | ~500 | Yes |
| 2 | Recent messages (last 10) | ~1,500 | Yes |
| 3 | Agent outputs (current turn) | ~1,000 | If dispatching |
| 4 | Org context | ~200 | Yes |
| 5 | Business context (relevant) | ~1,000 | Top 10 most relevant entries |
| 6 | Semantic search results | ~800 | If query involves historical data |
| 7 | Conversation summary | ~500 | If conversation > 10 messages |
| **Total** | | **~5,500** | |

### Context Building Logic

```typescript
async buildContext(
  orgId: string,
  userId: string,
  conversationId: string | null
): Promise<CopilotContext> {
  // 1. System prompt (always first, always full)
  const system_prompt = this.getSystemPrompt();

  // 2. Org context (always included, small)
  const org = await this.orgRepo.findById(orgId);
  const integrations = await this.integrationRepo.findConnected(orgId);
  const org_context = {
    name: org.name,
    trade_type: org.trade_type,
    size: org.size,
    tier: org.tier,
    settings: org.settings,
    connected_integrations: integrations.map(i => i.provider),
  };

  // 3. Recent messages (last 10 in this conversation)
  let recent_messages: any[] = [];
  let conversation_summary: string | undefined;
  if (conversationId) {
    const messages = await this.messageRepo.findRecent(conversationId, 10);
    recent_messages = messages.map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.created_at,
    }));

    // If conversation is long, include summary
    const conversation = await this.conversationRepo.findById(conversationId);
    if (conversation?.summary) {
      conversation_summary = conversation.summary;
    }
  }

  // 4. Business context (top 10 most relevant)
  const business_context = await this.contextRepo.findRelevant(orgId, 10);

  // 5. Semantic search (only if the query seems to reference historical data)
  let semantic_results: any[] | undefined;
  // Semantic search is triggered by the router when needed

  return {
    system_prompt,
    org_context,
    recent_messages,
    conversation_summary,
    business_context,
    semantic_results,
  };
}

private getSystemPrompt(): string {
  return `You are the AI operations coordinator for a trades business using CrewShift.
You have access to all business data through connected integrations and 9 specialized AI agents.
You can look up jobs, invoices, customers, inventory, schedules, and more.
You can dispatch agents to create invoices, generate estimates, send follow-ups, schedule jobs, and more.

Be concise and direct. Contractors are busy people. Lead with the answer, then provide details.
Use specific numbers when available. Don't hedge unnecessarily.
If you performed an action, confirm what you did with specifics (amounts, names, dates).
If something needs the contractor's review, say so clearly.

You are not a general-purpose chatbot. Stay focused on business operations.`;
}
```

### Token Budget Allocation

```
Total context window: ~128K tokens (Claude Sonnet 4.6)
Reserved for response: ~4,000 tokens
Available for context: ~124,000 tokens

But we target ~6,000 tokens for context because:
- Most of the context window is wasted on most requests
- Smaller context = faster inference = lower cost
- The system prompt + recent messages + agent outputs cover 95% of use cases
- We only pull more context (semantic search, business context) when needed
```

---

## 8. Direct Answer vs Agent Dispatch

### Decision Logic

The copilot decides whether to answer directly or dispatch an agent based on the classified intent:

```
Is it a query.* intent?
  YES --> Direct DB lookup + LLM formatting
         Fast path: SQL query + format result as natural language
         No agent execution, no BullMQ job, no AI reasoning step

  NO --> Is it general-question?
    YES --> Direct LLM answer (no DB, no agent)
            Just send to the AI service for a conversational response

    NO --> Dispatch to agent
           Full 9-step execution pipeline
           May go to review queue
           May trigger chains
```

### When to Query DB Directly vs Dispatch an Agent

| Criteria | Direct DB Query | Agent Dispatch |
|---|---|---|
| User wants **information** | Yes | No |
| User wants an **action** | No | Yes |
| Response requires **AI reasoning** | No | Yes |
| Response is a simple **lookup** | Yes | No |
| Response requires **external sync** | No | Yes |
| Response generates a **document** | No | Yes |
| Response sends a **message** to someone | No | Yes |
| Response involves **financial calculations** | Maybe (simple sums) | Yes (complex) |

**Examples:**

| User Message | Route | Reason |
|---|---|---|
| "What time is Henderson's job?" | Direct DB | Simple lookup |
| "Invoice the Henderson job" | Invoice Agent | Creates document, syncs to QB |
| "What's overdue?" | Direct DB + light formatting | Simple query on invoices table |
| "Send Henderson a reminder" | Collections Agent | Sends external message |
| "How did we do last month?" | Insights Agent | Complex analysis requiring AI |
| "What's OSHA-10?" | Direct LLM | General knowledge, no data needed |

---

## 9. Conversation Memory Architecture

### Three Tiers

```
+------------------+     +-------------------+     +--------------------+
| SHORT-TERM       |     | MEDIUM-TERM       |     | LONG-TERM          |
| Last 10 messages |     | Conversation      |     | Vector store +     |
| in conversation  |     | summary (AI-      |     | Business context   |
|                  |     | generated)        |     | graph              |
| Stored in:       |     | Stored in:        |     | Stored in:         |
| messages table   |     | conversations.    |     | embeddings table + |
|                  |     | summary column    |     | business_context   |
| TTL: session     |     | TTL: conversation |     | TTL: permanent     |
+------------------+     +-------------------+     +--------------------+
```

### Short-Term Memory: Last N Messages

The last 10 messages in the current conversation are included in every LLM call. This provides immediate conversational context.

```typescript
// Fetching short-term memory
const recentMessages = await messageRepo.findRecent(conversationId, 10);
// Returns: [{ role: 'user', content: '...', created_at: '...' }, ...]
```

**Why 10 messages?** Balances context quality with token budget. Most conversations resolve within 5-10 turns. If a conversation is longer, the summary (medium-term) carries the earlier context.

### Medium-Term Memory: Conversation Summary

When a conversation exceeds 10 messages, the AI generates a summary of the earlier messages. This summary is stored in `conversations.summary` and injected as context instead of the full message history.

```typescript
// Triggered when conversation reaches 15 messages
async function summarizeConversation(conversationId: string): Promise<void> {
  const allMessages = await messageRepo.findAll(conversationId);

  // Only summarize messages older than the last 10
  const oldMessages = allMessages.slice(0, -10);

  const summary = await aiClient.reason({
    prompt: `Summarize this conversation for context. Focus on:
      - What the user asked for
      - What actions were taken (agents dispatched, results)
      - Key data points mentioned (amounts, names, dates)
      - Any unresolved items or follow-ups

      Conversation:
      ${oldMessages.map(m => `${m.role}: ${m.content}`).join('\n')}`,
    model_tier: 'fast',
  });

  await conversationRepo.updateSummary(conversationId, summary);
}
```

### Long-Term Memory: Vector Store + Business Context Graph

Long-term memory consists of two systems:

1. **Vector store (embeddings table):** Semantic search over all business data. When the copilot needs historical context ("What did we charge for furnace installs last year?"), it searches the embeddings table using vector similarity.

2. **Business context graph (business_context table):** Structured knowledge about the business. Categories, keys, values, confidence scores. This is the "learned preferences" system (see Section 10).

```typescript
// Vector search for relevant business context
async function semanticSearch(orgId: string, query: string, limit: number = 5): Promise<string[]> {
  // 1. Generate embedding for the query
  const queryEmbedding = await aiClient.embed({ text: query });

  // 2. Search the embeddings table
  const results = await db.query(
    `SELECT content, source_type, 1 - (embedding <=> $1) AS relevance
     FROM embeddings
     WHERE org_id = $2
     ORDER BY embedding <=> $1
     LIMIT $3`,
    [queryEmbedding, orgId, limit]
  );

  return results.rows;
}
```

---

## 10. Business Context Graph

### How It Is Built

The business context graph is built incrementally from every interaction:

1. **Onboarding:** Static business data entered during setup (company info, trade type, team, services)
2. **Integration sync:** Data pulled from connected tools (customers, historical jobs, pricing)
3. **Agent execution:** Every agent action adds to the graph (pricing patterns learned from invoices, customer preferences learned from interactions)
4. **Copilot conversations:** Explicit preferences stated by the user ("always round estimates to nearest $50")
5. **Scheduled analysis:** Weekly/monthly analysis by the Insights Agent updates patterns

### Categories

| Category | Examples | Source |
|---|---|---|
| `pricing` | Average price by job type, margin targets, seasonal adjustments | Invoice Agent, Insights Agent, historical data |
| `customer` | Payment patterns, preferences ("don't schedule Mondays"), lifetime value trends | Customer Agent, Collections Agent, job history |
| `operational` | Busy days, common issues, average job duration by type, tech performance | Field Ops Agent, job completions |
| `preference` | Invoice rounding rules, default payment terms, preferred communication channels | Copilot conversations, user settings |
| `compliance` | Certification expirations, vehicle maintenance schedules, regional codes | Compliance Agent |
| `supplier` | Preferred suppliers, pricing, lead times, vendor relationships | Inventory Agent |
| `certification` | Tech certifications, expiry dates, training history | Compliance Agent, profile data |
| `vehicle` | Fleet status, mileage, maintenance records | Compliance Agent, Fleetio |

### How It Is Queried

```typescript
// Query business context for an agent or copilot response
async function getBusinessContext(
  orgId: string,
  categories?: string[],
  keys?: string[]
): Promise<BusinessContext[]> {
  let query = 'SELECT * FROM business_context WHERE org_id = $1';
  const params: any[] = [orgId];

  if (categories) {
    query += ` AND category = ANY($${params.length + 1})`;
    params.push(categories);
  }

  if (keys) {
    query += ` AND key = ANY($${params.length + 1})`;
    params.push(keys);
  }

  query += ' ORDER BY confidence DESC, updated_at DESC LIMIT 50';

  const results = await db.query(query, params);
  return results.rows;
}
```

### Writing to the Business Context

```typescript
// Upsert a business context entry
async function upsertContext(
  orgId: string,
  category: string,
  key: string,
  value: any,
  confidence: number,
  source: string
): Promise<void> {
  await db.query(
    `INSERT INTO business_context (org_id, category, key, value, confidence, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (org_id, category, key)
     DO UPDATE SET
       value = $4,
       confidence = GREATEST(business_context.confidence, $5),
       source = $6,
       updated_at = NOW()`,
    [orgId, category, key, JSON.stringify(value), confidence, source]
  );
}
```

### Learning Over Time

The business context graph is CrewShift's core moat. Examples of what it learns:

- **Month 1:** "Average furnace install takes 6 hours and costs $3,200"
- **Month 3:** "Henderson always pays within 3 days. Johnson averages 45 days."
- **Month 6:** "Demand spikes 40% in October-November. Hire seasonal help."
- **Month 9:** "Copper pipe from Ferguson is $0.30/ft cheaper than Johnstone but takes 3 extra days."
- **Month 12:** "Owner prefers SMS for urgent items. Estimates rounded to nearest $50. Don't schedule Johnson jobs on Mondays."

---

## 11. Proactive Intelligence

### How Daily/Weekly Digests Are Generated

The copilot generates proactive intelligence via scheduled agent runs. These are not responses to user messages — they are initiated by the system.

```
Daily digest (7am local):
  1. Insights Agent runs scheduled analysis
  2. Collections Agent checks overdue invoices
  3. Compliance Agent scans for upcoming deadlines
  4. Inventory Agent checks low-stock items
  5. Results aggregated into a prioritized digest
  6. Delivered as in-app notification + optional push

Weekly digest (Monday 7am):
  1. Insights Agent generates weekly performance report
  2. Customer Agent identifies re-engagement opportunities
  3. Bookkeeping Agent provides financial summary
  4. Results aggregated into a comprehensive weekly brief
  5. Delivered as in-app notification + optional email
```

### What Triggers Proactive Messages

| Trigger | Agent | Example Message |
|---|---|---|
| Invoice overdue >3 days | Collections | "You have 3 invoices over 60 days. Want me to send final notices?" |
| Certification expiring <30 days | Compliance | "Mike's OSHA-10 certification expires in 2 weeks." |
| Demand forecast change | Insights | "Based on last year, you'll see a 40% demand increase next month." |
| Low inventory | Inventory | "Copper pipe inventory at 50 feet. You go through 200/week. Want me to reorder?" |
| Revenue anomaly | Insights | "Your average job margin dropped 8% this month — here's why." |
| Dormant customer | Customer | "3 customers haven't had service in 6+ months. Want to send re-engagement messages?" |
| Estimate follow-up | Customer | "Henderson hasn't responded to the estimate from 5 days ago. Want me to follow up?" |
| Payment pattern | Collections | "Based on payment history, $12,400 of outstanding AR is likely to pay within 7 days." |

### Digest Generation

```typescript
// Scheduled job: daily-digest (runs at 7am)

async function generateDailyDigest(orgId: string): Promise<void> {
  // Collect data from multiple sources
  const overdueInvoices = await invoiceRepo.findOverdue(orgId);
  const upcomingDeadlines = await contextRepo.findByCategory(orgId, 'compliance');
  const lowStockItems = await partsRepo.findLowStock(orgId);
  const pendingReviews = await executionRepo.findPending(orgId);

  // Only generate digest if there's something to report
  const hasContent = overdueInvoices.length > 0 ||
    upcomingDeadlines.length > 0 ||
    lowStockItems.length > 0 ||
    pendingReviews.length > 0;

  if (!hasContent) return;

  // Generate natural-language digest
  const digest = await aiClient.reason({
    prompt: `Generate a concise daily briefing for a ${org.trade_type} business owner.

Data:
- ${overdueInvoices.length} overdue invoices totaling $${sum(overdueInvoices, 'total')}
- ${upcomingDeadlines.length} compliance deadlines in the next 30 days
- ${lowStockItems.length} items at low stock
- ${pendingReviews.length} agent actions awaiting review

Generate a prioritized, actionable briefing. Lead with the most important item.
Keep it under 200 words. Use specific numbers.`,
    model_tier: 'fast',
  });

  // Deliver as in-app notification
  await notificationService.send({
    orgId,
    type: 'digest',
    title: 'Good morning. Here is your daily briefing.',
    body: digest,
    channel: 'in_app',
    metadata: {
      overdue_count: overdueInvoices.length,
      deadline_count: upcomingDeadlines.length,
      low_stock_count: lowStockItems.length,
      review_count: pendingReviews.length,
    },
  });
}
```

### Delivery Channels

| Digest Type | Default Channel | Optional Channels |
|---|---|---|
| Daily briefing | In-app notification | Push notification |
| Weekly report | In-app notification | Email |
| Urgent alerts | In-app + push | SMS (if configured) |
| Autonomy upgrade suggestions | In-app notification | None |

**Key design principle:** Curated, prioritized, actionable — not a firehose of alerts. Each proactive message should answer: "What do I need to know?" and "What should I do about it?"

---

## Cross-References

- **Agent runtime (how agents are executed):** See [06-agent-runtime.md](./06-agent-runtime.md)
- **Agent definitions (all 9 agents):** See [07-agent-definitions.md](./07-agent-definitions.md)
- **AI service (classification, reasoning, embeddings):** See [10-ai-service.md](./10-ai-service.md)
- **Realtime (SSE vs Supabase Realtime):** See [13-realtime.md](./13-realtime.md)
- **Queue system (scheduled digest jobs):** See [14-queue-system.md](./14-queue-system.md)
- **Notifications (delivery channels):** See [15-notifications.md](./15-notifications.md)
- **Database schema (conversations, messages, business_context, embeddings):** See [02-database-schema.md](./02-database-schema.md)
