from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded

from app.api import chat, health, proposals, reference, render, spec, voice
from app.api.common import error_response, limiter
from app.config import get_settings

# A design is a few KB; this bound keeps oversized bodies out before they are parsed.
MAX_BODY_BYTES = 256 * 1024
# Push-to-talk audio is larger: the audio limit plus room for the multipart envelope.
BODY_LIMITS = {
    "/api/voice/transcribe": voice.MAX_AUDIO_BYTES + 16 * 1024,
    "/api/render": render.MAX_IMAGE_BASE64 + 512 * 1024,  # the PNG (base64) plus the design
    "/api/spec": spec.MAX_RENDER_BASE64 + 512 * 1024,  # the render (base64) plus the design
}


def create_app() -> FastAPI:
    settings = get_settings()
    is_production = settings.app_env == "production"
    app = FastAPI(
        title="BanAI Wardrobe Designer API",
        version="0.1.0",
        docs_url=None if is_production else "/docs",
        redoc_url=None if is_production else "/redoc",
        openapi_url=None if is_production else "/openapi.json",
    )
    app.state.limiter = limiter
    app.add_exception_handler(
        RateLimitExceeded,
        lambda request, exc: error_response(429, "RATE_LIMITED", "Too many requests. Please wait a moment."),
    )

    @app.middleware("http")
    async def limit_body_size(request: Request, call_next):
        if request.method in ("POST", "PUT"):
            length = request.headers.get("content-length")
            if length is None or not length.isdigit():
                return error_response(411, "LENGTH_REQUIRED", "A Content-Length header is required.")
            if int(length) > BODY_LIMITS.get(request.url.path, MAX_BODY_BYTES):
                return error_response(413, "PAYLOAD_TOO_LARGE", "The request is too large.")
        return await call_next(request)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Authorization", "Content-Type", "If-Match"],
    )
    app.include_router(health.router)
    app.include_router(reference.router)
    app.include_router(chat.router)
    app.include_router(proposals.router)
    app.include_router(voice.router)
    app.include_router(render.router)
    app.include_router(spec.router)
    return app


app = create_app()
