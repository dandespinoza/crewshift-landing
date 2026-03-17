# 20 - Anonymized Data Pipeline

> **Permanent reference** for how CrewShift collects, anonymizes, stores, and uses operational data to build the compounding data moat that is the core competitive advantage.
> Cross-references: [02-database-schema](./02-database-schema.md) | [06-agent-runtime](./06-agent-runtime.md) | [14-queue-system](./14-queue-system.md) | [05-security](./05-security.md) | [22-error-handling](./22-error-handling.md)

---

## 1. Purpose

Every agent execution generates valuable operational data: invoice amounts, estimate acceptance rates, collections timing, job durations, material usage, customer communication patterns, scheduling efficiency. Individually, this data belongs to one contractor. Aggregated and anonymized across thousands of contractors, it becomes a pricing intelligence engine, a demand forecasting model, and a knowledge base that no competitor can replicate.

**The math:** 10,000 HVAC jobs across 500 contractors = more pricing knowledge per zip code, per job type, per season than any human estimator could accumulate in a career. This is the data moat.

### What the Pipeline Enables

| Capability | Data Required | Competitive Impact |
|---|---|---|
| **Accurate estimates** | Historical invoice amounts by job type, trade, region, season | Estimates based on real market data, not guesswork |
| **Pricing optimization** | Win/loss rates on estimates at different price points | "Your estimate is 12% above market for this job type in Dallas" |
| **Payment prediction** | Collections data: amounts, timelines, follow-up effectiveness | "This customer segment has 87% on-time payment at Net 30" |
| **Demand forecasting** | Seasonal job volume patterns by trade and region | "Based on last 3 years, expect 40% demand increase next month" |
| **Material forecasting** | Parts usage by job type, frequency, supplier pricing | "Average compressor replacement uses 3 lbs R-410A in DFW area" |
| **Response optimization** | Customer communication patterns and response rates | "SMS follow-ups at 10am Tuesday get 34% higher response rate" |
| **Route optimization** | Scheduling patterns, job durations by type and distance | "Average HVAC service call in DFW takes 2.4 hours including travel" |

### Decision Rationale

Why build this from day one? Because the data moat compounds. Starting data collection at launch means 12 months of data by the time competitors realize they need it. The anonymization pipeline costs almost nothing to run (a daily BullMQ cron job) but creates a defensible asset worth millions.

---

## 2. What Gets Collected

| Data Type | Source Table/Agent | Training Use | Volume Estimate (per org/month) |
|---|---|---|---|
| **Invoice line items + amounts** | `invoices` via Invoice Agent | Pricing models by trade/region/job type | 50-200 invoices |
| **Estimate details + acceptance rates** | `estimates` via Estimate Agent | Win-rate optimization, pricing accuracy | 30-100 estimates |
| **Collections follow-up patterns + outcomes** | `agent_executions` (collections type) | Payment prediction, timing optimization | 20-80 follow-ups |
| **Job descriptions + durations + materials** | `jobs` table | Job complexity estimation, material forecasting | 50-200 jobs |
| **Customer communication patterns** | `agent_executions` (customer type) | Response optimization, sentiment models | 100-500 communications |
| **Parts usage by job type** | `jobs.materials` + `parts` table | Parts prediction, demand forecasting | 50-200 parts records |
| **Scheduling patterns + efficiency** | `jobs` (scheduled vs actual times) | Route optimization, capacity planning | 50-200 schedule records |
| **Estimate-to-invoice conversion** | `estimates` + `invoices` (linked by customer) | Close rate analysis, pricing elasticity | 30-100 conversions |
| **Agent confidence scores** | `agent_executions.confidence_score` | Model accuracy benchmarking | All executions |
| **Agent corrections** | `agent_executions` (review queue: approved with edits vs approved as-is) | Fine-tuning signal: what the AI got wrong | 10-50 corrections |

### What Is Explicitly NOT Collected

| Data | Reason |
|---|---|
| Conversation message content | Too high PII risk, low training value compared to structured data |
| Customer photos (job site images) | File storage cost, PII in photos (faces, license plates), consent complexity |
| Internal team communications | Not relevant to trade model training |
| Financial account details | Never touches the pipeline -- encrypted at rest, never exported |
| Login/session data | No training value |

---

## 3. Anonymization Rules

### What Gets Stripped (PII Removal)

Every field that could identify a specific person, business, or address is either removed or transformed into a non-reversible form.

