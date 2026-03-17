# 04 - API Standards

> **Permanent reference** for the CrewShift API response conventions, error handling, pagination, filtering, sorting, search, rate limiting, and HTTP headers.
> Cross-references: [00-overview](./00-overview.md) | [01-project-structure](./01-project-structure.md) | [02-database-schema](./02-database-schema.md) | [03-api-routes](./03-api-routes.md)

---

## 1. Standard Success Response Envelope

Every successful API response wraps its payload in a `data` property. List endpoints include an optional `meta` property for pagination.

```typescript
// Standard success response
interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
}
```

### Implementation

```typescript
// utils/response.ts

export function success<T>(data: T, meta?: PaginationMeta): ApiResponse<T> {
  const response: ApiResponse<T> = { data };
  if (meta) response.meta = meta;
  return response;
}
```

### Examples

**Single resource:**

```json
{
  "data": {
    "id": "uuid-job-1",
    "status": "completed",
    "type": "service_call",
    "total_amount": 1840.00,
    "created_at": "2026-03-04T10:30:00Z"
  }
}
```

**List with pagination:**

```json
{
  "data": [
    { "id": "uuid-inv-1", "status": "sent", "total": 1840.00 },
    { "id": "uuid-inv-2", "status": "paid", "total": 450.00 }
  ],
  "meta": {
    "limit": 25,
    "has_more": true,
    "next_cursor": "eyJjcmVhdGVkX2F0IjoiMjAyNi0wMy0wM1QxMDozMDowMFoiLCJpZCI6InV1aWQtaW52LTIifQ=="
  }
}
```

**Action confirmation (no resource body):**

```json
{
  "data": {
    "message": "Invoice sent",
    "sent_at": "2026-03-04T10:30:00Z"
  }
}
```

### Design Rationale

- The `data` wrapper distinguishes payload from metadata and errors. Clients always look for `.data` on success and `.error` on failure. There is no ambiguity.
- The `meta` field is only present when there is pagination metadata to return. It is never `null` -- it is either present or absent.
- Empty lists return `{ "data": [], "meta": { "limit": 25, "has_more": false } }`, not 404.

---

## 2. Standard Error Response Envelope

Every error response wraps its payload in an `error` property with a machine-readable code, a human-readable message, and optional details.

```typescript
// Standard error response
interface ApiError {
  error: {
    code: string;          // Machine-readable: 'VALIDATION_ERROR', 'NOT_FOUND', etc.
    message: string;       // Human-readable: "Invoice not found"
    details?: any;         // Optional: field-level validation errors, additional context
  };
}
```

### Implementation

```typescript
// utils/response.ts

export function error(code: string, message: string, details?: any): ApiError {
  const response: ApiError = { error: { code, message } };
  if (details !== undefined) response.error.details = details;
  return response;
}
```

### Error Response Examples

**Validation error (400):**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "email", "message": "Invalid email format" },
      { "field": "trade_type", "message": "Must be one of: hvac, plumbing, electrical, roofing, general, landscaping" }
    ]
  }
}
```

**Authentication error (401):**

```json
{
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "Missing or expired authentication token"
  }
}
```

**Authorization error (403):**

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient permissions. Required role: admin"
  }
}
```

**Not found (404):**

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Invoice not found"
  }
}
```

**Conflict (409):**

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "An invoice for this job already exists",
    "details": { "existing_invoice_id": "uuid-inv-1" }
  }
}
```

