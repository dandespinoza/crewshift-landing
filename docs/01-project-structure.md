# 01 - Project Structure

> **Permanent reference** for the complete directory tree, every file's purpose, the monorepo layout, and the relationship between the Node and Python services.
> Cross-references: [00-overview](./00-overview.md) | [02-database-schema](./02-database-schema.md) | [03-api-routes](./03-api-routes.md) | [04-api-standards](./04-api-standards.md)

---

## 1. Monorepo Layout

CrewShift uses a monorepo with two applications and one shared package:

```
crewshiftai/
├── apps/
│   ├── api/              # Node.js Fastify monolith (TypeScript)
│   └── ai-service/       # Python FastAPI AI service
├── packages/
│   └── shared/           # Shared types between Node + Python
├── docs/                 # Architecture documentation (this folder)
├── docker-compose.yml    # Local dev: Redis + services
├── .env.example          # Environment variable template
├── railway.toml          # Railway deployment config
└── README.md             # Project README
```

### Why This Layout

- **Two applications, not twenty.** A Node.js monolith handles all business logic (CRUD, integrations, agent orchestration, queues, auth, webhooks). A Python AI service handles all LLM/ML inference (reasoning, classification, transcription, vision, embeddings). This avoids premature microservice complexity while cleanly separating compute-heavy AI from I/O-heavy API work.
- **Shared types package.** Agent definition types, entity types (Job, Invoice, Customer), and AI request/response types are defined once in `packages/shared` and consumed by both services. The Node side uses TypeScript directly. The Python side uses these as reference documentation (Pydantic models mirror the TypeScript interfaces).
- **Docs live in the repo.** All architectural documentation lives in `docs/` and is version-controlled alongside the code. When the code changes, the docs can change in the same commit.

---

## 2. Relationship Between Node and Python Services

```
┌─────────────────────────────────┐       HTTP (internal)       ┌──────────────────────────┐
│        Node.js API              │ ────────────────────────────>│    Python AI Service     │
│        (Fastify)                │                              │    (FastAPI)             │
│                                 │                              │                          │
│  - Auth / RBAC / Validation     │ <────────────────────────────│  - LLM reasoning         │
│  - CRUD operations              │       JSON responses         │  - Intent classification │
│  - Integration adapters         │                              │  - Entity extraction     │
│  - Agent trigger / chain logic  │                              │  - Speech-to-text        │
│  - BullMQ job orchestration     │                              │  - Image analysis / OCR  │
│  - Webhook processing           │                              │  - Embedding generation  │
│  - Notifications (email/SMS)    │                              │  - Semantic search       │
│  - File storage (S3/R2)         │                              │  - Prompt management     │
│  - Realtime (Supabase)          │                              │  - Multi-provider routing│
└─────────────────────────────────┘                              └──────────────────────────┘
```

| Concern | Goes to Node API | Goes to Python AI Service |
|---|---|---|
| **LLM reasoning** (generate invoice content, estimate pricing) | | X |
| **Intent classification** (copilot message routing) | | X |
| **Entity extraction** from text | | X |
| **Speech-to-text** transcription | | X |
| **Image/photo analysis** (photo-to-estimate) | | X |
| **Embedding generation** | | X |
| **Semantic search** over embeddings | | X |
| **Prompt management** (versioned prompt templates) | | X |
| **Multi-provider routing + fallback** | | X |
| **CRUD operations** | X | |
| **Database queries** | X | |
| **Integration API calls** (QuickBooks, Stripe, etc.) | X | |
| **OAuth flows** | X | |
| **Webhook processing** | X | |
| **BullMQ job orchestration** | X | |
| **Notifications** (email/SMS) | X | |
| **File storage** (S3/R2) | X | |
| **Agent trigger/chain logic** | X | |

Communication is via internal HTTP. In production on Railway, the services communicate over Railway's private network. In local dev, both services run in Docker and communicate via container networking.

---

## 3. Complete Directory Tree

