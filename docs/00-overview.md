# 00 - CrewShift Project Overview

> **Permanent reference** for what CrewShift is, the technology choices behind it, the AI model strategy, the agent roster, and how every architectural piece fits together.
> Cross-references: [01-project-structure](./01-project-structure.md) | [02-database-schema](./02-database-schema.md) | [03-api-routes](./03-api-routes.md) | [04-api-standards](./04-api-standards.md)

---

## 1. What CrewShift Is

CrewShift is an **AI operations platform** purpose-built for the trades industry ($650B+ market, 3.7 million US businesses). It deploys pre-built, autonomous AI agents into every function of a trades business: back office, field operations, customer-facing work, and sales.

### What CrewShift Is NOT

| Misconception | Reality |
|---|---|
| A voice app / AI receptionist | The copilot accepts text or optional voice input, but CrewShift is an **operations platform**, not a phone-answering tool. Companies like Avoca, PSAI, and ServiceAgent handle inbound calls. CrewShift handles the entire back office. |
| A field service management (FSM) platform | CrewShift does **not replace** Jobber, ServiceTitan, or Housecall Pro. It sits on top of them as an intelligence layer. It reads from and writes to every connected tool. |
| A SaaS tool with AI features bolted on | CrewShift is an **AI-first** platform. The agents are the product. The dashboard, copilot, and workflow builder exist to control, observe, and extend the agents. |
| A chatbot | The AI copilot is an **operations coordinator** that speaks English. It dispatches agents, coordinates multi-agent workflows, and maintains a persistent business knowledge model. It is not a Q&A bot. |

### The Core Value Proposition

> "Why pay $45K/year for one back-office person when you can deploy an AI team for $299/month?"

The contractor connects their existing tools (Jobber, ServiceTitan, QuickBooks, etc.), selects the agents they need (like hiring staff), and within days has an AI-powered operations team running autonomously on top of their existing stack. The platform learns more about their specific business over time, getting smarter every month.

Not enough agents? Build your own -- describe what you want to the AI copilot or use the visual workflow builder. CrewShift is both the team and the tools to make more.

---

## 2. The Three-Layer Architecture

### Layer 1 -- Connect Everything

The contractor signs up and connects their existing tools. CrewShift becomes the intelligence layer sitting on top of all of them. It reads from and writes to every connected tool. It does NOT replace any software. This is the foundation.

Integrations include: ServiceTitan, Jobber, Housecall Pro, FieldEdge, BuildOps, Service Fusion, QuickBooks Online, QuickBooks Desktop, Xero, Sage Intacct, Stripe, Square, PayPal, Google Workspace, Microsoft 365, Twilio, Podium, Gusto/ADP, and more.

### Layer 2 -- Pre-Built Agents That Just Work

Out of the box, the contractor gets 9 agents already trained on trade workflows. They deploy immediately with zero configuration. Flip them on and they start working -- monitoring connected tools, taking action, producing outputs. "It works day one" promise.

### Layer 3 -- The Brain (Dashboard + AI Copilot + Workflow Builder)

Three interfaces working together:

- **Dashboard:** Visual control center -- see what agents are doing, review outputs, check metrics, analyze every part of the business at a glance.
- **AI Copilot:** Talk to CrewShift like you would talk to your office admin/operations coordinator. Text or voice. "Did the Johnson invoice go out?" "What's outstanding over 30 days?" "Build me a workflow that sends a review request 24 hours after every completed job."
- **Workflow Builder:** Build custom automations visually or describe them to the AI. Pre-built agents not enough? Create your own. The AI translates natural language descriptions into working workflows.

The AI copilot ties all agents together. The contractor does not jump between 20 dashboards -- they just talk to their "office."

**Critical: It learns over time.** Month 1 it is good. Month 6 it knows the business better than a new hire ever would -- pricing patterns, customer behaviors, tech performance, seasonal trends, vendor relationships, everything.

---

## 3. Tech Stack

