# 03 - API Routes

> **Permanent reference** for every API route in the CrewShift backend. Each route includes HTTP method, path, description, auth/role requirements, rate limit category, request/response schemas, and example JSON.
> Cross-references: [00-overview](./00-overview.md) | [01-project-structure](./01-project-structure.md) | [02-database-schema](./02-database-schema.md) | [04-api-standards](./04-api-standards.md)

---

## Conventions

- **Base URL:** `/api` prefix on all routes.
- **Auth:** All routes require a valid JWT in the `Authorization: Bearer <token>` header unless marked "Auth: No".
- **Roles:** `owner` > `admin` > `member` > `tech`. Higher roles inherit all permissions of lower roles.
- **Rate Limit Categories:** `auth` (10/min), `standard` (100/min), `copilot` (30/min), `webhook` (500/min).
- **Response Envelope:** All responses use the standard envelope defined in [04-api-standards](./04-api-standards.md).
- **Pagination:** All list endpoints support cursor-based pagination (`limit`, `cursor`, `sort`, `order`).
- **Agent Events:** Routes that trigger agent events are marked with a note.

---

## 1. Auth Routes

File: `routes/auth.routes.ts`

### POST /api/auth/signup

Create a new account and organization.

| Property | Value |
|---|---|
| Auth | No |
| Rate Limit | `auth` (10/min) |

**Request Body:**

```typescript
interface SignupRequest {
  email: string;           // User email
  password: string;        // Minimum 8 characters
  full_name: string;       // Display name
  org_name: string;        // Business name
  trade_type: string;      // 'hvac', 'plumbing', 'electrical', 'roofing', 'general', 'landscaping'
  size?: string;           // 'solo', '2-5', '6-15', '16-30', '30+'
}
```

**Response (201):**

```typescript
interface SignupResponse {
  data: {
    user: { id: string; email: string; full_name: string };
    organization: { id: string; name: string; trade_type: string; tier: string };
    session: { access_token: string; refresh_token: string; expires_at: number };
  };
}
```

**Example:**

```json
// Request
{
  "email": "mike@mikeshvac.com",
  "password": "securepass123",
  "full_name": "Mike Johnson",
  "org_name": "Mike's HVAC",
  "trade_type": "hvac",
  "size": "2-5"
}

// Response (201)
{
  "data": {
    "user": { "id": "uuid-user-1", "email": "mike@mikeshvac.com", "full_name": "Mike Johnson" },
    "organization": { "id": "uuid-org-1", "name": "Mike's HVAC", "trade_type": "hvac", "tier": "starter" },
    "session": { "access_token": "eyJ...", "refresh_token": "eyJ...", "expires_at": 1709510400 }
  }
}
```

---

### POST /api/auth/login

Authenticate an existing user.

| Property | Value |
|---|---|
| Auth | No |
| Rate Limit | `auth` (10/min) |

**Request Body:**

```typescript
interface LoginRequest {
  email: string;
  password: string;
}
```

**Response (200):**

```typescript
interface LoginResponse {
  data: {
    user: { id: string; email: string; full_name: string; role: string };
    organization: { id: string; name: string; trade_type: string; tier: string };
    session: { access_token: string; refresh_token: string; expires_at: number };
  };
}
```

---

### POST /api/auth/logout

End the current session.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `auth` (10/min) |

**Request Body:** None

**Response (200):**

```json
{ "data": { "message": "Logged out" } }
```

---

### POST /api/auth/refresh

Refresh an expired access token.

| Property | Value |
|---|---|
| Auth | No (uses refresh token) |
| Rate Limit | `auth` (10/min) |

**Request Body:**

```typescript
interface RefreshRequest {
  refresh_token: string;
}
```

**Response (200):**

```typescript
interface RefreshResponse {
  data: {
    session: { access_token: string; refresh_token: string; expires_at: number };
  };
}
```

---

### GET /api/auth/me

Get the current authenticated user and their organization.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` (100/min) |

**Response (200):**

```typescript
interface MeResponse {
  data: {
    user: { id: string; email: string; full_name: string; role: string; phone: string | null; avatar_url: string | null };
    organization: { id: string; name: string; trade_type: string; size: string | null; tier: string; onboarding_status: string; settings: object };
  };
}
```

---

## 2. Organization Routes

File: `routes/org.routes.ts`

### GET /api/org

Get the current organization's details.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):**

```typescript
interface OrgResponse {
  data: {
    id: string;
    name: string;
    trade_type: string;
    size: string | null;
    tier: string;
    onboarding_status: string;
    settings: object;
    created_at: string;
    updated_at: string;
  };
}
```

---

### PATCH /api/org

Update organization settings.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface UpdateOrgRequest {
  name?: string;
  trade_type?: string;
  size?: string;
  settings?: Partial<OrgSettings>;   // See JSONB schemas in 02-database-schema.md
}
```

