"""Speech-to-text and text-to-speech behind one small interface (spec §9a, ADR-007).

Voice is a chained pipeline around the existing agent: audio is transcribed here, the text
goes through /api/chat like any typed message, and the agent's reply is spoken here.
Nothing in this module can change a design. Audio is never stored or logged.
"""

from __future__ import annotations

import io
import re
from collections.abc import Iterator
from typing import Protocol

from app.agent.llm import REQUEST_TIMEOUT_SECONDS, AgentUnavailable

# Domain words that STT otherwise mishears in Hebrew (for example "הזזה" -> "הזהבה").
# Chosen from the 2026-10-16 Hebrew STT test (Obsidian 07 - Voice Agent Architecture).
VOCABULARY_PROMPT = (
    "שיחה על עיצוב ארון בגדים. מילים נפוצות: ארון, תא שמאלי, תא אמצעי, תא ימני, מדף, מגירה, "
    "מוט תלייה, מחיצה, דלתות הזזה, דלתות ציר, רוחב, גובה, עומק, סנטימטר, מטר, "
    "לבן, אפור בהיר, אנתרציט, שחור, אלון טבעי, אגוז, מט, סאטן, מבריק."
)

# How the voice should sound (spec §9a: "like a real person talking"). Configurable default via
# OPENAI_TTS_INSTRUCTIONS; gpt-4o-mini-tts follows it, tts-1 ignores it.
DEFAULT_TTS_INSTRUCTIONS = (
    "Speak like a warm, friendly interior designer chatting with a customer in a showroom. "
    "Natural conversational pace, not slow. Relaxed and confident, with a light smile in the voice. "
    "Use short natural pauses at commas, and end questions with a natural rising tone. "
    "Sound like a real person talking, never like text being read aloud. "
    "When the text is Hebrew, speak natural modern Israeli Hebrew."
)

_SPEECH_REPLACEMENTS = [
    (re.compile(r'ס["״]מ'), "סנטימטר"),
    (re.compile(r'מ["״]מ'), "מילימטר"),
    (re.compile(r"(?<=\d)\s?cm\b", re.I), " centimeters"),
    (re.compile(r"(?<=\d)\s?mm\b", re.I), " millimeters"),
    (re.compile(r"\s*[·•]\s*"), ", "),
    (re.compile(r"\s*×\s*"), " by "),
]


def speech_text(text: str) -> str:
    """What is spoken: abbreviations and symbols read the way a person would say them.
    The text shown in the chat is never changed."""
    for pattern, replacement in _SPEECH_REPLACEMENTS:
        text = pattern.sub(replacement, text)
    return text


# Smallest valid MPEG audio frame (silence), used by FakeSpeech.
SILENT_MP3 = bytes.fromhex("fffb9064" + "00" * 413)



class SpeechClient(Protocol):
    def transcribe(self, audio: bytes, filename: str, content_type: str) -> str: ...

    def speak_stream(self, text: str) -> Iterator[bytes]:
        """Opens the speech stream (raising AgentUnavailable on failure) and returns its mp3 chunks."""
        ...


class OpenAISpeech:
    def __init__(self, api_key: str, stt_model: str, tts_model: str, tts_voice: str,
                 tts_instructions: str = DEFAULT_TTS_INSTRUCTIONS) -> None:
        import openai  # lazy: tests and E2E never need the SDK

        self._openai = openai
        self._client = openai.OpenAI(api_key=api_key, timeout=REQUEST_TIMEOUT_SECONDS, max_retries=1)
        self._stt_model, self._tts_model, self._tts_voice = stt_model, tts_model, tts_voice
        self._tts_instructions = tts_instructions

    def transcribe(self, audio: bytes, filename: str, content_type: str) -> str:
        with self._mapped_errors():
            result = self._client.audio.transcriptions.create(
                model=self._stt_model, file=(filename, io.BytesIO(audio), content_type), prompt=VOCABULARY_PROMPT,
            )
        return (getattr(result, "text", "") or "").strip()

    def speak_stream(self, text: str) -> Iterator[bytes]:
        # The request is sent here, before any byte reaches the browser, so an upstream error
        # can still become a clean 503. Chunks are then forwarded as OpenAI produces them,
        # instead of waiting for the whole clip: playback starts about a second sooner.
        with self._mapped_errors():
            extra = {"instructions": self._tts_instructions} if self._tts_instructions else {}
            stream = self._client.audio.speech.with_streaming_response.create(
                model=self._tts_model, voice=self._tts_voice, input=speech_text(text), response_format="mp3", **extra,
            )
            response = stream.__enter__()

        def chunks() -> Iterator[bytes]:
            try:
                # No fixed chunk size: forward bytes as soon as OpenAI sends them.
                yield from response.iter_bytes()
            except Exception:  # noqa: BLE001 - headers are sent; the clip just ends early
                return
            finally:
                stream.__exit__(None, None, None)

        return chunks()

    def _mapped_errors(self):
        return _ErrorMapper(self._openai)


class _ErrorMapper:
    """Same safe reasons as the chat client; the upstream message never reaches the caller."""

    def __init__(self, openai_module) -> None:
        self._openai = openai_module

    def __enter__(self) -> None:
        return None

    def __exit__(self, exc_type, exc, tb) -> bool:
        if exc is None:
            return False
        o = self._openai
        if isinstance(exc, o.RateLimitError):
            code = str(getattr(exc, "code", None) or "")
            raise AgentUnavailable("quota" if "quota" in code or "credit" in code else "rate_limited") from None
        if isinstance(exc, o.AuthenticationError):
            raise AgentUnavailable("auth") from None
        if isinstance(exc, (o.APITimeoutError, o.APIConnectionError)):
            raise AgentUnavailable("network") from None
        if isinstance(exc, o.OpenAIError):
            raise AgentUnavailable("upstream") from None
        return False


class FakeSpeech:
    """Deterministic stand-in for E2E runs (APP_ENV=e2e) and tests."""

    TRANSCRIPT = "Make it 240 cm wide with sliding doors"

    def __init__(self, transcript: str = TRANSCRIPT) -> None:
        self.transcript = transcript
        self.spoken: list[str] = []

    def transcribe(self, audio: bytes, filename: str, content_type: str) -> str:
        return self.transcript

    def speak_stream(self, text: str) -> Iterator[bytes]:
        self.spoken.append(text)
        half = len(SILENT_MP3) // 2
        return iter([SILENT_MP3[:half], SILENT_MP3[half:]])


def speech_client_for(settings) -> SpeechClient | None:
    """The configured speech client: a fake under APP_ENV=e2e, None when no key is set."""
    if settings.uses_fake_agent:
        return FakeSpeech()
    if not settings.openai_api_key:
        return None
    return OpenAISpeech(settings.openai_api_key, settings.openai_stt_model, settings.openai_tts_model,
                        settings.openai_tts_voice, settings.openai_tts_instructions)
