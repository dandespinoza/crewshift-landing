# 13 — Real-time Architecture

> CrewShift has two completely separate real-time systems: **Supabase Realtime** for database change notifications (dashboard updates, notification bell, job status) and **Server-Sent Events (SSE)** for copilot response streaming (LLM token-by-token output). These systems serve different purposes, use different technologies, and should never be confused.

**Cross-references:** [02-database-schema.md](./02-database-schema.md) (tables with Realtime enabled), [05-security.md](./05-security.md) (RLS policies that scope Realtime subscriptions), [08-copilot.md](./08-copilot.md) (SSE streaming for copilot responses), [06-agent-runtime.md](./06-agent-runtime.md) (agent executions pushed via Realtime)

---

## Table of Contents

1. [Two Systems Overview](#two-systems-overview)
2. [Supabase Realtime Setup](#supabase-realtime-setup)
3. [Channel Architecture](#channel-architecture)
4. [RLS + Realtime](#rls--realtime)
5. [Frontend Subscription Code](#frontend-subscription-code)
6. [What Gets Pushed in Real-time](#what-gets-pushed-in-real-time)
7. [SSE for Copilot Streaming](#sse-for-copilot-streaming)
8. [Connection Management](#connection-management)
9. [Performance and Limits](#performance-and-limits)
10. [Decision Rationale](#decision-rationale)

---

## Two Systems Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Browser)                        │
│                                                                  │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐ │
│  │   SUPABASE REALTIME      │  │   SSE (Server-Sent Events)   │ │
│  │                          │  │                              │ │
│  │   Persistent WebSocket   │  │   Per-request HTTP stream    │ │
│  │   to Supabase            │  │   to Node API                │ │
│  │                          │  │                              │ │
│  │   Listens for:           │  │   Used for:                  │ │
│  │   - DB row changes       │  │   - Copilot response tokens  │ │
│  │   - agent_executions     │  │   - Status updates           │ │
│  │   - notifications        │  │   - Agent dispatch progress  │ │
│  │   - invoices             │  │                              │ │
│  │   - jobs                 │  │   Lifecycle:                 │ │
│  │   - messages             │  │   Open → stream → close      │ │
│  │                          │  │   (one per copilot message)  │ │
│  │   Lifecycle:             │  │                              │ │
│  │   Open on login,         │  │                              │ │
│  │   close on logout        │  │                              │ │
│  └──────────────────────────┘  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
         │                                │
         │ WebSocket                      │ HTTP (SSE)
         ▼                                ▼
┌──────────────────┐            ┌──────────────────┐
│ Supabase         │            │ Node.js Fastify   │
│ (PostgreSQL +    │            │ API Server         │
│  Realtime server)│            │                    │
└──────────────────┘            └──────────────────┘
```

**Key difference:**

| Aspect | Supabase Realtime | SSE (Copilot) |
|---|---|---|
| Transport | WebSocket (persistent) | HTTP SSE (per-request) |
| Data source | PostgreSQL row changes (INSERT/UPDATE/DELETE) | Node API streamed response |
| Connection lifetime | App session (login to logout) | Single copilot message (seconds) |
| Direction | Supabase server to frontend | Node API to frontend |
| Authentication | Supabase JWT (automatic with client SDK) | Bearer token (same auth as REST API) |
| Use case | Dashboard updates, notifications, entity status changes | LLM token streaming, copilot interaction |

---

## Supabase Realtime Setup

### Which Tables Have Realtime Enabled

Realtime must be explicitly enabled per table in the Supabase dashboard (or via SQL). Not all tables need Realtime — only tables whose changes should be immediately visible in the frontend.

| Table | Realtime Enabled | Events | Why |
|---|---|---|---|
| `agent_executions` | Yes | INSERT, UPDATE | Dashboard activity feed shows agent actions in real-time. Status changes (running -> completed) update the UI immediately. |
| `notifications` | Yes | INSERT | In-app notification bell. New notifications appear instantly without polling. |
| `invoices` | Yes | UPDATE | Invoice status changes (draft -> sent -> paid) update the dashboard invoice list. |
| `jobs` | Yes | UPDATE | Job status changes (scheduled -> in_progress -> completed) update the dashboard and field view. |
| `messages` | Yes | INSERT | New copilot messages from the assistant (for non-streamed content like final saved messages). |
| `workflow_executions` | Yes | INSERT, UPDATE | Workflow status tracking in the dashboard. |

**Tables NOT enabled for Realtime:**

| Table | Why Not |
|---|---|
| `organizations` | Rarely changes. Polling on org settings page is sufficient. |
| `profiles` | Team changes are infrequent. Not worth the Realtime overhead. |
| `customers` | Customer list changes are not time-critical. Dashboard refreshes on navigation. |
| `estimates` | Similar to invoices but less frequent. Could enable later if needed. |
| `parts` | Inventory changes are not real-time critical for the dashboard. |
| `integrations` | Connection status changes are rare. Polling is fine. |
| `business_context` | Internal AI data. No frontend subscription needed. |
| `embeddings` | Vector data. No frontend subscription needed. |
| `conversations` | Messages table handles conversation updates. |
| `workflows` | Workflow definitions change infrequently (CRUD operations). |

### Enabling Realtime in Supabase

**Via Supabase Dashboard:**
1. Go to Database > Replication
2. Under "Supabase Realtime," enable the tables listed above
3. For each table, select which events to broadcast (INSERT, UPDATE, DELETE)

**Via SQL (alternative):**
```sql
-- Enable Realtime for specific tables
-- This is done via Supabase's replication publication
ALTER PUBLICATION supabase_realtime ADD TABLE agent_executions;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE invoices;
ALTER PUBLICATION supabase_realtime ADD TABLE jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE workflow_executions;
```

**Important:** Supabase Realtime sends the **full row** on every change by default. For tables with large JSONB columns (like `agent_executions.output_data`), this can be bandwidth-heavy. Supabase supports column filtering to send only specific columns — configure this if bandwidth becomes an issue:

```typescript
// Frontend: subscribe only to specific columns
supabase.channel('agent-activity')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'agent_executions',
    filter: `org_id=eq.${orgId}`,
    // Supabase v2+ supports column selection in the subscription
  }, handleExecution)
  .subscribe();
```

---

## Channel Architecture

Supabase Realtime uses channels to organize subscriptions. Each channel is a logical grouping of listeners. CrewShift uses three channel patterns:

### 1. Organization Channel: `org:{org_id}`

The primary channel for dashboard updates. Every authenticated user in the org subscribes to this channel.

**Subscriptions:**
- `agent_executions` INSERT/UPDATE — activity feed
- `invoices` UPDATE — invoice status changes
- `jobs` UPDATE — job status changes
- `workflow_executions` INSERT/UPDATE — workflow progress

```typescript
// Frontend: subscribe to org-wide updates
const orgChannel = supabase.channel(`org:${orgId}`);

orgChannel
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'agent_executions',
    filter: `org_id=eq.${orgId}`,
  }, (payload) => {
    // payload.eventType: 'INSERT' | 'UPDATE' | 'DELETE'
    // payload.new: the new row data
    // payload.old: the old row data (for UPDATE/DELETE)
    handleAgentExecution(payload);
  })
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'invoices',
    filter: `org_id=eq.${orgId}`,
  }, (payload) => {
    handleInvoiceUpdate(payload);
  })
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'jobs',
    filter: `org_id=eq.${orgId}`,
  }, (payload) => {
    handleJobUpdate(payload);
  })
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'workflow_executions',
    filter: `org_id=eq.${orgId}`,
  }, (payload) => {
    handleWorkflowUpdate(payload);
  })
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log('Connected to org channel');
    }
  });
