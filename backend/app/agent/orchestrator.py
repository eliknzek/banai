"""One agent turn: messages + committed design -> reply and an optional signed proposal.

The model's ops are untrusted input. They are parsed with the domain schema, dry-run on the
design (the caller's copy is never touched), and only then signed. A rejected batch is fed
back to the model for repair, at most MAX_REPAIRS times, before the customer gets a
clarifying reply instead. Nothing here commits state.
"""

from __future__ import annotations

import re
import secrets
from dataclasses import dataclass

from app.agent.describe import describe_ops
from app.agent.llm import LLMClient, ToolCall
from app.agent.prompts import design_context, repair_note, system_prompt
from app.agent.tools import PROPOSE_CHANGES, RESPOND, TOOLS
from app.domain import ids
from app.domain.apply import apply_ops
from app.domain.errors import SCHEMA_INVALID, DomainError
from app.domain.ops import parse_ops
from app.services import signing

MAX_REPAIRS = 2
MAX_MESSAGE_CHARS = 1200
MAX_SUMMARY_CHARS = 160
FALLBACK_REPLY = ("I couldn't turn that into a valid change. Could you describe it a bit differently, "
                  "for example with sizes in cm?")
NO_CHANGE_REPLY = "That already matches your design, so there is nothing to change."

# Model text is shown with textContent, so this only drops invisible/bidi control characters.
_UNSAFE_CHARS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f​-‍  ‪-‮⁦-⁩﻿]")


@dataclass(frozen=True)
class AgentResult:
    reply: str
    proposal: dict | None = None


def clean_text(value: object, limit: int) -> str:
    text = _UNSAFE_CHARS.sub("", value if isinstance(value, str) else "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


LANGUAGE_NAMES = {"he": "Hebrew", "en": "English"}


def run_turn(client: LLMClient, messages: list[dict], design: dict, revision: int,
             catalog: dict, signing_key: str, locale: str = "en") -> AgentResult:
    base = apply_ops(design, [], catalog)  # parse + full validation of the committed design
    base_hash = signing.design_hash(base)
    language = LANGUAGE_NAMES.get(locale, "English")
    items = [{"role": "developer", "content": design_context(base, revision)},
             {"role": "developer", "content": f"The interface language is {language}. Reply in the customer's "
                                              f"language; if it is unclear, reply in {language}."},
             *messages]
    instructions = system_prompt(catalog)

    for _ in range(MAX_REPAIRS + 1):
        call = client.call(instructions, items, TOOLS)
        if not isinstance(call, ToolCall):
            return AgentResult(clean_text(call, MAX_MESSAGE_CHARS) or FALLBACK_REPLY)
        args = call.arguments or {}
        message = clean_text(args.get("message"), MAX_MESSAGE_CHARS)
        if call.name == RESPOND:
            return AgentResult(message or FALLBACK_REPLY)
        if call.name != PROPOSE_CHANGES:
            items.append({"role": "developer", "content": "Unknown tool. Use propose_changes or respond."})
            continue
        try:
            proposal = _build_proposal(args, base, revision, base_hash, catalog, signing_key)
        except DomainError as error:
            items.append({"role": "developer", "content": repair_note(error.to_dict(), args.get("ops"))})
            continue
        if proposal is None:
            return AgentResult(message or NO_CHANGE_REPLY)
        return AgentResult(message or proposal["summary"], proposal)
    return AgentResult(FALLBACK_REPLY)


def _build_proposal(args: dict, base: dict, revision: int, base_hash: str,
                    catalog: dict, signing_key: str) -> dict | None:
    raw_ops = args.get("ops")
    if not isinstance(raw_ops, list) or not raw_ops:
        raise DomainError(SCHEMA_INVALID, "ops", "ops must be a non-empty array")
    parsed = parse_ops(raw_ops)
    ops = [op.model_dump(mode="json", by_alias=True, exclude_none=True) for op in parsed]
    proposal_id = f"prop_{secrets.token_hex(8)}"
    with ids.seeded_ids(proposal_id):  # the approved apply replays the same ids
        result = apply_ops(base, ops, catalog)
    if result == base:
        return None
    summary = clean_text(args.get("summary"), MAX_SUMMARY_CHARS) or "Proposed changes"
    return {
        "proposalId": proposal_id,
        "baseRevision": revision,
        "baseHash": base_hash,
        "ops": ops,
        "summary": summary,
        "changes": describe_ops(parsed, base, result, catalog),
        "signature": signing.sign(signing_key, proposal_id, ops, revision, base_hash),
    }