**Response (200):** Updated organization object.

---

### GET /api/org/team

List all team members in the organization.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):**

```typescript
interface TeamListResponse {
  data: Array<{
    id: string;
    full_name: string;
    email: string;
    role: string;
    phone: string | null;
    avatar_url: string | null;
    created_at: string;
  }>;
}
```

---

### POST /api/org/team/invite

Invite a new team member.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface InviteRequest {
  email: string;
  role: 'admin' | 'member' | 'tech';
  full_name?: string;
}
```

**Response (201):**

```json
{ "data": { "message": "Invitation sent", "invite_id": "uuid-invite-1" } }
```

---

### PATCH /api/org/team/:userId

Update a team member's role.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface UpdateMemberRequest {
  role: 'admin' | 'member' | 'tech';
}
```

**Response (200):** Updated profile object.

---

### DELETE /api/org/team/:userId

Remove a team member from the organization.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin` |
| Rate Limit | `standard` |

**Response (200):**

```json
{ "data": { "message": "Member removed" } }
```

---

## 3. Integrations Routes

File: `routes/integrations.routes.ts`

### GET /api/integrations

List all connected (and available) integrations for the organization.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):**

```typescript
interface IntegrationsListResponse {
  data: Array<{
    id: string;
    provider: string;
    status: string;           // 'pending', 'connected', 'error', 'disconnected'
    external_account_id: string | null;
    last_sync_at: string | null;
    created_at: string;
  }>;
}
```

---

### GET /api/integrations/:provider/connect

Start the OAuth flow for a provider. Redirects the user to the provider's authorization page.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin` |
| Rate Limit | `standard` |

**Response:** HTTP 302 redirect to the provider's OAuth authorization URL.

---

### GET /api/integrations/:provider/callback

OAuth callback. Exchanges the authorization code for tokens and stores them.

| Property | Value |
|---|---|
| Auth | Yes (via state parameter) |
| Roles | `owner`, `admin` |
| Rate Limit | `standard` |

**Query Parameters:** `code`, `state` (provider-specific OAuth callback parameters).

**Response:** HTTP 302 redirect back to the dashboard with success/error status.

---

### POST /api/integrations/:provider/sync

Trigger a manual sync for a connected integration.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin` |
| Rate Limit | `standard` |

**Request Body:** None (or optional sync options).

**Response (202):**

```json
{ "data": { "message": "Sync started", "job_id": "uuid-job-1" } }
```

---

### DELETE /api/integrations/:provider

Disconnect an integration. Revokes tokens and removes the integration record.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin` |
| Rate Limit | `standard` |

**Response (200):**

```json
{ "data": { "message": "Integration disconnected" } }
```

---

## 4. Agents Routes

File: `routes/agents.routes.ts`

### GET /api/agents

List all agents and their status/config for the organization.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):**

```typescript
interface AgentsListResponse {
  data: Array<{
    agent_type: string;
    name: string;
    category: string;
    enabled: boolean;
    autonomy_rules: object;
    settings: object;
    recent_executions_count: number;
    last_execution_at: string | null;
  }>;
}
```

---

### GET /api/agents/:type

Get config for a specific agent.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):** Single agent config object (same shape as list item).

---

### PATCH /api/agents/:type

Update agent config (enable/disable, autonomy rules, settings).

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface UpdateAgentConfigRequest {
  enabled?: boolean;
  autonomy_rules?: Partial<AutonomyRulesConfig>;
  settings?: Record<string, any>;
}
```

**Response (200):** Updated agent config object.

---

### GET /api/agents/:type/executions

List execution history for a specific agent.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Query Parameters:** `limit`, `cursor`, `status` (filter by execution status).

**Response (200):**

```typescript
interface ExecutionsListResponse {
  data: Array<{
    id: string;
    agent_type: string;
    trigger_type: string;
    trigger_source: string | null;
    status: string;
    confidence_score: number | null;
    duration_ms: number | null;
    ai_model_used: string | null;
    created_at: string;
    completed_at: string | null;
  }>;
  meta: PaginationMeta;
}
```

---

### GET /api/agents/executions/:id

Get full detail for a single agent execution.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):**

```typescript
interface ExecutionDetailResponse {
  data: {
    id: string;
    agent_type: string;
    trigger_type: string;
    trigger_source: string | null;
    status: string;
    input_data: object | null;
    output_data: object | null;
    actions_taken: Array<{ type: string; target: string; data: any; timestamp: string }>;
    confidence_score: number | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    error: string | null;
    duration_ms: number | null;
    ai_model_used: string | null;
    ai_tokens_used: number | null;
    ai_cost_cents: number | null;
    created_at: string;
    completed_at: string | null;
  };
}
```

---

### POST /api/agents/executions/:id/approve

Approve a pending agent action in the review queue.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface ApproveRequest {
  modifications?: Record<string, any>;   // Optional: modify the output before approving
}
```

