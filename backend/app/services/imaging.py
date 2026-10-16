"""Photoreal render behind one small interface (Phase 8). Nothing here changes a design, and
neither the reference image nor the result is stored or logged."""

from __future__ import annotations

import base64
import io
from typing import Protocol

from app.agent.llm import AgentUnavailable
from app.services.speech import _ErrorMapper

RENDER_TIMEOUT_SECONDS = 150
RENDER_SIZE = "1536x1024"
RENDER_QUALITY = "medium"
# input_fidelity ("stay close to the reference") exists only on older image models; newer ones such
# as gpt-image-2.5-* reject it (verified 2026-10-16) and follow the reference through the prompt.
FIDELITY_MODEL_PREFIXES = ("gpt-image-1",)


class ImageClient(Protocol):
    def render(self, reference_png: bytes, prompt: str) -> tuple[bytes, str]:
        """Returns (image bytes, mime type)."""
        ...


class OpenAIImages:
    def __init__(self, api_key: str, model: str) -> None:
        import openai  # lazy: tests and E2E never need the SDK

        self._openai = openai
        self._client = openai.OpenAI(api_key=api_key, timeout=RENDER_TIMEOUT_SECONDS, max_retries=0)
        self._model = model

    def render(self, reference_png: bytes, prompt: str) -> tuple[bytes, str]:
        extra = {"input_fidelity": "high"} if self._model.startswith(FIDELITY_MODEL_PREFIXES) else {}
        with _ErrorMapper(self._openai):
            result = self._client.images.edit(
                model=self._model,
                image=("wardrobe.png", io.BytesIO(reference_png), "image/png"),
                prompt=prompt,
                size=RENDER_SIZE,
                quality=RENDER_QUALITY,
                output_format="jpeg",
                **extra,
            )
        data = (result.data or [None])[0]
        if data is None or not getattr(data, "b64_json", None):
            raise AgentUnavailable("upstream")
        return base64.b64decode(data.b64_json), "image/jpeg"


class FakeImages:
    """E2E and tests: returns the reference image itself, instantly."""

    def __init__(self) -> None:
        self.prompts: list[str] = []

    def render(self, reference_png: bytes, prompt: str) -> tuple[bytes, str]:
        self.prompts.append(prompt)
        return reference_png, "image/png"


def image_client_for(settings) -> ImageClient | None:
    if settings.uses_fake_agent:
        return FakeImages()
    if not (settings.openai_api_key and settings.openai_image_model):
        return None
    return OpenAIImages(settings.openai_api_key, settings.openai_image_model)
