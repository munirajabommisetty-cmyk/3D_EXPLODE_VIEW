"""

Voice backend for the 3D learning platform (Phase 11, Task V2).



Keeps the Gnani key on the server and exposes three endpoints to the browser:

  GET  /api/voice/health      -> whether a key is configured (never the key) + languages

  POST /api/voice/transcribe  -> Prisma speech-to-text for a short WAV recording

  POST /api/voice/speak       -> Timbre text-to-speech, returns audio/wav

  POST /api/teach             -> grounded teaching plan from the configured LLM (Task V4)

  POST /api/teach/stream      -> the same plan streamed as NDJSON events, one validated step at a

                                 time while the LLM is still writing (voice latency milestone)

  POST /api/interpret         -> intent for an utterance the browser could not parse (voice-first)



Run (from the backend folder):  python -m uvicorn app.main:app --port 8000

The Vite dev server proxies /api to this backend, so the browser never calls Gnani directly.

"""

import json

import logging
import os

import re

import struct



from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from fastapi.exceptions import RequestValidationError

from fastapi.responses import JSONResponse, Response, StreamingResponse

from pydantic import BaseModel



from app import config, gnani, interpret, llm, teaching, tutor, voice_diag

import time



# Milestone B: upstream timings (service, duration, status; no content) printed next to uvicorn's log

_timing_log = logging.getLogger("app.timing")

if not _timing_log.handlers:

    _handler = logging.StreamHandler()

    _handler.setFormatter(logging.Formatter("%(levelname)s:     [timing] %(message)s"))

    _timing_log.addHandler(_handler)

    _timing_log.setLevel(logging.INFO)