| Layer | Choice | Reasoning |
|---|---|---|
| **API Server** | Node.js + TypeScript (Fastify) | Fastify is the fastest Node HTTP framework. TypeScript gives compile-time safety across the entire API surface. The Node ecosystem has mature libraries for every integration (QuickBooks, Stripe, Twilio, etc.). Fastify's plugin system maps cleanly to a modular monolith. |
| **AI Service** | Python (FastAPI) -- separate service | Python owns the AI/ML ecosystem. Every LLM SDK (Anthropic, OpenAI, Google), every embedding library (Voyage, sentence-transformers), every vision tool, and every NLP utility is Python-first. FastAPI provides async performance, automatic OpenAPI docs, and Pydantic validation. Keeping AI in a separate service means the Node API never blocks on long LLM calls and each service can scale independently. |
| **Database** | Supabase (PostgreSQL + Auth + Realtime) | PostgreSQL is the most capable open-source relational DB. Supabase adds managed Auth (JWT + OAuth flows), Row-Level Security for multi-tenancy, Realtime subscriptions (push agent activity to dashboards), and the pgvector extension for semantic search. One platform replaces 4-5 separate services. |
| **ORM** | Drizzle ORM | Type-safe SQL. Generates TypeScript types from the schema. Lightweight, no magic. Produces readable SQL. Migrations are plain SQL files. |
| **Task Queue** | BullMQ + Redis | Agent executions, integration syncs, PDF generation, and scheduled jobs all need reliable background processing with retry, backoff, and dead-letter handling. BullMQ is the production standard for Node.js queues. Redis provides the backing store and also handles rate limiting and caching. |
| **Hosting** | Railway | Simple Docker-based deployment. Supports multiple services (Node API + Python AI service) on the same project with private networking. Managed Redis addon. Environment variable management. Automatic deploys from GitHub. No DevOps overhead for a small team. |
| **API Style** | REST | REST is universally understood. Every integration partner, every frontend framework, every mobile client speaks REST. GraphQL adds complexity without proportional benefit for this domain. The API is internal (CrewShift frontend only), not a public developer platform -- REST is simpler to build, debug, and maintain. |
| **Architecture** | Monolith-first (2 services) | A Node.js monolith handles all business logic, CRUD, integrations, agent orchestration, and queue processing. A Python AI service handles all LLM/ML inference. Two services, not twenty. This avoids premature microservice complexity while cleanly separating the compute-heavy AI workload from the I/O-heavy API workload. |
| **File Storage** | AWS S3 / Cloudflare R2 | PDF invoices, estimates, job photos, and uploaded documents need durable object storage. S3 is the standard. R2 is a cost-effective alternative with S3-compatible API and zero egress fees. |
| **Notifications** | Resend (email), Twilio (SMS), Web Push | Resend provides a modern email API with React email templates. Twilio is the standard for SMS. Web push covers in-app notifications. |
| **Logging** | Pino | Structured JSON logging. Fastest Node.js logger. Compatible with Railway's log drain, Datadog, and every observability platform. |

---

## 4. AI Model Strategy

Multi-provider with automatic fallback. An abstraction layer in the Python AI service routes each request to the best provider for the task. If the primary provider is down or slow, the system falls back to the next provider transparently.

| Function | Primary | Fallback | Self-Hosted (Phase 2) | Reasoning |
|---|---|---|---|---|
| **Agent reasoning** | Claude Sonnet 4.6 | GPT-5.2 | DeepSeek V3.2 | Agent reasoning requires strong instruction-following, structured output, and long-context handling. Claude Sonnet is the best balance of capability and cost. GPT-5.2 as fallback ensures no single-provider dependency. DeepSeek V3.2 for high-volume self-hosted inference in Phase 2. |
| **Complex reasoning** | Claude Opus 4.6 | GPT-5.2 | -- | Complex tasks like multi-step estimates, business analysis, and workflow generation need the strongest available model. Opus 4.6 leads on nuanced reasoning. |
| **Fast routing / classification** | GPT-5 Nano | Gemini Flash-Lite | SetFit / Semantic Router | Intent classification must be sub-500ms. These nano models are optimized for speed and cost. Self-hosted SetFit or Semantic Router eliminates API latency entirely for the most common classification tasks. |
| **Speech-to-text** | Deepgram Nova-3 | OpenAI Transcribe | Distil-Whisper | Optional copilot voice input. Deepgram Nova-3 excels at noisy environments (job sites, truck cabs). Fallback to OpenAI Transcribe. Self-hosted Distil-Whisper for cost reduction at volume. |
| **Vision / OCR** | Gemini 2.5 Flash Vision | Claude Sonnet Vision | PaddleOCR-VL-1.5 | Photo-to-estimate and receipt scanning. Gemini 2.5 Flash Vision offers the best price-to-performance for visual tasks. Claude Vision as fallback for complex scene understanding. |
| **Embeddings** | Voyage-finance-2 | Gemini-embedding-001 | BGE-M3 / nomic-embed | Business data embeddings for semantic search in the copilot. Voyage-finance-2 is optimized for financial/business document similarity. 1024-dimension vectors stored in pgvector. |
| **Document generation** | Template engine (React-PDF / Puppeteer) | -- | -- | Invoice and estimate PDFs are generated from HTML templates via Puppeteer, not by an LLM. Deterministic, fast, and pixel-perfect. The LLM generates the content (line items, amounts); the template engine renders the PDF. |