**Response (200):**

```json
{ "data": { "message": "Execution approved", "execution_id": "uuid-exec-1" } }
```

**Note:** This triggers the remaining execution steps (create record, sync to external tool, etc.).

---

### POST /api/agents/executions/:id/reject

Reject a pending agent action.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface RejectRequest {
  reason?: string;                       // Optional feedback for improving the agent
}
```

**Response (200):**

```json
{ "data": { "message": "Execution rejected", "execution_id": "uuid-exec-1" } }
```

---

### GET /api/agents/review-queue

Get all agent executions awaiting review.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Query Parameters:** `limit`, `cursor`, `agent_type` (optional filter).

**Response (200):**

```typescript
interface ReviewQueueResponse {
  data: Array<{
    id: string;
    agent_type: string;
    trigger_type: string;
    output_data: object;
    confidence_score: number | null;
    created_at: string;
  }>;
  meta: PaginationMeta;
}
```

---

## 5. Copilot Routes

File: `routes/copilot.routes.ts`

### POST /api/copilot/message

Send a message to the AI copilot. Returns a streaming SSE response.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `copilot` (30/min) |

**Request Body:**

```typescript
interface CopilotMessageRequest {
  message: string;                       // User's text message
  conversation_id?: string;              // Existing conversation ID (null = new conversation)
}
```

**Response (200, SSE stream):**

The response is a Server-Sent Events stream. The final assembled response has this shape:

```typescript
interface CopilotResponse {
  data: {
    conversation_id: string;
    message_id: string;
    message: string;                     // The copilot's text response
    agents_dispatched?: string[];        // Which agents were triggered (e.g., ['invoice', 'customer'])
    execution_ids?: string[];            // References to agent_executions for traceability
    actions_taken?: Array<{
      type: string;                      // 'created_invoice', 'sent_message', etc.
      description: string;               // Human-readable description
      result: any;                       // Action-specific result data
    }>;
    follow_up_suggestions?: string[];    // Suggested follow-up questions
  };
}
```

**Example:**

```json
// Request
{
  "message": "The Henderson job is done. Mike finished around 3pm. Materials were 200 feet of copper pipe and 4 elbows.",
  "conversation_id": "uuid-conv-1"
}

