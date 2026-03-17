# 16 — Onboarding (PLG Backend)

> **Related Docs:** [05-security.md](./05-security.md) (auth & RBAC), [09-integrations.md](./09-integrations.md) (OAuth & sync), [06-agent-runtime.md](./06-agent-runtime.md) (agent execution), [07-agent-definitions.md](./07-agent-definitions.md) (agent configs), [02-database-schema.md](./02-database-schema.md) (organizations table)

---

## Onboarding Philosophy

**"Time to value under 5 minutes."**

The contractor signs up, connects one tool, and sees real output from their own data in the first session. This is not a tour of features. This is a demonstration of what CrewShift actually does — with the contractor's actual job data, generating an actual invoice draft, in seconds instead of minutes.

Every decision in the onboarding flow optimizes for:

1. **Speed to first output** — The contractor should see an AI-generated invoice from their own data within 5 minutes of signing up. That is the moment they understand the product.
2. **Zero configuration required** — Agents come preconfigured with sensible defaults. The contractor does not need to set up rules, thresholds, or preferences before getting value.
3. **Progressive complexity** — Start with one integration and one agent action. Reveal more features as the user engages. Never overwhelm with the full 9-agent roster on day one.
4. **Real data, not demo data** — Sample data exists as a fallback, but the primary path always uses the contractor's connected tools. Real data builds trust; demo data builds skepticism.

**Why this matters for trade businesses:** Contractors evaluate tools by trying them, not by reading documentation. If they cannot see a concrete result within one sitting, they will not come back. The 5-minute window is not aspirational — it is a product requirement.

---

## Onboarding State Machine

The onboarding process follows a strict linear state machine with 6 steps. Each step has exactly one completion condition.

```
account_created  →  trade_type_selected  →  first_integration_connected  →  first_sync_complete  →  first_agent_run  →  onboarding_complete
      (1)                  (2)                        (3)                          (4)                     (5)                    (6)
```

### State Transitions

| Step | Name | Completion Trigger | Can Skip? | Notes |
|------|------|-------------------|-----------|-------|
| 1 | `account_created` | POST /api/auth/signup completes | No | Always completes automatically at signup |
| 2 | `trade_type_selected` | PATCH /api/org sets `trade_type` | No | Required — trade type determines agent behavior, pricing templates, compliance rules |
| 3 | `first_integration_connected` | OAuth callback returns `status: 'connected'` | Yes (with demo data) | Can skip to explore with sample data |
| 4 | `first_sync_complete` | sync.worker.ts completes first sync job | Auto (if integration connected) | Triggers automatically after step 3 |
| 5 | `first_agent_run` | agent.worker.ts completes demo execution | Auto (after sync) | System triggers Invoice Agent on most recent job |
| 6 | `onboarding_complete` | All previous steps complete OR user clicks "Skip to Dashboard" | Yes | Terminal state |

### Why This Order

**Decision rationale:** Each step produces the input needed for the next step:
- Account creation is required to exist in the system.
- Trade type is needed before integration sync because the sync worker maps external data to trade-specific schemas (an HVAC job has different fields than a plumbing job).
- Integration must be connected before syncing data.
- Data must be synced before an agent can process it.
- Agent must run before the user understands the value proposition.

This is the fastest path to the "aha moment" — the contractor seeing their own invoice generated in 8 seconds.

---

## organizations.onboarding_status JSONB

### Schema

```sql
ALTER TABLE organizations ADD COLUMN onboarding_status JSONB DEFAULT '{
  "account_created": true,
  "trade_type_selected": false,
  "first_integration_connected": false,
  "first_sync_complete": false,
  "first_agent_run": false,
  "onboarding_complete": false
}';

-- Additional tracking fields within the JSONB
-- Full schema:
-- {
--   "account_created": true,
--   "trade_type_selected": false,
--   "first_integration_connected": false,
--   "first_sync_complete": false,
--   "first_agent_run": false,
--   "onboarding_complete": false,
--   "current_step": "trade_type_selected",     -- which step the user should see next
--   "completed_at": null,                       -- ISO timestamp when onboarding finished
--   "skipped": false,                           -- true if user skipped onboarding
--   "demo_mode": false,                         -- true if using sample data (no integration)
--   "first_integration_provider": null,         -- e.g., "quickbooks" — which tool they connected first
--   "first_agent_execution_id": null,           -- UUID of the demo agent execution
--   "step_timestamps": {                        -- when each step was completed
--     "account_created": "2026-03-04T10:00:00Z",
--     "trade_type_selected": null,
--     "first_integration_connected": null,
--     "first_sync_complete": null,
--     "first_agent_run": null,
--     "onboarding_complete": null
--   }
-- }
```

### How Each Step Is Tracked

The `onboarding_status` JSONB is updated by the backend — never by the frontend directly. Each service that completes a step calls `OnboardingService.completeStep()`:

```typescript
// src/services/onboarding.service.ts

const ONBOARDING_STEPS = [
  'account_created',
  'trade_type_selected',
  'first_integration_connected',
  'first_sync_complete',
  'first_agent_run',
  'onboarding_complete',
] as const;

type OnboardingStep = typeof ONBOARDING_STEPS[number];

class OnboardingService {
  async getStatus(orgId: string): Promise<OnboardingStatus> {
    const { data: org } = await supabase
      .from('organizations')
      .select('onboarding_status')
      .eq('id', orgId)
      .single();

    return org.onboarding_status;
  }

  async completeStep(orgId: string, step: OnboardingStep, metadata?: Record<string, any>): Promise<OnboardingStatus> {
    const current = await this.getStatus(orgId);

    // Validate step ordering — cannot complete step N+1 without step N
    // Exception: 'onboarding_complete' can be triggered by skip
    if (step !== 'onboarding_complete') {
      const stepIndex = ONBOARDING_STEPS.indexOf(step);
      for (let i = 0; i < stepIndex; i++) {
        const prevStep = ONBOARDING_STEPS[i];
        if (!current[prevStep] && prevStep !== step) {
          // Allow skipping to this step only if demo_mode for integration/sync steps
          if (!current.demo_mode || !['first_integration_connected', 'first_sync_complete'].includes(prevStep)) {
            throw new AppError('INVALID_STEP', `Cannot complete "${step}" before "${prevStep}"`);
          }
        }
      }
    }

    // Already completed — idempotent, return current status
    if (current[step]) return current;

    // Build updated status
    const updated = {
      ...current,
      [step]: true,
      current_step: this.getNextStep(current, step),
      step_timestamps: {
        ...current.step_timestamps,
        [step]: new Date().toISOString(),
      },
      ...metadata, // e.g., { first_integration_provider: 'quickbooks' }
    };

    // Check if all pre-completion steps are done
    if (step === 'first_agent_run') {
      updated.current_step = 'onboarding_complete';
    }

    const { data } = await supabase
      .from('organizations')
      .update({ onboarding_status: updated })
      .eq('id', orgId)
      .select('onboarding_status')
      .single();

    // Track analytics event
    await trackOnboardingEvent(orgId, step, metadata);

    return data.onboarding_status;
  }

  private getNextStep(current: OnboardingStatus, justCompleted: OnboardingStep): OnboardingStep {
    const currentIndex = ONBOARDING_STEPS.indexOf(justCompleted);
    for (let i = currentIndex + 1; i < ONBOARDING_STEPS.length; i++) {
      if (!current[ONBOARDING_STEPS[i]]) {
        return ONBOARDING_STEPS[i];
      }
    }
    return 'onboarding_complete';
  }

  async skip(orgId: string): Promise<OnboardingStatus> {
    const current = await this.getStatus(orgId);

    const updated = {
      ...current,
      onboarding_complete: true,
      skipped: true,
      current_step: 'onboarding_complete',
      completed_at: new Date().toISOString(),
      step_timestamps: {
        ...current.step_timestamps,
        onboarding_complete: new Date().toISOString(),
      },
    };

    const { data } = await supabase
      .from('organizations')
      .update({ onboarding_status: updated })
      .eq('id', orgId)
      .select('onboarding_status')
      .single();

    await trackOnboardingEvent(orgId, 'onboarding_skipped', {
      last_completed_step: this.getLastCompletedStep(current),
    });

    return data.onboarding_status;
  }

  private getLastCompletedStep(status: OnboardingStatus): string {
    for (let i = ONBOARDING_STEPS.length - 1; i >= 0; i--) {
      if (status[ONBOARDING_STEPS[i]]) return ONBOARDING_STEPS[i];
    }
    return 'none';
  }
}

export const onboardingService = new OnboardingService();
```

---

## Onboarding API Routes

### GET /api/onboarding/status

Returns the current onboarding state for the authenticated user's organization.

```typescript
// Request
GET /api/onboarding/status
Authorization: Bearer <jwt>

// Response
{
  "data": {
    "account_created": true,
    "trade_type_selected": true,
    "first_integration_connected": false,
    "first_sync_complete": false,
    "first_agent_run": false,
    "onboarding_complete": false,
    "current_step": "first_integration_connected",
    "completed_at": null,
    "skipped": false,
    "demo_mode": false,
    "first_integration_provider": null,
    "first_agent_execution_id": null,
    "step_timestamps": {
      "account_created": "2026-03-04T10:00:00Z",
      "trade_type_selected": "2026-03-04T10:01:30Z",
      "first_integration_connected": null,
      "first_sync_complete": null,
      "first_agent_run": null,
      "onboarding_complete": null
    },
    "available_integrations": [
      { "provider": "quickbooks", "name": "QuickBooks Online", "recommended": true },
      { "provider": "stripe", "name": "Stripe", "recommended": false },
      { "provider": "google", "name": "Google Workspace", "recommended": false }
    ]
  }
}
```

### POST /api/onboarding/complete-step

Manually mark an onboarding step as complete. Most steps are completed automatically by backend services, but this endpoint exists for steps that the frontend controls (e.g., trade type selection confirmation).

```typescript
// Request
POST /api/onboarding/complete-step
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "step": "trade_type_selected"
}

// Response
{
  "data": {
    "account_created": true,
    "trade_type_selected": true,
    "first_integration_connected": false,
    "first_sync_complete": false,
    "first_agent_run": false,
    "onboarding_complete": false,
    "current_step": "first_integration_connected"
  }
}
```

### POST /api/onboarding/skip

Skip the remaining onboarding steps and go directly to the dashboard.

```typescript
// Request
POST /api/onboarding/skip
Authorization: Bearer <jwt>

// Response
{
  "data": {
    "onboarding_complete": true,
    "skipped": true,
    "completed_at": "2026-03-04T10:05:00Z",
    "current_step": "onboarding_complete"
  }
}
```

### Route Implementation