**Self-hosted models are only for high-volume tasks in Phase 2.** Commercial APIs handle everything in Phase 1. The abstraction layer means swapping providers requires zero changes to the Node API or agent definitions.

---

## 5. Architecture Diagram

```
                           CLIENTS
                    (Web App / Mobile App)
                             |
                             | HTTPS (REST)
                             |
                    +--------v--------+
                    |                 |
                    |   Node.js API   |     Fastify monolith
                    |   (TypeScript)  |     Port 3000
                    |                 |
                    +-+--+--+--+--+--+
                      |  |  |  |  |
          +-----------+  |  |  |  +------------+
          |              |  |  |               |
    +-----v-----+  +----v--v--v----+   +-------v-------+
    |           |  |               |   |               |
    |  Supabase |  |    Redis      |   | Python AI Svc |
    |  (PgSQL)  |  |   (BullMQ)   |   |   (FastAPI)   |
    |           |  |               |   |   Port 8000   |
    |  - Auth   |  |  - Job Queue  |   |               |
    |  - RLS    |  |  - Rate Limit |   |  - Reasoning  |
    |  - Realtime| |  - Cache      |   |  - Classify   |
    |  - pgvector| |               |   |  - Transcribe |
    |           |  |               |   |  - Vision     |
    +-----------+  +---------------+   |  - Embeddings |
                                       |               |
                                       +---+---+---+---+
                                           |   |   |
                                    +------+   |   +------+
                                    |          |          |
                               +----v---+ +---v----+ +---v-----+
                               |Anthropic| | OpenAI | | Google  |
                               |  (Claude)| | (GPT) | | (Gemini)|
                               +---------+ +--------+ +---------+

    External Integrations (bidirectional via adapter layer):
    +----------+ +---------+ +--------+ +--------+ +--------+
    |QuickBooks| | Stripe  | | Jobber | | Twilio | | Google |
    |          | |         | |        | |        | | Wkspace|
    +----------+ +---------+ +--------+ +--------+ +--------+
```

### Data Flow Summary

1. **Client** sends REST request to the **Node.js API**.
2. **Node API** handles auth (JWT verification), RBAC, validation, and CRUD against **Supabase PostgreSQL**.
3. When AI reasoning is needed (agent execution, copilot message, classification), the Node API dispatches a request to the **Python AI Service** via internal HTTP.
4. The **Python AI Service** routes the request to the best LLM provider (Claude, GPT, Gemini) based on task type, with automatic fallback.
5. Background work (agent executions, integration syncs, PDF generation, scheduled jobs) flows through **BullMQ** queues backed by **Redis**.
6. **Integration adapters** in the Node API handle bidirectional sync with external tools (QuickBooks, Stripe, Jobber, etc.) via their APIs.
7. **Supabase Realtime** pushes live updates (agent activity, notifications) to connected clients. RLS ensures tenants only see their own data.

---

## 6. The 9-Agent Roster

### Money & Admin (Back Office)

