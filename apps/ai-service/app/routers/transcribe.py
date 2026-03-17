from __future__ import annotations

import structlog
from fastapi import APIRouter

from app.models.requests import TranscribeRequest
from app.models.responses import TranscribeResponse

router = APIRouter()
logger: structlog.stdlib.BoundLogger = structlog.get_logger()


@router.post("/ai/transcribe", response_model=TranscribeResponse)
async def transcribe(request: TranscribeRequest) -> TranscribeResponse:
    """Transcribe audio from a URL (mock)."""
    logger.info(
        "transcribe_request",
        org_id=request.org_id,
        audio_url=request.audio_url,
        language=request.language,
    )

    return TranscribeResponse(
        text="[Mock transcription]",
        language="en",
        duration_seconds=0,
        model_used="mock",
    )
