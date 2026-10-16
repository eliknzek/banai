"""Application settings loaded from environment variables."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.services.speech import DEFAULT_TTS_INSTRUCTIONS


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "local"
    cors_origins: str = "http://localhost:5173"
    # Secrets come from the environment only; empty means "not configured".
    openai_api_key: str = ""
    openai_chat_model: str = ""
    proposal_signing_key: str = ""
    # Voice (spec §9a). Configurable defaults, not business rules.
    openai_stt_model: str = "gpt-transcribe"
    openai_tts_model: str = "gpt-4o-mini-tts"
    openai_tts_voice: str = "cedar"  # chosen by the user from the voice samples (2026-10-16)
    openai_tts_instructions: str = DEFAULT_TTS_INSTRUCTIONS

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def uses_fake_agent(self) -> bool:
        """E2E runs use a scripted agent, so no request ever reaches OpenAI."""
        return self.app_env == "e2e"


@lru_cache
def get_settings() -> Settings:
    return Settings()