// Response (assembled from SSE stream)
{
  "data": {
    "conversation_id": "uuid-conv-1",
    "message_id": "uuid-msg-2",
    "message": "Invoice #1247 generated for $1,840 and sent to QuickBooks. Henderson will get a completion notification now and a review request tomorrow.",
    "agents_dispatched": ["invoice", "inventory", "customer", "bookkeeping"],
    "execution_ids": ["uuid-exec-1", "uuid-exec-2", "uuid-exec-3", "uuid-exec-4"],
    "actions_taken": [
      { "type": "created_invoice", "description": "Generated invoice #1247 for $1,840", "result": { "invoice_id": "uuid-inv-1" } },
      { "type": "deducted_inventory", "description": "Deducted 200ft copper pipe + 4 elbows", "result": {} },
      { "type": "sent_notification", "description": "Completion message sent to Henderson", "result": {} },
      { "type": "queued_review_request", "description": "Review request scheduled for tomorrow", "result": {} }
    ],
    "follow_up_suggestions": ["Show me the invoice details", "What's Henderson's payment history?", "What's our copper pipe stock?"]
  }
}
```

**Agent Events:** This route triggers intent classification and dispatches to one or more agents based on the classified intent.

---

### GET /api/copilot/conversations

List the current user's conversations.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Query Parameters:** `limit`, `cursor`.

**Response (200):**

```typescript
interface ConversationsListResponse {
  data: Array<{
    id: string;
    title: string | null;
    summary: string | null;
    updated_at: string;
    created_at: string;
  }>;
  meta: PaginationMeta;
}
```

---

### GET /api/copilot/conversations/:id

Get full conversation history with messages.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):**

```typescript
interface ConversationDetailResponse {
  data: {
    id: string;
    title: string | null;
    messages: Array<{
      id: string;
      role: string;
      content: string;
      intent: string | null;
      agents_dispatched: string[] | null;
      created_at: string;
    }>;
  };
}
```

---

### POST /api/copilot/transcribe

Transcribe voice input to text (optional feature).

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `copilot` (30/min) |

**Request Body:** `multipart/form-data` with `audio` file field.

**Response (200):**

```json
{ "data": { "transcript": "The Henderson job is done. Mike finished around 3pm." } }
```

---

## 6. Jobs Routes

File: `routes/jobs.routes.ts`

### GET /api/jobs

List jobs with pagination and filtering.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any (tech = read-only) |
| Rate Limit | `standard` |

**Query Parameters:** `limit`, `cursor`, `sort`, `order`, `status`, `customer_id`, `assigned_tech_id`, `type`, `search`, `scheduled_start_after`, `scheduled_start_before`.

**Response (200):**

```typescript
interface JobsListResponse {
  data: Array<{
    id: string;
    customer_id: string | null;
    customer_name: string | null;
    status: string;
    type: string | null;
    description: string | null;
    scheduled_start: string | null;
    assigned_tech_id: string | null;
    assigned_tech_name: string | null;
    total_amount: number | null;
    created_at: string;
  }>;
  meta: PaginationMeta;
}
```

---

### GET /api/jobs/:id

Get full job detail.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):** Complete job object with all fields.

---

### POST /api/jobs

Create a new job.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface CreateJobRequest {
  customer_id?: string;
  status?: string;
  type?: string;
  description?: string;
  scheduled_start?: string;               // ISO 8601 datetime
  scheduled_end?: string;
  assigned_tech_id?: string;
  address?: Address;
  line_items?: LineItem[];
  materials?: MaterialUsed[];
  labor_hours?: number;
  total_amount?: number;
  notes?: string;
}
```

**Response (201):** Created job object.

---

### PATCH /api/jobs/:id

Update a job.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Request Body:** Partial `CreateJobRequest` (any subset of fields).

**Response (200):** Updated job object.

---

### POST /api/jobs/:id/complete

Mark a job as completed. This fires the `job.completed` event on the event bus.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface CompleteJobRequest {
  actual_end?: string;                    // ISO 8601 datetime (defaults to now)
  labor_hours?: number;
  materials?: MaterialUsed[];
  total_amount?: number;
  notes?: string;
  photos?: string[];                      // S3/R2 URLs
}
```

**Response (200):** Updated job object with status `'completed'`.

**Agent Events:** Fires `job.completed` event which triggers Invoice Agent, Customer Agent, Inventory Agent, and Bookkeeping Agent.

---

## 7. Invoices Routes

File: `routes/invoices.routes.ts`

### GET /api/invoices

List invoices with pagination and filtering.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any (tech = read-only) |
| Rate Limit | `standard` |

**Query Parameters:** `limit`, `cursor`, `sort`, `order`, `status`, `customer_id`, `job_id`, `search`, `due_date_before`, `due_date_after`.

**Response (200):** Paginated list of invoice summary objects.

---

### GET /api/invoices/:id

Get full invoice detail.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):** Complete invoice object with all fields.

---

### POST /api/invoices

Create a new invoice. Can optionally trigger the Invoice Agent.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface CreateInvoiceRequest {
  job_id?: string;
  customer_id?: string;
  line_items: LineItem[];
  tax_rate?: number;
  due_date?: string;                      // ISO 8601 date
  notes?: string;
  generated_by?: 'manual' | 'agent';     // If 'agent', triggers Invoice Agent for AI generation
}
```

**Response (201):** Created invoice object.

**Agent Events:** If `generated_by` is `'agent'`, fires event to trigger Invoice Agent.

---

### PATCH /api/invoices/:id

Update an invoice.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Request Body:** Partial invoice fields.

**Response (200):** Updated invoice object.

---

### POST /api/invoices/:id/send

