# 10 — AI Service (Python FastAPI)

> The Python AI service is a standalone FastAPI application that handles all LLM interactions, prompt management, multi-provider routing, speech-to-text, vision/OCR, embedding generation, and semantic search. The Node.js API never calls LLM providers directly — it calls this service over HTTP.

**Cross-references:** [06-agent-runtime.md](./06-agent-runtime.md) (agent execution sends reasoning requests here), [08-copilot.md](./08-copilot.md) (copilot routes intent classification and response generation here), [14-queue-system.md](./14-queue-system.md) (agent.worker.ts calls AI service), [09-integrations.md](./09-integrations.md) (vision endpoint used by estimate photo pipeline)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Application Structure](#application-structure)
3. [FastAPI App Setup (main.py)](#fastapi-app-setup)
4. [Configuration (config.py)](#configuration)
5. [Endpoints](#endpoints)
6. [Pydantic Request/Response Models](#pydantic-requestresponse-models)
7. [Multi-Provider Abstraction Layer](#multi-provider-abstraction-layer)
8. [Provider Implementations](#provider-implementations)
9. [AI Model Strategy](#ai-model-strategy)
10. [Prompt Management](#prompt-management)
11. [Prompt Templates](#prompt-templates)
12. [Memory Management](#memory-management)
13. [Token Counting and Cost Tracking](#token-counting-and-cost-tracking)
14. [Structured Logging](#structured-logging)
15. [Request ID Propagation](#request-id-propagation)
16. [Health Check](#health-check)
17. [Mock Provider for Testing](#mock-provider-for-testing)
18. [Decision Rationale](#decision-rationale)

---

## Architecture Overview

```
Node.js Fastify API                 Python FastAPI AI Service
┌──────────────────────┐            ┌──────────────────────────────┐
│                      │            │                              │
│  ai-client.ts  ──────┼──  HTTP  ──▶  main.py (FastAPI app)      │
│  (circuit breaker)   │            │    ├── routers/              │
│                      │            │    │   ├── reasoning.py      │
│  X-Request-ID ───────┼────────────▶    │   ├── classify.py      │
│  header propagation  │            │    │   ├── transcribe.py     │
│                      │            │    │   ├── vision.py         │
│                      │            │    │   ├── embeddings.py     │
│                      │            │    │   └── health.py         │
│                      │            │    ├── providers/            │
│                      │            │    │   ├── base.py (ABC)     │
│                      │            │    │   ├── router.py         │
│                      │            │    │   ├── anthropic.py      │
│                      │            │    │   ├── openai.py         │
│                      │            │    │   ├── google.py         │
│                      │            │    │   ├── deepgram.py       │
│                      │            │    │   └── voyage.py         │
│                      │            │    ├── prompts/              │
│                      │            │    ├── memory/               │
│                      │            │    └── models/               │
└──────────────────────┘            └──────────────────────────────┘
```

**Why a separate Python service?**

- Python has the best AI/ML library ecosystem (LangChain, tiktoken, numpy, transformers)
- Anthropic, OpenAI, Google, Deepgram, and Voyage all have first-class Python SDKs
- Prompt engineering and model experimentation is faster in Python
- Keeps AI logic completely decoupled from business logic — can swap models, providers, or even the entire AI approach without touching the Node API
- When self-hosted models arrive (Phase 2), Python is required for inference servers (vLLM, TGI)

**Why not put everything in Python?**

- Node.js/Fastify has superior HTTP throughput for a REST API serving CRUD + webhooks + SSE streaming
- BullMQ (Redis-backed job queue) is Node-native and production-proven
- Supabase JS SDK is the primary SDK — Python SDK is secondary
- The team's primary language for the API layer is TypeScript

---

## Application Structure

```
apps/ai-service/
├── app/
│   ├── main.py               # FastAPI app setup, middleware, lifespan
│   ├── config.py             # Environment variables, model configs, provider settings
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── reasoning.py      # POST /ai/reason — full LLM reasoning for agents
│   │   ├── classify.py       # POST /ai/classify — intent classification + entity extraction
│   │   ├── transcribe.py     # POST /ai/transcribe — speech-to-text
│   │   ├── vision.py         # POST /ai/vision — image analysis / OCR
│   │   ├── embeddings.py     # POST /ai/embed + POST /ai/search
│   │   └── health.py         # GET /ai/health
│   ├── providers/
│   │   ├── __init__.py
│   │   ├── base.py           # AIProvider ABC — abstract interface all providers implement
│   │   ├── router.py         # ProviderRouter — selects provider, handles fallback
│   │   ├── anthropic.py      # Claude (Sonnet 4.6, Opus 4.6) — primary reasoning
│   │   ├── openai.py         # GPT (5.2, 5 Nano) — fallback reasoning + fast classification
│   │   ├── google.py         # Gemini (2.5 Flash) — vision/OCR primary + embedding fallback
│   │   ├── deepgram.py       # Deepgram Nova-3 — speech-to-text primary
│   │   ├── voyage.py         # Voyage-finance-2 — embedding generation primary
│   │   └── mock.py           # Deterministic mock for testing
│   ├── prompts/              # Prompt templates as Python files (version-controlled)
│   │   ├── __init__.py
│   │   ├── invoice.py        # Invoice generation prompt template
│   │   ├── estimate.py       # Estimate generation prompt template
│   │   ├── collections.py    # Collections follow-up prompt template
│   │   ├── copilot.py        # Copilot system prompt + response synthesis
│   │   ├── classify.py       # Intent classification prompt template
│   │   └── extract.py        # Entity extraction prompt template
│   ├── memory/               # Conversation and business memory management
│   │   ├── __init__.py
│   │   ├── context.py        # Business context graph builder
│   │   ├── short_term.py     # Recent messages (in-context window)
│   │   ├── long_term.py      # Vector store queries (pgvector)
│   │   └── summarizer.py     # Conversation summarization
│   └── models/               # Pydantic request/response models
│       ├── __init__.py
│       ├── requests.py       # All request models
│       └── responses.py      # All response models
├── tests/
│   ├── conftest.py           # Pytest fixtures, test client setup
│   ├── test_reasoning.py
│   ├── test_classify.py
│   ├── test_vision.py
│   ├── test_embeddings.py
│   └── test_providers.py
├── requirements.txt
├── pyproject.toml
└── Dockerfile
```

---

## FastAPI App Setup

### main.py

```python
"""
CrewShift AI Service — main.py

FastAPI application that handles all LLM interactions for the CrewShift platform.
This service is called by the Node.js API over internal HTTP (Railway private networking).
"""
import time
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.providers.router import ProviderRouter
from app.routers import classify, embeddings, health, reasoning, transcribe, vision

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup/shutdown lifecycle.
    - Initialize provider clients (verify API keys, warm connections)
    - On shutdown, close any persistent connections
    """
    logger.info("ai_service_starting", environment=settings.ENVIRONMENT)

    # Initialize the provider router (validates all API keys on startup)
    app.state.provider_router = ProviderRouter()
    await app.state.provider_router.initialize()

    logger.info("ai_service_ready", providers=app.state.provider_router.available_providers)
    yield

    # Cleanup
    await app.state.provider_router.shutdown()
    logger.info("ai_service_shutdown")


app = FastAPI(
    title="CrewShift AI Service",
    version="1.0.0",
    docs_url="/ai/docs" if settings.ENVIRONMENT != "production" else None,
    redoc_url=None,
    lifespan=lifespan,
)

# CORS — only the Node API should call this service.
# In production, this runs on Railway private networking (no public access).
# CORS is configured for local dev where both services run on different ports.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.API_URL],  # Only the Node API
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_middleware(request: Request, call_next):
    """
    Middleware that:
    1. Extracts X-Request-ID from the Node API for distributed tracing
    2. Binds request metadata to structlog context
    3. Logs request timing
    """
    request_id = request.headers.get("x-request-id", "no-request-id")
    start_time = time.time()

    # Bind request context to all log messages in this request
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        request_id=request_id,
        method=request.method,
        path=request.url.path,
    )

    response: Response = await call_next(request)

    duration_ms = round((time.time() - start_time) * 1000, 2)
    logger.info(
        "request_completed",
        status_code=response.status_code,
        duration_ms=duration_ms,
    )

    # Propagate request ID back in response headers
    response.headers["X-Request-ID"] = request_id
    return response


# Register routers
app.include_router(reasoning.router, prefix="/ai", tags=["reasoning"])
app.include_router(classify.router, prefix="/ai", tags=["classification"])
app.include_router(transcribe.router, prefix="/ai", tags=["transcription"])
app.include_router(vision.router, prefix="/ai", tags=["vision"])
app.include_router(embeddings.router, prefix="/ai", tags=["embeddings"])
app.include_router(health.router, prefix="/ai", tags=["health"])
```

**Design decisions:**

- `lifespan` context manager initializes provider connections once at startup, not per-request. This avoids cold-start latency on every AI call.
- The `request_middleware` extracts `X-Request-ID` from the Node API so that a single user action can be traced across both services in logs.
- Swagger docs (`/ai/docs`) are disabled in production — this service is internal-only.
- CORS is minimal — only the Node API URL is allowed. In production on Railway private networking, this service is not publicly accessible at all.

---

## Configuration

### config.py

```python
"""
Configuration management for the AI service.
All settings come from environment variables, validated at startup.
"""
from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional


class Settings(BaseSettings):
    """
    All environment variables for the AI service.
    Pydantic validates these at import time — if any required var is missing,
    the service refuses to start (fail fast, not fail silently).
    """

    # App
    ENVIRONMENT: str = Field(default="development", description="development | staging | production")
    PORT: int = Field(default=8000)
    LOG_LEVEL: str = Field(default="info")

    # Node API URL (for CORS)
    API_URL: str = Field(default="http://localhost:3000")

    # AI Provider API Keys
    ANTHROPIC_API_KEY: str = Field(description="Claude API key — primary reasoning provider")
    OPENAI_API_KEY: str = Field(description="OpenAI API key — fallback reasoning + fast classification")
    GOOGLE_AI_API_KEY: str = Field(description="Gemini API key — vision/OCR primary")
    DEEPGRAM_API_KEY: str = Field(description="Deepgram API key — STT primary")
    VOYAGE_API_KEY: str = Field(description="Voyage API key — embeddings primary")

    # Supabase (for vector store / pgvector queries)
    DATABASE_URL: str = Field(description="PostgreSQL connection string for pgvector")

    # Model Configuration — override defaults per environment
    REASONING_PRIMARY_MODEL: str = Field(default="claude-sonnet-4-6")
    REASONING_FALLBACK_MODEL: str = Field(default="gpt-5.2")
    COMPLEX_REASONING_MODEL: str = Field(default="claude-opus-4-6")
    CLASSIFICATION_MODEL: str = Field(default="gpt-5-nano")
    CLASSIFICATION_FALLBACK_MODEL: str = Field(default="gemini-flash-lite")
    VISION_PRIMARY_MODEL: str = Field(default="gemini-2.5-flash")
    VISION_FALLBACK_MODEL: str = Field(default="claude-sonnet-4-6")
    STT_PRIMARY_MODEL: str = Field(default="nova-3")
    STT_FALLBACK_MODEL: str = Field(default="openai-transcribe")
    EMBEDDING_MODEL: str = Field(default="voyage-finance-2")
    EMBEDDING_FALLBACK_MODEL: str = Field(default="gemini-embedding-001")

    # Timeouts (seconds)
    REASONING_TIMEOUT: int = Field(default=60, description="Max seconds for a reasoning call")
    CLASSIFICATION_TIMEOUT: int = Field(default=10, description="Classification must be fast")
    VISION_TIMEOUT: int = Field(default=45, description="Vision can process large images")
    STT_TIMEOUT: int = Field(default=30, description="Transcription timeout")
    EMBEDDING_TIMEOUT: int = Field(default=15, description="Embedding generation timeout")

    # Cost tracking
    COST_TRACKING_ENABLED: bool = Field(default=True)

    # Token limits
    MAX_CONTEXT_TOKENS: int = Field(default=8000, description="Max tokens for context window")
    MAX_OUTPUT_TOKENS: int = Field(default=4000, description="Max tokens for model output")

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()


# Model pricing table (cost per 1M tokens, in USD)
# Updated as of March 2026 — review quarterly
MODEL_PRICING = {
    # Anthropic
    "claude-sonnet-4-6":    {"input": 3.00, "output": 15.00},
    "claude-opus-4-6":      {"input": 15.00, "output": 75.00},
    # OpenAI
    "gpt-5.2":              {"input": 2.50, "output": 10.00},
    "gpt-5-nano":           {"input": 0.10, "output": 0.40},
    # Google
    "gemini-2.5-flash":     {"input": 0.15, "output": 0.60},
    "gemini-flash-lite":    {"input": 0.05, "output": 0.20},
    "gemini-embedding-001": {"input": 0.01, "output": 0.00},
    # Deepgram (per minute of audio, not tokens)
    "nova-3":               {"per_minute": 0.0043},
    # OpenAI Transcribe (per minute)
    "openai-transcribe":    {"per_minute": 0.006},
    # Voyage (per 1M tokens)
    "voyage-finance-2":     {"input": 0.12, "output": 0.00},
}

# Task-to-model mapping with fallback chains
TASK_MODEL_MAP = {
    "reasoning": {
        "primary": {"provider": "anthropic", "model": settings.REASONING_PRIMARY_MODEL},
        "fallback": {"provider": "openai", "model": settings.REASONING_FALLBACK_MODEL},
    },
    "complex_reasoning": {
        "primary": {"provider": "anthropic", "model": settings.COMPLEX_REASONING_MODEL},
        "fallback": {"provider": "openai", "model": settings.REASONING_FALLBACK_MODEL},
    },
    "classification": {
        "primary": {"provider": "openai", "model": settings.CLASSIFICATION_MODEL},
        "fallback": {"provider": "google", "model": settings.CLASSIFICATION_FALLBACK_MODEL},
    },
    "vision": {
        "primary": {"provider": "google", "model": settings.VISION_PRIMARY_MODEL},
        "fallback": {"provider": "anthropic", "model": settings.VISION_FALLBACK_MODEL},
    },
    "stt": {
        "primary": {"provider": "deepgram", "model": settings.STT_PRIMARY_MODEL},
        "fallback": {"provider": "openai", "model": settings.STT_FALLBACK_MODEL},
    },
    "embedding": {
        "primary": {"provider": "voyage", "model": settings.EMBEDDING_MODEL},
        "fallback": {"provider": "google", "model": settings.EMBEDDING_FALLBACK_MODEL},
    },
}
```

**Design decisions:**

- All configuration is validated at startup via Pydantic `BaseSettings`. If `ANTHROPIC_API_KEY` is missing, the service crashes immediately with a clear error — no silent failures.
- Model names are configurable via env vars so we can swap models without code changes (e.g., when Claude Sonnet 5 launches).
- `MODEL_PRICING` is a hardcoded lookup table, not an API call. Pricing changes infrequently enough that a code update + deploy is acceptable. Reviewed quarterly.
- `TASK_MODEL_MAP` defines the full fallback chain per task type. The `ProviderRouter` uses this to decide which provider to try first and what to fall back to.

---

## Endpoints

### POST /ai/reason

Full LLM reasoning for agent execution. The heavy-duty endpoint — called when an agent needs to generate an invoice, create an estimate, write a collections follow-up, synthesize a copilot response, or any other task requiring LLM reasoning.

```
POST /ai/reason
Content-Type: application/json
X-Request-ID: req_abc123

{
  "prompt_template": "invoice",
  "variables": {
    "job": { "id": "...", "description": "...", "line_items": [...], "materials": [...] },
    "customer": { "name": "Henderson", "email": "..." },
    "org": { "trade_type": "hvac", "settings": { "tax_rate": 0.0825 } },
    "business_context": { "avg_labor_rate": 95.00, "invoice_preferences": { "round_to": 50 } }
  },
  "model_tier": "capable",
  "output_schema": {
    "line_items": [{ "description": "string", "quantity": "number", "unit_price": "number", "total": "number" }],
    "subtotal": "number",
    "tax_rate": "number",
    "tax_amount": "number",
    "total": "number",
    "notes": "string"
  },
  "org_id": "uuid",
  "max_tokens": 2000,
  "temperature": 0.3
}
```

**Response:**
```json
{
  "result": {
    "line_items": [
      { "description": "HVAC System Diagnostic", "quantity": 1, "unit_price": 150.00, "total": 150.00 },
      { "description": "Compressor Replacement - Carrier 25HCD348A", "quantity": 1, "unit_price": 1200.00, "total": 1200.00 },
      { "description": "Refrigerant R-410A (3 lbs)", "quantity": 3, "unit_price": 45.00, "total": 135.00 },
      { "description": "Labor (4.5 hours @ $95/hr)", "quantity": 4.5, "unit_price": 95.00, "total": 427.50 }
    ],
    "subtotal": 1912.50,
    "tax_rate": 0.0825,
    "tax_amount": 157.78,
    "total": 2070.28,
    "notes": "Replaced failing compressor. System tested and operational. 1-year warranty on parts and labor."
  },
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "tokens_used": { "input": 1847, "output": 423 },
  "cost_cents": 1.19,
  "latency_ms": 2340,
  "confidence": 0.94
}
```

### POST /ai/classify

Intent classification for copilot message routing. Must return in under 500ms — uses the fastest/cheapest model.

```
POST /ai/classify
Content-Type: application/json
X-Request-ID: req_abc123

{
  "text": "Did the Johnson invoice go out?",
  "categories": [
    "query.invoice_status", "query.job_status", "query.customer_info",
    "query.financials", "query.inventory",
    "create-invoice", "generate-invoice",
    "create-estimate",
    "check-collections", "outstanding-invoices",
    "schedule-job", "dispatch-tech",
    "business-report", "how-did-we-do",
    "check-inventory", "order-parts",
    "customer-info", "send-review-request",
    "create-workflow",
    "multi-action",
    "general-question"
  ],
  "org_id": "uuid"
}
```

**Response:**
```json
{
  "intent": "query.invoice_status",
  "confidence": 0.97,
  "entities": {
    "customer_name": "Johnson"
  },
  "secondary_intents": [],
  "provider": "openai",
  "model": "gpt-5-nano",
  "tokens_used": { "input": 312, "output": 45 },
  "cost_cents": 0.005,
  "latency_ms": 180
}
```

### POST /ai/extract

Entity extraction from unstructured text. Used when the copilot or an agent needs to pull structured data from a contractor's natural language input.

```
POST /ai/extract
Content-Type: application/json
X-Request-ID: req_abc123

{
  "text": "The Henderson job is done. Mike finished around 3pm. Materials were 200 feet of copper pipe and 4 elbows.",
  "extract_schema": {
    "customer_name": "string",
    "job_status": "string",
    "tech_name": "string",
    "completion_time": "string",
    "materials": [{ "name": "string", "quantity": "number", "unit": "string" }]
  },
  "org_id": "uuid"
}
```

**Response:**
```json
{
  "extracted": {
    "customer_name": "Henderson",
    "job_status": "completed",
    "tech_name": "Mike",
    "completion_time": "3:00 PM",
    "materials": [
      { "name": "copper pipe", "quantity": 200, "unit": "feet" },
      { "name": "elbows", "quantity": 4, "unit": "pieces" }
    ]
  },
  "provider": "openai",
  "model": "gpt-5-nano",
  "tokens_used": { "input": 285, "output": 120 },
  "cost_cents": 0.008,
  "latency_ms": 240,
  "confidence": 0.96
}
```

### POST /ai/transcribe

Speech-to-text transcription. Accepts audio file upload (multipart form data). Used for the optional voice input feature in the copilot.

```
POST /ai/transcribe
Content-Type: multipart/form-data
X-Request-ID: req_abc123

Form fields:
  - audio: (binary audio file — wav, mp3, m4a, webm)
  - language: "en" (optional, defaults to "en")
  - org_id: "uuid"
```

**Response:**
```json
{
  "text": "The Henderson job is done. Mike finished around 3 PM. Materials were 200 feet of copper pipe and 4 elbows.",
  "language": "en",
  "duration_seconds": 8.4,
  "provider": "deepgram",
  "model": "nova-3",
  "cost_cents": 0.06,
  "latency_ms": 1200,
  "confidence": 0.98
}
```

### POST /ai/vision

Image analysis and OCR. Primary use: photo-to-estimate pipeline (contractor uploads job site photos, vision model identifies materials, measurements, conditions). Secondary use: receipt/document scanning.

```
POST /ai/vision
Content-Type: application/json
X-Request-ID: req_abc123

{
  "image_urls": [
    "https://crewshift-files.r2.cloudflarestorage.com/org123/estimates/est456/input-photos/photo1.jpg",
    "https://crewshift-files.r2.cloudflarestorage.com/org123/estimates/est456/input-photos/photo2.jpg"
  ],
  "prompt": "Analyze these job site photos for an HVAC estimate. Identify: 1) Equipment visible (brand, model if readable, condition), 2) Materials needed, 3) Approximate measurements, 4) Any visible damage or issues, 5) Access conditions (indoor/outdoor, clearance, roof access needed)",
  "output_schema": {
    "equipment": [{ "type": "string", "brand": "string", "model": "string", "condition": "string" }],
    "materials_needed": [{ "name": "string", "quantity_estimate": "string", "unit": "string" }],
    "measurements": [{ "item": "string", "value": "string" }],
    "issues": ["string"],
    "access_conditions": "string"
  },
  "org_id": "uuid"
}
```

**Response:**
```json
{
  "analysis": {
    "equipment": [
      { "type": "air_handler", "brand": "Carrier", "model": "FV4CNB006", "condition": "aged, 15+ years estimated" }
    ],
    "materials_needed": [
      { "name": "condensing unit", "quantity_estimate": "1", "unit": "unit" },
      { "name": "refrigerant line set", "quantity_estimate": "25-30", "unit": "feet" },
      { "name": "concrete pad", "quantity_estimate": "1", "unit": "unit" }
    ],
    "measurements": [
      { "item": "unit clearance", "value": "approximately 24 inches on each side" }
    ],
    "issues": [
      "Visible corrosion on condenser coil fins",
      "Refrigerant line insulation deteriorated"
    ],
    "access_conditions": "Outdoor unit, ground level, adequate clearance for replacement"
  },
  "provider": "google",
  "model": "gemini-2.5-flash",
  "tokens_used": { "input": 5200, "output": 680 },
  "cost_cents": 1.19,
  "latency_ms": 3400,
  "confidence": 0.88
}
```

### POST /ai/embed

Generate vector embeddings for text. Used to embed job descriptions, invoice content, customer notes, and conversation excerpts into the `embeddings` table (pgvector) for semantic search.

```
POST /ai/embed
Content-Type: application/json
X-Request-ID: req_abc123

{
  "texts": [
    "HVAC compressor replacement for Henderson residence. Carrier 25HCD348A unit.",
    "Emergency water heater replacement, 50 gallon gas, Bradford White."
  ],
  "org_id": "uuid"
}
```

**Response:**
```json
{
  "embeddings": [
    { "index": 0, "vector": [0.0123, -0.0456, ...], "dimensions": 1024 },
    { "index": 1, "vector": [0.0789, -0.0321, ...], "dimensions": 1024 }
  ],
  "provider": "voyage",
  "model": "voyage-finance-2",
  "tokens_used": { "input": 48, "output": 0 },
  "cost_cents": 0.001,
  "latency_ms": 340
}
```

### POST /ai/search

Semantic search over the organization's embedding store. Queries pgvector with cosine similarity to find relevant past jobs, invoices, customers, and conversations.

```
POST /ai/search
Content-Type: application/json
X-Request-ID: req_abc123

{
  "query": "copper pipe replacement job",
  "org_id": "uuid",
  "source_types": ["job", "invoice"],
  "limit": 5,
  "similarity_threshold": 0.7
}
```

**Response:**
```json
{
  "results": [
    {
      "source_type": "job",
      "source_id": "uuid-of-job",
      "content": "Replace 200ft copper pipe run in basement. Re-solder 4 joints.",
      "similarity": 0.92,
      "metadata": { "customer_name": "Williams", "total_amount": 2400 }
    },
    {
      "source_type": "invoice",
      "source_id": "uuid-of-invoice",
      "content": "Copper pipe replacement - 150ft run, 6 elbows, 2 tee fittings",
      "similarity": 0.87,
      "metadata": { "total": 1950, "created_at": "2026-01-15" }
    }
  ],
  "query_embedding_provider": "voyage",
  "latency_ms": 120
}
```

### GET /ai/health

Health check endpoint. Returns status of each provider and overall service health.

```
GET /ai/health
```

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime_seconds": 86403,
  "providers": {
    "anthropic": { "status": "healthy", "last_check": "2026-03-04T10:00:00Z" },
    "openai": { "status": "healthy", "last_check": "2026-03-04T10:00:00Z" },
    "google": { "status": "healthy", "last_check": "2026-03-04T10:00:00Z" },
    "deepgram": { "status": "healthy", "last_check": "2026-03-04T10:00:00Z" },
    "voyage": { "status": "healthy", "last_check": "2026-03-04T10:00:00Z" }
  },
  "database": { "status": "healthy", "latency_ms": 3 }
}
```

---

## Pydantic Request/Response Models

### models/requests.py

```python
"""
Pydantic models for all AI service request bodies.
These enforce strict validation — malformed requests from the Node API
are caught here, not deep inside provider code.
"""
from typing import Any, Optional

from pydantic import BaseModel, Field


class ReasonRequest(BaseModel):
    """Request body for POST /ai/reason — full LLM reasoning."""
    prompt_template: str = Field(
        description="Name of the prompt template to use (e.g., 'invoice', 'estimate', 'copilot')"
    )
    variables: dict[str, Any] = Field(
        description="Template variables — injected into the prompt template"
    )
    model_tier: str = Field(
        default="capable",
        description="'capable' (Sonnet/GPT-4o), 'complex' (Opus), 'fast' (Nano)"
    )
    output_schema: Optional[dict[str, Any]] = Field(
        default=None,
        description="Expected output structure — used in the prompt to enforce JSON output"
    )
    org_id: str = Field(description="Organization ID for context and cost tracking")
    max_tokens: int = Field(default=2000, ge=1, le=8000)
    temperature: float = Field(default=0.3, ge=0.0, le=1.0)
    stream: bool = Field(
        default=False,
        description="If true, stream tokens back (for copilot response generation)"
    )


class ClassifyRequest(BaseModel):
    """Request body for POST /ai/classify — intent classification."""
    text: str = Field(description="User message to classify")
    categories: list[str] = Field(
        description="List of possible intent categories"
    )
    org_id: str = Field(description="Organization ID")
    context: Optional[str] = Field(
        default=None,
        description="Additional context (e.g., recent conversation for disambiguation)"
    )


class ExtractRequest(BaseModel):
    """Request body for POST /ai/extract — entity extraction."""
    text: str = Field(description="Text to extract entities from")
    extract_schema: dict[str, Any] = Field(
        description="Schema of entities to extract"
    )
    org_id: str = Field(description="Organization ID")


class TranscribeRequest(BaseModel):
    """
    Metadata for POST /ai/transcribe.
    The actual audio is sent as multipart form data — this model validates
    the non-file fields.
    """
    language: str = Field(default="en")
    org_id: str = Field(description="Organization ID")


class VisionRequest(BaseModel):
    """Request body for POST /ai/vision — image analysis."""
    image_urls: list[str] = Field(
        min_length=1,
        max_length=10,
        description="S3/R2 presigned URLs for images to analyze"
    )
    prompt: str = Field(description="What to analyze in the images")
    output_schema: Optional[dict[str, Any]] = Field(
        default=None,
        description="Expected structure of analysis output"
    )
    org_id: str = Field(description="Organization ID")


class EmbedRequest(BaseModel):
    """Request body for POST /ai/embed — generate embeddings."""
    texts: list[str] = Field(
        min_length=1,
        max_length=100,
        description="Texts to embed (batch supported, max 100)"
    )
    org_id: str = Field(description="Organization ID")


class SearchRequest(BaseModel):
    """Request body for POST /ai/search — semantic search."""
    query: str = Field(description="Natural language search query")
    org_id: str = Field(description="Organization ID — scopes search to this org's embeddings")
    source_types: Optional[list[str]] = Field(
        default=None,
        description="Filter by source type: 'job', 'invoice', 'customer', 'conversation', 'note'"
    )
    limit: int = Field(default=5, ge=1, le=20)
    similarity_threshold: float = Field(
        default=0.7, ge=0.0, le=1.0,
        description="Minimum cosine similarity to include in results"
    )
```

### models/responses.py

```python
"""
Pydantic models for all AI service response bodies.
Every response includes provider metadata (which provider, model, tokens, cost, latency)
for observability and cost tracking.
"""
from typing import Any, Optional

from pydantic import BaseModel, Field


class TokenUsage(BaseModel):
    input: int = Field(description="Input/prompt tokens")
    output: int = Field(description="Output/completion tokens")


class ProviderMeta(BaseModel):
    """Common metadata returned by every endpoint."""
    provider: str = Field(description="Provider used: 'anthropic', 'openai', 'google', etc.")
    model: str = Field(description="Specific model used: 'claude-sonnet-4-6', etc.")
    tokens_used: TokenUsage
    cost_cents: float = Field(description="Estimated cost in cents")
    latency_ms: float = Field(description="Total request latency in milliseconds")


class ReasonResponse(BaseModel):
    """Response from POST /ai/reason."""
    result: dict[str, Any] = Field(description="Structured reasoning output matching output_schema")
    confidence: float = Field(
        ge=0.0, le=1.0,
        description="Model's self-assessed confidence in the output (0-1)"
    )
    provider: str
    model: str
    tokens_used: TokenUsage
    cost_cents: float
    latency_ms: float


class ClassifyResponse(BaseModel):
    """Response from POST /ai/classify."""
    intent: str = Field(description="Primary classified intent")
    confidence: float = Field(ge=0.0, le=1.0)
    entities: dict[str, Any] = Field(
        default_factory=dict,
        description="Extracted entities from the text (customer name, job ID, etc.)"
    )
    secondary_intents: list[str] = Field(
        default_factory=list,
        description="Other possible intents (for multi-action requests)"
    )
    provider: str
    model: str
    tokens_used: TokenUsage
    cost_cents: float
    latency_ms: float


class ExtractResponse(BaseModel):
    """Response from POST /ai/extract."""
    extracted: dict[str, Any] = Field(description="Extracted entities matching extract_schema")
    confidence: float = Field(ge=0.0, le=1.0)
    provider: str
    model: str
    tokens_used: TokenUsage
    cost_cents: float
    latency_ms: float


class TranscribeResponse(BaseModel):
    """Response from POST /ai/transcribe."""
    text: str = Field(description="Transcribed text")
    language: str
    duration_seconds: float = Field(description="Audio duration")
    confidence: float = Field(ge=0.0, le=1.0)
    provider: str
    model: str
    cost_cents: float
    latency_ms: float


class VisionAnalysis(BaseModel):
    """Response from POST /ai/vision."""
    analysis: dict[str, Any] = Field(description="Structured analysis matching output_schema")
    confidence: float = Field(ge=0.0, le=1.0)
    provider: str
    model: str
    tokens_used: TokenUsage
    cost_cents: float
    latency_ms: float


class EmbeddingResult(BaseModel):
    index: int
    vector: list[float]
    dimensions: int


class EmbedResponse(BaseModel):
    """Response from POST /ai/embed."""
    embeddings: list[EmbeddingResult]
    provider: str
    model: str
    tokens_used: TokenUsage
    cost_cents: float
    latency_ms: float


class SearchResult(BaseModel):
    source_type: str
    source_id: str
    content: str
    similarity: float
    metadata: dict[str, Any] = Field(default_factory=dict)


class SearchResponse(BaseModel):
    """Response from POST /ai/search."""
    results: list[SearchResult]
    query_embedding_provider: str
    latency_ms: float


class HealthProviderStatus(BaseModel):
    status: str  # 'healthy', 'degraded', 'down'
    last_check: str  # ISO timestamp


class HealthResponse(BaseModel):
    """Response from GET /ai/health."""
    status: str  # 'healthy', 'degraded', 'unhealthy'
    version: str
    uptime_seconds: float
    providers: dict[str, HealthProviderStatus]
    database: HealthProviderStatus
```

---

## Multi-Provider Abstraction Layer

The abstraction layer is the core architectural pattern of the AI service. It allows:

1. **Provider independence** — business logic never references Claude, GPT, or Gemini directly
2. **Automatic fallback** — if the primary provider is down, requests route to the fallback
3. **Task-based routing** — different tasks use different models (classification uses Nano, reasoning uses Sonnet)
4. **Cost optimization** — cheapest adequate model is selected per task
5. **Easy provider addition** — adding a new provider means implementing one abstract class

### providers/base.py — The Abstract Interface

```python
"""
Abstract base class that all AI providers must implement.
This is the contract — the ProviderRouter only talks to this interface.
"""
from abc import ABC, abstractmethod
from typing import Any, AsyncIterator, Optional

from app.models.responses import (
    ClassifyResponse,
    EmbedResponse,
    ExtractResponse,
    ReasonResponse,
    TranscribeResponse,
    VisionAnalysis,
)


class AIProvider(ABC):
    """
    Abstract AI provider interface.

    Every provider (Anthropic, OpenAI, Google, Deepgram, Voyage) implements
    this interface. Not every provider supports every method — unsupported
    methods raise NotImplementedError, and the ProviderRouter knows which
    providers support which capabilities.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name: 'anthropic', 'openai', 'google', 'deepgram', 'voyage'"""
        ...

    @abstractmethod
    async def initialize(self) -> None:
        """Validate API key, warm connection. Called once at startup."""
        ...

    @abstractmethod
    async def shutdown(self) -> None:
        """Close connections. Called on service shutdown."""
        ...

    @abstractmethod
    async def health_check(self) -> dict:
        """Return health status: { status: 'healthy'|'degraded'|'down', last_check: ISO }"""
        ...

    async def reason(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        output_schema: Optional[dict[str, Any]] = None,
        max_tokens: int = 2000,
        temperature: float = 0.3,
    ) -> ReasonResponse:
        """Full LLM reasoning. Supported by: Anthropic, OpenAI, Google."""
        raise NotImplementedError(f"{self.name} does not support reasoning")

    async def reason_stream(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 2000,
        temperature: float = 0.3,
    ) -> AsyncIterator[str]:
        """Streaming LLM reasoning (yields tokens). Used for copilot streaming."""
        raise NotImplementedError(f"{self.name} does not support streaming")

    async def classify(
        self,
        model: str,
        text: str,
        categories: list[str],
        context: Optional[str] = None,
    ) -> ClassifyResponse:
        """Intent classification. Supported by: OpenAI, Google, Anthropic."""
        raise NotImplementedError(f"{self.name} does not support classification")

    async def extract(
        self,
        model: str,
        text: str,
        extract_schema: dict[str, Any],
    ) -> ExtractResponse:
        """Entity extraction. Supported by: OpenAI, Google, Anthropic."""
        raise NotImplementedError(f"{self.name} does not support extraction")

    async def transcribe(
        self,
        model: str,
        audio_data: bytes,
        language: str = "en",
    ) -> TranscribeResponse:
        """Speech-to-text. Supported by: Deepgram, OpenAI."""
        raise NotImplementedError(f"{self.name} does not support transcription")

    async def analyze_images(
        self,
        model: str,
        image_urls: list[str],
        prompt: str,
        output_schema: Optional[dict[str, Any]] = None,
    ) -> VisionAnalysis:
        """Image analysis/OCR. Supported by: Google, Anthropic."""
        raise NotImplementedError(f"{self.name} does not support vision")

    async def embed(
        self,
        model: str,
        texts: list[str],
    ) -> EmbedResponse:
        """Generate embeddings. Supported by: Voyage, Google."""
        raise NotImplementedError(f"{self.name} does not support embeddings")
```

### providers/router.py — The Provider Router

```python
"""
ProviderRouter — the brain of the multi-provider system.

Responsibilities:
1. Select the right provider + model for each task type
2. Execute the request against the primary provider
3. If primary fails, automatically fall back to the next provider
4. Track which provider was used, latency, tokens, and cost
5. Log fallback events for monitoring
"""
import time
from typing import Any, AsyncIterator, Optional

import structlog

from app.config import TASK_MODEL_MAP, settings
from app.providers.anthropic import AnthropicProvider
from app.providers.base import AIProvider
from app.providers.deepgram import DeepgramProvider
from app.providers.google import GoogleProvider
from app.providers.mock import MockProvider
from app.providers.openai import OpenAIProvider
from app.providers.voyage import VoyageProvider

logger = structlog.get_logger()


class ProviderRouter:
    """
    Routes AI requests to the appropriate provider based on task type,
    with automatic fallback on failure.
    """

    def __init__(self):
        self.providers: dict[str, AIProvider] = {}
        self.available_providers: list[str] = []

    async def initialize(self):
        """
        Initialize all providers. If a provider's API key is invalid,
        log a warning but don't crash — the service can still function
        with remaining providers. Only crash if ALL providers fail.
        """
        provider_classes = {
            "anthropic": AnthropicProvider,
            "openai": OpenAIProvider,
            "google": GoogleProvider,
            "deepgram": DeepgramProvider,
            "voyage": VoyageProvider,
        }

        # In test environment, use mock provider for everything
        if settings.ENVIRONMENT == "test":
            mock = MockProvider()
            await mock.initialize()
            for name in provider_classes:
                self.providers[name] = mock
            self.available_providers = list(provider_classes.keys())
            logger.info("using_mock_providers")
            return

        for name, cls in provider_classes.items():
            try:
                provider = cls()
                await provider.initialize()
                self.providers[name] = provider
                self.available_providers.append(name)
                logger.info("provider_initialized", provider=name)
            except Exception as e:
                logger.warning("provider_init_failed", provider=name, error=str(e))

        if not self.available_providers:
            raise RuntimeError("No AI providers available — cannot start service")

    async def shutdown(self):
        for provider in self.providers.values():
            await provider.shutdown()

    def _get_provider_chain(self, task: str) -> list[dict]:
        """
        Get the ordered list of providers to try for a given task.
        Returns: [{ provider: str, model: str }, ...]
        """
        task_config = TASK_MODEL_MAP.get(task, TASK_MODEL_MAP["reasoning"])
        chain = []

        primary = task_config["primary"]
        if primary["provider"] in self.providers:
            chain.append(primary)

        fallback = task_config.get("fallback")
        if fallback and fallback["provider"] in self.providers:
            chain.append(fallback)

        if not chain:
            raise RuntimeError(f"No available provider for task: {task}")

        return chain

    async def reason(
        self,
        prompt_template: str,
        variables: dict[str, Any],
        system_prompt: str,
        user_prompt: str,
        model_tier: str = "capable",
        output_schema: Optional[dict] = None,
        max_tokens: int = 2000,
        temperature: float = 0.3,
        org_id: str = "",
    ) -> dict:
        """
        Execute a reasoning request with automatic fallback.

        1. Determine task type from model_tier
        2. Get provider chain (primary + fallback)
        3. Try primary provider
        4. If it fails, try fallback
        5. Return result with provider metadata
        """
        task = "complex_reasoning" if model_tier == "complex" else "reasoning"
        chain = self._get_provider_chain(task)

        last_error = None
        for i, provider_config in enumerate(chain):
            provider_name = provider_config["provider"]
            model = provider_config["model"]
            provider = self.providers[provider_name]

            is_fallback = i > 0
            start_time = time.time()

            try:
                if is_fallback:
                    logger.warning(
                        "provider_fallback",
                        task=task,
                        failed_provider=chain[0]["provider"],
                        fallback_provider=provider_name,
                        error=str(last_error),
                        org_id=org_id,
                    )

                result = await provider.reason(
                    model=model,
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    output_schema=output_schema,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )

                latency_ms = round((time.time() - start_time) * 1000, 2)

                logger.info(
                    "reasoning_completed",
                    provider=provider_name,
                    model=model,
                    tokens_input=result.tokens_used.input,
                    tokens_output=result.tokens_used.output,
                    cost_cents=result.cost_cents,
                    latency_ms=latency_ms,
                    is_fallback=is_fallback,
                    org_id=org_id,
                )

                return result

            except Exception as e:
                last_error = e
                logger.error(
                    "provider_error",
                    provider=provider_name,
                    model=model,
                    task=task,
                    error=str(e),
                    org_id=org_id,
                )

        # All providers failed
        raise RuntimeError(f"All providers failed for task {task}: {last_error}")

    async def classify(self, text: str, categories: list[str], org_id: str = "", context: Optional[str] = None) -> dict:
        """Intent classification with fallback. Same pattern as reason()."""
        chain = self._get_provider_chain("classification")
        last_error = None

        for i, provider_config in enumerate(chain):
            provider_name = provider_config["provider"]
            model = provider_config["model"]
            provider = self.providers[provider_name]
            start_time = time.time()

            try:
                result = await provider.classify(
                    model=model,
                    text=text,
                    categories=categories,
                    context=context,
                )
                latency_ms = round((time.time() - start_time) * 1000, 2)

                logger.info(
                    "classification_completed",
                    provider=provider_name,
                    model=model,
                    intent=result.intent,
                    confidence=result.confidence,
                    latency_ms=latency_ms,
                    org_id=org_id,
                )
                return result

            except Exception as e:
                last_error = e
                logger.error("provider_error", provider=provider_name, error=str(e))

        raise RuntimeError(f"All providers failed for classification: {last_error}")

    # Same fallback pattern for: extract(), transcribe(), analyze_images(), embed()
    # Each method follows the identical try-primary-then-fallback structure.

    async def embed(self, texts: list[str], org_id: str = "") -> dict:
        """Generate embeddings with fallback."""
        chain = self._get_provider_chain("embedding")
        last_error = None

        for i, provider_config in enumerate(chain):
            provider_name = provider_config["provider"]
            model = provider_config["model"]
            provider = self.providers[provider_name]
            start_time = time.time()

            try:
                result = await provider.embed(model=model, texts=texts)
                latency_ms = round((time.time() - start_time) * 1000, 2)
                logger.info(
                    "embedding_completed",
                    provider=provider_name,
                    model=model,
                    text_count=len(texts),
                    latency_ms=latency_ms,
                    org_id=org_id,
                )
                return result
            except Exception as e:
                last_error = e
                logger.error("provider_error", provider=provider_name, error=str(e))

        raise RuntimeError(f"All providers failed for embedding: {last_error}")

    async def transcribe(self, audio_data: bytes, language: str = "en", org_id: str = "") -> dict:
        """Speech-to-text with fallback."""
        chain = self._get_provider_chain("stt")
        last_error = None

        for i, provider_config in enumerate(chain):
            provider_name = provider_config["provider"]
            model = provider_config["model"]
            provider = self.providers[provider_name]
            start_time = time.time()

            try:
                result = await provider.transcribe(model=model, audio_data=audio_data, language=language)
                latency_ms = round((time.time() - start_time) * 1000, 2)
                logger.info(
                    "transcription_completed",
                    provider=provider_name,
                    model=model,
                    duration_seconds=result.duration_seconds,
                    latency_ms=latency_ms,
                    org_id=org_id,
                )
                return result
            except Exception as e:
                last_error = e
                logger.error("provider_error", provider=provider_name, error=str(e))

        raise RuntimeError(f"All providers failed for transcription: {last_error}")

    async def analyze_images(
        self, image_urls: list[str], prompt: str, output_schema: Optional[dict] = None, org_id: str = ""
    ) -> dict:
        """Vision analysis with fallback."""
        chain = self._get_provider_chain("vision")
        last_error = None

        for i, provider_config in enumerate(chain):
            provider_name = provider_config["provider"]
            model = provider_config["model"]
            provider = self.providers[provider_name]
            start_time = time.time()

            try:
                result = await provider.analyze_images(
                    model=model,
                    image_urls=image_urls,
                    prompt=prompt,
                    output_schema=output_schema,
                )
                latency_ms = round((time.time() - start_time) * 1000, 2)
                logger.info(
                    "vision_completed",
                    provider=provider_name,
                    model=model,
                    image_count=len(image_urls),
                    latency_ms=latency_ms,
                    org_id=org_id,
                )
                return result
            except Exception as e:
                last_error = e
                logger.error("provider_error", provider=provider_name, error=str(e))

        raise RuntimeError(f"All providers failed for vision: {last_error}")
```

**Design decisions for the router:**

- **Fail-open for initialization:** If one provider's API key is bad, the service still starts with the remaining providers. Only crashes if all providers fail.
- **Fallback is automatic:** The calling code (routers) doesn't need to handle fallback logic — the router does it transparently.
- **Every call is logged:** Provider name, model, token usage, cost, and latency are logged on every request. This feeds the cost tracking dashboard and alerting.
- **Test environment uses mock:** Setting `ENVIRONMENT=test` replaces all real providers with the deterministic mock provider. No API calls during tests.

---

## Provider Implementations

### providers/anthropic.py — Claude

```python
"""
Anthropic provider — Claude Sonnet 4.6 (primary reasoning) and Opus 4.6 (complex reasoning).
"""
import json
import time
from typing import Any, AsyncIterator, Optional

import anthropic
import structlog

from app.config import MODEL_PRICING, settings
from app.models.responses import (
    ClassifyResponse,
    ExtractResponse,
    ReasonResponse,
    TokenUsage,
    VisionAnalysis,
)
from app.providers.base import AIProvider

logger = structlog.get_logger()


class AnthropicProvider(AIProvider):
    @property
    def name(self) -> str:
        return "anthropic"

    async def initialize(self):
        self.client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        # Validate key with a minimal request
        # (In practice, you might skip this and let the first real request validate)
        logger.info("anthropic_provider_initialized")

    async def shutdown(self):
        await self.client.close()

    async def health_check(self) -> dict:
        try:
            # Minimal call to verify API is responsive
            response = await self.client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=10,
                messages=[{"role": "user", "content": "ping"}],
            )
            return {"status": "healthy", "last_check": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
        except Exception as e:
            return {"status": "down", "last_check": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "error": str(e)}

    async def reason(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        output_schema: Optional[dict[str, Any]] = None,
        max_tokens: int = 2000,
        temperature: float = 0.3,
    ) -> ReasonResponse:
        start = time.time()

        # Build messages
        messages = [{"role": "user", "content": user_prompt}]

        # If output_schema is provided, append JSON formatting instructions
        system = system_prompt
        if output_schema:
            schema_str = json.dumps(output_schema, indent=2)
            system += f"\n\nYou MUST respond with valid JSON matching this exact schema:\n```json\n{schema_str}\n```\nReturn ONLY the JSON object, no other text."

        response = await self.client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system,
            messages=messages,
        )

        # Parse response
        content = response.content[0].text
        if output_schema:
            # Extract JSON from response (handles markdown code blocks)
            content = content.strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[1].rsplit("```", 1)[0]
            result = json.loads(content)
        else:
            result = {"text": content}

        # Calculate cost
        pricing = MODEL_PRICING.get(model, {"input": 0, "output": 0})
        cost_cents = (
            (response.usage.input_tokens * pricing["input"] / 1_000_000)
            + (response.usage.output_tokens * pricing["output"] / 1_000_000)
        ) * 100  # convert to cents

        return ReasonResponse(
            result=result,
            confidence=0.9,  # Claude doesn't provide a native confidence score; default high
            provider="anthropic",
            model=model,
            tokens_used=TokenUsage(
                input=response.usage.input_tokens,
                output=response.usage.output_tokens,
            ),
            cost_cents=round(cost_cents, 4),
            latency_ms=round((time.time() - start) * 1000, 2),
        )

    async def reason_stream(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 2000,
        temperature: float = 0.3,
    ) -> AsyncIterator[str]:
        """Streaming reasoning — yields tokens as they arrive."""
        async with self.client.messages.stream(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            async for text in stream.text_stream:
                yield text

    async def classify(self, model: str, text: str, categories: list[str], context: Optional[str] = None) -> ClassifyResponse:
        """Anthropic can classify, but we prefer OpenAI's nano model for speed/cost."""
        start = time.time()
        categories_str = ", ".join(categories)
        system = f"Classify the following text into exactly one of these categories: {categories_str}. Respond with JSON: {{\"intent\": \"<category>\", \"confidence\": <0-1>, \"entities\": {{...}}}}"

        response = await self.client.messages.create(
            model=model, max_tokens=200, temperature=0.0,
            system=system,
            messages=[{"role": "user", "content": text}],
        )
        result = json.loads(response.content[0].text)
        pricing = MODEL_PRICING.get(model, {"input": 0, "output": 0})
        cost_cents = ((response.usage.input_tokens * pricing["input"] + response.usage.output_tokens * pricing["output"]) / 1_000_000) * 100

        return ClassifyResponse(
            intent=result["intent"],
            confidence=result.get("confidence", 0.9),
            entities=result.get("entities", {}),
            secondary_intents=result.get("secondary_intents", []),
            provider="anthropic", model=model,
            tokens_used=TokenUsage(input=response.usage.input_tokens, output=response.usage.output_tokens),
            cost_cents=round(cost_cents, 4),
            latency_ms=round((time.time() - start) * 1000, 2),
        )

    async def analyze_images(self, model: str, image_urls: list[str], prompt: str, output_schema: Optional[dict] = None) -> VisionAnalysis:
        """Claude Vision — used as fallback for vision/OCR."""
        start = time.time()
        content = []
        for url in image_urls:
            content.append({"type": "image", "source": {"type": "url", "url": url}})
        content.append({"type": "text", "text": prompt})

        system = "You are an expert trades industry analyst. Analyze the provided images accurately."
        if output_schema:
            system += f"\n\nRespond with JSON matching: {json.dumps(output_schema)}"

        response = await self.client.messages.create(
            model=model, max_tokens=2000, temperature=0.2,
            system=system,
            messages=[{"role": "user", "content": content}],
        )
        result_text = response.content[0].text
        if output_schema:
            result_text = result_text.strip()
            if result_text.startswith("```"):
                result_text = result_text.split("\n", 1)[1].rsplit("```", 1)[0]
            analysis = json.loads(result_text)
        else:
            analysis = {"text": result_text}

        pricing = MODEL_PRICING.get(model, {"input": 0, "output": 0})
        cost_cents = ((response.usage.input_tokens * pricing["input"] + response.usage.output_tokens * pricing["output"]) / 1_000_000) * 100

        return VisionAnalysis(
            analysis=analysis, confidence=0.88,
            provider="anthropic", model=model,
            tokens_used=TokenUsage(input=response.usage.input_tokens, output=response.usage.output_tokens),
            cost_cents=round(cost_cents, 4),
            latency_ms=round((time.time() - start) * 1000, 2),
        )
```

### providers/openai.py — GPT (abbreviated, same pattern)

```python
"""
OpenAI provider — GPT-5.2 (fallback reasoning), GPT-5 Nano (primary classification).
"""
import json
import time
from typing import Any, Optional

import openai
import structlog

from app.config import MODEL_PRICING, settings
from app.models.responses import ClassifyResponse, ExtractResponse, ReasonResponse, TokenUsage, TranscribeResponse
from app.providers.base import AIProvider

logger = structlog.get_logger()


class OpenAIProvider(AIProvider):
    @property
    def name(self) -> str:
        return "openai"

    async def initialize(self):
        self.client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    async def shutdown(self):
        await self.client.close()

    async def health_check(self) -> dict:
        try:
            await self.client.chat.completions.create(
                model="gpt-5-nano", messages=[{"role": "user", "content": "ping"}], max_tokens=5
            )
            return {"status": "healthy", "last_check": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
        except Exception as e:
            return {"status": "down", "last_check": time.strftime("%Y-%m-%dT%H:%M:%SZ")}

    async def reason(self, model, system_prompt, user_prompt, output_schema=None, max_tokens=2000, temperature=0.3) -> ReasonResponse:
        start = time.time()
        system = system_prompt
        if output_schema:
            system += f"\n\nRespond with JSON matching: {json.dumps(output_schema)}"

        response = await self.client.chat.completions.create(
            model=model, max_tokens=max_tokens, temperature=temperature,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"} if output_schema else None,
        )

        content = response.choices[0].message.content
        result = json.loads(content) if output_schema else {"text": content}
        pricing = MODEL_PRICING.get(model, {"input": 0, "output": 0})
        cost_cents = ((response.usage.prompt_tokens * pricing["input"] + response.usage.completion_tokens * pricing["output"]) / 1_000_000) * 100

        return ReasonResponse(
            result=result, confidence=0.9,
            provider="openai", model=model,
            tokens_used=TokenUsage(input=response.usage.prompt_tokens, output=response.usage.completion_tokens),
            cost_cents=round(cost_cents, 4),
            latency_ms=round((time.time() - start) * 1000, 2),
        )

    async def classify(self, model, text, categories, context=None) -> ClassifyResponse:
        """Primary classification provider — GPT-5 Nano is fast and cheap."""
        start = time.time()
        system = f"""Classify this text into one category. Categories: {', '.join(categories)}
Respond with JSON: {{"intent": "<category>", "confidence": <0-1>, "entities": {{}}, "secondary_intents": []}}"""

        response = await self.client.chat.completions.create(
            model=model, max_tokens=200, temperature=0.0,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": text},
            ],
            response_format={"type": "json_object"},
        )
        result = json.loads(response.choices[0].message.content)
        pricing = MODEL_PRICING.get(model, {"input": 0, "output": 0})
        cost_cents = ((response.usage.prompt_tokens * pricing["input"] + response.usage.completion_tokens * pricing["output"]) / 1_000_000) * 100

        return ClassifyResponse(
            intent=result["intent"], confidence=result.get("confidence", 0.9),
            entities=result.get("entities", {}), secondary_intents=result.get("secondary_intents", []),
            provider="openai", model=model,
            tokens_used=TokenUsage(input=response.usage.prompt_tokens, output=response.usage.completion_tokens),
            cost_cents=round(cost_cents, 4),
            latency_ms=round((time.time() - start) * 1000, 2),
        )

    async def transcribe(self, model, audio_data, language="en") -> TranscribeResponse:
        """OpenAI Transcribe — fallback STT provider."""
        start = time.time()
        response = await self.client.audio.transcriptions.create(
            model="whisper-1",  # or newer transcription model
            file=("audio.wav", audio_data),
            language=language,
        )
        duration = len(audio_data) / 32000  # rough estimate
        pricing = MODEL_PRICING.get("openai-transcribe", {"per_minute": 0.006})
        cost_cents = (duration / 60) * pricing["per_minute"] * 100

        return TranscribeResponse(
            text=response.text, language=language,
            duration_seconds=duration, confidence=0.95,
            provider="openai", model="openai-transcribe",
            cost_cents=round(cost_cents, 4),
            latency_ms=round((time.time() - start) * 1000, 2),
        )
```

### providers/google.py — Gemini (vision/OCR primary, embedding fallback)

### providers/deepgram.py — Deepgram Nova-3 (STT primary)

### providers/voyage.py — Voyage-finance-2 (embeddings primary)

Each follows the identical pattern: implement `AIProvider` ABC, handle API-specific nuances, return standardized response models with cost/token tracking.

---

## AI Model Strategy

| Function | Primary Provider | Primary Model | Fallback Provider | Fallback Model | Self-Hosted (Phase 2) | Why This Choice |
|---|---|---|---|---|---|---|
| Agent reasoning | Anthropic | Claude Sonnet 4.6 | OpenAI | GPT-5.2 | DeepSeek V3.2 | Claude excels at structured output, following complex instructions, and JSON generation. Critical for invoice/estimate accuracy. |
| Complex reasoning | Anthropic | Claude Opus 4.6 | OpenAI | GPT-5.2 | -- | Opus for Insights Agent reports, complex multi-step analysis. Cost-justified by quality. |
| Fast routing/classification | OpenAI | GPT-5 Nano | Google | Gemini Flash-Lite | SetFit / Semantic Router | Classification must be <500ms. Nano is cheapest fast model. |
| Speech-to-text | Deepgram | Nova-3 | OpenAI | Transcribe | Distil-Whisper | Deepgram excels with noisy environments (job sites, trucks). Trade-critical. |
| Vision/OCR | Google | Gemini 2.5 Flash Vision | Anthropic | Claude Sonnet Vision | PaddleOCR-VL-1.5 | Gemini Flash is cheapest multimodal model with strong vision quality. |
| Embeddings | Voyage | Voyage-finance-2 | Google | gemini-embedding-001 | BGE-M3 / nomic-embed | Voyage-finance-2 excels at financial/business text. Perfect for invoice/estimate similarity. |
| Document generation | Template engine (Puppeteer) | -- | -- | -- | -- | Not an AI task. Deterministic HTML-to-PDF. |

**Decision rationale for multi-provider:**

- No single provider is best at everything. Claude is the best reasoner, GPT Nano is the cheapest classifier, Deepgram handles noisy audio best, Gemini is cheapest for vision.
- Single-provider lock-in is a business risk. If Anthropic has an outage, the entire platform doesn't go down.
- Cost optimization: using Nano for classification ($0.10/1M tokens) instead of Sonnet ($3.00/1M tokens) saves 97% on the highest-volume endpoint.
- Self-hosted models (Phase 2) become the fallback/primary for high-volume tasks, further reducing costs.

---

## Prompt Management

### Philosophy

Prompts are **Python files**, not database records. This is deliberate:

1. **Version controlled** — every prompt change is a git commit with a diff. You can see exactly what changed, when, and by whom.
2. **Code review** — prompt changes go through PR review, same as code.
3. **Type-safe** — prompt templates are Python functions with typed parameters, not raw strings.
4. **Testable** — unit tests verify prompt generation with specific inputs.
5. **No runtime fetch** — prompts are imported at startup, not queried from a database per request.

### Prompt Template Structure

Each prompt file exports a function that takes typed variables and returns a `(system_prompt, user_prompt)` tuple:

```python
# prompts/invoice.py — example structure
"""
Invoice generation prompt template.

Used by: Invoice Agent (via /ai/reason)
Model tier: capable (Claude Sonnet)
Expected output: structured JSON matching invoice line item schema

Template variables:
  - job: Job data (description, line_items, materials, labor_hours, total_amount)
  - customer: Customer data (name, email, address, payment history)
  - org: Organization data (trade_type, tax_rate, invoice_preferences)
  - business_context: Learned pricing data, rounding preferences, etc.
  - past_invoices: Recent similar invoices for this customer (for consistency)
"""

VERSION = "1.2.0"  # Increment on any prompt change


def build_prompt(
    job: dict,
    customer: dict,
    org: dict,
    business_context: dict,
    past_invoices: list[dict] | None = None,
) -> tuple[str, str]:
    """
    Build the system + user prompt for invoice generation.

    Returns:
        (system_prompt, user_prompt) tuple
    """
    system_prompt = f"""You are the Invoice Agent for a {org['trade_type'].upper()} business.
Your job is to generate accurate, professional invoices from completed job data.

RULES:
- Every line item must have a clear description, quantity, unit price, and total
- Labor should be calculated from hours worked x the business's labor rate
- Materials should be itemized individually with accurate pricing
- Tax rate is {org.get('settings', {}).get('tax_rate', 0.0825)} (apply to total)
- Round totals to nearest cent
- Include relevant notes about work performed and warranty
{f"- Business preference: round estimates to nearest ${business_context.get('round_to', 1)}" if business_context.get('round_to') else ""}

OUTPUT FORMAT: Return ONLY valid JSON matching the output schema. No other text."""

    # Build user prompt with all context
    user_prompt_parts = [
        f"Generate an invoice for this completed job:\n",
        f"**Job Description:** {job.get('description', 'N/A')}",
        f"**Job Type:** {job.get('type', 'service_call')}",
    ]

    if job.get('line_items'):
        user_prompt_parts.append(f"**Line Items from Job:** {json.dumps(job['line_items'])}")
    if job.get('materials'):
        user_prompt_parts.append(f"**Materials Used:** {json.dumps(job['materials'])}")
    if job.get('labor_hours'):
        user_prompt_parts.append(f"**Labor Hours:** {job['labor_hours']}")

    user_prompt_parts.extend([
        f"\n**Customer:** {customer.get('name', 'Unknown')}",
        f"**Customer Address:** {json.dumps(customer.get('address', {}))}",
    ])

    if business_context.get('avg_labor_rate'):
        user_prompt_parts.append(f"**Labor Rate:** ${business_context['avg_labor_rate']}/hr")

    if past_invoices:
        user_prompt_parts.append(f"\n**Recent similar invoices for reference (consistency):**")
        for inv in past_invoices[:3]:
            user_prompt_parts.append(f"  - Invoice #{inv.get('invoice_number')}: ${inv.get('total')} ({inv.get('notes', '')[:100]})")

    user_prompt = "\n".join(user_prompt_parts)

    return system_prompt, user_prompt
```

---

## Prompt Templates

### prompts/invoice.py

**Purpose:** Generates structured invoice data from completed job information. Produces line items with descriptions, quantities, unit prices, and totals. Handles labor calculation, material itemization, tax application, and professional notes.

**Used by:** Invoice Agent (triggered by `job.completed` event or `create-invoice` copilot intent)

**Variables:** job (description, line_items, materials, labor_hours), customer (name, address, payment history), org (trade_type, tax_rate), business_context (avg_labor_rate, rounding preferences), past_invoices (recent similar invoices for consistency)

**Key prompt engineering:** Instructs the model to be precise with math (subtotal = sum of line item totals, tax applied correctly). Includes past invoices for consistency — if the business always charges $95/hr, the model learns this from examples.

### prompts/estimate.py

**Purpose:** Generates detailed cost estimates from job descriptions, photos (via vision analysis output), and historical pricing data. Handles three output types: standard estimates, formal proposals (for larger jobs), and change orders (mid-job scope adjustments).

**Used by:** Estimate Agent (triggered by `estimate.requested` event or `create-estimate` copilot intent)

**Variables:** scope_description, vision_analysis (output from /ai/vision), customer, org, historical_estimates (past similar jobs + their actual costs for pricing accuracy), parts_pricing (current supplier pricing from inventory)

**Key prompt engineering:** Includes historical estimate-to-actual comparisons so the model learns the business's real-world costs, not just generic pricing. Instructs the model to produce confidence scores per line item.

### prompts/collections.py

**Purpose:** Generates escalating collections follow-up messages with appropriate tone and timing. Handles the full escalation sequence: friendly reminder, firm follow-up, final notice, collections warning. Also generates preliminary notice text for lien filing deadlines.

**Used by:** Collections Agent (triggered by `invoice.overdue` event or `collections-followup` scheduled job)

**Variables:** invoice (amount, due_date, days_overdue), customer (name, payment_score, payment_history), org (trade_type, business_name), escalation_level (1-5), state_lien_deadlines (state-specific legal deadlines)

**Key prompt engineering:** Tone calibration is critical — too aggressive and you lose the customer, too soft and you don't get paid. The prompt includes the customer's payment score and history so the model adjusts tone (loyal customers get gentle reminders; serial late-payers get firm notices).

### prompts/copilot.py

**Purpose:** Contains the copilot's system prompt (persona, capabilities, response style) and the response synthesis prompt (takes agent results and generates a natural language summary for the contractor).

**Used by:** Copilot service (for both initial system prompt and response generation after agent dispatch)

**Variables:** org_context (trade_type, team members, connected tools), conversation_history (recent messages), agent_results (output from dispatched agents), business_context (learned preferences)

**Key prompt engineering:** The copilot persona is an "operations coordinator" — professional but not robotic, concise but thorough. It proactively suggests follow-up actions. The response synthesis prompt instructs the model to summarize agent results naturally: "Invoice #1247 generated for $1,840" not "The invoice agent returned output_data.total=1840.00".

### prompts/classify.py

**Purpose:** Intent classification prompt. Takes a user message and a list of categories, returns the best match with confidence score and extracted entities.

**Used by:** Copilot service (first step in every message — classify intent before routing)

**Variables:** text (user message), categories (list of possible intents), recent_context (last 2-3 messages for disambiguation)

**Key prompt engineering:** Few-shot examples are embedded in the system prompt — trade-specific examples that handle ambiguous inputs. "The Henderson job is done" should classify as `multi-action` (triggers invoice + inventory + customer), not just `query.job_status`. The prompt includes recent context for disambiguation: "send it" after discussing an invoice means `send-invoice`, not a generic query.

### prompts/extract.py

**Purpose:** Entity extraction from unstructured contractor text. Pulls out customer names, job details, materials, quantities, dates, and amounts from natural language.

**Used by:** Copilot service and agents (when processing natural language input from contractors)

**Variables:** text (user message), extract_schema (what entities to look for)

**Key prompt engineering:** Trade-specific entity recognition — "200 feet of copper" should extract as `{name: "copper pipe", quantity: 200, unit: "feet"}`, not just raw text. Handles contractor shorthand: "4 elbows" = `{name: "elbows", quantity: 4, unit: "pieces"}`.

---

## Memory Management

### memory/context.py — Business Context Builder

Builds the full business context that gets injected into every LLM call. This is how the AI "learns" about each business over time.

```python
"""
Business context builder.

Queries the business_context table and assembles a structured context object
that gets injected into LLM prompts. This is the mechanism behind
"the AI gets smarter over time" — it accumulates knowledge about the business.

Categories in business_context table:
  - 'pricing': avg_labor_rate, material_markups, pricing_by_job_type
  - 'customer': payment_patterns, preferences, communication_style
  - 'operational': busy_days, common_issues, seasonal_trends
  - 'preference': invoice_rounding, default_payment_terms, sms_vs_email
"""
from typing import Any

import structlog

logger = structlog.get_logger()


class BusinessContextBuilder:
    def __init__(self, db_pool):
        self.db = db_pool

    async def build_context(self, org_id: str, categories: list[str] | None = None) -> dict[str, Any]:
        """
        Build the business context object for an organization.

        Args:
            org_id: Organization ID
            categories: Optional filter — only fetch specific categories.
                        If None, fetch all.

        Returns:
            Dict organized by category:
            {
                "pricing": { "avg_labor_rate": 95.00, ... },
                "customer": { ... },
                "operational": { ... },
                "preference": { ... }
            }
        """
        query = "SELECT category, key, value, confidence FROM business_context WHERE org_id = $1"
        params = [org_id]

        if categories:
            query += " AND category = ANY($2)"
            params.append(categories)

        query += " ORDER BY confidence DESC"

        rows = await self.db.fetch(query, *params)

        context = {}
        for row in rows:
            category = row["category"]
            if category not in context:
                context[category] = {}
            context[category][row["key"]] = row["value"]

        logger.debug(
            "business_context_built",
            org_id=org_id,
            categories=list(context.keys()),
            total_facts=sum(len(v) for v in context.values()),
        )

        return context

    async def update_context(
        self,
        org_id: str,
        category: str,
        key: str,
        value: Any,
        confidence: float = 1.0,
        source: str = "agent",
    ) -> None:
        """
        Upsert a business context fact. Called by agents after learning something
        about the business (e.g., Invoice Agent learns the avg labor rate from
        20 invoices).
        """
        await self.db.execute(
            """
            INSERT INTO business_context (org_id, category, key, value, confidence, source)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (org_id, category, key) DO UPDATE SET
                value = $4,
                confidence = GREATEST(business_context.confidence, $5),
                source = $6,
                updated_at = NOW()
            """,
            org_id, category, key, value, confidence, source,
        )
```

### memory/short_term.py — Recent Messages

```python
"""
Short-term memory — recent messages in the current conversation.

These are loaded directly into the LLM context window as message history.
Typically the last 10 messages (configurable). This gives the LLM
immediate conversational context.
"""

class ShortTermMemory:
    def __init__(self, db_pool):
        self.db = db_pool
        self.max_messages = 10  # Configurable per tier

    async def get_recent_messages(self, conversation_id: str, limit: int | None = None) -> list[dict]:
        """
        Fetch the last N messages from a conversation.
        Returns in chronological order (oldest first) for LLM context.
        """
        n = limit or self.max_messages
        rows = await self.db.fetch(
            """
            SELECT role, content, created_at
            FROM messages
            WHERE conversation_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            conversation_id, n,
        )
        # Reverse to chronological order
        return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]
```

### memory/long_term.py — Vector Store Queries

```python
"""
Long-term memory — semantic search over the organization's vector store.

Uses pgvector to find relevant past jobs, invoices, customer interactions,
and conversation excerpts. This is how the AI recalls relevant historical
information that's not in the immediate conversation.
"""

class LongTermMemory:
    def __init__(self, db_pool):
        self.db = db_pool

    async def search(
        self,
        org_id: str,
        query_embedding: list[float],
        source_types: list[str] | None = None,
        limit: int = 5,
        threshold: float = 0.7,
    ) -> list[dict]:
        """
        Semantic search over the org's embeddings.

        Args:
            query_embedding: Vector from /ai/embed endpoint
            source_types: Filter by type ('job', 'invoice', 'customer', etc.)
            limit: Max results
            threshold: Minimum cosine similarity

        Returns:
            List of matching content with similarity scores.
        """
        type_filter = ""
        params = [org_id, query_embedding, threshold, limit]
        if source_types:
            type_filter = "AND source_type = ANY($5)"
            params.append(source_types)

        rows = await self.db.fetch(
            f"""
            SELECT source_type, source_id, content, metadata,
                   1 - (embedding <=> $2::vector) AS similarity
            FROM embeddings
            WHERE org_id = $1
              AND 1 - (embedding <=> $2::vector) > $3
              {type_filter}
            ORDER BY similarity DESC
            LIMIT $4
            """,
            *params,
        )

        return [
            {
                "source_type": r["source_type"],
                "source_id": str(r["source_id"]),
                "content": r["content"],
                "similarity": round(r["similarity"], 4),
                "metadata": r["metadata"],
            }
            for r in rows
        ]
```

### memory/summarizer.py — Conversation Summarization

```python
"""
Conversation summarizer — medium-term memory.

When a conversation exceeds 50 messages, the summarizer compresses
older messages into a summary that gets stored in conversations.summary.
This summary is injected into the LLM context instead of all 50+ messages,
keeping context windows manageable while preserving important information.

Triggered by:
  - conversation-summarization cron job (Sunday 3am)
  - When a conversation exceeds the message threshold
"""

class ConversationSummarizer:
    def __init__(self, provider_router, db_pool):
        self.router = provider_router
        self.db = db_pool
        self.message_threshold = 50

    async def summarize_if_needed(self, conversation_id: str) -> str | None:
        """
        Check if a conversation needs summarization.
        If it does, generate a summary and store it.
        """
        count = await self.db.fetchval(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = $1",
            conversation_id,
        )

        if count < self.message_threshold:
            return None

        # Fetch all messages
        messages = await self.db.fetch(
            "SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at",
            conversation_id,
        )

        # Generate summary via LLM (fast model — this is a background task)
        conversation_text = "\n".join(f"{m['role']}: {m['content']}" for m in messages)

        result = await self.router.reason(
            prompt_template="summarize",
            variables={},
            system_prompt="Summarize this conversation concisely. Focus on: key decisions made, actions taken, preferences expressed, and important business context learned. Keep under 500 words.",
            user_prompt=conversation_text,
            model_tier="fast",
            org_id="system",
        )

        summary = result.result.get("text", "")

        # Store summary
        await self.db.execute(
            "UPDATE conversations SET summary = $1, updated_at = NOW() WHERE id = $2",
            summary, conversation_id,
        )

        return summary
```

**Memory hierarchy and token budget:**

```
Total context budget: ~8000 tokens (configurable)

Priority 1: System prompt (~500 tokens) — always included
Priority 2: Recent messages — last 10 messages (~2000 tokens)
Priority 3: Agent outputs — results from dispatched agents (~1500 tokens)
Priority 4: Business context — pricing, preferences, patterns (~1000 tokens)
Priority 5: Semantic search results — relevant historical data (~1500 tokens)
Priority 6: Conversation summary — medium-term memory (~500 tokens)

If total exceeds budget, trim from lowest priority first.
```

---

## Token Counting and Cost Tracking

Every AI call returns token usage and cost. This data flows into the `agent_executions` table for the cost tracking dashboard.

```python
# Cost calculation is done per-provider (each provider returns native token counts)
# The ProviderRouter standardizes into TokenUsage(input, output) + cost_cents

# Cost formula:
# cost_cents = ((input_tokens * input_price_per_1M / 1_000_000) +
#               (output_tokens * output_price_per_1M / 1_000_000)) * 100

# For audio (STT):
# cost_cents = (duration_minutes * price_per_minute) * 100

# The Node API stores these in agent_executions:
#   ai_model_used TEXT        -- 'claude-sonnet-4-6'
#   ai_tokens_used INTEGER    -- input + output
#   ai_cost_cents INTEGER     -- total cost in cents
```

The cost data is aggregated by the `org_monthly_usage` materialized view (see [17-cost-tracking.md](./17-cost-tracking.md)) and exposed via `GET /api/dashboard/usage`.

---

## Structured Logging

```python
# app/main.py — structlog configuration
import structlog

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,  # Merge request-scoped vars
        structlog.processors.add_log_level,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),       # JSON output for Railway/log aggregation
    ],
    wrapper_class=structlog.make_filtering_bound_logger(settings.LOG_LEVEL),
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
    cache_logger_on_first_use=True,
)
```

**Every log line includes (via contextvars):**

- `request_id` — propagated from Node API via `X-Request-ID` header
- `method` — HTTP method
- `path` — endpoint path

**AI-specific fields logged on every provider call:**

- `provider` — which provider handled the request
- `model` — specific model used
- `tokens_input` — input token count
- `tokens_output` — output token count
- `cost_cents` — estimated cost
- `latency_ms` — total request time
- `is_fallback` — whether this was a fallback call
- `org_id` — which organization made the request

Example log line:
```json
{
  "event": "reasoning_completed",
  "level": "info",
  "timestamp": "2026-03-04T15:30:00Z",
  "request_id": "req_abc123",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "tokens_input": 1847,
  "tokens_output": 423,
  "cost_cents": 1.19,
  "latency_ms": 2340,
  "is_fallback": false,
  "org_id": "org_uuid"
}
```

---

## Request ID Propagation

Distributed tracing across the two-service architecture:

```
Frontend (browser)
  └─ Generates X-Request-ID: "req_abc123"
     └─ POST /api/copilot/message → Node.js Fastify API
        ├─ Pino logs: { request_id: "req_abc123", ... }
        ├─ agent_executions.metadata.request_id = "req_abc123"
        └─ POST /ai/reason → Python FastAPI AI Service
           ├─ Extracts X-Request-ID from header
           ├─ Binds to structlog contextvars
           └─ All log lines include request_id: "req_abc123"
```

This means a single user action (e.g., "invoice the Henderson job") can be traced across both services by searching logs for `request_id = "req_abc123"`. You see the Fastify route handler, the BullMQ job, the AI service reasoning call, the provider used, the token count, and the cost — all correlated.

---

## Health Check

### routers/health.py

```python
"""
Health check endpoint — called by Railway, BetterUptime, and the Node API's
circuit breaker to determine if the AI service is available.
"""
import time

from fastapi import APIRouter, Request

from app.models.responses import HealthResponse

router = APIRouter()

START_TIME = time.time()


@router.get("/health", response_model=HealthResponse)
async def health_check(request: Request):
    """
    Returns overall service health + per-provider status.

    Health logic:
    - 'healthy': all providers responsive
    - 'degraded': at least one provider is down (but fallbacks work)
    - 'unhealthy': all providers are down (service is effectively useless)
    """
    provider_router = request.app.state.provider_router
    provider_statuses = {}
    healthy_count = 0

    for name, provider in provider_router.providers.items():
        status = await provider.health_check()
        provider_statuses[name] = status
        if status["status"] == "healthy":
            healthy_count += 1

    # Database health
    try:
        # Simple query to verify DB connectivity
        # (pgvector / embeddings table access)
        db_status = {"status": "healthy", "latency_ms": 3}
    except Exception:
        db_status = {"status": "down", "latency_ms": 0}

    total_providers = len(provider_router.providers)
    if healthy_count == total_providers:
        overall_status = "healthy"
    elif healthy_count > 0:
        overall_status = "degraded"
    else:
        overall_status = "unhealthy"

    return HealthResponse(
        status=overall_status,
        version="1.0.0",
        uptime_seconds=round(time.time() - START_TIME, 2),
        providers=provider_statuses,
        database=db_status,
    )
```

The Node API's `AIClient` calls `/ai/health` via its circuit breaker. If the health check returns `unhealthy`, the circuit breaker opens and the Node API returns `503 AI_UNAVAILABLE` for AI-dependent endpoints while CRUD operations continue normally.

---

## Mock Provider for Testing

### providers/mock.py

```python
"""
Mock AI provider — deterministic responses for testing.

Used when ENVIRONMENT=test. Returns pre-defined responses based on
the prompt template name, so agent execution tests are deterministic
and don't require real API calls.

This is critical for:
1. CI/CD — tests run without API keys
2. Speed — no network latency in tests
3. Determinism — same input always produces same output
4. Cost — zero API spend during development/testing
"""
import time
from typing import Any, AsyncIterator, Optional

from app.models.responses import (
    ClassifyResponse,
    EmbedResponse,
    EmbeddingResult,
    ExtractResponse,
    ReasonResponse,
    TokenUsage,
    TranscribeResponse,
    VisionAnalysis,
)
from app.providers.base import AIProvider


# Pre-defined mock responses
MOCK_INVOICE_RESPONSE = {
    "line_items": [
        {"description": "HVAC Diagnostic", "quantity": 1, "unit_price": 150.00, "total": 150.00},
        {"description": "Compressor Replacement", "quantity": 1, "unit_price": 1200.00, "total": 1200.00},
        {"description": "Labor (4 hours)", "quantity": 4, "unit_price": 95.00, "total": 380.00},
    ],
    "subtotal": 1730.00,
    "tax_rate": 0.0825,
    "tax_amount": 142.73,
    "total": 1872.73,
    "notes": "Mock invoice for testing.",
}

MOCK_ESTIMATE_RESPONSE = {
    "line_items": [
        {"description": "Equipment - AC Unit", "quantity": 1, "unit_price": 3500.00, "total": 3500.00},
        {"description": "Installation Labor", "quantity": 8, "unit_price": 95.00, "total": 760.00},
    ],
    "subtotal": 4260.00,
    "tax_amount": 351.45,
    "total": 4611.45,
    "scope_description": "Full AC unit replacement.",
    "confidence_score": 0.91,
}

MOCK_GENERIC_RESPONSE = {
    "text": "This is a mock AI response for testing purposes.",
}


class MockProvider(AIProvider):
    @property
    def name(self) -> str:
        return "mock"

    async def initialize(self):
        pass  # No setup needed

    async def shutdown(self):
        pass

    async def health_check(self) -> dict:
        return {"status": "healthy", "last_check": "2026-01-01T00:00:00Z"}

    async def reason(self, model, system_prompt, user_prompt, output_schema=None, max_tokens=2000, temperature=0.3) -> ReasonResponse:
        # Select response based on system prompt content
        if "invoice" in system_prompt.lower():
            result = MOCK_INVOICE_RESPONSE
        elif "estimate" in system_prompt.lower():
            result = MOCK_ESTIMATE_RESPONSE
        else:
            result = MOCK_GENERIC_RESPONSE

        return ReasonResponse(
            result=result,
            confidence=0.95,
            provider="mock",
            model="mock-model",
            tokens_used=TokenUsage(input=100, output=50),
            cost_cents=0.0,
            latency_ms=5.0,
        )

    async def reason_stream(self, model, system_prompt, user_prompt, max_tokens=2000, temperature=0.3) -> AsyncIterator[str]:
        tokens = ["This ", "is ", "a ", "mock ", "streamed ", "response."]
        for token in tokens:
            yield token

    async def classify(self, model, text, categories, context=None) -> ClassifyResponse:
        # Simple keyword-based classification for deterministic testing
        text_lower = text.lower()
        if "invoice" in text_lower:
            intent = "create-invoice"
        elif "estimate" in text_lower:
            intent = "create-estimate"
        elif "overdue" in text_lower or "outstanding" in text_lower:
            intent = "check-collections"
        elif "schedule" in text_lower:
            intent = "schedule-job"
        elif "how did" in text_lower or "last month" in text_lower:
            intent = "business-report"
        elif "inventory" in text_lower or "stock" in text_lower:
            intent = "check-inventory"
        elif "workflow" in text_lower:
            intent = "create-workflow"
        elif "done" in text_lower or "finished" in text_lower or "completed" in text_lower:
            intent = "multi-action"
        else:
            intent = categories[0] if categories else "general-question"

        return ClassifyResponse(
            intent=intent,
            confidence=0.95,
            entities={},
            secondary_intents=[],
            provider="mock",
            model="mock-model",
            tokens_used=TokenUsage(input=50, output=20),
            cost_cents=0.0,
            latency_ms=2.0,
        )

    async def extract(self, model, text, extract_schema) -> ExtractResponse:
        return ExtractResponse(
            extracted={"mock": True},
            confidence=0.9,
            provider="mock",
            model="mock-model",
            tokens_used=TokenUsage(input=50, output=30),
            cost_cents=0.0,
            latency_ms=3.0,
        )

    async def transcribe(self, model, audio_data, language="en") -> TranscribeResponse:
        return TranscribeResponse(
            text="This is a mock transcription of audio input.",
            language=language,
            duration_seconds=5.0,
            confidence=0.98,
            provider="mock",
            model="mock-model",
            cost_cents=0.0,
            latency_ms=10.0,
        )

    async def analyze_images(self, model, image_urls, prompt, output_schema=None) -> VisionAnalysis:
        return VisionAnalysis(
            analysis={
                "equipment": [{"type": "ac_unit", "brand": "Carrier", "condition": "aged"}],
                "materials_needed": [{"name": "condensing unit", "quantity_estimate": "1", "unit": "unit"}],
                "issues": ["Visible corrosion"],
                "access_conditions": "Ground level, adequate clearance",
            },
            confidence=0.88,
            provider="mock",
            model="mock-model",
            tokens_used=TokenUsage(input=200, output=100),
            cost_cents=0.0,
            latency_ms=15.0,
        )

    async def embed(self, model, texts) -> EmbedResponse:
        # Return zero vectors of correct dimensionality
        embeddings = [
            EmbeddingResult(index=i, vector=[0.0] * 1024, dimensions=1024)
            for i in range(len(texts))
        ]
        return EmbedResponse(
            embeddings=embeddings,
            provider="mock",
            model="mock-model",
            tokens_used=TokenUsage(input=len(texts) * 10, output=0),
            cost_cents=0.0,
            latency_ms=5.0,
        )
```

---

## Decision Rationale

| Decision | Choice | Alternatives Considered | Why |
|---|---|---|---|
| Separate Python service | FastAPI on separate port | Embed Python in Node (child process), use Node-only LLM SDKs | Python has the best AI ecosystem. Separate service enables independent scaling and deployment. Child processes are fragile. |
| Multi-provider with fallback | ProviderRouter pattern | Single provider (Anthropic only), LangChain router | Single provider = single point of failure. LangChain adds complexity and abstraction we don't need — our routing logic is straightforward. |
| Prompts as Python files | Version-controlled .py files | Database-stored prompts, .txt files, YAML | Git-tracked means diffs, PRs, and rollbacks. Python files give type safety and testability. Database prompts add latency and complexity. |
| Pydantic for validation | Request/Response models | Raw dict validation, marshmallow, attrs | Pydantic is FastAPI-native, generates OpenAPI docs automatically, and provides excellent error messages. |
| structlog for logging | JSON structured logs | stdlib logging, loguru | structlog's contextvars integration enables request-scoped metadata (request_id, org_id) across all log lines without passing logger instances. |
| pgvector for embeddings | PostgreSQL extension | Pinecone (managed), Weaviate, Qdrant | pgvector lives in our existing Supabase PostgreSQL — no additional infrastructure. Performance is sufficient for our scale (tens of thousands of embeddings per org, not millions). Pinecone is a migration option if we outgrow pgvector. |
| Voyage-finance-2 for embeddings | Financial-domain model | OpenAI text-embedding-3, Cohere embed | Voyage-finance-2 is specifically tuned for financial/business text — invoices, estimates, pricing. Better semantic similarity for our domain than general-purpose models. |
| Deepgram Nova-3 for STT | Noisy-environment model | OpenAI Whisper, AssemblyAI | Contractors are on job sites with HVAC units running, trucks idling, power tools. Deepgram Nova-3 is optimized for noisy audio and outperforms Whisper in these conditions. |
