from __future__ import annotations

import structlog
from fastapi import APIRouter

from app.models.requests import ClassifyRequest, ExtractRequest
from app.models.responses import ClassifyResponse, ExtractResponse

router = APIRouter()
logger: structlog.stdlib.BoundLogger = structlog.get_logger()


@router.post("/ai/classify", response_model=ClassifyResponse)
async def classify(request: ClassifyRequest) -> ClassifyResponse:
    """Classify text into one of the provided categories (mock)."""
    logger.info(
        "classify_request",
        org_id=request.org_id,
        categories_count=len(request.categories),
    )

    intent = request.categories[0] if request.categories else "unknown"

    return ClassifyResponse(
        intent=intent,
        confidence=0.95,
        model_used="mock",
    )


@router.post("/ai/extract", response_model=ExtractResponse)
async def extract(request: ExtractRequest) -> ExtractResponse:
    """Extract structured data from text according to a schema (mock)."""
    logger.info(
        "extract_request",
        org_id=request.org_id,
        schema_keys=list(request.schema.keys()) if request.schema else [],
    )

    return ExtractResponse(
        extracted={},
        confidence=0.9,
        model_used="mock",
    )
