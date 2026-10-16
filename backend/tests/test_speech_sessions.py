import threading
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.agent.llm import AgentUnavailable, ScriptedClient, ToolCall
from app.api import chat
from app.api.common import get_speech_client, limiter
from app.config import Settings, get_settings
from app.domain.defaults import basic_wardrobe
from app.main import app
from app.services import speech_sessions
from app.services.speech import DEFAULT_TTS_INSTRUCTIONS, FakeSpeech, OpenAISpeech, speech_text
from app.services.speech_sessions import MAX_SESSIONS, SpeechSessionStore

SETTINGS = Settings(_env_file=None, proposal_signing_key="k", openai_api_key="", openai_chat_model="")
client = TestClient(app)


def run_now(target):
    target()


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    limiter.reset()
    store = SpeechSessionStore(spawn=run_now)  # synchronous in tests
    monkeypatch.setattr(speech_sessions, "store", store)
    monkeypatch.setattr(chat, "speech_sessions", store)
    from app.api import voice
    monkeypatch.setattr(voice, "speech_sessions", store)
    app.dependency_overrides[get_settings] = lambda: SETTINGS
    app.dependency_overrides[chat.get_agent_client] = lambda: ScriptedClient([ToolCall("respond", {"message": "Which width, in cm?"})])
    yield store
    app.dependency_overrides.clear()


def chat_body(speak):
    return {"messages": [{"role": "user", "content": "bigger"}], "design": basic_wardrobe(), "revision": 1, "speak": speak}


def test_chat_starts_speech_and_returns_a_single_use_stream_url(isolated):
    speech = FakeSpeech()
    app.dependency_overrides[get_speech_client] = lambda: speech
    data = client.post("/api/chat", json=chat_body(True)).json()["data"]
    assert data["speechUrl"].startswith("/api/voice/stream/")
    assert speech.spoken == ["Which width, in cm?"]  # started by /api/chat, before the browser asked
    first = client.get(data["speechUrl"])
    assert first.status_code == 200 and first.headers["content-type"] == "audio/mpeg"
    assert len(first.content) > 0
    assert client.get(data["speechUrl"]).status_code == 404  # single use


def test_no_speech_unless_requested_or_configured():
    app.dependency_overrides[get_speech_client] = lambda: FakeSpeech()
    assert client.post("/api/chat", json=chat_body(False)).json()["data"]["speechUrl"] is None
    app.dependency_overrides[get_speech_client] = lambda: None
    assert client.post("/api/chat", json=chat_body(True)).json()["data"]["speechUrl"] is None


@pytest.mark.parametrize("speech_id", ["unknown-but-valid-1234", "x" * 70, "bad/../id"])
def test_unknown_or_malformed_ids_are_not_found(speech_id):
    assert client.get(f"/api/voice/stream/{speech_id}").status_code in (404, 422)


def test_failed_speech_reports_unavailable(isolated):
    def boom():
        raise AgentUnavailable("quota")

    speech_id = isolated.start(boom)
    assert client.get(f"/api/voice/stream/{speech_id}").status_code == 503


def test_sessions_expire(isolated, monkeypatch):
    speech_id = isolated.start(lambda: iter([b"a"]))
    real = speech_sessions.time.monotonic
    monkeypatch.setattr(speech_sessions.time, "monotonic", lambda: real() + speech_sessions.SESSION_TTL_SECONDS + 1)
    assert isolated.take(speech_id) is None


def test_store_is_bounded(isolated):
    ids = [isolated.start(lambda: iter([b"a"])) for _ in range(MAX_SESSIONS + 5)]
    assert len(isolated) <= MAX_SESSIONS
    assert isolated.take(ids[0]) is None and isolated.take(ids[-1]) is not None


def test_session_streams_chunks_as_they_are_produced():
    store = SpeechSessionStore()  # real background thread
    gate = threading.Event()

    def produce():
        yield b"first"
        gate.wait(2)
        yield b"second"

    session = store.take(store.start(produce))
    chunks = session.chunks()
    assert next(chunks) == b"first"  # available before the producer finished
    gate.set()
    assert b"".join(chunks) == b"second"


def test_session_caps_its_size(monkeypatch):
    monkeypatch.setattr(speech_sessions, "MAX_SESSION_BYTES", 10)
    store = SpeechSessionStore(spawn=run_now)
    session = store.take(store.start(lambda: iter([b"12345", b"67890", b"overflow"])))
    assert b"".join(session.chunks()) == b"1234567890"


@pytest.mark.parametrize("text,spoken", [
    ('רוחב 260 ס"מ', "רוחב 260 סנטימטר"),
    ("רוחב 260 ס״מ", "רוחב 260 סנטימטר"),
    ("Make it 240 cm wide", "Make it 240 centimeters wide"),
    ("64.3 · 64.3 cm", "64.3, 64.3 centimeters"),
    ("200 × 240", "200 by 240"),
    ("no symbols here", "no symbols here"),
])
def test_speech_text_reads_like_a_person(text, spoken):
    assert speech_text(text) == spoken


def test_openai_speech_sends_voice_instructions_and_spoken_text():
    calls = []

    class Stream:
        def __enter__(self):
            return SimpleNamespace(iter_bytes=lambda chunk_size=None: iter([b"x"]))

        def __exit__(self, *exc):
            return None

    s = OpenAISpeech("sk-test", "gpt-transcribe", "gpt-4o-mini-tts", "marin")
    s._client = SimpleNamespace(audio=SimpleNamespace(speech=SimpleNamespace(
        with_streaming_response=SimpleNamespace(create=lambda **kw: calls.append(kw) or Stream()))))
    assert list(s.speak_stream('רוחב 260 ס"מ')) == [b"x"]
    assert calls[0]["voice"] == "marin"
    assert calls[0]["instructions"] == DEFAULT_TTS_INSTRUCTIONS
    assert calls[0]["input"] == "רוחב 260 סנטימטר"