Send the invoice to the customer via email.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface SendInvoiceRequest {
  email?: string;                         // Override customer email
  message?: string;                       // Custom email message
}
```

**Response (200):**

```json
{ "data": { "message": "Invoice sent", "sent_at": "2026-03-04T10:30:00Z" } }
```

**Agent Events:** Fires `invoice.sent` event which can trigger Customer Agent.

---

### GET /api/invoices/:id/pdf

Download the invoice PDF.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):** Redirect to the S3/R2 presigned URL for the PDF, or generates the PDF on demand if not cached.

---

## 8. Estimates Routes

File: `routes/estimates.routes.ts`

### GET /api/estimates

List estimates with pagination and filtering.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any (tech = read-only) |
| Rate Limit | `standard` |

**Query Parameters:** `limit`, `cursor`, `sort`, `order`, `status`, `customer_id`, `type`, `search`.

**Response (200):** Paginated list of estimate summary objects.

---

### GET /api/estimates/:id

Get full estimate detail.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):** Complete estimate object with all fields.

---

### POST /api/estimates

Create a new estimate. Can optionally trigger the Estimate Agent.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface CreateEstimateRequest {
  customer_id?: string;
  type?: 'estimate' | 'proposal' | 'change_order';
  line_items: LineItem[];
  tax_amount?: number;
  valid_until?: string;                   // ISO 8601 date
  scope_description?: string;
  photos?: string[];                      // S3/R2 URLs
  notes?: string;
  generated_by?: 'manual' | 'agent';     // If 'agent', triggers Estimate Agent
}
```

**Response (201):** Created estimate object.

**Agent Events:** If `generated_by` is `'agent'`, fires event to trigger Estimate Agent.

---

### PATCH /api/estimates/:id

Update an estimate.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Response (200):** Updated estimate object.

---

### POST /api/estimates/:id/send

Send the estimate to the customer.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface SendEstimateRequest {
  email?: string;
  message?: string;
}
```

**Response (200):**

```json
{ "data": { "message": "Estimate sent", "sent_at": "2026-03-04T10:30:00Z" } }
```

---

## 9. Customers Routes

File: `routes/customers.routes.ts`

### GET /api/customers

List customers with pagination and filtering.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any (tech = read-only) |
| Rate Limit | `standard` |

**Query Parameters:** `limit`, `cursor`, `sort`, `order`, `search`, `tags` (comma-separated).

**Response (200):** Paginated list of customer summary objects.

---

### GET /api/customers/:id

Get customer detail with full history (jobs, invoices, estimates).

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):**

```typescript
interface CustomerDetailResponse {
  data: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: Address | null;
    tags: string[];
    notes: string | null;
    payment_score: number | null;
    lifetime_value: number | null;
    created_at: string;
    recent_jobs: Array<{ id: string; status: string; type: string; total_amount: number; created_at: string }>;
    recent_invoices: Array<{ id: string; status: string; total: number; due_date: string; created_at: string }>;
    recent_estimates: Array<{ id: string; status: string; total: number; created_at: string }>;
  };
}
```

---

### POST /api/customers

Create a new customer.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface CreateCustomerRequest {
  name: string;
  email?: string;
  phone?: string;
  address?: Address;
  tags?: string[];
  notes?: string;
}
```

**Response (201):** Created customer object.

---

### PATCH /api/customers/:id

Update a customer.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Response (200):** Updated customer object.

---

## 10. Inventory Routes

File: `routes/inventory.routes.ts`

### GET /api/inventory

List parts with pagination and filtering.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any (tech = read-only) |
| Rate Limit | `standard` |

**Query Parameters:** `limit`, `cursor`, `sort`, `order`, `category`, `search`.

**Response (200):** Paginated list of part objects.

---

### GET /api/inventory/:id

Get part detail.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):** Complete part object.

---

### POST /api/inventory

