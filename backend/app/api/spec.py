"""POST /api/spec: the carpenter spec PDF for the current design (spec §9b, ADR-008).

A spec sheet for discussion and quoting, built from the validated design: parts as designed,
a front drawing, materials, suggested hardware and assembly order, and the render as the
illustration. It is not a manufacturing drawing and says so on every page. Nothing is stored.
"""

from __future__ import annotations

import base64
import binascii
import io
from typing import Annotated, Literal

from fastapi import APIRouter, Request
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from app.api.common import error_response, limiter
from app.domain.apply import apply_ops
from app.domain.catalog import load_catalog
from app.domain.errors import DomainError
from app.spec.pdf import build_spec_pdf

router = APIRouter(prefix="/api")

MAX_RENDER_BYTES = 6 * 1024 * 1024
MAX_RENDER_BASE64 = (MAX_RENDER_BYTES // 3 + 1) * 4
SPEC_RATE_LIMIT = "10/minute"
IMAGE_MAGIC = (b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n")
# A render is at most ~1.5k px a side. The pixel size is read from the header before any decode,
# so a tiny, highly compressed PNG cannot expand to gigabytes in memory.
MAX_RENDER_SIDE = 4096
MAX_RENDER_PIXELS = 16_000_000
COVER_SIDE = 1600


class ImageTooLarge(ValueError):
    pass


def normalize_render(data: bytes) -> bytes:
    """Check the pixel size, then re-encode once as a plain JPEG for the cover.

    Only these bytes reach ReportLab, which also drops any unusual chunks in the upload.
    """
    with Image.open(io.BytesIO(data)) as image:
        width, height = image.size
        if image.format not in ("JPEG", "PNG"):
            raise ValueError("not a JPEG or PNG")
        if max(width, height) > MAX_RENDER_SIDE or width * height > MAX_RENDER_PIXELS:
            raise ImageTooLarge
        image.thumbnail((COVER_SIDE, COVER_SIDE))
        flat = image.convert("RGB")
    out = io.BytesIO()
    flat.save(out, "JPEG", quality=88)
    return out.getvalue()


class SpecRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    design: dict
    # The render shown in the dialog (base64 JPEG/PNG), used as the cover illustration. Optional.
    render: Annotated[str | None, Field(default=None)] = None
    locale: Literal["he", "en"] = "he"


@router.post("/spec")
@limiter.limit(SPEC_RATE_LIMIT)
async def spec(request: Request, body: SpecRequest):
    image = None
    if body.render:
        try:
            image = base64.b64decode(body.render, validate=True)
        except (binascii.Error, ValueError):
            return error_response(415, "UNSUPPORTED_IMAGE", "The image must be a JPEG or PNG.")
        if not image.startswith(IMAGE_MAGIC):
            return error_response(415, "UNSUPPORTED_IMAGE", "The image must be a JPEG or PNG.")
        if len(image) > MAX_RENDER_BYTES:
            return error_response(413, "PAYLOAD_TOO_LARGE", "The image is too large.")
        try:
            image = await run_in_threadpool(normalize_render, image)
        except ImageTooLarge:
            return error_response(413, "PAYLOAD_TOO_LARGE", "The image is too large.")
        except Exception:  # noqa: BLE001 - a broken image: report, never leak details
            return error_response(422, "UNSUPPORTED_IMAGE", "The image could not be read.")
    try:
        design = apply_ops(body.design, [], load_catalog())
    except DomainError as error:
        return error_response(422, "INVALID_DESIGN", "The current design is not valid.", detail=error.to_dict())
    try:
        pdf = await run_in_threadpool(build_spec_pdf, design, image, body.locale)
    except Exception:  # noqa: BLE001 - e.g. an image ReportLab cannot read: report, never leak details
        return error_response(422, "UNSUPPORTED_IMAGE", "The image could not be read.")
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                             "Content-Disposition": 'attachment; filename="banai-spec.pdf"'})