| Original Field | Anonymized Form | Method | Rationale |
|---|---|---|---|
| Customer name | Hashed ID (`cust_a7b3c9...`) | SHA-256 of `org_id + customer_id` | Preserves customer-level aggregation without revealing identity |
| Customer address | Zip code only (`75201`) | Strip street, city, state; keep 5-digit zip | Enables regional pricing models without locating individuals |
| Customer phone | **Removed** | Dropped entirely | No training value |
| Customer email | **Removed** | Dropped entirely | No training value |
| Business name | Hashed ID (`org_f4e2d1...`) | SHA-256 of `org_id` + salt | Enables org-level deduplication; cannot be reversed |
| Tech/employee name | Role + skill tags (`tech:hvac,epa608`) | Replace name with role and certifications | Preserves skill-based analysis without identifying individuals |
| Specific dates | Relative timestamps | Convert to `day_of_week`, `season`, `time_since_prior_job` | Preserves temporal patterns (seasonality, response timing) without pinpointing events |
| Invoice/estimate numbers | Sequential placeholder (`inv_001`, `est_001`) | Replace with anonymous sequential IDs per org_hash | Preserves conversion tracking without leaking numbering schemes |
| Notes/free text | **Scrubbed** | Regex PII removal + LLM scrub for remaining names/addresses | Preserves technical descriptions, removes personal references |
| GPS coordinates | **Removed** | Dropped entirely | Zip code sufficient for regional analysis |

### PII Scrubbing for Free-Text Fields

Job descriptions and notes often contain useful technical information ("Replaced Trane XV18 compressor, 3 lbs R-410A") mixed with PII ("Customer John mentioned..."). The anonymization worker runs a two-pass scrub:

```typescript
// Pass 1: Regex patterns for common PII
const PII_PATTERNS = [
  /\b[A-Z][a-z]+\s[A-Z][a-z]+\b/g,           // Proper names (FirstName LastName)
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,            // Phone numbers
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Emails
  /\b\d{1,5}\s\w+\s(St|Ave|Blvd|Dr|Ln|Rd|Ct|Way|Pl)\b/gi, // Street addresses
];

// Pass 2: Entity recognition via AI (batch, low-cost model)
// Catches names and addresses that regex misses
// Only runs on text that passed regex scrub but has high PII probability score
```

### What Gets Preserved (Valuable for Training)

These fields contain the actual intelligence that makes models better. They are preserved in full fidelity.

| Preserved Field | Source | Training Value |
|---|---|---|
| Line item descriptions | `invoices.line_items`, `estimates.line_items` | What work was done, how it was described |
| Line item amounts (unit price, total) | `invoices.line_items`, `estimates.line_items` | Pricing by service type |
| Job types + trade categories | `jobs.type`, `organizations.trade_type` | Model segmentation |
| Materials used + quantities + costs | `jobs.materials` | Parts prediction, cost modeling |
| Geographic region (state/metro) | Derived from zip code | Regional pricing differences |
| Seasonal patterns | Derived from relative timestamps | Demand forecasting |
| Payment timelines | `invoices.due_date`, `invoices.paid_at` (as duration) | Payment behavior modeling |
| Estimate-to-invoice conversion rates | Linked `estimates` and `invoices` | Pricing elasticity |
| Response rates and timing | `agent_executions` (customer agent) | Communication optimization |
| Labor hours by job type | `jobs.labor_hours` | Duration estimation |
| Job margins | `jobs.margin` | Profitability analysis |
| Agent confidence scores | `agent_executions.confidence_score` | Model accuracy tracking |
| Tax rates by region | `invoices.tax_rate` + zip code | Regional tax modeling |

---

## 4. Database Tables

### training_data

Stores every anonymized record. This is the core training data store.

```sql
-- ANONYMIZED TRAINING DATA
CREATE TABLE training_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Classification
  data_type TEXT NOT NULL,              -- 'invoice', 'estimate', 'job', 'collection',
                                        -- 'communication', 'parts_usage', 'scheduling'
  trade_type TEXT NOT NULL,             -- 'hvac', 'plumbing', 'electrical', 'roofing', etc.
  region TEXT,                          -- State or metro area (e.g., 'TX', 'DFW', 'US-South')

  -- The anonymized record (all PII removed)
  data JSONB NOT NULL,                  -- Full anonymized record (structure varies by data_type)

  -- Provenance (non-identifying)
  org_hash TEXT NOT NULL,               -- SHA-256 hash of org_id + salt (one-way, for dedup)
  source_execution_id UUID,             -- Reference to original agent_execution (for debugging)

  -- Quality
  quality_score REAL,                   -- 0.0-1.0 data quality rating (see Section 9)

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying during training data export
CREATE INDEX idx_training_data_type_trade ON training_data(data_type, trade_type);
CREATE INDEX idx_training_data_region ON training_data(region);
CREATE INDEX idx_training_data_quality ON training_data(quality_score) WHERE quality_score IS NOT NULL;
CREATE INDEX idx_training_data_org_hash ON training_data(org_hash);
CREATE INDEX idx_training_data_created ON training_data(created_at);

-- Composite index for common training data export queries
CREATE INDEX idx_training_data_export ON training_data(data_type, trade_type, region, quality_score)
  WHERE quality_score >= 0.5;
```

#### Example `data` JSONB for invoice type:

```json
{
  "customer_hash": "cust_a7b3c9e2f1...",
  "zip_code": "75201",
  "job_type": "service_call",
  "line_items": [
    {
      "description": "AC unit repair - compressor replacement",
      "quantity": 1,
      "unit_price": 850.00,
      "total": 850.00,
      "category": "equipment_repair"
    },
    {
      "description": "Refrigerant R-410A",
      "quantity": 3,
      "unit_price": 45.00,
      "total": 135.00,
      "category": "materials"
    },
    {
      "description": "Labor",
      "quantity": 4,
      "unit_price": 125.00,
      "total": 500.00,
      "category": "labor"
    }
  ],
  "subtotal": 1485.00,
  "tax_rate": 0.0825,
  "tax_amount": 122.51,
  "total": 1607.51,
  "margin_percent": 42.5,
  "labor_hours": 4.0,
  "materials": [
    {"name": "Scroll Compressor", "quantity": 1, "unit_cost": 420.00},
    {"name": "R-410A Refrigerant (lb)", "quantity": 3, "unit_cost": 18.00}
  ],
  "day_of_week": "wednesday",
  "season": "summer",
  "payment_terms": "net_30",
  "generated_by": "agent",
  "confidence_score": 0.94
}
```

### data_consent

Tracks which organizations have opted into data collection.

```sql
-- DATA COLLECTION CONSENT
CREATE TABLE data_consent (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,

  -- Consent status
  consented BOOLEAN DEFAULT false,
  consented_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,               -- Null if consent is active

  -- Consent details
  consent_version TEXT NOT NULL,         -- Which version of terms they agreed to (e.g., '2026.1')
  data_types_allowed TEXT[] NOT NULL     -- Which data types they allow collection for
    DEFAULT ARRAY['invoice', 'estimate', 'job', 'collection', 'communication', 'parts_usage', 'scheduling'],

  -- Consent source
  consented_by UUID REFERENCES profiles(id), -- Which user granted consent
  consent_method TEXT DEFAULT 'settings',    -- 'onboarding', 'settings', 'api'

  -- Metadata
  ip_address INET,                       -- IP at time of consent (for legal records)
  user_agent TEXT,                       -- Browser/client at time of consent

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick consent lookup during anonymization
CREATE INDEX idx_data_consent_active ON data_consent(org_id)
  WHERE consented = true AND revoked_at IS NULL;
```

### training_runs

Tracks model training runs and their performance metrics.

```sql
-- MODEL TRAINING RUNS
CREATE TABLE training_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Model identification
  model_name TEXT NOT NULL,              -- 'hvac-pricing-v1', 'payment-prediction-v1', etc.
  model_version TEXT NOT NULL,           -- Semantic version: '1.0.0', '1.1.0', etc.
  base_model TEXT,                       -- What it was fine-tuned from: 'gpt-4o-mini', 'mistral-7b', etc.

  -- Training data scope
  data_types_used TEXT[] NOT NULL,       -- ['invoice', 'estimate', 'job']
  trade_types TEXT[],                    -- ['hvac'] or ['hvac', 'plumbing'] for multi-trade models
  regions TEXT[],                        -- ['TX', 'CA'] or null for all regions
  record_count INTEGER NOT NULL,         -- How many training records were used
  date_range_start TIMESTAMPTZ,          -- Earliest record in training set
  date_range_end TIMESTAMPTZ,            -- Latest record in training set

  -- Training configuration
  config JSONB DEFAULT '{}',             -- Hyperparameters, training config, etc.

  -- Results
  metrics JSONB DEFAULT '{}',            -- {
                                          --   "accuracy": 0.92,
                                          --   "loss": 0.08,
                                          --   "eval_metrics": {...},
                                          --   "training_time_seconds": 3600,
                                          --   "cost_dollars": 45.00
                                          -- }

  -- Model artifact
  model_artifact_url TEXT,               -- S3/R2 URL to the trained model weights/adapter
  model_size_mb INTEGER,                 -- Size of the model artifact

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed', 'deployed'
  error TEXT,                             -- Error message if failed
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Deployment
  deployed_at TIMESTAMPTZ,               -- When this version was promoted to production
  is_active BOOLEAN DEFAULT false,        -- Whether this is the currently active model version

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for finding the active model version
CREATE INDEX idx_training_runs_active ON training_runs(model_name)
  WHERE is_active = true;

-- Index for training history
CREATE INDEX idx_training_runs_model ON training_runs(model_name, created_at DESC);
```

---

## 5. Anonymization Worker

The anonymization worker runs as a BullMQ scheduled job. It processes new agent executions from opted-in organizations, strips PII, and stores the anonymized records in the `training_data` table.

### Cron Configuration

```typescript
// apps/api/src/queue/scheduled-jobs.ts

{
  name: 'data-anonymization',
  cron: '0 2 * * *',   // Daily at 2:00 AM UTC
  handler: 'anonymizeNewExecutions',
  description: 'Process new agent executions into anonymized training data for opted-in orgs',
}
```

### Processing Logic

