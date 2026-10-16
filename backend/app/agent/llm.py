"""Model clients behind one small interface, so the orchestrator never depends on a vendor SDK.

- `OpenAIClient`: the real model (Responses API, function tools, nothing stored at OpenAI).
- `FakeClient`: a deterministic rule-based stand-in for E2E runs (`APP_ENV=e2e`).
- Tests script exact replies with `ScriptedClient`.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol

from app.agent.tools import PROPOSE_CHANGES, RESPOND

REQUEST_TIMEOUT_SECONDS = 45
MAX_OUTPUT_TOKENS = 4000


@dataclass(frozen=True)
class ToolCall:
    name: str
    arguments: dict | None  # None when the model sent arguments that are not a JSON object


class AgentUnavailable(Exception):
    """The model could not be reached or refused the request (quota, auth, timeout, ...)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class LLMClient(Protocol):
    def call(self, instructions: str, items: list[dict], tools: list[dict]) -> ToolCall | str: ...


def parse_arguments(raw: str) -> dict | None:
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


class OpenAIClient:
    def __init__(self, api_key: str, model: str) -> None:
        import openai  # imported lazily: tests and E2E never need the SDK

        self._openai = openai
        self._client = openai.OpenAI(api_key=api_key, timeout=REQUEST_TIMEOUT_SECONDS, max_retries=1)
        self._model = model

    def call(self, instructions: str, items: list[dict], tools: list[dict]) -> ToolCall | str:
        try:
            response = self._client.responses.create(
                model=self._model,
                instructions=instructions,
                input=items,
                tools=tools,
                tool_choice="required",
                parallel_tool_calls=False,
                max_output_tokens=MAX_OUTPUT_TOKENS,
                store=False,
            )
        except self._openai.RateLimitError as error:
            code = getattr(error, "code", None) or "rate_limited"
            raise AgentUnavailable("quota" if "quota" in str(code) or "credit" in str(code) else "rate_limited") from None
        except self._openai.AuthenticationError:
            raise AgentUnavailable("auth") from None
        except (self._openai.APITimeoutError, self._openai.APIConnectionError):
            raise AgentUnavailable("network") from None
        except self._openai.OpenAIError:
            raise AgentUnavailable("upstream") from None

        for item in response.output or []:
            if getattr(item, "type", None) == "function_call":
                return ToolCall(item.name, parse_arguments(item.arguments))
        return response.output_text or ""


class ScriptedClient:
    """Returns pre-set replies in order and records every request (tests only)."""

    def __init__(self, replies: Iterable[ToolCall | str | Exception]) -> None:
        self._replies = list(replies)
        self.requests: list[list[dict]] = []

    def call(self, instructions: str, items: list[dict], tools: list[dict]) -> ToolCall | str:
        self.requests.append(list(items))
        reply = self._replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


_WIDTH = re.compile(r"(\d{2,3})\s*cm\s+wide", re.IGNORECASE)


class FakeClient:
    """Deterministic keyword rules, so E2E tests exercise the full proposal flow offline."""

    def call(self, instructions: str, items: list[dict], tools: list[dict]) -> ToolCall | str:
        text = next((i["content"] for i in reversed(items) if i.get("role") == "user"), "").lower()
        ops: list[dict] = []
        if match := _WIDTH.search(text):
            ops.append({"op": "update_dimensions", "width": int(match.group(1)) * 10})
        if "sliding" in text:
            ops.append({"op": "configure_doors", "type": "sliding", "count": 2})
        if "fourth compartment" in text:  # leaves compartment 3 narrow, to exercise the card warning
            ops.append({"op": "add_compartment", "position": 3, "width": 481})
        if not ops:
            return ToolCall(RESPOND, {"message": "Could you tell me the width you need in cm?"})
        return ToolCall(PROPOSE_CHANGES, {"message": "Here is a proposal for you to review.",
                                          "summary": "Update the wardrobe as requested", "ops": ops})
