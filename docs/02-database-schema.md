# 02 - Database Schema

> **Permanent reference** for every table, column, type, constraint, index, RLS policy, and JSONB schema in the CrewShift database.
> Cross-references: [00-overview](./00-overview.md) | [01-project-structure](./01-project-structure.md) | [03-api-routes](./03-api-routes.md) | [04-api-standards](./04-api-standards.md)

---

## 1. Database Platform

**Supabase PostgreSQL** -- managed PostgreSQL with built-in Auth, Realtime, and Row-Level Security.

Key extensions:
- `pgcrypto` -- column-level encryption for OAuth tokens
- `pgvector` (vector) -- vector similarity search for embeddings
- `pg_trgm` -- trigram-based text search for fuzzy matching

---

## 2. Entity Relationship Overview

```
organizations (tenant root)
 ├── profiles (users, extends auth.users)
 ├── integrations (connected external tools)
 ├── customers
 │    ├── jobs
 │    │    ├── invoices
 │    │    └── estimates (optional, can also be standalone)
 │    ├── invoices (can exist without a job)
 │    └── estimates (can exist without a job)
 ├── parts (inventory)
 ├── agent_configs (per-agent settings)
 ├── agent_executions (audit log of every agent action)
 ├── conversations
 │    └── messages
 ├── workflows
 │    └── workflow_executions
 ├── business_context (learned preferences)
 ├── notifications
 ├── embeddings (vector store)
 ├── training_data (anonymized, for model training)
 └── data_consent (opt-in for training data collection)

training_runs (global, not org-scoped)
```

Every table except `training_runs` contains an `org_id` column for multi-tenant isolation.

---

## 3. Complete SQL Schema

### 3.1 Organizations

```sql
-- MULTI-TENANT ROOT: Organizations
-- Every other table references this. The org_id is the tenant boundary.
CREATE TABLE organizations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,                              -- Business name ("Mike's HVAC")
  trade_type        TEXT NOT NULL,                              -- 'hvac', 'plumbing', 'electrical', 'roofing', 'general', 'landscaping'
  size              TEXT,                                       -- 'solo', '2-5', '6-15', '16-30', '30+' (number of techs)
  tier              TEXT NOT NULL DEFAULT 'starter',            -- 'starter', 'pro', 'business', 'enterprise' (pricing tier)
  onboarding_status TEXT NOT NULL DEFAULT 'not_started',       -- 'not_started', 'in_progress', 'completed', 'skipped'
  settings          JSONB DEFAULT '{}',                        -- Org-level preferences (see JSONB schemas below)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purpose: The root entity for multi-tenancy. Every other table has a foreign key to organizations.id.
-- The tier column gates feature access (which agents are available, integration limits, rate limits).
-- The onboarding_status column tracks PLG onboarding flow progress.
```

### 3.2 Profiles

```sql
-- USERS: Extends Supabase auth.users with app-specific data
-- References auth.users for authentication, adds role and org membership.
CREATE TABLE profiles (
  id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,  -- Same UUID as Supabase auth user
  org_id            UUID NOT NULL REFERENCES organizations(id),                    -- Which org this user belongs to
  full_name         TEXT,                                                          -- Display name
  role              TEXT NOT NULL DEFAULT 'member',                                -- 'owner', 'admin', 'member', 'tech'
  phone             TEXT,                                                          -- Phone number for SMS notifications
  avatar_url        TEXT,                                                          -- Profile photo URL (S3/R2)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purpose: Links Supabase auth users to organizations with a role. The role is also
-- embedded as a JWT custom claim for fast RBAC checks without DB lookups.
-- ON DELETE CASCADE: If the auth user is deleted, the profile is automatically removed.

CREATE INDEX idx_profiles_org_id ON profiles(org_id);
```

### 3.3 Integrations

```sql
-- CONNECTED INTEGRATIONS: OAuth tokens and sync state for external tools
CREATE TABLE integrations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id),
  provider            TEXT NOT NULL,                            -- 'quickbooks', 'stripe', 'jobber', 'servicetitan', 'google', 'twilio', etc.
  status              TEXT NOT NULL DEFAULT 'pending',          -- 'pending', 'connected', 'error', 'disconnected'
  access_token        TEXT,                                     -- ENCRYPTED via pgcrypto (pgp_sym_encrypt)
  refresh_token       TEXT,                                     -- ENCRYPTED via pgcrypto (pgp_sym_encrypt)
  token_expires_at    TIMESTAMPTZ,                              -- When the access token expires (for proactive refresh)
  external_account_id TEXT,                                     -- Their ID on the external platform (e.g., QBO realm ID)
  metadata            JSONB DEFAULT '{}',                      -- Provider-specific config (see JSONB schemas below)
  last_sync_at        TIMESTAMPTZ,                              -- When the last successful sync completed
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purpose: Stores OAuth credentials and sync state for every connected external tool.
-- Tokens are encrypted at the application layer before INSERT/UPDATE using pgp_sym_encrypt.
-- The metadata JSONB holds provider-specific configuration that varies per integration.

CREATE INDEX idx_integrations_org_id ON integrations(org_id);
CREATE UNIQUE INDEX idx_integrations_org_provider ON integrations(org_id, provider);
```

### 3.4 Customers

