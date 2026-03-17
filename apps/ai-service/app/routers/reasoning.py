from __future__ import annotations

import structlog
from fastapi import APIRouter

from app.models.requests import ReasonRequest
from app.models.responses import ReasonResponse

router = APIRouter()
logger: structlog.stdlib.BoundLogger = structlog.get_logger()


@router.post("/ai/reason", response_model=ReasonResponse)
async def reason(request: ReasonRequest) -> ReasonResponse:
    """Generate a reasoning response (mock -- real providers in Sprint 2)."""
    logger.info(
        "reason_request",
        org_id=request.org_id,
        model_tier=request.model_tier,
        prompt_template=request.prompt_template[:80],
    )

    return ReasonResponse(
        content=f"[Mock] Reasoning response for template: {request.prompt_template}",
        model_used="mock",
        tokens_used=0,
        cost_cents=0,
        latency_ms=50,
        provider="mock",
    )