Add a new part.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface CreatePartRequest {
  name: string;
  sku?: string;
  category?: string;
  quantity_on_hand?: number;
  reorder_point?: number;
  unit_cost?: number;
  preferred_supplier?: string;
  supplier_data?: SupplierEntry[];
}
```

**Response (201):** Created part object.

---

### PATCH /api/inventory/:id

Update a part.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Response (200):** Updated part object.

---

### GET /api/inventory/low-stock

Get all parts below their reorder point.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):**

```typescript
interface LowStockResponse {
  data: Array<{
    id: string;
    name: string;
    sku: string | null;
    quantity_on_hand: number;
    reorder_point: number;
    preferred_supplier: string | null;
  }>;
}
```

---

## 11. Dashboard Routes

File: `routes/dashboard.routes.ts`

### GET /api/dashboard/summary

Key business metrics.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):**

```typescript
interface DashboardSummaryResponse {
  data: {
    revenue_this_month: number;
    revenue_last_month: number;
    revenue_change_pct: number;
    jobs_completed_this_month: number;
    jobs_in_progress: number;
    outstanding_invoices_count: number;
    outstanding_invoices_total: number;
    overdue_invoices_count: number;
    overdue_invoices_total: number;
    avg_job_margin: number;
  };
}
```

---

### GET /api/dashboard/agent-activity

Recent agent actions.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Query Parameters:** `limit` (default 20), `agent_type` (optional filter).

**Response (200):**

```typescript
interface AgentActivityResponse {
  data: Array<{
    id: string;
    agent_type: string;
    agent_name: string;
    status: string;
    summary: string;                     // Human-readable summary of what the agent did
    created_at: string;
  }>;
}
```

---

### GET /api/dashboard/insights

AI-generated business insights.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):**

```typescript
interface InsightsResponse {
  data: Array<{
    id: string;
    type: 'warning' | 'opportunity' | 'info';
    title: string;
    body: string;
    action_url: string | null;
    generated_at: string;
  }>;
}
```

---

### GET /api/dashboard/financials

Revenue, margins, and collections breakdown.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Query Parameters:** `period` ('week', 'month', 'quarter', 'year').

**Response (200):**

```typescript
interface FinancialsResponse {
  data: {
    total_revenue: number;
    total_expenses: number;
    gross_margin: number;
    gross_margin_pct: number;
    revenue_by_job_type: Record<string, number>;
    revenue_by_tech: Array<{ tech_id: string; tech_name: string; revenue: number }>;
    collections: {
      collected: number;
      outstanding: number;
      overdue: number;
    };
  };
}
```

---

## 12. Workflows Routes

File: `routes/workflows.routes.ts`

### GET /api/workflows

List custom workflows.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):** Paginated list of workflow objects.

---

### POST /api/workflows

Create a custom workflow.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface CreateWorkflowRequest {
  name: string;
  description?: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  enabled?: boolean;
}
```

**Response (201):** Created workflow object.

---

### PATCH /api/workflows/:id

Update a workflow.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Response (200):** Updated workflow object.

---

### DELETE /api/workflows/:id

Delete a workflow.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Response (200):**

```json
{ "data": { "message": "Workflow deleted" } }
```

---

## 13. Webhooks Routes

File: `routes/webhooks.routes.ts`

All webhook routes use signature verification instead of JWT auth. They are rate-limited at the `webhook` tier (500/min).

### POST /api/webhooks/quickbooks

QuickBooks webhook handler.

| Property | Value |
|---|---|
| Auth | No (signature verification) |
| Rate Limit | `webhook` (500/min) |

**Request Body:** QuickBooks webhook payload (provider-specific format).

**Response (200):**

```json
{ "data": { "received": true } }
```

**Agent Events:** Dispatches relevant events to the event bus based on the webhook type (invoice updated, payment received, customer changed, etc.).

---

### POST /api/webhooks/stripe

Stripe webhook handler.

| Property | Value |
|---|---|
| Auth | No (Stripe signature verification) |
| Rate Limit | `webhook` |

**Agent Events:** `payment_intent.succeeded` fires events for Collections Agent (payment received) and Bookkeeping Agent.

---

### POST /api/webhooks/jobber

Jobber webhook handler.

| Property | Value |
|---|---|
| Auth | No (signature verification) |
| Rate Limit | `webhook` |

---

### POST /api/webhooks/:provider

Generic webhook handler for any provider.

| Property | Value |
|---|---|
| Auth | No (signature verification) |
| Rate Limit | `webhook` |

---

## 14. Onboarding Routes

File: `routes/onboarding.routes.ts`

### GET /api/onboarding/status

Get the current onboarding state.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):**

```typescript
interface OnboardingStatusResponse {
  data: {
    status: 'not_started' | 'in_progress' | 'completed' | 'skipped';
    steps: Array<{
      id: string;                        // 'connect_first_tool', 'try_first_agent', 'explore_dashboard', etc.
      name: string;
      completed: boolean;
      completed_at: string | null;
    }>;
    current_step: string | null;
  };
}
```

---

### POST /api/onboarding/complete-step

Mark an onboarding step as complete.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface CompleteStepRequest {
  step_id: string;                       // e.g., 'connect_first_tool'
}
```

**Response (200):** Updated onboarding status.

---

### POST /api/onboarding/skip

Skip the onboarding flow entirely.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin` |
| Rate Limit | `standard` |

**Response (200):**

```json
{ "data": { "message": "Onboarding skipped", "status": "skipped" } }
```

---

## 15. Upload Routes

File: `routes/upload.routes.ts`

### POST /api/upload/presign

