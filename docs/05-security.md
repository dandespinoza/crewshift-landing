# 05 — Security & Multi-Tenancy

> Permanent reference for all security architecture in CrewShift. Covers row-level security, token encryption, JWT strategy, CORS, RBAC, API key management, webhook verification, and data encryption at rest.

---

## Table of Contents

1. [Row-Level Security (RLS)](#1-row-level-security-rls)
2. [Token & Secret Encryption](#2-token--secret-encryption)
3. [JWT Strategy](#3-jwt-strategy)
4. [CORS Configuration](#4-cors-configuration)
5. [Role-Based Access Control (RBAC)](#5-role-based-access-control-rbac)
6. [API Key Security](#6-api-key-security)
7. [Webhook Signature Verification](#7-webhook-signature-verification)
8. [Data Encryption at Rest](#8-data-encryption-at-rest)

---

## 1. Row-Level Security (RLS)

### Design Principle

Every tenant-scoped table uses `org_id` for data isolation. Rather than joining the `profiles` table on every query to determine which organization a user belongs to, we embed `org_id` as a **custom JWT claim** during login. This is set via a Supabase database trigger on authentication.

This means:
- **Zero extra queries** to determine tenant context
- RLS policies evaluate a claim already present in the JWT
- Supabase Realtime automatically respects these policies (clients only see rows matching their `org_id`)

### The `auth.org_id()` Helper Function

This function extracts the `org_id` from the JWT custom claims. It is used by every RLS policy.

```sql
-- Helper: extract org_id from JWT custom claims
-- This reads from Supabase's request.jwt.claims GUC (Grand Unified Configuration)
-- which is automatically set by Supabase for every authenticated request.
CREATE OR REPLACE FUNCTION auth.org_id() RETURNS UUID AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id')::uuid;
$$ LANGUAGE sql STABLE;
```

**Why `STABLE`?** The function returns the same value for the duration of a single SQL statement execution. PostgreSQL can cache the result within a query, which is important for performance when the function is called in RLS policies that evaluate per-row.

**Why `current_setting(..., true)`?** The second argument `true` means "return NULL instead of throwing an error if the setting doesn't exist." This is a safety net for edge cases where the claim might be missing.

### Setting the Custom Claim

When a user signs up or logs in, a Supabase database trigger (or Edge Function) injects `org_id` and `role` into the JWT custom claims:

```sql
-- Database function to set custom claims on login
-- Called by a trigger on auth.users or via Supabase's auth.hook
CREATE OR REPLACE FUNCTION public.handle_auth_token()
RETURNS trigger AS $$
DECLARE
  profile_record RECORD;
BEGIN
  SELECT org_id, role INTO profile_record
  FROM public.profiles
  WHERE id = NEW.id;

  IF profile_record IS NOT NULL THEN
    -- Set custom claims in the JWT metadata
    NEW.raw_app_meta_data = jsonb_set(
      COALESCE(NEW.raw_app_meta_data, '{}'::jsonb),
      '{org_id}',
      to_jsonb(profile_record.org_id::text)
    );
    NEW.raw_app_meta_data = jsonb_set(
      NEW.raw_app_meta_data,
      '{role}',
      to_jsonb(profile_record.role)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users to inject claims
CREATE TRIGGER on_auth_user_updated
  BEFORE UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_token();
```

### Standard RLS Policy Template

Every tenant-scoped table gets the same four policies: SELECT, INSERT, UPDATE, DELETE. All use `auth.org_id()`.

```sql
-- ============================================================
-- STANDARD RLS POLICY TEMPLATE
-- Apply this pattern to EVERY table that has an org_id column
-- ============================================================

-- Step 1: Enable RLS on the table
ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY;

-- Step 2: Create the four standard policies
CREATE POLICY "org_isolation_select" ON {table_name}
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON {table_name}
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON {table_name}
  FOR UPDATE USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_delete" ON {table_name}
  FOR DELETE USING (org_id = auth.org_id());
```

### Policies for Every Table

Below is the complete SQL for every tenant-scoped table in the system.

#### organizations

```sql
-- Special case: users can only see their own org
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON organizations
  FOR SELECT USING (id = auth.org_id());

CREATE POLICY "org_isolation_update" ON organizations
  FOR UPDATE USING (id = auth.org_id());

-- INSERT: only during signup flow (handled by service role)
-- DELETE: not allowed via client (handled by service role if needed)
```

#### profiles

```sql
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON profiles
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON profiles
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON profiles
  FOR UPDATE USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_delete" ON profiles
  FOR DELETE USING (org_id = auth.org_id());
```

#### integrations

```sql
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON integrations
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON integrations
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON integrations
  FOR UPDATE USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_delete" ON integrations
  FOR DELETE USING (org_id = auth.org_id());
```

#### customers

```sql
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON customers
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON customers
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON customers
  FOR UPDATE USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_delete" ON customers
  FOR DELETE USING (org_id = auth.org_id());
```

#### jobs

```sql
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON jobs
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON jobs
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON jobs
  FOR UPDATE USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_delete" ON jobs
  FOR DELETE USING (org_id = auth.org_id());
```

#### invoices

```sql
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON invoices
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON invoices
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON invoices
  FOR UPDATE USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_delete" ON invoices
  FOR DELETE USING (org_id = auth.org_id());
```

#### estimates

```sql
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON estimates
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON estimates
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON estimates
  FOR UPDATE USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_delete" ON estimates
  FOR DELETE USING (org_id = auth.org_id());
```

#### parts (inventory)

```sql
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON parts
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON parts
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON parts
  FOR UPDATE USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_delete" ON parts
  FOR DELETE USING (org_id = auth.org_id());
```

#### agent_configs

```sql
ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON agent_configs
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON agent_configs
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON agent_configs
  FOR UPDATE USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_delete" ON agent_configs
  FOR DELETE USING (org_id = auth.org_id());
```

#### agent_executions

```sql
ALTER TABLE agent_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON agent_executions
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON agent_executions
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON agent_executions
  FOR UPDATE USING (org_id = auth.org_id());

-- No DELETE policy: agent executions are immutable audit records
```

#### conversations

```sql
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON conversations
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON conversations
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON conversations
  FOR UPDATE USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_delete" ON conversations
  FOR DELETE USING (org_id = auth.org_id());
```

#### messages

```sql
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON messages
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON messages
  FOR INSERT WITH CHECK (org_id = auth.org_id());

-- No UPDATE or DELETE: messages are append-only
```

#### workflows

```sql
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON workflows
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON workflows
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON workflows
  FOR UPDATE USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_delete" ON workflows
  FOR DELETE USING (org_id = auth.org_id());
```

#### workflow_executions

```sql
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON workflow_executions
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON workflow_executions
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON workflow_executions
  FOR UPDATE USING (org_id = auth.org_id());

-- No DELETE: workflow executions are historical records
```

#### business_context

```sql
ALTER TABLE business_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON business_context
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON business_context
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON business_context
  FOR UPDATE USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_delete" ON business_context
  FOR DELETE USING (org_id = auth.org_id());
```

#### notifications

```sql
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON notifications
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON notifications
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON notifications
  FOR UPDATE USING (org_id = auth.org_id());

-- No DELETE: notifications are retained
```

#### embeddings

```sql
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON embeddings
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_insert" ON embeddings
  FOR INSERT WITH CHECK (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON embeddings
  FOR UPDATE USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_delete" ON embeddings
  FOR DELETE USING (org_id = auth.org_id());
```

#### training_data

```sql
-- Training data is org-scoped but uses org_hash instead of org_id
-- RLS is different here: service-role writes, no client reads
ALTER TABLE training_data ENABLE ROW LEVEL SECURITY;

-- No client-facing policies: training data is only accessed
-- by server-side anonymization workers using the service role key.
-- This table has no RLS policies that allow client access.
```

#### data_consent

```sql
ALTER TABLE data_consent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON data_consent
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY "org_isolation_update" ON data_consent
  FOR UPDATE USING (org_id = auth.org_id());

-- INSERT handled during onboarding via service role
```

### Service-Role Bypass Strategy for BullMQ Workers

BullMQ workers run server-side as background processes. They do **not** have a user JWT because they are not acting on behalf of a specific authenticated user session. They use the **Supabase service-role key**, which bypasses RLS entirely.

**This is by design.** Workers need to:
- Process jobs across multiple organizations (e.g., the `invoice-overdue-detection` cron scans all orgs)
- Write to tables on behalf of agents (e.g., creating an invoice record after agent execution)
- Read encrypted tokens (e.g., fetching QuickBooks OAuth tokens to sync data)

**The safety contract:** Since RLS is bypassed, the repository layer MUST enforce org scoping manually. Every repository method that a worker calls includes `WHERE org_id = $1` as a required parameter.

```typescript
// src/db/repositories/base.repo.ts
// Base repository class used by all data access methods

import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

// Service-role client: bypasses RLS. Used ONLY by server-side workers.
const serviceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Authenticated client: uses the user's JWT. Used by API route handlers.
function createAuthClient(accessToken: string) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

// Example: repository method used by workers
// org_id is ALWAYS a required parameter — never optional
class InvoiceRepository {
  async findOverdue(orgId: string): Promise<Invoice[]> {
    const { data, error } = await serviceClient
      .from('invoices')
      .select('*')
      .eq('org_id', orgId)          // MANDATORY: org scoping
      .eq('status', 'sent')
      .lt('due_date', new Date().toISOString());

    if (error) throw error;
    return data;
  }

  async create(orgId: string, invoice: InsertInvoice): Promise<Invoice> {
    const { data, error } = await serviceClient
      .from('invoices')
      .insert({ ...invoice, org_id: orgId })  // MANDATORY: set org_id
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}
```

**Enforcement rule:** Code review must verify that every service-client query includes `org_id` filtering. A lint rule or repository base class enforces this pattern.

### Realtime + RLS

Supabase Realtime automatically respects RLS policies. When a frontend client subscribes to a channel, Supabase filters rows through the same RLS policies using the client's JWT.

```typescript
// Frontend: subscribes with the user's JWT (set during auth)
// Only receives changes for rows where org_id matches their JWT claim
const channel = supabase
  .channel(`org:${orgId}`)
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'agent_executions',
      filter: `org_id=eq.${orgId}`,
    },
    (payload) => handleExecution(payload)
  )
  .subscribe();
```

No additional server-side filtering is needed. The RLS policies handle it.

---

## 2. Token & Secret Encryption

### What Gets Encrypted and Where

| Secret Type | Storage Location | Encryption Method |
|---|---|---|
| Integration OAuth access tokens | `integrations.access_token` column | pgcrypto `pgp_sym_encrypt` |
| Integration OAuth refresh tokens | `integrations.refresh_token` column | pgcrypto `pgp_sym_encrypt` |
| AI provider API keys (Anthropic, OpenAI, etc.) | Railway environment variables | Railway secrets encryption |
| Integration client secrets (QuickBooks, Stripe, etc.) | Railway environment variables | Railway secrets encryption |
| Database encryption key | `ENCRYPTION_KEY` Railway secret | Platform-level encryption |
| Supabase JWT secret | `SUPABASE_JWT_SECRET` Railway secret | Platform-level encryption |

### pgcrypto Approach for OAuth Tokens

OAuth tokens are stored in the `integrations` table. These tokens grant access to external systems (QuickBooks, Jobber, Stripe, etc.) and must be encrypted at the column level.

**Why pgcrypto and not application-level encryption?**
- Encryption/decryption happens in the same transaction as the read/write
- No risk of the application layer storing plaintext in memory longer than necessary
- pgcrypto is a trusted PostgreSQL extension, battle-tested
- Simpler code: one SQL statement instead of encrypt-then-insert / select-then-decrypt

**Setup:**

```sql
-- Enable pgcrypto extension (run once during DB setup)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### Encrypt/Decrypt SQL Examples

#### Encrypting tokens on insert/update

```sql
-- When storing new OAuth tokens after a successful callback:
INSERT INTO integrations (org_id, provider, status, access_token, refresh_token, token_expires_at, external_account_id)
VALUES (
  $1,                                                                    -- org_id
  $2,                                                                    -- provider ('quickbooks', 'stripe', etc.)
  'connected',                                                           -- status
  pgp_sym_encrypt($3, current_setting('app.encryption_key')),           -- access_token (encrypted)
  pgp_sym_encrypt($4, current_setting('app.encryption_key')),           -- refresh_token (encrypted)
  $5,                                                                    -- token_expires_at
  $6                                                                     -- external_account_id
);

-- When refreshing tokens:
UPDATE integrations SET
  access_token = pgp_sym_encrypt($1, current_setting('app.encryption_key')),
  refresh_token = pgp_sym_encrypt($2, current_setting('app.encryption_key')),
  token_expires_at = $3
WHERE id = $4 AND org_id = $5;
```

#### Decrypting tokens on read

```sql
-- When an adapter needs to make an API call to an external service:
SELECT
  id,
  org_id,
  provider,
  status,
  pgp_sym_decrypt(access_token::bytea, current_setting('app.encryption_key')) AS access_token,
  pgp_sym_decrypt(refresh_token::bytea, current_setting('app.encryption_key')) AS refresh_token,
  token_expires_at,
  external_account_id,
  metadata,
  last_sync_at
FROM integrations
WHERE org_id = $1 AND provider = $2;
```

### Key Management

#### The ENCRYPTION_KEY environment variable

The encryption key is a 32-byte (256-bit) random string, stored as a Railway secret. It is never committed to source control, never stored in the database, and never logged.

```bash
# Generate a new encryption key (run once during initial setup)
openssl rand -hex 32
# Output: a64f3c2e1b7d...  (64 hex chars = 32 bytes)
```

This value is set as `ENCRYPTION_KEY` in Railway's encrypted secrets store for both the `api` and `ai-service` (though only the API service uses it for DB operations).

#### SET LOCAL Injection Pattern

The encryption key is injected into the PostgreSQL session at the start of every database transaction that touches encrypted columns. `SET LOCAL` scopes the setting to the current transaction only — it is automatically cleared when the transaction commits or rolls back.

```typescript
// src/integrations/oauth.service.ts
// Every method that reads or writes encrypted tokens wraps in a transaction

import { Pool } from 'pg';
import { env } from '../config/env';

const pool = new Pool({ connectionString: env.DATABASE_URL });

async function getDecryptedTokens(orgId: string, provider: string): Promise<TokenSet> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Inject encryption key into this transaction's session
    // SET LOCAL scopes it to this transaction ONLY
    await client.query('SET LOCAL app.encryption_key = $1', [env.ENCRYPTION_KEY]);

    const result = await client.query(
      `SELECT
        pgp_sym_decrypt(access_token::bytea, current_setting('app.encryption_key')) AS access_token,
        pgp_sym_decrypt(refresh_token::bytea, current_setting('app.encryption_key')) AS refresh_token,
        token_expires_at
      FROM integrations
      WHERE org_id = $1 AND provider = $2`,
      [orgId, provider]
    );

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function storeTokens(
  orgId: string,
  provider: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: Date,
  externalAccountId: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.encryption_key = $1', [env.ENCRYPTION_KEY]);

    await client.query(
      `INSERT INTO integrations (org_id, provider, status, access_token, refresh_token, token_expires_at, external_account_id)
       VALUES ($1, $2, 'connected',
         pgp_sym_encrypt($3, current_setting('app.encryption_key')),
         pgp_sym_encrypt($4, current_setting('app.encryption_key')),
         $5, $6)
       ON CONFLICT (org_id, provider)
       DO UPDATE SET
         access_token = pgp_sym_encrypt($3, current_setting('app.encryption_key')),
         refresh_token = pgp_sym_encrypt($4, current_setting('app.encryption_key')),
         token_expires_at = $5,
         status = 'connected'`,
      [orgId, provider, accessToken, refreshToken, expiresAt, externalAccountId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

**Why SET LOCAL and not a connection-level setting?**
- `SET LOCAL` is transaction-scoped: the key is available only during the transaction, then automatically cleared
- No risk of the key leaking to the next query on a pooled connection
- If the transaction fails and rolls back, the setting is also rolled back
- Connection pooling (pgBouncer, built into Supabase) reuses connections; a `SET` without `LOCAL` would persist the key for the next user of that connection

### Token Refresh Lifecycle

OAuth tokens expire. The system proactively refreshes them before expiry to avoid failed API calls during agent execution.

```
1. Token stored with token_expires_at timestamp
2. Scheduled job runs every 15 minutes: token-refresh-check
3. Finds all integrations where token_expires_at < NOW() + INTERVAL '30 minutes'
4. For each: call adapter.refreshToken(integration)
5. Adapter calls the provider's token refresh endpoint
6. New access_token + refresh_token stored (encrypted)
7. If refresh fails: mark integration status = 'error', notify org admins
```

```typescript
// Scheduled job: proactive token refresh
// Runs as a BullMQ repeatable job every 15 minutes

async function refreshExpiringTokens(): Promise<void> {
  // Uses service-role client (no user JWT)
  const expiringSoon = await integrationRepo.findExpiringSoon(30); // 30 minutes

  for (const integration of expiringSoon) {
    try {
      const adapter = getAdapter(integration.provider);
      const newTokens = await adapter.refreshToken(integration);

      await storeTokens(
        integration.org_id,
        integration.provider,
        newTokens.access_token,
        newTokens.refresh_token,
        newTokens.expires_at,
        integration.external_account_id
      );

      logger.info({ provider: integration.provider, orgId: integration.org_id }, 'Token refreshed');
    } catch (error) {
      // Mark integration as errored
      await integrationRepo.updateStatus(integration.id, 'error');

      // Notify org admins
      await notificationService.send({
        orgId: integration.org_id,
        type: 'alert',
        title: `${integration.provider} connection error`,
        body: 'Token refresh failed. Please reconnect your integration.',
        channel: 'in_app',
      });

      logger.error({ error, provider: integration.provider, orgId: integration.org_id }, 'Token refresh failed');
    }
  }
}
```

---

## 3. JWT Strategy

### Design Decision: Local Verification

CrewShift verifies JWTs **locally** using the `SUPABASE_JWT_SECRET`. This means:
- **No API call to Supabase** on every request
- Sub-millisecond verification (HMAC-SHA256 signature check)
- Works even if Supabase is temporarily unreachable
- Reduces Supabase API usage and cost

**Why not call Supabase's `auth.getUser()` per request?**
- Adds 50-200ms latency per request (network round-trip to Supabase)
- Creates a single point of failure (if Supabase auth is slow, every request is slow)
- Unnecessary: the JWT signature proves authenticity. Custom claims provide all needed context.

### Custom Claims

Every JWT issued by Supabase for CrewShift contains these custom claims (set via the auth trigger in Section 1):

```json
{
  "sub": "user-uuid",               // Supabase auth user ID
  "email": "user@example.com",
  "org_id": "org-uuid",             // CrewShift organization ID
  "role": "admin",                   // CrewShift role: 'owner' | 'admin' | 'member' | 'tech'
  "aud": "authenticated",
  "exp": 1709500000,                // Expiry timestamp
  "iat": 1709496400                 // Issued-at timestamp
}
```

### Auth Middleware Implementation

```typescript
// src/middleware/auth.middleware.ts

import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

// Extend Fastify's request type to include our custom fields
declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    orgId: string;
    role: 'owner' | 'admin' | 'member' | 'tech';
  }
}

interface JWTPayload {
  sub: string;
  org_id: string;
  role: 'owner' | 'admin' | 'member' | 'tech';
  aud: string;
  exp: number;
  iat: number;
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Missing or malformed authorization header',
      },
    });
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    // Local verification using SUPABASE_JWT_SECRET
    // This is the same secret Supabase uses to sign JWTs
    // No network call required
    const payload = jwt.verify(token, env.SUPABASE_JWT_SECRET, {
      algorithms: ['HS256'],
      audience: 'authenticated',
    }) as JWTPayload;

    // Inject user context into the request
    request.userId = payload.sub;
    request.orgId = payload.org_id;
    request.role = payload.role;

    // Validate that required claims exist
    if (!payload.org_id) {
      return reply.status(403).send({
        error: {
          code: 'NO_ORG',
          message: 'User is not associated with an organization',
        },
      });
    }
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return reply.status(401).send({
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Token has expired. Please refresh.',
        },
      });
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return reply.status(401).send({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token is invalid',
        },
      });
    }
    throw error;
  }
}
```

### Org Context Middleware

Runs after auth middleware. Ensures the org context is present. No DB lookup needed because `org_id` comes from the JWT.

```typescript
// src/middleware/org.middleware.ts

import { FastifyRequest, FastifyReply } from 'fastify';

export async function orgMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.orgId) {
    return reply.status(403).send({
      error: {
        code: 'NO_ORG',
        message: 'No organization context. User must belong to an organization.',
      },
    });
  }
  // org_id is already available on the request from auth middleware
  // No additional DB lookup required
}
```

### Token Refresh Flow

Supabase handles JWT refresh via its client SDK. The frontend calls `supabase.auth.refreshSession()` which exchanges the refresh token for a new JWT with fresh custom claims.

```
1. JWT expires (default: 1 hour)
2. Frontend's Supabase client automatically detects expiry
3. Calls POST /auth/v1/token?grant_type=refresh_token
4. Supabase issues new JWT with updated claims (including org_id, role)
5. Frontend stores new JWT, uses it for subsequent requests
```

If the user's role changes (e.g., admin promotes member to admin), the new role takes effect on the next token refresh.

---

## 4. CORS Configuration

### Fastify @fastify/cors Config

```typescript
// src/server.ts

import cors from '@fastify/cors';

app.register(cors, {
  // Allowed origins: only our frontend domains
  origin: [
    'http://localhost:3001',          // Local frontend dev server
    'http://localhost:5173',          // Vite dev server (alternative port)
    'https://app.crewshift.com',     // Production frontend
    'https://*.crewshift.com',       // All CrewShift subdomains (staging, preview deploys)
  ],

  // Allowed HTTP methods
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],

  // Allowed request headers
  allowedHeaders: [
    'Content-Type',                   // JSON payloads
    'Authorization',                  // Bearer JWT tokens
    'X-Request-ID',                   // Request tracing
  ],

  // Allow cookies and authorization headers to be sent cross-origin
  credentials: true,

  // Cache preflight responses for 24 hours (reduces OPTIONS requests)
  maxAge: 86400,
});
```

**Design rationale:**
- **No wildcard (`*`) origin:** We explicitly list allowed origins. Wildcard origins cannot be used with `credentials: true`.
- **`credentials: true`:** The frontend sends JWTs via the Authorization header. This flag is required for the browser to include credentials in cross-origin requests.
- **`X-Request-ID`:** Used for distributed tracing. The frontend generates a request ID, the API logs it, and it propagates to the AI service for end-to-end tracing.
- **`maxAge: 86400`:** Browsers cache the CORS preflight response for 24 hours. This eliminates the extra OPTIONS request on every API call after the first.
- **No PUT method:** We use PATCH for updates, not PUT. Excluding unused methods reduces attack surface.

### Webhook Routes Exception

Webhook routes (`/api/webhooks/*`) do **not** use CORS because they receive requests from external services (QuickBooks, Stripe, Jobber), not from browsers. These routes use signature verification instead (see Section 7).

```typescript
// Webhook routes are registered before CORS plugin,
// or use a route-level CORS override:
app.post('/api/webhooks/:provider', {
  config: { cors: false },  // Disable CORS for webhook routes
}, webhookHandler);
```

---

## 5. Role-Based Access Control (RBAC)

### Role Definitions

| Role | Description | Typical User |
|---|---|---|
| `owner` | Full access. Can manage billing, team, and all settings. One per org. | Business owner |
| `admin` | Near-full access. Can manage team, agents, integrations. Cannot change billing. | Office manager, operations lead |
| `member` | Standard access. Can use agents, copilot, CRUD on business data. Cannot change configs. | Dispatcher, back-office staff |
| `tech` | Limited access. Can use copilot, view dashboard, read business data. Cannot modify. | Field technician |

### Full Role Matrix

| Route Category | owner | admin | member | tech |
|---|---|---|---|---|
| **Org settings** (`PATCH /api/org`) | Yes | Yes | No | No |
| **Team management** (invite, update role, remove) | Yes | Yes | No | No |
| **Billing / tier changes** | Yes | No | No | No |
| **Agent config** (enable/disable, autonomy rules) | Yes | Yes | No | No |
| **Agent execution approve/reject** | Yes | Yes | Yes | No |
| **CRUD: jobs** (create, update, delete) | Yes | Yes | Yes | No |
| **CRUD: invoices** (create, update, send) | Yes | Yes | Yes | No |
| **CRUD: estimates** (create, update, send) | Yes | Yes | Yes | No |
| **CRUD: customers** (create, update) | Yes | Yes | Yes | No |
| **CRUD: inventory** (create, update) | Yes | Yes | Yes | No |
| **Read: jobs, invoices, customers, etc.** | Yes | Yes | Yes | Yes (read-only) |
| **Copilot messages** | Yes | Yes | Yes | Yes |
| **Dashboard (read)** | Yes | Yes | Yes | Yes |
| **Integration connect/disconnect** | Yes | Yes | No | No |
| **Workflow create/edit/delete** | Yes | Yes | Yes | No |
| **Workflow view** | Yes | Yes | Yes | Yes |
| **File upload** | Yes | Yes | Yes | Yes |
| **Notifications (read, mark read)** | Yes | Yes | Yes | Yes |
| **Onboarding** | Yes | Yes | No | No |
| **Usage/billing dashboard** | Yes | Yes | Yes | No |

### RBAC Middleware Factory

```typescript
// src/middleware/rbac.middleware.ts

import { FastifyRequest, FastifyReply } from 'fastify';

type Role = 'owner' | 'admin' | 'member' | 'tech';

/**
 * Middleware factory that creates a preHandler checking if the
 * authenticated user's role is in the allowed list.
 *
 * Usage:
 *   app.patch('/api/org', {
 *     preHandler: [authMiddleware, requireRole('owner', 'admin')],
 *   }, handler);
 */
export function requireRole(...allowedRoles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.role) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'No role found. Authentication may be incomplete.',
        },
      });
    }

    if (!allowedRoles.includes(request.role)) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Insufficient permissions. Required role: ${allowedRoles.join(' or ')}. Your role: ${request.role}.`,
        },
      });
    }
  };
}

/**
 * Special middleware for tech role: allows read access to data routes.
 * If the request method is not GET/HEAD, rejects tech users.
 */
export function requireRoleOrReadOnly(...writeRoles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const isReadRequest = request.method === 'GET' || request.method === 'HEAD';

    if (isReadRequest) {
      // All authenticated users can read
      return;
    }

    // Write operations require specific roles
    if (!writeRoles.includes(request.role)) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Write access requires role: ${writeRoles.join(' or ')}. Your role: ${request.role}.`,
        },
      });
    }
  };
}
```

### Route Registration Examples

```typescript
// src/routes/org.routes.ts
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';

export async function orgRoutes(app: FastifyInstance) {
  // Read: all authenticated users
  app.get('/api/org', {
    preHandler: [authMiddleware],
  }, getOrgHandler);

  // Update: owner or admin only
  app.patch('/api/org', {
    preHandler: [authMiddleware, requireRole('owner', 'admin')],
  }, updateOrgHandler);

  // Team management: owner or admin only
  app.get('/api/org/team', {
    preHandler: [authMiddleware, requireRole('owner', 'admin', 'member', 'tech')],
  }, listTeamHandler);

  app.post('/api/org/team/invite', {
    preHandler: [authMiddleware, requireRole('owner', 'admin')],
  }, inviteTeamMemberHandler);

  app.patch('/api/org/team/:userId', {
    preHandler: [authMiddleware, requireRole('owner', 'admin')],
  }, updateTeamMemberHandler);

  app.delete('/api/org/team/:userId', {
    preHandler: [authMiddleware, requireRole('owner', 'admin')],
  }, removeTeamMemberHandler);
}

// src/routes/agents.routes.ts
export async function agentRoutes(app: FastifyInstance) {
  // View agents: all roles
  app.get('/api/agents', {
    preHandler: [authMiddleware],
  }, listAgentsHandler);

  // Configure agents: owner or admin
  app.patch('/api/agents/:type', {
    preHandler: [authMiddleware, requireRole('owner', 'admin')],
  }, updateAgentConfigHandler);

  // Approve/reject: owner, admin, or member
  app.post('/api/agents/executions/:id/approve', {
    preHandler: [authMiddleware, requireRole('owner', 'admin', 'member')],
  }, approveExecutionHandler);

  app.post('/api/agents/executions/:id/reject', {
    preHandler: [authMiddleware, requireRole('owner', 'admin', 'member')],
  }, rejectExecutionHandler);
}

// src/routes/invoices.routes.ts
import { requireRoleOrReadOnly } from '../middleware/rbac.middleware';

export async function invoiceRoutes(app: FastifyInstance) {
  // Read: all roles. Write: owner, admin, member.
  app.get('/api/invoices', {
    preHandler: [authMiddleware],
  }, listInvoicesHandler);

  app.get('/api/invoices/:id', {
    preHandler: [authMiddleware],
  }, getInvoiceHandler);

  app.post('/api/invoices', {
    preHandler: [authMiddleware, requireRole('owner', 'admin', 'member')],
  }, createInvoiceHandler);

  app.patch('/api/invoices/:id', {
    preHandler: [authMiddleware, requireRole('owner', 'admin', 'member')],
  }, updateInvoiceHandler);

  app.post('/api/invoices/:id/send', {
    preHandler: [authMiddleware, requireRole('owner', 'admin', 'member')],
  }, sendInvoiceHandler);
}
```

---

## 6. API Key Security

### Principle: Environment Variables Only

All API keys and secrets are stored as **Railway encrypted environment variables** (Railway secrets). They are:

- **Never committed to source control** (not in `.env` files that are committed; `.env.example` contains placeholder values only)
- **Never stored in the database** (the database stores encrypted OAuth tokens for integrations, but API keys for third-party services are always in env vars)
- **Never logged** (the logger is configured to redact any field matching `*key*`, `*secret*`, `*token*`, `*password*`)
- **Never exposed in API responses** (no endpoint returns API keys)

### Environment Variable Categories

```bash
# ===== API SERVICE SECRETS =====
# These are set in Railway for the 'api' service

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...                    # Public key (safe for frontend, but still in env vars)
SUPABASE_SERVICE_ROLE_KEY=eyJ...            # Service role key (NEVER expose to frontend)
SUPABASE_JWT_SECRET=your-jwt-secret         # For local JWT verification
DATABASE_URL=postgresql://...                # Direct DB connection string

# Redis
REDIS_URL=redis://...

# Encryption
ENCRYPTION_KEY=a64f3c2e1b7d...             # 32-byte hex key for pgcrypto

# Integration OAuth Credentials
QUICKBOOKS_CLIENT_ID=xxx
QUICKBOOKS_CLIENT_SECRET=xxx
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
JOBBER_CLIENT_ID=xxx
JOBBER_CLIENT_SECRET=xxx

# Storage
S3_BUCKET=crewshift-files
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx

# Notifications
RESEND_API_KEY=re_xxx

# ===== AI SERVICE SECRETS =====
# These are set in Railway for the 'ai-service'

ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx
GOOGLE_AI_API_KEY=xxx
DEEPGRAM_API_KEY=xxx
VOYAGE_API_KEY=xxx
```

### Validation at Startup

All required environment variables are validated at application startup using Zod. If any are missing, the app fails to start with a clear error message.

```typescript
// src/config/env.ts

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1),
  DATABASE_URL: z.string().min(1),

  // Redis
  REDIS_URL: z.string().min(1),

  // AI Service
  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),

  // Encryption
  ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),

  // Integration secrets
  QUICKBOOKS_CLIENT_ID: z.string().min(1),
  QUICKBOOKS_CLIENT_SECRET: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),

  // Storage
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),

  // Notifications
  RESEND_API_KEY: z.string().min(1),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
```

### Logger Redaction

```typescript
// src/utils/logger.ts

import pino from 'pino';

export const logger = pino({
  redact: {
    paths: [
      'req.headers.authorization',
      '*.access_token',
      '*.refresh_token',
      '*.password',
      '*.secret',
      '*.apiKey',
      '*.api_key',
      '*.encryption_key',
    ],
    censor: '[REDACTED]',
  },
});
```

---

## 7. Webhook Signature Verification

Webhook endpoints receive HTTP requests from external services. These requests must be verified to ensure they actually came from the claimed provider and were not tampered with.

Each provider uses a different signature scheme. The verification logic lives in each adapter's `verifyWebhook` method.

> **Cross-reference:** See [22-error-handling.md](./22-error-handling.md) for webhook processing resilience (retry logic, dead letter queues, idempotent processing).

### General Pattern

```typescript
// src/integrations/webhook.processor.ts

import { FastifyRequest, FastifyReply } from 'fastify';
import { getAdapter } from './adapter.interface';

export async function webhookHandler(
  request: FastifyRequest<{ Params: { provider: string } }>,
  reply: FastifyReply
) {
  const { provider } = request.params;
  const adapter = getAdapter(provider);

  if (!adapter) {
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Unknown provider: ${provider}` } });
  }

  // Step 1: Verify signature
  const signature = request.headers['x-signature'] ||
    request.headers['x-hub-signature-256'] ||
    request.headers['stripe-signature'] ||
    request.headers['x-qbo-signature'] || '';

  const isValid = adapter.verifyWebhook(request.body, signature as string);

  if (!isValid) {
    logger.warn({ provider }, 'Webhook signature verification failed');
    return reply.status(401).send({ error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed' } });
  }

  // Step 2: Acknowledge immediately (return 200)
  reply.status(200).send({ received: true });

  // Step 3: Enqueue for async processing (do not block the webhook response)
  await webhookQueue.add(`webhook:${provider}`, {
    provider,
    payload: request.body,
    receivedAt: new Date().toISOString(),
  });
}
```

### Provider-Specific Verification

#### Stripe

```typescript
// Uses stripe-signature header + STRIPE_WEBHOOK_SECRET
import Stripe from 'stripe';

verifyWebhook(payload: any, signature: string): boolean {
  try {
    Stripe.webhooks.constructEvent(
      JSON.stringify(payload),
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
    return true;
  } catch {
    return false;
  }
}
```

#### QuickBooks

```typescript
// Uses HMAC-SHA256 with the webhook verifier token
import crypto from 'crypto';

verifyWebhook(payload: any, signature: string): boolean {
  const hash = crypto
    .createHmac('sha256', env.QUICKBOOKS_WEBHOOK_TOKEN)
    .update(JSON.stringify(payload))
    .digest('base64');
  return hash === signature;
}
```

#### Jobber

```typescript
// Uses HMAC-SHA256 with the app secret
import crypto from 'crypto';

verifyWebhook(payload: any, signature: string): boolean {
  const hash = crypto
    .createHmac('sha256', env.JOBBER_WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(signature)
  );
}
```

**Note:** `crypto.timingSafeEqual` is used instead of `===` to prevent timing attacks. A simple string comparison leaks information about how many bytes matched before the first difference, which an attacker can exploit to forge signatures one byte at a time.

---

## 8. Data Encryption at Rest

### Supabase-Managed Encryption

Supabase encrypts all data at rest by default. This is handled at the infrastructure level:

- **Disk encryption:** Supabase uses AWS/GCP managed encryption for the underlying PostgreSQL storage volumes (AES-256)
- **Backup encryption:** All database backups are encrypted at rest
- **Network encryption:** All connections to the database use TLS 1.2+

This means: general data (jobs, customers, invoices, etc.) is encrypted at rest without any additional work from our application.

### Column-Level Encryption (Our Responsibility)

For **highly sensitive data** that needs encryption above and beyond disk-level encryption, we use pgcrypto column-level encryption. This applies to:

| Data | Table | Column(s) | Why Column-Level |
|---|---|---|---|
| OAuth access tokens | `integrations` | `access_token` | These grant access to external systems. Even if the DB is compromised, tokens are useless without the encryption key. |
| OAuth refresh tokens | `integrations` | `refresh_token` | Same as above. Refresh tokens can generate new access tokens. |

**Why not encrypt everything at the column level?**
- Column-level encryption prevents PostgreSQL from indexing, filtering, or sorting on the encrypted column
- It adds latency (encrypt/decrypt on every read/write)
- For most data (customer names, job descriptions, invoice amounts), disk-level encryption provides sufficient protection
- Column-level encryption is reserved for data that, if exposed, grants access to external systems

### Application-Level Encryption Considerations

For future phases, if we need to encrypt additional sensitive fields (e.g., customer SSNs for tax purposes, credit card last-four for display), we will use application-level encryption via Node's `crypto` module:

```typescript
// Future: application-level field encryption
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function encrypt(plaintext: string, key: Buffer): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return { ciphertext, iv: iv.toString('hex'), tag };
}

function decrypt(ciphertext: string, key: Buffer, iv: string, tag: string): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}
```

This is not needed for MVP but the pattern is documented here for future reference.

---

## Cross-References

- **Database schema (all tables):** See [02-database-schema.md](./02-database-schema.md)
- **API routes (what each endpoint does):** See [03-api-routes.md](./03-api-routes.md)
- **Error handling & resilience:** See [22-error-handling.md](./22-error-handling.md)
- **Queue system (BullMQ workers that use service role):** See [14-queue-system.md](./14-queue-system.md)
- **Integration layer (OAuth flows, adapters):** See [09-integrations.md](./09-integrations.md)
- **Deployment (env vars in Railway):** See [21-deployment.md](./21-deployment.md)
