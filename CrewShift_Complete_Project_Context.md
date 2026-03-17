# CREWSHIFT — COMPLETE PROJECT CONTEXT FILE
## Last Updated: March 3, 2026
## Version: V3 — Refined Strategy with Technical Architecture
## Purpose: Feed this file to any AI assistant to restore full project context

---

# WHAT IS CREWSHIFT

CrewShift is an AI workforce deployment platform purpose-built for the trades industry ($650B+ market, 3.7 million US businesses). It is NOT a SaaS tool with AI features. It is NOT a field service management platform. It is an AI operations platform that deploys pre-built, autonomous AI agents into every function of a trades business — back office, field operations, customer-facing, sales, and more.

The contractor connects their existing tools (Jobber, ServiceTitan, QuickBooks, etc.), selects the agents they need (like hiring staff), and within days has an AI-powered operations team running autonomously on top of their existing stack. The platform learns more about their specific business over time, getting smarter every month.

Not enough agents? Build your own — describe what you want to the AI copilot or use the visual workflow builder. CrewShift is both the team and the tools to make more.

**Core tagline:** "Why pay $45K/year for one back-office person when you can deploy an AI team for $299/month?"

**Positioning:** CrewShift is the Beam AI / OpenAI Frontier for the trades. Those platforms deploy agents for Fortune 500. Nobody does it for the 3.7M trade businesses. CrewShift fills that gap.

---

# THE THREE-LAYER PRODUCT ARCHITECTURE

## Layer 1 — Connect Everything
The contractor signs up and connects their existing tools. CrewShift becomes the intelligence layer sitting on top of all of them. It reads from and writes to every connected tool. It does NOT replace any software. This is the foundation.

Integrations include: ServiceTitan, Jobber, Housecall Pro, FieldEdge, BuildOps, Service Fusion, QuickBooks Online, QuickBooks Desktop, Xero, Sage Intacct, Stripe, Square, PayPal, Google Workspace, Microsoft 365, Twilio, Podium, CCCOne (collision), Procore (construction), Gusto/ADP (payroll).

## Layer 2 — Pre-Built Agents That Just Work
Out of the box, the contractor gets 9 agents already trained on trade workflows. They deploy immediately with zero configuration. Flip them on and they start working — monitoring connected tools, taking action, producing outputs. "It works day one" promise.

## Layer 3 — The Brain (Dashboard + AI Copilot + Workflow Builder)
Three interfaces working together:
- **Dashboard:** Visual control center — see what agents are doing, review outputs, check metrics, analyze every part of your business at a glance.
- **AI Copilot:** Talk to CrewShift like you'd talk to your office admin/operations coordinator. Text or voice. "Did the Johnson invoice go out?" "What's outstanding over 30 days?" "Build me a workflow that sends a review request 24 hours after every completed job."
- **Workflow Builder:** Build custom automations visually or describe them to the AI. Pre-built agents not enough? Create your own. The AI translates your description into a working workflow.

The AI copilot ties all agents together. The contractor doesn't jump between 20 dashboards — they just talk to their "office."

**Critical: It learns over time.** Month 1 it's good. Month 6 it knows the business better than a new hire ever would — pricing patterns, customer behaviors, tech performance, seasonal trends, vendor relationships, everything.

---

# AGENT ROSTER (9 PRE-BUILT AGENTS)

## MONEY & ADMIN (Back Office)
1. **Invoice Agent** — Job completion data → professional invoices with line items, labor, materials, tax. Sends to customers, tracks payment, syncs with QuickBooks/Xero.
2. **Estimate Agent** — Photos + scope descriptions → detailed estimates with local pricing, materials, labor. Also handles change orders (mid-job scope/price adjustments) and formal proposals for larger/commercial jobs. Pulls from historical job data. Generates inside existing systems.
3. **Collections Agent** — Monitors outstanding invoices, sends escalating follow-ups with smart timing/tone, tracks preliminary notice deadlines and lien filing windows, flags accounts needing human attention, predicts cash flow risk. Missing a lien deadline = losing legal right to collect — this agent never lets that happen.
4. **Bookkeeping Agent** — Categorizes expenses, tracks revenue by tech/job type, prepares accounting data, flags anomalies. Tracks tech hours from GPS + job completion timestamps, calculates overtime, flags discrepancies, prepares payroll data for Gusto/ADP. Automates timesheets.
5. **Insights Agent** — Proactively surfaces business intelligence: "Your average job margin dropped 8% this month — here's why." Analyzes margins across job types, suggests pricing adjustments based on market/costs/win rates. Predicts busy/slow periods from historical + seasonal data for staffing and marketing. Doesn't wait to be asked.

