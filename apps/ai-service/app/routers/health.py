from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.config import settings
from app.models.responses import HealthResponse

router = APIRouter()

_PROVIDER_KEYS: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "google": "GOOGLE_AI_API_KEY",
    "deepgram": "DEEPGRAM_API_KEY",
    "voyage": "VOYAGE_API_KEY",
}


@router.get("/ai/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Return service health and provider availability."""
    providers: dict[str, str] = {}
    for name, attr in _PROVIDER_KEYS.items():
        value = getattr(settings, attr, "")
        providers[name] = "configured" if value else "not_configured"

    return HealthResponse(
        status="ok",
        version="0.1.0",
        providers=providers,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
