# 19 - Testing Strategy

> **Permanent reference** for the CrewShift testing philosophy, test stack, mock strategies, fixtures, and the complete list of what must be tested across every layer.
> Cross-references: [06-agent-runtime](./06-agent-runtime.md) | [07-agent-definitions](./07-agent-definitions.md) | [08-copilot](./08-copilot.md) | [09-integrations](./09-integrations.md) | [10-ai-service](./10-ai-service.md) | [14-queue-system](./14-queue-system.md) | [04-api-standards](./04-api-standards.md)

---

## 1. Test Philosophy

Three principles govern every test in CrewShift:

1. **Test the business logic, not the framework.** Services, agents, and adapters contain the business rules. Route handlers and middleware are thin wrappers -- the real logic lives in services and the agent runtime. Test the logic directly, not through HTTP unless you are explicitly testing the HTTP contract.

2. **Mock the external dependencies.** LLM providers, QuickBooks API, Stripe API, Twilio, S3 -- anything outside the process boundary gets a mock or recorded response. Tests must be deterministic and fast. A test that calls Claude is not a test; it is a hope.

3. **Verify integration contracts.** The boundary between Node and Python, between the API and external services, and between the app and the database must have explicit contract tests. The mock must conform to the real contract. If the Python AI service changes its response shape, a contract test must fail.

### Why This Matters for CrewShift

CrewShift has two separate services (Node API + Python AI service), nine agents, multiple integration adapters, a queue system, and a multi-tenant database with RLS. A broken test suite means broken agents means wrong invoices sent to real contractors' customers. The testing strategy must be as reliable as the product it protects.

---

## 2. Test Stack

| Layer | Framework | Purpose | Location |
|---|---|---|---|
| **Node unit tests** | Vitest | Services, validators, utilities, agent definitions, pagination helpers, response builders | `apps/api/src/**/*.test.ts` |
| **Node integration tests** | Vitest + Supertest | API routes, middleware chains, database queries, full request/response cycles | `apps/api/src/**/*.integration.test.ts` |
| **Python unit tests** | pytest | Providers, prompt template rendering, Pydantic models, router logic, anonymization | `apps/ai-service/tests/unit/` |
| **Python integration tests** | pytest + httpx | AI service FastAPI endpoints, provider routing, health checks | `apps/ai-service/tests/integration/` |
| **E2E agent tests** | Vitest | Full agent execution pipeline with mocked AI: trigger -> gather -> reason -> validate -> autonomy -> write -> chain -> log | `apps/api/src/agents/__tests__/` |

### Why Vitest (Not Jest)

- Native ESM support (no transform hacks for TypeScript imports)
- Compatible with Fastify's async plugin system
- Built-in mocking (`vi.mock`, `vi.spyOn`) that works with ES modules
- Faster execution via esbuild transforms
- Same assertion API as Jest -- zero learning curve

### Why pytest (Not unittest)

- Fixture system maps cleanly to the provider/router pattern
- `httpx.AsyncClient` integrates directly with FastAPI's `TestClient`
- Parametrize lets us test multiple providers with the same test function
- Plugin ecosystem (pytest-asyncio, pytest-cov) covers every need

---

## 3. AI Mock Strategy (Python)

The Python AI service has a `MockProvider` that implements the same `AIProvider` abstract class as the real providers (Anthropic, OpenAI, Google). It returns deterministic responses based on the prompt template name.

### MockProvider Class

```python
# apps/ai-service/app/providers/mock.py

from app.providers.base import AIProvider
from app.models.responses import ReasoningResponse, ClassifyResponse, ExtractResponse

# Pre-defined deterministic responses
MOCK_INVOICE_RESPONSE = ReasoningResponse(
    content="""{
        "line_items": [
            {"description": "AC unit repair - compressor replacement", "quantity": 1, "unit_price": 850.00, "total": 850.00},
            {"description": "Refrigerant R-410A (3 lbs)", "quantity": 3, "unit_price": 45.00, "total": 135.00},
            {"description": "Labor - 4 hours @ $125/hr", "quantity": 4, "unit_price": 125.00, "total": 500.00}
        ],
        "subtotal": 1485.00,
        "tax_rate": 0.0825,
        "tax_amount": 122.51,
        "total": 1607.51,
        "notes": "Compressor replacement completed. System tested and running within manufacturer specifications."
    }""",
    model="mock-model",
    tokens_used=0,
    latency_ms=5,
    confidence=0.94,
)

MOCK_ESTIMATE_RESPONSE = ReasoningResponse(
    content="""{
        "line_items": [
            {"description": "Remove existing furnace", "quantity": 1, "unit_price": 200.00, "total": 200.00},
            {"description": "Carrier 96% AFUE Gas Furnace (80,000 BTU)", "quantity": 1, "unit_price": 2800.00, "total": 2800.00},
            {"description": "Installation labor - 6 hours", "quantity": 6, "unit_price": 125.00, "total": 750.00},
            {"description": "Ductwork modifications", "quantity": 1, "unit_price": 350.00, "total": 350.00},
            {"description": "Permit and inspection", "quantity": 1, "unit_price": 150.00, "total": 150.00}
        ],
        "subtotal": 4250.00,
        "tax_amount": 350.63,
        "total": 4600.63,
        "scope_description": "Full furnace replacement including removal of existing unit, installation of new high-efficiency gas furnace, ductwork modifications, and all required permits.",
        "valid_days": 30
    }""",
    model="mock-model",
    tokens_used=0,
    latency_ms=5,
    confidence=0.91,
)

MOCK_COLLECTIONS_RESPONSE = ReasoningResponse(
    content="""{
        "follow_up_type": "friendly_reminder",
        "subject": "Friendly reminder: Invoice #1042 - payment due",
        "body": "Hi {customer_name}, just a quick reminder that invoice #1042 for ${amount} was due on {due_date}. You can pay online at {payment_link} or call us at {phone}. Thanks!",
        "urgency": "low",
        "next_action_days": 7
    }""",
    model="mock-model",
    tokens_used=0,
    latency_ms=5,
    confidence=0.96,
)

MOCK_GENERIC_RESPONSE = ReasoningResponse(
    content='{"result": "mock generic response", "status": "ok"}',
    model="mock-model",
    tokens_used=0,
    latency_ms=5,
    confidence=0.90,
)


class MockProvider(AIProvider):
    """Deterministic AI provider for testing. Returns pre-defined responses
    based on the prompt template name found in the system prompt."""

    async def reason(
        self,
        prompt: str,
        system: str,
        tools: list | None = None,
    ) -> ReasoningResponse:
        # Route based on prompt template name in system prompt
        if "invoice" in system.lower():
            return MOCK_INVOICE_RESPONSE
        if "estimate" in system.lower():
            return MOCK_ESTIMATE_RESPONSE
        if "collection" in system.lower():
            return MOCK_COLLECTIONS_RESPONSE
        return MOCK_GENERIC_RESPONSE

    async def classify(self, text: str, categories: list[str]) -> ClassifyResponse:
        return MockClassifyResponse.from_text(text, categories)

    async def extract(self, text: str, schema: dict) -> ExtractResponse:
        return ExtractResponse(
            entities={"mock_entity": "mock_value"},
            model="mock-model",
            tokens_used=0,
            latency_ms=2,
        )

    async def embed(self, text: str) -> list[float]:
        # Return a deterministic 1024-dim vector (Voyage-finance-2 dimensions)
        import hashlib
        seed = int(hashlib.md5(text.encode()).hexdigest(), 16) % 10000
        return [float(seed + i) / 10000.0 for i in range(1024)]
```