**Rate limited (429):**

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Try again in 30 seconds",
    "details": { "retry_after_seconds": 30 }
  }
}
```

**AI service unavailable (503):**

```json
{
  "error": {
    "code": "AI_UNAVAILABLE",
    "message": "AI service temporarily unavailable. CRUD operations still work."
  }
}
```

### Design Rationale

- The `code` field is ALWAYS a string constant in `SCREAMING_SNAKE_CASE`. Clients use this for programmatic error handling (switch statements, error maps). It never changes between API versions.
- The `message` field is a human-readable string suitable for display in a UI toast notification. It can change between API versions.
- The `details` field carries structured error context when available. For validation errors, it is an array of field-level errors. For conflicts, it includes the existing resource ID. The shape of `details` varies by error type.

---

## 3. Complete Error Code Table

| HTTP Status | Error Code | Description | When It Occurs |
|---|---|---|---|
| **400** | `VALIDATION_ERROR` | Request body or query parameters fail schema validation. | Zod schema validation rejects the request body. Missing required fields, wrong types, invalid enums. |
| **400** | `BAD_REQUEST` | Malformed request that does not fit validation. | Unparseable JSON body, missing Content-Type header, invalid query parameter format. |
| **401** | `AUTH_REQUIRED` | Authentication token is missing, expired, or invalid. | No `Authorization` header, expired JWT, malformed token, invalid signature. |
| **401** | `TOKEN_EXPIRED` | Authentication token has expired specifically. | JWT `exp` claim is in the past. Client should use the refresh token. |
| **403** | `FORBIDDEN` | Authenticated user lacks permission for this action. | User's role is not in the allowed list for the route (e.g., tech trying to update org settings). |
| **403** | `NO_ORG` | Authenticated user has no organization association. | JWT is valid but missing the `org_id` custom claim (broken signup flow). |
| **403** | `TIER_RESTRICTED` | Feature not available on the org's pricing tier. | Starter tier trying to use an agent only available on Pro+ (e.g., Insights Agent). |
| **404** | `NOT_FOUND` | Requested resource does not exist or belongs to a different org. | UUID does not match any record, or the record's `org_id` does not match the authenticated user's org. RLS prevents leaking existence of resources in other orgs. |
| **409** | `CONFLICT` | Action would create a duplicate or violate a uniqueness constraint. | Idempotency key already exists with a completed execution. Integration for this provider already connected. Agent config for this type already exists. |
| **422** | `UNPROCESSABLE` | Request is valid but cannot be processed due to business logic. | Trying to send an invoice that is still in draft status. Trying to complete an already-completed job. Trying to approve an execution that is not awaiting review. |
| **429** | `RATE_LIMITED` | Too many requests from this client/user. | Request count exceeds the rate limit for the route category (auth: 10/min, standard: 100/min, copilot: 30/min, webhook: 500/min). |
| **500** | `INTERNAL_ERROR` | Unexpected server error. | Unhandled exception, database connection failure, unexpected null. Always logged with full stack trace. Never exposes internal details to the client. |
| **502** | `AI_SERVICE_ERROR` | AI service returned an error response. | Python AI service returned a non-200 response. The Node API translates this to a 502 for the client. |
| **503** | `AI_UNAVAILABLE` | AI service is down or the circuit breaker is open. | The circuit breaker has tripped after repeated failures. CRUD operations still work, but AI-dependent features (agent execution, copilot) are temporarily unavailable. |
| **503** | `SERVICE_UNAVAILABLE` | The API itself is temporarily unavailable. | Maintenance mode, database connection pool exhausted, Redis down. |

### Error Class Hierarchy

```typescript
// utils/errors.ts

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: any,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(details: Array<{ field: string; message: string }>) {
    super(400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }
}

export class AuthError extends AppError {
  constructor(message = 'Missing or expired authentication token') {
    super(401, 'AUTH_REQUIRED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, 'NOT_FOUND', `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: any) {
    super(409, 'CONFLICT', message, details);
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string) {
    super(422, 'UNPROCESSABLE', message);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(429, 'RATE_LIMITED', `Too many requests. Try again in ${retryAfterSeconds} seconds`, { retry_after_seconds: retryAfterSeconds });
  }
}
```

### Global Error Handler

```typescript
// server.ts - Fastify error handler

app.setErrorHandler((error, request, reply) => {
  // Known application error
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details && { details: error.details }),
      },
    });
  }

  // Zod validation error (from schema validation)
  if (error.validation) {
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.validation,
      },
    });
  }

  // Unknown/unexpected error
  request.log.error(error);
  return reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
});
```

---

## 4. Copilot Response Shape

The copilot response is different from standard CRUD responses. It is streamed via Server-Sent Events (SSE) and contains agent dispatch information alongside the text response.

```typescript
interface CopilotResponse {
  data: {
    conversation_id: string;               // UUID of the conversation
    message_id: string;                     // UUID of the assistant's message
    message: string;                        // The copilot's text response
    agents_dispatched?: string[];           // Which agents were triggered (e.g., ['invoice', 'customer'])
    execution_ids?: string[];               // References to agent_executions for traceability
    actions_taken?: Array<{
      type: string;                         // Machine-readable: 'created_invoice', 'deducted_inventory', etc.
      description: string;                  // Human-readable: "Generated invoice #1247 for $1,840"
      result: any;                          // Action-specific result data
    }>;
    follow_up_suggestions?: string[];       // Suggested next questions for the user
  };
}
```

### SSE Stream Format

The copilot endpoint (`POST /api/copilot/message`) returns a `text/event-stream` response. Events are sent as the copilot processes the request:

```
event: message_start
data: {"conversation_id": "uuid-conv-1", "message_id": "uuid-msg-2"}

event: text_delta
data: {"delta": "Invoice #1247 generated for "}

event: text_delta
data: {"delta": "$1,840 and sent to QuickBooks."}

event: agent_dispatched
data: {"agent_type": "invoice", "execution_id": "uuid-exec-1"}

event: agent_dispatched
data: {"agent_type": "inventory", "execution_id": "uuid-exec-2"}

event: action_taken
data: {"type": "created_invoice", "description": "Generated invoice #1247 for $1,840", "result": {"invoice_id": "uuid-inv-1"}}

event: message_complete
data: {"follow_up_suggestions": ["Show me the invoice details", "What is Henderson's payment history?"]}
```

### Design Rationale

- The copilot response is streamed because LLM responses take 1-5 seconds. Streaming gives the user immediate feedback.
- `agents_dispatched` and `execution_ids` provide full traceability -- the frontend can link to the agent execution detail page.
- `actions_taken` is a summary of what the agents actually did, presented in the chat UI.
- `follow_up_suggestions` guides the user's next interaction, reducing the "blank prompt" problem.

---

## 5. Cursor-Based Pagination

### Why Cursors, Not Offsets

Offset pagination (`?page=3&per_page=25`) breaks when data changes during paging. If a new invoice is created between page 1 and page 2, offset pagination skips a record or shows a duplicate. Cursor pagination is stable: the cursor points to a specific position in the sorted result set, so additions and deletions between pages do not affect the result.

### Query Parameters

```typescript
interface ListParams {
  limit?: number;            // Number of results per page. Default: 25. Max: 100.
  cursor?: string;           // Opaque cursor from previous response's meta.next_cursor.
  sort?: string;             // Field to sort by. Default: 'created_at'.
  order?: 'asc' | 'desc';   // Sort direction. Default: 'desc'.
  search?: string;           // Full-text search query (PostgreSQL ts_query).
  // Plus field-level filters as additional query params (see Filtering below).
}
```

### Response Meta

```typescript
interface PaginationMeta {
  limit: number;             // The limit that was applied.
  has_more: boolean;         // Whether there are more results after this page.
  next_cursor?: string;      // Opaque cursor to pass as ?cursor= for the next page. Null if no more pages.
  total?: number;            // Optional total count. Only included if explicitly requested (?include_total=true). Expensive on large tables.
}
```

### How Cursors Are Encoded/Decoded

A cursor encodes the value of the sort field and the record ID at the boundary of the current page. This allows the next query to use a WHERE clause that starts exactly after the last record.

```typescript
// utils/pagination.ts

interface CursorPayload {
  sort_value: string | number;   // Value of the sort field on the last row
  id: string;                    // UUID of the last row (tiebreaker)
}

/**
 * Encode a cursor from the last row of the current page.
 * The cursor is a base64-encoded JSON string.
 */
export function encodeCursor(sortField: string, lastRow: Record<string, any>): string {
  const payload: CursorPayload = {
    sort_value: lastRow[sortField],
    id: lastRow.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decode a cursor back into its components.
 */
export function decodeCursor(cursor: string): CursorPayload {
  const json = Buffer.from(cursor, 'base64url').toString('utf-8');
  return JSON.parse(json) as CursorPayload;
}

/**
 * Apply cursor-based pagination to a Drizzle query.
 *
 * For descending order: WHERE (sort_field, id) < (cursor_sort_value, cursor_id)
 * For ascending order:  WHERE (sort_field, id) > (cursor_sort_value, cursor_id)
 *
 * This uses PostgreSQL row-value comparison which is both correct and index-friendly.
 */
export function applyPagination(
  query: DrizzleQuery,
  params: ListParams,
  sortColumn: Column,
  idColumn: Column,
): DrizzleQuery {
  const limit = Math.min(params.limit ?? 25, 100);
  const order = params.order ?? 'desc';

  // Apply cursor condition
  if (params.cursor) {
    const cursor = decodeCursor(params.cursor);
    if (order === 'desc') {
      // Row-value comparison: (sort_field, id) < (cursor_value, cursor_id)
      query = query.where(
        sql`(${sortColumn}, ${idColumn}) < (${cursor.sort_value}, ${cursor.id})`
      );
    } else {
      query = query.where(
        sql`(${sortColumn}, ${idColumn}) > (${cursor.sort_value}, ${cursor.id})`
      );
    }
  }

  // Apply sort and limit
  // Fetch limit + 1 to determine has_more without a separate COUNT query
  query = query
    .orderBy(order === 'desc' ? desc(sortColumn) : asc(sortColumn), order === 'desc' ? desc(idColumn) : asc(idColumn))
    .limit(limit + 1);

  return query;
}

/**
 * Build the pagination meta from the result set.
 * We fetched limit+1 rows; if we got more than limit, there are more pages.
 */
export function buildPaginationMeta(
  rows: any[],
  limit: number,
  sortField: string,
): PaginationMeta {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];

  return {
    limit,
    has_more: hasMore,
    ...(hasMore && lastRow && { next_cursor: encodeCursor(sortField, lastRow) }),
  };
}
```

### Pagination Example

**First page request:**

```
GET /api/invoices?limit=2&sort=created_at&order=desc&status=overdue
```

**Response:**

```json
{
  "data": [
    { "id": "uuid-inv-5", "status": "overdue", "total": 2400.00, "created_at": "2026-03-04T10:00:00Z" },
    { "id": "uuid-inv-3", "status": "overdue", "total": 850.00, "created_at": "2026-03-02T14:30:00Z" }
  ],
  "meta": {
    "limit": 2,
    "has_more": true,
    "next_cursor": "eyJzb3J0X3ZhbHVlIjoiMjAyNi0wMy0wMlQxNDozMDowMFoiLCJpZCI6InV1aWQtaW52LTMifQ=="
  }
}
```

**Next page request:**

```
GET /api/invoices?limit=2&sort=created_at&order=desc&status=overdue&cursor=eyJzb3J0X3ZhbHVlIjoiMjAyNi0wMy0wMlQxNDozMDowMFoiLCJpZCI6InV1aWQtaW52LTMifQ==
```

**Response:**

```json
{
  "data": [
    { "id": "uuid-inv-1", "status": "overdue", "total": 1200.00, "created_at": "2026-02-28T09:00:00Z" }
  ],
  "meta": {
    "limit": 2,
    "has_more": false
  }
}
```

### Maximum Page Size

- **Default limit:** 25 records per page.
- **Maximum limit:** 100 records per page. Requests with `limit` > 100 are clamped to 100.
- **Total count:** Not included by default (it requires a full table scan on large tables). Can be requested via `?include_total=true` but is optional and may be slow.

---

## 6. Filtering Convention

Filters are passed as query parameters. Each filter maps to a column on the resource table.

### Query Parameter Format

```
GET /api/invoices?status=overdue&customer_id=uuid-cust-1&due_date_before=2026-03-01
```

### Supported Filter Patterns

| Pattern | Example | SQL Equivalent |
|---|---|---|
| Exact match | `?status=overdue` | `WHERE status = 'overdue'` |
| UUID reference | `?customer_id=uuid-cust-1` | `WHERE customer_id = 'uuid-cust-1'` |
| Date before | `?due_date_before=2026-03-01` | `WHERE due_date < '2026-03-01'` |
| Date after | `?due_date_after=2026-02-01` | `WHERE due_date > '2026-02-01'` |
| Datetime range | `?scheduled_start_after=...&scheduled_start_before=...` | `WHERE scheduled_start BETWEEN ... AND ...` |
| Multiple values | `?status=sent,overdue` | `WHERE status IN ('sent', 'overdue')` |
| Boolean | `?unread_only=true` | `WHERE read = false` |

### Filter Parameters by Resource

| Resource | Supported Filters |
|---|---|
| **Jobs** | `status`, `customer_id`, `assigned_tech_id`, `type`, `scheduled_start_after`, `scheduled_start_before` |
| **Invoices** | `status`, `customer_id`, `job_id`, `due_date_before`, `due_date_after` |
| **Estimates** | `status`, `customer_id`, `type` |
| **Customers** | `tags` (comma-separated) |
| **Parts** | `category` |
| **Agent Executions** | `status`, `agent_type` |
| **Notifications** | `unread_only` |

### Implementation

Filters are validated against a whitelist of allowed fields for each resource. Unknown filter parameters are ignored (not rejected) to allow forward compatibility.

```typescript
// Example filter application in a repository
function applyFilters(query: DrizzleQuery, params: Record<string, string>): DrizzleQuery {
  if (params.status) {
    const statuses = params.status.split(',');
    query = query.where(inArray(invoices.status, statuses));
  }
  if (params.customer_id) {
    query = query.where(eq(invoices.customer_id, params.customer_id));
  }
  if (params.due_date_before) {
    query = query.where(lt(invoices.due_date, params.due_date_before));
  }
  if (params.due_date_after) {
    query = query.where(gt(invoices.due_date, params.due_date_after));
  }
  return query;
}
```

---

## 7. Sorting Convention

### Query Parameters

```
GET /api/invoices?sort=total&order=desc
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `sort` | `string` | `created_at` | The field to sort by. Must be a sortable column for the resource. |
| `order` | `'asc' \| 'desc'` | `desc` | Sort direction. Descending by default (newest/highest first). |

### Sortable Fields by Resource

| Resource | Sortable Fields |
|---|---|
| **Jobs** | `created_at`, `scheduled_start`, `total_amount`, `status` |
| **Invoices** | `created_at`, `total`, `due_date`, `status` |
| **Estimates** | `created_at`, `total`, `status` |
| **Customers** | `created_at`, `name`, `lifetime_value` |
| **Parts** | `created_at`, `name`, `quantity_on_hand` |
| **Agent Executions** | `created_at`, `duration_ms`, `confidence_score` |
| **Notifications** | `created_at` |

### Implementation

Sort field is validated against a whitelist. Invalid sort fields fall back to `created_at`. The ID column is always used as a secondary sort (tiebreaker) for stable cursor pagination.

```typescript
const SORTABLE_FIELDS: Record<string, Column> = {
  created_at: invoices.created_at,
  total: invoices.total,
  due_date: invoices.due_date,
  status: invoices.status,
};

const sortColumn = SORTABLE_FIELDS[params.sort ?? 'created_at'] ?? SORTABLE_FIELDS.created_at;
```

---

## 8. Full-Text Search

### Approach

PostgreSQL `tsvector` + `ts_query` for keyword search on searchable columns. This is NOT semantic/vector search (that is handled by the copilot via the `embeddings` table and pgvector).

### Query Parameter

```
GET /api/customers?search=henderson
GET /api/invoices?search=INV-2026
GET /api/jobs?search=ac+install
```

The `search` parameter is converted to a PostgreSQL `tsquery`:

```typescript
// Single word: "henderson" -> "henderson:*" (prefix matching)
// Multiple words: "ac install" -> "ac:* & install:*" (AND with prefix matching)

function buildSearchQuery(search: string): string {
  return search
    .trim()
    .split(/\s+/)
    .map(word => `${word}:*`)
    .join(' & ');
}
```

### Searchable Columns by Resource

| Resource | Searchable Columns | tsvector |
|---|---|---|
| **Customers** | `name`, `email`, `phone`, `notes` | `to_tsvector('english', coalesce(name,'') \|\| ' ' \|\| coalesce(email,'') \|\| ' ' \|\| coalesce(phone,'') \|\| ' ' \|\| coalesce(notes,''))` |
| **Jobs** | `description`, `notes` | `to_tsvector('english', coalesce(description,'') \|\| ' ' \|\| coalesce(notes,''))` |
| **Invoices** | `invoice_number`, `notes` | `to_tsvector('english', coalesce(invoice_number,'') \|\| ' ' \|\| coalesce(notes,''))` |
| **Estimates** | `estimate_number`, `scope_description`, `notes` | `to_tsvector('english', coalesce(estimate_number,'') \|\| ' ' \|\| coalesce(scope_description,'') \|\| ' ' \|\| coalesce(notes,''))` |
| **Parts** | `name`, `sku`, `category` | `to_tsvector('english', coalesce(name,'') \|\| ' ' \|\| coalesce(sku,'') \|\| ' ' \|\| coalesce(category,''))` |

### SQL Example

```sql
-- Search customers for "henderson"
SELECT * FROM customers
WHERE org_id = $1
  AND search_vector @@ to_tsquery('english', 'henderson:*')
ORDER BY ts_rank(search_vector, to_tsquery('english', 'henderson:*')) DESC, created_at DESC
LIMIT 26;  -- limit + 1 for has_more check
```

### Design Rationale

- `tsvector` is a built-in PostgreSQL feature -- no external search service needed.
- Prefix matching (`word:*`) enables type-ahead search (user types "hend" and finds "Henderson").
- GIN indexes on `search_vector` make this fast even on large tables.
- This is suitable for structured keyword search (names, numbers, descriptions). For fuzzy or semantic search ("what was that big AC job last month?"), the copilot uses vector similarity on the `embeddings` table instead.

---

## 9. Rate Limiting

### Strategy

Redis-based sliding window rate limiter. Limits are applied per user (by JWT `sub` claim) for authenticated routes, and per IP for unauthenticated routes.

### Rate Limit Categories

| Category | Limit | Applied To | Rationale |
|---|---|---|---|
| `auth` | 10 requests/minute | Login, signup, token refresh | Prevents brute-force attacks on auth endpoints. |
| `standard` | 100 requests/minute | All CRUD endpoints, dashboard | Standard operational rate for normal usage. A busy user clicking through the dashboard should never hit this. |
| `copilot` | 30 requests/minute | Copilot message, transcribe | Each copilot message triggers LLM inference which is expensive. 30/min is generous for conversational use but prevents abuse. |
| `webhook` | 500 requests/minute | All webhook endpoints | External tools can burst webhooks during sync. 500/min accommodates high-volume webhook delivery. |

### Rate Limit Headers

Every response includes rate limit headers:

```
X-RateLimit-Limit: 100          # Maximum requests allowed in the window
X-RateLimit-Remaining: 87       # Requests remaining in the current window
X-RateLimit-Reset: 1709510430   # Unix timestamp when the window resets
```

When the rate limit is exceeded, the response is:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1709510430

{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Try again in 30 seconds",
    "details": { "retry_after_seconds": 30 }
  }
}
```

### Implementation

```typescript
// middleware/rate-limit.ts

import { FastifyRequest, FastifyReply } from 'fastify';
import { Redis } from 'ioredis';

interface RateLimitConfig {
  max: number;           // Max requests per window
  windowMs: number;      // Window size in milliseconds (60000 = 1 minute)
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  auth:     { max: 10,  windowMs: 60_000 },
  standard: { max: 100, windowMs: 60_000 },
  copilot:  { max: 30,  windowMs: 60_000 },
  webhook:  { max: 500, windowMs: 60_000 },
};

export function rateLimiter(category: string) {
  const config = RATE_LIMITS[category];

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.userId
      ? `ratelimit:${category}:${request.userId}`
      : `ratelimit:${category}:${request.ip}`;

    const redis = request.server.redis;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Sliding window: count requests in the current window
    // Uses a Redis sorted set with timestamps as scores
    await redis.zremrangebyscore(key, 0, windowStart); // Remove expired entries
    const count = await redis.zcard(key);

    // Set headers
    const resetAt = Math.ceil((now + config.windowMs) / 1000);
    reply.header('X-RateLimit-Limit', config.max);
    reply.header('X-RateLimit-Remaining', Math.max(0, config.max - count - 1));
    reply.header('X-RateLimit-Reset', resetAt);

    if (count >= config.max) {
      const retryAfter = Math.ceil(config.windowMs / 1000);
      reply.header('Retry-After', retryAfter);
      throw new RateLimitError(retryAfter);
    }

    // Record this request
    await redis.zadd(key, now, `${now}:${Math.random()}`);
    await redis.expire(key, Math.ceil(config.windowMs / 1000));
  };
}
```

---

## 10. Request ID Header

Every request is assigned a unique request ID for tracing. If the client sends an `X-Request-ID` header, that value is used. Otherwise, the server generates a UUIDv4.

### Headers

```
# Request (optional, client-provided)
X-Request-ID: client-trace-uuid-123