```typescript
// src/routes/onboarding.routes.ts

import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.middleware';
import { onboardingService } from '../services/onboarding.service';

export async function onboardingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/onboarding/status', async (request, reply) => {
    const orgId = request.orgId;
    const status = await onboardingService.getStatus(orgId);

    // Enrich with available integrations if at that step
    let availableIntegrations = undefined;
    if (status.current_step === 'first_integration_connected') {
      availableIntegrations = getAvailableIntegrations(orgId);
    }

    return reply.send({
      data: {
        ...status,
        ...(availableIntegrations && { available_integrations: availableIntegrations }),
      },
    });
  });

  app.post('/api/onboarding/complete-step', {
    schema: {
      body: {
        type: 'object',
        required: ['step'],
        properties: {
          step: {
            type: 'string',
            enum: ['trade_type_selected', 'first_integration_connected', 'first_agent_run'],
          },
        },
      },
    },
  }, async (request, reply) => {
    const orgId = request.orgId;
    const { step } = request.body as { step: OnboardingStep };
    const status = await onboardingService.completeStep(orgId, step);
    return reply.send({ data: status });
  });

  app.post('/api/onboarding/skip', async (request, reply) => {
    const orgId = request.orgId;
    const status = await onboardingService.skip(orgId);
    return reply.send({ data: status });
  });
}
```

---

## Step 1 — Account Creation

### What Happens on POST /api/auth/signup

```typescript
// src/services/auth.service.ts

interface SignupInput {
  email: string;
  password: string;
  fullName: string;
  companyName: string;
  // trade_type is NOT collected here — it is step 2
}

async function signup(input: SignupInput): Promise<{ user: Profile; org: Organization; session: Session }> {
  const { email, password, fullName, companyName } = input;

  // 1. Create Supabase auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // or false if requiring email verification
  });
  if (authError) throw authError;

  const userId = authData.user.id;

  // 2. Create organization
  const { data: org } = await supabase
    .from('organizations')
    .insert({
      name: companyName,
      trade_type: 'pending',          // Set in step 2
      tier: 'starter',                // All new orgs start on Starter
      settings: {},
      onboarding_status: {
        account_created: true,
        trade_type_selected: false,
        first_integration_connected: false,
        first_sync_complete: false,
        first_agent_run: false,
        onboarding_complete: false,
        current_step: 'trade_type_selected',
        completed_at: null,
        skipped: false,
        demo_mode: false,
        first_integration_provider: null,
        first_agent_execution_id: null,
        step_timestamps: {
          account_created: new Date().toISOString(),
          trade_type_selected: null,
          first_integration_connected: null,
          first_sync_complete: null,
          first_agent_run: null,
          onboarding_complete: null,
        },
      },
    })
    .select()
    .single();

  // 3. Create profile (extends auth.users)
  const { data: profile } = await supabase
    .from('profiles')
    .insert({
      id: userId,
      org_id: org.id,
      full_name: fullName,
      role: 'owner',                  // First user is always owner
    })
    .select()
    .single();

  // 4. Set custom JWT claims (org_id + role)
  // This is done via a Supabase Edge Function or database trigger
  await setCustomJwtClaims(userId, { org_id: org.id, role: 'owner' });

  // 5. Seed default agent_configs based on tier
  await seedAgentConfigs(org.id, 'starter');

  // 6. Sign in and return session
  const { data: session } = await supabase.auth.signInWithPassword({ email, password });

  return { user: profile, org, session: session.session };
}
```

### What Gets Created

| Record | Table | Key Fields |
|--------|-------|------------|
| Auth user | `auth.users` | email, password hash |
| Organization | `organizations` | name, tier='starter', trade_type='pending', onboarding_status |
| Profile | `profiles` | org_id, role='owner' |
| Agent configs (4x) | `agent_configs` | invoice, estimate, collections, customer (Starter tier) |

---

## Step 2 — Trade Type Selection

### What Happens on PATCH /api/org

```typescript
// src/routes/org.routes.ts (relevant handler)

app.patch('/api/org', { preHandler: [authMiddleware, requireRole('owner', 'admin')] }, async (request, reply) => {
  const orgId = request.orgId;
  const updates = request.body as OrgUpdateInput;

  // If trade_type is being set and onboarding is in progress
  if (updates.trade_type) {
    const onboardingStatus = await onboardingService.getStatus(orgId);

    // Update org
    const { data: org } = await supabase
      .from('organizations')
      .update({
        trade_type: updates.trade_type,
        settings: {
          ...updates.settings,
          // Seed trade-specific defaults
          ...getTradeDefaults(updates.trade_type),
        },
      })
      .eq('id', orgId)
      .select()
      .single();

    // Seed business_context with trade-specific defaults
    await seedBusinessContext(orgId, updates.trade_type);

    // Mark onboarding step complete
    if (!onboardingStatus.trade_type_selected) {
      await onboardingService.completeStep(orgId, 'trade_type_selected');
    }

    return reply.send({ data: org });
  }

  // ... standard org update logic
});
```

### Trade-Specific Defaults