```sql
-- UNIFIED DATA MODEL: Customers
-- Aggregates customer data from all connected tools into one canonical record.
CREATE TABLE customers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  external_ids      JSONB DEFAULT '{}',                        -- Maps to external systems: { "quickbooks": "123", "jobber": "456" }
  name              TEXT NOT NULL,                              -- Customer display name
  email             TEXT,                                       -- Primary email
  phone             TEXT,                                       -- Primary phone
  address           JSONB,                                     -- Structured address (see JSONB schemas below)
  tags              TEXT[],                                     -- Freeform tags: ['vip', 'commercial', 'repeat']
  notes             TEXT,                                       -- Freeform notes about the customer
  payment_score     REAL,                                       -- AI-generated: likelihood to pay on time (0.0 to 1.0)
  lifetime_value    DECIMAL(12,2),                              -- Total revenue from this customer
  metadata          JSONB DEFAULT '{}',                        -- Extensible metadata
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purpose: The canonical customer record. Data synced from Jobber, QuickBooks, ServiceTitan,
-- etc. is mapped into this unified model via the adapter layer. external_ids tracks the
-- mapping back to each external system for bidirectional sync.
-- payment_score is computed by the Collections Agent from payment history data.
-- lifetime_value is computed from all invoices associated with this customer.

CREATE INDEX idx_customers_org_id ON customers(org_id);
CREATE INDEX idx_customers_org_name ON customers(org_id, name);
CREATE INDEX idx_customers_org_email ON customers(org_id, email);
```

### 3.5 Jobs

```sql
-- UNIFIED DATA MODEL: Jobs
-- A job represents a unit of work: service call, install, maintenance, emergency.
CREATE TABLE jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  customer_id       UUID REFERENCES customers(id),             -- Which customer this job is for (nullable for unassigned jobs)
  external_ids      JSONB DEFAULT '{}',                        -- Maps to external systems: { "jobber": "789", "servicetitan": "012" }
  status            TEXT NOT NULL DEFAULT 'pending',            -- 'pending', 'scheduled', 'in_progress', 'completed', 'cancelled'
  type              TEXT,                                       -- 'service_call', 'install', 'maintenance', 'emergency'
  description       TEXT,                                       -- What the job is (free text, used for AI reasoning and search)
  scheduled_start   TIMESTAMPTZ,                                -- When the job is scheduled to begin
  scheduled_end     TIMESTAMPTZ,                                -- When the job is scheduled to end
  actual_start      TIMESTAMPTZ,                                -- When the tech actually started
  actual_end        TIMESTAMPTZ,                                -- When the tech actually finished
  assigned_tech_id  UUID REFERENCES profiles(id),               -- Which tech is assigned
  address           JSONB,                                     -- Job site address (see JSONB schemas below)
  line_items        JSONB DEFAULT '[]',                        -- Work performed (see JSONB schemas below)
  materials         JSONB DEFAULT '[]',                        -- Materials used (see JSONB schemas below)
  labor_hours       DECIMAL(6,2),                               -- Total labor hours
  total_amount      DECIMAL(12,2),                              -- Total job value
  margin            DECIMAL(5,2),                               -- Profit margin percentage
  notes             TEXT,                                       -- Internal notes
  photos            TEXT[],                                     -- S3/R2 URLs of job site photos
  metadata          JSONB DEFAULT '{}',                        -- Extensible metadata
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purpose: The canonical job record. Jobs flow through the system: pending -> scheduled ->
-- in_progress -> completed. The completed transition fires the job.completed event which
-- triggers the Invoice Agent, Customer Agent, Inventory Agent, and Bookkeeping Agent.

CREATE INDEX idx_jobs_org_id ON jobs(org_id);
CREATE INDEX idx_jobs_org_status ON jobs(org_id, status);
CREATE INDEX idx_jobs_org_customer ON jobs(org_id, customer_id);
CREATE INDEX idx_jobs_org_tech ON jobs(org_id, assigned_tech_id);
CREATE INDEX idx_jobs_org_scheduled ON jobs(org_id, scheduled_start);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
```

### 3.6 Invoices

```sql
-- INVOICES: Generated by Invoice Agent or created manually
CREATE TABLE invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  job_id            UUID REFERENCES jobs(id),                  -- Which job this invoice is for (nullable for standalone invoices)
  customer_id       UUID REFERENCES customers(id),             -- Which customer to bill
  external_ids      JSONB DEFAULT '{}',                        -- Maps to external systems: { "quickbooks": "INV-001" }
  status            TEXT NOT NULL DEFAULT 'draft',              -- 'draft', 'review', 'sent', 'paid', 'overdue', 'void'
  invoice_number    TEXT,                                       -- Human-readable invoice number (e.g., "INV-2026-0042")
  line_items        JSONB NOT NULL DEFAULT '[]',               -- Invoice line items (see JSONB schemas below)
  subtotal          DECIMAL(12,2),                              -- Sum of line item totals (before tax)
  tax_rate          DECIMAL(5,4),                               -- Tax rate as decimal (e.g., 0.0825 for 8.25%)
  tax_amount        DECIMAL(12,2),                              -- Calculated tax amount
  total             DECIMAL(12,2),                              -- subtotal + tax_amount
  due_date          DATE,                                       -- When payment is due
  sent_at           TIMESTAMPTZ,                                -- When the invoice was sent to the customer
  paid_at           TIMESTAMPTZ,                                -- When payment was received
  payment_method    TEXT,                                       -- 'stripe', 'check', 'cash', 'transfer', etc.
  generated_by      TEXT DEFAULT 'manual',                      -- 'manual', 'agent', 'workflow' (who/what created this)
  pdf_url           TEXT,                                       -- S3/R2 URL of the generated PDF
  notes             TEXT,                                       -- Notes visible on the invoice
  metadata          JSONB DEFAULT '{}',                        -- Extensible metadata
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purpose: The canonical invoice record. Created by the Invoice Agent (from job.completed events),
-- manually by users, or by workflows. The status lifecycle is: draft -> review -> sent -> paid/overdue -> void.
-- The Collections Agent monitors invoices with status 'sent' and transitions them to 'overdue' when past due_date.

CREATE INDEX idx_invoices_org_id ON invoices(org_id);
CREATE INDEX idx_invoices_org_status ON invoices(org_id, status);
CREATE INDEX idx_invoices_org_customer ON invoices(org_id, customer_id);
CREATE INDEX idx_invoices_org_due_date ON invoices(org_id, due_date);
CREATE INDEX idx_invoices_created_at ON invoices(created_at DESC);
CREATE INDEX idx_invoices_org_job ON invoices(org_id, job_id);
```