### MockClassifyResponse

```python
# apps/ai-service/app/providers/mock.py (continued)

KEYWORD_INTENT_MAP = {
    "invoice": "create-invoice",
    "bill": "create-invoice",
    "estimate": "create-estimate",
    "quote": "create-estimate",
    "overdue": "check-collections",
    "outstanding": "check-collections",
    "unpaid": "check-collections",
    "schedule": "schedule-job",
    "dispatch": "dispatch-tech",
    "assign": "dispatch-tech",
    "review": "send-review-request",
    "how did": "business-report",
    "last month": "business-report",
    "report": "business-report",
    "inventory": "check-inventory",
    "stock": "check-inventory",
    "parts": "check-inventory",
    "workflow": "create-workflow",
    "automation": "create-workflow",
    "done": "multi-action",
    "completed": "multi-action",
    "finished": "multi-action",
}


class MockClassifyResponse(ClassifyResponse):
    """Deterministic intent classification using keyword matching.
    For tests that need predictable routing without LLM calls."""

    @classmethod
    def from_text(cls, text: str, categories: list[str]) -> "MockClassifyResponse":
        text_lower = text.lower()

        # Check keywords in priority order
        for keyword, intent in KEYWORD_INTENT_MAP.items():
            if keyword in text_lower:
                return cls(
                    intent=intent,
                    confidence=0.95,
                    entities={"raw_text": text},
                    model="mock-classifier",
                    tokens_used=0,
                    latency_ms=1,
                )

        # Default: general question
        return cls(
            intent="general-question",
            confidence=0.70,
            entities={"raw_text": text},
            model="mock-classifier",
            tokens_used=0,
            latency_ms=1,
        )
```

### How to Activate the Mock Provider

```python
# apps/ai-service/app/providers/router.py

class ProviderRouter:
    def __init__(self):
        if os.environ.get("TESTING") == "true":
            self.providers = {"mock": MockProvider()}
            self.default_provider = "mock"
        else:
            self.providers = {
                "anthropic": AnthropicProvider(),
                "openai": OpenAIProvider(),
                "google": GoogleProvider(),
            }
            self.default_provider = "anthropic"
```

```bash
# In pytest conftest.py or test runner
TESTING=true pytest
```

### Decision Rationale

Why not use `unittest.mock.patch` on every provider call? Because the `MockProvider` is a first-class implementation of the `AIProvider` interface. It guarantees the mock returns the exact same shape as real providers. If someone changes `ReasoningResponse`, both the real providers and `MockProvider` must be updated -- the type system catches drift.

---

## 4. AI Mock Strategy (Node)

The Node API communicates with the Python AI service via HTTP. For testing, we replace the `AIClient` with a `MockAIClient` that returns pre-defined responses without any HTTP calls.

### MockAIClient Class

```typescript
// apps/api/src/ai/__mocks__/ai-client.ts

import type { AIClientInterface, ReasonRequest, ReasonResponse, ClassifyRequest, ClassifyResponse } from '../types';

// Pre-defined mock responses keyed by prompt template name
const MOCK_RESPONSES: Record<string, ReasonResponse> = {
  invoice: {
    content: {
      line_items: [
        { description: 'AC unit repair - compressor replacement', quantity: 1, unit_price: 850.0, total: 850.0 },
        { description: 'Refrigerant R-410A (3 lbs)', quantity: 3, unit_price: 45.0, total: 135.0 },
        { description: 'Labor - 4 hours @ $125/hr', quantity: 4, unit_price: 125.0, total: 500.0 },
      ],
      subtotal: 1485.0,
      tax_rate: 0.0825,
      tax_amount: 122.51,
      total: 1607.51,
      notes: 'Compressor replacement completed. System tested and running within manufacturer specifications.',
    },
    model: 'mock-model',
    tokens_used: 0,
    latency_ms: 5,
    confidence: 0.94,
  },
  estimate: {
    content: {
      line_items: [
        { description: 'Remove existing furnace', quantity: 1, unit_price: 200.0, total: 200.0 },
        { description: 'Carrier 96% AFUE Gas Furnace', quantity: 1, unit_price: 2800.0, total: 2800.0 },
        { description: 'Installation labor - 6 hours', quantity: 6, unit_price: 125.0, total: 750.0 },
        { description: 'Ductwork modifications', quantity: 1, unit_price: 350.0, total: 350.0 },
        { description: 'Permit and inspection', quantity: 1, unit_price: 150.0, total: 150.0 },
      ],
      subtotal: 4250.0,
      tax_amount: 350.63,
      total: 4600.63,
      scope_description: 'Full furnace replacement with high-efficiency gas furnace.',
      valid_days: 30,
    },
    model: 'mock-model',
    tokens_used: 0,
    latency_ms: 5,
    confidence: 0.91,
  },
  collections: {
    content: {
      follow_up_type: 'friendly_reminder',
      subject: 'Friendly reminder: Invoice #1042 - payment due',
      body: 'Hi, just a quick reminder that your invoice is due.',
      urgency: 'low',
      next_action_days: 7,
    },
    model: 'mock-model',
    tokens_used: 0,
    latency_ms: 5,
    confidence: 0.96,
  },
};

const DEFAULT_MOCK_RESPONSE: ReasonResponse = {
  content: { result: 'mock generic response', status: 'ok' },
  model: 'mock-model',
  tokens_used: 0,
  latency_ms: 5,
  confidence: 0.90,
};

const MOCK_CLASSIFY_RESPONSES: Record<string, ClassifyResponse> = {
  'create-invoice': { intent: 'create-invoice', confidence: 0.95, entities: {} },
  'create-estimate': { intent: 'create-estimate', confidence: 0.95, entities: {} },
  'check-collections': { intent: 'check-collections', confidence: 0.95, entities: {} },
  'multi-action': { intent: 'multi-action', confidence: 0.92, entities: {} },
  'general-question': { intent: 'general-question', confidence: 0.70, entities: {} },
};


export class MockAIClient implements AIClientInterface {
  /**
   * Returns a pre-defined response based on the prompt_template field.
   * Falls back to a generic response if the template is unknown.
   */
  async reason(request: ReasonRequest): Promise<ReasonResponse> {
    const template = request.prompt_template;
    return MOCK_RESPONSES[template] ?? DEFAULT_MOCK_RESPONSE;
  }

  /**
   * Returns a pre-defined classification based on keyword matching.
   * Same logic as the Python MockClassifyResponse.
   */
  async classify(request: ClassifyRequest): Promise<ClassifyResponse> {
    const text = request.text.toLowerCase();

    if (text.includes('invoice') || text.includes('bill')) {
      return MOCK_CLASSIFY_RESPONSES['create-invoice'];
    }
    if (text.includes('estimate') || text.includes('quote')) {
      return MOCK_CLASSIFY_RESPONSES['create-estimate'];
    }
    if (text.includes('overdue') || text.includes('outstanding')) {
      return MOCK_CLASSIFY_RESPONSES['check-collections'];
    }
    if (text.includes('done') || text.includes('completed') || text.includes('finished')) {
      return MOCK_CLASSIFY_RESPONSES['multi-action'];
    }

    return MOCK_CLASSIFY_RESPONSES['general-question'];
  }

  /**
   * Health check always returns healthy in mock mode.
   */
  async health(): Promise<{ status: string }> {
    return { status: 'ok' };
  }
}
```