```typescript
// apps/api/src/queue/workers/scheduled.worker.ts (anonymization handler)

import { createHash } from 'crypto';

const ANONYMIZATION_SALT = env.ANONYMIZATION_SALT; // 32-byte random, in Railway secrets

interface AnonymizationResult {
  processed: number;
  skipped: number;
  errors: number;
}

async function anonymizeNewExecutions(): Promise<AnonymizationResult> {
  const result: AnonymizationResult = { processed: 0, skipped: 0, errors: 0 };

  // 1. Get all orgs with active consent
  const consentedOrgs = await db
    .select({ org_id: dataConsent.org_id, data_types_allowed: dataConsent.data_types_allowed })
    .from(dataConsent)
    .where(
      and(
        eq(dataConsent.consented, true),
        isNull(dataConsent.revoked_at),
      )
    );

  if (consentedOrgs.length === 0) {
    logger.info('No consented orgs, skipping anonymization');
    return result;
  }

  const orgIds = consentedOrgs.map(c => c.org_id);
  const orgConsentMap = new Map(consentedOrgs.map(c => [c.org_id, c.data_types_allowed]));

  // 2. Find agent executions not yet anonymized (completed, from consented orgs)
  //    Use a watermark: track the last processed execution ID per org
  const executions = await db
    .select()
    .from(agentExecutions)
    .where(
      and(
        inArray(agentExecutions.org_id, orgIds),
        eq(agentExecutions.status, 'completed'),
        isNull(agentExecutions.metadata['anonymized_at']),  // Not yet processed
      )
    )
    .orderBy(agentExecutions.created_at)
    .limit(1000); // Process in batches of 1000

  for (const execution of executions) {
    try {
      const allowedTypes = orgConsentMap.get(execution.org_id) ?? [];
      const dataType = mapAgentTypeToDataType(execution.agent_type);

      // 3. Check if this data type is allowed by org's consent
      if (!allowedTypes.includes(dataType)) {
        result.skipped++;
        continue;
      }

      // 4. Anonymize the execution data
      const anonymized = await anonymizeExecution(execution);

      if (!anonymized) {
        result.skipped++;
        continue;
      }

      // 5. Calculate quality score
      const qualityScore = calculateQualityScore(anonymized);

      // 6. Store in training_data
      await db.insert(trainingData).values({
        data_type: dataType,
        trade_type: anonymized.trade_type,
        region: anonymized.region,
        data: anonymized.data,
        org_hash: hashOrgId(execution.org_id),
        source_execution_id: execution.id,
        quality_score: qualityScore,
      });

      // 7. Mark execution as anonymized (so we don't process it again)
      await db
        .update(agentExecutions)
        .set({
          metadata: sql`metadata || '{"anonymized_at": "${new Date().toISOString()}"}'::jsonb`,
        })
        .where(eq(agentExecutions.id, execution.id));

      result.processed++;
    } catch (error) {
      logger.error({ executionId: execution.id, error }, 'Failed to anonymize execution');
      result.errors++;
    }
  }

  logger.info(result, 'Anonymization batch complete');
  return result;
}


// ==================== HELPER FUNCTIONS ====================

function hashOrgId(orgId: string): string {
  return createHash('sha256')
    .update(`${orgId}:${ANONYMIZATION_SALT}`)
    .digest('hex')
    .substring(0, 16); // First 16 chars for readability
}

function hashCustomerId(orgId: string, customerId: string): string {
  return `cust_${createHash('sha256')
    .update(`${orgId}:${customerId}:${ANONYMIZATION_SALT}`)
    .digest('hex')
    .substring(0, 12)}`;
}

function mapAgentTypeToDataType(agentType: string): string {
  const map: Record<string, string> = {
    invoice: 'invoice',
    estimate: 'estimate',
    collections: 'collection',
    bookkeeping: 'job',        // Bookkeeping processes job financial data
    customer: 'communication',
    'field-ops': 'scheduling',
    inventory: 'parts_usage',
    insights: 'job',           // Insights analyzes job/financial data
    compliance: 'scheduling',  // Compliance tracks deadlines
  };
  return map[agentType] ?? 'unknown';
}

function extractRegionFromAddress(address: { zip?: string; state?: string } | null): string | null {
  if (!address) return null;
  if (address.state) return address.state;
  if (address.zip) {
    // Map zip prefix to state (simplified)
    const prefix = address.zip.substring(0, 3);
    return ZIP_TO_STATE_MAP[prefix] ?? null;
  }
  return null;
}

function dateToRelative(date: Date | string): {
  day_of_week: string;
  season: string;
  hour_of_day: number;
} {
  const d = new Date(date);
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const month = d.getMonth();
  const seasons = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer',
                    'summer', 'summer', 'fall', 'fall', 'fall', 'winter'];

  return {
    day_of_week: days[d.getDay()],
    season: seasons[month],
    hour_of_day: d.getHours(),
  };
}
```

### Anonymization Per Data Type

