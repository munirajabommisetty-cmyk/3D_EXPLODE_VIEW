"""
OpenAI-compatible chat client for the teaching engine (Task V4).

The project uses Google Gemini through its official OpenAI-compatible endpoint
(LLM_BASE_URL = https://generativelanguage.googleapis.com/v1beta/openai/), but nothing here is
Gemini-specific: base URL, model and key come from LLM_BASE_URL / LLM_MODEL / LLM_API_KEY.
The key is only placed in the Authorization header; it is never logged or returned.
"""
from __future__ import annotations

import json
import logging
import time
from collections.abc import Iterator

from urllib.parse import urlparse

import requests

from app import config


class LLMError(Exception):
    def __init__(self, code: str, message: str, status: int, detail: str = ""):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        # Provider's own error text (key redacted, truncated): for server-side diagnosis
        # (scripts/check_llm.py). Not included in API responses.
        self.detail = detail


_STATUS_MAP = {
    400: ("LLM_BAD_REQUEST", "The teaching model rejected the request.", 502),
    401: ("LLM_AUTH", "The teaching model rejected the API key.", 502),
    403: ("LLM_AUTH", "The API key is not allowed to use the teaching model.", 502),
    404: ("LLM_MODEL_NOT_FOUND", "The configured teaching model was not found.", 502),
    429: ("LLM_RATE_LIMIT", "Too many requests to the teaching model. Please wait a moment.", 429),
}


def _settings() -> tuple[str, str, str]:
    base, model, key = (config.llm_setting(n) for n in config.LLM_SETTINGS)
    if not (base and model and key):
        raise LLMError("LLM_NOT_CONFIGURED", "The teaching model is not configured on the server.", 503)
    return base.rstrip("/"), model, key


def model_name() -> str | None:
    """Configured model id (not secret), for health/status display."""
    return config.llm_setting("LLM_MODEL")


# ------------------------------------------------------------------ provider (non-secret settings)

def provider() -> str:
    """Which provider the configured endpoint is (see config.LLM_OPTION_SETTINGS). An explicit,
    known LLM_PROVIDER wins; otherwise Google's endpoint is "gemini" and anything else is
    "openai_compatible". Never "evon" unless LLM_PROVIDER=evon is set explicitly."""
    explicit = (config.llm_setting("LLM_PROVIDER") or "").strip().lower()
    if explicit in config.LLM_PROVIDERS:
        return explicit
    host = (urlparse(config.llm_setting("LLM_BASE_URL") or "").hostname or "").lower()
    return "gemini" if host == "generativelanguage.googleapis.com" else "openai_compatible"


def thinking_setting() -> str:
    """"on" / "off" when LLM_EVON_THINKING is set to a valid value, else "default"."""
    value = (config.llm_setting("LLM_EVON_THINKING") or "").strip().lower()
    return value if value in ("on", "off") else "default"


def provider_extra_body() -> dict:
    """Provider-specific request fields. Empty (nothing added) unless LLM_PROVIDER=evon AND
    LLM_EVON_THINKING is explicitly on/off; Gemini and other endpoints never receive them."""
    if provider() != "evon" or thinking_setting() == "default":
        return {}
    return {"chat_template_kwargs": {"enable_thinking": thinking_setting() == "on"}}


def provider_info() -> dict:
    """Safe diagnostics: provider, model id, endpoint host and the thinking option. Never the key,
    the full URL (it could carry a path or query), or any header."""
    base = config.llm_setting("LLM_BASE_URL") or ""
    return {
        "provider": provider(),
        "model": model_name(),
        "endpointHost": urlparse(base).hostname if base else None,
        "thinking": thinking_setting() if provider() == "evon" else "notApplicable",
    }


def _provider_detail(resp: requests.Response, key: str) -> tuple[str, str]:
    """(provider status, short message) from an error body, with the key redacted."""
    try:
        body = resp.json()
        err = (body[0] if isinstance(body, list) and body else body).get("error", {})
        status, message = str(err.get("status", "")), str(err.get("message", ""))
    except (ValueError, AttributeError, TypeError):
        status, message = "", resp.text or ""
    return status, message.replace(key, "<redacted>")[:300]


