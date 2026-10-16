"""POST /api/render: a photoreal, illustrative image of the customer's current design (Phase 8).

The browser sends a clean capture of the 3D view; the server validates the design, writes the
prompt from it, and asks the image model to keep to the capture. Nothing is stored and the
design is never changed. The result is always labelled illustrative in the UI.
"""

from __future__ import annotations

import base64
import binascii
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from app.agent.llm import AgentUnavailable
from app.agent.render_prompt import render_prompt
from app.api.chat import UNAVAILABLE_MESSAGES
from app.api.common import error_response, limiter
from app.config import Settings, get_settings
from app.domain.apply import apply_ops
from app.domain.catalog import load_catalog
from app.domain.errors import DomainError
from app.services.imaging import ImageClient, image_client_for

router = APIRouter(prefix="/api")

MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_IMAGE_BASE64 = (MAX_IMAGE_BYTES // 3 + 1) * 4
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
RENDER_RATE_LIMIT = "5/minute"


class RenderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    design: dict
    # base64 PNG; its size is bounded by the per-path body cap in main.py, then checked decoded (413).
    image: Annotated[str, Field(min_length=16)]
    doors_visible: Annotated[bool, Field(alias="doorsVisible")] = True


def get_image_client(settings: Annotated[Settings, Depends(get_settings)]) -> ImageClient | None:
    return image_client_for(settings)


@router.post("/render")
@limiter.limit(RENDER_RATE_LIMIT)
async def render(request: Request, body: RenderRequest,
                 client: Annotated[ImageClient | None, Depends(get_image_client)]):
    try:
        reference = base64.b64decode(body.image, validate=True)
    except (binascii.Error, ValueError):
        return error_response(415, "UNSUPPORTED_IMAGE", "The image must be a PNG.")
    if not reference.startswith(PNG_MAGIC):
        return error_response(415, "UNSUPPORTED_IMAGE", "The image must be a PNG.")
    if len(reference) > MAX_IMAGE_BYTES:
        return error_response(413, "PAYLOAD_TOO_LARGE", "The image is too large.")
    catalog = load_catalog()
    try:
        design = apply_ops(body.design, [], catalog)
    except DomainError as error:
        return error_response(422, "INVALID_DESIGN", "The current design is not valid.", detail=error.to_dict())
    if client is None:
        return error_response(503, "AGENT_UNAVAILABLE", UNAVAILABLE_MESSAGES["not_configured"], reason="not_configured")
    prompt = render_prompt(design, catalog, body.doors_visible)
    try:
        image, mime = await run_in_threadpool(client.render, reference, prompt)
    except AgentUnavailable as error:
        return error_response(503, "AGENT_UNAVAILABLE", UNAVAILABLE_MESSAGES[error.reason], reason=error.reason)
    return {"success": True, "data": {"imageBase64": base64.b64encode(image).decode("ascii"), "mimeType": mime}, "error": None}