```typescript
// apps/api/src/queue/workers/anonymization/invoice.anonymizer.ts

async function anonymizeInvoiceExecution(
  execution: AgentExecution,
): Promise<AnonymizedRecord | null> {
  // Load related data
  const invoice = await db.select().from(invoices).where(eq(invoices.id, execution.output_data?.invoice_id)).first();
  if (!invoice) return null;

  const job = invoice.job_id
    ? await db.select().from(jobs).where(eq(jobs.id, invoice.job_id)).first()
    : null;

  const org = await db.select().from(organizations).where(eq(organizations.id, execution.org_id)).first();
  if (!org) return null;

  const customer = invoice.customer_id
    ? await db.select().from(customers).where(eq(customers.id, invoice.customer_id)).first()
    : null;

  // Build anonymized record
  return {
    trade_type: org.trade_type,
    region: extractRegionFromAddress(customer?.address ?? job?.address ?? null),
    data: {
      // Customer (anonymized)
      customer_hash: customer ? hashCustomerId(execution.org_id, customer.id) : null,
      zip_code: customer?.address?.zip ?? job?.address?.zip ?? null,

      // Job context
      job_type: job?.type ?? null,
      labor_hours: job?.labor_hours ?? null,
      margin_percent: job?.margin ?? null,

      // Invoice data (preserved in full)
      line_items: invoice.line_items.map((item: any) => ({
        description: scrubPII(item.description),
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.total,
        category: categorizeLineItem(item.description), // AI-classified category
      })),
      subtotal: invoice.subtotal,
      tax_rate: invoice.tax_rate,
      tax_amount: invoice.tax_amount,
      total: invoice.total,

      // Materials (from job)
      materials: (job?.materials ?? []).map((m: any) => ({
        name: m.part_name,
        quantity: m.quantity,
        unit_cost: m.unit_cost,
      })),

      // Temporal (anonymized)
      ...dateToRelative(invoice.created_at),
      payment_terms: invoice.metadata?.payment_terms ?? 'net_30',

      // Meta
      generated_by: invoice.generated_by,
      confidence_score: execution.confidence_score,
    },
  };
}
```

### Validation

Before inserting into `training_data`, every anonymized record is validated:

```typescript
function validateAnonymizedRecord(record: AnonymizedRecord): boolean {
  // 1. No PII leakage
  const jsonStr = JSON.stringify(record.data);

  // Check for email patterns
  if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(jsonStr)) {
    logger.warn({ record }, 'PII leak detected: email in anonymized data');
    return false;
  }

  // Check for phone patterns
  if (/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/.test(jsonStr)) {
    logger.warn({ record }, 'PII leak detected: phone in anonymized data');
    return false;
  }

  // Check for full address patterns (street + number)
  if (/\b\d{1,5}\s\w+\s(St|Ave|Blvd|Dr|Ln|Rd|Ct|Way|Pl)\b/i.test(jsonStr)) {
    logger.warn({ record }, 'PII leak detected: address in anonymized data');
    return false;
  }

  // 2. Required fields present
  if (!record.trade_type) return false;
  if (!record.data || typeof record.data !== 'object') return false;

  // 3. Amounts are reasonable (not negative, not absurdly large)
  if (record.data.total !== undefined) {
    if (record.data.total < 0 || record.data.total > 1000000) return false;
  }

  return true;
}
```

---

## 6. Privacy and Consent

### Opt-In Requirement

Data collection is **never automatic**. Organizations must explicitly opt in. The consent flow works as follows:

1. During onboarding or in org settings, the owner sees a data sharing option
2. The option clearly describes what data is collected and how it is used
3. The owner toggles consent on and selects which data types to share
4. A `data_consent` record is created with the consent version, timestamp, and IP
5. Only after this record exists will the anonymization worker process that org's data

```typescript
// apps/api/src/services/consent.service.ts

async function grantDataConsent(
  orgId: string,
  userId: string,
  dataTypesAllowed: string[],
  request: FastifyRequest,
): Promise<DataConsent> {
  // Only owners can grant consent
  const profile = await db.select().from(profiles).where(eq(profiles.id, userId)).first();
  if (profile?.role !== 'owner') {
    throw new ForbiddenError('Only organization owners can manage data sharing consent');
  }

  const consent = await db.insert(dataConsent).values({
    org_id: orgId,
    consented: true,
    consented_at: new Date(),
    consent_version: CURRENT_CONSENT_VERSION, // e.g., '2026.1'
    data_types_allowed: dataTypesAllowed,
    consented_by: userId,
    consent_method: 'settings',
    ip_address: request.ip,
    user_agent: request.headers['user-agent'] ?? null,
  }).onConflictDoUpdate({
    target: dataConsent.org_id,
    set: {
      consented: true,
      consented_at: new Date(),
      revoked_at: null,
      consent_version: CURRENT_CONSENT_VERSION,
      data_types_allowed: dataTypesAllowed,
      consented_by: userId,
      ip_address: request.ip,
      user_agent: request.headers['user-agent'] ?? null,
      updated_at: new Date(),
    },
  }).returning();

  return consent[0];
}
```

### Consent Revocation and Data Deletion

When an organization revokes consent, all their contributions to `training_data` must be deletable. This is required for GDPR/CCPA compliance.