_timing = logging.getLogger("app.timing")


def _request(method: str, path: str, timeout: float, **kwargs) -> requests.Response:
    base, _, key = _settings()
    started = time.perf_counter()
    status = "error"
    try:
        resp = requests.request(method, base + path, headers={"Authorization": f"Bearer {key}"}, timeout=timeout, **kwargs)
        status = str(resp.status_code)
    except requests.Timeout as exc:
        status = "timeout"
        raise LLMError("LLM_TIMEOUT", "The teaching model took too long to answer.", 504) from exc
    except requests.RequestException as exc:
        raise LLMError("LLM_UNREACHABLE", "The server could not reach the teaching model.", 502) from exc
    finally:
        # Milestone B: duration and status only (no prompt, answer or key)
        _timing.info("llm %s %.0f ms status=%s", path, (time.perf_counter() - started) * 1000, status)
    if resp.status_code != 200:
        _raise_status(resp, key)
    return resp


def _raise_status(resp: requests.Response, key: str) -> None:
    status, detail = _provider_detail(resp, key)
    detail = f"{resp.status_code} {status}: {detail}".strip()
    if resp.status_code == 429 and ("quota" in detail.lower() or "per day" in detail.lower()):
        raise LLMError("LLM_QUOTA_EXCEEDED", "The teaching model's usage quota is used up. Try again later.", 429, detail)
    if resp.status_code in _STATUS_MAP:
        raise LLMError(*_STATUS_MAP[resp.status_code], detail)
    if resp.status_code in (502, 504):
        raise LLMError("LLM_TIMEOUT", f"The teaching model's gateway timed out ({resp.status_code}).", 504, detail)
    raise LLMError("LLM_UNAVAILABLE", f"The teaching model returned an error ({resp.status_code}).", 503, detail)


def object_mode_messages(system: str, user: str, schema: dict) -> list[dict]:
    """json_object mode: the schema is written into the instructions (accepted by every provider tried)."""
    return [
        {"role": "system", "content": system + "\n\nReply with ONE JSON object that matches this JSON schema exactly:\n"
         + json.dumps(schema, separators=(",", ":"))},
        {"role": "user", "content": user},
    ]


def chat_stream(system: str, user: str, schema: dict, connect_timeout: float = 8.0, idle_timeout: float = 20.0,
                deadline_s: float | None = None, request_id: str = "") -> Iterator[str]:
    """Streams the text of one chat completion (OpenAI-compatible SSE, `stream: true`) in json_object
    mode. Yields content deltas as they arrive. `idle_timeout` is the longest wait for the next chunk;
    `deadline_s` caps the whole answer. Errors raise LLMError (the key never appears in them)."""
    base, model, key = _settings()
    deadline_s = deadline_s or config.LLM_TIMEOUT_S + 10
    started = time.perf_counter()
    first: float | None = None
    status = "error"
    resp: requests.Response | None = None
    try:
        try:
            resp = requests.post(
                base + "/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json={"model": model, "messages": object_mode_messages(system, user, schema), "temperature": 0.2,
                      "response_format": {"type": "json_object"}, "stream": True, **provider_extra_body()},
                stream=True, timeout=(connect_timeout, idle_timeout),
            )
        except requests.Timeout as exc:
            status = "timeout"
            raise LLMError("LLM_TIMEOUT", "The teaching model took too long to answer.", 504) from exc
        except requests.RequestException as exc:
            raise LLMError("LLM_UNREACHABLE", "The server could not reach the teaching model.", 502) from exc
        status = str(resp.status_code)
        if resp.status_code != 200:
            _raise_status(resp, key)
        try:
            for line in resp.iter_lines():
                if time.perf_counter() - started > deadline_s:
                    status = "deadline"
                    raise LLMError("LLM_TIMEOUT", "The teaching model took too long to answer.", 504)
                if not line or not line.startswith(b"data:"):
                    continue
                payload = line[5:].strip()
                if payload == b"[DONE]":
                    break
                try:
                    delta = json.loads(payload.decode("utf-8"))["choices"][0].get("delta", {}).get("content")
                except (ValueError, KeyError, IndexError, TypeError, AttributeError):
                    continue  # keep-alive or a provider-specific event without text
                if delta:
                    if first is None:
                        first = time.perf_counter()
                    yield delta
        except requests.Timeout as exc:  # no chunk within idle_timeout
            status = "timeout"
            raise LLMError("LLM_TIMEOUT", "The teaching model stopped responding.", 504) from exc
        except requests.RequestException as exc:
            status = "broken"
            raise LLMError("LLM_UNREACHABLE", "The connection to the teaching model was interrupted.", 502) from exc
    finally:
        if resp is not None:
            resp.close()
        # Durations and status only (no prompt, answer or key)
        _timing.info("llm stream first_token=%s total=%.0f ms status=%s request=%s",
                     f"{(first - started) * 1000:.0f} ms" if first else "-", (time.perf_counter() - started) * 1000,
                     status, request_id or "-")


