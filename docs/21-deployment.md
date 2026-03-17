# 21 - Deployment

> **Permanent reference** for how CrewShift is deployed, configured, and operated across development, staging, and production environments.
> Cross-references: [00-overview](./00-overview.md) | [01-project-structure](./01-project-structure.md) | [05-security](./05-security.md) | [18-observability](./18-observability.md) | [22-error-handling](./22-error-handling.md)

---

## 1. Railway Deployment

CrewShift runs on Railway with two application services and one managed addon:

| Service | Runtime | Role |
|---|---|---|
| **api** | Node.js 20 (Fastify) | REST API, BullMQ workers, agent runtime, integration adapters, webhook handlers |
| **ai-service** | Python 3.12 (FastAPI) | LLM reasoning, intent classification, embeddings, vision/OCR, speech-to-text |
| **Redis** | Railway managed addon | BullMQ job queue backing store, rate limiting, caching, webhook deduplication |

Both services share the same Supabase database (external, not hosted on Railway). Internal communication between `api` and `ai-service` uses Railway private networking -- the AI service does not need a public URL.

### Why Railway

- Docker-based deployment with zero DevOps overhead
- Multiple services in a single project with private networking between them
- Managed Redis addon (no separate Redis hosting)
- Automatic deploys from GitHub on push
- Environment variable management with encrypted secrets
- Built-in logging (stdout/stderr, searchable, exportable)
- One-click rollback to any previous deployment
- Free tier for development, predictable pricing for production
- No Kubernetes, no Terraform, no infrastructure-as-code to maintain

### Decision Rationale

Railway over AWS/GCP/Vercel: CrewShift is a two-service backend with a queue. This is not a scale problem yet -- it is a shipping problem. Railway eliminates all infrastructure complexity so the focus stays on product. When scale demands it (hundreds of thousands of agent executions per day), the containerized architecture migrates to ECS, Cloud Run, or Kubernetes with zero application code changes.

---

## 2. railway.toml

The `railway.toml` file in the project root configures both services.

```toml
# railway.toml

[build]
# Railway detects the Dockerfile in each service directory automatically.
# This file is used for shared configuration only.

[deploy]
# Shared deployment settings
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10

# ===============================================
# SERVICE: api (Node.js Fastify monolith)
# ===============================================

# Note: Railway uses per-service configuration via the dashboard
# or via separate Dockerfiles. The following documents the expected
# configuration for each service.

# API Service Configuration:
#   Build Command: (handled by Dockerfile)
#   Start Command: (handled by Dockerfile)
#   Root Directory: apps/api
#   Health Check Path: /health
#   Health Check Timeout: 30s
#   Region: us-west1 (or us-east1 for lower Supabase latency)

# ===============================================
# SERVICE: ai-service (Python FastAPI)
# ===============================================

# AI Service Configuration:
#   Build Command: (handled by Dockerfile)
#   Start Command: (handled by Dockerfile)
#   Root Directory: apps/ai-service
#   Health Check Path: /ai/health
#   Health Check Timeout: 60s (LLM provider SDK init can be slow)
#   Region: same as api service
```

### Railway Service Configuration (Dashboard)

Since Railway v2 uses per-service settings in the dashboard rather than a shared toml for multi-service projects, here is the exact configuration for each service:

#### api service

| Setting | Value |
|---|---|
| Root Directory | `apps/api` |
| Builder | Dockerfile |
| Dockerfile Path | `Dockerfile` (relative to root directory) |
| Health Check Path | `/health` |
| Health Check Timeout | `30` seconds |
| Restart Policy | On Failure, max 10 retries |
| Region | `us-west1` |
| Public Networking | Yes (custom domain) |

#### ai-service

| Setting | Value |
|---|---|
| Root Directory | `apps/ai-service` |
| Builder | Dockerfile |
| Dockerfile Path | `Dockerfile` (relative to root directory) |
| Health Check Path | `/ai/health` |
| Health Check Timeout | `60` seconds |
| Restart Policy | On Failure, max 10 retries |
| Region | `us-west1` (same as api) |
| Public Networking | **No** (private networking only) |

---

## 3. Dockerfiles

### Node API Dockerfile (Multi-Stage Build)

```dockerfile
# apps/api/Dockerfile

# ===== Stage 1: Build =====
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files for dependency caching
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ===== Stage 2: Production =====
FROM node:20-alpine AS production

# Security: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Install Puppeteer dependencies for PDF generation
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy templates and static assets
COPY src/templates ./dist/templates

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "dist/server.js"]
```

### Python AI Service Dockerfile

```dockerfile
# apps/ai-service/Dockerfile

# ===== Stage 1: Build dependencies =====
FROM python:3.12-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ===== Stage 2: Production =====
FROM python:3.12-slim AS production

# Security: run as non-root user
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY app/ ./app/

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/ai/health')" || exit 1

# Start the application
# Workers set to 2 for Railway's typical container size (1-2 vCPU)
# Timeout set to 120s to accommodate long LLM calls
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--timeout-keep-alive", "120"]
```

### Decision Rationale: Multi-Stage Builds

The Node API Dockerfile uses a two-stage build:
- **Stage 1 (builder):** Installs all dependencies (including devDependencies), compiles TypeScript. This stage includes the TypeScript compiler, test frameworks, and other dev tools.
- **Stage 2 (production):** Copies only the compiled JavaScript and production `node_modules`. The final image is ~300MB smaller than a single-stage build.

The Python Dockerfile uses a similar pattern:
- **Stage 1 (builder):** Installs build tools (`gcc`, etc.) needed to compile native Python packages.
- **Stage 2 (production):** Copies only the installed packages. No compiler tools in the final image.

Both images run as non-root users for security. Both include `HEALTHCHECK` instructions that Railway uses for deployment readiness.

---

## 4. docker-compose.yml

For local development, `docker-compose.yml` runs Redis and optionally the AI service. The Node API can run natively (faster iteration) or in Docker.

```yaml
# docker-compose.yml (project root)

version: '3.8'

services:
  # ==================== REDIS ====================
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ==================== AI SERVICE ====================
  ai-service:
    build:
      context: ./apps/ai-service
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    env_file: .env
    environment:
      - TESTING=false
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/ai/health')"]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 3
    depends_on:
      redis:
        condition: service_healthy

  # ==================== NODE API ====================
  api:
    build:
      context: ./apps/api
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    env_file: .env
    environment:
      - NODE_ENV=development
      - REDIS_URL=redis://redis:6379
      - AI_SERVICE_URL=http://ai-service:8000
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      start_period: 30s
      retries: 3
    depends_on:
      redis:
        condition: service_healthy
      ai-service:
        condition: service_healthy

volumes:
  redis-data:
```

### Local Development Workflow

For fastest iteration, run Redis and ai-service in Docker but run the Node API natively:

```bash
# Terminal 1: Start Redis + AI service
docker compose up redis ai-service

# Terminal 2: Start Node API natively (with hot reload)
cd apps/api
npm run dev
```

The `npm run dev` script uses `tsx --watch` for instant TypeScript reloading without a build step.

For full Docker development (mirrors production):

```bash
# Start everything
docker compose up --build

# Rebuild after code changes
docker compose up --build api
```

---

## 5. Environment Variables

### Complete .env.example

Every environment variable used by either service, grouped by category.

```env
# ============================================================
# .env.example
# Copy to .env and fill in real values
# NEVER commit .env to git
# ============================================================

# ==================== APP ====================
NODE_ENV=development                    # development | staging | production
PORT=3000                               # Node API port
API_URL=http://localhost:3000           # Public API URL (used for OAuth callbacks)
LOG_LEVEL=info                          # debug | info | warn | error

# ==================== SUPABASE ====================
SUPABASE_URL=https://xxxxx.supabase.co  # Supabase project URL
SUPABASE_ANON_KEY=eyJhbGci...           # Supabase anonymous key (public, used by frontend)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...   # Supabase service role key (SECRET - bypasses RLS)
SUPABASE_JWT_SECRET=your-jwt-secret     # JWT secret for local token verification
DATABASE_URL=postgresql://postgres:password@db.xxxxx.supabase.co:5432/postgres  # Direct PostgreSQL connection string

# ==================== REDIS ====================
REDIS_URL=redis://localhost:6379        # Redis connection string (local dev)
                                        # Railway: redis://default:xxx@xxx.railway.internal:6379

# ==================== AI SERVICE ====================
AI_SERVICE_URL=http://localhost:8000    # Python AI service URL
                                        # Railway: http://ai-service.railway.internal:8000

# ==================== AI PROVIDERS (Python service uses these) ====================
ANTHROPIC_API_KEY=sk-ant-xxx            # Claude API key
OPENAI_API_KEY=sk-xxx                   # OpenAI API key
GOOGLE_AI_API_KEY=xxx                   # Google AI (Gemini) API key
DEEPGRAM_API_KEY=xxx                    # Deepgram speech-to-text API key
VOYAGE_API_KEY=xxx                      # Voyage embeddings API key

# AI Provider Configuration
AI_PRIMARY_REASONING=anthropic          # Primary provider for reasoning: anthropic | openai | google
AI_PRIMARY_CLASSIFICATION=openai        # Primary provider for classification: openai | google
AI_PRIMARY_VISION=google               # Primary provider for vision: google | anthropic
AI_PRIMARY_EMBEDDINGS=voyage           # Primary provider for embeddings: voyage | google

# ==================== INTEGRATIONS ====================
# QuickBooks Online
QUICKBOOKS_CLIENT_ID=xxx               # QuickBooks OAuth app client ID
QUICKBOOKS_CLIENT_SECRET=xxx           # QuickBooks OAuth app client secret
QUICKBOOKS_REDIRECT_URI=http://localhost:3000/api/integrations/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=sandbox         # sandbox | production
QUICKBOOKS_WEBHOOK_SECRET=xxx          # QuickBooks webhook verification token

# Stripe
STRIPE_SECRET_KEY=sk_test_xxx          # Stripe secret key
STRIPE_PUBLISHABLE_KEY=pk_test_xxx     # Stripe publishable key (for frontend)
STRIPE_WEBHOOK_SECRET=whsec_xxx        # Stripe webhook signing secret

# Google Workspace
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com  # Google OAuth client ID
GOOGLE_CLIENT_SECRET=xxx               # Google OAuth client secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/google/callback

# Twilio
TWILIO_ACCOUNT_SID=ACxxx              # Twilio account SID
TWILIO_AUTH_TOKEN=xxx                  # Twilio auth token
TWILIO_PHONE_NUMBER=+15551234567      # Twilio phone number for SMS

# ==================== STORAGE ====================
S3_BUCKET=crewshift-files-dev          # S3/R2 bucket name
S3_REGION=us-east-1                    # AWS region (or 'auto' for R2)
S3_ENDPOINT=                           # Leave empty for AWS S3, set for R2: https://xxx.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=xxx                  # AWS/R2 access key
AWS_SECRET_ACCESS_KEY=xxx              # AWS/R2 secret key

# ==================== NOTIFICATIONS ====================
RESEND_API_KEY=re_xxx                  # Resend email API key
RESEND_FROM_EMAIL=notifications@crewshift.com  # Sender email address
RESEND_FROM_NAME=CrewShift             # Sender name

# ==================== ENCRYPTION ====================
ENCRYPTION_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # 32-byte random hex string for pgcrypto token encryption

# ==================== DATA PIPELINE ====================
ANONYMIZATION_SALT=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # 32-byte random hex string for org hash salt
CURRENT_CONSENT_VERSION=2026.1         # Current terms version for data consent
```

### Generating Secrets

```bash
# Generate a 32-byte random hex string for ENCRYPTION_KEY or ANONYMIZATION_SALT
openssl rand -hex 32

# Example output: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2
```

---

## 6. Railway Private Networking

The `api` service calls the `ai-service` over Railway's internal network. This means:
- The AI service has no public URL -- it is not accessible from the internet
- Communication uses Railway's internal DNS: `ai-service.railway.internal`
- No TLS overhead on internal calls (encrypted at the network level by Railway)
- Lower latency than public internet routing

### Configuration

In the `api` service environment variables on Railway:

```
AI_SERVICE_URL=http://ai-service.railway.internal:8000
```

The `ai-service` listens on port 8000 (defined in its Dockerfile CMD). Railway automatically routes `ai-service.railway.internal:8000` to the correct container.

### How It Works

```
Internet                Railway Private Network
   │                         │
   │  HTTPS                  │
   ├────────▶ api ◀─────────┤
   │         (public)        │    HTTP (internal)
   │                         ├────────▶ ai-service
   │                         │          (private)
   │                         │
   │                         ├────────▶ Redis
   │                         │          (private)
```

The `api` service is the only service with a public URL. It acts as the gateway for all external traffic. The `ai-service` and Redis are only accessible within the Railway project network.

---

## 7. Supabase Setup

Supabase is used as an external database and auth provider. It is not hosted on Railway.

### Setup Steps

1. **Create Supabase project** at supabase.com
2. **Get connection details** from Settings > Database:
   - `DATABASE_URL`: Direct PostgreSQL connection string
   - `SUPABASE_URL`: Project URL
   - `SUPABASE_ANON_KEY`: Anonymous key
   - `SUPABASE_SERVICE_ROLE_KEY`: Service role key
   - `SUPABASE_JWT_SECRET`: JWT secret (Settings > API > JWT Settings)

3. **Enable required extensions:**
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector for embeddings
   CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- Token encryption
   ```

4. **Run the full schema migration** (see Section 8)

5. **Configure custom JWT claims:**
   Create a Supabase database function that adds `org_id` and `role` to JWT tokens:
   ```sql
   CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
   RETURNS jsonb AS $$
   DECLARE
     claims jsonb;
     user_org_id uuid;
     user_role text;
   BEGIN
     SELECT org_id, role INTO user_org_id, user_role
     FROM public.profiles
     WHERE id = (event->>'user_id')::uuid;

     claims := event->'claims';

     IF user_org_id IS NOT NULL THEN
       claims := jsonb_set(claims, '{org_id}', to_jsonb(user_org_id));
       claims := jsonb_set(claims, '{role}', to_jsonb(user_role));
     END IF;

     event := jsonb_set(event, '{claims}', claims);
     RETURN event;
   END;
   $$ LANGUAGE plpgsql;
   ```

6. **Enable RLS** on all tenant-scoped tables (see [05-security.md](./05-security.md))

### Connection Pooling

For production, use Supabase's connection pooler (PgBouncer) instead of direct connections:

```
# Direct connection (for migrations only)
DATABASE_URL=postgresql://postgres:password@db.xxxxx.supabase.co:5432/postgres

# Pooled connection (for application)
DATABASE_URL=postgresql://postgres:password@xxxxx.pooler.supabase.com:6543/postgres?pgbouncer=true
```

The pooled connection handles connection limits more efficiently when multiple BullMQ workers are running.

---

## 8. Database Migrations

### Drizzle ORM Migration Workflow

CrewShift uses Drizzle ORM for type-safe database access and migrations.

```bash
# Generate migration from schema changes
npx drizzle-kit generate:pg

# Push schema directly to database (development only)
npx drizzle-kit push:pg

# Run pending migrations
npx drizzle-kit migrate

# View current migration status
npx drizzle-kit check:pg
```

### Migration File Structure

```
apps/api/src/db/migrations/
  0000_initial_schema.sql          # Core tables: organizations, profiles, customers, jobs, invoices, estimates
  0001_agent_tables.sql            # agent_configs, agent_executions
  0002_copilot_tables.sql          # conversations, messages
  0003_workflow_tables.sql         # workflows, workflow_executions
  0004_integration_tables.sql      # integrations, business_context
  0005_notification_tables.sql     # notifications
  0006_vector_store.sql            # embeddings table + pgvector index
  0007_training_data.sql           # training_data, data_consent, training_runs
  0008_rls_policies.sql            # All Row-Level Security policies
  0009_onboarding.sql              # Onboarding status column on organizations
  0010_usage_views.sql             # org_monthly_usage materialized view
```

### Production Migration Workflow

```bash
# 1. Create migration locally
npx drizzle-kit generate:pg

# 2. Review the generated SQL
cat src/db/migrations/XXXX_description.sql

# 3. Test migration against local Supabase
npx supabase db push

# 4. Run integration tests to verify
npm run test:integration

# 5. Apply to staging (via CI/CD or manual)
DATABASE_URL=$STAGING_DB_URL npx drizzle-kit migrate

# 6. Apply to production (via CI/CD)
DATABASE_URL=$PRODUCTION_DB_URL npx drizzle-kit migrate
```

### Safety Rules

- **Never run `drizzle-kit push:pg` on production.** Always use explicit migrations.
- **Every migration must be reversible.** Write a corresponding down migration.
- **Test migrations against a copy of production data** before applying to production.
- **Column additions are safe.** Column removals, type changes, and constraint additions require careful planning.

---

## 9. CI/CD Pipeline

### GitHub Actions Workflow

```yaml
# .github/workflows/deploy.yml

name: Deploy

on:
  push:
    branches: [main]

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false  # Never cancel a deployment in progress

jobs:
  # ===== Step 1: Run Tests (reuse test workflow) =====
  test:
    uses: ./.github/workflows/test.yml
    secrets: inherit

  # ===== Step 2: Build & Deploy API =====
  deploy-api:
    needs: test
    runs-on: ubuntu-latest
    if: success()

    steps:
      - uses: actions/checkout@v4

      - name: Install Railway CLI
        run: npm install -g @railway/cli

      - name: Deploy API to Railway
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: |
          railway link --project ${{ secrets.RAILWAY_PROJECT_ID }} --service api
          railway up --service api

  # ===== Step 3: Build & Deploy AI Service =====
  deploy-ai-service:
    needs: test
    runs-on: ubuntu-latest
    if: success()

    steps:
      - uses: actions/checkout@v4

      - name: Install Railway CLI
        run: npm install -g @railway/cli

      - name: Deploy AI Service to Railway
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: |
          railway link --project ${{ secrets.RAILWAY_PROJECT_ID }} --service ai-service
          railway up --service ai-service

  # ===== Step 4: Run Migrations (after services are deployed) =====
  migrate:
    needs: [deploy-api, deploy-ai-service]
    runs-on: ubuntu-latest
    if: success()

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci
        working-directory: apps/api

      - name: Run database migrations
        env:
          DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}
        run: npx drizzle-kit migrate
        working-directory: apps/api
```

### Pipeline Flow

```
Push to main
  │
  ├── Run test suite (node-tests + python-tests + e2e-tests)
  │     │
  │     ├── All pass ──▶ Deploy api + ai-service to Railway (parallel)
  │     │                  │
  │     │                  └── Run database migrations
  │     │
  │     └── Any fail ──▶ Block deployment, notify team
```

---

## 10. Environment Separation

| Environment | Infrastructure | Database | Purpose |
|---|---|---|---|
| **development** | Local Docker (docker-compose) | Supabase CLI local instance | Daily development, hot reload, debugging |
| **staging** | Railway (staging project) | Supabase staging project | Pre-production testing, QA, demo |
| **production** | Railway (production project) | Supabase production project | Live customer traffic |

### Environment-Specific Configuration

| Variable | Development | Staging | Production |
|---|---|---|---|
| `NODE_ENV` | `development` | `staging` | `production` |
| `LOG_LEVEL` | `debug` | `info` | `info` |
| `DATABASE_URL` | `localhost:54322` | Supabase staging | Supabase production |
| `REDIS_URL` | `localhost:6379` | Railway staging Redis | Railway production Redis |
| `AI_SERVICE_URL` | `localhost:8000` | Railway staging internal | Railway production internal |
| `QUICKBOOKS_ENVIRONMENT` | `sandbox` | `sandbox` | `production` |
| `STRIPE_SECRET_KEY` | `sk_test_xxx` | `sk_test_xxx` | `sk_live_xxx` |
| `S3_BUCKET` | `crewshift-files-dev` | `crewshift-files-staging` | `crewshift-files` |

### Promoting Staging to Production

```bash
# Railway staging and production are separate projects.
# Promotion is done by merging the staging branch to main,
# which triggers the deploy workflow.

# 1. Test on staging
git checkout staging
git push origin staging  # Triggers staging deploy

# 2. Verify staging is working (manual QA + automated tests)

# 3. Merge to main (triggers production deploy)
git checkout main
git merge staging
git push origin main
```

---

## 11. Secrets Management

### Railway Encrypted Environment Variables

All secrets are stored as encrypted environment variables in Railway. They are:
- Encrypted at rest
- Injected into containers at runtime
- Never visible in logs (Railway masks them)
- Scoped per service and per environment

### What Goes Where

| Secret | Service | Notes |
|---|---|---|
| `DATABASE_URL` | api | Supabase connection string |
| `SUPABASE_SERVICE_ROLE_KEY` | api | Bypasses RLS for worker processes |
| `SUPABASE_JWT_SECRET` | api | Local JWT verification |
| `REDIS_URL` | api | Auto-populated by Railway Redis addon |
| `ANTHROPIC_API_KEY` | ai-service | Claude provider |
| `OPENAI_API_KEY` | ai-service | GPT provider |
| `GOOGLE_AI_API_KEY` | ai-service | Gemini provider |
| `DEEPGRAM_API_KEY` | ai-service | Speech-to-text |
| `VOYAGE_API_KEY` | ai-service | Embeddings |
| `QUICKBOOKS_CLIENT_SECRET` | api | OAuth secret |
| `STRIPE_SECRET_KEY` | api | Stripe API |
| `STRIPE_WEBHOOK_SECRET` | api | Webhook verification |
| `ENCRYPTION_KEY` | api | pgcrypto token encryption |
| `ANONYMIZATION_SALT` | api | Training data org hash salt |
| `RESEND_API_KEY` | api | Email sending |
| `AWS_SECRET_ACCESS_KEY` | api | S3/R2 file storage |

### Rules

1. **Never commit secrets to code.** Not in `.env` (git-ignored), not in comments, not in tests.
2. **Use `.env.example`** as the template. It contains variable names but no real values.
3. **Rotate secrets** when team members leave or when a breach is suspected.
4. **AI provider keys are only on ai-service.** The Node API never has direct access to LLM provider keys.
5. **Integration secrets are only on api.** The AI service never handles OAuth tokens or webhook secrets.

---

## 12. Scaling

### Railway Auto-Sleep (Free/Hobby Tier)

On Railway's free tier, services auto-sleep after 10 minutes of inactivity and wake on the next request. This adds ~2-5 seconds of cold start latency. Acceptable for development and early staging, not for production.

### Railway Pro Tier Scaling

On Railway Pro ($20/month per service):
- **Always-on:** No auto-sleep
- **Vertical scaling:** Adjust CPU and memory per service
- **Horizontal scaling:** Run multiple replicas of a service

### Recommended Resource Allocation

| Service | CPU | Memory | Replicas | Notes |
|---|---|---|---|---|
| **api** (development) | 0.5 vCPU | 512 MB | 1 | Sufficient for development |
| **api** (production, launch) | 1 vCPU | 1 GB | 1 | Handles ~100 concurrent connections |
| **api** (production, scale) | 2 vCPU | 2 GB | 2 | Horizontal scaling for 500+ concurrent |
| **ai-service** (development) | 0.5 vCPU | 512 MB | 1 | Mock mode uses minimal resources |
| **ai-service** (production, launch) | 1 vCPU | 1 GB | 1 | Most work is waiting on LLM API calls |
| **ai-service** (production, scale) | 1 vCPU | 1 GB | 2 | Scale horizontally for throughput |
| **Redis** | Managed | 256 MB | 1 | Railway addon, no configuration needed |

### Horizontal Scaling Considerations

When running multiple `api` replicas:

1. **BullMQ workers:** BullMQ handles multi-worker coordination natively via Redis. Multiple replicas can process jobs from the same queue without conflicts.

2. **Cron jobs:** Only one replica should run cron jobs. Use a leader election pattern or a dedicated cron worker:
   ```typescript
   // In scheduled jobs configuration
   if (process.env.ENABLE_CRON === 'true') {
     registerScheduledJobs();
   }
   // Set ENABLE_CRON=true on only one replica
   ```

3. **WebSocket/SSE connections:** Copilot SSE streams are per-request. No sticky sessions needed since each SSE response completes within the connection lifetime.

4. **Rate limiting:** Redis-based rate limiting works across replicas automatically (shared Redis).

---

## 13. Monitoring in Production

### Health Check Endpoints

```typescript
// apps/api/src/routes/health.routes.ts