# Response (always present)
X-Request-ID: client-trace-uuid-123
```

### Implementation

```typescript
// server.ts - Fastify hook

app.addHook('onRequest', (request, reply, done) => {
  const requestId = request.headers['x-request-id'] as string || crypto.randomUUID();
  request.id = requestId;
  reply.header('X-Request-ID', requestId);
  done();
});
```

### Usage

The request ID is:
- Included in every log line (Pino automatically uses `request.id`).
- Passed to the Python AI service in the `X-Request-ID` header for distributed tracing.
- Included in BullMQ job data for tracing background work back to the originating request.
- Returned to the client for support/debugging ("I'm getting an error" -> "What's the request ID?").

---

## 11. CORS Headers

### Configuration

```typescript
// server.ts - Fastify CORS plugin

import cors from '@fastify/cors';

app.register(cors, {
  origin: [
    'http://localhost:3001',           // Local frontend dev
    'https://app.crewshift.com',       // Production frontend
    'https://*.crewshift.com',         // Subdomains (staging, etc.)
  ],
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  credentials: true,                   // Allow cookies/auth headers
  maxAge: 86400,                       // Cache preflight for 24 hours
});
```

### Response Headers

```
Access-Control-Allow-Origin: https://app.crewshift.com
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Request-ID
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 86400
```

### Design Rationale

- `origin` is a strict whitelist. The API only accepts requests from known frontends. No `*` wildcard.
- `credentials: true` is required because the frontend sends the JWT in the `Authorization` header.
- `maxAge: 86400` caches the preflight OPTIONS response for 24 hours, reducing preflight requests.
- `DELETE` is included but used sparingly (only for removing team members, disconnecting integrations, and deleting workflows).

---

## 12. Content-Type Conventions

### Request Content Types

| Content-Type | Used By |
|---|---|
| `application/json` | All JSON request bodies (the default and most common). |
| `multipart/form-data` | File uploads (`POST /api/copilot/transcribe` for audio, file upload via presigned URL). |

### Response Content Types

| Content-Type | Used By |
|---|---|
| `application/json` | All standard API responses. |
| `text/event-stream` | Copilot streaming response (`POST /api/copilot/message`). |
| `application/pdf` | Invoice/estimate PDF download (redirects to presigned S3 URL). |

### Rules

- All JSON requests MUST include `Content-Type: application/json`. The server returns 400 if the content type is missing on endpoints that expect JSON.
- All JSON responses are UTF-8 encoded.
- Dates are always ISO 8601 format: `2026-03-04T10:30:00Z` (UTC).
- Decimal values (money) are JSON numbers, not strings. Example: `"total": 1840.00`, not `"total": "1840.00"`.
- UUIDs are lowercase hyphenated strings: `"id": "550e8400-e29b-41d4-a716-446655440000"`.
- Null fields are included in responses (not omitted): `"phone": null`, not missing entirely. This makes the response schema predictable.
- Empty arrays are `[]`, not null or omitted: `"tags": []`.
- Boolean values are JSON booleans: `"enabled": true`, not `"enabled": "true"`.
