-- =============================================================================
-- CrewShift Initial Schema Migration
-- =============================================================================
-- Creates all tables, indexes, RLS policies, triggers, and functions for the
-- entire CrewShift application. This migration is idempotent-safe for
-- extensions and functions (CREATE OR REPLACE / IF NOT EXISTS).
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- =============================================================================
-- 2. HELPER FUNCTION: auth.org_id()
-- =============================================================================
-- Extracts org_id from Supabase JWT custom claims. Used by every RLS policy
-- for multi-tenant isolation. Returns a nil UUID fallback if the claim is
-- missing (prevents errors for unauthenticated / service-role contexts).

CREATE OR REPLACE FUNCTION auth.org_id() RETURNS UUID AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id')::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  );
$$ LANGUAGE sql STABLE;

-- =============================================================================
-- 3. TRIGGER FUNCTION: update_updated_at()
-- =============================================================================
-- Automatically sets updated_at = NOW() on every UPDATE. Attached to all
-- tables that carry an updated_at column.

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 4. TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 4.1 organizations
-- -----------------------------------------------------------------------------
-- Multi-tenant root. Every other table references organizations.id.

CREATE TABLE organizations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  trade_type        TEXT NOT NULL,
  size              TEXT,
  tier              TEXT NOT NULL DEFAULT 'starter',
  onboarding_status TEXT NOT NULL DEFAULT 'not_started',
  settings          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4.2 profiles
-- -----------------------------------------------------------------------------
-- Extends Supabase auth.users with app-specific role and org membership.

CREATE TABLE profiles (
  id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id            UUID NOT NULL REFERENCES organizations(id),
  full_name         TEXT,
  role              TEXT NOT NULL DEFAULT 'member',
  phone             TEXT,
  avatar_url        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4.3 integrations
-- -----------------------------------------------------------------------------
-- OAuth tokens and sync state for connected external tools.
-- access_token and refresh_token are encrypted via pgcrypto at the app layer.

CREATE TABLE integrations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id),
  provider            TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  access_token        TEXT,
  refresh_token       TEXT,
  token_expires_at    TIMESTAMPTZ,
  external_account_id TEXT,
  metadata            JSONB DEFAULT '{}',
  last_sync_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4.4 customers
-- -----------------------------------------------------------------------------
-- Unified customer record aggregated from all connected tools.

CREATE TABLE customers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  external_ids      JSONB DEFAULT '{}',
  name              TEXT NOT NULL,
  email             TEXT,
  phone             TEXT,
  address           JSONB,
  tags              TEXT[],
  notes             TEXT,
  payment_score     REAL,
  lifetime_value    DECIMAL(12,2),
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4.5 jobs
-- -----------------------------------------------------------------------------
-- A job represents a unit of work: service call, install, maintenance, etc.

CREATE TABLE jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  customer_id       UUID REFERENCES customers(id),
  external_ids      JSONB DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'pending',
  type              TEXT,
  description       TEXT,
  scheduled_start   TIMESTAMPTZ,
  scheduled_end     TIMESTAMPTZ,
  actual_start      TIMESTAMPTZ,
  actual_end        TIMESTAMPTZ,
  assigned_tech_id  UUID REFERENCES profiles(id),
  address           JSONB,
  line_items        JSONB DEFAULT '[]',
  materials         JSONB DEFAULT '[]',
  labor_hours       DECIMAL(6,2),
  total_amount      DECIMAL(12,2),
  margin            DECIMAL(5,2),
  notes             TEXT,
  photos            TEXT[],
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4.6 invoices
-- -----------------------------------------------------------------------------
-- Generated by Invoice Agent or created manually.

CREATE TABLE invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  job_id            UUID REFERENCES jobs(id),
  customer_id       UUID REFERENCES customers(id),
  external_ids      JSONB DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'draft',
  invoice_number    TEXT,
  line_items        JSONB NOT NULL DEFAULT '[]',
  subtotal          DECIMAL(12,2),
  tax_rate          DECIMAL(5,4),
  tax_amount        DECIMAL(12,2),
  total             DECIMAL(12,2),
  due_date          DATE,
  sent_at           TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  payment_method    TEXT,
  generated_by      TEXT DEFAULT 'manual',
  pdf_url           TEXT,
  notes             TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4.7 estimates
-- -----------------------------------------------------------------------------
-- Estimates, proposals, and change orders generated by Estimate Agent or manual.