```typescript
// src/services/onboarding.service.ts

function getTradeDefaults(tradeType: string): Record<string, any> {
  const TRADE_DEFAULTS: Record<string, any> = {
    hvac: {
      default_tax_rate: 0.07,         // 7% — varies by state, user will adjust
      default_payment_terms: 30,      // net 30
      common_line_items: [
        'System Diagnostic',
        'Refrigerant Charge',
        'Filter Replacement',
        'Thermostat Installation',
        'Ductwork Repair',
        'System Installation',
        'Maintenance Agreement',
      ],
      unit_types: ['per unit', 'per hour', 'flat rate', 'per foot'],
      job_types: ['service_call', 'install', 'maintenance', 'emergency', 'inspection'],
      typical_hourly_rate: 95,
      certifications_tracked: ['EPA 608', 'OSHA-10', 'OSHA-30', 'NATE', 'State License'],
    },
    plumbing: {
      default_tax_rate: 0.07,
      default_payment_terms: 30,
      common_line_items: [
        'Drain Cleaning',
        'Pipe Repair',
        'Water Heater Install',
        'Fixture Install',
        'Sewer Line Repair',
        'Leak Detection',
        'Backflow Testing',
      ],
      unit_types: ['per unit', 'per hour', 'flat rate', 'per foot'],
      job_types: ['service_call', 'install', 'maintenance', 'emergency', 'inspection'],
      typical_hourly_rate: 90,
      certifications_tracked: ['Journeyman License', 'Master License', 'OSHA-10', 'Backflow Cert'],
    },
    electrical: {
      default_tax_rate: 0.07,
      default_payment_terms: 30,
      common_line_items: [
        'Panel Upgrade',
        'Outlet Install',
        'Wiring Repair',
        'Lighting Install',
        'Generator Install',
        'EV Charger Install',
        'Code Inspection',
      ],
      unit_types: ['per unit', 'per hour', 'flat rate', 'per foot'],
      job_types: ['service_call', 'install', 'maintenance', 'emergency', 'inspection'],
      typical_hourly_rate: 100,
      certifications_tracked: ['Journeyman License', 'Master License', 'OSHA-10', 'OSHA-30', 'State License'],
    },
    roofing: {
      default_tax_rate: 0.07,
      default_payment_terms: 30,
      common_line_items: [
        'Roof Inspection',
        'Shingle Replacement',
        'Flat Roof Repair',
        'Gutter Install',
        'Flashing Repair',
        'Full Roof Replacement',
        'Storm Damage Assessment',
      ],
      unit_types: ['per square', 'per unit', 'flat rate', 'per linear foot'],
      job_types: ['repair', 'install', 'inspection', 'emergency', 'maintenance'],
      typical_hourly_rate: 85,
      certifications_tracked: ['OSHA-10', 'OSHA-30', 'GAF Certified', 'State License'],
    },
    general_contracting: {
      default_tax_rate: 0.07,
      default_payment_terms: 30,
      common_line_items: [
        'Demolition',
        'Framing',
        'Drywall',
        'Painting',
        'Flooring',
        'Finish Work',
        'Project Management',
      ],
      unit_types: ['per square foot', 'per unit', 'per hour', 'flat rate'],
      job_types: ['renovation', 'new_construction', 'repair', 'addition', 'commercial_buildout'],
      typical_hourly_rate: 80,
      certifications_tracked: ['General Contractor License', 'OSHA-10', 'OSHA-30', 'State License'],
    },
  };

  return TRADE_DEFAULTS[tradeType] ?? TRADE_DEFAULTS.general_contracting;
}

async function seedBusinessContext(orgId: string, tradeType: string): Promise<void> {
  const defaults = getTradeDefaults(tradeType);

  const contextRecords = [
    {
      org_id: orgId,
      category: 'pricing',
      key: 'default_hourly_rate',
      value: { rate: defaults.typical_hourly_rate, currency: 'USD' },
      confidence: 0.5, // Low confidence — this is a default, not learned
      source: 'onboarding_default',
    },
    {
      org_id: orgId,
      category: 'pricing',
      key: 'default_tax_rate',
      value: { rate: defaults.default_tax_rate },
      confidence: 0.5,
      source: 'onboarding_default',
    },
    {
      org_id: orgId,
      category: 'operational',
      key: 'common_line_items',
      value: { items: defaults.common_line_items },
      confidence: 0.5,
      source: 'onboarding_default',
    },
    {
      org_id: orgId,
      category: 'operational',
      key: 'job_types',
      value: { types: defaults.job_types },
      confidence: 0.5,
      source: 'onboarding_default',
    },
    {
      org_id: orgId,
      category: 'operational',
      key: 'certifications_tracked',
      value: { certifications: defaults.certifications_tracked },
      confidence: 1.0,
      source: 'onboarding_default',
    },
  ];

  await supabase.from('business_context').insert(contextRecords);
}
```

---

## Step 3 — First Integration

### OAuth Flow

```
Frontend                   API                       External Provider
   |                        |                              |
   |-- Click "Connect       |                              |
   |   QuickBooks" -------->|                              |
   |                        |-- GET /api/integrations/     |
   |                        |   quickbooks/connect ------->|
   |<-- Redirect to QBO ----|                              |
   |                        |                              |
   |-- User authorizes ---->|                              |
   |                        |<-- Callback with code -------|
   |                        |                              |
   |                        |-- Exchange code for tokens   |
   |                        |-- Store encrypted tokens     |
   |                        |-- Update integration status  |
   |                        |-- Mark onboarding step       |
   |<-- Redirect to app ----|                              |
```

### On Successful OAuth Callback

```typescript
// src/integrations/oauth.service.ts (relevant section)

async function handleOAuthCallback(
  orgId: string,
  provider: string,
  code: string
): Promise<Integration> {
  // 1. Exchange code for tokens (provider-specific)
  const adapter = getAdapter(provider);
  const tokens = await adapter.handleCallback(code, orgId);

  // 2. Store integration record with encrypted tokens
  const { data: integration } = await supabase
    .from('integrations')
    .upsert({
      org_id: orgId,
      provider,
      status: 'connected',
      access_token: encrypt(tokens.accessToken),
      refresh_token: encrypt(tokens.refreshToken),
      token_expires_at: tokens.expiresAt,
      external_account_id: tokens.accountId,
      metadata: tokens.metadata ?? {},
    }, { onConflict: 'org_id,provider' })
    .select()
    .single();

  // 3. Check if this is the first integration (for onboarding)
  const onboardingStatus = await onboardingService.getStatus(orgId);
  if (!onboardingStatus.first_integration_connected) {
    await onboardingService.completeStep(orgId, 'first_integration_connected', {
      first_integration_provider: provider,
    });

    // 4. Immediately trigger first sync
    await syncQueue.add('first-sync', {
      orgId,
      provider,
      integrationId: integration.id,
      isOnboarding: true, // flag for sync worker to complete onboarding step
      syncScope: 'last_30_days', // only pull recent data for speed
    }, {
      priority: 1, // highest priority — user is watching
    });
  }

  return integration;
}
```