```

### 2. User Channel: `user:{user_id}`

Per-user channel for notifications. Each user subscribes to their own channel for the notification bell.

**Subscriptions:**
- `notifications` INSERT — new notifications for this user

```typescript
// Frontend: subscribe to user-specific notifications
const userChannel = supabase.channel(`user:${userId}`);

userChannel
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'notifications',
    filter: `user_id=eq.${userId}`,
  }, (payload) => {
    const notification = payload.new;
    // Show notification toast
    showNotificationToast(notification.title, notification.body);
    // Update notification bell count
    incrementUnreadCount();
  })
  .subscribe();
```

### 3. Conversation Channel: `conversation:{conversation_id}`

Per-conversation channel for the copilot UI. Subscribed when a user opens a conversation.

**Subscriptions:**
- `messages` INSERT — new messages in this conversation (for non-streamed content)

```typescript
// Frontend: subscribe to copilot conversation updates
const conversationChannel = supabase.channel(`conversation:${conversationId}`);

conversationChannel
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'messages',
    filter: `conversation_id=eq.${conversationId}`,
  }, (payload) => {
    const message = payload.new;
    // Only add to UI if it's not already displayed via SSE streaming
    if (!displayedMessageIds.has(message.id)) {
      addMessageToConversation(message);
    }
  })
  .subscribe();