```
crewshiftai/
├── apps/
│   ├── api/                                    # Node.js Fastify monolith
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── config/
│   │   │   │   ├── env.ts
│   │   │   │   ├── supabase.ts
│   │   │   │   └── redis.ts
│   │   │   ├── routes/
│   │   │   │   ├── auth.routes.ts
│   │   │   │   ├── org.routes.ts
│   │   │   │   ├── agents.routes.ts
│   │   │   │   ├── integrations.routes.ts
│   │   │   │   ├── copilot.routes.ts
│   │   │   │   ├── jobs.routes.ts
│   │   │   │   ├── invoices.routes.ts
│   │   │   │   ├── estimates.routes.ts
│   │   │   │   ├── customers.routes.ts
│   │   │   │   ├── inventory.routes.ts
│   │   │   │   ├── dashboard.routes.ts
│   │   │   │   ├── workflows.routes.ts
│   │   │   │   ├── webhooks.routes.ts
│   │   │   │   ├── onboarding.routes.ts
│   │   │   │   ├── upload.routes.ts
│   │   │   │   └── notifications.routes.ts
│   │   │   ├── services/
│   │   │   │   ├── auth.service.ts
│   │   │   │   ├── org.service.ts
│   │   │   │   ├── copilot.service.ts
│   │   │   │   ├── dashboard.service.ts
│   │   │   │   └── workflow.service.ts
│   │   │   ├── agents/
│   │   │   │   ├── runtime.ts
│   │   │   │   ├── registry.ts
│   │   │   │   ├── event-bus.ts
│   │   │   │   ├── chain.ts
│   │   │   │   ├── review-queue.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── definitions/
│   │   │   │       ├── invoice.agent.ts
│   │   │   │       ├── estimate.agent.ts
│   │   │   │       ├── collections.agent.ts
│   │   │   │       ├── bookkeeping.agent.ts
│   │   │   │       ├── insights.agent.ts
│   │   │   │       ├── field-ops.agent.ts
│   │   │   │       ├── compliance.agent.ts
│   │   │   │       ├── inventory.agent.ts
│   │   │   │       └── customer.agent.ts
│   │   │   ├── integrations/
│   │   │   │   ├── adapter.interface.ts
│   │   │   │   ├── sync.service.ts
│   │   │   │   ├── oauth.service.ts
│   │   │   │   ├── webhook.processor.ts
│   │   │   │   └── adapters/
│   │   │   │       ├── quickbooks.adapter.ts
│   │   │   │       ├── stripe.adapter.ts
│   │   │   │       ├── google.adapter.ts
│   │   │   │       ├── twilio.adapter.ts
│   │   │   │       ├── jobber.adapter.ts
│   │   │   │       └── servicetitan.adapter.ts
│   │   │   ├── ai/
│   │   │   │   ├── ai-client.ts
│   │   │   │   └── types.ts
│   │   │   ├── notifications/
│   │   │   │   ├── email.service.ts
│   │   │   │   ├── sms.service.ts
│   │   │   │   └── push.service.ts
│   │   │   ├── queue/
│   │   │   │   ├── queues.ts
│   │   │   │   ├── workers/
│   │   │   │   │   ├── agent.worker.ts
│   │   │   │   │   ├── sync.worker.ts
│   │   │   │   │   ├── notification.worker.ts
│   │   │   │   │   ├── scheduled.worker.ts
│   │   │   │   │   └── pdf.worker.ts
│   │   │   │   ├── scheduled-jobs.ts
│   │   │   │   └── jobs.ts
│   │   │   ├── db/
│   │   │   │   ├── schema.ts
│   │   │   │   ├── migrations/
│   │   │   │   └── repositories/
│   │   │   │       ├── org.repo.ts
│   │   │   │       ├── agent.repo.ts
│   │   │   │       ├── job.repo.ts
│   │   │   │       ├── invoice.repo.ts
│   │   │   │       ├── estimate.repo.ts
│   │   │   │       ├── customer.repo.ts
│   │   │   │       └── integration.repo.ts
│   │   │   ├── middleware/
│   │   │   │   ├── auth.middleware.ts
│   │   │   │   ├── org.middleware.ts
│   │   │   │   ├── rbac.middleware.ts
│   │   │   │   └── rate-limit.ts
│   │   │   ├── templates/
│   │   │   │   ├── invoice.template.html
│   │   │   │   ├── estimate.template.html
│   │   │   │   └── styles.css
│   │   │   └── utils/
│   │   │       ├── errors.ts
│   │   │       ├── logger.ts
│   │   │       ├── validators.ts
│   │   │       ├── pagination.ts
│   │   │       └── response.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── Dockerfile
│   │
│   └── ai-service/                             # Python FastAPI AI service
│       ├── app/
│       │   ├── main.py
│       │   ├── config.py
│       │   ├── routers/
│       │   │   ├── reasoning.py
│       │   │   ├── classify.py
│       │   │   ├── transcribe.py
│       │   │   ├── vision.py
│       │   │   ├── embeddings.py
│       │   │   └── health.py
│       │   ├── providers/
│       │   │   ├── base.py
│       │   │   ├── router.py
│       │   │   ├── anthropic.py
│       │   │   ├── openai.py
│       │   │   ├── google.py
│       │   │   ├── deepgram.py
│       │   │   └── voyage.py
│       │   ├── prompts/
│       │   │   ├── invoice.py
│       │   │   ├── estimate.py
│       │   │   ├── collections.py
│       │   │   ├── copilot.py
│       │   │   ├── classify.py
│       │   │   └── extract.py
│       │   ├── memory/
│       │   │   ├── context.py
│       │   │   ├── short_term.py
│       │   │   ├── long_term.py
│       │   │   └── summarizer.py
│       │   └── models/
│       │       ├── requests.py
│       │       └── responses.py
│       ├── requirements.txt
│       ├── pyproject.toml
│       └── Dockerfile
│
├── packages/
│   └── shared/                                 # Shared types between Node + Python
│       ├── types/
│       │   ├── agent.types.ts
│       │   ├── entity.types.ts
│       │   └── ai.types.ts
│       └── package.json
│
├── docs/                                       # Architecture documentation
│   ├── 00-overview.md
│   ├── 01-project-structure.md
│   ├── 02-database-schema.md
│   ├── 03-api-routes.md
│   ├── 04-api-standards.md
│   ├── 05-security.md
│   ├── 06-agent-runtime.md
│   ├── 07-agent-definitions.md
│   ├── 08-copilot.md
│   ├── 09-integrations.md
│   ├── 10-ai-service.md
│   ├── 11-workflow-engine.md
│   ├── 12-file-storage.md
│   ├── 13-realtime.md
│   ├── 14-queue-system.md
│   ├── 15-notifications.md
│   ├── 16-onboarding.md
│   ├── 17-cost-tracking.md
│   ├── 18-observability.md
│   ├── 19-testing.md
│   ├── 20-data-pipeline.md
│   ├── 21-deployment.md
│   └── 22-error-handling.md
│
├── docker-compose.yml
├── .env.example
├── railway.toml
├── CrewShift_Complete_Project_Context.md
└── README.md
```

---

## 4. File-by-File Descriptions

### 4.1 `apps/api/src/` -- Node.js Fastify Monolith

#### Entry Point