def list_models(timeout: float = 15) -> list[str]:
    """Model ids visible to this key (GET {base}/models)."""
    body = _request("GET", "/models", timeout).json()
    return [m.get("id", "") for m in body.get("data", []) if isinstance(m, dict)]


# (base URL, model) pairs whose provider rejected our JSON schema (HTTP 400). Verified live on
# 27 Oct 2026: Gemini's OpenAI-compatible layer returned 400 INVALID_ARGUMENT for the teaching-plan
# schema while accepting the same prompt in json_object mode and accepting small schemas.
_SCHEMA_REJECTED: set[tuple[str, str]] = set()


def schema_rejected() -> bool:
    """True if the configured provider/model rejected the plan schema in this process."""
    base, model, key = (config.llm_setting(n) for n in config.LLM_SETTINGS)
    return bool(base and model and key) and ((base.rstrip("/"), model) in _SCHEMA_REJECTED)


def chat_json(system: str, user: str, schema: dict, schema_name: str, timeout: float | None = None) -> dict:
    """One chat completion returning a JSON object. Asks for schema-constrained output
    (response_format json_schema); if the provider rejects that schema (400), retries once in
    json_object mode with the schema written into the instructions, and remembers that for this
    model. The schema only shapes the reply; callers must still validate it (teaching.validate_plan)."""
    base, model, _ = _settings()
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    schema_mode = {"type": "json_schema", "json_schema": {"name": schema_name, "schema": schema, "strict": True}}
    object_mode = {"type": "json_object"}
    object_messages = object_mode_messages(system, user, schema)

    def post(msgs: list, response_format: dict) -> requests.Response:
        return _request("POST", "/chat/completions", timeout or config.LLM_TIMEOUT_S,
                        json={"model": model, "messages": msgs, "temperature": 0.2, "response_format": response_format,
                              **provider_extra_body()})

    if (base, model) in _SCHEMA_REJECTED:
        resp = post(object_messages, object_mode)
    else:
        try:
            resp = post(messages, schema_mode)
        except LLMError as exc:
            if exc.code != "LLM_BAD_REQUEST":
                raise
            _SCHEMA_REJECTED.add((base, model))
            resp = post(object_messages, object_mode)
    try:
        content = resp.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise LLMError("LLM_MALFORMED", "The teaching model returned an unreadable response.", 502) from exc
    if not isinstance(content, str):
        raise LLMError("LLM_MALFORMED", "The teaching model returned no text.", 502)
    text = content.strip()
    if text.startswith("```"):  # tolerate a fenced JSON block; anything else must be pure JSON
        text = text.strip("`").removeprefix("json").strip()
    try:
        data = json.loads(text)
    except ValueError as exc:
        raise LLMError("LLM_MALFORMED", "The teaching model did not return valid JSON.", 502) from exc
    if not isinstance(data, dict):
        raise LLMError("LLM_MALFORMED", "The teaching model returned JSON that is not an object.", 502)
    return data
