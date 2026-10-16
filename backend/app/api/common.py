"""Shared API helpers: the error envelope and the per-IP rate limiter."""

from __future__ import annotations

from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)


def error_response(status: int, code: str, message: str, **extra: object) -> JSONResponse:
    return JSONResponse(status_code=status,
                        content={"success": False, "data": None, "error": {"code": code, "message": message, **extra}})
