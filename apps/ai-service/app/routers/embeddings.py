from __future__ import annotations

import structlog
from fastapi import APIRouter

from app.models.requests import EmbedRequest, SearchRequest
from app.models.responses import EmbedResponse, SearchResponse

router = APIRouter()
logger: structlog.stdlib.BoundLogger = structlog.get_logger()

_MOCK_DIMENSIONS = 1024


@router.post("/ai/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest) -> EmbedResponse:
    """Generate embeddings for a list of texts (mock)."""
    logger.info(
        "embed_request",
        org_id=request.org_id,
        text_count=len(request.texts),
    )

    return EmbedResponse(
        embeddings=[[0.0] * _MOCK_DIMENSIONS for _ in request.texts],
        model_used="mock",
        dimensions=_MOCK_DIMENSIONS,
    )


@router.post("/ai/search", response_model=SearchResponse)
async def search(request: SearchRequest) -> SearchResponse:
    """Perform vector similarity search (mock)."""
    logger.info(
        "search_request",
        org_id=request.org_id,
        query=request.query[:80],
        limit=request.limit,
    )

    return SearchResponse(results=[])
