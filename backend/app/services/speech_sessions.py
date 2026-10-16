"""Short-lived speech sessions: TTS starts the moment the agent's reply exists.

/api/chat starts a session in a background thread before its own response is sent, so by the
time the browser asks for the audio, the first chunks are often already here. The browser
then reads them from GET /api/voice/stream/<id>.

- Ids are 128-bit random (unguessable) and single use; a session only ever holds the speech
  of one agent reply, so this is no general TTS proxy.
- Bounded: at most MAX_SESSIONS live sessions, MAX_SESSION_BYTES each, SESSION_TTL_SECONDS.
- In memory, one process (Railway runs one backend instance). If a session is missing the
  client falls back to POST /api/voice/speak.
"""

from __future__ import annotations

import secrets
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Iterator

from app.agent.llm import AgentUnavailable

MAX_SESSIONS = 50
MAX_SESSION_BYTES = 2 * 1024 * 1024
SESSION_TTL_SECONDS = 60
IDLE_TIMEOUT_SECONDS = 30


class SpeechSession:
    def __init__(self) -> None:
        self.created = time.monotonic()
        self._chunks: list[bytes] = []
        self._size = 0
        self._done = False
        self.failed = False
        self._cond = threading.Condition()

    def feed(self, produce: Callable[[], Iterator[bytes]]) -> None:
        try:
            for chunk in produce():
                with self._cond:
                    if self._size + len(chunk) > MAX_SESSION_BYTES:
                        break
                    self._chunks.append(chunk)
                    self._size += len(chunk)
                    self._cond.notify_all()
        except AgentUnavailable:
            self.failed = True
        except Exception:  # noqa: BLE001 - a broken stream just ends the clip
            self.failed = True
        finally:
            with self._cond:
                self._done = True
                self._cond.notify_all()

    def failed_before_audio(self, wait_seconds: float = 0.0) -> bool:
        with self._cond:
            self._cond.wait_for(lambda: self._chunks or self._done, timeout=wait_seconds)
            return self._done and not self._chunks and self.failed

    def chunks(self) -> Iterator[bytes]:
        index = 0
        while True:
            with self._cond:
                self._cond.wait_for(lambda: index < len(self._chunks) or self._done, timeout=IDLE_TIMEOUT_SECONDS)
                if index >= len(self._chunks):
                    return
                ready = self._chunks[index:]
            index += len(ready)
            yield b"".join(ready)


class SpeechSessionStore:
    def __init__(self, spawn: Callable[[Callable[[], None]], None] | None = None) -> None:
        self._sessions: OrderedDict[str, SpeechSession] = OrderedDict()
        self._lock = threading.Lock()
        self._spawn = spawn or (lambda target: threading.Thread(target=target, daemon=True).start())

    def start(self, produce: Callable[[], Iterator[bytes]]) -> str:
        session = SpeechSession()
        speech_id = secrets.token_urlsafe(16)
        with self._lock:
            self._evict()
            self._sessions[speech_id] = session
        self._spawn(lambda: session.feed(produce))
        return speech_id

    def take(self, speech_id: str) -> SpeechSession | None:
        """Single use: the session is removed when it is taken."""
        with self._lock:
            self._evict()
            return self._sessions.pop(speech_id, None)

    def __len__(self) -> int:
        return len(self._sessions)

    def _evict(self) -> None:
        now = time.monotonic()
        for key in [k for k, s in self._sessions.items() if now - s.created > SESSION_TTL_SECONDS]:
            del self._sessions[key]
        while len(self._sessions) >= MAX_SESSIONS:
            self._sessions.popitem(last=False)


store = SpeechSessionStore()
