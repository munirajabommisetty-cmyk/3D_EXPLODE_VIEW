"""
Metadata-only voice diagnostics. Gnani is SIMULATED (requests.post patched): no network.
Proves: the analysis is right, nothing but numbers is logged, and transcription is unchanged.
"""
import json
import math
import struct

import pytest
from fastapi.testclient import TestClient

from app import config, gnani, main, voice_diag

client = TestClient(main.app)
TRANSCRIPT = "a private sentence the learner said"


def wav(segments, rate=16000):
    """segments: [(seconds, amplitude 0..1)] of a 440 Hz tone (0 = silence)."""
    samples = []
    for seconds, amp in segments:
        n = int(seconds * rate)
        samples += [int(amp * 32767 * math.sin(2 * math.pi * 440 * i / rate)) for i in range(n)]
    data = struct.pack(f"<{len(samples)}h", *samples)
    return (b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
            + b"data" + struct.pack("<I", len(data)) + data)


def test_wav_stats_finds_where_the_sound_is():
    s = voice_diag.wav_stats(wav([(0.5, 0.0005), (1.0, 0.3), (0.5, 0.0005)]))
    assert s["valid_wav"] and s["sample_rate"] == 16000 and s["channels"] == 1 and s["bits"] == 16
    assert s["duration_ms"] == 2000
    assert 450 <= s["first_loud_ms"] <= 550 and 1450 <= s["last_loud_ms"] <= 1550
    assert 45 <= s["loud_pct"] <= 55
    assert s["peak"] > 0.29 and s["avg_rms"] > 0.1


def test_wav_stats_on_silence_and_garbage():
    quiet = voice_diag.wav_stats(wav([(1.0, 0.0005)]))
    assert quiet["first_loud_ms"] is None and quiet["loud_pct"] == 0
    assert voice_diag.wav_stats(b"not a wav at all") == {"bytes": 16, "valid_wav": False}


def test_client_metadata_is_whitelisted_numbers_only():
    raw = json.dumps({"durationMs": 2300, "endReason": "silence", "vadOnsetMs": None, "avgRms": 0.02,
                      "transcript": "secret words", "endReason2": "x", "peak": "loud", "frames": True})
    out = voice_diag.parse_client(raw)
    assert out == {"durationMs": 2300.0, "endReason": "silence", "vadOnsetMs": None, "avgRms": 0.02}
    assert voice_diag.parse_client("{not json") == {} and voice_diag.parse_client(None) == {}


class FakeResponse:
    status_code = 200

    def json(self):
        return {"success": True, "request_id": "r1", "transcript": TRANSCRIPT, "model": "prisma-v3.0",
                "detected_language_code": "en-IN", "processing_time": 0.61}


@pytest.fixture
def prisma(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "gnani_api_key", lambda: "gnani-secret")
    monkeypatch.setattr(gnani.requests, "post", lambda url, **kw: FakeResponse())
    monkeypatch.setattr(voice_diag, "LOG_PATH", tmp_path / "diag.jsonl")
    return tmp_path / "diag.jsonl"


def post(diag=None):
    data = {"language": "auto"}
    if diag is not None:
        data["diag"] = diag
    return client.post("/api/voice/transcribe", data=data, files={"audio": ("speech.wav", wav([(0.3, 0.0), (0.8, 0.3), (0.4, 0.0)]), "audio/wav")})


def test_diagnostics_off_by_default_and_response_unchanged(prisma, monkeypatch):
    monkeypatch.delenv("VOICE_DIAG", raising=False)
    off = post(diag=json.dumps({"durationMs": 1500})).json()
    assert not prisma.exists(), "nothing is written unless VOICE_DIAG=1"
    monkeypatch.setenv("VOICE_DIAG", "1")
    on = post(diag=json.dumps({"durationMs": 1500})).json()
    for r in (off, on):
        r.pop("requestId", None)
    assert on == off == {"transcript": TRANSCRIPT, "language": "en-IN", "detectedLanguage": "en-IN"}


def test_diagnostic_line_holds_metadata_only(prisma, monkeypatch):
    monkeypatch.setenv("VOICE_DIAG", "1")
    post(diag=json.dumps({"durationMs": 1500, "endReason": "silence", "vadOnsetMs": 540}))
    line = prisma.read_text(encoding="utf-8")
    record = json.loads(line)
    assert record["prisma"]["transcript_chars"] == len(TRANSCRIPT)
    assert record["prisma"]["detected_language"] == "en-IN" and record["prisma"]["processing_time_s"] == 0.61
    assert record["client"]["vadOnsetMs"] == 540 and record["upload"]["duration_ms"] == 1500
    assert TRANSCRIPT not in line and "secret" not in line, "never the words, never the key"


def test_prisma_errors_are_logged_and_still_returned(prisma, monkeypatch):
    monkeypatch.setenv("VOICE_DIAG", "1")

    class Busy:
        status_code = 429

    monkeypatch.setattr(gnani.requests, "post", lambda url, **kw: Busy())
    r = post()
    assert r.status_code == 429 and r.json()["error"]["code"] == "GNANI_RATE_LIMIT"
    assert json.loads(prisma.read_text(encoding="utf-8"))["prisma"] == {
        "ok": False, "code": "GNANI_RATE_LIMIT", "status": 429, "language_requested": "auto",
        "latency_ms": json.loads(prisma.read_text(encoding="utf-8"))["prisma"]["latency_ms"]}


def test_capture_codes_are_whitelisted_short_codes_only():
    raw = json.dumps({"trackReadyState": "live", "audioContextState": "running", "deviceHash": "1a2b3c4d",
                      "zeroFraction": 1, "trackMutedAtStart": 0,
                      "deviceLabel": "Microphone Array (Realtek)", "trackReadyState2": "x",
                      "audioContextState_bad": "running", "endReason": "has space"})
    out = voice_diag.parse_client(raw)
    assert out == {"trackReadyState": "live", "audioContextState": "running", "deviceHash": "1a2b3c4d",
                   "zeroFraction": 1.0, "trackMutedAtStart": 0.0}
    assert voice_diag.parse_client(json.dumps({"deviceHash": "a" * 40})) == {}, "long strings (ids) are dropped"


def test_unsent_recording_is_logged_without_calling_gnani(monkeypatch, tmp_path):
    log = tmp_path / "diag.jsonl"
    monkeypatch.setattr(voice_diag, "LOG_PATH", log)

    def no_network(*a, **k):
        raise AssertionError("must not call Gnani")

    monkeypatch.setattr(gnani.requests, "post", no_network)
    monkeypatch.delenv("VOICE_DIAG", raising=False)
    assert client.post("/api/voice/diag", data={"diag": json.dumps({"endReason": "micSilent"})}).status_code == 204
    assert not log.exists()
    monkeypatch.setenv("VOICE_DIAG", "1")
    r = client.post("/api/voice/diag", data={"diag": json.dumps({"endReason": "micSilent", "peak": 0, "zeroFraction": 1})})
    assert r.status_code == 204
    rec = json.loads(log.read_text(encoding="utf-8"))
    assert rec["client"] == {"endReason": "micSilent", "peak": 0.0, "zeroFraction": 1.0} and rec["prisma"] is None
