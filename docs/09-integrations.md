# 09 — Integrations

> Permanent reference for CrewShift's integration architecture. Covers the tiered strategy, adapter interface, unified data model, external ID tracking, OAuth2 flow, token refresh, sync service, write-back, webhook processing, per-adapter notes for all Tier 1 integrations, unified API wrapper, and project structure.

---

## Table of Contents

1. [Tiered Integration Strategy](#1-tiered-integration-strategy)
2. [Adapter Interface](#2-adapter-interface)
3. [Unified Data Model](#3-unified-data-model)
4. [external_ids JSONB Pattern](#4-external_ids-jsonb-pattern)
5. [OAuth2 Flow](#5-oauth2-flow)
6. [Token Refresh](#6-token-refresh)
7. [Sync Service](#7-sync-service)
8. [Write-Back](#8-write-back)
9. [Webhook Processing](#9-webhook-processing)
10. [Per-Adapter Notes (Tier 1)](#10-per-adapter-notes-tier-1)
11. [Unified API Wrapper (Tier 2)](#11-unified-api-wrapper-tier-2)
12. [Project Structure](#12-project-structure)

---

## 1. Tiered Integration Strategy

### Design Principle

Build high-value integrations in-house for full control and depth. Use a unified API service (Merge.dev or Nango) for the long tail. Bridge the rest via Zapier until native support is warranted.

### Tier 1 — Native In-House (Deep, Bidirectional, Agent-Critical)

These integrations are built and maintained by CrewShift. They implement the full `IntegrationAdapter` interface with deep, bidirectional data sync.

| Category | Provider | Difficulty | Why Native | Which Agents Depend On It |
|---|---|---|---|---|
| **Accounting** | QuickBooks Online | Medium (OAuth2, REST) | Invoice/bookkeeping agents depend on this. Write-back is critical. Core to value prop. | Invoice, Collections, Bookkeeping, Insights |
| **Payments** | Stripe | Easy (excellent API) | Payment processing for invoices, collections payment links. Revenue tracking. | Invoice, Collections, Bookkeeping |
| **FSM** | Jobber | Medium (REST, partner program) | Core job data pipeline — jobs, scheduling, customers. Must be deep + bidirectional. | Field Ops, Invoice, Estimate, Customer, Inventory |
| **FSM** | ServiceTitan | Hard (partner API, approval) | Access to larger contractor segment (20+ techs). Same data needs as Jobber. | Field Ops, Invoice, Estimate, Customer, Inventory |
| **FSM** | HousecallPro | Medium (API available) | Alternative FSM for smaller contractors. Same data pipeline. | Field Ops, Invoice, Estimate, Customer |
| **Banking** | Plaid | Medium (OAuth2, specialized) | Financial data for bookkeeping, cash flow insights. Transaction categorization. | Bookkeeping, Insights |
| **Fleet** | Fleetio | Easy (REST) | Vehicle data for compliance agent. Mileage tracking for taxes. | Compliance |
| **Inventory** | Fishbowl | Medium (REST/SOAP) | Parts inventory management. Stock level sync. | Inventory |
| **Communication** | Twilio | Easy (best-in-class API) | SMS for customer notifications, reminders, follow-ups. | Customer, Collections, Field Ops |
| **Productivity** | Google Workspace | Easy (OAuth2) | Email for customer comms, calendar for scheduling. | Customer, Field Ops |

**Reasoning for native:**
- These integrations are on the **critical path** for agent execution. If the integration fails, the agent cannot complete.
- They require **write-back**: agents create invoices in QuickBooks, update job status in Jobber, send payments via Stripe.
- They need **deep data mapping**: not just customer names, but line items, tax calculations, payment terms.
- **Webhook support**: real-time data from these providers triggers agent execution.
- **Full control**: we can optimize sync frequency, handle edge cases, and ensure data consistency.

### Tier 2 — Unified API (Merge.dev / Nango)

These integrations are wrapped behind a unified API service. CrewShift does not interact with these APIs directly. Instead, it calls Merge.dev or Nango, which normalizes the data.

| Category | Providers | Merge.dev/Nango Category | Notes |
|---|---|---|---|
| **CRM** | HubSpot, Salesforce, Zoho | CRM | Lead import, customer sync |
| **HRIS/Payroll** | Gusto, ADP, Paychex | HRIS | Bookkeeping Agent payroll features |
| **Scheduling** | Calendly, Cal.com | Calendar | Calendar sync for scheduling |
| **Productivity** | Google Sheets, Docs, Drive, Notion | File Storage | Document access |
| **Communication** | Slack, Microsoft Teams | Messaging | Notification delivery |
| **Marketing** | Mailchimp, Constant Contact | Marketing | Customer Agent campaigns |
| **Reviews** | Podium, Birdeye, Google Business Profile | Custom | Customer Agent review management |
| **Proposals** | PandaDoc, DocuSign | Custom | Estimate Agent document signing |
| **Phone/VoIP** | RingCentral, OpenPhone, Grasshopper | Custom | Call logging |

**Reasoning for unified API:**
- These integrations are **supplementary**, not critical-path
- Data needs are **standardized** (contacts, calendar events, messages)
- Merge.dev/Nango provide pre-built connectors with OAuth handling
- Reduces maintenance burden: Merge.dev handles API changes
- The adapter interface wraps Merge.dev calls so the agent runtime never knows the difference

### Tier 3 — Zapier/Make Bridge (Until Native Support)

These integrations have limited or no public APIs. We bridge them via Zapier webhooks until native support is warranted by demand.

| Category | Providers | Notes |
|---|---|---|
| **Payments (alt)** | Venmo, CashApp, Zelle, PayPal | Limited APIs. Zapier bridge for payment notifications. |
| **Niche FSM** | FieldEdge, Service Fusion, BuildOps | Build native if demand warrants (>50 customers on platform) |
| **Maps/Routing** | Google Maps, OptimoRoute | Field Ops Agent route optimization. Google Maps API is native-ready when needed. |
| **Supply Houses** | Ferguson, Johnstone Supply | No public APIs currently. Bridge via email/Zapier if APIs become available. |
| **Accounting (alt)** | Xero, Sage Intacct | Build native for Xero when international market opens. Sage for enterprise. |

**Reasoning for bridge:**
- Limited or no public APIs
- Low initial demand (niche FSM platforms)
- Zapier provides a working connection with minimal engineering effort
- Upgrade to native when customer demand justifies the investment

---

## 2. Adapter Interface

Every integration — native, unified API, or bridge — implements the same `IntegrationAdapter` interface. This is the contract between the integration layer and the rest of the system (agents, sync service, webhooks).

```typescript
// src/integrations/adapter.interface.ts

import { Integration, Customer, Job, Invoice, Estimate, Part } from '../db/schema';

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  token_type?: string;
  scope?: string;
}

export interface ExternalId {
  provider: string;
  external_id: string;
}

export interface WebhookEvent {
  type: string;           // 'job.created', 'invoice.paid', 'customer.updated', etc.
  provider: string;       // 'quickbooks', 'stripe', 'jobber', etc.
  external_id: string;    // ID in the external system
  data: Record<string, any>;  // Normalized event data
  raw: Record<string, any>;   // Raw webhook payload (for debugging)
  timestamp: Date;
}

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ external_id: string; error: string }>;
}

export interface IntegrationAdapter {
  /** Provider identifier */
  provider: string;

  /** Integration tier */
  tier: 'native' | 'unified' | 'bridge';

  // ============================================================
  // OAuth2 — Connection flow
  // ============================================================

  /**
   * Generate the OAuth2 authorization URL.
   * The frontend redirects the user to this URL to start the OAuth flow.
   */
  getAuthUrl(orgId: string, redirectUri: string): string;

  /**
   * Handle the OAuth2 callback.
   * Exchange the authorization code for access + refresh tokens.
   * Store the tokens (encrypted) in the integrations table.
   */
  handleCallback(code: string, orgId: string, redirectUri: string): Promise<TokenSet>;

  /**
   * Refresh an expired access token using the refresh token.
   * Called proactively by the token refresh scheduled job.
   */
  refreshToken(integration: Integration): Promise<TokenSet>;

  // ============================================================
  // Sync: External → CrewShift (Read)
  // ============================================================

  /**
   * Sync customers from the external system into CrewShift's unified model.
   * Handles both initial full sync and incremental delta sync.
   */
  syncCustomers(integration: Integration, since?: Date): Promise<SyncResult>;

  /**
   * Sync jobs/work orders from the external system.
   */
  syncJobs(integration: Integration, since?: Date): Promise<SyncResult>;

  /**
   * Sync invoices from the external system.
   */
  syncInvoices(integration: Integration, since?: Date): Promise<SyncResult>;

  /**
   * Sync estimates/quotes from the external system.
   */
  syncEstimates?(integration: Integration, since?: Date): Promise<SyncResult>;

  /**
   * Sync parts/inventory from the external system.
   */
  syncParts?(integration: Integration, since?: Date): Promise<SyncResult>;

  // ============================================================
  // Write-Back: CrewShift → External (Write)
  // ============================================================

  /**
   * Create an invoice in the external system.
   * Returns the external ID for cross-reference tracking.
   */
  createInvoice(integration: Integration, invoice: Invoice): Promise<ExternalId>;

  /**
   * Update an invoice in the external system.
   */
  updateInvoice?(integration: Integration, invoice: Invoice): Promise<void>;

  /**
   * Update a job's status in the external system.
   */
  updateJobStatus(integration: Integration, jobId: string, status: string): Promise<void>;

  /**
   * Create a payment link or record a payment.
   */
  sendPayment?(integration: Integration, invoiceId: string, amount: number): Promise<void>;

  /**
   * Create a customer in the external system.
   */
  createCustomer?(integration: Integration, customer: Customer): Promise<ExternalId>;

  /**
   * Create an estimate in the external system.
   */
  createEstimate?(integration: Integration, estimate: Estimate): Promise<ExternalId>;

  // ============================================================
  // Webhooks — Inbound event processing
  // ============================================================

  /**
   * Verify the authenticity of an inbound webhook.
   * Each provider has its own signature scheme.
   */
  verifyWebhook(payload: any, signature: string): boolean;

  /**
   * Process a verified webhook payload into a normalized event.
   */
  processWebhook(payload: any): Promise<WebhookEvent>;

  // ============================================================
  // Health — Connection status
  // ============================================================

  /**
   * Check if the integration connection is healthy.
   * Makes a lightweight API call to verify the token is valid.
   */
  healthCheck(integration: Integration): Promise<{ healthy: boolean; error?: string }>;
}
```

---

## 3. Unified Data Model

### How External Data Maps to CrewShift's Internal Model

Every external system has its own data model. The adapter layer translates between external and internal models during sync and write-back.

```
External System (Jobber)          CrewShift Unified Model          External System (QuickBooks)
+------------------+              +-------------------+            +------------------+
| Client           | --sync-->    | customers         | --write--> | Customer         |
| - id: 12345      |              | - id: uuid        |            | - Id: "89"       |
| - name: "Henderson" |           | - name: "Henderson"|           | - DisplayName    |
| - email          |              | - email           |            | - PrimaryEmail   |
| - phone          |              | - phone           |            | - PrimaryPhone   |
| - address        |              | - address (JSONB) |            | - BillAddr       |
+------------------+              | - external_ids:   |            +------------------+
                                  |   { "jobber": "12345",
                                  |     "quickbooks": "89" }
                                  +-------------------+
```

### Mapping Tables

#### Customers

| CrewShift Field | Jobber | ServiceTitan | QuickBooks | HousecallPro |
|---|---|---|---|---|
| `name` | `name` | `name` | `DisplayName` | `name` |
| `email` | `email` | `email` | `PrimaryEmailAddr.Address` | `email` |
| `phone` | `phone_number` | `phoneNumber` | `PrimaryPhone.FreeFormNumber` | `phone_number` |
| `address.street` | `property.address1` | `address.street` | `BillAddr.Line1` | `address.street` |
| `address.city` | `property.city` | `address.city` | `BillAddr.City` | `address.city` |
| `address.state` | `property.state` | `address.state` | `BillAddr.CountrySubDivisionCode` | `address.state` |
| `address.zip` | `property.zip` | `address.zip` | `BillAddr.PostalCode` | `address.zip` |

#### Jobs

| CrewShift Field | Jobber | ServiceTitan | HousecallPro |
|---|---|---|---|
| `status` | `status` (mapped) | `status` (mapped) | `status` (mapped) |
| `type` | `job_type` | `type.name` | `service_type` |
| `description` | `title` + `description` | `summary` | `description` |
| `scheduled_start` | `start_at` | `start` | `scheduled_start` |
| `scheduled_end` | `end_at` | `end` | `scheduled_end` |
| `assigned_tech_id` | `team.members[0].id` | `technician.id` | `assigned_employee_id` |
| `total_amount` | `total` | `total` | `total` |

#### Invoices

| CrewShift Field | QuickBooks | Xero | Stripe |
|---|---|---|---|
| `invoice_number` | `DocNumber` | `InvoiceNumber` | `number` |
| `line_items` | `Line[]` (mapped) | `LineItems[]` (mapped) | `lines.data[]` (mapped) |
| `subtotal` | `TotalAmt - TaxAmt` | `SubTotal` | `subtotal` |
| `tax_amount` | `TxnTaxDetail.TotalTax` | `TotalTax` | `tax` |
| `total` | `TotalAmt` | `Total` | `total` |
| `status` | `Balance` === 0 ? 'paid' : 'sent' | `Status` (mapped) | `status` (mapped) |
| `due_date` | `DueDate` | `DueDate` | `due_date` |

---

## 4. external_ids JSONB Pattern

### How Cross-Platform IDs Are Tracked

Every entity in CrewShift (customer, job, invoice, estimate, part) has an `external_ids` JSONB column. This column stores the mapping between CrewShift's internal UUID and the external system's ID.

```sql
-- Example: a customer exists in both Jobber and QuickBooks
SELECT id, name, external_ids FROM customers WHERE id = 'uuid-123';

-- Result:
-- id: 'uuid-123'
-- name: 'Henderson'
-- external_ids: { "jobber": "12345", "quickbooks": "89", "servicetitan": "ST-456" }
```

### Why JSONB and Not a Separate Table

- **Simplicity:** One column per entity, no joins required
- **Performance:** JSONB is indexed and queryable in PostgreSQL
- **Flexibility:** New providers can be added without schema changes
- **Atomic updates:** `jsonb_set` in a single UPDATE statement

### Query Patterns

```sql
-- Find a customer by their Jobber ID
SELECT * FROM customers
WHERE org_id = $1
AND external_ids->>'jobber' = $2;

-- Find all customers synced from QuickBooks
SELECT * FROM customers
WHERE org_id = $1
AND external_ids ? 'quickbooks';

-- Update a customer's external ID after sync
UPDATE customers
SET external_ids = jsonb_set(
  COALESCE(external_ids, '{}'::jsonb),
  '{quickbooks}',
  '"89"'::jsonb
)
WHERE id = $1;

-- Index for fast lookups by external ID
CREATE INDEX idx_customers_external_ids ON customers USING gin (external_ids);
CREATE INDEX idx_jobs_external_ids ON jobs USING gin (external_ids);
CREATE INDEX idx_invoices_external_ids ON invoices USING gin (external_ids);
CREATE INDEX idx_estimates_external_ids ON estimates USING gin (external_ids);
CREATE INDEX idx_parts_external_ids ON parts USING gin (external_ids);
```

### Deduplication During Sync

When syncing data from an external system, the adapter checks `external_ids` to determine if a record already exists:

```typescript
async function upsertCustomer(orgId: string, provider: string, externalData: any): Promise<void> {
  const externalId = externalData.id.toString();

  // Check if customer already exists with this external ID
  const existing = await db.query(
    `SELECT id FROM customers WHERE org_id = $1 AND external_ids->>$2 = $3`,
    [orgId, provider, externalId]
  );

  if (existing.rows.length > 0) {
    // Update existing customer
    await db.query(
      `UPDATE customers SET
        name = $1, email = $2, phone = $3, address = $4, updated_at = NOW()
       WHERE id = $5`,
      [externalData.name, externalData.email, externalData.phone, externalData.address, existing.rows[0].id]
    );
  } else {
    // Check if customer exists by name+email (fuzzy match for cross-platform dedup)
    const fuzzyMatch = await db.query(
      `SELECT id FROM customers WHERE org_id = $1 AND (email = $2 OR (name ILIKE $3 AND phone = $4))`,
      [orgId, externalData.email, externalData.name, externalData.phone]
    );

    if (fuzzyMatch.rows.length > 0) {
      // Found a match: add external ID to existing record
      await db.query(
        `UPDATE customers SET external_ids = jsonb_set(COALESCE(external_ids, '{}'::jsonb), $1, $2) WHERE id = $3`,
        [`{${provider}}`, `"${externalId}"`, fuzzyMatch.rows[0].id]
      );
    } else {
      // New customer: create with external ID
      await db.query(
        `INSERT INTO customers (org_id, name, email, phone, address, external_ids)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orgId, externalData.name, externalData.email, externalData.phone, externalData.address, JSON.stringify({ [provider]: externalId })]
      );
    }
  }
}
```

---

## 5. OAuth2 Flow

### Step-by-Step

```
1. User clicks "Connect QuickBooks" in the CrewShift UI
       |
       v
2. Frontend calls GET /api/integrations/quickbooks/connect
       |
       v
3. API calls adapter.getAuthUrl(orgId, redirectUri)
   Returns: https://appcenter.intuit.com/connect/oauth2?client_id=...&redirect_uri=...&state=orgId
       |
       v
4. API returns { auth_url } to frontend
       |
       v
5. Frontend redirects user to auth_url (opens QuickBooks login)
       |
       v
6. User authorizes CrewShift in QuickBooks
       |
       v
7. QuickBooks redirects to /api/integrations/quickbooks/callback?code=xxx&state=orgId&realmId=yyy
       |
       v
8. API calls adapter.handleCallback(code, orgId, redirectUri)
   - Exchanges code for access_token + refresh_token
   - Returns TokenSet
       |
       v
9. API calls oauthService.storeTokens(orgId, 'quickbooks', tokenSet)
   - Encrypts tokens with pgcrypto
   - Stores in integrations table
   - Sets status = 'connected'
       |
       v
10. API redirects user back to CrewShift UI (/integrations?connected=quickbooks)
       |
       v
11. Initial sync triggered automatically
   - adapter.syncCustomers(integration)
   - adapter.syncJobs(integration) (if applicable)
   - adapter.syncInvoices(integration)
```

### Implementation

```typescript
// src/integrations/oauth.service.ts

export class OAuthService {
  constructor(
    private integrationRepo: IntegrationRepository,
    private tokenStore: TokenStore,  // handles pgcrypto encryption
  ) {}

  /**
   * Step 3: Generate auth URL
   */
  async getAuthUrl(provider: string, orgId: string): Promise<string> {
    const adapter = getAdapter(provider);
    const redirectUri = `${env.API_URL}/api/integrations/${provider}/callback`;

    // State parameter encodes orgId for the callback
    return adapter.getAuthUrl(orgId, redirectUri);
  }

  /**
   * Steps 8-9: Handle callback, exchange code, store tokens
   */
  async handleCallback(provider: string, code: string, orgId: string): Promise<void> {
    const adapter = getAdapter(provider);
    const redirectUri = `${env.API_URL}/api/integrations/${provider}/callback`;

    // Exchange authorization code for tokens
    const tokenSet = await adapter.handleCallback(code, orgId, redirectUri);

    // Store encrypted tokens
    await this.tokenStore.storeTokens(
      orgId,
      provider,
      tokenSet.access_token,
      tokenSet.refresh_token,
      tokenSet.expires_at,
      tokenSet.external_account_id || ''
    );

    // Trigger initial sync
    await syncQueue.add(`sync:${provider}:initial`, {
      orgId,
      provider,
      type: 'initial',
    });
  }
}

// Route handlers
// src/routes/integrations.routes.ts

app.get('/api/integrations/:provider/connect', {
  preHandler: [authMiddleware, requireRole('owner', 'admin')],
}, async (request, reply) => {
  const { provider } = request.params as { provider: string };
  const authUrl = await oauthService.getAuthUrl(provider, request.orgId);
  return reply.send({ data: { auth_url: authUrl } });
});

app.get('/api/integrations/:provider/callback', async (request, reply) => {
  const { provider } = request.params as { provider: string };
  const { code, state, realmId } = request.query as { code: string; state: string; realmId?: string };

  const orgId = state; // orgId was encoded in the state parameter

  await oauthService.handleCallback(provider, code, orgId);

  // Redirect back to UI
  return reply.redirect(`${env.FRONTEND_URL}/integrations?connected=${provider}`);
});
```

---

## 6. Token Refresh

### Proactive Refresh via Scheduled Job

OAuth tokens have limited lifetimes (QuickBooks: 1 hour for access token, 100 days for refresh token). We refresh them **proactively** before they expire to avoid failed API calls during agent execution.

```typescript
// Scheduled job: token-refresh-check
// Runs every 15 minutes via BullMQ repeatable job

async function refreshExpiringTokens(): Promise<void> {
  // Find all integrations with tokens expiring within 30 minutes
  const expiring = await integrationRepo.findExpiringSoon(30); // 30 minutes buffer

  for (const integration of expiring) {
    try {
      const adapter = getAdapter(integration.provider);
      const decryptedTokens = await tokenStore.getDecryptedTokens(integration.org_id, integration.provider);

      // Call the provider's token refresh endpoint
      const newTokens = await adapter.refreshToken({
        ...integration,
        access_token: decryptedTokens.access_token,
        refresh_token: decryptedTokens.refresh_token,
      });

      // Store new tokens (encrypted)
      await tokenStore.storeTokens(
        integration.org_id,
        integration.provider,
        newTokens.access_token,
        newTokens.refresh_token,
        newTokens.expires_at,
        integration.external_account_id
      );

      logger.info({ provider: integration.provider, orgId: integration.org_id }, 'Token refreshed successfully');
    } catch (error) {
      logger.error({ error, provider: integration.provider, orgId: integration.org_id }, 'Token refresh failed');

      // Mark integration as errored
      await integrationRepo.updateStatus(integration.id, 'error');

      // Notify org admins
      await notificationService.send({
        orgId: integration.org_id,
        type: 'alert',
        title: `${integration.provider} connection error`,
        body: 'Your connection has expired. Please reconnect.',
        channel: 'in_app',
        actionUrl: `/integrations/${integration.provider}/reconnect`,
      });
    }
  }
}
```

### Handling Token Rotation

Some providers rotate refresh tokens on every use (each refresh returns a new refresh token). The system handles this by always storing both tokens atomically:

```typescript
// Token storage is always atomic: access + refresh + expiry in one transaction
await tokenStore.storeTokens(orgId, provider, newAccessToken, newRefreshToken, newExpiresAt);
```

If a refresh fails because the refresh token has been revoked or expired:
1. The integration status is set to `'error'`
2. An in-app notification tells the admin to reconnect
3. Agent executions that depend on this integration are queued with a `'integration_error'` status
4. When the user reconnects, queued jobs are re-processed

---

## 7. Sync Service

### How Initial Sync Works

When a user first connects an integration, an initial sync pulls all existing data from the external system into CrewShift.

```typescript
// src/integrations/sync.service.ts

export class SyncService {
  /**
   * Initial sync: pull all data from the external system.
   * Runs once after OAuth callback.
   */
  async initialSync(orgId: string, provider: string): Promise<SyncReport> {
    const adapter = getAdapter(provider);
    const integration = await integrationRepo.findByProvider(orgId, provider);
    if (!integration) throw new Error(`Integration not found: ${provider}`);

    const report: SyncReport = { customers: null, jobs: null, invoices: null };

    // Sync in order: customers first (other entities reference them)
    report.customers = await adapter.syncCustomers(integration);
    logger.info({ provider, orgId, ...report.customers }, 'Customers synced');

    if (adapter.syncJobs) {
      report.jobs = await adapter.syncJobs(integration);
      logger.info({ provider, orgId, ...report.jobs }, 'Jobs synced');
    }

    report.invoices = await adapter.syncInvoices(integration);
    logger.info({ provider, orgId, ...report.invoices }, 'Invoices synced');

    if (adapter.syncEstimates) {
      report.estimates = await adapter.syncEstimates(integration);
    }

    if (adapter.syncParts) {
      report.parts = await adapter.syncParts(integration);
    }

    // Update last_sync_at
    await integrationRepo.updateLastSync(integration.id);

    return report;
  }
}
```

### Incremental Sync

After initial sync, incremental syncs pull only changed data. This is done via:

1. **Webhooks** (preferred): External system pushes changes in real-time
2. **Polling** (fallback): Scheduled job checks for changes every 5-15 minutes

```typescript
/**
 * Incremental sync: pull only changes since last sync.
 * Uses the 'since' parameter to filter for modified records.
 */
async incrementalSync(orgId: string, provider: string): Promise<SyncReport> {
  const adapter = getAdapter(provider);
  const integration = await integrationRepo.findByProvider(orgId, provider);
  if (!integration) throw new Error(`Integration not found: ${provider}`);

  const since = integration.last_sync_at || new Date(0);

  const report: SyncReport = {};

  report.customers = await adapter.syncCustomers(integration, since);
  if (adapter.syncJobs) {
    report.jobs = await adapter.syncJobs(integration, since);
  }
  report.invoices = await adapter.syncInvoices(integration, since);

  await integrationRepo.updateLastSync(integration.id);

  return report;
}
```

### Conflict Resolution: Last-Write-Wins for MVP

When a record is modified in both CrewShift and the external system between syncs, we use **last-write-wins** based on `updated_at` timestamps.

```typescript
// During sync: compare timestamps
if (external.updated_at > crewshift.updated_at) {
  // External is newer: update CrewShift
  await updateLocal(crewshift.id, external);
} else {
  // CrewShift is newer: push to external (write-back)
  await adapter.updateExternal(integration, crewshift);
}
```

**Why last-write-wins?** For MVP, this is the simplest conflict resolution strategy. Most records are only modified in one system at a time. True conflict (simultaneous edits in both systems) is rare for trades businesses. If this becomes a problem, we can implement field-level merging in a future phase.

### Scheduled Sync Jobs

```typescript
// Polling fallback: check for changes every 15 minutes
// For integrations that don't support webhooks or as a safety net

const SYNC_SCHEDULE = {
  name: 'integration-incremental-sync',
  cron: '*/15 * * * *',  // Every 15 minutes
  handler: async () => {
    const connectedIntegrations = await integrationRepo.findAllConnected();
    for (const integration of connectedIntegrations) {
      await syncQueue.add(`sync:${integration.provider}:incremental`, {
        orgId: integration.org_id,
        provider: integration.provider,
        type: 'incremental',
      });
    }
  },
};
```

---

## 8. Write-Back

### How CrewShift Writes Data Back to External Systems

Write-back is critical. Agents do not just read — they write. Examples:

| Action | CrewShift | External System |
|---|---|---|
| Invoice Agent creates an invoice | Creates record in `invoices` table | Creates invoice in QuickBooks |
| Field Ops Agent schedules a job | Updates record in `jobs` table | Updates job in Jobber |
| Customer Agent sends an email | Logs message in `agent_executions` | Sends email via Google Workspace |
| Collections Agent sends a payment link | Updates invoice metadata | Creates payment link in Stripe |
| Inventory Agent deducts parts | Updates `parts` table | Updates stock in Fishbowl |

### Write-Back Implementation

```typescript
// Example: Invoice Agent write-back to QuickBooks

async function writeBackInvoice(orgId: string, invoice: Invoice): Promise<void> {
  // Check if QuickBooks is connected
  const qbIntegration = await integrationRepo.findByProvider(orgId, 'quickbooks');
  if (!qbIntegration || qbIntegration.status !== 'connected') return;

  const adapter = getAdapter('quickbooks') as QuickBooksAdapter;

  try {
    // Create invoice in QuickBooks
    const externalId = await adapter.createInvoice(qbIntegration, invoice);

    // Store the QuickBooks ID in the invoice's external_ids
    await invoiceRepo.addExternalId(invoice.id, 'quickbooks', externalId.external_id);

    logger.info({
      invoiceId: invoice.id,
      quickbooksId: externalId.external_id,
    }, 'Invoice synced to QuickBooks');
  } catch (error) {
    logger.error({ error, invoiceId: invoice.id }, 'Failed to sync invoice to QuickBooks');

    // Queue for retry (don't fail the agent execution)
    await syncQueue.add('sync:quickbooks:write-back-retry', {
      orgId,
      entityType: 'invoice',
      entityId: invoice.id,
      retryCount: 0,
    });
  }
}
```

### Write-Back Error Handling

Write-back failures do **not** fail the agent execution. The record exists in CrewShift; the external sync catches up later.

```
Agent creates invoice in CrewShift DB  -->  SUCCESS
Agent syncs invoice to QuickBooks       -->  FAILURE (QuickBooks API timeout)
                                              |
                                              v
                                        Queue retry job
                                        (exponential backoff: 5s, 10s, 20s, 40s, 80s)
                                              |
                                              v
                                        Retry succeeds --> QuickBooks synced
                                              |
                                              v (if all retries fail)
                                        Mark sync as failed
                                        Notify admin: "Invoice 1234 failed to sync to QuickBooks"
                                        Manual sync button available in UI
```

---

## 9. Webhook Processing

### Pipeline: Receive, Verify, Enqueue, Process, Emit

```
External Service (QuickBooks, Stripe, Jobber)
         |
         | POST /api/webhooks/:provider
         v
+------------------+
| 1. RECEIVE       |  Accept the HTTP request
+--------+---------+
         |
+--------v---------+
| 2. VERIFY        |  Check signature (provider-specific)
+--------+---------+  If invalid: return 401, log warning
         |
+--------v---------+
| 3. ACKNOWLEDGE   |  Return HTTP 200 immediately
+--------+---------+  Do NOT process synchronously (external systems have short timeouts)
         |
+--------v---------+
| 4. ENQUEUE       |  Add to BullMQ webhook processing queue
+--------+---------+  Includes: provider, payload, received_at
         |
         |  (async, in the background)
         v
+--------+---------+
| 5. PROCESS       |  Webhook worker picks up the job
+--------+---------+  Calls adapter.processWebhook(payload)
         |           Returns normalized WebhookEvent
+--------v---------+
| 6. SYNC          |  Update CrewShift's data based on the event
+--------+---------+  (upsert customer, update invoice status, etc.)
         |
+--------v---------+
| 7. EMIT EVENT    |  Emit internal event on the event bus
+-------------------+  e.g., 'invoice.paid', 'job.created'
                       Triggers matching agents
```

### Implementation

```typescript
// src/integrations/webhook.processor.ts

export class WebhookProcessor {
  async processWebhook(provider: string, payload: any): Promise<void> {
    const adapter = getAdapter(provider);
    if (!adapter) {
      logger.warn({ provider }, 'Unknown webhook provider');
      return;
    }

    // Normalize the webhook payload into a CrewShift event
    const event = await adapter.processWebhook(payload);

    // Determine which org this event belongs to
    const orgId = await this.resolveOrg(provider, event);
    if (!orgId) {
      logger.warn({ provider, event: event.type }, 'Could not resolve org for webhook');
      return;
    }

    // Update local data based on the event type
    switch (event.type) {
      case 'customer.created':
      case 'customer.updated':
        await syncService.syncSingleCustomer(orgId, provider, event.external_id, event.data);
        break;

      case 'invoice.paid':
        await this.handleInvoicePaid(orgId, provider, event);
        break;

      case 'job.created':
      case 'job.updated':
        await syncService.syncSingleJob(orgId, provider, event.external_id, event.data);
        break;

      case 'payment.completed':
        await this.handlePaymentCompleted(orgId, provider, event);
        break;
    }

    // Emit internal event to trigger agents
    eventBus.emit(event.type, {
      orgId,
      source: 'webhook',
      provider,
      ...event.data,
    });
  }

  private async resolveOrg(provider: string, event: WebhookEvent): Promise<string | null> {
    // Look up which org this external account belongs to
    const integration = await integrationRepo.findByExternalAccountId(
      provider,
      event.data.account_id || event.data.realm_id || ''
    );
    return integration?.org_id || null;
  }
}
```

---

## 10. Per-Adapter Notes (Tier 1)

### QuickBooks Online

| Aspect | Detail |
|---|---|
| **API Type** | REST (v3), OAuth2 |
| **Base URL** | `https://quickbooks.api.intuit.com/v3/company/{realmId}` |
| **Auth** | OAuth2 with PKCE. Access token: 1 hour. Refresh token: 100 days. |
| **Rate Limits** | 500 requests/minute per realm |
| **Webhook** | Yes. Events: Invoice, Customer, Payment, Estimate. Verify via HMAC-SHA256. |
| **Key Entities** | Invoice, Customer, Payment, Estimate, Item, Account |
| **Write-back** | Create/Update Invoice, Create/Update Customer, Create Payment |
| **Notes** | RealmId is the company identifier. Must be stored with the integration. Tax calculation is complex (TaxService API). SandBox available for development. |
| **SDK** | `node-quickbooks` npm package or direct REST calls |

### Stripe

| Aspect | Detail |
|---|---|
| **API Type** | REST, API key auth (no OAuth for basic) |
| **Base URL** | `https://api.stripe.com/v1` |
| **Auth** | Secret API key per account. For Connect: OAuth2 for connected accounts. |
| **Rate Limits** | 100 requests/second in live mode |
| **Webhook** | Yes. Extensive event types. Verify via `stripe-signature` header using webhook secret. |
| **Key Entities** | Customer, Invoice, PaymentIntent, PaymentLink, Subscription |
| **Write-back** | Create Invoice, Create PaymentLink, Create Customer |
| **Notes** | Best API in the industry. Excellent SDK (`stripe` npm package). Idempotency keys supported natively. Payment links are ideal for collections follow-ups. |
| **SDK** | `stripe` npm package |

### Jobber

| Aspect | Detail |
|---|---|
| **API Type** | GraphQL, OAuth2 |
| **Base URL** | `https://api.getjobber.com/api/graphql` |
| **Auth** | OAuth2. Partner program required for production access. |
| **Rate Limits** | Cost-based query complexity limits |
| **Webhook** | Yes. Events for jobs, clients, invoices, quotes. Verify via HMAC-SHA256. |
| **Key Entities** | Client, Job, Visit, Invoice, Quote, Request |
| **Write-back** | Update Job status, Create/Update Client, Create Invoice |
| **Notes** | GraphQL API means we can request exactly the fields we need (no over-fetching). Partner program approval required (takes 2-4 weeks). "Visit" is a scheduled occurrence of a job. Listed in Jobber App Marketplace. |
| **SDK** | Direct GraphQL calls via `graphql-request` or `urql` |

### ServiceTitan

| Aspect | Detail |
|---|---|
| **API Type** | REST (v2), API key + OAuth2 |
| **Base URL** | `https://api.servicetitan.io` |
| **Auth** | OAuth2 with client credentials. App must be approved by ServiceTitan partner program. |
| **Rate Limits** | Varies by endpoint. Generally 100 requests/minute. |
| **Webhook** | Limited. Primarily polling-based sync. Some events available via their integration platform. |
| **Key Entities** | Customer, Job, Invoice, Estimate, Technician, Dispatch |
| **Write-back** | Update Job status, Create Invoice, Update Dispatch |
| **Notes** | Most complex integration. Partner API requires approval process (4-8 weeks). Serves larger contractors (20+ techs). Data model is deep — jobs have multiple line items, materials, labor entries. Polling is primary sync method. |
| **SDK** | Direct REST calls |

### HousecallPro

| Aspect | Detail |
|---|---|
| **API Type** | REST, OAuth2 |
| **Base URL** | `https://api.housecallpro.com/v1` |
| **Auth** | OAuth2. Developer portal available. |
| **Rate Limits** | Standard rate limits (documented in API) |
| **Webhook** | Yes. Events for jobs, customers, invoices. |
| **Key Entities** | Customer, Job, Invoice, Estimate, Employee |
| **Write-back** | Update Job, Create Customer, Create Invoice |
| **Notes** | Similar data model to Jobber but simpler. Targets smaller contractors (2-10 techs). Good API documentation. Simpler to integrate than ServiceTitan. |
| **SDK** | Direct REST calls |

### Plaid

| Aspect | Detail |
|---|---|
| **API Type** | REST, Link token flow |
| **Base URL** | `https://production.plaid.com` or `https://sandbox.plaid.com` |
| **Auth** | Link token flow (not standard OAuth2). User connects via Plaid Link UI component. |
| **Rate Limits** | Varies by product. Generally generous. |
| **Webhook** | Yes. Transaction webhooks for new/updated transactions. |
| **Key Entities** | Account, Transaction, Balance, Institution |
| **Write-back** | Read-only. Plaid is for data retrieval, not writes. |
| **Notes** | Used by Bookkeeping Agent for automatic expense categorization and cash flow tracking. Plaid Link is a drop-in UI component — the user selects their bank and authorizes access. No standard OAuth2; uses Plaid's Link token flow. |
| **SDK** | `plaid` npm package |

### Fleetio

| Aspect | Detail |
|---|---|
| **API Type** | REST, API token auth |
| **Base URL** | `https://secure.fleetio.com/api/v1` |
| **Auth** | API token + Account token (not OAuth2). Tokens provided by user during setup. |
| **Rate Limits** | 120 requests/minute |
| **Webhook** | Yes. Events for vehicle status, maintenance, fuel entries. |
| **Key Entities** | Vehicle, MaintenanceEntry, FuelEntry, Contact (driver) |
| **Write-back** | Create Maintenance Entry, Update Vehicle |
| **Notes** | Used by Compliance Agent for vehicle tracking, maintenance schedules, mileage tracking for tax purposes. Simple REST API. Token-based auth (user enters their API token during integration setup). |
| **SDK** | Direct REST calls |

### Fishbowl

| Aspect | Detail |
|---|---|
| **API Type** | REST/SOAP hybrid. Newer versions have REST. |
| **Base URL** | Varies by deployment (cloud or on-premise) |
| **Auth** | API key or username/password depending on version |
| **Rate Limits** | Varies by deployment |
| **Webhook** | Limited. Primarily polling-based. |
| **Key Entities** | Part, Inventory, PurchaseOrder, Vendor, Location |
| **Write-back** | Update Part quantity, Create PurchaseOrder |
| **Notes** | Used by Inventory Agent for parts management. Fishbowl is popular with trades businesses for inventory. API quality varies by version. On-premise deployments may require VPN access. Consider alternatives (inFlow, Sortly) if Fishbowl API proves difficult. |
| **SDK** | Direct REST/SOAP calls |

### Twilio

| Aspect | Detail |
|---|---|
| **API Type** | REST |
| **Base URL** | `https://api.twilio.com/2010-04-01` |
| **Auth** | Account SID + Auth Token (Basic auth) |
| **Rate Limits** | 100 messages/second (US). Carrier-dependent limits for SMS. |
| **Webhook** | Yes. Status callbacks for message delivery, incoming messages. Verify via request signature. |
| **Key Entities** | Message, Call, PhoneNumber |
| **Write-back** | Send SMS, Send MMS, Make Call |
| **Notes** | Best-in-class messaging API. Used by Customer Agent (confirmations, ETAs, review requests), Collections Agent (payment reminders), Field Ops Agent (tech notifications). A2P 10DLC registration required for business SMS. Consider Twilio Verify for OTP in future. |
| **SDK** | `twilio` npm package |

### Google Workspace

| Aspect | Detail |
|---|---|
| **API Type** | REST (Google APIs), OAuth2 |
| **Base URL** | Various: `gmail.googleapis.com`, `calendar.googleapis.com` |
| **Auth** | OAuth2 with Google Identity Services. Scopes: gmail.send, calendar.events. |
| **Rate Limits** | Gmail: 250 messages/day for @gmail, 2000/day for Workspace. Calendar: 10 requests/second. |
| **Webhook** | Gmail: Push notifications via Pub/Sub. Calendar: Push notifications via webhook. |
| **Key Entities** | Message (Gmail), Event (Calendar), Contact |
| **Write-back** | Send Email, Create Calendar Event, Update Calendar Event |
| **Notes** | Used by Customer Agent for email communications and Field Ops Agent for calendar-based scheduling. OAuth2 scopes must be carefully selected (principle of least privilege). Gmail API for sending business emails. Calendar API for tech scheduling. |
| **SDK** | `googleapis` npm package |

---

## 11. Unified API Wrapper (Tier 2)

### How Merge.dev/Nango Calls Are Wrapped

Tier 2 integrations are accessed via Merge.dev or Nango. These unified API services provide a single API for multiple providers. CrewShift wraps these calls behind the same `IntegrationAdapter` interface so the agent runtime never knows the difference.

```typescript
// src/integrations/unified-api.adapter.ts

import { IntegrationAdapter, TokenSet, SyncResult, ExternalId, WebhookEvent } from './adapter.interface';

/**
 * Unified API adapter that wraps Merge.dev/Nango calls.
 * Implements the same IntegrationAdapter interface as native adapters.
 * The agent runtime and sync service interact with this adapter
 * identically to how they interact with native adapters.
 */
export class UnifiedApiAdapter implements IntegrationAdapter {
  provider: string;
  tier: 'unified' = 'unified';

  private mergeApiKey: string;
  private mergeBaseUrl = 'https://api.merge.dev/api';

  constructor(provider: string) {
    this.provider = provider;
    this.mergeApiKey = env.MERGE_API_KEY;
  }

  // OAuth: Merge.dev handles OAuth flow via their Link component
  getAuthUrl(orgId: string, redirectUri: string): string {
    // Merge.dev uses their own "Link" component for OAuth
    // Generate a link token that embeds the orgId
    return `https://app.merge.dev/link?link_token=${this.generateLinkToken(orgId)}`;
  }

  async handleCallback(code: string, orgId: string): Promise<TokenSet> {
    // Merge.dev provides an account_token after the user connects
    // This token is used for all subsequent API calls
    const response = await fetch(`${this.mergeBaseUrl}/account-token/${code}`, {
      headers: { Authorization: `Bearer ${this.mergeApiKey}` },
    });
    const data = await response.json();

    return {
      access_token: data.account_token,
      refresh_token: '', // Merge.dev manages refresh internally
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Merge tokens don't expire
    };
  }

  async refreshToken(integration: any): Promise<TokenSet> {
    // Merge.dev manages token refresh internally
    // No action needed
    return {
      access_token: integration.access_token,
      refresh_token: '',
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    };
  }

  // Sync: Uses Merge.dev's unified data model
  async syncCustomers(integration: any, since?: Date): Promise<SyncResult> {
    const params = since ? `?modified_after=${since.toISOString()}` : '';
    const response = await fetch(`${this.mergeBaseUrl}/crm/v1/contacts${params}`, {
      headers: {
        Authorization: `Bearer ${this.mergeApiKey}`,
        'X-Account-Token': integration.access_token,
      },
    });

    const data = await response.json();

    // Map Merge.dev's unified model to CrewShift's model
    let created = 0, updated = 0;
    for (const contact of data.results) {
      const mapped = this.mapMergeContactToCustomer(contact);
      const result = await upsertCustomer(integration.org_id, this.provider, mapped);
      if (result === 'created') created++;
      else updated++;
    }

    return { created, updated, skipped: 0, errors: [] };
  }

  async syncJobs(integration: any, since?: Date): Promise<SyncResult> {
    // Not all Merge.dev categories support jobs
    // Implement if the provider supports it
    return { created: 0, updated: 0, skipped: 0, errors: [] };
  }

  async syncInvoices(integration: any, since?: Date): Promise<SyncResult> {
    const params = since ? `?modified_after=${since.toISOString()}` : '';
    const response = await fetch(`${this.mergeBaseUrl}/accounting/v1/invoices${params}`, {
      headers: {
        Authorization: `Bearer ${this.mergeApiKey}`,
        'X-Account-Token': integration.access_token,
      },
    });

    const data = await response.json();
    let created = 0, updated = 0;
    for (const invoice of data.results) {
      const mapped = this.mapMergeInvoiceToInvoice(invoice);
      const result = await upsertInvoice(integration.org_id, this.provider, mapped);
      if (result === 'created') created++;
      else updated++;
    }

    return { created, updated, skipped: 0, errors: [] };
  }

  // Write-back: Uses Merge.dev's write API
  async createInvoice(integration: any, invoice: any): Promise<ExternalId> {
    const mergeInvoice = this.mapInvoiceToMerge(invoice);
    const response = await fetch(`${this.mergeBaseUrl}/accounting/v1/invoices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.mergeApiKey}`,
        'X-Account-Token': integration.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: mergeInvoice }),
    });

    const data = await response.json();
    return { provider: this.provider, external_id: data.model.id };
  }

  async updateJobStatus(integration: any, jobId: string, status: string): Promise<void> {
    // Implement if the provider supports job updates via Merge.dev
  }

  // Webhooks: Merge.dev handles webhooks and forwards normalized events
  verifyWebhook(payload: any, signature: string): boolean {
    // Merge.dev uses webhook signing keys
    const hash = crypto
      .createHmac('sha256', env.MERGE_WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  }

  async processWebhook(payload: any): Promise<WebhookEvent> {
    return {
      type: this.mapMergeEventType(payload.event),
      provider: this.provider,
      external_id: payload.data?.id || '',
      data: payload.data,
      raw: payload,
      timestamp: new Date(payload.created_at),
    };
  }

  async healthCheck(integration: any): Promise<{ healthy: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.mergeBaseUrl}/account-details`, {
        headers: {
          Authorization: `Bearer ${this.mergeApiKey}`,
          'X-Account-Token': integration.access_token,
        },
      });
      return { healthy: response.ok };
    } catch (error) {
      return { healthy: false, error: (error as Error).message };
    }
  }

  // Private mapping methods
  private mapMergeContactToCustomer(contact: any): any {
    return {
      id: contact.id,
      name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
      email: contact.email_addresses?.[0]?.email_address || null,
      phone: contact.phone_numbers?.[0]?.phone_number || null,
      address: contact.addresses?.[0] ? {
        street: contact.addresses[0].street_1,
        city: contact.addresses[0].city,
        state: contact.addresses[0].state,
        zip: contact.addresses[0].postal_code,
      } : null,
    };
  }

  private mapMergeInvoiceToInvoice(invoice: any): any {
    return {
      id: invoice.id,
      invoice_number: invoice.number,
      total: parseFloat(invoice.total_amount || 0),
      status: this.mapMergeInvoiceStatus(invoice.status),
      due_date: invoice.due_date,
      line_items: (invoice.line_items || []).map((li: any) => ({
        description: li.description,
        quantity: li.quantity,
        unit_price: parseFloat(li.unit_price || 0),
        total: parseFloat(li.total_amount || 0),
      })),
    };
  }
}
```

---

## 12. Project Structure

```
src/integrations/
├── adapter.interface.ts          # Base adapter contract (IntegrationAdapter interface)
│                                 # All adapters implement this interface
│
├── sync.service.ts               # Sync orchestration
│                                 # Initial sync, incremental sync, conflict resolution
│                                 # Coordinates syncing across all connected integrations
│
├── oauth.service.ts              # OAuth2 flow handler
│                                 # getAuthUrl, handleCallback, token storage
│                                 # Works with token encryption in 05-security.md
│
├── webhook.processor.ts          # Inbound webhook processing
│                                 # Receive → verify → enqueue → process → emit
│                                 # Provider-agnostic orchestration
│
├── unified-api.adapter.ts        # Merge.dev/Nango wrapper
│                                 # Implements IntegrationAdapter for Tier 2 integrations
│                                 # Maps between Merge.dev's unified model and CrewShift's model
│
└── adapters/                     # Individual adapter implementations
    │
    ├── quickbooks.adapter.ts     # Native — OAuth2 + REST
    │                             # Sync: customers, invoices, payments
    │                             # Write-back: create/update invoices, payments
    │                             # Webhook: invoice, customer, payment events
    │
    ├── stripe.adapter.ts         # Native — API key + webhooks
    │                             # Sync: customers, invoices, payments, subscriptions
    │                             # Write-back: create invoices, payment links
    │                             # Webhook: extensive event coverage
    │
    ├── jobber.adapter.ts         # Native — GraphQL + OAuth2
    │                             # Sync: clients, jobs, visits, invoices, quotes
    │                             # Write-back: update job status, create invoices
    │                             # Webhook: job, client, invoice events
    │
    ├── servicetitan.adapter.ts   # Native — REST + OAuth2
    │                             # Sync: customers, jobs, invoices, estimates, techs
    │                             # Write-back: update job, create invoice, dispatch
    │                             # Webhook: limited, primarily polling
    │
    ├── housecallpro.adapter.ts   # Native — REST + OAuth2
    │                             # Sync: customers, jobs, invoices, estimates
    │                             # Write-back: update job, create invoice
    │                             # Webhook: job, customer events
    │
    ├── plaid.adapter.ts          # Native — Link token flow
    │                             # Sync: accounts, transactions (read-only)
    │                             # Write-back: none (read-only)
    │                             # Webhook: transaction updates
    │
    ├── fleetio.adapter.ts        # Native — API token auth
    │                             # Sync: vehicles, maintenance entries, fuel
    │                             # Write-back: create maintenance entry
    │                             # Webhook: vehicle status, maintenance events
    │
    ├── fishbowl.adapter.ts       # Native — REST/SOAP
    │                             # Sync: parts, inventory levels, purchase orders
    │                             # Write-back: update part quantity, create PO
    │                             # Webhook: limited, primarily polling
    │
    ├── twilio.adapter.ts         # Native — REST
    │                             # Sync: none (Twilio is send-only for us)
    │                             # Write-back: send SMS, send MMS
    │                             # Webhook: delivery status, incoming messages
    │
    └── google.adapter.ts         # Native — OAuth2 + REST
                                  # Gmail: send email, read email (optional)
                                  # Calendar: create/update events, read schedule
                                  # Write-back: send email, create calendar event
                                  # Webhook: Gmail push notifications, Calendar push
```

### File Responsibilities

| File | Responsibility |
|---|---|
| `adapter.interface.ts` | Defines the `IntegrationAdapter` interface, `TokenSet`, `ExternalId`, `WebhookEvent`, `SyncResult` types |
| `sync.service.ts` | Coordinates initial and incremental sync. Handles conflict resolution. Manages sync scheduling. |
| `oauth.service.ts` | Generates auth URLs, handles callbacks, stores encrypted tokens. Works with `05-security.md` token encryption. |
| `webhook.processor.ts` | Routes inbound webhooks to the correct adapter. Verifies signatures. Enqueues for async processing. Emits events on the event bus. |
| `unified-api.adapter.ts` | Single adapter that wraps all Merge.dev/Nango calls. Maps between unified and CrewShift models. One file handles all Tier 2 integrations. |
| `adapters/*.adapter.ts` | Individual native adapters. Each implements the full `IntegrationAdapter` interface with provider-specific API calls, data mapping, and webhook handling. |

---

## Cross-References

- **Security (token encryption, webhook signature verification):** See [05-security.md](./05-security.md)
- **Agent runtime (how agents use integration data):** See [06-agent-runtime.md](./06-agent-runtime.md)
- **Agent definitions (which agents depend on which integrations):** See [07-agent-definitions.md](./07-agent-definitions.md)
- **Database schema (integrations table, external_ids columns):** See [02-database-schema.md](./02-database-schema.md)
- **Queue system (sync workers, webhook workers):** See [14-queue-system.md](./14-queue-system.md)
- **Error handling (retry strategies for integration calls):** See [22-error-handling.md](./22-error-handling.md)