app.get('/health', async (request, reply) => {
  const checks = {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks: {
      database: await checkDatabase(),
      redis: await checkRedis(),
      ai_service: await checkAIService(),
    },
  };

  const allHealthy = Object.values(checks.checks).every(c => c.status === 'ok');
  reply.status(allHealthy ? 200 : 503).send(checks);
});

async function checkDatabase(): Promise<HealthCheck> {
  try {
    await db.execute(sql`SELECT 1`);
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

async function checkRedis(): Promise<HealthCheck> {
  try {
    await redis.ping();
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

async function checkAIService(): Promise<HealthCheck> {
  try {
    const res = await fetch(`${env.AI_SERVICE_URL}/ai/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok ? { status: 'ok' } : { status: 'degraded' };
  } catch (error) {
    return { status: 'error', message: 'AI service unreachable' };
  }
}
```

### Railway Logs

Railway captures all stdout/stderr output from both services. Structured JSON logs (Pino for Node, structlog for Python) are searchable in the Railway dashboard.

```bash
# View live logs via Railway CLI
railway logs --service api
railway logs --service ai-service
```

### Uptime Monitoring

Use BetterUptime, UptimeRobot, or similar for external health checks:

| Endpoint | Check Interval | Alert After |
|---|---|---|
| `https://api.crewshift.com/health` | 60 seconds | 2 consecutive failures |
| `https://api.crewshift.com/health` (full check) | 5 minutes | 1 failure (checks DB + Redis + AI) |

---

## 14. Rollback

### Railway Deployment History

Railway keeps a history of every deployment. Rolling back is a one-click operation in the dashboard or via CLI:

```bash
# List recent deployments
railway deployments list --service api

# Rollback to a specific deployment
railway rollback --service api --deployment <deployment-id>
```

### Rollback Strategy

1. **Code rollback:** Railway redeploys the previous Docker image. Takes ~30 seconds.
2. **Database rollback:** Run the down migration for the most recent migration. This must be tested beforehand.
3. **Feature flags:** For risky features, use environment variables as feature flags rather than code branches:
   ```typescript
   if (env.ENABLE_NEW_COLLECTIONS_AGENT === 'true') {
     // New collections agent logic
   } else {
     // Existing logic
   }
   ```

### When to Rollback

- Error rate exceeds 5% for more than 5 minutes
- Health check fails for more than 2 minutes
- Agent execution success rate drops below 90%
- Any customer reports incorrect data being generated

---

## 15. Domain Setup

### Custom Domain on Railway

1. In Railway dashboard, go to the `api` service settings
2. Add custom domain: `api.crewshift.com`
3. Railway provides DNS records to configure:
   - CNAME record: `api.crewshift.com` -> `<project>.up.railway.app`
4. SSL certificate is automatically provisioned by Railway (Let's Encrypt)

### DNS Configuration

```
# DNS records (at domain registrar)
api.crewshift.com        CNAME    <project>.up.railway.app
app.crewshift.com        CNAME    <frontend-hosting>.vercel.app    # (future)
crewshift.com            A        <landing-page-ip>                 # (future)
```

### SSL

Railway provides automatic SSL via Let's Encrypt for all custom domains. No manual certificate management required. Certificates auto-renew before expiry.

---

## 16. Cost Estimation

### Railway Pricing

| Resource | Free Tier | Pro Tier ($20/service/month) |
|---|---|---|
| **Compute** | 500 hours/month (auto-sleep) | Always-on, per vCPU-hour |
| **Memory** | 512 MB | Configurable, per GB-hour |
| **Network** | 100 GB egress | Included |
| **Build** | 500 builds/month | Unlimited |
| **Redis addon** | $5/month (25 MB) | $10-50/month (100 MB - 1 GB) |

### Monthly Cost Estimates

| Phase | Services | Railway | Supabase | AI APIs | Storage | Total |
|---|---|---|---|---|---|---|
| **Development** | 2 services (free) | $0 | $0 (free tier) | ~$20 (testing) | $0 | **~$20/month** |
| **Launch (50 users)** | 2 services (Pro) | $50 | $25 (Pro) | ~$200 | $5 | **~$280/month** |
| **Growth (250 users)** | 2 services (Pro, scaled) | $100 | $25 (Pro) | ~$1,000 | $20 | **~$1,145/month** |
| **Scale (1,000 users)** | 2 services (Pro, multi-replica) | $200 | $75 (Pro, high compute) | ~$4,000 | $50 | **~$4,325/month** |

### Supabase Pricing

| Tier | Price | Includes | When |
|---|---|---|---|
| **Free** | $0/month | 500 MB database, 2 GB bandwidth, 50,000 auth users | Development |
| **Pro** | $25/month | 8 GB database, 250 GB bandwidth, unlimited auth users | Launch + |
| **Team** | $599/month | SOC2, priority support, PITR | Enterprise customers |

### Cost Optimization

1. **AI API costs dominate.** Focus optimization here first:
   - Use cheap models for classification (GPT-5 Nano)
   - Use capable models only for reasoning (Claude Sonnet)
   - Cache frequent queries in Redis
   - Batch non-urgent agent work to off-peak hours

2. **Railway costs are linear.** Each additional replica adds ~$20-40/month. This scales predictably.

3. **Supabase Pro at $25/month** covers the first 1,000+ users easily. The database is not the bottleneck.

4. **S3/R2 storage** is negligible. PDFs and photos are small. R2 has zero egress fees.

---

## 17. Summary

| Concern | Solution |
|---|---|
| **Hosting** | Railway (2 services + managed Redis) |
| **Database** | Supabase (external PostgreSQL + Auth) |
| **Containers** | Multi-stage Docker builds (Node 20 Alpine + Python 3.12 slim) |
| **Local dev** | docker-compose (Redis + AI service), native Node for fast iteration |
| **Internal comms** | Railway private networking (api -> ai-service, no public URL) |
| **Secrets** | Railway encrypted environment variables, never in code |
| **CI/CD** | GitHub Actions: test -> deploy -> migrate |
| **Environments** | development (local), staging (Railway), production (Railway) |
| **Migrations** | Drizzle ORM, plain SQL files, explicit migrate command |
| **Scaling** | Vertical (Railway resource sliders) + horizontal (replicas) |
| **Monitoring** | Health checks + Railway logs + external uptime monitoring |
| **Rollback** | Railway one-click deployment rollback |
| **SSL** | Automatic via Railway (Let's Encrypt) |
| **Cost** | ~$280/month at launch, scales linearly with users |