| # | Agent | One-Line Description |
|---|---|---|
| 1 | **Invoice Agent** | Transforms job completion data into professional invoices with line items, labor, materials, and tax, then sends to customers and syncs with QuickBooks/Xero. |
| 2 | **Estimate Agent** | Generates detailed estimates from photos and scope descriptions using local pricing and historical job data, plus handles change orders and formal proposals. |
| 3 | **Collections Agent** | Monitors outstanding invoices, sends escalating follow-ups with smart timing/tone, tracks preliminary notice deadlines and lien filing windows, and predicts cash flow risk. |
| 4 | **Bookkeeping Agent** | Categorizes expenses, tracks revenue by tech/job type, prepares accounting data, flags anomalies, tracks tech hours from GPS + job completion timestamps, and prepares payroll data for Gusto/ADP. |
| 5 | **Insights Agent** | Proactively surfaces business intelligence -- margin analysis, pricing recommendations, seasonal demand forecasts, and staffing suggestions -- without being asked. |

### Field Operations

| # | Agent | One-Line Description |
|---|---|---|
| 6 | **Field Ops Agent** | Optimizes scheduling and dispatch based on tech location, skill, priority, and customer history, managing real-time changes and coordinating between office and field. |
| 7 | **Compliance Agent** | Tracks every deadline and regulatory requirement -- vehicle maintenance, insurance expirations, tech certifications, OSHA compliance, regional codes, permits, and inspections. |
| 8 | **Inventory Agent** | Manages the full parts lifecycle from procurement to installation -- tracks stock levels, triggers reorder alerts, compares supplier pricing, and reconciles usage against orders. |

### Customer & Sales

| # | Agent | One-Line Description |
|---|---|---|
| 9 | **Customer Agent** | Handles the entire customer-facing operation -- communication (confirmations, ETAs, follow-ups), reputation management (review requests, response drafting), service plans (warranties, maintenance agreements), and sales (lead scoring, pipeline management, 24/7 inbound lead response). |

### Agent Architecture Principle

These are NOT 9 separate products. They are 9 configurations of **one agent runtime engine**. The runtime handles trigger matching, data gathering, LLM reasoning, validation, autonomy checks, execution, chaining, and logging. Each agent is a declarative definition that describes its triggers, inputs, steps, outputs, and autonomy rules. See [06-agent-runtime](./06-agent-runtime.md) and [07-agent-definitions](./07-agent-definitions.md) for full details.

---

## 7. Product Positioning and Competitive Gap

### The Market Gap

Nobody deploys trade-specific AI agents into full operations for small-to-medium trade businesses.

| Category | Players | What They Do | What They Miss |
|---|---|---|---|
| **FSM Platforms** | ServiceTitan, Jobber, Housecall Pro, FieldCamp | Manage jobs, scheduling, dispatching. Some add basic AI features (call transcription, simple automation). | No autonomous agents. AI is a feature, not the product. Locked to their own platform. |
| **Customer-Facing AI** | Avoca, PSAI, ServiceAgent, Whippy, Newo.ai | Answer phones, book appointments, handle inbound calls. | Front-end only. No back-office operations. No invoicing, estimating, collections, compliance, inventory. |
| **Enterprise Agent Platforms** | Beam AI, OpenAI Frontier, ServiceNow | Deploy AI agents for Fortune 500 back offices. | Not built for a plumber with 8 trucks. Enterprise pricing, enterprise complexity. |
| **DIY Automation** | Zapier, Make, N8N | Build custom workflows. | Requires technical skill. Breaks when the person who built it leaves. No trade-specific intelligence. |
| **Direct Competitor** | Ressl AI (YC W26) | AI agents for trades, starting with collision repair. | Zero trades domain expertise (founders are enterprise SaaS). Starting in collision, not core trades. 4 people, just launched, pre-PMF. |

### CrewShift's Position

- **Cross-platform:** Works with Jobber AND ServiceTitan AND QuickBooks AND Stripe AND everything else. ServiceTitan will never build agents that work with Jobber. CrewShift works across all of them.
- **Full-stack operations:** Not just phones. Not just invoicing. Every function of the business.
- **Trade-specific:** Models trained on trade data. Pricing by trade and region. Permit and compliance knowledge. Not generic AI.
- **Learning over time:** Every business gets a custom AI assistant that improves because it has access to all their operational data.

### Competitive Moat (4 Layers)

