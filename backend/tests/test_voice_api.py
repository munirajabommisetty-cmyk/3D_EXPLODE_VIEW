"""
Voice backend tests with SIMULATED Gnani responses (no network, no credits, no real key).
Live checks are in scripts/smoke_gnani.py.
"""
import struct

import pytest
import requests
from fastapi.testclient import TestClient

from app import config, gnani
from app.main import app, wav_duration_seconds

client = TestClient(app)
FAKE_KEY = "test-key-not-real"


def make_wav(seconds: float, rate: int = 16000) -> bytes:
    n = int(seconds * rate)
    pcm = b"\x00\x00" * n
    header = (
        b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE"
        + b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
        + b"data" + struct.pack("<I", len(pcm))
    )
    return header + pcm


class FakeResponse:
    def __init__(self, status_code=200, json_body=None, content=b""):
        self.status_code = status_code
        self._json = json_body
        self.content = content

    def json(self):
        if self._json is None:
            raise ValueError("no json")
        return self._json


@pytest.fixture
def key(monkeypatch):
    monkeypatch.setattr(config, "gnani_api_key", lambda: FAKE_KEY)


@pytest.fixture
def calls(monkeypatch):
    """Capture outgoing Gnani requests; tests set `calls.response` or `calls.exc`."""
    class Recorder:
        response = FakeResponse(200, {"success": True, "request_id": "r1", "transcript": "zoom in"})
        exc = None
        seen: list = []

    rec = Recorder()
    rec.seen = []

    def fake_post(url, timeout=None, **kwargs):
        rec.seen.append({"url": url, "timeout": timeout, **kwargs})
        if rec.exc:
            raise rec.exc
        return rec.response

    monkeypatch.setattr(gnani.requests, "post", fake_post)
    return rec


def post_audio(data: bytes, language="en-IN", content_type="audio/wav"):
    return client.post("/api/voice/transcribe", data={"language": language},
                       files={"audio": ("speech.wav", data, content_type)})


# ---------------- health ----------------
def test_health_reports_key_presence_without_value(key):
    body = client.get("/api/voice/health").json()
    assert body["keyConfigured"] is True
    assert FAKE_KEY not in str(body)
    assert len(body["languages"]) == 10
    supported = {l["code"] for l in body["languages"] if l["status"] == "supported"}
    assert supported == {"en-IN", "te-IN", "hi-IN"}


def test_health_when_key_missing(monkeypatch):
    monkeypatch.setattr(config, "gnani_api_key", lambda: None)
    assert client.get("/api/voice/health").json()["keyConfigured"] is False


# ---------------- transcribe: validation ----------------
def test_transcribe_success_and_request_shape(key, calls):
    resp = post_audio(make_wav(1.5), "te-IN")
    assert resp.status_code == 200
    assert resp.json()["transcript"] == "zoom in"
    sent = calls.seen[0]
    assert sent["url"].endswith("/stt/v3")
    assert sent["headers"]["X-API-Key-ID"] == FAKE_KEY
    assert sent["data"]["language_code"] == "te-IN"
    assert sent["timeout"] == config.REQUEST_TIMEOUT_S


@pytest.mark.parametrize("language", ["fr-FR", "", "te", "ur-IN"])
def test_rejects_unsupported_language(key, calls, language):
    resp = post_audio(make_wav(1), language)
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "UNSUPPORTED_LANGUAGE"
    assert calls.seen == []


def test_rejects_non_wav_content_type(key, calls):
    resp = post_audio(make_wav(1), content_type="audio/webm")
    assert resp.status_code == 415
    assert calls.seen == []


def test_rejects_bytes_that_are_not_wav(key, calls):
    resp = post_audio(b"not really audio" * 10)
    assert resp.status_code == 415
    assert resp.json()["error"]["code"] == "UNSUPPORTED_AUDIO"


def test_rejects_oversized_upload(key, calls):
    resp = post_audio(b"RIFF" + b"\x00" * (config.MAX_AUDIO_BYTES + 10))
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "AUDIO_TOO_LARGE"
    assert calls.seen == []


def test_rejects_too_long_and_too_short(key, calls):
    assert post_audio(make_wav(31, rate=8000)).json()["error"]["code"] == "AUDIO_TOO_LONG"
    assert post_audio(make_wav(0.05)).json()["error"]["code"] == "AUDIO_TOO_SHORT"
    assert calls.seen == []