## FIELD OPERATIONS
6. **Field Ops Agent** — The field coordinator. Optimizes scheduling and dispatch based on tech location, skill, priority, customer history. Manages real-time changes, communicates to field teams, tracks job progress, coordinates between office and field. Everything that happens between a job being booked and a job being completed.
7. **Compliance Agent** — Tracks vehicle maintenance schedules, registration renewals, insurance expirations, mileage for taxes. Tracks OSHA compliance, tech certifications/expiration dates, required safety training. Handles regional code tracking, permit applications, inspection prep. Everything with a deadline or regulatory requirement.
8. **Inventory Agent** — Tracks parts from job data, updates stock, triggers reorder alerts, coordinates with suppliers, reconciles usage against orders. Compares pricing across suppliers, tracks lead times, manages vendor relationships, handles returns/credits. Full parts lifecycle from procurement to installation.

## CUSTOMER & SALES
9. **Customer Agent** — The entire customer-facing operation in one agent. Handles communication (confirmations, ETAs, completion summaries, follow-up scheduling), reputation management (review requests on Google/Yelp/Facebook, monitors reviews, drafts responses), service plans (warranties, maintenance agreements, recurring contracts, renewals, warranty claims), and sales (lead scoring, pipeline management, inbound lead response 24/7, re-engagement of lost estimates and dormant customers).

---

# AGENT FRAMEWORK ARCHITECTURE

## Design Principle
You're not building 9 separate products. You're building **one agent runtime** that executes 9 different configurations. The framework is the product — individual agents are instances of it.

## Event-Driven Agent System

```
┌─────────────────────────────────────────────────────┐
│                    AI COPILOT LAYER                  │
│         (Routes requests, orchestrates agents)       │
└──────────┬──────────────────────────┬────────────────┘
           │                          │
    ┌──────▼──────┐           ┌───────▼───────┐
    │  EVENT BUS  │           │  AGENT ROUTER │
    │  (triggers) │           │  (chat-based) │
    └──────┬──────┘           └───────┬───────┘
           │                          │
    ┌──────▼──────────────────────────▼────────┐
    │            AGENT RUNTIME ENGINE           │
    │                                           │
    │  Agent Definition (per agent):            │
    │  - Trigger conditions                     │
    │  - Input schema                           │
    │  - Decision tree / LLM prompt chain       │
    │  - Output schema                          │
    │  - Escalation rules                       │
    │  - Connected tools (integrations)         │
    │  - Autonomy level (auto vs review)        │
    │                                           │
    └──────────────┬───────────────────────────┘
                   │
    ┌──────────────▼───────────────────────────┐
    │          INTEGRATION LAYER                │
    │  (QuickBooks, Jobber, Stripe, etc.)      │
    └──────────────────────────────────────────┘
```

## Agent Chaining
Agents chain together through declarative rules, not hardcoded logic. The contractor or workflow builder defines chains:

```
Job Completed →
  ├── Invoice Agent → generates + sends invoice
  ├── Customer Agent → sends completion message + schedules review request (24h delay)
  ├── Inventory Agent → deducts parts used
  └── Bookkeeping Agent → categorizes revenue + expenses
```

## Human-in-the-Loop (Three Tiers)
Configurable per agent, per action:

1. **Full Auto:** Agent executes without review. Default for: appointment confirmations, inventory updates, expense categorization.
2. **Review Queue:** Agent drafts, human approves. Default for: invoices over a threshold, estimates for new customers.
3. **Escalation:** Agent flags and stops. Default for: customer disputes, data anomalies, low-confidence outputs.

System suggests upgrading autonomy as accuracy proves out: "You've approved 47 of your last 50 Invoice Agent drafts without changes. Want to switch to auto-send for invoices under $2,000?"

## Technical Decisions
- **Runtime:** Custom agent runtime (not LangGraph, CrewAI, AutoGen). Trade workflows are deterministic enough for full control over execution, costs, and reliability.
- **State:** Job/task queue pattern (BullMQ for Node.js or Inngest/Trigger.dev for managed).
- **Observability:** Every agent action logged and visible in dashboard. Contractors see what agents did, why, and can undo/override.

---

# INTEGRATION ARCHITECTURE

## Unified Data Model + Adapter Pattern

```
┌──────────────────────────────────────┐
│         UNIFIED DATA MODEL           │
│  (CrewShift internal: Jobs, Invoices,│
│   Customers, Techs, Estimates, etc.) │
└──────────────┬───────────────────────┘
               │
┌──────────────▼───────────────────────┐
│           ADAPTER LAYER              │
│  ┌─────────────┐  ┌─────────────┐   │
│  │   Jobber     │  │ QuickBooks  │   │
│  │   Adapter    │  │  Adapter    │   │
│  └─────────────┘  └─────────────┘   │
│  ┌─────────────┐  ┌─────────────┐   │
│  │ ServiceTitan│  │   Stripe    │   │
│  │   Adapter    │  │  Adapter    │   │
│  └─────────────┘  └─────────────┘   │
└──────────────────────────────────────┘
```

Each adapter translates between the external tool's data model and CrewShift's unified model. When an agent needs "customer data," it pulls from the unified model — it doesn't care if the data came from Jobber or ServiceTitan.

