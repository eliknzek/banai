"""Shared API helpers: the error envelope and the per-IP rate limiter."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import Settings, get_settings
from app.services.speech import SpeechClient, speech_client_for

# E2E runs (APP_ENV=e2e, scripted agent, no OpenAI) send many requests from one IP in a
# minute, so limits are off there. The limits themselves are covered by pytest.
limiter = Limiter(key_func=get_remote_address, enabled=not get_settings().uses_fake_agent)


def error_response(status: int, code: str, message: str, **extra: object) -> JSONResponse:
    return JSONResponse(status_code=status,
                        content={"success": False, "data": None, "error": {"code": code, "message": message, **extra}})


def get_speech_client(settings: Annotated[Settings, Depends(get_settings)]) -> SpeechClient | None:
    return speech_client_for(settings)
