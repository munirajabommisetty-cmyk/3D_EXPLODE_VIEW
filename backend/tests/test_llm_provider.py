"""
Provider diagnostics and the optional Evon thinking setting (preparation for a possible Evon
deployment). Settings and HTTP are SIMULATED: no .env is read, no request leaves the machine.
These tests prove request construction and defaults only; nothing here was run against Evon.
"""
import json

import pytest
from fastapi.testclient import TestClient

from app import config, llm, main

GEMINI = {"LLM_BASE_URL": "https://generativelanguage.googleapis.com/v1beta/openai/", "LLM_MODEL": "gemini-test",
          "LLM_API_KEY": "secret-key-abc123"}
EVON = {"LLM_BASE_URL": "http://gpu-box.internal:8100/v1/", "LLM_MODEL": "model", "LLM_API_KEY": "secret-key-abc123"}


def use(monkeypatch, settings: dict):
    monkeypatch.setattr(config, "llm_setting", lambda name: settings.get(name))


class Captured:
    def __init__(self):
        self.bodies: list[dict] = []


class OkJson:
    status_code = 200
    text = ""

    def json(self):
        return {"choices": [{"message": {"content": "{\"ok\": true}"}}]}


class OkStream:
    status_code = 200
    text = ""

    def iter_lines(self):
        yield b'data: {"choices": [{"delta": {"content": "{}"}}]}'
        yield b"data: [DONE]"

    def close(self):
        pass


@pytest.fixture
def http(monkeypatch):
    cap = Captured()
    monkeypatch.setattr(llm.requests, "request", lambda method, url, **kw: cap.bodies.append(kw["json"]) or OkJson())
    monkeypatch.setattr(llm.requests, "post", lambda url, **kw: cap.bodies.append(kw["json"]) or OkStream())
    return cap


def run_both():
    llm.chat_json("s", "u", {"type": "object"}, "t")
    list(llm.chat_stream("s", "u", {"type": "object"}))


# ---------------------------------------------------------------- defaults: Gemini unchanged

def test_gemini_is_detected_and_requests_are_unchanged_by_default(monkeypatch, http):
    use(monkeypatch, GEMINI)
    assert llm.provider() == "gemini"
    run_both()
    json_body, stream_body = http.bodies
    assert set(json_body) == {"model", "messages", "temperature", "response_format"}
    assert set(stream_body) == {"model", "messages", "temperature", "response_format", "stream"}
    assert json_body["response_format"]["type"] == "json_schema" and stream_body["response_format"] == {"type": "json_object"}


def test_evon_thinking_setting_is_never_sent_to_gemini(monkeypatch, http):
    use(monkeypatch, {**GEMINI, "LLM_EVON_THINKING": "off"})
    run_both()
    assert all("chat_template_kwargs" not in b for b in http.bodies)
    assert llm.provider_info()["thinking"] == "notApplicable"


def test_other_endpoints_are_not_treated_as_evon_unless_explicit(monkeypatch, http):
    use(monkeypatch, {**EVON, "LLM_EVON_THINKING": "off"})
    assert llm.provider() == "openai_compatible", "an unknown host is never assumed to be Evon"
    run_both()
    assert all("chat_template_kwargs" not in b for b in http.bodies)


# ---------------------------------------------------------------- explicit Evon

@pytest.mark.parametrize("value,expected", [("off", False), ("OFF", False), ("on", True), (" On ", True)])
def test_explicit_evon_sends_enable_thinking_in_both_request_paths(monkeypatch, http, value, expected):
    use(monkeypatch, {**EVON, "LLM_PROVIDER": "evon", "LLM_EVON_THINKING": value})
    run_both()
    for body in http.bodies:
        assert body["chat_template_kwargs"] == {"enable_thinking": expected}
        assert body["model"] == "model" and body["temperature"] == 0.2, "existing fields unchanged"
    assert http.bodies[1]["stream"] is True and http.bodies[1]["response_format"] == {"type": "json_object"}


@pytest.mark.parametrize("value", [None, "", "maybe", "true"])
def test_evon_without_a_valid_thinking_value_adds_nothing(monkeypatch, http, value):
    use(monkeypatch, {**EVON, "LLM_PROVIDER": "evon", **({"LLM_EVON_THINKING": value} if value is not None else {})})
    run_both()
    assert all("chat_template_kwargs" not in b for b in http.bodies)
    assert llm.provider_info()["thinking"] == "default"


def test_explicit_provider_wins_and_unknown_values_fall_back_to_detection(monkeypatch):
    use(monkeypatch, {**GEMINI, "LLM_PROVIDER": "openai_compatible"})
    assert llm.provider() == "openai_compatible"
    use(monkeypatch, {**GEMINI, "LLM_PROVIDER": "something-else"})
    assert llm.provider() == "gemini"
    use(monkeypatch, {})
    assert llm.provider() == "openai_compatible"


def test_schema_fallback_retry_keeps_the_same_provider_fields(monkeypatch):
    """Gemini-style 400 on the schema request: the json_object retry is built the same way."""
    use(monkeypatch, {**EVON, "LLM_PROVIDER": "evon", "LLM_EVON_THINKING": "off", "LLM_MODEL": "model-retry-test"})
    bodies = []

    class Bad:
        status_code = 400
        text = "bad"

        def json(self):
            return {"error": {"status": "INVALID_ARGUMENT", "message": "schema"}}

    responses = iter([Bad(), OkJson()])
    monkeypatch.setattr(llm.requests, "request", lambda method, url, **kw: bodies.append(kw["json"]) or next(responses))
    llm.chat_json("s", "u", {"type": "object"}, "t")
    assert [b["response_format"]["type"] for b in bodies] == ["json_schema", "json_object"]
    assert all(b["chat_template_kwargs"] == {"enable_thinking": False} for b in bodies)


# ---------------------------------------------------------------- diagnostics never expose secrets

def test_provider_info_reports_only_safe_fields(monkeypatch):
    use(monkeypatch, {**EVON, "LLM_PROVIDER": "evon", "LLM_EVON_THINKING": "off",
                      "LLM_BASE_URL": "http://gpu-box.internal:8100/v1/?token=should-not-leak"})
    info = llm.provider_info()
    assert info == {"provider": "evon", "model": "model", "endpointHost": "gpu-box.internal", "thinking": "off"}
    assert "secret-key-abc123" not in json.dumps(info) and "should-not-leak" not in json.dumps(info)


def test_health_endpoint_shows_the_provider_without_the_key(monkeypatch):
    use(monkeypatch, GEMINI)
    monkeypatch.setattr(config, "gnani_api_key", lambda: "gnani-secret")
    resp = TestClient(main.app).get("/api/voice/health")
    teaching = resp.json()["teaching"]
    assert teaching["provider"] == {"provider": "gemini", "model": "gemini-test",
                                    "endpointHost": "generativelanguage.googleapis.com", "thinking": "notApplicable"}
    assert "secret-key-abc123" not in resp.text and "gnani-secret" not in resp.text
