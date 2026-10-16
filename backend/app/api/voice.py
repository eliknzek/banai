"""Voice endpoints (spec §9a): push-to-talk transcription and spoken agent replies.

Neither endpoint touches a design. A transcript only becomes a change by going through
/api/chat like typed text, and then through the customer's Confirm.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from app.agent.llm import AgentUnavailable
from app.agent.orchestrator import MAX_MESSAGE_CHARS
from app.api.chat import UNAVAILABLE_MESSAGES, signing_key
from app.api.common import error_response, get_speech_client, limiter
from app.config import Settings, get_settings
from app.services import signing
from app.services.speech import SpeechClient
from app.services.speech_sessions import store as speech_sessions

router = APIRouter(prefix="/api/voice")

MIN_AUDIO_BYTES = 1024
MAX_AUDIO_BYTES = 1024 * 1024  # about a minute of Opus; push-to-talk stops at 30 s
AUDIO_TYPES = {
    "audio/webm": "speech.webm", "audio/ogg": "speech.ogg", "audio/mp4": "speech.m4a",
    "audio/mpeg": "speech.mp3", "audio/wav": "speech.wav",
}
TRANSCRIBE_RATE_LIMIT = "20/minute"
SPEAK_RATE_LIMIT = "30/minute"
STREAM_RATE_LIMIT = "60/minute"
AUDIO_HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}


class SpeakRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Annotated[str, Field(min_length=1, max_length=MAX_MESSAGE_CHARS)]
    token: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


def _unavailable(reason: str):
    return error_response(503, "AGENT_UNAVAILABLE", UNAVAILABLE_MESSAGES[reason], reason=reason)


@router.post("/transcribe")
@limiter.limit(TRANSCRIBE_RATE_LIMIT)
async def transcribe(request: Request, audio: UploadFile,
                     client: Annotated[SpeechClient | None, Depends(get_speech_client)]):
    content_type = (audio.content_type or "").split(";")[0].strip().lower()
    if content_type not in AUDIO_TYPES:
        return error_response(415, "UNSUPPORTED_AUDIO", "This audio format is not supported.")
    data = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(data) > MAX_AUDIO_BYTES:
        return error_response(413, "PAYLOAD_TOO_LARGE", "The recording is too long.")
    if len(data) < MIN_AUDIO_BYTES:
        return error_response(422, "AUDIO_TOO_SHORT", "The recording is too short.")
    if client is None:
        return _unavailable("not_configured")
    try:
        text = await run_in_threadpool(client.transcribe, data, AUDIO_TYPES[content_type], content_type)
    except AgentUnavailable as error:
        return _unavailable(error.reason)
    return {"success": True, "data": {"text": text[:2000]}, "error": None}


@router.post("/speak")
@limiter.limit(SPEAK_RATE_LIMIT)
def speak(request: Request, body: SpeakRequest,
          client: Annotated[SpeechClient | None, Depends(get_speech_client)],
          settings: Annotated[Settings, Depends(get_settings)]):
    if not signing.verify_reply_token(signing_key(settings), body.text, body.token):
        return error_response(400, "BAD_TOKEN", "Only replies from the AI designer can be spoken.")
    if client is None:
        return _unavailable("not_configured")
    try:
        chunks = client.speak_stream(body.text)
    except AgentUnavailable as error:
        return _unavailable(error.reason)
    return StreamingResponse(chunks, media_type="audio/mpeg", headers=AUDIO_HEADERS)


@router.get("/stream/{speech_id}")
@limiter.limit(STREAM_RATE_LIMIT)
def stream(request: Request, speech_id: Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{16,64}$")]):
    """The speech that /api/chat started for its reply. Single use: a second request gets 404."""
    session = speech_sessions.take(speech_id)
    if session is None:
        return error_response(404, "NOT_FOUND", "This audio is no longer available.")
    if session.failed_before_audio(wait_seconds=5):
        return _unavailable("upstream")
    return StreamingResponse(session.chunks(), media_type="audio/mpeg", headers=AUDIO_HEADERS)