app = FastAPI(
    title="3D Learning Platform — Voice Backend",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# Comma-separated origins configured in Render's environment variables.
# Keep localhost for local Vite development; add the deployed Vercel URL in Render.
_configured_origins = os.getenv("FRONTEND_ORIGINS", "")
_allowed_origins = [
    origin.strip().rstrip("/")
    for origin in _configured_origins.split(",")
    if origin.strip()
]
_allowed_origins.extend([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
])
# Remove duplicates while preserving order.
_allowed_origins = list(dict.fromkeys(_allowed_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

@app.get("/", tags=["health"])
def root():
    """Simple deployment health check."""
    return {
        "ok": True,
        "service": "3D Learning Platform — Voice Backend",
        "health": "/api/voice/health",
        "docs": "/docs",
    }




MAX_AUDIO_SECONDS = 30





def error(code: str, message: str, status: int) -> JSONResponse:

    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)





@app.exception_handler(RequestValidationError)

async def invalid_request(_: Request, exc: RequestValidationError) -> JSONResponse:

    # Same error shape as every other endpoint; only field locations, never submitted values

    where = ", ".join(".".join(str(p) for p in e.get("loc", [])[1:]) for e in exc.errors()[:3])

    return error("INVALID_REQUEST", f"Invalid request fields: {where or 'body'}.", 422)





def wav_duration_seconds(data: bytes) -> float | None:

    """Duration of a PCM WAV from its header, or None if the bytes are not a WAV file."""

    if len(data) < 44 or data[0:4] != b"RIFF" or data[8:12] != b"WAVE":

        return None

    pos, byte_rate = 12, None

    while pos + 8 <= len(data):

        chunk_id, size = data[pos:pos + 4], struct.unpack("<I", data[pos + 4:pos + 8])[0]

        if chunk_id == b"fmt " and pos + 20 <= len(data):

            byte_rate = struct.unpack("<I", data[pos + 16:pos + 20])[0]

        if chunk_id == b"data":

            if not byte_rate:

                return None

            payload = min(size, len(data) - pos - 8)  # streaming headers may claim 0xFFFFFFFF

            return payload / byte_rate

        pos += 8 + size + (size % 2)

    return None





def _supported_language(code) -> str | None:

    """Prisma's detected language as one of ours ("te-IN"), accepting "te", "TE-IN" or "te_IN";

    None when it is missing or not a supported language (never guessed)."""

    if not isinstance(code, str) or not code.strip():

        return None

    c = code.strip().replace("_", "-").lower()

    for key in config.LANGUAGES:

        if c in (key.lower(), key.split("-")[0].lower()):

            return key

    return None





@app.get("/api/voice/health")

def health():

    return {

        "ok": True,

        "keyConfigured": bool(config.gnani_api_key()),

        "keySource": config.gnani_key_source()[1],  # which variable / file, never the value

        "sttModel": "Gnani Prisma (stt/v3)",

        "ttsModel": f"Gnani Timbre ({config.TTS_MODEL})",

        "languages": [

            {"code": code, "name": info["name"], "native": info["native"], "status": info["status"]}

            for code, info in config.LANGUAGES.items()

        ],

        "limits": {"maxAudioBytes": config.MAX_AUDIO_BYTES, "maxAudioSeconds": MAX_AUDIO_SECONDS,

                   "maxTtsChars": config.MAX_TTS_CHARS},

        # Task V4: whether the teaching LLM is configured (booleans + model id, never the key)

        "teaching": {

            "configured": all(config.llm_configured().values()),

            "settings": config.llm_configured(),

            "model": llm.model_name(),

            # provider, model, endpoint host, thinking option (non-secret; never the key or full URL)

            "provider": llm.provider_info(),

            "languages": list(teaching.LANGUAGE_NAMES),

        },

    }





_KEYTERM = re.compile(r"[^\w\s&()'-]", re.UNICODE)





def _clean_keyterms(raw: str | None) -> list[str]:

    """Part names of the loaded model, sent by the browser to help Prisma (no free text)."""

    terms = []

    for t in (raw or "").split(","):

        t = _KEYTERM.sub("", t).strip()[:40]

        if t and t not in terms:

            terms.append(t)

    return terms[: config.MAX_KEYTERMS]





@app.post("/api/voice/transcribe")

async def transcribe(audio: UploadFile = File(...), language: str = Form(...), keyterms: str | None = Form(None),

                     diag: str | None = Form(None)):

    """language "auto" = Prisma v3.0 language detection (one request); the reply's "language" is

    the detected language (None if Prisma could not judge it)."""

    auto = language == config.AUTO_LANGUAGE

    if not auto and language not in config.LANGUAGES:

        return error("UNSUPPORTED_LANGUAGE", f"Language '{language}' is not supported.", 400)

    if (audio.content_type or "").lower() not in config.ALLOWED_AUDIO_TYPES:

        return error("UNSUPPORTED_AUDIO", "Audio must be a WAV recording.", 415)

    data = await audio.read(config.MAX_AUDIO_BYTES + 1)

    if len(data) > config.MAX_AUDIO_BYTES:

        return error("AUDIO_TOO_LARGE", "Recording is too large.", 413)

    duration = wav_duration_seconds(data)

    if duration is None:

        return error("UNSUPPORTED_AUDIO", "Audio is not a valid WAV file.", 415)

    if duration < 0.2:

        return error("AUDIO_TOO_SHORT", "Recording is too short.", 400)

    if duration > MAX_AUDIO_SECONDS:

        return error("AUDIO_TOO_LONG", f"Recording is longer than {MAX_AUDIO_SECONDS} seconds.", 413)

    started = time.perf_counter()

    try:

        result = gnani.transcribe(data, "speech.wav", language, _clean_keyterms(keyterms) if auto else None)

    except gnani.GnaniError as exc:

        if voice_diag.enabled():

            voice_diag.write({"client": voice_diag.parse_client(diag), "upload": voice_diag.wav_stats(data),

                              "prisma": {"ok": False, "code": exc.code, "status": exc.status, "language_requested": language,

                                         "latency_ms": round((time.perf_counter() - started) * 1000)}})

        return error(exc.code, exc.message, exc.status)

    if voice_diag.enabled():

        # Metadata only: transcript LENGTH, never its text

        voice_diag.write({"client": voice_diag.parse_client(diag), "upload": voice_diag.wav_stats(data),

                          "prisma": {"ok": True, "status": 200, "language_requested": language,

                                     "latency_ms": round((time.perf_counter() - started) * 1000),

                                     "processing_time_s": result.get("processing_time"),

                                     "transcript_chars": len(result["transcript"]),

                                     "detected_language": result.get("detected_language")}})

    if auto:

        detected = result.get("detected_language")

        return {"transcript": result["transcript"],

                "language": _supported_language(detected),

                "detectedLanguage": detected, "requestId": result["request_id"]}

    return {"transcript": result["transcript"], "language": language, "requestId": result["request_id"]}





@app.post("/api/voice/diag", status_code=204)

async def recording_diag(diag: str | None = Form(None)):

    """Metadata of a recording that was NOT sent to Prisma (muted / stalled microphone, nothing

    said). Written only when VOICE_DIAG=1; never calls Gnani; whitelisted numbers and codes only."""

    if voice_diag.enabled():

        voice_diag.write({"client": voice_diag.parse_client(diag), "upload": None, "prisma": None})

    return Response(status_code=204)





class SpeakRequest(BaseModel):

    text: str

    language: str





@app.post("/api/voice/speak")

def speak(req: SpeakRequest):

    if req.language not in config.LANGUAGES:

        return error("UNSUPPORTED_LANGUAGE", f"Language '{req.language}' is not supported.", 400)

    text = req.text.strip()

    if not text:

        return error("EMPTY_TEXT", "Nothing to speak.", 400)

    if len(text) > config.MAX_TTS_CHARS:

        return error("TEXT_TOO_LONG", f"Text is longer than {config.MAX_TTS_CHARS} characters.", 413)

    try:

        audio = gnani.synthesize(text, req.language)

    except gnani.GnaniError as exc:

        return error(exc.code, exc.message, exc.status)

    return Response(content=audio, media_type="audio/wav")





@app.post("/api/teach")

def teach(req: teaching.TeachRequest):

    """Question + fact pack -> validated teaching plan. Plans are data; the browser runs them."""

    if req.language not in config.LANGUAGES:

        return error("UNSUPPORTED_LANGUAGE", f"Language '{req.language}' is not supported.", 400)

    try:

        plan = teaching.generate_plan(req)

    except llm.LLMError as exc:

        return error(exc.code, exc.message, exc.status)

    except teaching.TeachError as exc:

        return error(exc.code, exc.message, exc.status)

    return {"plan": plan}





def _request_id(request: Request) -> str:

    """Browser turn id for correlating timings (letters, digits, '-' only; never user content)."""

    return re.sub(r"[^A-Za-z0-9-]", "", request.headers.get("x-request-id", ""))[:40]





@app.post("/api/teach/stream")

def teach_stream(req: teaching.TeachRequest, request: Request):

    """NDJSON events: step* then done, or error. Validation errors before streaming are normal JSON errors."""

    if req.language not in config.LANGUAGES:

        return error("UNSUPPORTED_LANGUAGE", f"Language '{req.language}' is not supported.", 400)

    try:

        teaching.check_target(req)

    except teaching.TeachError as exc:

        return error(exc.code, exc.message, exc.status)

    rid = _request_id(request)



    def events():

        try:

            for event in teaching.stream_plan(req, request_id=rid):

                yield json.dumps(event, ensure_ascii=False) + "\n"

        except (llm.LLMError, teaching.TeachError) as exc:

            _timing_log.info("teach stream error code=%s request=%s", exc.code, rid or "-")

            yield json.dumps({"type": "error", "code": exc.code, "message": exc.message}, ensure_ascii=False) + "\n"



    return StreamingResponse(events(), media_type="application/x-ndjson",

                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})





@app.post("/api/tutor/evaluate")

def tutor_evaluate(req: tutor.EvaluateRequest):

    """Checks one spoken quiz answer (understanding check after an explanation)."""

    if req.language not in config.LANGUAGES:

        return error("UNSUPPORTED_LANGUAGE", f"Language '{req.language}' is not supported.", 400)

    try:

        return tutor.evaluate(req)

    except llm.LLMError as exc:

        return error(exc.code, exc.message, exc.status)

    except tutor.EvaluateError as exc:

        return error(exc.code, exc.message, exc.status)





@app.post("/api/interpret")

def interpret_utterance(req: interpret.InterpretRequest):

    """Fallback intent classification (fixed intent list; the browser executes via its parser)."""

    if req.language not in config.LANGUAGES:

        return error("UNSUPPORTED_LANGUAGE", f"Language '{req.language}' is not supported.", 400)

    try:

        return interpret.interpret(req)

    except llm.LLMError as exc:

        return error(exc.code, exc.message, exc.status)

    except interpret.InterpretError as exc:

        return error(exc.code, exc.message, exc.status)
















# """
# Voice backend for the 3D learning platform (Phase 11, Task V2).

# Keeps the Gnani key on the server and exposes three endpoints to the browser:
#   GET  /api/voice/health      -> whether a key is configured (never the key) + languages
#   POST /api/voice/transcribe  -> Prisma speech-to-text for a short WAV recording
#   POST /api/voice/speak       -> Timbre text-to-speech, returns audio/wav
#   POST /api/teach             -> grounded teaching plan from the configured LLM (Task V4)
#   POST /api/teach/stream      -> the same plan streamed as NDJSON events, one validated step at a
#                                  time while the LLM is still writing (voice latency milestone)
#   POST /api/interpret         -> intent for an utterance the browser could not parse (voice-first)

# Run (from the backend folder):  python -m uvicorn app.main:app --port 8000
# The Vite dev server proxies /api to this backend, so the browser never calls Gnani directly.
# """
# import json
# import logging
# import re
# import struct

# from fastapi import FastAPI, File, Form, Request, UploadFile
# from fastapi.exceptions import RequestValidationError
# from fastapi.responses import JSONResponse, Response, StreamingResponse
# from pydantic import BaseModel

# from app import config, gnani, interpret, llm, teaching, tutor, voice_diag
# import time

# # Milestone B: upstream timings (service, duration, status; no content) printed next to uvicorn's log
# _timing_log = logging.getLogger("app.timing")
# if not _timing_log.handlers:
#     _handler = logging.StreamHandler()
#     _handler.setFormatter(logging.Formatter("%(levelname)s:     [timing] %(message)s"))
#     _timing_log.addHandler(_handler)
#     _timing_log.setLevel(logging.INFO)

# app = FastAPI(title="3D Learning Platform — Voice Backend", docs_url=None, redoc_url=None)

# MAX_AUDIO_SECONDS = 30


# def error(code: str, message: str, status: int) -> JSONResponse:
#     return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


# @app.exception_handler(RequestValidationError)
# async def invalid_request(_: Request, exc: RequestValidationError) -> JSONResponse:
#     # Same error shape as every other endpoint; only field locations, never submitted values
#     where = ", ".join(".".join(str(p) for p in e.get("loc", [])[1:]) for e in exc.errors()[:3])
#     return error("INVALID_REQUEST", f"Invalid request fields: {where or 'body'}.", 422)


# def wav_duration_seconds(data: bytes) -> float | None:
#     """Duration of a PCM WAV from its header, or None if the bytes are not a WAV file."""
#     if len(data) < 44 or data[0:4] != b"RIFF" or data[8:12] != b"WAVE":
#         return None
#     pos, byte_rate = 12, None
#     while pos + 8 <= len(data):
#         chunk_id, size = data[pos:pos + 4], struct.unpack("<I", data[pos + 4:pos + 8])[0]
#         if chunk_id == b"fmt " and pos + 20 <= len(data):
#             byte_rate = struct.unpack("<I", data[pos + 16:pos + 20])[0]
#         if chunk_id == b"data":
#             if not byte_rate:
#                 return None
#             payload = min(size, len(data) - pos - 8)  # streaming headers may claim 0xFFFFFFFF
#             return payload / byte_rate
#         pos += 8 + size + (size % 2)
#     return None


# def _supported_language(code) -> str | None:
#     """Prisma's detected language as one of ours ("te-IN"), accepting "te", "TE-IN" or "te_IN";
#     None when it is missing or not a supported language (never guessed)."""
#     if not isinstance(code, str) or not code.strip():
#         return None
#     c = code.strip().replace("_", "-").lower()
#     for key in config.LANGUAGES:
#         if c in (key.lower(), key.split("-")[0].lower()):
#             return key
#     return None


# @app.get("/api/voice/health")
# def health():
#     return {
#         "ok": True,
#         "keyConfigured": bool(config.gnani_api_key()),
#         "keySource": config.gnani_key_source()[1],  # which variable / file, never the value
#         "sttModel": "Gnani Prisma (stt/v3)",
#         "ttsModel": f"Gnani Timbre ({config.TTS_MODEL})",
#         "languages": [
#             {"code": code, "name": info["name"], "native": info["native"], "status": info["status"]}
#             for code, info in config.LANGUAGES.items()
#         ],
#         "limits": {"maxAudioBytes": config.MAX_AUDIO_BYTES, "maxAudioSeconds": MAX_AUDIO_SECONDS,
#                    "maxTtsChars": config.MAX_TTS_CHARS},
#         # Task V4: whether the teaching LLM is configured (booleans + model id, never the key)
#         "teaching": {
#             "configured": all(config.llm_configured().values()),
#             "settings": config.llm_configured(),
#             "model": llm.model_name(),
#             # provider, model, endpoint host, thinking option (non-secret; never the key or full URL)
#             "provider": llm.provider_info(),
#             "languages": list(teaching.LANGUAGE_NAMES),
#         },
#     }


# _KEYTERM = re.compile(r"[^\w\s&()'-]", re.UNICODE)


# def _clean_keyterms(raw: str | None) -> list[str]:
#     """Part names of the loaded model, sent by the browser to help Prisma (no free text)."""
#     terms = []
#     for t in (raw or "").split(","):
#         t = _KEYTERM.sub("", t).strip()[:40]
#         if t and t not in terms:
#             terms.append(t)
#     return terms[: config.MAX_KEYTERMS]


# @app.post("/api/voice/transcribe")
# async def transcribe(audio: UploadFile = File(...), language: str = Form(...), keyterms: str | None = Form(None),
#                      diag: str | None = Form(None)):
#     """language "auto" = Prisma v3.0 language detection (one request); the reply's "language" is
#     the detected language (None if Prisma could not judge it)."""
#     auto = language == config.AUTO_LANGUAGE
#     if not auto and language not in config.LANGUAGES:
#         return error("UNSUPPORTED_LANGUAGE", f"Language '{language}' is not supported.", 400)
#     if (audio.content_type or "").lower() not in config.ALLOWED_AUDIO_TYPES:
#         return error("UNSUPPORTED_AUDIO", "Audio must be a WAV recording.", 415)
#     data = await audio.read(config.MAX_AUDIO_BYTES + 1)
#     if len(data) > config.MAX_AUDIO_BYTES:
#         return error("AUDIO_TOO_LARGE", "Recording is too large.", 413)
#     duration = wav_duration_seconds(data)
#     if duration is None:
#         return error("UNSUPPORTED_AUDIO", "Audio is not a valid WAV file.", 415)
#     if duration < 0.2:
#         return error("AUDIO_TOO_SHORT", "Recording is too short.", 400)
#     if duration > MAX_AUDIO_SECONDS:
#         return error("AUDIO_TOO_LONG", f"Recording is longer than {MAX_AUDIO_SECONDS} seconds.", 413)
#     started = time.perf_counter()
#     try:
#         result = gnani.transcribe(data, "speech.wav", language, _clean_keyterms(keyterms) if auto else None)
#     except gnani.GnaniError as exc:
#         if voice_diag.enabled():
#             voice_diag.write({"client": voice_diag.parse_client(diag), "upload": voice_diag.wav_stats(data),
#                               "prisma": {"ok": False, "code": exc.code, "status": exc.status, "language_requested": language,
#                                          "latency_ms": round((time.perf_counter() - started) * 1000)}})
#         return error(exc.code, exc.message, exc.status)
#     if voice_diag.enabled():
#         # Metadata only: transcript LENGTH, never its text
#         voice_diag.write({"client": voice_diag.parse_client(diag), "upload": voice_diag.wav_stats(data),
#                           "prisma": {"ok": True, "status": 200, "language_requested": language,
#                                      "latency_ms": round((time.perf_counter() - started) * 1000),
#                                      "processing_time_s": result.get("processing_time"),
#                                      "transcript_chars": len(result["transcript"]),
#                                      "detected_language": result.get("detected_language")}})
#     if auto:
#         detected = result.get("detected_language")
#         return {"transcript": result["transcript"],
#                 "language": _supported_language(detected),
#                 "detectedLanguage": detected, "requestId": result["request_id"]}
#     return {"transcript": result["transcript"], "language": language, "requestId": result["request_id"]}


# @app.post("/api/voice/diag", status_code=204)
# async def recording_diag(diag: str | None = Form(None)):
#     """Metadata of a recording that was NOT sent to Prisma (muted / stalled microphone, nothing
#     said). Written only when VOICE_DIAG=1; never calls Gnani; whitelisted numbers and codes only."""
#     if voice_diag.enabled():
#         voice_diag.write({"client": voice_diag.parse_client(diag), "upload": None, "prisma": None})
#     return Response(status_code=204)


# class SpeakRequest(BaseModel):
#     text: str
#     language: str


# @app.post("/api/voice/speak")
# def speak(req: SpeakRequest):
#     if req.language not in config.LANGUAGES:
#         return error("UNSUPPORTED_LANGUAGE", f"Language '{req.language}' is not supported.", 400)
#     text = req.text.strip()
#     if not text:
#         return error("EMPTY_TEXT", "Nothing to speak.", 400)
#     if len(text) > config.MAX_TTS_CHARS:
#         return error("TEXT_TOO_LONG", f"Text is longer than {config.MAX_TTS_CHARS} characters.", 413)
#     try:
#         audio = gnani.synthesize(text, req.language)
#     except gnani.GnaniError as exc:
#         return error(exc.code, exc.message, exc.status)
#     return Response(content=audio, media_type="audio/wav")


# @app.post("/api/teach")
# def teach(req: teaching.TeachRequest):
#     """Question + fact pack -> validated teaching plan. Plans are data; the browser runs them."""
#     if req.language not in config.LANGUAGES:
#         return error("UNSUPPORTED_LANGUAGE", f"Language '{req.language}' is not supported.", 400)
#     try:
#         plan = teaching.generate_plan(req)
#     except llm.LLMError as exc:
#         return error(exc.code, exc.message, exc.status)
#     except teaching.TeachError as exc:
#         return error(exc.code, exc.message, exc.status)
#     return {"plan": plan}


# def _request_id(request: Request) -> str:
#     """Browser turn id for correlating timings (letters, digits, '-' only; never user content)."""
#     return re.sub(r"[^A-Za-z0-9-]", "", request.headers.get("x-request-id", ""))[:40]


# @app.post("/api/teach/stream")
# def teach_stream(req: teaching.TeachRequest, request: Request):
#     """NDJSON events: step* then done, or error. Validation errors before streaming are normal JSON errors."""
#     if req.language not in config.LANGUAGES:
#         return error("UNSUPPORTED_LANGUAGE", f"Language '{req.language}' is not supported.", 400)
#     try:
#         teaching.check_target(req)
#     except teaching.TeachError as exc:
#         return error(exc.code, exc.message, exc.status)
#     rid = _request_id(request)

#     def events():
#         try:
#             for event in teaching.stream_plan(req, request_id=rid):
#                 yield json.dumps(event, ensure_ascii=False) + "\n"
#         except (llm.LLMError, teaching.TeachError) as exc:
#             _timing_log.info("teach stream error code=%s request=%s", exc.code, rid or "-")
#             yield json.dumps({"type": "error", "code": exc.code, "message": exc.message}, ensure_ascii=False) + "\n"

#     return StreamingResponse(events(), media_type="application/x-ndjson",
#                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# @app.post("/api/tutor/evaluate")
# def tutor_evaluate(req: tutor.EvaluateRequest):
#     """Checks one spoken quiz answer (understanding check after an explanation)."""
#     if req.language not in config.LANGUAGES:
#         return error("UNSUPPORTED_LANGUAGE", f"Language '{req.language}' is not supported.", 400)
#     try:
#         return tutor.evaluate(req)
#     except llm.LLMError as exc:
#         return error(exc.code, exc.message, exc.status)
#     except tutor.EvaluateError as exc:
#         return error(exc.code, exc.message, exc.status)


# @app.post("/api/interpret")
# def interpret_utterance(req: interpret.InterpretRequest):
#     """Fallback intent classification (fixed intent list; the browser executes via its parser)."""
#     if req.language not in config.LANGUAGES:
#         return error("UNSUPPORTED_LANGUAGE", f"Language '{req.language}' is not supported.", 400)
#     try:
#         return interpret.interpret(req)
#     except llm.LLMError as exc:
#         return error(exc.code, exc.message, exc.status)
#     except interpret.InterpretError as exc:
#         return error(exc.code, exc.message, exc.status)

