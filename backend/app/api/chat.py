"""POST /api/chat: one agent turn. Returns a reply and, optionally, a signed proposal.

The endpoint is stateless and never changes the committed design: the proposal is only
applied later through /api/proposals/apply, after the customer confirms it.
"""

from __future__ import annotations

import secrets
from functools import lru_cache
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from app.agent.llm import AgentUnavailable, FakeClient, LLMClient, OpenAIClient
from app.agent.orchestrator import run_turn
from app.api.common import error_response, get_speech_client, limiter
from app.config import Settings, get_settings
from app.domain.catalog import load_catalog
from app.domain.errors import DomainError
from app.services import signing
from app.services.speech import SpeechClient
from app.services.speech_sessions import store as speech_sessions

router = APIRouter(prefix="/api")

MAX_MESSAGES = 20
MAX_MESSAGE_LENGTH = 2000
CHAT_RATE_LIMIT = "20/minute"

UNAVAILABLE_MESSAGES = {
    "not_configured": "The AI designer is not configured on this server.",
    "quota": "The AI designer has run out of credits. Please try again later.",
    "rate_limited": "The AI designer is busy. Please try again in a moment.",
    "auth": "The AI designer is not configured correctly on this server.",
    "network": "The AI designer could not be reached. Please try again.",
    "upstream": "The AI designer is unavailable right now. Please try again.",
}


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: Annotated[str, Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)]


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    messages: Annotated[list[ChatMessage], Field(min_length=1, max_length=MAX_MESSAGES)]
    design: dict
    revision: Annotated[int, Field(ge=1, le=1_000_000_000)]
    # True when the reply will be read aloud: speech then starts on the server right away.
    speak: bool = False
    # Interface language; the agent uses it only when the customer's own language is unclear.
    locale: Literal["he", "en"] = "en"


@lru_cache
def _ephemeral_signing_key() -> str:
    # E2E only: proposals are signed with a per-process key when none is configured.
    return secrets.token_hex(32)


def signing_key(settings: Settings) -> str:
    return settings.proposal_signing_key or (_ephemeral_signing_key() if settings.uses_fake_agent else "")


def get_agent_client(settings: Annotated[Settings, Depends(get_settings)]) -> LLMClient | None:
    if settings.uses_fake_agent:
        return FakeClient()
    if not (settings.openai_api_key and settings.openai_chat_model and settings.proposal_signing_key):
        return None
    return OpenAIClient(settings.openai_api_key, settings.openai_chat_model)


@router.post("/chat")
@limiter.limit(CHAT_RATE_LIMIT)
def chat(request: Request, body: ChatRequest,
         client: Annotated[LLMClient | None, Depends(get_agent_client)],
         speech: Annotated[SpeechClient | None, Depends(get_speech_client)],
         settings: Annotated[Settings, Depends(get_settings)]):
    if body.messages[-1].role != "user":
        return error_response(422, "INVALID_REQUEST", "The last message must come from the customer.")
    if client is None:
        return error_response(503, "AGENT_UNAVAILABLE", UNAVAILABLE_MESSAGES["not_configured"], reason="not_configured")
    messages = [message.model_dump() for message in body.messages]
    try:
        result = run_turn(client, messages, body.design, body.revision, load_catalog(), signing_key(settings),
                          locale=body.locale)
    except DomainError as error:
        return error_response(422, "INVALID_DESIGN", "The current design is not valid.", detail=error.to_dict())
    except AgentUnavailable as error:
        return error_response(503, "AGENT_UNAVAILABLE", UNAVAILABLE_MESSAGES[error.reason], reason=error.reason)
    token = signing.reply_token(signing_key(settings), result.reply)
    data = {"reply": result.reply, "replyToken": token, "proposal": result.proposal, "speechUrl": None}
    if body.speak and speech is not None:
        # Start the speech before this response is sent, so the voice is ready about when the
        # text arrives. The browser reads it from the single-use stream URL.
        speech_id = speech_sessions.start(lambda: speech.speak_stream(result.reply))
        data["speechUrl"] = f"/api/voice/stream/{speech_id}"
    return {"success": True, "data": data, "error": None}