```typescript
// apps/api/src/services/consent.service.ts

async function revokeDataConsent(orgId: string, userId: string): Promise<void> {
  // Only owners can revoke consent
  const profile = await db.select().from(profiles).where(eq(profiles.id, userId)).first();
  if (profile?.role !== 'owner') {
    throw new ForbiddenError('Only organization owners can manage data sharing consent');
  }

  // 1. Mark consent as revoked
  await db.update(dataConsent).set({
    consented: false,
    revoked_at: new Date(),
    updated_at: new Date(),
  }).where(eq(dataConsent.org_id, orgId));

  // 2. Delete all training data contributions from this org
  const orgHash = hashOrgId(orgId);
  const deleted = await db.delete(trainingData)
    .where(eq(trainingData.org_hash, orgHash))
    .returning({ id: trainingData.id });

  logger.info({
    orgId,
    orgHash,
    deletedRecords: deleted.length,
  }, 'Data consent revoked and training data deleted');

  // 3. Remove anonymization markers from agent executions
  //    (so data could be re-anonymized if they consent again later)
  await db.execute(sql`
    UPDATE agent_executions
    SET metadata = metadata - 'anonymized_at'
    WHERE org_id = ${orgId}
    AND metadata ? 'anonymized_at'
  `);
}
```

### GDPR/CCPA Compliance Summary

| Requirement | Implementation |
|---|---|
| **Lawful basis** | Explicit consent (opt-in, not opt-out) |
| **Right to be informed** | Consent screen describes data collected, purpose, and retention |
| **Right of access** | API endpoint to export all training data contributions for an org |
| **Right to erasure** | `revokeDataConsent()` deletes all `training_data` rows for the org |
| **Right to restrict processing** | Org can select specific `data_types_allowed` |
| **Data minimization** | Only operational data collected; PII stripped before storage |
| **Purpose limitation** | Training data used only for model improvement, not resold raw |
| **Storage limitation** | `training_data` rows have `created_at`; old data can be pruned |
| **Integrity and confidentiality** | `org_hash` is one-way; database encrypted at rest (Supabase) |
| **Accountability** | `data_consent` table provides full audit trail |

### One-Way Org Hash

The `org_hash` in `training_data` is a one-way SHA-256 hash of `org_id + salt`. This means:

- Given a `training_data` row, you **cannot** determine which organization it came from
- Given an `org_id`, you **can** find all their training data (for deletion)
- The salt is stored in Railway secrets, never in code or the database

```typescript
// This direction works (for deletion):
const orgHash = hashOrgId('org-uuid-123'); // -> 'a7b3c9e2f1d4...'
await db.delete(trainingData).where(eq(trainingData.org_hash, orgHash));

// This direction does NOT work (cannot reverse):
// Given 'a7b3c9e2f1d4...', there is no way to determine 'org-uuid-123'
```

---

## 7. Training Pipeline Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                     TRAINING PIPELINE                                │
│                                                                      │
│  ┌────────────────┐    ┌──────────────────┐    ┌─────────────────┐  │
│  │  1. RAW DATA   │    │  2. ANONYMIZE     │    │  3. STORE       │  │
│  │                │    │                    │    │                 │  │
│  │ agent_         │───▶│ Anonymization      │───▶│ training_data   │  │
│  │ executions     │    │ Worker (BullMQ)    │    │ table           │  │
│  │ invoices       │    │ - Strip PII        │    │ (PostgreSQL)    │  │
│  │ jobs           │    │ - Hash IDs         │    │                 │  │
│  │ estimates      │    │ - Validate         │    │                 │  │
│  │ customers      │    │ - Quality score    │    │                 │  │
│  └────────────────┘    └──────────────────┘    └────────┬────────┘  │
│                                                          │           │
│                                                          │           │
│  ┌────────────────┐    ┌──────────────────┐    ┌────────▼────────┐  │
│  │  6. DEPLOY     │    │  5. TRAIN         │    │  4. EXPORT      │  │
│  │                │    │                    │    │                 │  │
│  │ Update         │◀───│ Fine-tune on       │◀───│ Export to       │  │
│  │ provider       │    │ training infra     │    │ JSONL/Parquet   │  │
│  │ router to      │    │ (HuggingFace,     │    │ Upload to S3    │  │
│  │ use new model  │    │  Replicate, or    │    │                 │  │
│  │                │    │  cloud provider)   │    │                 │  │
│  └────────────────┘    └──────────────────┘    └─────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Stage Details

| Stage | Frequency | Tool | Output |
|---|---|---|---|
| **1. Raw Data** | Continuous (every agent execution) | Agent runtime writes to DB | Raw records in source tables |
| **2. Anonymize** | Daily at 2:00 AM UTC | BullMQ `data-anonymization` cron | PII-free records |
| **3. Store** | Daily (part of anonymization) | PostgreSQL insert | `training_data` rows |
| **4. Export** | Monthly or on-demand | Custom export script | JSONL or Parquet files on S3/R2 |
| **5. Train** | Monthly or when data threshold reached | HuggingFace, Replicate, or cloud provider | Fine-tuned model weights/adapters |
| **6. Deploy** | After training + evaluation | Update provider router config | New model version active in production |

### Export Format

Training data is exported as JSONL (JSON Lines) for compatibility with all major fine-tuning platforms:

