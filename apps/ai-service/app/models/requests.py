from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class ReasonRequest(BaseModel):
    """Request body for the /ai/reason endpoint."""

    prompt_template: str
    variables: dict
    model_tier: Literal["fast", "capable", "powerful"] = "capable"
    system_prompt: str | None = None
    output_schema: dict | None = None
    org_id: str
    request_id: str | None = None


class ClassifyRequest(BaseModel):
    """Request body for the /ai/classify endpoint."""

    text: str
    categories: list[str]
    org_id: str
    request_id: str | None = None


class ExtractRequest(BaseModel):
    """Request body for the /ai/extract endpoint."""

    text: str
    schema: dict
    org_id: str
    request_id: str | None = None


class TranscribeRequest(BaseModel):
    """Request body for the /ai/transcribe endpoint."""

    audio_url: str
    language: str | None = None
    org_id: str
    request_id: str | None = None


class VisionRequest(BaseModel):
    """Request body for the /ai/vision endpoint."""

    image_urls: list[str]
    prompt: str
    org_id: str
    request_id: str | None = None


class EmbedRequest(BaseModel):
    """Request body for the /ai/embed endpoint."""

    texts: list[str]
    model: str | None = None
    org_id: str


class SearchRequest(BaseModel):
    """Request body for the /ai/search endpoint."""

    query: str
    org_id: str
    source_types: list[str] | None = None
    limit: int = 10