## Integration Tiers

### Tier 1 — MVP (Month 1-4)
| Integration | Difficulty | Unlocks |
|---|---|---|
| QuickBooks Online | Medium (OAuth2, REST API) | Invoice, Collections, Bookkeeping agents |
| Stripe | Easy (excellent API) | Invoice payments, Collections payment links |
| Google Workspace | Easy (OAuth2) | Customer Agent email/calendar, scheduling |
| Twilio | Easy (best-in-class API) | Customer Agent SMS, reminders |

### Tier 2 — Pro Launch (Month 5-8)
| Integration | Difficulty | Unlocks |
|---|---|---|
| Jobber | Medium (REST API, partner program) | Field Ops Agent, full job data pipeline |
| Housecall Pro | Medium (API available) | Same as Jobber |
| ServiceTitan | Hard (partner API, approval process) | Larger contractor segment |
| Xero | Medium (similar to QBO) | International accounting |

### Tier 3 — Business/Enterprise (Month 9-12)
| Integration | Unlocks |
|---|---|
| Gusto / ADP | Bookkeeping Agent payroll features |
| Podium | Customer Agent reviews |
| FieldEdge / BuildOps / Service Fusion | Broader FSM market |

## Sync Strategy
- **Webhooks** where available (Jobber, QBO, Stripe). Real-time.
- **Polling** as fallback (5-15 min intervals for changes).
- **Write-back** is critical — agents don't just read, they write (create invoices in QBO, update job status in Jobber, send payments via Stripe).

## Rules
- **API-only.** Never scrape. API integrations are stable, ToS-compliant, and required for FSM app store listings.
- **OAuth2 for all connections.** Contractors click "Connect QuickBooks" → authorize → done. No API keys, no passwords, no copy-pasting.

---

# CONVERSATIONAL AI DESIGN ("THE BRAIN")

## What It Does
The AI copilot is the single interface that ties all agents together. It's not a chatbot — it's an **operations coordinator** that speaks English. The contractor talks to it like they'd talk to their office manager. Text or voice.

## Core Capabilities

### 1. Intent Classification + Agent Routing
When a contractor sends a message, the brain determines what to do:

- "Did the Johnson invoice go out?" → Query → Invoice Agent → lookup status
- "What's outstanding over 30 days?" → Query → Collections Agent → generate report
- "Build me a workflow that sends a review request 24 hours after every completed job" → Create workflow → Workflow Builder → create automation
- "Schedule Mike for the Henderson job tomorrow at 2" → Action → Field Ops Agent → create appointment
- "How did we do last month?" → Query → Insights Agent → generate monthly summary

Uses a fast model (Haiku/GPT-4o-mini) for classification — must be sub-second.

### 2. Multi-Agent Coordination
Some requests involve multiple agents:

```
"The Henderson job is done. Mike finished around 3pm.
 Materials were 200 feet of copper pipe and 4 elbows."

Brain dispatches:
  1. Invoice Agent → generate invoice with labor (8am-3pm) + materials
  2. Inventory Agent → deduct 200ft copper pipe + 4 elbows
  3. Customer Agent → send completion message to Henderson
  4. Customer Agent → queue review request (24h delay)
  5. Bookkeeping Agent → categorize revenue + material costs

Response: "Invoice #1247 generated for $1,840 and sent to QuickBooks.
Henderson will get a completion notification now and a review request tomorrow."
```

### 3. Business Context Graph — How "Learning Over Time" Works
The AI maintains a knowledge model per business:

**Static (set during onboarding):**
- Company info: name, trade, location, size, tools connected
- Team: names, roles, skills, certifications
- Services: types, pricing, materials

**Dynamic (learned from operations):**
- Customer profiles: history, payment patterns, preferences
- Pricing patterns: averages by job type, margins, seasonal adjustments
- Vendor relationships: suppliers, pricing, lead times
- Operational patterns: busy days, common issues, seasonal trends

**Learned preferences:**
- "Owner prefers SMS over email for urgent items"
- "Always round estimates to nearest $50"
- "Don't schedule Johnson jobs on Mondays — they're never home"

When the contractor asks "How did we do last month?" — the brain pulls from the full context: revenue vs. last month, margins by job type, outstanding invoices, tech utilization, customer acquisition. It proactively surfaces insights: "Revenue up 12%, but average job margin dropped from 42% to 38% — mostly because of the 3 emergency calls where you didn't charge premium rates."

### 4. Proactive Intelligence
The brain doesn't just respond — it initiates:
- "You have 3 invoices over 60 days. Want me to send final notices?"
- "Mike's OSHA-10 certification expires in 2 weeks."
- "Based on last year, you'll see a 40% demand increase next month. Start scheduling now."
- "Copper pipe inventory at 50 feet. You go through 200/week. Want me to reorder?"

Delivered as a daily/weekly digest in-app + optional push notifications. Curated, prioritized, actionable — not a firehose of alerts.