CREATE TABLE estimates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  customer_id       UUID REFERENCES customers(id),
  external_ids      JSONB DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'draft',
  estimate_number   TEXT,
  type              TEXT DEFAULT 'estimate',
  line_items        JSONB NOT NULL DEFAULT '[]',
  subtotal          DECIMAL(12,2),
  tax_amount        DECIMAL(12,2),
  total             DECIMAL(12,2),
  valid_until       DATE,
  scope_description TEXT,
  photos            TEXT[],
  confidence_score  REAL,
  generated_by      TEXT DEFAULT 'manual',
  pdf_url           TEXT,
  notes             TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4.8 parts (inventory)
-- -----------------------------------------------------------------------------
-- Parts and materials tracked by the Inventory Agent.

CREATE TABLE parts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id),
  name                TEXT NOT NULL,
  sku                 TEXT,
  category            TEXT,
  quantity_on_hand    DECIMAL(10,2) DEFAULT 0,
  reorder_point       DECIMAL(10,2),
  unit_cost           DECIMAL(10,2),
  preferred_supplier  TEXT,
  supplier_data       JSONB DEFAULT '{}',
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4.9 agent_configs
-- -----------------------------------------------------------------------------
-- Per-org settings for each agent type. One config per agent per org.

CREATE TABLE agent_configs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  agent_type        TEXT NOT NULL,
  enabled           BOOLEAN DEFAULT true,
  autonomy_rules    JSONB DEFAULT '{}',
  settings          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, agent_type)
);

-- -----------------------------------------------------------------------------
-- 4.10 agent_executions
-- -----------------------------------------------------------------------------
-- Audit log of every agent action. Immutable records.

CREATE TABLE agent_executions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  agent_type        TEXT NOT NULL,
  trigger_type      TEXT NOT NULL,
  trigger_source    TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  input_data        JSONB,
  output_data       JSONB,
  actions_taken     JSONB DEFAULT '[]',
  confidence_score  REAL,
  reviewed_by       UUID REFERENCES profiles(id),
  reviewed_at       TIMESTAMPTZ,
  error             TEXT,
  duration_ms       INTEGER,
  ai_model_used     TEXT,
  ai_tokens_used    INTEGER,
  ai_cost_cents     INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

-- -----------------------------------------------------------------------------
-- 4.11 conversations
-- -----------------------------------------------------------------------------
-- AI copilot conversations grouped per user.

CREATE TABLE conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  user_id           UUID NOT NULL REFERENCES profiles(id),
  title             TEXT,
  summary           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4.12 messages
-- -----------------------------------------------------------------------------
-- Individual messages within copilot conversations.
-- ON DELETE CASCADE: messages removed when parent conversation is deleted.

CREATE TABLE messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  org_id              UUID NOT NULL REFERENCES organizations(id),
  role                TEXT NOT NULL,
  content             TEXT NOT NULL,
  intent              TEXT,
  agents_dispatched   TEXT[],
  execution_ids       UUID[],
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4.13 workflows
-- -----------------------------------------------------------------------------
-- User-defined or AI-generated automation sequences.

CREATE TABLE workflows (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  name              TEXT NOT NULL,
  description       TEXT,
  trigger           JSONB NOT NULL,
  steps             JSONB NOT NULL DEFAULT '[]',
  enabled           BOOLEAN DEFAULT true,
  created_by        UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4.14 workflow_executions
-- -----------------------------------------------------------------------------
-- Tracks each workflow run and its step results.

CREATE TABLE workflow_executions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  workflow_id       UUID NOT NULL REFERENCES workflows(id),
  trigger_data      JSONB,
  status            TEXT NOT NULL DEFAULT 'running',
  current_step      TEXT,
  step_results      JSONB DEFAULT '{}',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  error             TEXT
);

-- -----------------------------------------------------------------------------
-- 4.15 business_context
-- -----------------------------------------------------------------------------
-- Learned preferences and knowledge per org. One value per category+key per org.

CREATE TABLE business_context (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  category          TEXT NOT NULL,
  key               TEXT NOT NULL,
  value             JSONB NOT NULL,
  confidence        REAL DEFAULT 1.0,
  source            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, category, key)
);

-- -----------------------------------------------------------------------------
-- 4.16 notifications
-- -----------------------------------------------------------------------------
-- In-app, email, SMS, and push notifications with audit trail.

CREATE TABLE notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  user_id           UUID REFERENCES profiles(id),
  type              TEXT NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT,
  channel           TEXT NOT NULL,
  read              BOOLEAN DEFAULT false,
  action_url        TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4.17 embeddings (vector store)