def test_wav_duration_parsing():
    assert abs(wav_duration_seconds(make_wav(2.0)) - 2.0) < 1e-6
    assert wav_duration_seconds(b"garbage") is None


# ---------------- transcribe: Gnani errors ----------------
@pytest.mark.parametrize("status, code, ours", [
    (403, "GNANI_FORBIDDEN", 502),
    (429, "GNANI_RATE_LIMIT", 429),
    (503, "GNANI_UNAVAILABLE", 503),
    (500, "GNANI_ERROR", 502),
    (400, "GNANI_BAD_REQUEST", 400),
])
def test_maps_gnani_errors_without_leaking_key(key, calls, status, code, ours):
    calls.response = FakeResponse(status, {"success": False, "error": {"type": "X", "message": "m"}})
    resp = post_audio(make_wav(1))
    assert resp.status_code == ours
    assert resp.json()["error"]["code"] == code
    assert FAKE_KEY not in resp.text


def test_timeout_and_network_failure(key, calls):
    calls.exc = requests.Timeout()
    assert post_audio(make_wav(1)).json()["error"]["code"] == "GNANI_TIMEOUT"
    calls.exc = requests.ConnectionError()
    assert post_audio(make_wav(1)).json()["error"]["code"] == "GNANI_UNREACHABLE"


def test_missing_key_is_reported_clearly(monkeypatch, calls):
    monkeypatch.setattr(config, "gnani_api_key", lambda: None)
    resp = post_audio(make_wav(1))
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "KEY_MISSING"
    assert calls.seen == []


def test_unreadable_gnani_body(key, calls):
    calls.response = FakeResponse(200, None)
    assert post_audio(make_wav(1)).json()["error"]["code"] == "GNANI_ERROR"


# ---------------- speak ----------------
def test_speak_returns_wav_and_uses_language_voice(key, calls):
    calls.response = FakeResponse(200, content=b"RIFFfake")
    resp = client.post("/api/voice/speak", json={"text": "సరే", "language": "te-IN"})
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "audio/wav"
    body = calls.seen[0]["json"]
    assert body["voice"] == config.LANGUAGES["te-IN"]["voice"]
    assert body["model"] == config.TTS_MODEL
    assert 0.85 <= body["speed"] <= 1.15  # documented Timbre range


def test_speak_validation(key, calls):
    assert client.post("/api/voice/speak", json={"text": "  ", "language": "en-IN"}).status_code == 400
    assert client.post("/api/voice/speak", json={"text": "hi", "language": "xx"}).status_code == 400
    too_long = client.post("/api/voice/speak", json={"text": "a" * (config.MAX_TTS_CHARS + 1), "language": "en-IN"})
    assert too_long.status_code == 413
    assert calls.seen == []


def test_speak_errors(key, calls):
    calls.response = FakeResponse(429)
    assert client.post("/api/voice/speak", json={"text": "ok", "language": "en-IN"}).json()["error"]["code"] == "GNANI_RATE_LIMIT"
    calls.response = FakeResponse(200, content=b"")
    assert client.post("/api/voice/speak", json={"text": "ok", "language": "en-IN"}).json()["error"]["code"] == "GNANI_ERROR"


def test_speak_bengali_uses_kirra_timbre_v25(key, calls):
    # Stage 3: the existing verified Bengali configuration is reused (mocked; no Gnani call)
    calls.response = FakeResponse(200, content=b"RIFFfake")
    resp = client.post("/api/voice/speak", json={"text": "জুম ইন করছি।", "language": "bn-IN"})
    assert resp.status_code == 200
    sent = calls.seen[0]["json"]
    assert (sent["voice"], sent["model"]) == ("Kirra", "timbre-v2.5")
    assert sent["text"] == "জুম ইন করছি।"


def test_gnani_timing_log_has_no_text_or_key(key, calls, caplog):
    # Milestone B: timing lines carry the service, duration and status only
    calls.response = FakeResponse(200, content=b"RIFFfake")
    with caplog.at_level("INFO", logger="app.timing"):
        client.post("/api/voice/speak", json={"text": "సరే జూమ్ ఇన్", "language": "te-IN"})
    lines = [r.getMessage() for r in caplog.records if r.name == "app.timing"]
    assert lines and lines[0].startswith("gnani tts ") and "status=200" in lines[0]
    assert all(FAKE_KEY not in l and "సరే" not in l for l in lines)