---

## Step 4 — First Sync

### Sync Worker (Onboarding Mode)

When `isOnboarding: true` is set on the sync job, the worker operates in a constrained mode for speed:

```typescript
// src/queue/workers/sync.worker.ts (onboarding-specific section)

async function processSync(job: Job): Promise<void> {
  const { orgId, provider, integrationId, isOnboarding, syncScope } = job.data;

  const adapter = getAdapter(provider);
  const integration = await getIntegration(integrationId);

  if (isOnboarding) {
    // Onboarding sync: fast and focused
    // Pull only what we need for the demo agent run:
    // - Last 30 days of jobs (to find one for the Invoice Agent demo)
    // - Associated customers
    // - Existing invoices (for context)

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [customers, jobs, invoices] = await Promise.all([
      adapter.syncCustomers(integration, { since }),
      adapter.syncJobs(integration, { since }),
      adapter.syncInvoices(integration, { since }),
    ]);

    // Upsert into CrewShift unified model
    await upsertCustomers(orgId, customers);
    await upsertJobs(orgId, jobs);
    await upsertInvoices(orgId, invoices);

    // Update last_sync_at
    await supabase
      .from('integrations')
      .update({ last_sync_at: new Date() })
      .eq('id', integrationId);

    // Mark onboarding step complete
    await onboardingService.completeStep(orgId, 'first_sync_complete');

    // Immediately trigger demo agent run (step 5)
    await triggerDemoAgentRun(orgId, jobs);

    logger.info({
      orgId,
      provider,
      customers: customers.length,
      jobs: jobs.length,
      invoices: invoices.length,
    }, 'Onboarding sync complete');
  } else {
    // Standard full sync — not covered here, see 09-integrations.md
  }
}
```

### Timing Target

The onboarding sync should complete in under 15 seconds:
- QuickBooks API calls (3 parallel): ~5-8 seconds
- Data transformation + upsert: ~2-3 seconds
- Onboarding step update: < 1 second
- Total: ~8-12 seconds

If the external API is slow, the frontend shows a progress indicator. The user sees "Syncing your data..." with a spinner.

---

## Step 5 — First Agent Run

### Demo Mode Agent Execution

The system picks the most recent completed job and triggers the Invoice Agent in "demo mode" — it creates a draft invoice but does NOT send it to the customer or sync it to QuickBooks.

```typescript
// src/services/onboarding.service.ts

async function triggerDemoAgentRun(orgId: string, syncedJobs: Job[]): Promise<void> {
  // Find the best candidate job for demo
  const candidateJob = findBestDemoJob(syncedJobs);

  if (!candidateJob) {
    // No suitable jobs — fall back to sample data demo
    await triggerSampleDataDemo(orgId);
    return;
  }

  // Trigger Invoice Agent in demo mode
  const startTime = Date.now();

  const execution = await agentRuntime.execute({
    agentType: 'invoice',
    triggerType: 'schedule',      // not a real event — system-initiated
    triggerSource: 'onboarding_demo',
    orgId,
    inputData: {
      jobId: candidateJob.id,
      demoMode: true,             // prevents: sending to customer, syncing to QBO, creating real invoice
    },
  });

  const durationMs = Date.now() - startTime;

  // Mark onboarding step complete with demo results
  await onboardingService.completeStep(orgId, 'first_agent_run', {
    first_agent_execution_id: execution.id,
  });

  // Create a notification with the demo result
  await createNotification({
    orgId,
    type: 'agent_action',
    title: 'Your first AI-generated invoice',
    body: `Invoice Agent generated a $${execution.output_data.total.toFixed(2)} draft invoice for ${candidateJob.customer_name} in ${(durationMs / 1000).toFixed(1)} seconds. You usually spend 15 minutes on this.`,
    actionUrl: `/onboarding/demo-result?executionId=${execution.id}`,
    metadata: {
      execution_id: execution.id,
      duration_ms: durationMs,
      demo_mode: true,
      invoice_total: execution.output_data.total,
    },
  });
}

function findBestDemoJob(jobs: Job[]): Job | null {
  // Prioritize:
  // 1. Most recent completed job
  // 2. With line items / materials (richer demo)
  // 3. With a customer record (for personalization)

  const candidates = jobs
    .filter(j => j.status === 'completed')
    .filter(j => j.total_amount && j.total_amount > 0)
    .sort((a, b) => {
      // Prefer jobs with line items
      const aScore = (a.line_items?.length ?? 0) + (a.materials?.length ?? 0);
      const bScore = (b.line_items?.length ?? 0) + (b.materials?.length ?? 0);
      if (bScore !== aScore) return bScore - aScore;
      // Then by recency
      return new Date(b.actual_end ?? b.created_at).getTime() - new Date(a.actual_end ?? a.created_at).getTime();
    });

  return candidates[0] ?? null;
}
```

### The "8 Seconds vs 15 Minutes" Moment

This is the product's aha moment. The frontend displays:

```
+--------------------------------------------------+
|  Invoice Agent Demo Result                        |
|                                                   |
|  Generated invoice for: Henderson HVAC Install    |
|  Total: $1,840.00                                 |
|  Line items: 4                                    |
|                                                   |
|  Time: 8.2 seconds                                |
|  Your average: ~15 minutes                        |
|                                                   |
|  [View Invoice Draft]  [Continue to Dashboard]    |
+--------------------------------------------------+
```

The "15 minutes" figure is an industry average for manual invoice creation in the trades. If we have data from the synced QuickBooks history (time between job completion and invoice creation), we use the contractor's actual average instead.

---

## Default Agent Config Seeding

### TIER_DEFAULTS Map

```typescript
// src/services/onboarding.service.ts

const TIER_DEFAULTS: Record<string, string[]> = {
  starter: ['invoice', 'estimate', 'collections', 'customer'],           // 4 agents
  pro: ['invoice', 'estimate', 'collections', 'bookkeeping', 'insights',
        'field-ops', 'compliance', 'inventory', 'customer'],             // all 9
  business: ['invoice', 'estimate', 'collections', 'bookkeeping', 'insights',
             'field-ops', 'compliance', 'inventory', 'customer'],        // all 9
  enterprise: ['invoice', 'estimate', 'collections', 'bookkeeping', 'insights',
               'field-ops', 'compliance', 'inventory', 'customer'],      // all 9
};
```

### DEFAULT_AUTONOMY Per Agent

```typescript
const DEFAULT_AUTONOMY: Record<string, AutonomyRules> = {
  invoice: {
    auto: ['generate_pdf', 'sync_to_accounting'],
    review: ['create_invoice', 'send_to_customer'],
    escalate: [],
    thresholds: { amount_over: 1000, confidence_below: 0.85 },
  },
  estimate: {
    auto: ['generate_pdf'],
    review: ['create_estimate', 'send_to_customer'],
    escalate: ['estimate_over_10000'],
    thresholds: { amount_over: 5000, confidence_below: 0.80 },
  },
  collections: {
    auto: ['send_reminder_1', 'send_reminder_2'],
    review: ['send_final_notice', 'flag_for_lien'],
    escalate: ['initiate_lien_process'],
    thresholds: { amount_over: 5000 },
  },
  bookkeeping: {
    auto: ['categorize_expense', 'categorize_revenue', 'sync_to_accounting'],
    review: ['flag_anomaly'],
    escalate: ['large_discrepancy'],
    thresholds: { amount_over: 10000 },
  },
  insights: {
    auto: ['generate_report', 'generate_digest'],
    review: [],
    escalate: [],
    thresholds: {},
  },
  'field-ops': {
    auto: ['suggest_schedule', 'send_eta_update'],
    review: ['modify_schedule', 'reassign_tech'],
    escalate: ['emergency_dispatch'],
    thresholds: {},
  },
  compliance: {
    auto: ['send_expiration_reminder', 'check_deadlines'],
    review: ['submit_permit_application'],
    escalate: ['expired_certification', 'missed_deadline'],
    thresholds: {},
  },
  inventory: {
    auto: ['update_stock', 'send_low_stock_alert'],
    review: ['place_reorder', 'change_supplier'],
    escalate: ['stockout_critical_part'],
    thresholds: { amount_over: 2000 },
  },
  customer: {
    auto: ['send_confirmation', 'send_eta', 'send_completion_summary', 'request_review'],
    review: ['respond_to_review', 'send_marketing_email'],
    escalate: ['negative_review_response', 'customer_dispute'],
    thresholds: {},
  },
};
```

### Seeding Function

```typescript
async function seedAgentConfigs(orgId: string, tier: string): Promise<void> {
  const agentTypes = TIER_DEFAULTS[tier] ?? TIER_DEFAULTS.starter;

  const configs = agentTypes.map(agentType => ({
    org_id: orgId,
    agent_type: agentType,
    enabled: true,
    autonomy_rules: DEFAULT_AUTONOMY[agentType] ?? { auto: [], review: [], escalate: [], thresholds: {} },
    settings: {},
  }));

  await supabase.from('agent_configs').insert(configs);
}
```

**Decision rationale:** Agent configs are seeded on signup (not on first use) so that the dashboard can immediately show the user which agents they have and their status. Seeding based on tier means Starter users see 4 agents and Pro users see all 9 — reinforcing the value of upgrading.

---

## Seed Data / Demo Mode

For organizations that skip the integration step or have no connected tools, CrewShift provides sample data to demonstrate agent capabilities.

### When Demo Mode Activates

1. User clicks "Skip integration" during onboarding
2. User clicks "Try with sample data" during onboarding
3. Onboarding times out (user leaves and comes back without connecting)

### Sample Data Set

