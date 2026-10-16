"""Speech-to-text and text-to-speech behind one small interface (spec §9a, ADR-007).

Voice is a chained pipeline around the existing agent: audio is transcribed here, the text
goes through /api/chat like any typed message, and the agent's reply is spoken here.
Nothing in this module can change a design. Audio is never stored or logged.
"""

from __future__ import annotations

import io
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

# Smallest valid MPEG audio frame (silence), used by FakeSpeech.
SILENT_MP3 = bytes.fromhex("fffb9064" + "00" * 413)



class SpeechClient(Protocol):
    def transcribe(self, audio: bytes, filename: str, content_type: str) -> str: ...

    def speak_stream(self, text: str) -> Iterator[bytes]:
        """Opens the speech stream (raising AgentUnavailable on failure) and returns its mp3 chunks."""
        ...


class OpenAISpeech:
    def __init__(self, api_key: str, stt_model: str, tts_model: str, tts_voice: str) -> None:
        import openai  # lazy: tests and E2E never need the SDK

        self._openai = openai
        self._client = openai.OpenAI(api_key=api_key, timeout=REQUEST_TIMEOUT_SECONDS, max_retries=1)
        self._stt_model, self._tts_model, self._tts_voice = stt_model, tts_model, tts_voice

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
            stream = self._client.audio.speech.with_streaming_response.create(
                model=self._tts_model, voice=self._tts_voice, input=text, response_format="mp3",
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
