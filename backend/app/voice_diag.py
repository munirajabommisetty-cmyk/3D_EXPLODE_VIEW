"""
Voice diagnostics (metadata only). Enabled only when the environment variable VOICE_DIAG=1 is set
for the backend process; otherwise nothing is computed or written.

One JSON line per recording is appended to a temporary file outside the project
(<system temp>/gesturelab_voice_diag.jsonl). It holds numbers and short codes only: never audio,
never transcript text, never keys or headers. Every function here swallows its own errors, so
diagnostics can never change or break transcription.
"""
from __future__ import annotations

import array
import json
import math
import os
import struct
import tempfile
import time
from pathlib import Path

DIAG_ENV = "VOICE_DIAG"
LOG_PATH = Path(tempfile.gettempdir()) / "gesturelab_voice_diag.jsonl"
WINDOW_MS = 50

# Fields the browser may send (numbers / short codes only); anything else is dropped.
CLIENT_FIELDS = {
    "inputSampleRate", "channelCount", "durationMs", "frames", "endReason", "vadOnsetMs", "vadVoicedMs",
    "vadFirstVoicedMs", "vadLastVoicedMs", "avgRms", "peak", "zeroFraction",
    "trackEnabled", "trackMutedAtStart", "trackMutedAtEnd", "trackReadyState", "audioContextState", "deviceHash",
}
# Short codes allowed as text (letters / hex digits only): never names, ids or words.
CODE_FIELDS = {"endReason", "trackReadyState", "audioContextState", "deviceHash"}


def enabled() -> bool:
    return os.environ.get(DIAG_ENV, "").strip() == "1"


def parse_client(raw: str | None) -> dict:
    """The browser's recording metadata, whitelisted (numbers, null, or a short code)."""
    try:
        data = json.loads(raw or "{}")
    except (ValueError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}
    out = {}
    for key in CLIENT_FIELDS:
        value = data.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)) and math.isfinite(value):
            out[key] = round(float(value), 4)
        elif value is None and key in data:
            out[key] = None
        elif isinstance(value, str) and key in CODE_FIELDS and value.isalnum() and value.isascii() and len(value) <= 12:
            out[key] = value
    return out


def wav_stats(data: bytes) -> dict:
    """Header facts and a loudness profile of the uploaded WAV (16-bit PCM). Loudness only: this
    shows where sound was, not whether it was speech (Prisma's transcript is the evidence for that)."""
    try:
        out: dict = {"bytes": len(data), "valid_wav": data[0:4] == b"RIFF" and data[8:12] == b"WAVE"}
        if not out["valid_wav"]:
            return out
        pos, fmt, payload = 12, None, None
        while pos + 8 <= len(data):
            cid, size = data[pos:pos + 4], struct.unpack("<I", data[pos + 4:pos + 8])[0]
            if cid == b"fmt " and pos + 24 <= len(data):
                audio_format, channels, rate = struct.unpack("<HHI", data[pos + 8:pos + 16])
                bits = struct.unpack("<H", data[pos + 22:pos + 24])[0]
                fmt = {"format": audio_format, "channels": channels, "sample_rate": rate, "bits": bits}
            if cid == b"data":
                payload = data[pos + 8:pos + 8 + min(size, len(data) - pos - 8)]
                break
            pos += 8 + size + (size % 2)
        if not fmt or payload is None:
            out["valid_wav"] = False
            return out
        out.update(fmt)
        if fmt["bits"] != 16 or fmt["format"] != 1:
            return out
        samples = array.array("h")
        samples.frombytes(payload[: len(payload) - (len(payload) % 2)])
        ch = max(1, fmt["channels"])
        rate = fmt["sample_rate"] or 16000
        n = len(samples) // ch
        out["duration_ms"] = round(n * 1000 / rate)
        if n == 0:
            return out
        win = max(1, int(rate * WINDOW_MS / 1000)) * ch
        levels = []
        total = 0.0
        peak = 0
        for i in range(0, len(samples), win):
            chunk = samples[i:i + win]
            sq = sum(s * s for s in chunk)
            total += sq
            peak = max(peak, max(chunk), -min(chunk))
            levels.append(math.sqrt(sq / len(chunk)) / 32768)
        out["avg_rms"] = round(math.sqrt(total / len(samples)) / 32768, 4)
        out["peak"] = round(peak / 32768, 4)
        floor = sorted(levels)[max(0, len(levels) // 10 - 1)] if levels else 0.0
        threshold = max(floor * 3, 0.015)
        active = [i for i, lv in enumerate(levels) if lv > threshold]
        out["noise_floor_rms"] = round(floor, 4)
        out["loud_threshold_rms"] = round(threshold, 4)
        out["loud_pct"] = round(100 * len(active) / len(levels), 1)
        out["first_loud_ms"] = active[0] * WINDOW_MS if active else None
        out["last_loud_ms"] = (active[-1] + 1) * WINDOW_MS if active else None
        return out
    except Exception as exc:  # diagnostics must never break transcription
        return {"bytes": len(data), "analysis_error": type(exc).__name__}


def write(record: dict) -> None:
    try:
        record = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), **record}
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass
