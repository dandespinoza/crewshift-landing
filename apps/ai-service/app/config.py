from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """AI service configuration loaded from environment variables."""

    ENVIRONMENT: str = "development"
    PORT: int = 8000
    LOG_LEVEL: str = "info"

    # --- Provider API keys (all optional, empty = not configured) ---
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    GOOGLE_AI_API_KEY: str = ""
    DEEPGRAM_API_KEY: str = ""
    VOYAGE_API_KEY: str = ""

    # --- Infrastructure ---
    DATABASE_URL: str = ""  # optional, used for vector search

    # --- Default provider routing per task type ---
    DEFAULT_REASONING_PROVIDER: str = "anthropic"
    DEFAULT_CLASSIFICATION_PROVIDER: str = "openai"
    DEFAULT_VISION_PROVIDER: str = "google"
    DEFAULT_EMBEDDING_PROVIDER: str = "voyage"
    DEFAULT_TRANSCRIPTION_PROVIDER: str = "deepgram"

    model_config = {"env_prefix": "", "case_sensitive": True}


settings = Settings()

# ---------------------------------------------------------------------------
# Model identifiers keyed by provider and tier
# ---------------------------------------------------------------------------
MODEL_CONFIG: dict[str, dict[str, str]] = {
    "anthropic": {
        "capable": "claude-sonnet-4-20250514",
        "powerful": "claude-opus-4-20250514",
    },
    "openai": {
        "fast": "gpt-4.1-nano",
        "capable": "gpt-4.1",
        "powerful": "gpt-4.1",
    },
    "google": {
        "fast": "gemini-2.5-flash",
        "capable": "gemini-2.5-pro",
    },
}
