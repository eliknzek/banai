"""POST /api/proposals/apply: verify a signed proposal and apply it to the committed design.

The server stores no proposals. It trusts a proposal only because its HMAC verifies, and only
if the client's design is still exactly the one the proposal was computed against.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from app.api.chat import signing_key
from app.api.common import error_response, limiter
from app.config import Settings, get_settings
from app.domain import ids
from app.domain.apply import apply_ops
from app.domain.catalog import load_catalog
from app.domain.errors import DomainError
from app.domain.ops import MAX_OPS
from app.services import signing

APPLY_RATE_LIMIT = "60/minute"
STALE_MESSAGE = "The design changed after this proposal was made. Ask the agent to propose again."


class SignedProposal(BaseModel):
    # summary/changes are display-only and may be echoed back; they are not trusted or used.
    model_config = ConfigDict(extra="ignore")
    proposal_id: Annotated[str, Field(alias="proposalId", pattern=r"^prop_[0-9a-f]{16}$")]
    base_revision: Annotated[int, Field(alias="baseRevision", ge=1)]
    base_hash: Annotated[str, Field(alias="baseHash", pattern=r"^[0-9a-f]{64}$")]
    ops: Annotated[list[dict], Field(max_length=MAX_OPS)]
    signature: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class ApplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    design: dict
    revision: Annotated[int, Field(ge=1, le=1_000_000_000)]
    proposal: SignedProposal


router = APIRouter(prefix="/api")


@router.post("/proposals/apply")
@limiter.limit(APPLY_RATE_LIMIT)
def apply_proposal(request: Request, body: ApplyRequest, settings: Annotated[Settings, Depends(get_settings)]):
    key = signing_key(settings)
    proposal = body.proposal
    if not key or not signing.verify(key, proposal.signature, proposal.proposal_id, proposal.ops,
                                     proposal.base_revision, proposal.base_hash):
        return error_response(400, "BAD_SIGNATURE", "This proposal could not be verified.")
    if body.revision != proposal.base_revision:
        return error_response(409, "STALE", STALE_MESSAGE)
    catalog = load_catalog()
    try:
        current = apply_ops(body.design, [], catalog)
    except DomainError as error:
        return error_response(422, "INVALID_DESIGN", "The current design is not valid.", detail=error.to_dict())
    if signing.design_hash(current) != proposal.base_hash:
        return error_response(409, "STALE", STALE_MESSAGE)
    try:
        with ids.seeded_ids(proposal.proposal_id):
            result = apply_ops(current, proposal.ops, catalog)
    except DomainError as error:  # a signed proposal on its own base was already dry-run
        return error_response(422, "INVALID_PROPOSAL", "This proposal can no longer be applied.", detail=error.to_dict())
    return {"success": True, "data": {"design": result, "revision": body.revision + 1}, "error": None}