```

**Why subscribe to messages via Realtime if we also have SSE?**

Because not all messages come through SSE:
- When a copilot message is sent and the response is streamed via SSE, the frontend displays the response in real-time as tokens arrive. The final message is saved to the DB, but the UI already has it.
- When a message is added by a background process (e.g., a proactive insight from the Insights Agent, or a workflow notification routed to the conversation), it's inserted into the `messages` table directly. There's no active SSE connection — Realtime delivers it.
- Multi-device: if the contractor has the dashboard open on their phone and laptop, a message streamed via SSE on the phone also appears on the laptop via Realtime.

---

## RLS + Realtime

Supabase Realtime **automatically respects Row-Level Security policies**. This is a critical security feature — it means a client can subscribe to `agent_executions` changes, but they will ONLY receive rows where `org_id` matches their JWT's `org_id` claim.

### How It Works

1. Client authenticates with Supabase using their JWT (which contains `org_id` as a custom claim)
2. Client subscribes to a channel with a filter (`org_id=eq.${orgId}`)
3. When a row is inserted/updated in `agent_executions`, Supabase checks:
   - Does the RLS policy for this table allow this user to SELECT this row?
   - Does the subscription filter match?
4. Only if BOTH checks pass does the client receive the event

### RLS Policies (applied to Realtime-enabled tables)

```sql
-- These are the same RLS policies from 05-security.md.
-- They're repeated here because they directly affect what Realtime delivers.

-- agent_executions
CREATE POLICY "org_isolation_select" ON agent_executions
  FOR SELECT USING (org_id = auth.org_id());

-- notifications
CREATE POLICY "user_notifications_select" ON notifications
  FOR SELECT USING (
    org_id = auth.org_id()
    AND (user_id = auth.uid() OR user_id IS NULL)  -- user-specific OR org-wide
  );

-- invoices
CREATE POLICY "org_isolation_select" ON invoices
  FOR SELECT USING (org_id = auth.org_id());

-- jobs
CREATE POLICY "org_isolation_select" ON jobs
  FOR SELECT USING (org_id = auth.org_id());

-- messages
CREATE POLICY "conversation_messages_select" ON messages
  FOR SELECT USING (
    org_id = auth.org_id()
    AND conversation_id IN (
      SELECT id FROM conversations WHERE user_id = auth.uid()
    )
  );
```

**Security guarantee:** Even if a malicious client subscribes to `org_id=eq.<someone-else's-org>`, they will receive zero events because the RLS policy checks the JWT's `org_id` claim, not the subscription filter. The filter is an optimization (reduces server-side broadcast), not a security boundary — RLS is the security boundary.

### Service-Role Writes

When BullMQ workers (running server-side with the service-role key) insert/update Realtime-enabled tables, those changes ARE broadcast to subscribed clients. The service-role key bypasses RLS for writes, but the clients' RLS policies still control which clients receive the broadcast.

```
Worker (service-role) → INSERT INTO agent_executions (org_id = 'org_123', ...)
                              │
                              ▼
                    Supabase Realtime broadcasts to all subscribed clients
                              │
                    ┌─────────┴──────────┐
                    │                    │
            Client A (org_123)    Client B (org_456)
            RLS: org_id match     RLS: org_id mismatch
            → RECEIVES event      → DOES NOT receive event
```

---

## Frontend Subscription Code

### Complete Dashboard Subscription Setup