```typescript
// src/services/demo-data.service.ts

async function seedDemoData(orgId: string, tradeType: string): Promise<void> {
  // Mark org as demo mode
  await onboardingService.completeStep(orgId, 'first_integration_connected', { demo_mode: true });

  const demoSet = getDemoDataForTrade(tradeType);

  // Seed 5 sample customers
  const customers = await supabase
    .from('customers')
    .insert(demoSet.customers.map(c => ({ ...c, org_id: orgId })))
    .select();

  // Seed 10 sample jobs (mix of statuses)
  const jobs = await supabase
    .from('jobs')
    .insert(demoSet.jobs.map(j => ({
      ...j,
      org_id: orgId,
      customer_id: customers.data[j._customerIndex].id,
    })))
    .select();

  // Seed 5 sample invoices
  await supabase
    .from('invoices')
    .insert(demoSet.invoices.map(inv => ({
      ...inv,
      org_id: orgId,
      job_id: jobs.data[inv._jobIndex].id,
      customer_id: customers.data[inv._customerIndex].id,
    })));

  // Mark sync step as complete (using demo data)
  await onboardingService.completeStep(orgId, 'first_sync_complete');

  // Trigger demo agent run on a sample job
  await triggerDemoAgentRun(orgId, jobs.data);
}

function getDemoDataForTrade(tradeType: string): DemoDataSet {
  // Trade-specific sample data
  const DEMO_DATA: Record<string, DemoDataSet> = {
    hvac: {
      customers: [
        { name: 'Sarah Henderson', email: 'demo@example.com', phone: '+15555550001', address: { street: '123 Oak St', city: 'Dallas', state: 'TX', zip: '75201' } },
        { name: 'Johnson Plumbing & HVAC', email: 'demo2@example.com', phone: '+15555550002', address: { street: '456 Elm Ave', city: 'Dallas', state: 'TX', zip: '75202' } },
        { name: 'Martinez Family', email: 'demo3@example.com', phone: '+15555550003', address: { street: '789 Pine Rd', city: 'Plano', state: 'TX', zip: '75023' } },
        { name: 'Thompson Office Complex', email: 'demo4@example.com', phone: '+15555550004', address: { street: '321 Commerce St', city: 'Dallas', state: 'TX', zip: '75226' } },
        { name: 'Williams Residence', email: 'demo5@example.com', phone: '+15555550005', address: { street: '654 Maple Dr', city: 'Frisco', state: 'TX', zip: '75034' } },
      ],
      jobs: [
        {
          _customerIndex: 0,
          status: 'completed',
          type: 'install',
          description: 'AC system replacement — 3-ton Carrier unit',
          line_items: [
            { description: 'Carrier 3-ton AC unit', quantity: 1, unit_price: 3200, total: 3200 },
            { description: 'Installation labor', quantity: 8, unit_price: 95, total: 760 },
            { description: 'Refrigerant charge', quantity: 1, unit_price: 150, total: 150 },
            { description: 'Thermostat (Ecobee)', quantity: 1, unit_price: 180, total: 180 },
          ],
          total_amount: 4290,
          labor_hours: 8,
          actual_end: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
        // ... 9 more sample jobs with varying statuses, types, and amounts
      ],
      invoices: [
        // 5 sample invoices in various states (paid, sent, overdue)
      ],
    },
    plumbing: { /* similar structure with plumbing-specific data */ },
    electrical: { /* similar structure with electrical-specific data */ },
    // Fallback for other trades uses general_contracting sample data
  };

  return DEMO_DATA[tradeType] ?? DEMO_DATA.hvac;
}
```

### Demo Data Cleanup

When a user eventually connects a real integration, demo data is **not** automatically deleted. Instead:

1. Demo records are tagged with `metadata.demo: true` on all seeded rows
2. The user can choose to "Clear demo data" from Settings
3. Real synced data coexists with demo data — the dashboard shows both
4. If the user only has demo data and connects a tool, the sync worker populates real data alongside it

---

## Onboarding Completion

### What Happens When Onboarding Completes

```typescript
async function handleOnboardingComplete(orgId: string): Promise<void> {
  // 1. Update onboarding status
  await supabase
    .from('organizations')
    .update({
      'onboarding_status': {
        ...currentStatus,
        onboarding_complete: true,
        completed_at: new Date().toISOString(),
        current_step: 'onboarding_complete',
      },
    })
    .eq('id', orgId);

  // 2. Send welcome email
  await notificationQueue.add('notification:email', {
    type: 'welcome',
    orgId,
    template: 'welcome_email',
  });

  // 3. Create welcome notification
  await createNotification({
    orgId,
    type: 'agent_action',
    title: 'Welcome to CrewShift!',
    body: 'Your AI team is ready. Explore the dashboard to see what your agents can do.',
    actionUrl: '/dashboard',
  });

  // 4. Track analytics
  await trackOnboardingEvent(orgId, 'onboarding_complete', {
    total_duration_seconds: calculateOnboardingDuration(orgId),
    steps_completed: getCompletedStepCount(orgId),
    demo_mode: currentStatus.demo_mode,
    first_integration: currentStatus.first_integration_provider,
  });
}
```

### What the User Sees After Completion

The user is redirected to the full dashboard, which shows:
- Agent activity feed (the demo execution, plus any real activity)
- Quick stats (synced data counts)
- Review queue (if the demo execution produced a reviewable item)
- "Connect more tools" prompt (if only one integration)
- "Upgrade to Pro" prompt (if on Starter tier and more than 4 agents are shown as locked)

---

## Re-Onboarding

### When Re-Onboarding Triggers

If a user disconnects their **only** integration, the system prompts them to reconnect:

```typescript
// src/integrations/disconnect.service.ts

async function disconnectIntegration(orgId: string, provider: string): Promise<void> {
  // Disconnect the integration
  await supabase
    .from('integrations')
    .update({ status: 'disconnected' })
    .eq('org_id', orgId)
    .eq('provider', provider);

  // Check if this was the only connected integration
  const { count } = await supabase
    .from('integrations')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'connected');

  if (count === 0) {
    // Create a notification prompting reconnection
    await createNotification({
      orgId,
      type: 'alert',
      title: 'No integrations connected',
      body: 'Your agents need connected tools to work. Reconnect an integration to keep your AI team running.',
      actionUrl: '/settings/integrations',
      metadata: { urgency: 'medium' },
    });

    // Do NOT reset onboarding_status — this is a soft prompt, not a full re-onboarding
    // The user has already seen the value and does not need the guided flow again
  }
}
```

