-- 0002_super_admin.sql
-- Adds super-admin support (is_super_admin flag on profiles),
-- integration OAuth state tracking (integration_oauth_states),
-- and sync logging (sync_logs) for integration data synchronisation.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Add is_super_admin column to profiles
-- ---------------------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT false;

-- Partial index — only indexes the (few) super-admin rows.
CREATE INDEX idx_profiles_super_admin
  ON profiles (is_super_admin)
  WHERE is_super_admin = true;

-- ---------------------------------------------------------------------------
-- 2. integration_oauth_states — tracks in-flight OAuth handshakes
-- ---------------------------------------------------------------------------
CREATE TABLE integration_oauth_states (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  state         TEXT        NOT NULL UNIQUE,
  org_id        UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider      TEXT        NOT NULL,
  initiated_by  UUID        REFERENCES profiles(id),
  redirect_url  TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oauth_states_state   ON integration_oauth_states(state);
CREATE INDEX idx_oauth_states_expires ON integration_oauth_states(expires_at);

-- ---------------------------------------------------------------------------
-- 3. sync_logs — records every integration sync run
-- ---------------------------------------------------------------------------
CREATE TABLE sync_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id  UUID        NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  provider        TEXT        NOT NULL,
  sync_type       TEXT        NOT NULL DEFAULT 'incremental',
  status          TEXT        NOT NULL DEFAULT 'running',
  direction       TEXT        NOT NULL DEFAULT 'inbound',
  records_created INTEGER     DEFAULT 0,
  records_updated INTEGER     DEFAULT 0,
  records_skipped INTEGER     DEFAULT 0,
  records_failed  INTEGER     DEFAULT 0,
  errors          JSONB       DEFAULT '[]'::jsonb,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  duration_ms     INTEGER,
  error_message   TEXT
);

CREATE INDEX idx_sync_logs_org         ON sync_logs(org_id);
CREATE INDEX idx_sync_logs_integration ON sync_logs(integration_id);
CREATE INDEX idx_sync_logs_status      ON sync_logs(status) WHERE status = 'running';
CREATE INDEX idx_sync_logs_started     ON sync_logs(started_at DESC);

-- ---------------------------------------------------------------------------
-- 4. Row-Level Security
-- ---------------------------------------------------------------------------

-- integration_oauth_states: service-role only (no client access)
ALTER TABLE integration_oauth_states ENABLE ROW LEVEL SECURITY;

-- sync_logs: standard 4-policy pattern using auth.org_id()
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_logs_select ON sync_logs
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY sync_logs_insert ON sync_logs
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY sync_logs_update ON sync_logs
  FOR UPDATE USING (org_id = auth.org_id());

CREATE POLICY sync_logs_delete ON sync_logs
  FOR DELETE USING (org_id = auth.org_id());

COMMIT;
