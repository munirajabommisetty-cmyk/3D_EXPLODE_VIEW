"""
Voice reliability fixes, with SIMULATED Gnani responses (requests.post patched: no network, no
credits). Covers: the new `api_key` reaching both Prisma and Timbre in the auth header, detected
language normalisation, a missing transcript field vs an empty transcript, and per-language
Timbre voices. Fake keys only; real keys are never read here.
"""
import struct

import pytest
from fastapi.testclient import TestClient

from app import config, gnani
from app.main import _supported_language, app

client = TestClient(app)
NEW_KEY = "fake-new-api-key-0001"
OLD_KEY = "fake-old-gnani-key-0002"


def wav(seconds=1.0, rate=16000) -> bytes:
    pcm = b"\x10\x00" * int(seconds * rate)
    return (b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE" + b"fmt "
            + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16) + b"data" + struct.pack("<I", len(pcm)) + pcm)


class Resp:
    def __init__(self, status=200, body=None, content=b""):
        self.status_code, self._body, self.content = status, body, content

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


@pytest.fixture
def env_keys(tmp_path, monkeypatch):
    """backend/.env holds the old GNANI_API_KEY, the root .env the new api_key (as on the user's machine)."""
    backend_env, root_env = tmp_path / "backend" / ".env", tmp_path / ".env"
    backend_env.parent.mkdir()
    backend_env.write_text(f'GNANI_API_KEY="{OLD_KEY}"\n', encoding="utf-8")
    root_env.write_text(f'api_key="{NEW_KEY}"\n', encoding="utf-8")
    monkeypatch.setattr(config, "ENV_FILE", backend_env)
    monkeypatch.setattr(config, "PROJECT_DIR", tmp_path)
    monkeypatch.setattr(config, "ENV_FILES", (backend_env, root_env))
    monkeypatch.delenv("GNANI_API_KEY", raising=False)


@pytest.fixture
def sent(monkeypatch):
    seen = []
    state = {"resp": Resp(200, {"success": True, "request_id": "r", "transcript": "ok", "detected_language_code": "en-IN"})}

    def fake_post(url, timeout=None, **kw):
        seen.append({"url": url, **kw})
        return state["resp"]

    monkeypatch.setattr(gnani.requests, "post", fake_post)
    return seen, state


def stt(language="auto"):
    return client.post("/api/voice/transcribe", data={"language": language},
                       files={"audio": ("speech.wav", wav(), "audio/wav")})


# ---------------- the new key ----------------
def test_new_api_key_authenticates_prisma_and_timbre(env_keys, sent):
    seen, state = sent
    assert stt().status_code == 200
    state["resp"] = Resp(200, content=b"RIFFfakeaudio")
    assert client.post("/api/voice/speak", json={"text": "Hello", "language": "en-IN"}).status_code == 200
    assert [c["headers"]["X-API-Key-ID"] for c in seen] == [NEW_KEY, NEW_KEY], "new key, not the old one"
    assert seen[0]["url"] == config.GNANI_BASE_URL + config.STT_PATH
    assert seen[1]["url"] == config.GNANI_BASE_URL + config.TTS_PATH


def test_rejected_key_is_reported_clearly_without_the_key(env_keys, sent):
    seen, state = sent
    state["resp"] = Resp(401)
    r = stt()
    assert r.json()["error"]["code"] == "GNANI_AUTH" and r.status_code == 502
    assert NEW_KEY not in r.text and OLD_KEY not in r.text
    assert "api_key" in r.json()["error"]["message"]


def test_frontend_health_never_receives_the_key(env_keys):
    body = client.get("/api/voice/health").text
    assert NEW_KEY not in body and OLD_KEY not in body


# ---------------- automatic language ----------------
@pytest.mark.parametrize("detected, expected", [
    ("en-IN", "en-IN"), ("te-IN", "te-IN"), ("hi-IN", "hi-IN"),
    ("te", "te-IN"), ("HI", "hi-IN"), ("te_IN", "te-IN"), ("TE-IN", "te-IN"),
    (None, None), ("", None), ("xx-YY", None), (7, None),
])
def test_detected_language_is_normalised_never_guessed(detected, expected):
    assert _supported_language(detected) == expected


def test_auto_request_and_detected_telugu_flow_through(env_keys, sent):
    seen, state = sent
    state["resp"] = Resp(200, {"success": True, "request_id": "r", "transcript": "ఈ భాగం ఏమిటి", "detected_language_code": "te"})
    body = stt().json()
    assert body == {"transcript": "ఈ భాగం ఏమిటి", "language": "te-IN", "detectedLanguage": "te", "requestId": "r"}
    data = seen[0]["data"]
    assert data["model"] == "prisma-v3.0" and data["language_code"] == "indic-auto", "auto-detect, never forced English"
    assert seen[0]["files"]["audio_file"][2] == "audio/wav"


def test_hindi_transcript_is_returned_in_devanagari_untranslated(env_keys, sent):
    _, state = sent
    state["resp"] = Resp(200, {"success": True, "request_id": "r", "transcript": "यह कौन सा भाग है", "detected_language_code": "hi-IN"})
    body = stt().json()
    assert body["transcript"] == "यह कौन सा भाग है" and body["language"] == "hi-IN"


# ---------------- transcript outcomes are distinct ----------------
def test_empty_transcript_is_a_valid_empty_result(env_keys, sent):
    _, state = sent
    state["resp"] = Resp(200, {"success": True, "request_id": "r", "transcript": "", "detected_language_code": None})
    r = stt()
    assert r.status_code == 200 and r.json()["transcript"] == "" and r.json()["language"] is None


def test_missing_transcript_field_is_an_error_not_silence(env_keys, sent):
    _, state = sent
    state["resp"] = Resp(200, {"success": True, "request_id": "r"})
    r = stt()
    assert r.status_code == 502 and r.json()["error"]["code"] == "GNANI_NO_TRANSCRIPT"


def test_non_object_reply_is_an_error(env_keys, sent):
    _, state = sent
    state["resp"] = Resp(200, ["unexpected"])
    assert stt().json()["error"]["code"] == "GNANI_ERROR"


# ---------------- Timbre per language ----------------
@pytest.mark.parametrize("language", ["en-IN", "te-IN", "hi-IN"])
def test_timbre_uses_the_reply_language_and_its_voice(env_keys, sent, language):
    seen, state = sent
    state["resp"] = Resp(200, content=b"RIFFfakeaudio")
    assert client.post("/api/voice/speak", json={"text": "x", "language": language}).status_code == 200
    payload = seen[-1]["json"]
    assert payload["language"] == language and payload["voice"] == config.LANGUAGES[language]["voice"]
    assert payload["model"] == config.TTS_MODEL
