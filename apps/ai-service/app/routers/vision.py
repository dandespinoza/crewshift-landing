from __future__ import annotations

import structlog
from fastapi import APIRouter

from app.models.requests import VisionRequest
from app.models.responses import VisionResponse

router = APIRouter()
logger: structlog.stdlib.BoundLogger = structlog.get_logger()


@router.post("/ai/vision", response_model=VisionResponse)
async def vision(request: VisionRequest) -> VisionResponse:
    """Analyse one or more images with a prompt (mock)."""
    logger.info(
        "vision_request",
        org_id=request.org_id,
        image_count=len(request.image_urls),
    )

    return VisionResponse(
        analysis=f"[Mock] Vision analysis of {len(request.image_urls)} images",
        model_used="mock",
    )