### 3.7 Estimates

```sql
-- ESTIMATES: Generated by Estimate Agent or created manually
CREATE TABLE estimates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  customer_id       UUID REFERENCES customers(id),             -- Which customer this estimate is for
  external_ids      JSONB DEFAULT '{}',                        -- Maps to external systems
  status            TEXT NOT NULL DEFAULT 'draft',              -- 'draft', 'review', 'sent', 'accepted', 'rejected', 'expired'
  estimate_number   TEXT,                                       -- Human-readable estimate number (e.g., "EST-2026-0015")
  type              TEXT DEFAULT 'estimate',                    -- 'estimate', 'proposal', 'change_order'
  line_items        JSONB NOT NULL DEFAULT '[]',               -- Estimate line items (same schema as invoice line items)
  subtotal          DECIMAL(12,2),                              -- Sum of line item totals
  tax_amount        DECIMAL(12,2),                              -- Tax amount
  total             DECIMAL(12,2),                              -- subtotal + tax_amount
  valid_until       DATE,                                       -- Estimate expiration date
  scope_description TEXT,                                       -- Detailed description of work scope
  photos            TEXT[],                                     -- Input photos used to generate the estimate (S3/R2 URLs)
  confidence_score  REAL,                                       -- AI confidence in the estimate accuracy (0.0 to 1.0)
  generated_by      TEXT DEFAULT 'manual',                      -- 'manual', 'agent', 'workflow'
  pdf_url           TEXT,                                       -- S3/R2 URL of the generated PDF
  notes             TEXT,                                       -- Internal or customer-visible notes
  metadata          JSONB DEFAULT '{}',                        -- Extensible metadata
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purpose: Estimates, proposals, and change orders. The Estimate Agent generates these from
-- photos + scope descriptions using historical pricing data and local market rates.
-- type distinguishes between a standard estimate, a formal proposal (larger/commercial jobs),
-- and a change order (mid-job scope/price adjustment).

CREATE INDEX idx_estimates_org_id ON estimates(org_id);
CREATE INDEX idx_estimates_org_status ON estimates(org_id, status);
CREATE INDEX idx_estimates_org_customer ON estimates(org_id, customer_id);
CREATE INDEX idx_estimates_created_at ON estimates(created_at DESC);
```

### 3.8 Parts (Inventory)

```sql
-- INVENTORY: Parts and materials tracked by the Inventory Agent
CREATE TABLE parts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id),
  name                TEXT NOT NULL,                            -- Part name ("1/2 inch copper elbow")
  sku                 TEXT,                                     -- SKU or part number
  category            TEXT,                                     -- 'pipe_fittings', 'electrical', 'hvac_components', etc.
  quantity_on_hand    DECIMAL(10,2) DEFAULT 0,                  -- Current stock level
  reorder_point       DECIMAL(10,2),                            -- When to reorder (Inventory Agent triggers alert below this)
  unit_cost           DECIMAL(10,2),                            -- Cost per unit
  preferred_supplier  TEXT,                                     -- Default supplier name
  supplier_data       JSONB DEFAULT '{}',                      -- Supplier comparison data (see JSONB schemas below)
  metadata            JSONB DEFAULT '{}',                      -- Extensible metadata
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purpose: Tracks parts inventory. The Inventory Agent deducts materials on job.completed,
-- monitors stock levels against reorder_point, and triggers reorder alerts.
-- supplier_data stores pricing from multiple suppliers for cost comparison.

CREATE INDEX idx_parts_org_id ON parts(org_id);
CREATE INDEX idx_parts_org_sku ON parts(org_id, sku);
CREATE INDEX idx_parts_org_category ON parts(org_id, category);
```

### 3.9 Agent Configs

```sql
-- AGENT CONFIGURATIONS: Per-org settings for each agent type
CREATE TABLE agent_configs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  agent_type        TEXT NOT NULL,                              -- 'invoice', 'estimate', 'collections', 'bookkeeping', 'insights', 'field-ops', 'compliance', 'inventory', 'customer'
  enabled           BOOLEAN DEFAULT true,                       -- Whether this agent is active for this org
  autonomy_rules    JSONB DEFAULT '{}',                        -- Configurable autonomy overrides (see JSONB schemas below)
  settings          JSONB DEFAULT '{}',                        -- Agent-specific config overrides (see JSONB schemas below)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, agent_type)                                   -- One config per agent type per org
);

-- Purpose: Each org can enable/disable agents and customize their autonomy rules.
-- The UNIQUE constraint ensures one config per agent per org.
-- Default configs are seeded during onboarding; the org customizes from there.

CREATE INDEX idx_agent_configs_org_id ON agent_configs(org_id);
```

### 3.10 Agent Executions