Generate a presigned S3/R2 upload URL. The client uploads directly to S3 using this URL.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface PresignRequest {
  filename: string;                      // Original filename
  content_type: string;                  // MIME type (e.g., 'image/jpeg', 'application/pdf')
  purpose: 'job_photo' | 'estimate_photo' | 'receipt' | 'document';
}
```

**Response (200):**

```typescript
interface PresignResponse {
  data: {
    upload_url: string;                  // Presigned PUT URL (valid for 15 minutes)
    file_key: string;                    // S3 key to reference after upload
    expires_at: string;                  // When the presigned URL expires
  };
}
```

---

### POST /api/upload/confirm

Confirm an upload completed and associate the file with a record.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin`, `member` |
| Rate Limit | `standard` |

**Request Body:**

```typescript
interface ConfirmUploadRequest {
  file_key: string;                      // S3 key from presign response
  entity_type: 'job' | 'estimate' | 'invoice' | 'customer';
  entity_id: string;                     // UUID of the record to associate with
}
```

**Response (200):**

```json
{ "data": { "message": "Upload confirmed", "url": "https://cdn.crewshift.com/files/..." } }
```

---

## 16. Usage Routes

File: `routes/notifications.routes.ts` (grouped with notifications)

### GET /api/dashboard/usage

Current month usage, tier limits, and cost breakdown.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | `owner`, `admin` |
| Rate Limit | `standard` |

**Response (200):**

```typescript
interface UsageResponse {
  data: {
    period: string;                      // '2026-03'
    tier: string;                        // 'pro'
    agents: {
      active: number;                    // Currently enabled agents
      limit: number;                     // Max agents for tier (4 for starter, 9 for pro+)
    };
    executions: {
      count: number;                     // Agent executions this month
      ai_tokens_used: number;
      estimated_cost_cents: number;
    };
    integrations: {
      connected: number;
      limit: number | null;              // null = unlimited
    };
    copilot: {
      messages_sent: number;
    };
  };
}
```

---

## 17. Notifications Routes

File: `routes/notifications.routes.ts`

### GET /api/notifications

List notifications for the current user.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Query Parameters:** `limit`, `cursor`, `unread_only` (boolean).

**Response (200):**

```typescript
interface NotificationsListResponse {
  data: Array<{
    id: string;
    type: string;
    title: string;
    body: string | null;
    channel: string;
    read: boolean;
    action_url: string | null;
    created_at: string;
  }>;
  meta: PaginationMeta;
}
```

---

### PATCH /api/notifications/:id/read

Mark a notification as read.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):**

```json
{ "data": { "message": "Notification marked as read" } }
```

---

### POST /api/notifications/read-all

Mark all notifications as read for the current user.

| Property | Value |
|---|---|
| Auth | Yes |
| Roles | Any |
| Rate Limit | `standard` |

**Response (200):**

```json
{ "data": { "message": "All notifications marked as read", "count": 12 } }
```

---

## 18. Route Summary Table