### 5. Natural Language Workflow Creation
Contractors can build custom automations by describing them:

"Every time a job over $5,000 is completed, send me a text with the margin breakdown and auto-generate a review request for the customer after 48 hours."

The AI translates this into a workflow, confirms it with the contractor, and deploys it through the workflow builder.

## Model Selection Strategy

| Task | Model Tier | Why |
|---|---|---|
| Intent classification | Fast (Haiku / GPT-4o-mini) | Speed + cost. <500ms. |
| Entity extraction | Fast (Haiku / GPT-4o-mini) | Structured output, fast. |
| Complex reasoning (estimates, reports) | Capable (Sonnet / GPT-4o) | Accuracy + nuance. |
| Conversational response | Capable (Sonnet / GPT-4o) | Natural, contextual. |
| Voice memo transcription | Specialized (Whisper / Deepgram) | Optimized for noisy audio. |

## Memory Architecture
- **Short-term:** Last N messages in conversation (in-context for LLM).
- **Medium-term:** Summarized conversation history, stored per-user, injected as context.
- **Long-term:** Business knowledge graph in PostgreSQL + vector store (pgvector or Pinecone) for semantic search over past jobs, invoices, customer interactions.

The moat isn't the model — it's the data. Every business gets a custom AI assistant that gets smarter because it has access to all their operational data through connected integrations and agent outputs.

---

# PRICING STRUCTURE (FINALIZED)

| Tier | Price | Target | Includes |
|------|-------|--------|----------|
| **Starter** | $99/mo | Solo / 1-3 techs | 4 core agents (Invoice, Estimate, Collections, Customer). Limited integrations. Land-and-expand tier. |
| **Pro** | $299/mo | 4-15 techs | All 9 agents, all integrations, AI copilot, workflow builder, full dashboard + insights. **This is the main revenue driver — 60-70% of revenue.** |
| **Business** | $499/mo | 15-30 techs | Everything in Pro + multi-location support, priority support, dedicated onboarding. |
| **Enterprise** | Custom ($800-2,000+/mo) | 30+ techs, PE portfolios | White-label, custom agent development, API access, dedicated success manager. PE roll-up deployment deals. |

**Annual discount:** $249/mo paid annually for Pro ($2,988/year). Frame as "two months free."