```typescript
// apps/api/src/scripts/export-training-data.ts

async function exportTrainingData(options: {
  dataType: string;
  tradeType?: string;
  region?: string;
  minQuality?: number;
  outputPath: string;
}) {
  const query = db
    .select()
    .from(trainingData)
    .where(
      and(
        eq(trainingData.data_type, options.dataType),
        options.tradeType ? eq(trainingData.trade_type, options.tradeType) : undefined,
        options.region ? eq(trainingData.region, options.region) : undefined,
        options.minQuality ? gte(trainingData.quality_score, options.minQuality) : undefined,
      )
    )
    .orderBy(trainingData.created_at);

  const stream = fs.createWriteStream(options.outputPath);

  for await (const batch of query.cursor(500)) {
    for (const row of batch) {
      stream.write(JSON.stringify({
        data_type: row.data_type,
        trade_type: row.trade_type,
        region: row.region,
        data: row.data,
        quality_score: row.quality_score,
      }) + '\n');
    }
  }

  stream.end();
}
```

---

## 8. Model Training Tracking

Every training run is recorded in the `training_runs` table with full metrics and lineage.

### Training Run Lifecycle

```
1. Create training_runs record (status: 'pending')
2. Export training data subset (filtered by type, trade, quality)
3. Upload to training infrastructure
4. Start training (status: 'running')
5. Training completes -> record metrics (status: 'completed')
6. Evaluate model against held-out test set
7. If metrics meet threshold -> deploy (status: 'deployed', is_active: true)
8. Previous active model -> is_active: false
```

### Metrics JSONB Structure

```json
{
  "accuracy": 0.92,
  "loss": 0.08,
  "eval_metrics": {
    "pricing_mae": 45.20,
    "pricing_mape": 0.034,
    "category_accuracy": 0.96,
    "amount_within_10pct": 0.89,
    "amount_within_20pct": 0.97
  },
  "training_config": {
    "epochs": 3,
    "learning_rate": 2e-5,
    "batch_size": 8,
    "lora_rank": 16,
    "lora_alpha": 32
  },
  "training_time_seconds": 3600,
  "cost_dollars": 45.00,
  "hardware": "A100-80GB x 1",
  "data_stats": {
    "total_records": 8500,
    "train_records": 7650,
    "eval_records": 850,
    "avg_quality_score": 0.82,
    "trade_distribution": {
      "hvac": 5200,
      "plumbing": 2100,
      "electrical": 1200
    }
  }
}
```

### Model Versioning

Models follow semantic versioning:
- **Major** (1.0.0 -> 2.0.0): New architecture or training approach
- **Minor** (1.0.0 -> 1.1.0): Retrained with more data, same approach
- **Patch** (1.0.0 -> 1.0.1): Bug fix in pre/post-processing, same weights

```typescript
// Query the active model for a given name
const activeModel = await db
  .select()
  .from(trainingRuns)
  .where(
    and(
      eq(trainingRuns.model_name, 'hvac-pricing'),
      eq(trainingRuns.is_active, true),
    )
  )
  .first();

// Promote a new model version
async function deployModel(runId: string): Promise<void> {
  const run = await db.select().from(trainingRuns).where(eq(trainingRuns.id, runId)).first();
  if (!run || run.status !== 'completed') throw new Error('Cannot deploy incomplete training run');

  // Deactivate previous active version
  await db.update(trainingRuns).set({ is_active: false })
    .where(and(eq(trainingRuns.model_name, run.model_name), eq(trainingRuns.is_active, true)));

  // Activate new version
  await db.update(trainingRuns).set({
    status: 'deployed',
    is_active: true,
    deployed_at: new Date(),
  }).where(eq(trainingRuns.id, runId));
}
```

---

## 9. Data Quality Scoring

Every record in `training_data` gets a quality score (0.0 to 1.0) based on completeness, consistency, and the volume of related data. Higher quality records are weighted more heavily during training.

### How quality_score Is Calculated