| Group | Method | Path | Auth | Roles | Rate Limit | Agent Event |
|---|---|---|---|---|---|---|
| **Auth** | POST | `/api/auth/signup` | No | -- | auth | |
| | POST | `/api/auth/login` | No | -- | auth | |
| | POST | `/api/auth/logout` | Yes | Any | auth | |
| | POST | `/api/auth/refresh` | No | -- | auth | |
| | GET | `/api/auth/me` | Yes | Any | standard | |
| **Org** | GET | `/api/org` | Yes | Any | standard | |
| | PATCH | `/api/org` | Yes | owner, admin | standard | |
| | GET | `/api/org/team` | Yes | Any | standard | |
| | POST | `/api/org/team/invite` | Yes | owner, admin | standard | |
| | PATCH | `/api/org/team/:userId` | Yes | owner, admin | standard | |
| | DELETE | `/api/org/team/:userId` | Yes | owner, admin | standard | |
| **Integrations** | GET | `/api/integrations` | Yes | Any | standard | |
| | GET | `/api/integrations/:provider/connect` | Yes | owner, admin | standard | |
| | GET | `/api/integrations/:provider/callback` | Yes | owner, admin | standard | |
| | POST | `/api/integrations/:provider/sync` | Yes | owner, admin | standard | |
| | DELETE | `/api/integrations/:provider` | Yes | owner, admin | standard | |
| **Agents** | GET | `/api/agents` | Yes | Any | standard | |
| | GET | `/api/agents/:type` | Yes | Any | standard | |
| | PATCH | `/api/agents/:type` | Yes | owner, admin | standard | |
| | GET | `/api/agents/:type/executions` | Yes | Any | standard | |
| | GET | `/api/agents/executions/:id` | Yes | Any | standard | |
| | POST | `/api/agents/executions/:id/approve` | Yes | owner, admin, member | standard | Yes |
| | POST | `/api/agents/executions/:id/reject` | Yes | owner, admin, member | standard | |
| | GET | `/api/agents/review-queue` | Yes | owner, admin, member | standard | |
| **Copilot** | POST | `/api/copilot/message` | Yes | Any | copilot | Yes |
| | GET | `/api/copilot/conversations` | Yes | Any | standard | |
| | GET | `/api/copilot/conversations/:id` | Yes | Any | standard | |
| | POST | `/api/copilot/transcribe` | Yes | Any | copilot | |
| **Jobs** | GET | `/api/jobs` | Yes | Any | standard | |
| | GET | `/api/jobs/:id` | Yes | Any | standard | |
| | POST | `/api/jobs` | Yes | owner, admin, member | standard | |
| | PATCH | `/api/jobs/:id` | Yes | owner, admin, member | standard | |
| | POST | `/api/jobs/:id/complete` | Yes | owner, admin, member | standard | Yes |
| **Invoices** | GET | `/api/invoices` | Yes | Any | standard | |
| | GET | `/api/invoices/:id` | Yes | Any | standard | |
| | POST | `/api/invoices` | Yes | owner, admin, member | standard | Optional |
| | PATCH | `/api/invoices/:id` | Yes | owner, admin, member | standard | |
| | POST | `/api/invoices/:id/send` | Yes | owner, admin, member | standard | Yes |
| | GET | `/api/invoices/:id/pdf` | Yes | Any | standard | |
| **Estimates** | GET | `/api/estimates` | Yes | Any | standard | |
| | GET | `/api/estimates/:id` | Yes | Any | standard | |
| | POST | `/api/estimates` | Yes | owner, admin, member | standard | Optional |
| | PATCH | `/api/estimates/:id` | Yes | owner, admin, member | standard | |
| | POST | `/api/estimates/:id/send` | Yes | owner, admin, member | standard | |
| **Customers** | GET | `/api/customers` | Yes | Any | standard | |
| | GET | `/api/customers/:id` | Yes | Any | standard | |
| | POST | `/api/customers` | Yes | owner, admin, member | standard | |
| | PATCH | `/api/customers/:id` | Yes | owner, admin, member | standard | |
| **Inventory** | GET | `/api/inventory` | Yes | Any | standard | |
| | GET | `/api/inventory/:id` | Yes | Any | standard | |
| | POST | `/api/inventory` | Yes | owner, admin, member | standard | |
| | PATCH | `/api/inventory/:id` | Yes | owner, admin, member | standard | |
| | GET | `/api/inventory/low-stock` | Yes | Any | standard | |
| **Dashboard** | GET | `/api/dashboard/summary` | Yes | Any | standard | |
| | GET | `/api/dashboard/agent-activity` | Yes | Any | standard | |
| | GET | `/api/dashboard/insights` | Yes | Any | standard | |
| | GET | `/api/dashboard/financials` | Yes | owner, admin, member | standard | |
| **Workflows** | GET | `/api/workflows` | Yes | Any | standard | |
| | POST | `/api/workflows` | Yes | owner, admin, member | standard | |
| | PATCH | `/api/workflows/:id` | Yes | owner, admin, member | standard | |
| | DELETE | `/api/workflows/:id` | Yes | owner, admin, member | standard | |
| **Webhooks** | POST | `/api/webhooks/quickbooks` | No (sig) | -- | webhook | Yes |
| | POST | `/api/webhooks/stripe` | No (sig) | -- | webhook | Yes |
| | POST | `/api/webhooks/jobber` | No (sig) | -- | webhook | Yes |
| | POST | `/api/webhooks/:provider` | No (sig) | -- | webhook | Yes |
| **Onboarding** | GET | `/api/onboarding/status` | Yes | Any | standard | |
| | POST | `/api/onboarding/complete-step` | Yes | Any | standard | |
| | POST | `/api/onboarding/skip` | Yes | owner, admin | standard | |
| **Upload** | POST | `/api/upload/presign` | Yes | owner, admin, member | standard | |
| | POST | `/api/upload/confirm` | Yes | owner, admin, member | standard | |
| **Usage** | GET | `/api/dashboard/usage` | Yes | owner, admin | standard | |
| **Notifications** | GET | `/api/notifications` | Yes | Any | standard | |
| | PATCH | `/api/notifications/:id/read` | Yes | Any | standard | |
| | POST | `/api/notifications/read-all` | Yes | Any | standard | |