| File | Description |
|---|---|
| `server.ts` | Fastify application setup. Registers all plugins (CORS, JWT, rate limiting), mounts all route prefixes, initializes Supabase and Redis connections, starts BullMQ workers, and listens on the configured port. This is the single entry point for the entire Node service. |

#### `config/` -- Configuration & Connections

| File | Description |
|---|---|
| `env.ts` | Environment variable validation using Zod. Defines a strict schema for every required env var (database URLs, API keys, service URLs, feature flags). Fails fast at startup if any variable is missing or malformed. Exports a typed `env` object used everywhere. |
| `supabase.ts` | Initializes and exports two Supabase clients: (1) an **anon client** for operations that respect RLS (used in request context with the user's JWT), and (2) a **service-role client** that bypasses RLS (used by BullMQ workers and internal operations). |
| `redis.ts` | Creates and exports the Redis connection (using `ioredis`). Configures connection pooling, reconnect strategy, and TLS for production. This single connection is shared by BullMQ queues, the rate limiter, and any caching. |

#### `routes/` -- Fastify Route Handlers

Route handlers are **thin**. They parse the request, call a service or repository, and return the response. No business logic lives in route files.

| File | Description |
|---|---|
| `auth.routes.ts` | Signup (create account + org), login, logout, token refresh, and `GET /me` (current user + org). Delegates to `auth.service.ts` for Supabase Auth operations. |
| `org.routes.ts` | Get org details, update org settings, list team members, invite team member, update member role, remove member. Protected by `requireRole('owner', 'admin')` for write operations. |
| `agents.routes.ts` | List all agents and their status, get/update agent config (enable/disable, autonomy rules), list agent execution history, get single execution detail, approve/reject pending actions, get the review queue. |
| `integrations.routes.ts` | List connected integrations, start OAuth flow (`GET /:provider/connect`), handle OAuth callback (`GET /:provider/callback`), trigger manual sync, disconnect integration. |
| `copilot.routes.ts` | Send message to copilot (`POST /message` -- the main AI interaction endpoint), list conversations, get conversation history, optional transcribe endpoint for voice input. The message endpoint returns a streaming SSE response. |
| `jobs.routes.ts` | Standard CRUD for jobs (list, get, create, update) plus `POST /:id/complete` which marks a job complete and fires the `job.completed` event on the event bus, triggering the agent chain. |
| `invoices.routes.ts` | CRUD for invoices plus `POST /:id/send` (send to customer) and `GET /:id/pdf` (download PDF). Creating an invoice can optionally trigger the Invoice Agent if `generated_by` is set to `'agent'`. |
| `estimates.routes.ts` | CRUD for estimates plus `POST /:id/send` (send to customer). Creating an estimate can optionally trigger the Estimate Agent. |
| `customers.routes.ts` | CRUD for customers. `GET /:id` returns the customer detail plus their full history (jobs, invoices, estimates, communications). |
| `inventory.routes.ts` | CRUD for parts plus `GET /low-stock` which returns all parts below their reorder point. |
| `dashboard.routes.ts` | Read-only endpoints: summary metrics (revenue, jobs, outstanding), recent agent activity, AI-generated insights, financial breakdown (revenue, margins, collections). |
| `workflows.routes.ts` | CRUD for custom workflows. Workflows define trigger conditions and step sequences that chain agents together. |
| `webhooks.routes.ts` | Inbound webhook handlers for external tools: QuickBooks, Stripe, Jobber, plus a generic `/:provider` handler. Each verifies the webhook signature, parses the payload, and dispatches events to the event bus. No auth middleware -- webhooks use signature verification instead. |
| `onboarding.routes.ts` | Get current onboarding state, mark a step complete, skip onboarding. Tracks the PLG onboarding flow (connect first tool, try first agent, etc.). |
| `upload.routes.ts` | Generate presigned S3/R2 upload URL (`POST /presign`), confirm upload and associate with a record (`POST /confirm`). Client uploads directly to S3 using the presigned URL. |
| `notifications.routes.ts` | List notifications, mark as read, mark all as read. Also exposes `GET /api/dashboard/usage` for current month usage and limits. |

#### `services/` -- Business Logic

Services contain framework-agnostic business logic. They are called by route handlers and queue workers.

| File | Description |
|---|---|
| `auth.service.ts` | Wraps Supabase Auth operations: signup (create user + create org + create profile), login, logout, token refresh. Adds `org_id` and `role` as custom JWT claims during signup/login via a Supabase Edge Function or database trigger. |
| `org.service.ts` | Organization management: update settings, list/invite/update/remove team members. Enforces that only owners can transfer ownership. Handles tier checks for feature gating. |
| `copilot.service.ts` | The copilot orchestration pipeline. Receives a user message, classifies intent (via Python AI service), routes to the appropriate agent(s), coordinates multi-agent dispatch, assembles the streaming response, and manages conversation state (create/update conversations and messages in the DB). |
| `dashboard.service.ts` | Aggregates data for dashboard endpoints: computes summary metrics (revenue this month, jobs completed, outstanding invoices), fetches recent agent activity from `agent_executions`, calls the Python AI service for AI-generated insights, and assembles financial breakdowns. |
| `workflow.service.ts` | Workflow CRUD plus workflow execution logic. Evaluates trigger conditions, executes step sequences, tracks execution state in `workflow_executions`, and handles conditional branching. |

#### `agents/` -- Agent Runtime Engine

This is the core of CrewShift. The agent runtime is a generic engine that executes agent definitions.

| File | Description |
|---|---|
| `runtime.ts` | The core agent execution engine. Receives an agent type and trigger context, looks up the agent definition from the registry, executes the step pipeline (gather data, call AI, validate, check autonomy, execute actions, chain), logs the execution in `agent_executions`, and returns the result. Handles errors, retries, and timeouts. |
| `registry.ts` | Maintains a map of all registered agent definitions. Loads definitions from the `definitions/` directory at startup. Provides lookup by agent type and by trigger event. |
| `event-bus.ts` | Simple in-process event emitter (Node.js `EventEmitter`). Events like `job.completed`, `invoice.created`, `invoice.overdue`, etc. are emitted here. The registry listens for events and dispatches matching agents via BullMQ. No Kafka needed at this scale. |
| `chain.ts` | Agent chaining logic. After an agent completes, checks its `chains` configuration and emits the appropriate events to trigger downstream agents. Handles chain cycles (prevents infinite loops via depth tracking). |
| `review-queue.ts` | Manages the human-in-the-loop review queue. When an agent's autonomy check produces a `review` or `escalate` result, the execution is placed in the review queue with status `awaiting_review`. Provides methods to list pending reviews, approve (which resumes execution), and reject (which cancels it). |
| `types.ts` | TypeScript interfaces for the agent system: `AgentDefinition`, `AgentTrigger`, `AgentStep`, `AgentInput`, `AgentOutput`, `AutonomyRules`, `ChainRule`, `AgentExecutionContext`, `AgentExecutionResult`. These are the contracts that every agent definition must satisfy. |

#### `agents/definitions/` -- Individual Agent Configurations

Each file exports a single `AgentDefinition` object. They are declarative configurations, not code.

| File | Description |
|---|---|
| `invoice.agent.ts` | Invoice Agent definition. Triggers on `job.completed` and `create-invoice` intent. Steps: gather job/customer data, call AI to generate line items and amounts, validate totals, check autonomy (review if > $500 or confidence < 0.9), create invoice in DB, sync to QuickBooks, generate PDF, notify user. Chains to collections and bookkeeping agents. |
| `estimate.agent.ts` | Estimate Agent definition. Triggers on `estimate.requested` and photo upload events. Steps: gather customer/job scope data, call AI with photos for vision analysis, generate estimate with local pricing from business context, validate against historical data, check autonomy, create estimate, generate PDF. |
| `collections.agent.ts` | Collections Agent definition. Triggers on `invoice.created` (starts monitoring), `invoice.overdue` (send follow-up), and scheduled cron (daily check). Steps: check invoice age, determine escalation level, generate follow-up message with appropriate tone, check lien filing deadlines, send via email/SMS, update invoice status. |
| `bookkeeping.agent.ts` | Bookkeeping Agent definition. Triggers on `invoice.created`, `invoice.paid`, and `job.completed`. Steps: categorize revenue/expenses by type, match with connected accounting software categories, flag anomalies (unusual amounts, missing data), prepare accounting entries, sync to QuickBooks/Xero. |
| `insights.agent.ts` | Insights Agent definition. Triggers on schedule (daily/weekly cron). Steps: aggregate recent business data, call AI for analysis (margin trends, pricing recommendations, demand forecasts), compare against historical patterns, generate actionable insights, deliver as notifications/digest. |
| `field-ops.agent.ts` | Field Ops Agent definition. Triggers on `job.scheduled`, `job.rescheduled`, and schedule optimization cron. Steps: load tech availability/skills/locations, evaluate scheduling constraints, optimize route/assignment, communicate changes to field teams, update job assignments. |
| `compliance.agent.ts` | Compliance Agent definition. Triggers on `compliance.deadline` events and daily cron. Steps: scan all tracked deadlines (vehicle maintenance, certifications, insurance, permits), check against current date, generate alerts for upcoming expirations, create compliance reports, notify responsible parties. |
| `inventory.agent.ts` | Inventory Agent definition. Triggers on `job.completed` (deduct parts used), `inventory.low_stock` (reorder alert), and scheduled cron (reconciliation). Steps: deduct used materials from stock, check against reorder points, compare supplier pricing, generate purchase orders, notify for low stock. |
| `customer.agent.ts` | Customer Agent definition. Triggers on `job.completed` (send completion message, queue review request), `customer.lead.inbound` (respond to lead), and various scheduled crons (follow-up sequences, re-engagement). Steps: determine communication type, generate personalized message, send via appropriate channel (email/SMS), update customer record, manage review request timing. |

#### `integrations/` -- Integration Adapter Layer

| File | Description |
|---|---|
| `adapter.interface.ts` | The base `IntegrationAdapter` interface that all adapters implement. Defines the contract: `getAuthUrl()`, `handleCallback()`, `refreshToken()`, `syncCustomers()`, `syncJobs()`, `syncInvoices()`, `createInvoice()`, `updateJobStatus()`, `sendPayment()`, `verifyWebhook()`, `processWebhook()`. This abstraction means the agent runtime never knows which external tool it is talking to. |
| `sync.service.ts` | Orchestrates data synchronization between external tools and CrewShift's unified data model. Handles initial full sync (on first connection), incremental sync (periodic polling for changes), and real-time sync (webhook-triggered). Maps external data to the unified model using the adapter's transform methods. Manages conflict resolution (last-write-wins with external system as authority). |
| `oauth.service.ts` | Generic OAuth2 flow handler. Generates authorization URLs with the correct scopes per provider, handles the callback (exchange code for tokens), encrypts and stores tokens in the `integrations` table, and handles token refresh when tokens expire. |
| `webhook.processor.ts` | Processes inbound webhooks from external tools. Verifies signatures, parses payloads into normalized events, and dispatches them to the event bus. Handles deduplication (prevents processing the same webhook twice) and dead-letter logging for unprocessable webhooks. |

#### `integrations/adapters/` -- Individual Adapters

| File | Description |
|---|---|
| `quickbooks.adapter.ts` | QuickBooks Online adapter. OAuth2 with Intuit's API. Syncs customers, invoices, payments, and chart of accounts. Write-back creates invoices and records payments in QBO. Handles QBO's specific data format quirks (line items, tax codes, account references). |
| `stripe.adapter.ts` | Stripe adapter. API key auth (not OAuth). Creates payment links for invoices, processes payment webhooks (payment_intent.succeeded), records payments. Used by the Collections Agent for payment link generation. |
| `google.adapter.ts` | Google Workspace adapter. OAuth2 with Google's API. Syncs calendar events (for scheduling), sends emails (via Gmail API for Customer Agent), and reads contacts. |
| `twilio.adapter.ts` | Twilio adapter. API key auth. Sends SMS messages for the Customer Agent (appointment confirmations, review requests, follow-ups). Receives inbound SMS via webhook. |
| `jobber.adapter.ts` | Jobber adapter. OAuth2 via Jobber's partner API. Syncs jobs, customers, scheduling, quotes, and invoices. Bidirectional: updates job status in Jobber when completed in CrewShift, pulls new jobs from Jobber into the unified model. |
| `servicetitan.adapter.ts` | ServiceTitan adapter. Partner API (requires approval from ServiceTitan). Syncs jobs, customers, technicians, invoices, and estimates. The most complex adapter due to ServiceTitan's data model depth and the partner approval process. |

#### `ai/` -- AI Service Client

| File | Description |
|---|---|
| `ai-client.ts` | HTTP client that calls the Python AI service. Wraps all AI service endpoints (`/ai/reason`, `/ai/classify`, `/ai/extract`, `/ai/transcribe`, `/ai/vision`, `/ai/embed`, `/ai/search`). Implements a circuit breaker (using the `opossum` library) so that if the AI service is down, CRUD operations continue working and AI-dependent features degrade gracefully. |
| `types.ts` | TypeScript interfaces for AI service request/response payloads: `ReasonRequest`, `ReasonResponse`, `ClassifyRequest`, `ClassifyResponse`, `TranscribeRequest`, `EmbedRequest`, `SearchRequest`, etc. These mirror the Pydantic models in the Python service. |

#### `notifications/` -- Notification Services

| File | Description |
|---|---|
| `email.service.ts` | Email sending via Resend (or SendGrid as fallback). Supports templated emails (invoice sent, review request, digest) and plain-text emails. Handles email delivery status tracking. |
| `sms.service.ts` | SMS sending via Twilio. Formats messages for SMS length limits. Used by the Customer Agent for appointment confirmations, ETAs, review requests, and follow-up sequences. |
| `push.service.ts` | Web push notification service. Sends real-time in-app notifications to the dashboard (agent action completed, review needed, alert). Uses Supabase Realtime as the delivery mechanism. |

#### `queue/` -- BullMQ Job Queue

| File | Description |
|---|---|
| `queues.ts` | Defines all BullMQ queue instances and their retry/backoff configurations. Four queues: `agent-execution` (3 retries, exponential backoff from 2s), `integration-sync` (5 retries, exponential from 5s), `notification` (3 retries, fixed 1s), `scheduled` (2 retries, fixed 60s). Also configures job retention (completed jobs kept 24h, failed jobs kept 7 days). |
| `jobs.ts` | TypeScript type definitions for all job payloads: `AgentExecutionJob`, `IntegrationSyncJob`, `NotificationJob`, `ScheduledJob`, `PDFGenerationJob`. These are the contracts between job producers (route handlers, event bus) and job consumers (workers). |
| `scheduled-jobs.ts` | Cron job definitions. Registers repeatable jobs in BullMQ: daily collections check (9 AM), daily compliance scan, weekly insights generation, periodic integration sync (every 15 minutes for polling-based integrations), daily digest generation. |

#### `queue/workers/` -- Job Processors

| File | Description |
|---|---|
| `agent.worker.ts` | Processes agent execution jobs. Receives the agent type and trigger context from the queue, calls `runtime.ts` to execute the agent pipeline, and handles the result (success, review needed, or failure). This is where agent execution actually happens -- the event bus and route handlers just enqueue jobs here. |
| `sync.worker.ts` | Processes integration sync jobs. Calls the appropriate adapter's sync methods (syncCustomers, syncJobs, syncInvoices), transforms external data to the unified model, and upserts into the database. Handles rate limiting against external APIs. |
| `notification.worker.ts` | Processes notification jobs. Routes to the correct channel (email, SMS, push, in-app) based on the notification type and user preferences. Creates the notification record in the `notifications` table. |
| `scheduled.worker.ts` | Processes scheduled/cron jobs. Dispatches to the appropriate handler based on the job type (daily collections check, compliance scan, digest generation, etc.). |
| `pdf.worker.ts` | Generates PDFs from HTML templates using Puppeteer. Receives a template name, data payload, and output path. Renders the HTML template with the data, converts to PDF via headless Chromium, uploads to S3/R2, and returns the URL. Used for invoice and estimate PDFs. |

#### `db/` -- Database Layer

| File | Description |
|---|---|
| `schema.ts` | Drizzle ORM schema definitions. Defines every database table as a Drizzle table object with typed columns. This is the single source of truth for the database schema in the Node.js codebase. Generates TypeScript types for all entities. |
| `migrations/` | SQL migration files. Each migration is a plain `.sql` file with `-- up` and `-- down` sections. Applied via Drizzle Kit. Migrations are version-controlled and applied in order. |

#### `db/repositories/` -- Data Access Layer

Repositories encapsulate all database queries. They enforce multi-tenancy by always including `org_id` in WHERE clauses (critical for service-role queries that bypass RLS).

| File | Description |
|---|---|
| `org.repo.ts` | Organization and profile queries: get org by ID, update org settings, list profiles by org, create/update/delete profiles. |
| `agent.repo.ts` | Agent config and execution queries: get/update agent configs by org, create/list/update agent executions, get review queue items, check idempotency keys. |
| `job.repo.ts` | Job CRUD queries with pagination, filtering by status/customer/tech/date range, and full-text search on description. |
| `invoice.repo.ts` | Invoice CRUD queries with pagination, filtering by status/customer/due date, full-text search on invoice number and customer name. |
| `estimate.repo.ts` | Estimate CRUD queries with pagination, filtering by status/customer, full-text search. |
| `customer.repo.ts` | Customer CRUD queries with pagination, full-text search on name/email/phone. `getCustomerWithHistory()` joins jobs, invoices, and estimates for the customer detail view. |
| `integration.repo.ts` | Integration queries: get by org, get by provider, create/update/delete. Handles encryption/decryption of OAuth tokens via pgcrypto at the query level (tokens are encrypted in the database, decrypted only when needed). |

#### `middleware/` -- Request Processing Middleware

| File | Description |
|---|---|
| `auth.middleware.ts` | JWT verification middleware. Extracts the Bearer token from the Authorization header, verifies it locally using the Supabase JWT secret (no API call per request), and injects `userId`, `orgId`, and `role` into the Fastify request object from the JWT custom claims. Returns 401 if the token is missing or invalid. |
| `org.middleware.ts` | Multi-tenant organization scoping middleware. Verifies that `orgId` is present in the request (set by auth middleware). This ensures every authenticated request is scoped to an organization. No separate DB lookup needed because `org_id` comes from the JWT. |
| `rbac.middleware.ts` | Role-based access control middleware factory. `requireRole('owner', 'admin')` returns a middleware that checks the request's `role` against the allowed roles. Returns 403 if the user's role is not in the allowed list. Four roles: `owner`, `admin`, `member`, `tech`. |
| `rate-limit.ts` | Redis-based sliding window rate limiter. Different limits per route category: auth routes (10/min), copilot messages (30/min), CRUD operations (100/min), webhooks (500/min). Returns 429 with `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers. |

#### `templates/` -- Document Templates

| File | Description |
|---|---|
| `invoice.template.html` | HTML template for invoice PDFs. Includes company branding, customer details, line items table, subtotal/tax/total, payment terms, and notes. Data is injected via template variables. Rendered by Puppeteer in the PDF worker. |
| `estimate.template.html` | HTML template for estimate PDFs. Similar structure to invoice template but includes scope description, validity date, confidence score (optional), and acceptance instructions. |
| `styles.css` | Shared CSS for PDF templates. Print-optimized styles, page break handling, table formatting, and brand color variables. |

#### `utils/` -- Utility Functions

| File | Description |
|---|---|
| `errors.ts` | Custom error classes: `AppError` (base), `ValidationError` (400), `AuthError` (401), `ForbiddenError` (403), `NotFoundError` (404), `ConflictError` (409), `RateLimitError` (429). Each carries an HTTP status code and a machine-readable error code. The global error handler in `server.ts` catches these and formats them into the standard error response envelope. |
| `logger.ts` | Pino structured logging configuration. Logs JSON in production, pretty-prints in development. Includes request ID, org ID, and user ID in every log line. Log level configurable via `LOG_LEVEL` env var. |
| `validators.ts` | Zod schemas for request body validation. Shared validation schemas for common patterns (UUID, email, phone, pagination params, date ranges). Route-specific schemas are defined in or alongside their route files. |
| `pagination.ts` | Cursor-based pagination helpers. `encodeCursor(row)` takes a row and returns a base64-encoded cursor string. `decodeCursor(cursor)` decodes it back. `applyPagination(query, params)` adds the WHERE/ORDER BY/LIMIT clauses to a Drizzle query based on the pagination parameters. |
| `response.ts` | Standard API response envelope helpers. `success(data, meta?)` wraps data in `{ data, meta }`. `error(code, message, details?)` wraps errors in `{ error: { code, message, details } }`. Every route handler uses these to ensure consistent response shapes. |

---

### 4.2 `apps/ai-service/` -- Python FastAPI AI Service

#### Entry Point & Config

| File | Description |
|---|---|
| `app/main.py` | FastAPI application setup. Registers all routers (reasoning, classify, transcribe, vision, embeddings, health), configures CORS (only accepts requests from the Node API), initializes the provider router, and sets up structured logging. |
| `app/config.py` | Environment configuration and model routing config. Loads API keys for all providers (Anthropic, OpenAI, Google, Deepgram, Voyage) from environment variables. Defines which model to use for each task type (reasoning, classification, vision, etc.) and the fallback order. |

#### `routers/` -- API Endpoints

| File | Description |
|---|---|
| `reasoning.py` | `POST /ai/reason` -- Full LLM reasoning endpoint. Receives a prompt, system message, context data, and optional tool definitions. Routes to Claude Sonnet (primary) or GPT-5.2 (fallback). Returns structured JSON output matching the requested output schema. Used by all agent reasoning steps. |
| `classify.py` | `POST /ai/classify` -- Intent classification endpoint. Receives user text and a list of possible intents/categories. Uses a fast model (GPT-5 Nano or Gemini Flash-Lite) for sub-500ms classification. Returns the top intent with confidence score. Used by the copilot to route messages to the correct agent. Also exposes `POST /ai/extract` for entity extraction from text. |
| `transcribe.py` | `POST /ai/transcribe` -- Speech-to-text endpoint. Receives audio data (file upload or URL), transcribes via Deepgram Nova-3 (primary) or OpenAI Transcribe (fallback). Returns the transcript text. Optional copilot feature for voice input. |
| `vision.py` | `POST /ai/vision` -- Image analysis endpoint. Receives image data (URL or base64), analyzes via Gemini 2.5 Flash Vision (primary) or Claude Sonnet Vision (fallback). Used by the Estimate Agent for photo-to-estimate (identify materials, scope, damage) and by the Bookkeeping Agent for receipt scanning. |
| `embeddings.py` | `POST /ai/embed` -- Generate embeddings for text. Uses Voyage-finance-2 (1024 dimensions). Stores vectors in pgvector via the Node API. `POST /ai/search` -- Semantic search over stored embeddings. Returns the top-k most similar results. Used by the copilot for long-term business memory queries. |
| `health.py` | `GET /ai/health` -- Health check endpoint. Returns provider availability status (which providers are reachable), model versions, and uptime. Used by the Node API's circuit breaker to determine if the AI service is healthy. |

#### `providers/` -- Multi-Provider Abstraction

| File | Description |
|---|---|
| `base.py` | Abstract base class `AIProvider` that defines the interface all providers must implement: `reason()`, `classify()`, `embed()`, `transcribe()`, `analyze_image()`. Each method has standardized input/output types. |
| `router.py` | `ProviderRouter` class that routes requests to the best provider based on task type and configuration. Implements the fallback chain: try primary provider, on failure try fallback, log which provider was used, latency, tokens consumed, and estimated cost. |
| `anthropic.py` | Claude provider implementation. Wraps the Anthropic Python SDK. Implements `reason()` using Claude Sonnet/Opus with structured output, `classify()` for intent classification, and `analyze_image()` for vision tasks. Handles Claude-specific features (tool use, JSON mode). |
| `openai.py` | GPT provider implementation. Wraps the OpenAI Python SDK. Implements all provider methods using GPT-5.2 (reasoning), GPT-5 Nano (classification), and OpenAI Transcribe (speech-to-text). |
| `google.py` | Gemini provider implementation. Wraps the Google AI Python SDK. Implements `reason()` with Gemini, `classify()` with Gemini Flash-Lite, `analyze_image()` with Gemini 2.5 Flash Vision, and `embed()` with Gemini-embedding-001 as fallback. |
| `deepgram.py` | Deepgram provider implementation. Implements `transcribe()` using Deepgram Nova-3. Optimized for noisy audio environments (job sites, truck cabs). |
| `voyage.py` | Voyage provider implementation. Implements `embed()` using Voyage-finance-2 for 1024-dimension business document embeddings. |

#### `prompts/` -- Prompt Templates

All prompts are version-controlled Python files, not stored in the database. This ensures prompts are reviewed in PRs and tied to specific code versions.

| File | Description |
|---|---|
| `invoice.py` | Prompt template for invoice generation. System prompt establishes the agent's role as an invoice specialist for trade businesses. Includes examples of good invoice line items, pricing conventions, and tax handling. Expects job data, customer data, and org preferences as context. Outputs structured JSON (line items, subtotal, tax, total, notes). |
| `estimate.py` | Prompt template for estimate generation. Handles three modes: standard estimate, change order, and formal proposal. Includes instructions for interpreting photos (if vision data is provided), using historical pricing, and calculating materials + labor. |
| `collections.py` | Prompt template for collections follow-up message generation. Includes escalation tiers (friendly reminder, firm follow-up, final notice), tone guidelines, and lien deadline awareness. |
| `copilot.py` | System prompt for the AI copilot. Establishes the copilot's role as an operations coordinator for a trade business. Includes the business context graph, available agent capabilities, and response formatting rules. |
| `classify.py` | Prompt template for intent classification. Defines all possible intents (create-invoice, check-status, generate-estimate, schedule-job, etc.) with example phrases for each. Used by the fast classification model. |
| `extract.py` | Prompt template for entity extraction. Extracts structured data from natural language (customer names, job descriptions, amounts, dates, part names, quantities). |

#### `memory/` -- Conversation Memory Management

| File | Description |
|---|---|
| `context.py` | Business context graph builder. Assembles the full business context for a copilot message or agent execution: org info, team data, connected integrations, recent activity, relevant business_context rows, and customer history. This is what makes the AI "know" the business. |
| `short_term.py` | Short-term memory manager. Loads the last N messages from the current conversation for in-context injection into the LLM prompt. Manages token budgets to avoid exceeding context limits. |
| `long_term.py` | Long-term memory manager. Queries the embeddings table (pgvector) for semantically relevant past interactions, jobs, invoices, and customer data. Returns the top-k results ranked by relevance to the current query. |
| `summarizer.py` | Conversation summarizer. When a conversation exceeds a token threshold, generates a summary of the older messages and stores it in the `conversations.summary` field. The summary replaces the full message history in future context injection, keeping token usage manageable. |

#### `models/` -- Pydantic Models

| File | Description |
|---|---|
| `requests.py` | Pydantic models for all AI service request payloads: `ReasonRequest`, `ClassifyRequest`, `ExtractRequest`, `TranscribeRequest`, `VisionRequest`, `EmbedRequest`, `SearchRequest`. These define the exact shape of data the Node API must send. |
| `responses.py` | Pydantic models for all AI service response payloads: `ReasonResponse`, `ClassifyResponse`, `ExtractResponse`, `TranscribeResponse`, `VisionResponse`, `EmbedResponse`, `SearchResponse`. These define the exact shape of data returned to the Node API. |

---

### 4.3 `packages/shared/` -- Shared Types

| File | Description |
|---|---|
| `types/agent.types.ts` | TypeScript interfaces for the agent system shared between Node and Python: `AgentDefinition`, `AgentTrigger`, `AgentStep`, `AutonomyRules`, `AgentExecutionStatus`. The Python service uses these as reference documentation; its Pydantic models mirror these interfaces. |
| `types/entity.types.ts` | Unified data model types shared across the system: `Organization`, `Profile`, `Customer`, `Job`, `Invoice`, `Estimate`, `Part`, `Integration`. These represent the canonical shape of each entity as stored in the database and returned by the API. |
| `types/ai.types.ts` | AI request/response types shared between the Node API client and the Python service: `ReasonRequest`, `ClassifyRequest`, `CopilotMessage`, `CopilotResponse`, `EmbedRequest`, `SearchResult`. |
| `package.json` | Package manifest for the shared types package. No runtime dependencies -- this package is types-only. Published locally within the monorepo and consumed by `apps/api` via workspace references. |

---

### 4.4 Root-Level Files

| File | Description |
|---|---|
| `docker-compose.yml` | Local development Docker Compose configuration. Runs Redis (for BullMQ), the Python AI service, and the Node API. The Node API depends on both Redis and the AI service. All services share the `.env` file. Supabase runs as a hosted service (not in Docker). |
| `.env.example` | Template for all required environment variables: app config (NODE_ENV, PORT), Supabase credentials, Redis URL, AI service URL, AI provider API keys (Anthropic, OpenAI, Google, Deepgram, Voyage), integration credentials (QuickBooks, Stripe, Google, Twilio), storage config (S3), and notification config (Resend). |
| `railway.toml` | Railway deployment configuration. Defines two services: `api` (Node.js, builds from `apps/api/Dockerfile`) and `ai-service` (Python, builds from `apps/ai-service/Dockerfile`). Configures Railway's managed Redis addon. Sets up private networking between services. |
| `README.md` | Project README with setup instructions, architecture overview, and links to documentation. |

---

## 5. Key Directory Explanations

### `routes/` -- Thin HTTP Handlers

Route files are the API surface. They define HTTP method, path, validation schema, middleware chain, and response. They do NOT contain business logic. Every route handler follows this pattern:

1. Validate request body/params (Zod schema)
2. Call a service or repository method
3. Return the result wrapped in the standard response envelope

This keeps route files short (< 100 lines each) and makes business logic testable without HTTP.

### `services/` -- Framework-Agnostic Business Logic

Services contain the "how" of operations. They are called by route handlers AND by queue workers. Because they do not depend on Fastify, they can be tested in isolation and reused across different entry points (HTTP request, background job, event handler).

### `agents/` -- The Core Product

This directory IS CrewShift. The runtime engine, event bus, and agent definitions together implement the "AI agents that run your business" value proposition. Understanding this directory is essential:

- `runtime.ts` is the execution engine (start here)
- `registry.ts` maps events to agents
- `event-bus.ts` is how agents get triggered
- `definitions/` contains the 9 agent configurations
- `chain.ts` is how agents trigger other agents

### `integrations/` -- The Connection Layer

This directory implements Layer 1 of the product ("Connect Everything"). The adapter interface ensures all external tools look the same to the rest of the system. Adding a new integration means implementing one adapter file -- nothing else changes.

### `queue/` -- Background Processing

All long-running work goes through BullMQ queues. Agent executions, integration syncs, PDF generation, and scheduled jobs are all queue-based. This ensures the API responds quickly (enqueue and return) while heavy work happens in the background with retry and error handling.

### `db/` -- Data Access

The schema file is the source of truth. Repositories enforce multi-tenancy. Migrations track schema changes. The repository pattern isolates all SQL from the rest of the codebase, making it possible to change the ORM or database without touching business logic.

### `middleware/` -- Request Pipeline

Every authenticated request passes through: `auth.middleware` (verify JWT, extract user/org/role) -> `org.middleware` (ensure org context) -> `rbac.middleware` (check role permissions) -> `rate-limit` (enforce rate limits). This chain runs before every route handler.

---

## 6. File Naming Conventions

| Pattern | Example | Used For |
|---|---|---|
| `*.routes.ts` | `invoices.routes.ts` | HTTP route handlers |
| `*.service.ts` | `copilot.service.ts` | Business logic services |
| `*.repo.ts` | `invoice.repo.ts` | Database repository (data access) |
| `*.agent.ts` | `invoice.agent.ts` | Agent definition files |
| `*.adapter.ts` | `quickbooks.adapter.ts` | Integration adapters |
| `*.worker.ts` | `agent.worker.ts` | BullMQ job processors |
| `*.middleware.ts` | `auth.middleware.ts` | Fastify middleware |
| `*.types.ts` | `agent.types.ts` | TypeScript type definitions |
| `*.template.html` | `invoice.template.html` | PDF document templates |
| `*.py` (routers/) | `reasoning.py` | FastAPI router endpoints |
| `*.py` (providers/) | `anthropic.py` | AI provider implementations |
| `*.py` (prompts/) | `invoice.py` | Versioned prompt templates |
| `*.py` (models/) | `requests.py` | Pydantic data models |

All file names use **kebab-case** for multi-word names (e.g., `field-ops.agent.ts`, `event-bus.ts`, `ai-client.ts`, `short_term.py`). Python files use **snake_case** per Python convention. TypeScript files use **kebab-case** per Node.js convention.