1. **Trade-Specific AI Models:** Every invoice, estimate, and job trains proprietary models. 10K HVAC jobs = pricing knowledge no competitor can replicate.
2. **Local Knowledge Graphs:** Permit requirements, codes, supplier pricing, seasonal patterns -- by trade, by region. Does not exist elsewhere in structured form.
3. **Integration Depth:** Deep bidirectional integrations with Jobber, Housecall Pro, ServiceTitan, QuickBooks create switching costs. Each integration feeds more data into model training.
4. **Network Effects:** Every contractor makes agents smarter for all contractors. A plumber in Phoenix benefits from 500 plumbers in Dallas.

---

## 8. Cross-References to All Documentation

| Doc | File | Covers |
|---|---|---|
| **This file** | `00-overview.md` | Project overview, tech stack, architecture, agent roster, positioning |
| **Project Structure** | [01-project-structure.md](./01-project-structure.md) | Complete directory tree, every file described, monorepo layout |
| **Database Schema** | [02-database-schema.md](./02-database-schema.md) | All tables, columns, types, constraints, indexes, RLS, JSONB schemas |
| **API Routes** | [03-api-routes.md](./03-api-routes.md) | Every route with method, path, auth, roles, rate limits, request/response schemas |
| **API Standards** | [04-api-standards.md](./04-api-standards.md) | Response envelope, error codes, pagination, filtering, sorting, headers |
| **Security** | `05-security.md` | RLS policies, token encryption, CORS, RBAC, JWT strategy |
| **Agent Runtime** | `06-agent-runtime.md` | Runtime engine, event bus, registry, execution pipeline, chaining |
| **Agent Definitions** | `07-agent-definitions.md` | All 9 agents: triggers, inputs, steps, autonomy, chains |
| **Copilot** | `08-copilot.md` | Orchestration pipeline, streaming, context management, intent routing |
| **Integrations** | `09-integrations.md` | Adapter pattern, tier strategy, OAuth, sync, webhooks, all adapters |
| **AI Service** | `10-ai-service.md` | Python service: endpoints, providers, routing, fallback, prompts |
| **Workflow Engine** | `11-workflow-engine.md` | Workflow definition, execution, conditions, tracking |
| **File Storage** | `12-file-storage.md` | Upload pipeline, PDF generation, S3/R2 organization |
| **Realtime** | `13-realtime.md` | Supabase Realtime channels, SSE for copilot |
| **Queue System** | `14-queue-system.md` | BullMQ queues, workers, retry configs, scheduled jobs |
| **Notifications** | `15-notifications.md` | Email, SMS, push, in-app, digest generation |
| **Onboarding** | `16-onboarding.md` | State tracking, seeding, PLG flow, first-run demo |
| **Cost Tracking** | `17-cost-tracking.md` | Usage metering, tier limits, billing data |
| **Observability** | `18-observability.md` | Logging, tracing, metrics, alerting |
| **Testing** | `19-testing.md` | Test strategy, mocks, fixtures |
| **Data Pipeline** | `20-data-pipeline.md` | Anonymization, training data collection, consent, privacy |
| **Deployment** | `21-deployment.md` | Railway config, Docker, local dev, env vars, CI/CD |
| **Error Handling** | `22-error-handling.md` | Resilience patterns, circuit breaker, retries, idempotency |

---

## 9. Pricing Tiers (Context for Technical Decisions)

Understanding pricing tiers matters because agent availability, integration limits, and rate limits are gated by tier in the codebase.

| Tier | Price | Target | Agents Included | Integration Limit |
|---|---|---|---|---|
| **Starter** | $99/mo | Solo / 1-3 techs | 4 core agents (Invoice, Estimate, Collections, Customer) | Limited |
| **Pro** | $299/mo | 4-15 techs | All 9 agents, AI copilot, workflow builder, full dashboard + insights | All integrations |
| **Business** | $499/mo | 15-30 techs | Everything in Pro + multi-location support, priority support, dedicated onboarding | All integrations |
| **Enterprise** | Custom ($800-2,000+/mo) | 30+ techs, PE portfolios | White-label, custom agent development, API access | All + custom |

Pricing philosophy: NO per-tech pricing, NO usage-based pricing. Flat monthly tiers. $299 does not require owner approval -- an office manager can put it on a company card.