**Pricing philosophy:**
- NO per-tech pricing (contractors hate it, punishes growth — #1 ServiceTitan complaint)
- NO usage-based pricing (unpredictable bills make contractors nervous)
- Flat monthly tiers = fair, predictable, budgetable
- $299 doesn't require owner approval — office manager can put it on company card
- Starter exists to create Pro customers, not as a standalone business
- Pro includes everything. Business tier = scale + white-glove, not feature-gating.

**The math that sells:**
- Back-office hire: $45-55K/year fully loaded, 40hrs/week, sick days, turnover
- CrewShift Pro: $3,588/year for full AI operations team, 24/7, never quits, gets smarter monthly
- That's 93% cheaper. Not a software decision. A staffing decision.

---

# UNIT ECONOMICS

## Per-User Monthly AI Costs (Estimated)

| Cost Driver | Starter | Pro | Business |
|---|---|---|---|
| LLM calls (copilot + agent reasoning) | $8-12 | $18-30 | $35-55 |
| Speech-to-text (voice input via Whisper/Deepgram) | $1-3 | $3-8 | $5-12 |
| Vision/OCR (photo-to-estimate, receipt scanning) | $1-2 | $3-6 | $5-10 |
| Infrastructure (DB, storage, compute, integrations) | $3-5 | $5-8 | $8-15 |
| Integration API calls (QuickBooks, Jobber, etc.) | $1-2 | $2-4 | $3-6 |
| **Total estimated COGS** | **~$18** | **~$42** | **~$75** |

## Margin Analysis

| Tier | Revenue | Est. COGS | Gross Margin | Gross Margin % |
|---|---|---|---|---|
| Starter ($99) | $99 | ~$18 | $81 | ~82% |
| Pro ($299) | $299 | ~$42 | $257 | ~86% |
| Business ($499) | $499 | ~$75 | $424 | ~85% |

## Cost Optimization Levers
- Use smaller/cheaper models (Haiku, GPT-4o-mini) for routine agent tasks. Reserve large models for copilot and complex reasoning.
- Cache frequently asked questions and common data lookups.
- Batch non-time-critical agent work (collections follow-ups, reporting) to off-peak.
- Fine-tuned models in Phase 2 dramatically reduce per-call cost vs. prompt-engineered general models.
- Negotiate volume discounts with OpenAI/Anthropic at scale.

## Break-Even
~70-80 Pro subscribers ($257 gross margin each) covers a small founding team + cloud costs.

---

# COMPETITIVE LANDSCAPE

## Direct Competitor: Ressl AI (YC W26)
- **Founded:** 2024 by Arushi Gandhi (CEO) and Abhishek Eswaran
- **HQ:** San Francisco. **Team:** 4 employees. **Funding:** $500K from YC.
- **Launched:** February 26, 2026 (extremely new)
- **Original product:** Salesforce automation (virtual Salesforce admin). Pivoted to trades after consulting 120+ companies.
- **What they offer:** AI agents for lead response, estimating (CCCOne), procurement, admin/invoicing on top of existing tools.
- **GTM:** Direct to operators + PE-backed roll-ups.
- **CRITICAL WEAKNESSES:**
  - Zero trades domain expertise (founders are enterprise SaaS/Salesforce people)
  - Starting in collision repair, not core trades (HVAC, plumbing, electrical)
  - Only testimonial from Cockroach Labs (a tech company, not a contractor)
  - Website shows placeholder metrics (dashes instead of real numbers)
  - Enterprise DNA (OpenClaw architecture) in a blue-collar market that needs simplicity
  - 4 people, 1 week old, pre-PMF

## FSM Platforms (Add AI Features, Not Agents)
- **ServiceTitan:** 20+ techs, $250-500/tech/mo, 2-3 month onboarding. Reporting + call tracking AI. No autonomous agents. $78K avg annual customer cost.
- **BuildOps:** Commercial trades, $1B valuation, $127M Series C. OpsAI does notes/scanning/dispatch. AI locked inside their platform. Not for small residential.
- **Jobber:** 2-15 techs, $25-149/mo. Basic automation. No AI agents.
- **Housecall Pro:** 2-10 techs, $59-489/mo. Marketing tools. No AI agents.
- **FieldCamp:** AI assistant "Handy" for chat-based commands. Closest to conversational AI but it's a feature inside FSM, not an agent deployment platform.

## Customer-Facing AI (Front-End Only)
- **Avoca AI:** Handles 70% of call volume for large contractors. Phone answering only. No back-office.
- **PSAI / Predictive Sales AI:** AI call center. Books appointments. No back-office.
- **ServiceAgent:** AI voice + scheduling + CRM. Still focused on inbound-call-to-booking flow.
- **Whippy, Newo.ai, FACITI:** AI voice receptionists. Answer calls, book jobs. That's it.

## DIY Automation
- **N8N, Make, Zapier:** Powerful but require technical skill to build and maintain. Breaks when the person who built it leaves.

## Enterprise AI Agent Platforms
- **Beam AI:** Fortune 500 back offices. 95% automation, 98% accuracy. Not for trades.
- **OpenAI Frontier:** Enterprise AI coworkers. HP, Uber, State Farm. Not for a plumber with 8 trucks.
- **ServiceNow:** Enterprise workflow automation. Way too complex and expensive for trades.

## THE GAP
Nobody deploys trade-specific AI agents into full operations for small-to-medium trade businesses. FSM platforms bolt on features. Customer AI answers phones. Ressl just launched with no trades DNA. Enterprise platforms serve Fortune 500. CrewShift fills this gap.

---

# COMPETITIVE DEFENSE STRATEGY

## Threat Assessment

| Competitor | Threat Level | Timeline | Attack Vector |
|---|---|---|---|
| ServiceTitan adds native agents | HIGH | 12-18 months | Push to existing 20+ tech customers |
| Jobber adds AI features | MEDIUM | 6-12 months | Simple automation for SMB |
| Ressl AI (YC W26) | LOW-MEDIUM | 6-12 months | PE roll-ups, collision niche |
| BuildOps OpsAI expansion | LOW | 12-24 months | Commercial focus |
| "I can do this with ChatGPT" | LOW | Already here | Common objection |

## Defense by Threat

**vs. ServiceTitan/Jobber adding native agents:**
- **Cross-platform is the moat.** ServiceTitan will never build agents that work with Jobber. Jobber will never integrate with ServiceTitan. CrewShift works across all of them. A contractor using Jobber for scheduling + QuickBooks for accounting + Podium for reviews can't get a unified AI layer from any single vendor.
- **Platform-agnostic positioning.** "We make your existing tools smarter" vs "switch to our platform."
- **Speed.** ServiceTitan takes 2-3 months to onboard. CrewShift takes days. Ship fast, build data advantage.
- **Integration marketplace play.** Get listed in Jobber's and ServiceTitan's app stores. Become a recommended add-on, not a competitor.

**vs. Ressl AI:**
- Different beachhead (HVAC/plumbing vs collision repair), different buyer persona, different workflow expertise. Don't burn energy competing directly. Build data advantage in core trades while they figure out their market.

**vs. "I can do this with ChatGPT":**
- ChatGPT doesn't connect to QuickBooks and send invoices.
- ChatGPT doesn't monitor outstanding invoices and chase payments.
- ChatGPT doesn't know your pricing, customers, or business.
- Frame: "ChatGPT is a tool you use. CrewShift is a team that works for you."

**The real competition isn't other software — it's the status quo:** the contractor's spouse doing invoices at the kitchen table at 10pm, or the $45K/year office hire who calls in sick.

---

# COMPETITIVE MOAT (4 LAYERS)

1. **Trade-Specific AI Models:** Every invoice, estimate, job trains proprietary models. 10K HVAC jobs = more pricing knowledge than any human. Cannot be replicated by generic AI.
2. **Local Knowledge Graphs:** Permit requirements, codes, supplier pricing, seasonal patterns — by trade, by region. Doesn't exist elsewhere in structured form. Value grows with each contractor in an area.
3. **Integration Depth:** Deep integrations with Jobber, Housecall Pro, ServiceTitan, QuickBooks create switching costs. Each integration feeds more data into model training.
4. **Network Effects:** Every contractor makes agents smarter for all contractors. Plumber in Phoenix benefits from 500 plumbers in Dallas. Scale improves everything.

*Future (Year 2+):* Model Marketplace — sell fine-tuned trade models to other platforms/developers. Revenue independent of subscriptions. Positions CrewShift as intelligence layer for entire trades tech ecosystem.

---

# MARKET DATA

- **Global FSM market:** $5.49B (2025) → $23.61B (2035), 16% CAGR
- **US trade contractors:** 3.7 million businesses, $650B+ annually
- **Admin waste:** 18% of working hours lost (~1 day/week). $31B lost annually to miscommunication.
- **Missed calls:** 30-45% of inbound calls missed = ~$22K/month lost revenue per business
- **Tech adoption:** 20% use zero software. <33% use digital payment tools.
- **AI readiness:** 78% of contractors already using/testing AI. 80% believe AI essential within 3 years. 59% prefer AI built into tools they use.
- **Labor crisis:** Average construction wages $62K. Nearly half of contractors say >20% of positions unfilled.
- **Change order pain:** 24-day average preparation time. 4-8 PM hours per change order.
- **Rework costs:** 28% of total project costs from documentation errors and miscommunication.
- **Invoice processing:** $68/PO manual vs <$5 with AI.
- **BuildOps survey:** 56% improving internal processes with tech. 38% using AI for admin/recordkeeping.

---

# TECHNICAL ARCHITECTURE

## Core Stack
- **Mobile:** React Native or Flutter (cross-platform iOS/Android)
- **Backend:** Node.js or FastAPI
- **Speech-to-Text:** Whisper API or Deepgram
- **AI/LLM:** Claude + GPT-4o for reasoning, Haiku/GPT-4o-mini for routing + custom fine-tuned models
- **Computer Vision:** GPT-4o Vision or custom Hugging Face models for photo-to-estimate
- **Database:** PostgreSQL + Supabase or PlanetScale
- **Vector Store:** pgvector or Pinecone (for long-term business memory)
- **Storage:** AWS S3 or Cloudflare R2
- **Payments:** Stripe Connect
- **Hosting:** Vercel (frontend) + Railway or AWS (backend)
- **Task Queue:** BullMQ or Inngest/Trigger.dev (agent job execution)

## AI Model Strategy
- **Phase 1:** Existing LLM APIs + heavy trade-specific prompt engineering. Fast to market.
- **Phase 2:** Fine-tune on real contractor data collected from platform usage. Compounding data moat.
- **Phase 3 (Year 2+):** Package and sell fine-tuned models via Hugging Face, Replicate, or direct API. Second revenue stream.

---

# GO-TO-MARKET STRATEGY

## Beachhead: HVAC Contractors (2-10 techs) in the US
- High job volume, complex invoicing, seasonal demand spikes, culture moving toward tech adoption.
- Expansion: HVAC → Plumbing → Electrical → General Contracting → Roofing → Landscaping → Collision Repair

## Sales Motion: PLG-First, Sales-Assisted
- **Under 5 techs:** Full PLG. Sign up → connect tools → use agents → convert to paid.
- **5-15 techs:** PLG entry + optional onboarding call to help connect integrations and configure agents. Not a sales call — a setup call.
- **15+ techs:** Sales-assisted. These companies have an office manager/ops person. They want a demo and onboarding plan.

## Onboarding Flow (PLG Path)
```
Step 1: Sign up (email + company name + trade type)
Step 2: "Connect your first tool" → QuickBooks button (OAuth, 30 seconds)
Step 3: CrewShift pulls in recent jobs/invoices → shows them in dashboard
Step 4: "Try your first agent" → Invoice Agent generates from existing job data
Step 5: "That took 8 seconds. You usually spend 15 minutes."
Step 6: "Connect more tools to unlock more agents" → Jobber, Stripe, etc.
```
Time to value: **under 5 minutes.** Real output from their own data in the first session.

## Acquisition Channels (Prioritized)

### Tier 1 — Launch (Month 1-6)
1. **YouTube content:** Short, specific demos. Real contractors, real job sites. YouTube is where contractors go to learn.
2. **Trade communities:** r/HVAC (350K+), r/Plumbing, contractor Facebook groups (50K+), HVAC-Talk. Provide value, don't spam. Founder active personally.
3. **Referral program:** "Give a month, get a month." Subtle "Powered by CrewShift" on generated invoices.

### Tier 2 — Scale (Month 6-12)
4. **Supply house partnerships:** Ferguson, Johnstone Supply, Winsupply — reps visit shops weekly. A recommendation from their parts guy carries weight.
5. **FSM app store listings:** Jobber App Marketplace, Housecall Pro integrations. High-intent discovery channel.
6. **Trade shows:** AHR Expo, PHCC Connect, NECA. Live demos at the booth.

### Tier 3 — Accelerate (Month 12+)
7. **PE firm partnerships:** One deal = deploy CrewShift across 10-50 businesses at Enterprise pricing. Approach after proven ROI data from 200+ contractors.

## Key Metrics

| Stage | Metric | Target |
|---|---|---|
| Awareness | YouTube views, community mentions | 10K views/mo by Month 6 |
| Trial | Sign-ups per week | 50/week by Month 6 |
| Activation | % connect 1+ tool within 24h | >60% |
| Activation | % see first agent output within 1h | >40% |
| Conversion | Free → Paid within 14 days | >15% |
| Retention | 30-day retention | >80% |
| Expansion | Starter → Pro upgrade within 90 days | >25% |
| Viral | Referral rate | >10% |

---

# DEVELOPMENT ROADMAP

## Phase 1: Foundation + Core Agents (Months 1-4)

**Month 1-2: Foundation**
- Agent runtime engine (event-driven, declarative definitions, chaining)
- AI copilot layer (intent classification, agent routing, basic conversation)
- Integration framework + QuickBooks Online adapter + Stripe adapter
- Dashboard: agent activity feed, basic business metrics
- Auth, onboarding, team management

**Month 2-3: First Agent Pair**
- Invoice Agent — job data → invoice draft → review → send → sync to QuickBooks
- Collections Agent — monitors outstanding, sends follow-ups, tracks lien deadlines
- These two chain naturally: job completes → invoice generates → collections monitors

**Month 3-4: Second Agent Pair + Copilot**
- Estimate Agent — photos + descriptions → estimates with local pricing + change orders + proposals
- Customer Agent — confirmations, ETAs, review requests, lead response, service plans, sales pipeline
- Google Workspace + Twilio integrations
- AI copilot: multi-agent coordination, natural language queries across all agents

## Phase 2: Full Platform (Months 5-8)
- Bookkeeping Agent, Field Ops Agent, Compliance Agent, Inventory Agent
- Workflow builder (visual + natural language)
- Integrations: Jobber, Housecall Pro, ServiceTitan, Xero
- Dashboard v2: full business analytics, agent performance metrics
- Business context graph: dynamic learning, proactive intelligence

## Phase 3: Intelligence + Scale (Months 9-12)
- Insights Agent (proactive business intelligence, pricing optimization, demand forecasting)
- Proactive daily/weekly digest
- Fine-tuned trade models from real platform data
- Integrations: Gusto, Podium
- Multi-location support

**50 HVAC contractor beta between Month 4-5. Real data, iterate accuracy, measure impact, build case studies.**

---

# FINANCIAL PROJECTIONS (YEAR 1)

| Milestone | Users | MRR | ARR Run Rate |
|-----------|-------|-----|-------------|
| Month 3 (Beta) | 50 | $2,500 | $30,000 |
| Month 6 (Launch) | 250 | $20,000 | $240,000 |
| Month 9 | 600 | $54,000 | $648,000 |
| Month 12 | 1,200 | $108,000 | $1,296,000 |

Assumptions: $80 avg ARPU (mix of tiers), 5% monthly growth post-launch, 4% churn.

**Unit economics context:** At 1,200 users with ~$42 avg COGS, monthly AI/compute spend is ~$50K against $108K MRR. Gross margin ~54% at this mix. Improves as fine-tuned models reduce API costs and Pro tier (higher margin) becomes larger share.

---

# KEY RISKS

| Risk | Threat | Mitigation |
|------|--------|-----------|
| AI accuracy on noisy job sites | Contractors won't trust outputs if accuracy is low | Fine-tune on real data. All outputs presented as drafts. Confidence scores. Human review for low-confidence. |
| Ressl AI gains traction | YC network, PE connections | Move faster. Deeper trade expertise. Different beachhead (HVAC vs collision). Build data moat before they expand. |
| ServiceTitan builds native agents | They have distribution to 20+ tech companies | Position as cross-platform complement. Get listed in their app store. Win on speed-to-value (days vs months). |
| Contractor resistance to AI | "I don't trust a computer to do my invoices" | Zero-friction UX. Show real output from their data immediately. Video marketing with real contractors. Voice/text input = zero learning curve. |
| LLM API costs at scale | Could compress margins with heavy usage | Model tiering (cheap for routing, capable for reasoning). Fine-tuned open-source models in Phase 2. Batch non-urgent tasks. Volume discounts. |
| Pricing errors in estimates | Wrong estimate = lost job or lost money | Draft mode always. Contractor reviews before sending. Live pricing APIs where available. Confidence scores. Flag statistical outliers. |
| Support costs at scale | $299/mo customers expect responsiveness | Self-service dashboard showing why agents made decisions. In-app help. Community forum. Budget support function by Month 6. |
| Integration brittleness | Third-party APIs change | Adapter pattern isolates changes. Automated integration health monitoring. Official partner programs for stability. |

---

# IMMEDIATE NEXT STEPS

1. **Validate (Weeks 1-4):** 30+ HVAC contractor interviews. Confirm pain, willingness to pay, input preferences.
2. **Prototype (Weeks 2-6):** Core agent pipeline — test with real contractor data. Measure accuracy.
3. **Brand (Week 1):** Register CrewShift domain, social handles, trademark. Landing page with waitlist.
4. **MVP Sprint (Weeks 5-16):** Agent runtime + Invoice, Estimate, Collections, Customer agents + dashboard + AI copilot.
5. **Beta (Weeks 17-22):** 50 HVAC contractors. Real data, iterate accuracy, measure impact, build case studies.
6. **Launch (Weeks 23-26):** Open signups. Product Hunt. Trade channels. Content marketing.
7. **Expand (Months 7-12):** Full agent roster. Plumbing + electrical verticals.

---

# NAME: CREWSHIFT

Chosen because:
- "Crew" is how every trade business thinks about their people — the word they use daily
- "Shift" = dual meaning: shifting work from humans to AI + agents work in shifts (24/7)
- Positions as workforce play, not software play
- Short, memorable, easy to spell over the phone (contractors buy by word of mouth)
- Doesn't sound like enterprise SaaS
- Alternatives considered and rejected: TradeShift (taken by fintech), FazShift (hard to spell), CrewPilot (too generic copilot), ShopForce (sounds retail)

---

# FINALIZED BRAND COPY

## Tagline (locked)
**CrewShift — The AI Back Office for the Trades**

## Landing Page Above-the-Fold (locked)

**Badge/identifier:** The AI Back Office for the Trades

**Headline:** Deploy AI Agents That Run Your Invoicing, Estimates, Collections, Scheduling, Permits, and More

**Subheadline:** CrewShift connects to the tools you already use — Jobber, ServiceTitan, QuickBooks, Housecall Pro — and puts AI agents to work across your entire back office.

**CTA:** [Join the Waitlist]

**Social proof:** Join over 500+ trade businesses on the waitlist

**Market line:** Built for HVAC, plumbing, electrical, roofing, and every trade in between.

## Copy Philosophy
- Matter of fact. No cleverness. No emotional hooks. No marketing fluff.
- Every line should tell you who we are, what we are, and what we do.
- Everything is focused on the trades.
- Never frame as "replacing people with AI" — frame as "do more with less." Contractors want help, not threats to their team.
- Name specific tools they use (Jobber, ServiceTitan, QuickBooks) so they instantly feel "this is for me."
- Name specific trades (HVAC, plumbing, electrical, roofing) so they know it's built for them.
- The word "deploy" frames agents as workers you put to work, not software you learn.

---

# DOCUMENT HISTORY
- **V1 Blueprint:** AI Back-Office Autopilot — single-purpose SaaS tool for HVAC voice-to-invoice
- **V2 Blueprint:** CrewShift — full AI operations platform with 26 agent roster, three-layer architecture, $99-499 pricing tiers, competitive analysis
- **V3 Blueprint (current):** Consolidated to 9 agents (from 26), added agent framework architecture, integration architecture, conversational AI design, GTM execution plan, unit economics, competitive defense strategy. Model Marketplace deferred to Year 2+.
- **Key pivot:** From "SaaS tool with AI features" → "AI workforce deployment platform for trade operations"
- **Competitive research completed:** Ressl AI deep dive, FSM landscape (ServiceTitan, BuildOps, Jobber, Housecall Pro, FieldCamp), customer-facing AI (Avoca, PSAI, ServiceAgent), enterprise platforms (Beam AI, OpenAI Frontier)

---

# HOW TO USE THIS FILE
Feed this entire file to any AI assistant at the start of a conversation. It contains the complete strategic context for the CrewShift project including vision, product architecture, 9-agent roster, pricing, unit economics, competitive intelligence, competitive defense, market data, technical architecture, agent framework design, integration architecture, conversational AI design, GTM strategy, financial projections, and development roadmap. The AI should be able to pick up exactly where we left off.

---

**Where we left off:** V3 strategy complete. 9-agent roster finalized. Technical architecture (agent framework, integration adapter pattern, conversational AI design) defined. Unit economics modeled. GTM plan with PLG-first + sales-assisted hybrid locked. Ready to start building.