**Decision rationale:** Full re-onboarding (resetting onboarding_status) would be patronizing to a user who has already used the product. Instead, a notification + dashboard banner prompts them to reconnect. The onboarding state machine is a one-time flow.

---

## Analytics

### Tracking Onboarding Conversion

Every step completion is tracked as an analytics event:

```typescript
// src/services/analytics.service.ts

interface OnboardingEvent {
  orgId: string;
  step: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

async function trackOnboardingEvent(
  orgId: string,
  step: string,
  metadata?: Record<string, any>
): Promise<void> {
  // Store in a lightweight analytics table (or send to external analytics)
  await supabase.from('analytics_events').insert({
    org_id: orgId,
    event_type: 'onboarding',
    event_name: `onboarding.${step}`,
    metadata: {
      ...metadata,
      timestamp: new Date().toISOString(),
    },
  });

  // In production, also send to analytics service (Mixpanel, Amplitude, PostHog)
  // analytics.track('onboarding_step_completed', { orgId, step, ...metadata });
}
```

### Funnel Analysis Query

```sql
-- Onboarding funnel: which step has the highest drop-off?
WITH steps AS (
  SELECT
    org_id,
    (onboarding_status->>'account_created')::boolean AS step_1,
    (onboarding_status->>'trade_type_selected')::boolean AS step_2,
    (onboarding_status->>'first_integration_connected')::boolean AS step_3,
    (onboarding_status->>'first_sync_complete')::boolean AS step_4,
    (onboarding_status->>'first_agent_run')::boolean AS step_5,
    (onboarding_status->>'onboarding_complete')::boolean AS step_6
  FROM organizations
  WHERE created_at > NOW() - interval '30 days'
)
SELECT
  COUNT(*) FILTER (WHERE step_1) AS "1. Account Created",
  COUNT(*) FILTER (WHERE step_2) AS "2. Trade Selected",
  COUNT(*) FILTER (WHERE step_3) AS "3. Integration Connected",
  COUNT(*) FILTER (WHERE step_4) AS "4. First Sync",
  COUNT(*) FILTER (WHERE step_5) AS "5. First Agent Run",
  COUNT(*) FILTER (WHERE step_6) AS "6. Onboarding Complete",
  -- Drop-off percentages
  ROUND(100.0 * COUNT(*) FILTER (WHERE step_2) / NULLIF(COUNT(*) FILTER (WHERE step_1), 0), 1) AS "1→2 %",
  ROUND(100.0 * COUNT(*) FILTER (WHERE step_3) / NULLIF(COUNT(*) FILTER (WHERE step_2), 0), 1) AS "2→3 %",
  ROUND(100.0 * COUNT(*) FILTER (WHERE step_4) / NULLIF(COUNT(*) FILTER (WHERE step_3), 0), 1) AS "3→4 %",
  ROUND(100.0 * COUNT(*) FILTER (WHERE step_5) / NULLIF(COUNT(*) FILTER (WHERE step_4), 0), 1) AS "4→5 %",
  ROUND(100.0 * COUNT(*) FILTER (WHERE step_6) / NULLIF(COUNT(*) FILTER (WHERE step_5), 0), 1) AS "5→6 %"
FROM steps;
```

### Expected Drop-Off Points

| Transition | Expected Rate | Intervention If Low |
|------------|--------------|---------------------|
| 1 → 2 (account → trade type) | > 95% | This is one click — if drop-off is high, the UI is broken |
| 2 → 3 (trade → integration) | > 60% | Biggest expected drop-off. Requires OAuth trust. Offer "Try with sample data" prominently. |
| 3 → 4 (integration → sync) | > 95% | Automatic — should be near 100%. If low, sync is failing. |
| 4 → 5 (sync → agent run) | > 90% | Automatic — should be near 100%. If low, no suitable jobs found. |
| 5 → 6 (agent run → complete) | > 85% | User saw the demo. If they leave here, the result was not compelling enough. |

### Target Metrics from Project Context

| Metric | Target |
|--------|--------|
| % connect 1+ tool within 24h | > 60% |
| % see first agent output within 1h | > 40% |
| Free to Paid within 14 days | > 15% |
| Starter to Pro upgrade within 90 days | > 25% |

---

## Implementation Notes

1. **Onboarding state is org-level, not user-level.** If the owner starts onboarding and an admin finishes it, the org is considered onboarded. This prevents the second user from seeing the onboarding flow again.

2. **Frontend routing based on onboarding status.** When the frontend loads, it checks `GET /api/onboarding/status`. If `onboarding_complete` is false, it redirects to the onboarding UI at the `current_step`. If true, it shows the full dashboard.

3. **Idempotent step completion.** Calling `completeStep()` for a step that is already complete returns the current status without error. This prevents race conditions where the sync worker and OAuth callback both try to mark the same step.

4. **Demo mode flag propagates.** When `demo_mode: true`, the Invoice Agent creates the invoice with `generated_by: 'demo'` and `metadata.demo: true`. This data is tagged so the frontend can distinguish demo output from real output.

5. **Onboarding timeout.** If a user creates an account but does not complete onboarding within 24 hours, a scheduled job sends a reminder email: "You're one step away from your first AI-generated invoice. Connect QuickBooks to get started."

6. **Tier upgrade during onboarding.** If a user upgrades from Starter to Pro during onboarding, `seedAgentConfigs()` is called again for the new tier, adding the 5 additional agent configs. Existing configs are preserved.
