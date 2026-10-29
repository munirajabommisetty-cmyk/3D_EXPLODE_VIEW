"""
Gnani Prisma (speech-to-text) and Timbre (text-to-speech) client.

Verified against docs.gnani.ai on 26 Oct 2026:
  STT  POST {base}/stt/v3  multipart: audio_file, language_code [, format, bias_list, bias_score]
       -> {"success": true, "request_id": ..., "transcript": ...}
  TTS  POST {base}/api/v1/tts/inference  JSON: text, model, voice, language, speed, audio_config
       -> raw audio (audio/wav)
  Errors: {"success": false, "error": {"type", "message"}} with 400/403/429/500/503.
Errors are mapped to stable codes; the API key never appears in any message.
"""
import logging
import time

import requests

from app import config

_timing = logging.getLogger("app.timing")


class GnaniError(Exception):
    """A user-presentable failure. `code` is stable for the frontend; `status` is our HTTP status."""

    def __init__(self, code: str, message: str, status: int):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


_STATUS_MAP = {
    400: ("GNANI_BAD_REQUEST", "Gnani rejected the request (unsupported audio or parameters).", 400),
    401: ("GNANI_AUTH", "Gnani rejected the API key. Check GNANI_API_KEY in backend/.env.", 502),
    403: ("GNANI_FORBIDDEN", "Gnani refused access: check the API key, organisation status or remaining credits.", 502),
    429: ("GNANI_RATE_LIMIT", "Gnani rate limit reached. Please wait a moment and try again.", 429),
    500: ("GNANI_ERROR", "Gnani had an internal error. Please try again.", 502),
    503: ("GNANI_UNAVAILABLE", "Gnani speech service is temporarily unavailable.", 503),
}


def _key() -> str:
    key = config.gnani_api_key()
    if not key:
        raise GnaniError("KEY_MISSING", "Gnani API key is not configured on the server (GNANI_API_KEY).", 503)
    return key


_OPERATION = {"stt": "speech recognition", "tts": "speech synthesis"}


def _raise_for(resp: requests.Response, kind: str) -> None:
    op = _OPERATION.get(kind, "speech service")
    if resp.status_code in (502, 504):
        # Gnani's own gateway timed out or failed (seen live as "unexpected status (504)"). Not our
        # timeout: ours raises GNANI_TIMEOUT. Retrying the same request at once rarely helps.
        _timing.warning("gnani %s gateway status=%s (upstream)", kind, resp.status_code)
        raise GnaniError("GNANI_GATEWAY_TIMEOUT", f"Gnani {op} timed out on Gnani's side ({resp.status_code}). Please try again.", 504)
    code, message, status = _STATUS_MAP.get(
        resp.status_code, ("GNANI_ERROR", f"Gnani {op} returned an unexpected status ({resp.status_code}).", 502)
    )
    raise GnaniError(code, message, status)


def _post(url: str, **kwargs) -> requests.Response:
    started = time.perf_counter()
    status = "error"
    try:
        resp = requests.post(url, timeout=config.REQUEST_TIMEOUT_S, **kwargs)
        status = str(resp.status_code)
        return resp
    except requests.Timeout as exc:
        status = "timeout"
        kind = "stt" if url.endswith(config.STT_PATH) else "tts"
        raise GnaniError("GNANI_TIMEOUT", f"Gnani {_OPERATION[kind]} took too long to respond.", 504) from exc
    except requests.RequestException as exc:
        raise GnaniError("GNANI_UNREACHABLE", "Could not reach the Gnani service.", 502) from exc
    finally:
        # Milestone B: which service, how long, status. Never audio, text, language data or the key.
        kind = "stt" if url.endswith(config.STT_PATH) else "tts"
        _timing.info("gnani %s %.0f ms status=%s", kind, (time.perf_counter() - started) * 1000, status)


def transcribe(audio: bytes, filename: str, language: str) -> dict:
    resp = _post(
        config.GNANI_BASE_URL + config.STT_PATH,
        headers={"X-API-Key-ID": _key()},
        files={"audio_file": (filename, audio, "audio/wav")},
        data={
            "language_code": language,
            "format": "transcribe",  # inverse text normalisation: numbers as digits
            "bias_list": ",".join(config.STT_BIAS_WORDS),
            "bias_score": "1.0",
        },
    )
    if resp.status_code != 200:
        _raise_for(resp, "stt")
    try:
        body = resp.json()
    except ValueError as exc:
        raise GnaniError("GNANI_ERROR", "Gnani returned an unreadable response.", 502) from exc
    if not body.get("success", True):
        raise GnaniError("GNANI_ERROR", "Gnani could not transcribe the audio.", 502)
    return {"transcript": (body.get("transcript") or "").strip(), "request_id": body.get("request_id")}


def synthesize(text: str, language: str) -> bytes:
    resp = _post(
        config.GNANI_BASE_URL + config.TTS_PATH,
        headers={"X-API-Key-ID": _key(), "Content-Type": "application/json"},
        json={
            "text": text,
            "model": config.TTS_MODEL,
            "voice": config.LANGUAGES[language]["voice"],
            "language": language,
            "speed": 1.0,
            "audio_config": {
                "sample_rate": 22050, "num_channels": 1, "sample_width": 2,
                "encoding": "linear_pcm", "container": "wav",
            },
        },
    )
    if resp.status_code != 200:
        _raise_for(resp, "tts")
    if not resp.content:
        raise GnaniError("GNANI_ERROR", "Gnani returned empty audio.", 502)
    return resp.content
