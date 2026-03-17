from __future__ import annotations

from pydantic import BaseModel


class ReasonResponse(BaseModel):
    """Response from the /ai/reason endpoint."""

    content: str
    structured_output: dict | None = None
    model_used: str
    tokens_used: int
    cost_cents: int
    latency_ms: int
    provider: str


class ClassifyResponse(BaseModel):
    """Response from the /ai/classify endpoint."""

    intent: str
    entities: dict = {}
    confidence: float
    model_used: str


class ExtractResponse(BaseModel):
    """Response from the /ai/extract endpoint."""

    extracted: dict
    confidence: float
    model_used: str


class TranscribeResponse(BaseModel):
    """Response from the /ai/transcribe endpoint."""

    text: str
    language: str
    duration_seconds: float
    model_used: str


class VisionResponse(BaseModel):
    """Response from the /ai/vision endpoint."""

    analysis: str
    structured_output: dict | None = None
    model_used: str


class EmbedResponse(BaseModel):
    """Response from the /ai/embed endpoint."""

    embeddings: list[list[float]]
    model_used: str
    dimensions: int


class SearchResult(BaseModel):
    """A single result from the /ai/search endpoint."""

    source_type: str
    source_id: str
    content: str
    score: float
    metadata: dict = {}


class SearchResponse(BaseModel):
    """Response from the /ai/search endpoint."""

    results: list[SearchResult]


class HealthResponse(BaseModel):
    """Response from the /ai/health endpoint."""

    status: str
    version: str
    providers: dict[str, str]
    timestamp: str


class ErrorResponse(BaseModel):
    """Standard error envelope."""

    error: str
    detail: str | None = None
