from __future__ import annotations

import time

import structlog

from app.config import settings
from app.models.requests import ClassifyRequest, ReasonRequest
from app.models.responses import ClassifyResponse, ReasonResponse

logger: structlog.stdlib.BoundLogger = structlog.get_logger()


class ProviderRouter:
    """Route AI requests to the appropriate provider.

    In Sprint 1 every call returns a mock response.  Real provider
    implementations will be registered in Sprint 2.
    """

    def __init__(self) -> None:
        self.reasoning_provider = settings.DEFAULT_REASONING_PROVIDER
        self.classification_provider = settings.DEFAULT_CLASSIFICATION_PROVIDER
        self.vision_provider = settings.DEFAULT_VISION_PROVIDER
        self.embedding_provider = settings.DEFAULT_EMBEDDING_PROVIDER
        self.transcription_provider = settings.DEFAULT_TRANSCRIPTION_PROVIDER

    # ------------------------------------------------------------------
    # Reasoning
    # ------------------------------------------------------------------
    async def reason(self, request: ReasonRequest) -> ReasonResponse:
        """Select a provider and return a reasoning response."""
        provider = self.reasoning_provider
        start = time.perf_counter()

        logger.info(
            "provider_router_reason",
            provider=provider,
            model_tier=request.model_tier,
            org_id=request.org_id,
        )

        # --- Mock response (Sprint 1) ---
        latency_ms = int((time.perf_counter() - start) * 1000)

        response = ReasonResponse(
            content=f"[Mock] Reasoning response for template: {request.prompt_template}",
            model_used="mock",
            tokens_used=0,
            cost_cents=0,
            latency_ms=latency_ms,
            provider=provider,
        )

        logger.info(
            "provider_router_reason_complete",
            provider=provider,
            latency_ms=latency_ms,
            success=True,
        )
        return response

    # ------------------------------------------------------------------
    # Classification
    # ------------------------------------------------------------------
    async def classify(self, request: ClassifyRequest) -> ClassifyResponse:
        """Select a provider and return a classification response."""
        provider = self.classification_provider
        start = time.perf_counter()

        logger.info(
            "provider_router_classify",
            provider=provider,
            org_id=request.org_id,
        )

        # --- Mock response (Sprint 1) ---
        intent = request.categories[0] if request.categories else "unknown"
        latency_ms = int((time.perf_counter() - start) * 1000)

        response = ClassifyResponse(
            intent=intent,
            confidence=0.95,
            model_used="mock",
        )

        logger.info(
            "provider_router_classify_complete",
            provider=provider,
            latency_ms=latency_ms,
            success=True,
        )
        return response


# Singleton for import convenience
provider_router = ProviderRouter()
