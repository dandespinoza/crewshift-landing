from __future__ import annotations

from abc import ABC, abstractmethod


class AIProvider(ABC):
    """Abstract base class that every AI provider must implement."""

    provider_name: str

    @abstractmethod
    async def reason(
        self,
        prompt: str,
        system: str | None = None,
        model_tier: str = "capable",
        output_schema: dict | None = None,
    ) -> dict:
        """Run a reasoning / completion request and return a result dict."""
        ...

    @abstractmethod
    async def classify(self, text: str, categories: list[str]) -> dict:
        """Classify *text* into one of the given *categories*."""
        ...

    @abstractmethod
    async def is_available(self) -> bool:
        """Return ``True`` when the provider is properly configured."""
        ...