### Injecting the Mock

```typescript
// apps/api/src/ai/ai-client.ts

import { MockAIClient } from './__mocks__/ai-client';

export function createAIClient(): AIClientInterface {
  if (process.env.NODE_ENV === 'test') {
    return new MockAIClient();
  }

  return new AIClient({
    baseUrl: env.AI_SERVICE_URL,
    timeout: 30000,
  });
}
```

### Vitest Module Mock (Alternative)

For tests that need to override specific mock responses:

```typescript
// In any test file
import { vi } from 'vitest';

vi.mock('../ai/ai-client', () => ({
  createAIClient: () => ({
    reason: vi.fn().mockResolvedValue({
      content: { /* custom response for this test */ },
      model: 'mock-model',
      tokens_used: 0,
      latency_ms: 5,
      confidence: 0.99,
    }),
    classify: vi.fn().mockResolvedValue({
      intent: 'create-invoice',
      confidence: 0.95,
      entities: { job_id: 'test-job-123' },
    }),
  }),
}));
```

---

## 5. Test Database

### Local Development

Supabase CLI runs a full local PostgreSQL instance with Auth, Realtime, and all extensions (pgvector, pgcrypto):

```bash
# Start local Supabase (PostgreSQL on port 54322, Auth on 54321)
npx supabase start

# Run migrations
npx supabase db push

# Or via Drizzle
npx drizzle-kit push:pg
```

### CI Environment (GitHub Actions)

```yaml
# .github/workflows/test.yml (database section)
services:
  supabase-db:
    image: supabase/postgres:15.1.0.147
    env:
      POSTGRES_DB: postgres
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - 54322:5432
    options: >-
      --health-cmd "pg_isready -U postgres"
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

### Fresh Database Per Test Suite

Every test suite gets a clean database state. Migrations run once at suite start, then each individual test uses transaction rollback for isolation.

```typescript
// apps/api/src/test/setup.ts

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

let pool: Pool;
let db: ReturnType<typeof drizzle>;

// Run once before all tests in the suite
export async function setupTestDatabase() {
  pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres',
  });
  db = drizzle(pool);

  // Run all migrations to get current schema
  await migrate(db, { migrationsFolder: './src/db/migrations' });

  return db;
}

// Clean up after all tests
export async function teardownTestDatabase() {
  await pool.end();
}
```

### Transaction Rollback Per Test

Each test runs inside a transaction that is rolled back after the test completes. This is faster than truncating tables and ensures no test pollutes another.

```typescript
// apps/api/src/test/helpers.ts

import { beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';

let savepoint = 0;

export function useTransactionRollback(db: ReturnType<typeof drizzle>) {
  beforeEach(async () => {
    savepoint++;
    await db.execute(sql.raw(`SAVEPOINT test_sp_${savepoint}`));
  });

  afterEach(async () => {
    await db.execute(sql.raw(`ROLLBACK TO SAVEPOINT test_sp_${savepoint}`));
    savepoint--;
  });
}
```

### Decision Rationale

Why Supabase CLI for local and CI, rather than a plain PostgreSQL Docker image? Because Supabase's `auth.users` table, `auth.org_id()` function, JWT claims, and RLS policies are all Supabase-specific. A plain PostgreSQL instance would not have the `auth` schema. Running the same Supabase image in CI guarantees parity with production.

---

## 6. Test Fixtures

Factory functions generate sample data for organizations, profiles, customers, jobs, invoices, and all other entities. Every factory returns a valid, insertable record with sensible defaults that can be overridden.

```typescript
// apps/api/src/test/factories.ts

import { randomUUID } from 'crypto';

// --------------- ORGANIZATIONS ---------------

export function createTestOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    id: randomUUID(),
    name: 'Acme HVAC Services',
    trade_type: 'hvac',
    size: '2-5',
    tier: 'pro',
    settings: {
      timezone: 'America/Chicago',
      currency: 'USD',
      tax_rate: 0.0825,
      invoice_terms: 'Net 30',
      invoice_footer: 'Thank you for your business!',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// --------------- PROFILES ---------------

export function createTestProfile(
  orgId: string,
  overrides: Partial<Profile> = {},
): Profile {
  return {
    id: randomUUID(),
    org_id: orgId,
    full_name: 'John Smith',
    role: 'owner',
    phone: '+15551234567',
    avatar_url: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createTestTech(
  orgId: string,
  overrides: Partial<Profile> = {},
): Profile {
  return createTestProfile(orgId, {
    full_name: 'Mike Johnson',
    role: 'tech',
    ...overrides,
  });
}

// --------------- CUSTOMERS ---------------

export function createTestCustomer(
  orgId: string,
  overrides: Partial<Customer> = {},
): Customer {
  return {
    id: randomUUID(),
    org_id: orgId,
    external_ids: {},
    name: 'Robert Henderson',
    email: 'henderson@example.com',
    phone: '+15559876543',
    address: {
      street: '1234 Oak Lane',
      city: 'Dallas',
      state: 'TX',
      zip: '75201',
    },
    tags: ['residential', 'hvac'],
    notes: 'Prefers afternoon appointments. Has a dog in the backyard.',
    payment_score: 0.85,
    lifetime_value: 4500.0,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// --------------- JOBS ---------------

export function createTestJob(
  orgId: string,
  customerId: string,
  overrides: Partial<Job> = {},
): Job {
  return {
    id: randomUUID(),
    org_id: orgId,
    customer_id: customerId,
    external_ids: {},
    status: 'completed',
    type: 'service_call',
    description: 'AC not cooling - compressor replacement needed',
    scheduled_start: new Date('2026-03-03T09:00:00Z').toISOString(),
    scheduled_end: new Date('2026-03-03T13:00:00Z').toISOString(),
    actual_start: new Date('2026-03-03T09:15:00Z').toISOString(),
    actual_end: new Date('2026-03-03T13:10:00Z').toISOString(),
    assigned_tech_id: null,
    address: {
      street: '1234 Oak Lane',
      city: 'Dallas',
      state: 'TX',
      zip: '75201',
    },
    line_items: [
      { description: 'AC unit repair - compressor replacement', quantity: 1, unit_price: 850.0, total: 850.0 },
      { description: 'Refrigerant R-410A (3 lbs)', quantity: 3, unit_price: 45.0, total: 135.0 },
      { description: 'Labor - 4 hours @ $125/hr', quantity: 4, unit_price: 125.0, total: 500.0 },
    ],
    materials: [
      { part_name: 'Compressor - Scroll Type', quantity: 1, unit_cost: 420.0 },
      { part_name: 'R-410A Refrigerant (lb)', quantity: 3, unit_cost: 18.0 },
    ],
    labor_hours: 4.0,
    total_amount: 1485.0,
    margin: 42.5,
    notes: 'Replaced compressor. System running within specs.',
    photos: [],
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// --------------- INVOICES ---------------

export function createTestInvoice(
  orgId: string,
  jobId: string,
  customerId: string,
  overrides: Partial<Invoice> = {},
): Invoice {
  return {
    id: randomUUID(),
    org_id: orgId,
    job_id: jobId,
    customer_id: customerId,
    external_ids: {},
    status: 'draft',
    invoice_number: 'INV-1042',
    line_items: [
      { description: 'AC unit repair - compressor replacement', quantity: 1, unit_price: 850.0, total: 850.0 },
      { description: 'Refrigerant R-410A (3 lbs)', quantity: 3, unit_price: 45.0, total: 135.0 },
      { description: 'Labor - 4 hours @ $125/hr', quantity: 4, unit_price: 125.0, total: 500.0 },
    ],
    subtotal: 1485.0,
    tax_rate: 0.0825,
    tax_amount: 122.51,
    total: 1607.51,
    due_date: new Date('2026-04-03').toISOString(),
    sent_at: null,
    paid_at: null,
    payment_method: null,
    generated_by: 'agent',
    pdf_url: null,
    notes: 'Compressor replacement completed.',
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// --------------- ESTIMATES ---------------

export function createTestEstimate(
  orgId: string,
  customerId: string,
  overrides: Partial<Estimate> = {},
): Estimate {
  return {
    id: randomUUID(),
    org_id: orgId,
    customer_id: customerId,
    external_ids: {},
    status: 'draft',
    estimate_number: 'EST-0087',
    type: 'estimate',
    line_items: [
      { description: 'Remove existing furnace', quantity: 1, unit_price: 200.0, total: 200.0 },
      { description: 'Carrier 96% AFUE Gas Furnace', quantity: 1, unit_price: 2800.0, total: 2800.0 },
      { description: 'Installation labor - 6 hours', quantity: 6, unit_price: 125.0, total: 750.0 },
    ],
    subtotal: 3750.0,
    tax_amount: 309.38,
    total: 4059.38,
    valid_until: new Date('2026-04-03').toISOString(),
    scope_description: 'Full furnace replacement with high-efficiency unit.',
    photos: [],
    confidence_score: 0.91,
    generated_by: 'agent',
    pdf_url: null,
    notes: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// --------------- AGENT CONFIGS ---------------

export function createTestAgentConfig(
  orgId: string,
  agentType: string,
  overrides: Partial<AgentConfig> = {},
): AgentConfig {
  return {
    id: randomUUID(),
    org_id: orgId,
    agent_type: agentType,
    enabled: true,
    autonomy_rules: {
      auto: ['generate_pdf', 'sync_to_accounting'],
      review: ['create_invoice', 'send_to_customer'],
      escalate: [],
      thresholds: { amount_over: 1000, confidence_below: 0.85 },
    },
    settings: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// --------------- INTEGRATIONS ---------------

export function createTestIntegration(
  orgId: string,
  overrides: Partial<Integration> = {},
): Integration {
  return {
    id: randomUUID(),
    org_id: orgId,
    provider: 'quickbooks',
    status: 'connected',
    access_token: 'encrypted_mock_token',
    refresh_token: 'encrypted_mock_refresh',
    token_expires_at: new Date(Date.now() + 3600000).toISOString(),
    external_account_id: 'qbo_realm_12345',
    metadata: { company_name: 'Acme HVAC' },
    last_sync_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// --------------- CONVERSATIONS ---------------

export function createTestConversation(
  orgId: string,
  userId: string,
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id: randomUUID(),
    org_id: orgId,
    user_id: userId,
    title: 'Invoice questions',
    summary: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// --------------- HELPER: Seed full test scenario ---------------

export async function seedTestScenario(db: Database) {
  const org = createTestOrg();
  const owner = createTestProfile(org.id, { role: 'owner' });
  const tech = createTestTech(org.id);
  const customer = createTestCustomer(org.id);
  const job = createTestJob(org.id, customer.id, { assigned_tech_id: tech.id });
  const invoice = createTestInvoice(org.id, job.id, customer.id);
  const agentConfig = createTestAgentConfig(org.id, 'invoice');
  const integration = createTestIntegration(org.id);

  await db.insert(organizations).values(org);
  // Note: profiles require auth.users entry -- use Supabase admin API in tests
  await db.insert(customers).values(customer);
  await db.insert(jobs).values(job);
  await db.insert(invoices).values(invoice);
  await db.insert(agentConfigs).values(agentConfig);
  await db.insert(integrations).values(integration);

  return { org, owner, tech, customer, job, invoice, agentConfig, integration };
}
```

---

## 7. What Must Be Tested

This is the comprehensive list. Every item below must have at least one test. Items marked with **(critical)** must have multiple tests covering edge cases.

### 7.1 Auth Flow **(critical)**

```
signup -> login -> JWT with org_id claim -> middleware -> org scoping
```

| Test | What It Verifies |
|---|---|
| Signup creates org + profile | New org in `organizations`, new profile in `profiles`, JWT returned with `org_id` claim |
| Login returns valid JWT | JWT contains `sub`, `org_id`, `role` claims |
| JWT refresh works | New token returned, old token no longer valid |
| Missing token returns 401 | `AUTH_REQUIRED` error code |
| Expired token returns 401 | Token past expiry rejected |
| Invalid token returns 401 | Tampered or malformed token rejected |
| org_id extracted from JWT | `request.orgId` populated by middleware |
| User without org gets 403 | `NO_ORG` error code |

### 7.2 CRUD Operations **(critical)**

```
create -> read -> update -> list with pagination -> org isolation
```

| Test | What It Verifies |
|---|---|
| Create customer | 201 response, customer in DB with correct `org_id` |
| Read customer by ID | 200 response, full customer object |
| Read customer from wrong org | 404 (not 403 -- do not leak existence) |
| Update customer | 200 response, fields updated, `updated_at` changed |
| List customers with pagination | Default limit 25, `has_more` flag correct, `next_cursor` present |
| Cursor pagination walks full list | Iterate all pages, collect all records, no duplicates, no missing |
| Filter by status | Only matching records returned |
| Sort by created_at desc | Records in correct order |
| Full-text search | `search=henderson` returns matching customer |
| **Org isolation: User A cannot see User B's data** | Org A creates customer, Org B lists customers, result is empty |

### 7.3 Agent Execution **(critical)**

```
trigger event -> gather -> mock AI -> validate -> autonomy check -> write -> chain -> log
```

| Test | What It Verifies |
|---|---|
| Event triggers correct agent | `job.completed` event activates Invoice Agent |
| Agent gathers input data | Job, customer, org settings loaded from DB |
| Mock AI returns structured response | Invoice line items, subtotal, tax, total in correct shape |
| Validation passes for valid output | Line items sum to subtotal, total = subtotal + tax |
| Validation fails for bad output | `line_items.length === 0` triggers validation error |
| Validation fails for out-of-range total | `total > job.total_amount * 1.5` caught |
| Auto-route for small invoice | Invoice < $500 + confidence > 0.9 = auto-executed |
| Review-route for large invoice | Invoice >= $500 = status `awaiting_review` |
| Escalate-route for low confidence | Confidence < 0.6 = status `escalated`, notification sent |
| Write creates DB record | Invoice inserted in `invoices` table with correct fields |
| Chain fires downstream events | `invoice.created` triggers Collections + Bookkeeping agents |
| Execution logged | `agent_executions` row with input, output, duration, model, tokens, cost |
| Idempotency key prevents duplicate | Same key submitted twice, second execution skipped |

### 7.4 Autonomy Rules

| Test | What It Verifies |
|---|---|
| Amount under threshold -> auto | `total < thresholds.amount_over` = auto |
| Amount over threshold -> review | `total >= thresholds.amount_over` = review |
| Confidence under threshold -> review | `confidence < thresholds.confidence_below` = review |
| Confidence very low -> escalate | `confidence < 0.6` = escalate |
| Amount very high -> escalate | `total > 10000` = escalate |
| Review queue approve -> completes | Approve pending execution -> status `completed`, actions executed |
| Review queue reject -> rejected | Reject pending execution -> status `rejected`, no actions taken |
| Custom autonomy rules per org | Org overrides `amount_over` to 2000 -> invoice at 1500 auto-executes |

### 7.5 Integration Adapter

| Test | What It Verifies |
|---|---|
| OAuth URL generated correctly | Correct scopes, redirect URI, state parameter |
| OAuth callback stores encrypted tokens | `access_token` and `refresh_token` encrypted in DB |
| Token refresh before expiry | Proactive refresh when `token_expires_at < now + 1h` |
| Sync pulls customers | Mock QuickBooks API -> customers mapped to unified model |
| Sync pulls invoices | Mock QuickBooks API -> invoices mapped to unified model |
| Write-back creates invoice in external system | Mock QuickBooks API -> invoice created with correct field mapping |
| Sync handles API errors | QuickBooks returns 500 -> error logged, retry queued |
| External ID mapping preserved | `external_ids.quickbooks` = correct external ID |
| Disconnect removes tokens | Integration status set to `disconnected`, tokens nulled |

### 7.6 Copilot

```
message -> classify -> dispatch -> aggregate -> stream response
```

| Test | What It Verifies |
|---|---|
| Simple query classified correctly | "What's overdue?" -> `check-collections` intent |
| Agent dispatch for action intent | "Invoice the Henderson job" -> Invoice Agent dispatched |
| Multi-agent dispatch | "Henderson job is done" -> Invoice + Customer + Inventory + Bookkeeping |
| Partial agent failure handled | 3 of 4 agents complete -> response includes completed results + pending notice |
| SSE stream format correct | Events: `status`, `agent_result`, `token`, `done` in correct order |
| Conversation stored | Message and response saved in `messages` table |
| Context includes recent messages | Last 10 messages injected into LLM context |
| Business context included | Org settings, learned preferences in context |
| General question answered directly | "What's OSHA-10?" -> LLM answer, no agent dispatch |
| Workflow creation intent | "Build a workflow that..." -> workflow engine invoked |

### 7.7 Webhook Processing

| Test | What It Verifies |
|---|---|
| Valid Stripe signature accepted | `constructEvent` succeeds, webhook processed |
| Invalid Stripe signature rejected | 401 returned, webhook not processed |
| Valid QuickBooks HMAC accepted | HMAC matches, webhook processed |
| Invalid QuickBooks HMAC rejected | 401 returned |
| Async processing (200 returned immediately) | Response sent before webhook is fully processed |
| Webhook triggers correct agent | Stripe `payment_intent.succeeded` -> Collections Agent notified |
| Duplicate webhook deduplicated | Same `event_id` sent twice -> second ignored |
| Timestamp replay protection | Old timestamp (> 5 min) rejected |

### 7.8 Rate Limiting

| Test | What It Verifies |
|---|---|
| Under limit returns 200 | 9 of 10 auth requests succeed |
| At limit returns 429 | 11th auth request in same minute returns `RATE_LIMITED` |
| Correct headers returned | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` present |
| Tier-based copilot limits | Starter org limited to 10/min, Pro org allowed 30/min |
| Rate limit resets after window | Wait 60s, requests allowed again |

### 7.9 Row-Level Security

| Test | What It Verifies |
|---|---|
| RLS SELECT isolation | Org A's customer not visible to Org B via direct Supabase query |
| RLS INSERT enforced | Cannot insert customer with different `org_id` than JWT claim |
| RLS UPDATE enforced | Cannot update customer belonging to different org |
| RLS DELETE enforced | Cannot delete customer belonging to different org |
| Service role bypasses RLS | BullMQ worker with service role key can read any org's data |
| Worker always includes org_id WHERE | Repository layer enforces `WHERE org_id = $1` even with service role |

### 7.10 Pagination

| Test | What It Verifies |
|---|---|
| Cursor encoding is opaque | Cursor is base64, not raw SQL |
| Cursor decoding works | Pass `next_cursor` from page 1 -> page 2 returns correct records |
| Invalid cursor returns 400 | Tampered cursor -> `VALIDATION_ERROR` |
| Empty result set | No matching records -> `{ data: [], meta: { has_more: false } }` |
| Limit capped at 100 | `?limit=500` -> limit applied as 100 |
| Default limit is 25 | No `?limit` -> 25 records returned |
| Sort + filter + pagination combined | All three work together correctly |

---

## 8. Integration Test Patterns

### Testing QuickBooks Adapter with Recorded API Responses

Use recorded HTTP responses (fixtures) instead of calling the real QuickBooks API. This ensures deterministic, fast tests.

```typescript
// apps/api/src/integrations/adapters/__tests__/quickbooks.adapter.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuickBooksAdapter } from '../quickbooks.adapter';
import { createTestIntegration } from '../../../test/factories';

// Recorded API response fixtures
import customerListResponse from '../__fixtures__/qbo-customer-list.json';
import invoiceCreateResponse from '../__fixtures__/qbo-invoice-create.json';
import errorResponse from '../__fixtures__/qbo-error-401.json';

// Mock the HTTP client (axios or fetch)
const mockHttp = {
  get: vi.fn(),
  post: vi.fn(),
};

describe('QuickBooksAdapter', () => {
  let adapter: QuickBooksAdapter;
  let integration: Integration;

  beforeEach(() => {
    adapter = new QuickBooksAdapter(mockHttp as any);
    integration = createTestIntegration('org-123', { provider: 'quickbooks' });
  });

  describe('syncCustomers', () => {
    it('should map QuickBooks customers to unified Customer model', async () => {
      mockHttp.get.mockResolvedValue({ data: customerListResponse });

      const customers = await adapter.syncCustomers(integration);

      expect(customers).toHaveLength(3);
      expect(customers[0]).toMatchObject({
        name: expect.any(String),
        email: expect.any(String),
        external_ids: { quickbooks: expect.any(String) },
      });
    });

    it('should handle empty customer list', async () => {
      mockHttp.get.mockResolvedValue({
        data: { QueryResponse: { Customer: [] } },
      });

      const customers = await adapter.syncCustomers(integration);

      expect(customers).toHaveLength(0);
    });

    it('should throw on expired token', async () => {
      mockHttp.get.mockRejectedValue({
        response: { status: 401, data: errorResponse },
      });

      await expect(adapter.syncCustomers(integration)).rejects.toThrow('Token expired');
    });
  });

  describe('createInvoice (write-back)', () => {
    it('should map unified Invoice to QuickBooks Invoice and create it', async () => {
      mockHttp.post.mockResolvedValue({ data: invoiceCreateResponse });

      const invoice = createTestInvoice('org-123', 'job-1', 'cust-1');
      const externalId = await adapter.createInvoice(integration, invoice);

      expect(externalId).toBe('12345');
      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.stringContaining('/v3/company/qbo_realm_12345/invoice'),
        expect.objectContaining({
          Line: expect.any(Array),
          CustomerRef: expect.any(Object),
        }),
        expect.any(Object),
      );
    });
  });

  describe('verifyWebhook', () => {
    it('should verify valid HMAC signature', () => {
      const payload = Buffer.from(JSON.stringify({ eventNotifications: [] }));
      // Generate a valid signature for test
      const crypto = require('crypto');
      const signature = crypto
        .createHmac('sha256', 'test-webhook-secret')
        .update(payload)
        .digest('base64');

      const result = adapter.verifyWebhook(payload, signature);

      expect(result).toBe(true);
    });

    it('should reject invalid signature', () => {
      const payload = Buffer.from('{"test": true}');
      const result = adapter.verifyWebhook(payload, 'invalid-signature');

      expect(result).toBe(false);
    });
  });
});
```

### Recording API Responses

When building a new adapter, record real API responses once and save them as JSON fixtures:

```
apps/api/src/integrations/adapters/__fixtures__/
  qbo-customer-list.json          # QuickBooks customer list response
  qbo-invoice-create.json         # QuickBooks invoice creation response
  qbo-invoice-update.json         # QuickBooks invoice update response
  qbo-error-401.json              # QuickBooks expired token error
  qbo-error-500.json              # QuickBooks server error
  stripe-payment-intent.json      # Stripe payment intent webhook
  stripe-webhook-event.json       # Stripe webhook event payload
  jobber-job-list.json            # Jobber job list response
```

**Important:** Strip any real customer data from recorded responses before committing. Replace with fictional data that preserves the same structure and field types.

---

## 9. E2E Test Scenario

The end-to-end test covers the full lifecycle from signup to invoice generation to QuickBooks sync. This is the most important test in the suite -- if this passes, the core product works.

```typescript
// apps/api/src/__tests__/e2e/full-lifecycle.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { setupTestDatabase, teardownTestDatabase } from '../../test/setup';

describe('E2E: Full Lifecycle', () => {
  let app: FastifyInstance;
  let db: Database;
  let authToken: string;
  let orgId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    app = await buildApp({ db, aiClient: new MockAIClient() });
  });

  afterAll(async () => {
    await app.close();
    await teardownTestDatabase();
  });

  it('should complete the full contractor lifecycle', async () => {
    // ===== Step 1: Signup =====
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: {
        email: 'owner@acmehvac.com',
        password: 'SecureP@ss123',
        org_name: 'Acme HVAC',
        trade_type: 'hvac',
      },
    });
    expect(signupRes.statusCode).toBe(201);
    authToken = signupRes.json().data.access_token;
    orgId = signupRes.json().data.org.id;

    // ===== Step 2: Connect QuickBooks (mock OAuth) =====
    const connectRes = await app.inject({
      method: 'GET',
      url: '/api/integrations/quickbooks/connect',
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(connectRes.statusCode).toBe(200);

    // Simulate OAuth callback
    const callbackRes = await app.inject({
      method: 'GET',
      url: `/api/integrations/quickbooks/callback?code=mock_auth_code&state=${orgId}`,
    });
    expect(callbackRes.statusCode).toBe(200);

    // ===== Step 3: Create a customer =====
    const customerRes = await app.inject({
      method: 'POST',
      url: '/api/customers',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        name: 'Robert Henderson',
        email: 'henderson@example.com',
        phone: '+15559876543',
        address: { street: '1234 Oak Lane', city: 'Dallas', state: 'TX', zip: '75201' },
      },
    });
    expect(customerRes.statusCode).toBe(201);
    const customerId = customerRes.json().data.id;

    // ===== Step 4: Create and complete a job =====
    const jobRes = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        customer_id: customerId,
        type: 'service_call',
        description: 'AC not cooling - compressor replacement',
        line_items: [
          { description: 'Compressor replacement', quantity: 1, unit_price: 850.0, total: 850.0 },
          { description: 'R-410A Refrigerant', quantity: 3, unit_price: 45.0, total: 135.0 },
          { description: 'Labor', quantity: 4, unit_price: 125.0, total: 500.0 },
        ],
        total_amount: 1485.0,
      },
    });
    expect(jobRes.statusCode).toBe(201);
    const jobId = jobRes.json().data.id;

    // Mark job complete -> triggers agent chain
    const completeRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/complete`,
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(completeRes.statusCode).toBe(200);

    // ===== Step 5: Wait for agent execution (in test, process queue synchronously) =====
    await processAllQueuedJobs();

    // ===== Step 6: Verify invoice was generated =====
    const invoicesRes = await app.inject({
      method: 'GET',
      url: `/api/invoices?job_id=${jobId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(invoicesRes.statusCode).toBe(200);
    const invoices = invoicesRes.json().data;
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe('draft'); // Review queue for first run
    expect(invoices[0].total).toBeGreaterThan(0);
    expect(invoices[0].generated_by).toBe('agent');

    // ===== Step 7: Verify PDF was generated =====
    expect(invoices[0].pdf_url).toBeTruthy();

    // ===== Step 8: Verify QuickBooks sync =====
    const invoice = invoices[0];
    expect(invoice.external_ids.quickbooks).toBeTruthy();

    // ===== Step 9: Verify agent execution was logged =====
    const executionsRes = await app.inject({
      method: 'GET',
      url: '/api/agents/invoice/executions',
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(executionsRes.statusCode).toBe(200);
    const executions = executionsRes.json().data;
    expect(executions).toHaveLength(1);
    expect(executions[0].agent_type).toBe('invoice');
    expect(executions[0].status).toMatch(/completed|awaiting_review/);
    expect(executions[0].duration_ms).toBeGreaterThan(0);

    // ===== Step 10: Verify agent chaining =====
    // Collections agent should have been triggered by invoice.created
    const collectionsExec = await app.inject({
      method: 'GET',
      url: '/api/agents/collections/executions',
      headers: { authorization: `Bearer ${authToken}` },
    });
    expect(collectionsExec.json().data.length).toBeGreaterThanOrEqual(1);
  });
});
```

---

## 10. CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml

name: Test Suite

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]

concurrency:
  group: test-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # ========== Node API Tests ==========
  node-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    services:
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      postgres:
        image: supabase/postgres:15.1.0.147
        env:
          POSTGRES_DB: postgres
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        ports:
          - 54322:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
          cache-dependency-path: apps/api/package-lock.json

      - name: Install dependencies
        run: npm ci
        working-directory: apps/api

      - name: Run migrations
        env:
          TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:54322/postgres
        run: npx drizzle-kit push:pg
        working-directory: apps/api

      - name: Run unit tests
        env:
          NODE_ENV: test
          TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:54322/postgres
          REDIS_URL: redis://localhost:6379
        run: npx vitest run --reporter=verbose --coverage
        working-directory: apps/api

      - name: Run integration tests
        env:
          NODE_ENV: test
          TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:54322/postgres
          REDIS_URL: redis://localhost:6379
        run: npx vitest run --config vitest.integration.config.ts --reporter=verbose
        working-directory: apps/api

      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: node-coverage
          path: apps/api/coverage/

  # ========== Python AI Service Tests ==========
  python-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'
          cache-dependency-path: apps/ai-service/requirements.txt

      - name: Install dependencies
        run: pip install -r requirements.txt -r requirements-dev.txt
        working-directory: apps/ai-service

      - name: Run unit tests
        env:
          TESTING: 'true'
        run: pytest tests/unit/ -v --tb=short --cov=app --cov-report=xml
        working-directory: apps/ai-service

      - name: Run integration tests
        env:
          TESTING: 'true'
        run: pytest tests/integration/ -v --tb=short
        working-directory: apps/ai-service

      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: python-coverage
          path: apps/ai-service/coverage.xml

  # ========== E2E Agent Tests ==========
  e2e-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    needs: [node-tests, python-tests]

    services:
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379

      postgres:
        image: supabase/postgres:15.1.0.147
        env:
          POSTGRES_DB: postgres
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        ports:
          - 54322:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install API dependencies
        run: npm ci
        working-directory: apps/api

      - name: Run migrations
        env:
          TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:54322/postgres
        run: npx drizzle-kit push:pg
        working-directory: apps/api

      - name: Run E2E agent tests
        env:
          NODE_ENV: test
          TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:54322/postgres
          REDIS_URL: redis://localhost:6379
        run: npx vitest run --config vitest.e2e.config.ts --reporter=verbose
        working-directory: apps/api
```

### Parallel Execution

The three test jobs run in parallel where possible:
- `node-tests` and `python-tests` run simultaneously (no dependencies)
- `e2e-tests` runs after both pass (depends on both)

This keeps total CI time under 20 minutes even with a comprehensive test suite.

---

## 11. Coverage Requirements

| Area | Minimum Coverage | Rationale |
|---|---|---|
| **Services** (`src/services/`) | 80% line coverage | Business logic is the most critical code. 80% is pragmatic -- 100% often leads to testing implementation details. |
| **Agent runtime** (`src/agents/runtime.ts`, `registry.ts`, `chain.ts`) | 90% line coverage | The agent runtime is the core product. A bug here means wrong invoices or missed collections. 90% minimum, aim for 95%. |
| **Agent definitions** (`src/agents/definitions/`) | 85% line coverage | Each agent's trigger/validation/autonomy logic must be thoroughly tested. |
| **Integration adapters** (`src/integrations/adapters/`) | 75% line coverage | Adapter code is mostly mapping -- test the mapping logic and error handling, not every getter. |
| **Middleware** (`src/middleware/`) | 85% line coverage | Auth, RBAC, and rate limiting are security-critical. |
| **Utilities** (`src/utils/`) | 90% line coverage | Pagination, response builders, validators are shared by everything. |
| **Python providers** (`app/providers/`) | 80% line coverage | Provider routing and fallback logic must be reliable. |
| **Python prompts** (`app/prompts/`) | 70% line coverage | Prompt templates are mostly strings. Test the rendering with variable substitution. |

### Enforcing Coverage

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 70,
        statements: 80,
      },
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.integration.test.ts',
        'src/test/**',
        'src/**/__mocks__/**',
        'src/**/__fixtures__/**',
      ],
    },
  },
});
```

```ini
# apps/ai-service/pyproject.toml
[tool.pytest.ini_options]
addopts = "--cov=app --cov-fail-under=80"
```

---

## 12. Test Naming Convention

All tests follow a consistent naming pattern that makes it immediately clear what is being tested, what condition triggers it, and what the expected outcome is.

### Pattern

```
describe('ComponentName') -> it('should [verb] when [condition]')
```

### Examples

```typescript
describe('InvoiceAgent', () => {
  describe('trigger', () => {
    it('should activate when job.completed event fires', async () => { ... });
    it('should not activate when job status is cancelled', async () => { ... });
    it('should activate when copilot classifies create-invoice intent', async () => { ... });
  });

  describe('execution', () => {
    it('should generate line items from job data', async () => { ... });
    it('should calculate tax based on org settings', async () => { ... });
    it('should auto-execute when total < $500 and confidence > 0.9', async () => { ... });
    it('should route to review queue when total >= $500', async () => { ... });
    it('should escalate when confidence < 0.6', async () => { ... });
  });

  describe('validation', () => {
    it('should reject invoice with zero line items', async () => { ... });
    it('should reject invoice where subtotal does not match line items sum', async () => { ... });
    it('should reject invoice exceeding 150% of job amount', async () => { ... });
  });

  describe('chaining', () => {
    it('should emit invoice.created event after successful execution', async () => { ... });
    it('should trigger collections and bookkeeping agents via chain', async () => { ... });
    it('should not chain when execution is routed to review', async () => { ... });
  });
});

describe('AuthMiddleware', () => {
  it('should return 401 when Authorization header is missing', async () => { ... });
  it('should return 401 when token is expired', async () => { ... });
  it('should extract org_id from JWT custom claims', async () => { ... });
  it('should set request.userId from JWT sub claim', async () => { ... });
});

describe('CursorPagination', () => {
  it('should encode cursor as base64 string', () => { ... });
  it('should decode valid cursor back to original values', () => { ... });
  it('should throw VALIDATION_ERROR for tampered cursor', () => { ... });
  it('should return has_more=false on last page', () => { ... });
});
```

### Python Tests

```python
class TestMockProvider:
    async def test_reason_returns_invoice_response_when_system_contains_invoice(self):
        ...

    async def test_classify_returns_create_invoice_for_invoice_keyword(self):
        ...

    async def test_classify_returns_general_question_for_unknown_text(self):
        ...


class TestProviderRouter:
    async def test_falls_back_to_secondary_provider_on_primary_failure(self):
        ...

    async def test_logs_provider_used_and_latency(self):
        ...
```

---

## 13. Test Configuration Files

### Vitest Config (Unit Tests)

```typescript
// apps/api/vitest.config.ts

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'src/__tests__/e2e/**'],
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 10000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test/**', 'src/**/__mocks__/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### Vitest Config (Integration Tests)

```typescript
// apps/api/vitest.integration.config.ts

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['./src/test/setup-integration.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks', // Isolate integration tests in separate processes
    poolOptions: {
      forks: {
        singleFork: true, // Run sequentially to avoid DB conflicts
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### Vitest Config (E2E Tests)

```typescript
// apps/api/vitest.e2e.config.ts

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/e2e/**/*.test.ts'],
    setupFiles: ['./src/test/setup-e2e.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### pytest Configuration

```ini
# apps/ai-service/pyproject.toml

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
addopts = "-v --tb=short --strict-markers"
markers = [
    "unit: Unit tests (no external dependencies)",
    "integration: Integration tests (requires running service)",
    "slow: Tests that take more than 5 seconds",
]

[tool.coverage.run]
source = ["app"]
omit = ["app/providers/mock.py", "tests/*"]

[tool.coverage.report]
fail_under = 80
show_missing = true
```

---

## 14. Summary

| Principle | Implementation |
|---|---|
| Test business logic | Services, agents, and adapters tested directly |
| Mock externals | `MockProvider` (Python), `MockAIClient` (Node), recorded HTTP fixtures for integrations |
| Contract tests | AI client interface enforced on both mock and real implementations |
| Database isolation | Transaction rollback per test, fresh migrations per suite |
| Deterministic AI | Keyword-based classification, template-based reasoning responses |
| Comprehensive coverage | 10 categories of tests, 50+ specific test cases defined |
| Fast CI | Parallel job execution, under 20 minutes total |
| Clear naming | `describe/it` with `should [verb] when [condition]` pattern |

The testing strategy ensures that every agent, every integration, and every API route is verified before deployment. When a test fails, the developer knows exactly what broke and why -- no ambiguity, no flaky tests, no "it works on my machine."