```typescript
// hooks/useRealtimeSubscriptions.ts
import { useEffect, useRef } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAgentStore } from '@/stores/agentStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useJobStore } from '@/stores/jobStore';
import { useInvoiceStore } from '@/stores/invoiceStore';

export function useRealtimeSubscriptions() {
  const { user, orgId } = useAuth();
  const channels = useRef<RealtimeChannel[]>([]);

  // Agent execution store actions
  const { addExecution, updateExecution } = useAgentStore();
  const { addNotification, incrementUnread } = useNotificationStore();
  const { updateJob } = useJobStore();
  const { updateInvoice } = useInvoiceStore();

  useEffect(() => {
    if (!user || !orgId) return;

    // --- ORG CHANNEL ---
    const orgChannel = supabase
      .channel(`org:${orgId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'agent_executions',
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          addExecution(payload.new);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'agent_executions',
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          updateExecution(payload.new.id, payload.new);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'invoices',
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          updateInvoice(payload.new.id, payload.new);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          updateJob(payload.new.id, payload.new);
        },
      )
      .subscribe();

    channels.current.push(orgChannel);

    // --- USER CHANNEL ---
    const userChannel = supabase
      .channel(`user:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          addNotification(payload.new);
          incrementUnread();

          // Browser notification (if permission granted)
          if (Notification.permission === 'granted') {
            new Notification(payload.new.title, {
              body: payload.new.body,
              icon: '/icon-192.png',
            });
          }
        },
      )
      .subscribe();

    channels.current.push(userChannel);

    // --- CLEANUP ---
    return () => {
      channels.current.forEach((channel) => {
        supabase.removeChannel(channel);
      });
      channels.current = [];
    };
  }, [user, orgId]);
}
```

### Dashboard Activity Feed Handler

```typescript
// The activity feed shows a real-time stream of agent actions.
// Each agent_execution INSERT becomes a card in the feed.

function handleAgentExecution(execution: AgentExecution) {
  const activityItem = {
    id: execution.id,
    type: execution.agent_type,
    status: execution.status,
    title: formatExecutionTitle(execution),
    description: formatExecutionDescription(execution),
    timestamp: execution.created_at,
    actions_taken: execution.actions_taken,
    confidence: execution.confidence_score,
    needs_review: execution.status === 'awaiting_review',
  };

  // Add to the top of the activity feed (most recent first)
  activityStore.prepend(activityItem);

  // If it needs review, also add to the review queue badge
  if (execution.status === 'awaiting_review') {
    reviewQueueStore.increment();
  }
}

function formatExecutionTitle(exec: AgentExecution): string {
  const titles: Record<string, string> = {
    invoice: 'Invoice Agent',
    estimate: 'Estimate Agent',
    collections: 'Collections Agent',
    bookkeeping: 'Bookkeeping Agent',
    insights: 'Insights Agent',
    'field-ops': 'Field Ops Agent',
    compliance: 'Compliance Agent',
    inventory: 'Inventory Agent',
    customer: 'Customer Agent',
  };
  return `${titles[exec.agent_type] || exec.agent_type} — ${exec.status}`;
}
```

---

## What Gets Pushed in Real-time

### agent_executions: INSERT / UPDATE

**Trigger:** Agent runtime creates or updates an execution record.

**Data pushed:** Full `agent_executions` row including:
- `agent_type`, `trigger_type`, `status`
- `actions_taken` (JSONB array of what the agent did)
- `confidence_score`
- `error` (if failed)
- `duration_ms`

**Frontend action:** Activity feed card appears/updates. Review queue badge updates if `status = 'awaiting_review'`.

**Example payload:**
```json
{
  "eventType": "INSERT",
  "new": {
    "id": "exec-uuid",
    "org_id": "org-uuid",
    "agent_type": "invoice",
    "trigger_type": "event",
    "status": "completed",
    "actions_taken": [
      { "type": "create_invoice", "target": "invoices", "data": { "invoice_number": "1247", "total": 1840 } },
      { "type": "sync_quickbooks", "target": "quickbooks", "data": { "qb_id": "123" } }
    ],
    "confidence_score": 0.94,
    "ai_model_used": "claude-sonnet-4-6",
    "duration_ms": 3400,
    "created_at": "2026-03-04T15:30:00Z"
  }
}
```

### notifications: INSERT

**Trigger:** Any system component inserts a notification (agent completion, review needed, alert, digest).

**Data pushed:** Full `notifications` row.

**Frontend action:** Notification bell count increments. Toast notification shown. Browser notification if permitted.

**Example payload:**
```json
{
  "eventType": "INSERT",
  "new": {
    "id": "notif-uuid",
    "org_id": "org-uuid",
    "user_id": "user-uuid",
    "type": "agent_action",
    "title": "Invoice #1247 created",
    "body": "Invoice for Henderson — $1,840. Synced to QuickBooks.",
    "channel": "in_app",
    "read": false,
    "action_url": "/invoices/inv-uuid",
    "created_at": "2026-03-04T15:30:01Z"
  }
}
```

### invoices: UPDATE (status changes)

**Trigger:** Invoice status changes (draft -> sent, sent -> paid, sent -> overdue, etc.)

**Data pushed:** Updated `invoices` row.

**Frontend action:** Invoice list and dashboard metrics update. Invoice card status badge changes color/text.

### jobs: UPDATE (status changes)

**Trigger:** Job status changes (pending -> scheduled, scheduled -> in_progress, in_progress -> completed).

**Data pushed:** Updated `jobs` row.

**Frontend action:** Job board updates. Dashboard metrics (active jobs count) update. Field view shows real-time job progress.

### messages: INSERT (copilot conversation)

**Trigger:** New message saved to a conversation (either user message or saved assistant response).

**Data pushed:** Full `messages` row.

**Frontend action:** Message appears in the copilot conversation UI. Used primarily for multi-device sync (the primary device gets the message via SSE, other devices get it via Realtime).

---

## SSE for Copilot Streaming

The copilot uses Server-Sent Events to stream LLM responses token-by-token to the frontend. This is completely separate from Supabase Realtime.

### How It Works

```
Frontend                          Node.js API                      Python AI Service
  │                                    │                                │
  │ POST /api/copilot/message         │                                │
  │ { conversation_id, content }      │                                │
  ├───────────────────────────────────▶│                                │
  │                                    │                                │
  │ ◀── SSE: event: status            │                                │
  │     data: "Classifying..."        │                                │
  │                                    │ POST /ai/classify             │
  │                                    ├───────────────────────────────▶│
  │                                    │◀──────────────────────────────┤
  │                                    │ { intent, entities }          │
  │ ◀── SSE: event: status            │                                │
  │     data: "Dispatching agents..." │                                │
  │                                    │                                │
  │                                    │ [dispatches agents via BullMQ] │
  │                                    │                                │
  │ ◀── SSE: event: agent_result      │                                │
  │     data: { agent: "invoice",     │                                │
  │             result: {...} }       │                                │
  │                                    │                                │
  │                                    │ POST /ai/reason (stream=true) │
  │                                    ├───────────────────────────────▶│
  │ ◀── SSE: event: token             │◀──────── streaming tokens ────┤
  │     data: "Invoice"               │                                │
  │ ◀── SSE: event: token             │                                │
  │     data: " #1247"                │                                │
  │ ◀── SSE: event: token             │                                │
  │     data: " generated"            │                                │
  │     ...                            │                                │
  │                                    │                                │
  │ ◀── SSE: event: done              │                                │
  │     data: {                        │                                │
  │       message_id: "uuid",         │                                │
  │       agents_dispatched: [...],    │                                │
  │       execution_ids: [...],        │                                │
  │       actions_taken: [...]         │                                │
  │     }                              │                                │
  │                                    │                                │
  │ [Connection closes]                │                                │
```

### SSE Event Types

| Event | Data | Purpose |
|---|---|---|
| `status` | `{ text: "Classifying your request..." }` | Progress indicator during processing phases |
| `agent_result` | `{ agent: "invoice", status: "completed", result: {...} }` | Agent execution result (before response synthesis) |
| `token` | `"Invoice"` | Single token from LLM response stream |
| `done` | `{ message_id, agents_dispatched, execution_ids, actions_taken, follow_up_suggestions }` | Final event — response is complete |
| `error` | `{ code: "AI_UNAVAILABLE", message: "..." }` | Error during processing |

### Node.js Implementation

```typescript
// routes/copilot.routes.ts
app.post('/api/copilot/message', {
  preHandler: [authMiddleware],
}, async (request, reply) => {
  const { conversation_id, content } = request.body;
  const orgId = request.orgId;
  const userId = request.userId;

  // Set SSE headers
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering (Railway uses nginx)
  });

  // Helper to send SSE events
  const sendEvent = (event: string, data: any) => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Save user message to DB
    const userMessage = await saveMessage(conversation_id, orgId, 'user', content);

    // --- Phase 1: Classify intent ---
    sendEvent('status', { text: 'Classifying your request...' });
    const classification = await aiClient.classify({
      text: content,
      categories: INTENT_CATEGORIES,
      org_id: orgId,
    });

    // --- Phase 2: Dispatch agents ---
    if (classification.intent !== 'general-question') {
      sendEvent('status', { text: `Dispatching ${formatAgentName(classification.intent)}...` });

      const agentResults = await dispatchAgents(classification, orgId, content);

      // Send each agent result as it completes
      for (const result of agentResults) {
        sendEvent('agent_result', {
          agent: result.agent_type,
          status: result.status,
          result: result.output_data,
        });
      }
    }

    // --- Phase 3: Generate response (streamed) ---
    sendEvent('status', { text: 'Generating response...' });

    const context = await buildCopilotContext(orgId, conversation_id, classification);

    // Stream tokens from AI service
    const stream = await aiClient.reasonStream({
      prompt_template: 'copilot',
      variables: context,
      org_id: orgId,
    });

    let fullResponse = '';
    for await (const token of stream) {
      sendEvent('token', token);
      fullResponse += token;
    }

    // Save assistant message to DB
    const assistantMessage = await saveMessage(
      conversation_id, orgId, 'assistant', fullResponse,
      { intent: classification.intent, agents_dispatched: classification.agents }
    );

    // --- Phase 4: Done ---
    sendEvent('done', {
      message_id: assistantMessage.id,
      agents_dispatched: classification.agents || [],
      execution_ids: [], // populated from agent dispatch results
      actions_taken: [], // populated from agent dispatch results
      follow_up_suggestions: generateFollowUpSuggestions(classification, fullResponse),
    });

  } catch (error) {
    sendEvent('error', {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message || 'Something went wrong',
    });
  } finally {
    reply.raw.end();
  }
});
```

### Frontend SSE Consumer

```typescript
// hooks/useCopilotMessage.ts
async function sendCopilotMessage(conversationId: string, content: string) {
  const response = await fetch('/api/copilot/message', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ conversation_id: conversationId, content }),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events from buffer
    const events = buffer.split('\n\n');
    buffer = events.pop() || ''; // Keep incomplete event in buffer

    for (const eventStr of events) {
      if (!eventStr.trim()) continue;

      const lines = eventStr.split('\n');
      let eventType = '';
      let eventData = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7);
        } else if (line.startsWith('data: ')) {
          eventData = line.slice(6);
        }
      }

      const data = JSON.parse(eventData);

      switch (eventType) {
        case 'status':
          setStatusMessage(data.text);
          break;
        case 'agent_result':
          addAgentResult(data);
          break;
        case 'token':
          appendToken(data); // Append to streaming response display
          break;
        case 'done':
          finalizeResponse(data);
          setStatusMessage(null);
          break;
        case 'error':
          setError(data.message);
          break;
      }
    }
  }
}
```

---

## Connection Management

### Supabase Realtime: Reconnection

Supabase's client SDK handles reconnection automatically. When the WebSocket connection drops (network change, server restart, etc.), the SDK:

1. Detects the disconnection
2. Waits with exponential backoff (1s, 2s, 4s, 8s, up to 30s)
3. Reconnects and re-subscribes to all channels
4. Resumes receiving events

**What happens during disconnection?**

Events that occur while disconnected are missed. Supabase Realtime does not queue/buffer events. The frontend should:

1. When the connection state changes to `SUBSCRIBED` after a reconnect, **refetch current data** from the REST API to catch up on any missed events.
2. Display a "Reconnecting..." indicator in the UI.

```typescript
// Handle connection state changes
orgChannel.subscribe((status, error) => {
  switch (status) {
    case 'SUBSCRIBED':
      setConnectionStatus('connected');
      // Refetch current data to catch missed events
      refetchDashboardData();
      break;
    case 'CHANNEL_ERROR':
      setConnectionStatus('error');
      console.error('Realtime channel error:', error);
      break;
    case 'TIMED_OUT':
      setConnectionStatus('reconnecting');
      break;
    case 'CLOSED':
      setConnectionStatus('disconnected');
      break;
  }
});
```

### SSE: Connection Drop During Copilot Streaming

If the network drops mid-copilot-stream, the SSE connection breaks and the response is incomplete. The frontend should:

1. Detect the connection close (ReadableStream ends without a `done` event)
2. Show the partial response with a "Response interrupted — tap to retry" indicator
3. On retry, resend the original message (the backend is stateless per request)

```typescript
// Detect interrupted stream
try {
  await readSSEStream(response);
} catch (error) {
  if (error.name === 'TypeError' && error.message.includes('network')) {
    // Network error during stream
    setStreamStatus('interrupted');
    showRetryButton();
  }
}
```

### Supabase Realtime: Cleanup on Logout

When the user logs out, all Realtime channels must be unsubscribed to prevent memory leaks and unnecessary connections:

```typescript
function handleLogout() {
  // Remove all Realtime channels
  supabase.removeAllChannels();
  // Sign out from Supabase Auth
  supabase.auth.signOut();
}
```

---

## Performance and Limits

### Supabase Realtime Limits

| Metric | Free Plan | Pro Plan | Business Plan |
|---|---|---|---|
| Concurrent connections | 200 | 500 | 10,000 |
| Messages per second (broadcast) | 100 | 500 | 2,500 |
| Channels per client | 100 | 100 | 100 |
| Max message size | 1 MB | 1 MB | 1 MB |

**CrewShift usage estimates:**

- **Connections:** Each logged-in user = 1 WebSocket connection. A 15-tech org with 3 dashboard users = 3 connections. 1,000 orgs with 3 users each = 3,000 connections. Fits within Pro plan.
- **Messages/second:** Agent executions are the highest-frequency event. During a busy period, 10 agents executing per second across all orgs = ~10 messages/second. Well within limits.
- **Channels:** Each user subscribes to 2-3 channels (org, user, conversation). Well within the 100 limit.

### Optimization Strategies

**1. Filter subscriptions server-side:**
Use the `filter` parameter on subscriptions so Supabase only sends events matching the org/user ID. Without filters, Supabase broadcasts to all subscribers and each client filters locally — wasteful.

**2. Debounce rapid updates:**
If an agent execution is updated multiple times in quick succession (running -> completed in 2 seconds), the frontend may receive both events. Use a debounce/throttle on UI updates:

```typescript
// Debounce agent execution updates to avoid UI flicker
const debouncedUpdate = debounce((execution) => {
  updateExecutionInStore(execution);
}, 300);
```

**3. Unsubscribe from inactive channels:**
When the user navigates away from the copilot, unsubscribe from the conversation channel. When they navigate back, resubscribe.

**4. Don't subscribe to tables you don't need:**
Only enable Realtime on tables that genuinely need instant updates. Adding Realtime to the `customers` table would generate events on every customer update across all orgs, even though no dashboard component needs instant customer updates.

---

## Decision Rationale

| Decision | Choice | Alternatives Considered | Why |
|---|---|---|---|
| Two separate systems | Supabase Realtime + SSE | WebSockets for everything, SSE for everything, Pusher, Ably | Supabase Realtime is free with our Supabase plan and handles DB changes natively. SSE is simpler than WebSockets for one-directional streaming (copilot). Using one system for both would require awkward workarounds. |
| Supabase Realtime for DB changes | Built-in PostgreSQL change detection | Custom WebSocket server, polling, pg_notify + custom layer | Supabase Realtime is zero-additional-infrastructure (comes with Supabase). It automatically integrates with RLS for security. Building a custom WebSocket server adds operational complexity for the same result. |
| SSE for copilot (not WebSockets) | Server-Sent Events | WebSockets, long polling, Supabase Realtime broadcast | SSE is simpler for the copilot use case (server-to-client only, one message at a time). WebSockets are bidirectional but we don't need client-to-server streaming. SSE works natively with HTTP/2 and doesn't require a persistent connection manager. |
| RLS as security boundary | RLS policies on all Realtime tables | Application-level filtering, per-org channels with auth tokens | RLS is enforced at the database level — it's impossible to bypass from the client. Application-level filtering can have bugs. Per-org channels with tokens are manageable but add a custom auth layer on top of what Supabase already provides. |
| Refetch on reconnect | REST API call after reconnect | Event replay buffer, catch-up queries | Supabase Realtime doesn't buffer missed events. The simplest reliable approach is to refetch current state via the REST API after reconnection. An event replay buffer would require custom infrastructure. |
| Selective Realtime enablement | Only 6 tables enabled | Enable on all tables | Every enabled table adds load to the Supabase Realtime server. Most tables don't need instant updates. Selective enablement keeps the system lean and within Realtime plan limits. |