```sql
-- AGENT EXECUTIONS: Audit log of every agent action
-- This is the observability backbone. Every agent action is logged here.
CREATE TABLE agent_executions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  agent_type        TEXT NOT NULL,                              -- Which agent ran
  trigger_type      TEXT NOT NULL,                              -- 'event', 'chat', 'schedule', 'chain'
  trigger_source    TEXT,                                       -- What triggered it (event name, message ID, cron schedule, chain source)
  status            TEXT NOT NULL DEFAULT 'pending',            -- 'pending', 'running', 'awaiting_review', 'approved', 'rejected', 'completed', 'failed'
  input_data        JSONB,                                     -- Data the agent received
  output_data       JSONB,                                     -- Data the agent produced
  actions_taken     JSONB DEFAULT '[]',                        -- Array of actions: [{ type, target, data, timestamp }]
  confidence_score  REAL,                                       -- AI confidence in the output (0.0 to 1.0)
  reviewed_by       UUID REFERENCES profiles(id),               -- Who approved/rejected (null if auto-executed)
  reviewed_at       TIMESTAMPTZ,                                -- When the review happened
  error             TEXT,                                       -- Error message if failed
  duration_ms       INTEGER,                                    -- Total execution time in milliseconds
  ai_model_used     TEXT,                                       -- Which AI model was used (e.g., 'claude-sonnet-4.6')
  ai_tokens_used    INTEGER,                                    -- Total tokens consumed
  ai_cost_cents     INTEGER,                                    -- Estimated cost in cents
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ                                 -- When the execution finished (null if still running)
);

-- Purpose: Complete audit trail of every agent action. Powers the dashboard's agent activity feed,
-- the review queue, cost tracking, and analytics. Every single thing an agent does is recorded here.
-- The status lifecycle is: pending -> running -> completed/failed OR running -> awaiting_review -> approved/rejected -> completed.

CREATE INDEX idx_agent_executions_org_id ON agent_executions(org_id);
CREATE INDEX idx_agent_executions_org_status ON agent_executions(org_id, status);
CREATE INDEX idx_agent_executions_org_agent ON agent_executions(org_id, agent_type);
CREATE INDEX idx_agent_executions_created_at ON agent_executions(created_at DESC);
CREATE INDEX idx_agent_executions_org_review ON agent_executions(org_id, status) WHERE status = 'awaiting_review';
```

### 3.11 Conversations

```sql
-- AI COPILOT: Conversations
CREATE TABLE conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  user_id           UUID NOT NULL REFERENCES profiles(id),     -- Which user owns this conversation
  title             TEXT,                                       -- Auto-generated or user-set conversation title
  summary           TEXT,                                       -- AI-generated summary for medium-term memory (replaces old messages in context)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purpose: Groups copilot messages into conversations. Each user has their own conversations.
-- The summary field stores an AI-generated summary of older messages when the conversation
-- exceeds a token threshold, enabling medium-term memory without sending the full history.

CREATE INDEX idx_conversations_org_id ON conversations(org_id);
CREATE INDEX idx_conversations_user ON conversations(org_id, user_id);
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);
```

### 3.12 Messages

```sql
-- AI COPILOT: Messages within conversations
CREATE TABLE messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,  -- Parent conversation
  org_id              UUID NOT NULL REFERENCES organizations(id),                    -- Denormalized for RLS
  role                TEXT NOT NULL,                              -- 'user', 'assistant', 'system'
  content             TEXT NOT NULL,                              -- Message text
  intent              TEXT,                                       -- Classified intent (e.g., 'create-invoice', 'check-status')
  agents_dispatched   TEXT[],                                     -- Which agents were triggered by this message
  execution_ids       UUID[],                                     -- References to agent_executions.id for traceability
  metadata            JSONB DEFAULT '{}',                        -- Extensible metadata (e.g., streaming state, attachments)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purpose: Individual messages in copilot conversations. org_id is denormalized (also on conversation)
-- for efficient RLS policies. intent and agents_dispatched provide traceability -- you can see
-- exactly which intent was classified and which agents were triggered for any user message.
-- ON DELETE CASCADE: Messages are deleted when their parent conversation is deleted.

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_org_id ON messages(org_id);
```

### 3.13 Workflows

```sql
-- CUSTOM WORKFLOWS: User-defined or AI-generated automation sequences
CREATE TABLE workflows (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  name              TEXT NOT NULL,                              -- Workflow display name
  description       TEXT,                                       -- Human-readable description
  trigger           JSONB NOT NULL,                             -- Trigger definition (see JSONB schemas below)
  steps             JSONB NOT NULL DEFAULT '[]',               -- Step sequence (see JSONB schemas below)
  enabled           BOOLEAN DEFAULT true,                       -- Whether this workflow is active
  created_by        UUID REFERENCES profiles(id),               -- Who created it
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purpose: Custom automations that chain agents together based on trigger conditions.
-- Can be created via the visual workflow builder or described in natural language to the copilot.
-- Example: "When a job over $5,000 completes, send owner a margin breakdown text and queue a review request for 48h later."

CREATE INDEX idx_workflows_org_id ON workflows(org_id);
CREATE INDEX idx_workflows_org_enabled ON workflows(org_id, enabled) WHERE enabled = true;
```

### 3.14 Workflow Executions

```sql
-- WORKFLOW EXECUTIONS: Tracking each workflow run
CREATE TABLE workflow_executions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  workflow_id       UUID NOT NULL REFERENCES workflows(id),    -- Which workflow ran
  trigger_data      JSONB,                                     -- Data that triggered this execution
  status            TEXT NOT NULL DEFAULT 'running',            -- 'running', 'completed', 'failed', 'paused'
  current_step      TEXT,                                       -- ID of the step currently executing
  step_results      JSONB DEFAULT '{}',                        -- Results from each completed step: { "step_id": result }
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,                                -- When the workflow finished
  error             TEXT                                        -- Error message if failed
);

-- Purpose: Tracks the state of each workflow run. step_results accumulates results as each
-- step completes, enabling conditional logic in later steps based on earlier results.

CREATE INDEX idx_workflow_executions_org_id ON workflow_executions(org_id);
CREATE INDEX idx_workflow_executions_org_status ON workflow_executions(org_id, status);
CREATE INDEX idx_workflow_executions_workflow ON workflow_executions(workflow_id);
```

### 3.15 Business Context