-- -----------------------------------------------------------------------------
-- Business data embeddings for semantic search via AI copilot.
-- Uses Voyage-finance-2 embeddings (1024 dimensions).

CREATE TABLE embeddings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  source_type       TEXT NOT NULL,
  source_id         UUID NOT NULL,
  content           TEXT NOT NULL,
  embedding         vector(1024),
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4.18 training_data (anonymized)
-- -----------------------------------------------------------------------------
-- Anonymized business data for model fine-tuning. PII stripped before insertion.

CREATE TABLE training_data (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_type         TEXT NOT NULL,
  trade_type        TEXT NOT NULL,
  region            TEXT,
  data              JSONB NOT NULL,
  org_hash          TEXT NOT NULL,
  quality_score     REAL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4.19 data_consent
-- -----------------------------------------------------------------------------
-- GDPR/CCPA compliant consent tracking for training data collection.

CREATE TABLE data_consent (
  org_id              UUID PRIMARY KEY REFERENCES organizations(id),
  consented           BOOLEAN DEFAULT false,
  consented_at        TIMESTAMPTZ,
  consent_version     TEXT,
  data_types_allowed  TEXT[],
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4.20 training_runs (global, NOT org-scoped)
-- -----------------------------------------------------------------------------
-- Tracks model training runs for auditability. Platform-level table.

CREATE TABLE training_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name        TEXT NOT NULL,
  model_version     TEXT NOT NULL,
  data_types_used   TEXT[],
  record_count      INTEGER,
  metrics           JSONB,
  status            TEXT DEFAULT 'pending',
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 5. INDEXES
-- =============================================================================

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

-- =============================================================================
-- 6. UPDATED_AT TRIGGERS
-- =============================================================================
-- Attach the update_updated_at() trigger to every table with an updated_at column.

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_estimates_updated_at
  BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_parts_updated_at
  BEFORE UPDATE ON parts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_agent_configs_updated_at
  BEFORE UPDATE ON agent_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_workflows_updated_at
  BEFORE UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_business_context_updated_at
  BEFORE UPDATE ON business_context
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- 7. ROW LEVEL SECURITY (RLS)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 7.1 organizations (special case: uses id = auth.org_id())
-- -----------------------------------------------------------------------------

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON organizations
  FOR SELECT USING (id = auth.org_id());
CREATE POLICY "org_isolation_update" ON organizations
  FOR UPDATE USING (id = auth.org_id());

-- INSERT: only during signup flow (handled by service role)
-- DELETE: not allowed via client (handled by service role if needed)

-- -----------------------------------------------------------------------------
-- 7.2 profiles (special case: org members can view, users update own profile)
-- -----------------------------------------------------------------------------

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON profiles
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON profiles
  FOR INSERT WITH CHECK (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON profiles
  FOR UPDATE USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_delete" ON profiles
  FOR DELETE USING (org_id = auth.org_id());

-- -----------------------------------------------------------------------------
-- 7.3 integrations
-- -----------------------------------------------------------------------------

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON integrations
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON integrations
  FOR INSERT WITH CHECK (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON integrations
  FOR UPDATE USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_delete" ON integrations
  FOR DELETE USING (org_id = auth.org_id());

-- -----------------------------------------------------------------------------
-- 7.4 customers
-- -----------------------------------------------------------------------------

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON customers
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON customers
  FOR INSERT WITH CHECK (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON customers
  FOR UPDATE USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_delete" ON customers
  FOR DELETE USING (org_id = auth.org_id());

-- -----------------------------------------------------------------------------
-- 7.5 jobs
-- -----------------------------------------------------------------------------

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON jobs
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON jobs
  FOR INSERT WITH CHECK (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON jobs
  FOR UPDATE USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_delete" ON jobs
  FOR DELETE USING (org_id = auth.org_id());

-- -----------------------------------------------------------------------------
-- 7.6 invoices
-- -----------------------------------------------------------------------------

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON invoices
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON invoices
  FOR INSERT WITH CHECK (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON invoices
  FOR UPDATE USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_delete" ON invoices
  FOR DELETE USING (org_id = auth.org_id());

-- -----------------------------------------------------------------------------
-- 7.7 estimates
-- -----------------------------------------------------------------------------

ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON estimates
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON estimates
  FOR INSERT WITH CHECK (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON estimates
  FOR UPDATE USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_delete" ON estimates
  FOR DELETE USING (org_id = auth.org_id());

-- -----------------------------------------------------------------------------
-- 7.8 parts
-- -----------------------------------------------------------------------------

ALTER TABLE parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON parts
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON parts
  FOR INSERT WITH CHECK (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON parts
  FOR UPDATE USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_delete" ON parts
  FOR DELETE USING (org_id = auth.org_id());

-- -----------------------------------------------------------------------------
-- 7.9 agent_configs
-- -----------------------------------------------------------------------------

ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON agent_configs
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON agent_configs
  FOR INSERT WITH CHECK (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON agent_configs
  FOR UPDATE USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_delete" ON agent_configs
  FOR DELETE USING (org_id = auth.org_id());

-- -----------------------------------------------------------------------------
-- 7.10 agent_executions (no DELETE: immutable audit records)
-- -----------------------------------------------------------------------------

ALTER TABLE agent_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON agent_executions
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON agent_executions
  FOR INSERT WITH CHECK (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON agent_executions
  FOR UPDATE USING (org_id = auth.org_id());

-- No DELETE policy: agent executions are immutable audit records

-- -----------------------------------------------------------------------------
-- 7.11 conversations
-- -----------------------------------------------------------------------------

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON conversations
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON conversations
  FOR INSERT WITH CHECK (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON conversations
  FOR UPDATE USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_delete" ON conversations
  FOR DELETE USING (org_id = auth.org_id());

-- -----------------------------------------------------------------------------
-- 7.12 messages (no UPDATE or DELETE: append-only)
-- -----------------------------------------------------------------------------

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON messages
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON messages
  FOR INSERT WITH CHECK (org_id = auth.org_id());

-- No UPDATE or DELETE: messages are append-only

-- -----------------------------------------------------------------------------
-- 7.13 workflows
-- -----------------------------------------------------------------------------

ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON workflows
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON workflows
  FOR INSERT WITH CHECK (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON workflows
  FOR UPDATE USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_delete" ON workflows
  FOR DELETE USING (org_id = auth.org_id());

-- -----------------------------------------------------------------------------
-- 7.14 workflow_executions (no DELETE: historical records)
-- -----------------------------------------------------------------------------

ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON workflow_executions
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON workflow_executions
  FOR INSERT WITH CHECK (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON workflow_executions
  FOR UPDATE USING (org_id = auth.org_id());

-- No DELETE: workflow executions are historical records

-- -----------------------------------------------------------------------------
-- 7.15 business_context
-- -----------------------------------------------------------------------------

ALTER TABLE business_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON business_context
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON business_context
  FOR INSERT WITH CHECK (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON business_context
  FOR UPDATE USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_delete" ON business_context
  FOR DELETE USING (org_id = auth.org_id());

-- -----------------------------------------------------------------------------
-- 7.16 notifications (no DELETE: retained for audit)
-- -----------------------------------------------------------------------------

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON notifications
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON notifications
  FOR INSERT WITH CHECK (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON notifications
  FOR UPDATE USING (org_id = auth.org_id());

-- No DELETE: notifications are retained

-- -----------------------------------------------------------------------------
-- 7.17 embeddings
-- -----------------------------------------------------------------------------

ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON embeddings
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_insert" ON embeddings
  FOR INSERT WITH CHECK (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON embeddings
  FOR UPDATE USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_delete" ON embeddings
  FOR DELETE USING (org_id = auth.org_id());

-- -----------------------------------------------------------------------------
-- 7.18 training_data (no client-facing policies; service-role only)
-- -----------------------------------------------------------------------------

ALTER TABLE training_data ENABLE ROW LEVEL SECURITY;

-- No client-facing policies: training data is only accessed by server-side
-- anonymization workers using the service role key.

-- -----------------------------------------------------------------------------
-- 7.19 data_consent
-- -----------------------------------------------------------------------------

ALTER TABLE data_consent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON data_consent
  FOR SELECT USING (org_id = auth.org_id());
CREATE POLICY "org_isolation_update" ON data_consent
  FOR UPDATE USING (org_id = auth.org_id());

-- INSERT handled during onboarding via service role

-- -----------------------------------------------------------------------------
-- 7.20 training_runs (global, NOT org-scoped, no RLS policies)
-- -----------------------------------------------------------------------------
-- training_runs is not org-scoped. Accessed only by platform admin (service-role).
-- No RLS enabled or policies needed.

COMMIT;