```typescript
function calculateQualityScore(record: AnonymizedRecord): number {
  let score = 0;
  let maxScore = 0;

  // ===== COMPLETENESS (0-0.4) =====
  // How many fields are populated vs. expected for this data type

  const completenessChecks: Record<string, (data: any) => boolean> = {
    has_line_items: (d) => Array.isArray(d.line_items) && d.line_items.length > 0,
    has_total: (d) => typeof d.total === 'number' && d.total > 0,
    has_subtotal: (d) => typeof d.subtotal === 'number' && d.subtotal > 0,
    has_job_type: (d) => !!d.job_type,
    has_materials: (d) => Array.isArray(d.materials) && d.materials.length > 0,
    has_labor_hours: (d) => typeof d.labor_hours === 'number' && d.labor_hours > 0,
    has_margin: (d) => typeof d.margin_percent === 'number',
    has_zip_code: (d) => !!d.zip_code,
    has_temporal: (d) => !!d.day_of_week && !!d.season,
    has_confidence: (d) => typeof d.confidence_score === 'number',
  };

  for (const check of Object.values(completenessChecks)) {
    maxScore += 0.04; // Each check is worth 0.04 (10 checks = 0.4)
    if (check(record.data)) score += 0.04;
  }

  // ===== CONSISTENCY (0-0.3) =====
  // Do the numbers add up? Are values within reasonable ranges?

  maxScore += 0.1;
  if (record.data.line_items?.length > 0 && record.data.subtotal) {
    const lineItemSum = record.data.line_items.reduce((s: number, i: any) => s + (i.total || 0), 0);
    const diff = Math.abs(lineItemSum - record.data.subtotal);
    if (diff < 0.01) score += 0.1; // Line items sum matches subtotal
    else if (diff < 1.0) score += 0.05; // Close enough (rounding)
  }

  maxScore += 0.1;
  if (record.data.subtotal && record.data.total && record.data.tax_amount !== undefined) {
    const expectedTotal = record.data.subtotal + record.data.tax_amount;
    if (Math.abs(expectedTotal - record.data.total) < 0.01) score += 0.1;
  }

  maxScore += 0.1;
  if (record.data.total && record.data.total > 0 && record.data.total < 100000) {
    score += 0.1; // Reasonable amount range
  }

  // ===== VOLUME BONUS (0-0.2) =====
  // Records from orgs with more data are more valuable (patterns emerge with volume)

  // This is calculated separately during batch processing:
  // - Org with 1-10 records: +0.05
  // - Org with 11-50 records: +0.10
  // - Org with 51-200 records: +0.15
  // - Org with 200+ records: +0.20

  // ===== AGENT CONFIDENCE (0-0.1) =====
  maxScore += 0.1;
  if (record.data.confidence_score) {
    score += record.data.confidence_score * 0.1; // AI confidence maps directly
  }

  return Math.min(score / maxScore, 1.0);
}
```

### Quality Score Distribution (Expected)

| Range | Label | Typical Content | Training Weight |
|---|---|---|---|
| 0.9 - 1.0 | Excellent | Complete invoice with all fields, materials, labor, from high-volume org | 1.0x (full weight) |
| 0.7 - 0.9 | Good | Most fields populated, numbers consistent, minor gaps | 0.8x |
| 0.5 - 0.7 | Fair | Core fields present but missing materials or labor detail | 0.5x |
| 0.3 - 0.5 | Poor | Minimal data, missing amounts or descriptions | 0.2x |
| 0.0 - 0.3 | Bad | Nearly empty, inconsistent numbers | Excluded from training |

Records with `quality_score < 0.3` are stored but excluded from training exports.

---

## 10. Future: Model Marketplace (Year 2+)

Once the training data pipeline reaches critical mass (estimated at 50,000+ records across 500+ organizations), CrewShift will have the foundation for a Model Marketplace.

### Concept

Sell fine-tuned trade-specific AI models to other platforms, developers, and tools. This creates a revenue stream independent of subscriptions and positions CrewShift as the intelligence layer for the entire trades tech ecosystem.

### Potential Products

| Model | Training Data | Use Case | Buyer |
|---|---|---|---|
| **HVAC Pricing Model** | Invoice + estimate data from HVAC contractors | Given a job description, predict accurate pricing | FSM platforms, other SaaS tools |
| **Payment Prediction Model** | Collections data across all trades | Predict payment likelihood and optimal follow-up timing | Accounting platforms, fintech |
| **Demand Forecasting Model** | Job scheduling + seasonal patterns | Predict busy/slow periods by trade and region | Staffing agencies, marketing tools |
| **Material Estimation Model** | Parts usage data from completed jobs | Predict materials needed for a given job type | Supply houses, procurement tools |
| **Trade-Specific Embeddings** | All operational text data | Semantic search optimized for trade terminology | Any trade-tech platform |

### Distribution Channels

- HuggingFace Hub (model cards, downloadable weights)
- Replicate (hosted inference API)
- Direct API (CrewShift-hosted inference for enterprise buyers)

### Revenue Model

- Per-inference pricing ($0.01-0.10 per prediction depending on model)
- Monthly subscription for unlimited API access
- Enterprise licensing for on-premise deployment

### Timeline

This is explicitly a Year 2+ initiative. The pipeline infrastructure (this document) is built now so that when the data reaches critical mass, the training and marketplace components can be added without re-architecting the data collection layer.

---

## 11. Summary

| Component | Status | Purpose |
|---|---|---|
| `training_data` table | Built in Phase 1 | Store anonymized operational data |
| `data_consent` table | Built in Phase 1 | Track org opt-in/opt-out |
| `training_runs` table | Built in Phase 1 | Track model training history |
| Anonymization worker | Built in Phase 1 | Daily PII stripping + storage |
| Quality scoring | Built in Phase 1 | Rate data quality for training weighting |
| Consent service | Built in Phase 1 | Grant/revoke data sharing consent |
| Export script | Built in Phase 2 | Export JSONL for fine-tuning |
| Training pipeline | Phase 2 | Fine-tune models on collected data |
| Model marketplace | Year 2+ | Sell trade-specific AI models |

The anonymized data pipeline is one of the most strategically important components of CrewShift. It costs almost nothing to operate (a daily cron job processing database records) but creates the compounding data moat that makes the entire platform more valuable over time. Every contractor who uses CrewShift contributes (with consent) to making the AI better for every other contractor. This is the network effect that turns a SaaS platform into a defensible intelligence platform.