```sql
-- BUSINESS CONTEXT: Learned preferences and knowledge per org
-- This is what makes the AI "know" the business and get smarter over time.
CREATE TABLE business_context (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  category          TEXT NOT NULL,                              -- 'pricing', 'customer', 'operational', 'preference'
  key               TEXT NOT NULL,                              -- Specific knowledge key (e.g., 'avg_hvac_service_call_price')
  value             JSONB NOT NULL,                             -- The learned value (structured data)
  confidence        REAL DEFAULT 1.0,                           -- How confident the system is in this data (0.0 to 1.0)
  source            TEXT,                                       -- How this was learned: 'onboarding', 'agent_observation', 'user_correction', 'analysis'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, category, key)                                -- One value per category+key per org
);

-- Purpose: The business knowledge graph. Stores everything the AI has learned about a specific
-- business: pricing patterns, customer preferences, operational norms, owner preferences.
-- This data is injected into agent prompts and copilot context to personalize AI behavior.
--
-- Examples:
-- ('pricing', 'avg_service_call_price', {"amount": 250, "currency": "USD"}, 0.92, 'agent_observation')
-- ('preference', 'invoice_rounding', {"rule": "nearest_50"}, 1.0, 'user_correction')
-- ('customer', 'johnson_schedule_preference', {"avoid": ["monday"]}, 0.85, 'agent_observation')
-- ('operational', 'peak_season', {"months": [6, 7, 8], "demand_increase": 0.4}, 0.88, 'analysis')

CREATE INDEX idx_business_context_org_id ON business_context(org_id);
CREATE INDEX idx_business_context_org_category ON business_context(org_id, category);
```

### 3.16 Notifications

```sql
-- NOTIFICATIONS: In-app, email, SMS, push notifications + audit log
CREATE TABLE notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  user_id           UUID REFERENCES profiles(id),              -- Target user (null = org-wide notification)
  type              TEXT NOT NULL,                              -- 'agent_action', 'review_needed', 'alert', 'digest', 'system'
  title             TEXT NOT NULL,                              -- Notification headline
  body              TEXT,                                       -- Notification body text
  channel           TEXT NOT NULL,                              -- 'in_app', 'email', 'sms', 'push'
  read              BOOLEAN DEFAULT false,                      -- Whether the user has read/dismissed this
  action_url        TEXT,                                       -- Deep link URL (e.g., /invoices/uuid, /agents/review-queue)
  metadata          JSONB DEFAULT '{}',                        -- Extensible metadata (agent_type, execution_id, etc.)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purpose: All notifications generated by agents, workflows, or the system. The dashboard
-- shows unread notifications. The digest agent compiles daily/weekly summaries from these.

CREATE INDEX idx_notifications_org_id ON notifications(org_id);
CREATE INDEX idx_notifications_user_unread ON notifications(org_id, user_id, read) WHERE read = false;
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
```

### 3.17 Embeddings (Vector Store)

