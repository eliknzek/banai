from types import SimpleNamespace

import httpx2 as httpx
import openai
import pytest
from fastapi.testclient import TestClient

from app.agent.llm import AgentUnavailable, ScriptedClient, ToolCall
from app.api import chat, voice
from app.api.common import limiter
from app.config import Settings, get_settings
from app.domain.defaults import basic_wardrobe
from app.main import app
from app.services import signing
from app.services.speech import SILENT_MP3, VOCABULARY_PROMPT, FakeSpeech, OpenAISpeech

KEY = "voice-test-key"
SETTINGS = Settings(_env_file=None, proposal_signing_key=KEY, openai_api_key="", openai_chat_model="")
AUDIO = b"\x1aE\xdf\xa3" + b"\x00" * 4096  # webm magic + padding; the fake never decodes it
client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated():
    limiter.reset()
    app.dependency_overrides[get_settings] = lambda: SETTINGS
    yield
    app.dependency_overrides.clear()


def use_speech(speech=None):
    speech = speech or FakeSpeech()
    app.dependency_overrides[voice.get_speech_client] = lambda: speech
    return speech


def upload(data=AUDIO, content_type="audio/webm;codecs=opus"):
    return client.post("/api/voice/transcribe", files={"audio": ("clip.webm", data, content_type)})


def test_transcribe_returns_the_transcript():
    use_speech(FakeSpeech("תוסיף מדף בתא האמצעי"))
    response = upload()
    assert response.status_code == 200
    assert response.json()["data"] == {"text": "תוסיף מדף בתא האמצעי"}


@pytest.mark.parametrize("content_type", ["audio/mp4", "audio/ogg", "audio/mpeg", "audio/wav"])
def test_transcribe_accepts_browser_formats(content_type):
    use_speech()
    assert upload(content_type=content_type).status_code == 200


@pytest.mark.parametrize("content_type", ["text/plain", "image/png", "application/octet-stream", ""])
def test_transcribe_rejects_other_types(content_type):
    use_speech()
    assert upload(content_type=content_type).status_code == 415


def test_transcribe_bounds_the_size():
    use_speech()
    assert upload(data=b"x" * 100).status_code == 422
    assert upload(data=b"x" * (voice.MAX_AUDIO_BYTES + 1)).status_code == 413


def test_body_cap_is_per_path():
    use_speech()
    big = b"x" * (voice.MAX_AUDIO_BYTES + 64 * 1024)
    assert upload(data=big).status_code == 413  # rejected by the middleware before parsing


def test_empty_transcript_is_passed_through():
    use_speech(FakeSpeech(""))
    assert upload().json()["data"] == {"text": ""}


def test_transcribe_without_configuration_is_unavailable():
    response = upload()
    assert response.status_code == 503 and response.json()["error"]["reason"] == "not_configured"


class FailingSpeech(FakeSpeech):
    def transcribe(self, *args):
        raise AgentUnavailable("quota")

    def speak(self, text):
        raise AgentUnavailable("network")


def test_upstream_failures_map_to_safe_reasons():
    use_speech(FailingSpeech())
    assert upload().json()["error"]["reason"] == "quota"
    token = signing.reply_token(KEY, "hello")
    assert client.post("/api/voice/speak", json={"text": "hello", "token": token}).json()["error"]["reason"] == "network"


def test_chat_reply_carries_a_token_that_speak_accepts():
    scripted = ScriptedClient([ToolCall("respond", {"message": "Which width do you need?"})])
    app.dependency_overrides[chat.get_agent_client] = lambda: scripted
    body = {"messages": [{"role": "user", "content": "bigger"}], "design": basic_wardrobe(), "revision": 1}
    data = client.post("/api/chat", json=body).json()["data"]
    assert signing.verify_reply_token(KEY, data["reply"], data["replyToken"])
    speech = use_speech()
    response = client.post("/api/voice/speak", json={"text": data["reply"], "token": data["replyToken"]})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.content == SILENT_MP3
    assert speech.spoken == ["Which width do you need?"]


@pytest.mark.parametrize("text,token", [
    ("hello!", signing.reply_token(KEY, "hello")),        # text changed after signing
    ("hello", signing.reply_token("other-key", "hello")),  # signed with another key
    ("hello", "0" * 64),
])
def test_speak_only_speaks_genuine_agent_replies(text, token):
    speech = use_speech()
    assert client.post("/api/voice/speak", json={"text": text, "token": token}).status_code == 400
    assert speech.spoken == []


@pytest.mark.parametrize("body", [
    {"text": "", "token": "0" * 64},
    {"text": "x" * 1201, "token": "0" * 64},
    {"text": "hi", "token": "not-hex"},
    {"text": "hi", "token": "0" * 64, "extra": 1},
])
def test_speak_input_is_bounded(body):
    use_speech()
    assert client.post("/api/voice/speak", json=body).status_code == 422


def test_speak_without_a_signing_key_refuses():
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, proposal_signing_key="")
    use_speech()
    token = signing.reply_token("", "hello")
    assert client.post("/api/voice/speak", json={"text": "hello", "token": token}).status_code == 400


def openai_speech(transcriptions=None, speech=None):
    s = OpenAISpeech(api_key="sk-test", stt_model="gpt-transcribe", tts_model="gpt-4o-mini-tts", tts_voice="alloy")
    s._client = SimpleNamespace(audio=SimpleNamespace(
        transcriptions=SimpleNamespace(create=transcriptions), speech=SimpleNamespace(create=speech)))
    return s


def test_openai_speech_passes_model_and_vocabulary_prompt():
    calls = []

    def create(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(text="  שלום  ")

    assert openai_speech(transcriptions=create).transcribe(b"abc", "speech.webm", "audio/webm") == "שלום"
    assert calls[0]["model"] == "gpt-transcribe" and calls[0]["prompt"] == VOCABULARY_PROMPT
    assert calls[0]["file"][0] == "speech.webm"


def test_openai_speech_returns_mp3_bytes():
    def create(**kwargs):
        assert kwargs["response_format"] == "mp3" and kwargs["voice"] == "alloy"
        return SimpleNamespace(read=lambda: b"mp3")

    assert openai_speech(speech=create).speak("hi") == b"mp3"


def _status_error(cls, status, code):
    request = httpx.Request("POST", "https://api.openai.com/v1/audio/speech")
    return cls("no", response=httpx.Response(status, request=request), body={"code": code})


@pytest.mark.parametrize("error,reason", [
    (_status_error(openai.RateLimitError, 429, "insufficient_quota"), "quota"),
    (_status_error(openai.AuthenticationError, 401, "invalid_api_key"), "auth"),
    (openai.APIConnectionError(request=httpx.Request("POST", "https://api.openai.com")), "network"),
    (_status_error(openai.BadRequestError, 400, "invalid_value"), "upstream"),
])
def test_openai_speech_errors_map_to_safe_reasons(error, reason):
    def boom(**_):
        raise error

    with pytest.raises(AgentUnavailable) as caught:
        openai_speech(transcriptions=boom).transcribe(b"abc", "speech.webm", "audio/webm")
    assert caught.value.reason == reason
