"""Proposal integrity: a stable design hash and an HMAC over (ops, baseRevision, baseHash).

The server keeps no proposal state. A proposal is trusted at apply time only because its
signature verifies, so a client cannot alter the ops or the base it was computed against.
"""

from __future__ import annotations

import hashlib
import hmac
import json


def canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def design_hash(design: dict) -> str:
    """Hash of a canonical (already parsed) design."""
    return hashlib.sha256(canonical_json(design)).hexdigest()


def _payload(proposal_id: str, ops: list, base_revision: int, base_hash: str) -> bytes:
    return canonical_json({"proposalId": proposal_id, "ops": ops, "baseRevision": base_revision, "baseHash": base_hash})


def sign(key: str, proposal_id: str, ops: list, base_revision: int, base_hash: str) -> str:
    payload = _payload(proposal_id, ops, base_revision, base_hash)
    return hmac.new(key.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def verify(key: str, signature: str, proposal_id: str, ops: list, base_revision: int, base_hash: str) -> bool:
    expected = sign(key, proposal_id, ops, base_revision, base_hash)
    return hmac.compare_digest(expected, signature)


def reply_token(key: str, text: str) -> str:
    """Marks text as a genuine agent reply, so /api/voice/speak only speaks the agent's own words."""
    return hmac.new(key.encode("utf-8"), b"speak:" + text.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_reply_token(key: str, text: str, token: str) -> bool:
    return bool(key) and hmac.compare_digest(reply_token(key, text), token)