```sql
-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- VECTOR STORE: Business data embeddings for semantic search
CREATE TABLE embeddings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  source_type       TEXT NOT NULL,                              -- 'job', 'invoice', 'customer', 'conversation', 'note', 'estimate'
  source_id         UUID NOT NULL,                              -- ID of the source record
  content           TEXT NOT NULL,                              -- The text that was embedded (stored for display in search results)
  embedding         vector(1024),                               -- Voyage-finance-2 embeddings = 1024 dimensions
  metadata          JSONB DEFAULT '{}',                        -- Extensible metadata (date, tags, etc.)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purpose: Stores vector embeddings of business data for semantic search via the AI copilot.
-- When a user asks "what was that Henderson job about?" the copilot queries this table using
-- vector similarity to find relevant past jobs, invoices, customers, and conversations.
-- This is the long-term memory layer for the AI.

CREATE INDEX idx_embeddings_org_id ON embeddings(org_id);
CREATE INDEX idx_embeddings_org_source ON embeddings(org_id, source_type);
CREATE INDEX idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### 3.18 Training Data (Anonymized)

```sql
-- ANONYMIZED TRAINING DATA: For model fine-tuning
-- PII is stripped before insertion. This data trains trade-specific AI models.
CREATE TABLE training_data (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_type         TEXT NOT NULL,                              -- 'invoice', 'estimate', 'job', 'collection', 'pricing', 'scheduling'
  trade_type        TEXT NOT NULL,                              -- 'hvac', 'plumbing', 'electrical', etc.
  region            TEXT,                                       -- State or metro area (for regional pricing models)
  data              JSONB NOT NULL,                             -- Anonymized record (see JSONB schemas below)
  org_hash          TEXT NOT NULL,                              -- One-way hash of org_id (for dedup, NOT identification)
  quality_score     REAL,                                       -- Data quality rating (0.0 to 1.0)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purpose: Anonymized business data collected from agent executions for model training.
-- This is the data moat -- 10K HVAC jobs = pricing knowledge no competitor can replicate.
-- PII is stripped by the anonymization worker before insertion.
-- org_hash is a one-way hash -- it cannot be reversed to identify the business.

CREATE INDEX idx_training_data_type_trade ON training_data(data_type, trade_type);
CREATE INDEX idx_training_data_type_trade_region ON training_data(data_type, trade_type, region);
```

### 3.19 Data Consent

```sql
-- DATA COLLECTION CONSENT: Opt-in for training data collection
CREATE TABLE data_consent (
  org_id              UUID PRIMARY KEY REFERENCES organizations(id),  -- One consent record per org
  consented           BOOLEAN DEFAULT false,                          -- Whether the org has opted in
  consented_at        TIMESTAMPTZ,                                    -- When they consented
  consent_version     TEXT,                                           -- Which terms version they agreed to (e.g., '2026-03-01')
  data_types_allowed  TEXT[],                                         -- Which data types they allow: ['invoice', 'estimate', 'job', ...]
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purpose: GDPR/CCPA compliant consent tracking. Organizations must opt in before their
-- data is anonymized and collected for training. They can choose which data types to share
-- and can revoke consent at any time (triggers deletion of their training data contributions).
```

### 3.20 Training Runs

```sql
-- MODEL TRAINING RUNS: Tracks what models were trained on what data
-- This is NOT org-scoped -- it's a global table for the CrewShift platform.
CREATE TABLE training_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name        TEXT NOT NULL,                              -- e.g., 'crewshift-pricing-hvac-v1'
  model_version     TEXT NOT NULL,                              -- e.g., '1.0.0'
  data_types_used   TEXT[],                                     -- Which data types were used in training
  record_count      INTEGER,                                    -- How many training records were used
  metrics           JSONB,                                     -- Training metrics: { accuracy, loss, eval_score, etc. }
  status            TEXT DEFAULT 'pending',                      -- 'pending', 'running', 'completed', 'failed'
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purpose: Tracks model training runs for auditability. When a fine-tuned model is trained,
-- this records what data it was trained on, how many records, and what metrics it achieved.
```

---

## 4. Database Indexes

### Index Strategy

All indexes are designed around common query patterns:

| Index Type | Purpose | Examples |
|---|---|---|
| **org_id on every tenant table** | Multi-tenant filtering -- every query starts with `WHERE org_id = $1` | `idx_jobs_org_id`, `idx_invoices_org_id`, etc. |
| **org_id + status composite** | List entities by status within an org (the most common dashboard query) | `idx_jobs_org_status`, `idx_invoices_org_status` |
| **org_id + foreign key composite** | Filter by related entity within an org | `idx_jobs_org_customer`, `idx_invoices_org_customer` |
| **created_at DESC** | Sort by newest first (default sort for list endpoints) | `idx_jobs_created_at`, `idx_invoices_created_at` |
| **due_date on invoices** | Collections Agent queries overdue invoices by due_date | `idx_invoices_org_due_date` |
| **Partial index for review queue** | Fast lookup of items awaiting review (small subset of total) | `idx_agent_executions_org_review WHERE status = 'awaiting_review'` |
| **Partial index for unread notifications** | Fast lookup of unread notifications per user | `idx_notifications_user_unread WHERE read = false` |
| **Partial index for enabled workflows** | Only query enabled workflows for trigger matching | `idx_workflows_org_enabled WHERE enabled = true` |
| **IVFFlat on embeddings** | Approximate nearest neighbor search for vector similarity | `idx_embeddings_vector USING ivfflat` |
| **Unique constraints** | Prevent duplicates | `integrations(org_id, provider)`, `agent_configs(org_id, agent_type)`, `business_context(org_id, category, key)` |

### Complete Index List

```sql
-- Profiles
CREATE INDEX idx_profiles_org_id ON profiles(org_id);

-- Integrations
CREATE INDEX idx_integrations_org_id ON integrations(org_id);
CREATE UNIQUE INDEX idx_integrations_org_provider ON integrations(org_id, provider);

-- Customers
CREATE INDEX idx_customers_org_id ON customers(org_id);
CREATE INDEX idx_customers_org_name ON customers(org_id, name);
CREATE INDEX idx_customers_org_email ON customers(org_id, email);

-- Jobs
CREATE INDEX idx_jobs_org_id ON jobs(org_id);
CREATE INDEX idx_jobs_org_status ON jobs(org_id, status);
CREATE INDEX idx_jobs_org_customer ON jobs(org_id, customer_id);
CREATE INDEX idx_jobs_org_tech ON jobs(org_id, assigned_tech_id);
CREATE INDEX idx_jobs_org_scheduled ON jobs(org_id, scheduled_start);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);

-- Invoices
CREATE INDEX idx_invoices_org_id ON invoices(org_id);
CREATE INDEX idx_invoices_org_status ON invoices(org_id, status);
CREATE INDEX idx_invoices_org_customer ON invoices(org_id, customer_id);
CREATE INDEX idx_invoices_org_due_date ON invoices(org_id, due_date);
CREATE INDEX idx_invoices_created_at ON invoices(created_at DESC);
CREATE INDEX idx_invoices_org_job ON invoices(org_id, job_id);

-- Estimates
CREATE INDEX idx_estimates_org_id ON estimates(org_id);
CREATE INDEX idx_estimates_org_status ON estimates(org_id, status);
CREATE INDEX idx_estimates_org_customer ON estimates(org_id, customer_id);
CREATE INDEX idx_estimates_created_at ON estimates(created_at DESC);

-- Parts
CREATE INDEX idx_parts_org_id ON parts(org_id);
CREATE INDEX idx_parts_org_sku ON parts(org_id, sku);
CREATE INDEX idx_parts_org_category ON parts(org_id, category);

-- Agent Configs
CREATE INDEX idx_agent_configs_org_id ON agent_configs(org_id);

-- Agent Executions
CREATE INDEX idx_agent_executions_org_id ON agent_executions(org_id);
CREATE INDEX idx_agent_executions_org_status ON agent_executions(org_id, status);
CREATE INDEX idx_agent_executions_org_agent ON agent_executions(org_id, agent_type);
CREATE INDEX idx_agent_executions_created_at ON agent_executions(created_at DESC);
CREATE INDEX idx_agent_executions_org_review ON agent_executions(org_id, status) WHERE status = 'awaiting_review';

-- Conversations
CREATE INDEX idx_conversations_org_id ON conversations(org_id);
CREATE INDEX idx_conversations_user ON conversations(org_id, user_id);
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);

-- Messages
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_org_id ON messages(org_id);

-- Workflows
CREATE INDEX idx_workflows_org_id ON workflows(org_id);
CREATE INDEX idx_workflows_org_enabled ON workflows(org_id, enabled) WHERE enabled = true;

-- Workflow Executions
CREATE INDEX idx_workflow_executions_org_id ON workflow_executions(org_id);
CREATE INDEX idx_workflow_executions_org_status ON workflow_executions(org_id, status);
CREATE INDEX idx_workflow_executions_workflow ON workflow_executions(workflow_id);

-- Business Context
CREATE INDEX idx_business_context_org_id ON business_context(org_id);
CREATE INDEX idx_business_context_org_category ON business_context(org_id, category);

-- Notifications
CREATE INDEX idx_notifications_org_id ON notifications(org_id);
CREATE INDEX idx_notifications_user_unread ON notifications(org_id, user_id, read) WHERE read = false;
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);

-- Embeddings
CREATE INDEX idx_embeddings_org_id ON embeddings(org_id);
CREATE INDEX idx_embeddings_org_source ON embeddings(org_id, source_type);
CREATE INDEX idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Training Data
CREATE INDEX idx_training_data_type_trade ON training_data(data_type, trade_type);
CREATE INDEX idx_training_data_type_trade_region ON training_data(data_type, trade_type, region);
```

---

## 5. Row-Level Security (RLS)

### RLS Strategy

Every tenant-scoped table uses `org_id` for isolation. Rather than joining `profiles` on every query, `org_id` is embedded as a custom JWT claim during login. This is set via a Supabase Edge Function or database trigger when the user authenticates.

### Helper Function

```sql
-- Extract org_id from JWT custom claims
-- Used by all RLS policies to get the current user's org
CREATE OR REPLACE FUNCTION auth.org_id() RETURNS UUID AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id')::uuid;
$$ LANGUAGE sql STABLE;
```

### RLS Enable Statements (ALL Tables with org_id)

```sql
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_consent ENABLE ROW LEVEL SECURITY;
```

### Standard RLS Policy Template

Applied to every tenant-scoped table. Example for `customers`:

```sql
CREATE POLICY "org_isolation_select" ON customers
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON customers
  FOR INSERT WITH CHECK (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON customers
  FOR UPDATE USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_delete" ON customers
  FOR DELETE USING (org_id = auth.org_id());
```

Apply the exact same four policies to: `jobs`, `invoices`, `estimates`, `parts`, `agent_configs`, `agent_executions`, `conversations`, `messages`, `workflows`, `workflow_executions`, `business_context`, `notifications`, `embeddings`, `integrations`, `data_consent`.

### Special Cases

**`organizations` table:** Users can only see their own org.
```sql
CREATE POLICY "org_self_select" ON organizations
  FOR SELECT USING (id = auth.org_id());
CREATE POLICY "org_self_update" ON organizations
  FOR UPDATE USING (id = auth.org_id());
```

**`profiles` table:** Users can see all profiles in their org.
```sql
CREATE POLICY "org_isolation_select" ON profiles
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "profile_self_update" ON profiles
  FOR UPDATE USING (id = auth.uid());  -- Users can only update their own profile
```

**`training_data` table:** RLS prevents direct client access. Training data is only written by the anonymization worker (service-role) and read by the training pipeline (service-role). No client-side access.

**`training_runs` table:** Not org-scoped. No RLS policies. Accessed only by the platform admin (service-role).

### Service-Role Bypass

BullMQ workers and internal operations use the Supabase **service-role key**, which bypasses RLS entirely. These must ALWAYS include `WHERE org_id = $1` in queries -- enforced at the repository layer, not by RLS. This is a critical safety rule: every repository method that accepts service-role context must require `orgId` as a parameter.

---

## 6. JSONB Column Schemas

### `organizations.settings`

```typescript
interface OrgSettings {
  timezone?: string;                    // e.g., 'America/Phoenix'
  currency?: string;                    // e.g., 'USD'
  default_tax_rate?: number;            // e.g., 0.0825 (8.25%)
  invoice_prefix?: string;             // e.g., 'INV'
  estimate_prefix?: string;            // e.g., 'EST'
  payment_terms_days?: number;          // Default days until invoice due (e.g., 30)
  business_hours?: {
    start: string;                      // e.g., '08:00'
    end: string;                        // e.g., '17:00'
    days: string[];                     // e.g., ['mon', 'tue', 'wed', 'thu', 'fri']
  };
  notification_preferences?: {
    email_digest: 'daily' | 'weekly' | 'none';
    sms_alerts: boolean;
    push_notifications: boolean;
  };
}
```

### `customers.address` and `jobs.address`

```typescript
interface Address {
  street?: string;                      // e.g., '123 Main St'
  street2?: string;                     // e.g., 'Suite 4B'
  city?: string;                        // e.g., 'Phoenix'
  state?: string;                       // e.g., 'AZ'
  zip?: string;                         // e.g., '85001'
  country?: string;                     // e.g., 'US' (defaults to US)
  lat?: number;                         // Latitude for routing/mapping
  lng?: number;                         // Longitude for routing/mapping
}
```

### `customers.external_ids`, `jobs.external_ids`, `invoices.external_ids`, `estimates.external_ids`

```typescript
interface ExternalIds {
  [provider: string]: string;           // Provider name -> external ID
  // Examples:
  // quickbooks?: string;               // "123"
  // jobber?: string;                   // "456"
  // servicetitan?: string;             // "789"
  // stripe?: string;                   // "cus_abc123"
}
```

### `jobs.line_items` and `invoices.line_items` and `estimates.line_items`

```typescript
interface LineItem {
  description: string;                  // "Install 3-ton AC condenser unit"
  quantity: number;                     // 1
  unit_price: number;                   // 2500.00
  total: number;                        // 2500.00 (quantity * unit_price)
  type?: 'labor' | 'material' | 'other'; // Optional categorization
}
// Stored as JSON array: LineItem[]
```

### `jobs.materials`

```typescript
interface MaterialUsed {
  part_name: string;                    // "1/2 inch copper elbow"
  part_id?: string;                     // UUID reference to parts table (optional)
  quantity: number;                     // 4
  unit_cost: number;                    // 3.50
}
// Stored as JSON array: MaterialUsed[]
```

### `integrations.metadata`

```typescript
// Varies by provider:

// QuickBooks
interface QBOMetadata {
  realm_id: string;                     // QBO company ID
  sandbox: boolean;                     // Whether this is a sandbox account
  minor_version: string;                // QBO API minor version
  last_sync_cursor?: string;            // Pagination cursor for incremental sync
}

// Stripe
interface StripeMetadata {
  account_id?: string;                  // Stripe Connect account ID (if applicable)
  default_currency: string;             // e.g., 'usd'
}

// Jobber
interface JobberMetadata {
  company_id: string;                   // Jobber company ID
  webhook_secret: string;               // For verifying inbound webhooks
}
```

### `agent_configs.autonomy_rules`

```typescript
interface AutonomyRulesConfig {
  auto: string[];                       // Actions that execute without review
  review: string[];                     // Actions that go to the review queue
  escalate: string[];                   // Actions that flag and stop
  thresholds?: {
    amount_over?: number;               // Review if amount > X (dollars)
    confidence_below?: number;          // Review if AI confidence < X (0.0 to 1.0)
  };
}

// Example:
// {
//   "auto": ["create_invoice where total < 500 AND confidence > 0.9", "generate_pdf"],
//   "review": ["create_invoice where total >= 500", "send_to_customer"],
//   "escalate": ["create_invoice where confidence < 0.6"],
//   "thresholds": { "amount_over": 500, "confidence_below": 0.9 }
// }
```

### `agent_configs.settings`

```typescript
// Varies by agent type. Examples:

// Invoice Agent settings
interface InvoiceAgentSettings {
  auto_sync_to_quickbooks?: boolean;    // Auto-sync created invoices to QBO
  default_payment_terms?: number;       // Days until due (overrides org default)
  include_materials_breakdown?: boolean; // Whether to itemize materials on invoices
}

// Collections Agent settings
interface CollectionsAgentSettings {
  first_reminder_days?: number;         // Days after due_date for first reminder (default: 3)
  escalation_intervals?: number[];      // Days between escalations (default: [7, 14, 30])
  auto_send_reminders?: boolean;        // Whether to send reminders automatically
  lien_tracking_enabled?: boolean;      // Track lien filing deadlines
}
```

### `workflows.trigger`

```typescript
interface WorkflowTrigger {
  type: 'event' | 'schedule' | 'manual';
  event?: string;                       // e.g., 'job.completed'
  conditions?: {
    field: string;                      // e.g., 'job.total_amount'
    operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'contains';
    value: any;                         // e.g., 5000
  }[];
  cron?: string;                        // e.g., '0 9 * * 1' (Mondays at 9 AM)
}

// Example:
// { "type": "event", "event": "job.completed", "conditions": [{ "field": "job.total_amount", "operator": "gt", "value": 5000 }] }
```

### `workflows.steps`

```typescript
interface WorkflowStep {
  id: string;                           // Unique step ID within the workflow
  agent_type: string;                   // Which agent to invoke: 'invoice', 'customer', etc.
  action: string;                       // What action to perform: 'generate', 'send', 'notify'
  params: Record<string, any>;          // Action-specific parameters
  delay?: string;                       // Optional delay before execution: '24h', '48h', '5m'
  condition?: {                         // Optional condition to skip this step
    field: string;
    operator: string;
    value: any;
  };
}
// Stored as JSON array: WorkflowStep[]
```

### `parts.supplier_data`

```typescript
interface SupplierEntry {
  supplier_name: string;                // "Ferguson Supply"
  price: number;                        // 3.25
  lead_time_days: number;               // 2
  last_checked: string;                 // ISO date
  url?: string;                         // Supplier catalog URL
}
// Stored as JSON array: SupplierEntry[]
```

### `training_data.data`

```typescript
// Varies by data_type. All PII is stripped. Examples:

// data_type: 'invoice'
interface AnonymizedInvoiceData {
  line_items: { description: string; quantity: number; unit_price: number; total: number }[];
  subtotal: number;
  tax_rate: number;
  total: number;
  job_type: string;                     // 'service_call', 'install', etc.
  payment_days: number;                 // Days between sent and paid
  season: string;                       // 'winter', 'spring', 'summer', 'fall'
  day_of_week: string;                  // 'monday', 'tuesday', etc.
}

// data_type: 'estimate'
interface AnonymizedEstimateData {
  line_items: { description: string; quantity: number; unit_price: number; total: number }[];
  total: number;
  accepted: boolean;                    // Whether the estimate was accepted
  confidence_score: number;
  job_type: string;
  response_days: number;                // Days until customer responded
}
```

---

## 7. Full-Text Search Setup

For searchable entities (customers, jobs, invoices, estimates), PostgreSQL `tsvector` columns can be added for efficient full-text search. This is separate from the vector/semantic search used by the copilot.

```sql
-- Example: Add full-text search to customers
ALTER TABLE customers ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(notes, ''))
  ) STORED;

CREATE INDEX idx_customers_search ON customers USING gin(search_vector);

-- Query example:
-- SELECT * FROM customers WHERE org_id = $1 AND search_vector @@ to_tsquery('english', 'henderson');

-- Similar pattern for jobs (description, notes), invoices (invoice_number, notes), estimates (scope_description, notes)
```

This approach is used for the `search` query parameter on list endpoints. It is NOT the same as the copilot's semantic search, which uses vector similarity on the `embeddings` table.
