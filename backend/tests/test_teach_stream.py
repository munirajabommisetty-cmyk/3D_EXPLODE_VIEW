"""
Streaming teaching plans and upstream-timeout handling (voice latency milestone).

The LLM and Gnani are SIMULATED (no network): these tests prove that the first validated step is
sent before the model has finished writing, that the steps match the final validated plan, and
that failures become clean error events / codes without the key.
"""
import json

import pytest
import requests
from fastapi.testclient import TestClient

from app import config, gnani, llm, main, teaching
from tests.test_teach_api import FAKE_KEY, SETTINGS, VALID_PLAN, body, step
from tests.test_voice_api import FakeResponse as GnaniResponse, make_wav

client = TestClient(main.app)


def chunks(text: str, size: int) -> list[str]:
    return [text[i:i + size] for i in range(0, len(text), size)]


# ---------------------------------------------------------------- step extractor

@pytest.mark.parametrize("size", [1, 3, 7, 50, 10_000])
def test_extractor_finds_each_step_across_any_chunking(size):
    plan = dict(VALID_PLAN)
    plan["steps"] = [
        step("Braces { } and [brackets] and \"quotes\" inside text do not confuse it."),
        step("ఈ Sun Gear మధ్యలో ఉంటుంది. ఇది Planet Gears ని తిప్పుతుంది."),
    ]
    text = "```json\n" + json.dumps(plan, ensure_ascii=False) + "\n```"
    ex = teaching.StepExtractor()
    found = [p for c in chunks(text, size) for k, p in ex.feed(c) if k == "step"]
    assert [s["narration"] for s in found] == [s["narration"] for s in plan["steps"]]


def test_extractor_ignores_objects_outside_steps():
    text = json.dumps({"title": "t", "meta": {"steps": [{"x": 1}]}, "steps": [step()], "explanation": "{ not a step }"})
    found = [p for k, p in teaching.StepExtractor().feed(text) if k == "step"]
    assert len(found) == 1 and found[0]["kind"] == "demonstrate"


# ---------------------------------------------------------------- stream_plan

def make_stream(text: str, size: int, log: list):
    def fake(system, user, schema, request_id=""):
        for c in chunks(text, size):
            log.append(("chunk", c))
            yield c
        log.append(("end", None))
    return fake


def test_first_step_is_sent_before_the_model_finishes():
    log: list = []
    req = teaching.TeachRequest(**body())
    text = json.dumps(VALID_PLAN)
    events = []
    for ev in teaching.stream_plan(req, make_stream(text, 20, log)):
        if ev["type"] != "token":
            events.append(ev["type"])
        log.append(("event", ev["type"]))
    first_step = log.index(("event", "step"))
    assert ("end", None) in log[first_step:], "step 1 was emitted while the LLM was still streaming"
    assert events == ["step", "step", "done"]


def test_streamed_steps_equal_the_final_validated_plan():
    req = teaching.TeachRequest(**body())
    events = list(teaching.stream_plan(req, make_stream(json.dumps(VALID_PLAN), 13, [])))
    steps = [e["step"] for e in events if e["type"] == "step"]
    done = events[-1]["plan"]
    assert steps == done["steps"]
    assert done["title"] == VALID_PLAN["title"]


def test_invalid_step_is_reported_not_sent():
    plan = dict(VALID_PLAN)
    plan["steps"] = [step(actions=[{"type": "component.delete"}]), step("Valid one.")]
    events = list(teaching.stream_plan(teaching.TeachRequest(**body()), make_stream(json.dumps(plan), 40, [])))
    events = [e for e in events if e["type"] != "token"]
    assert [e["type"] for e in events] == ["rejected", "step", "done"]
    assert events[1]["step"]["index"] == 1 and events[2]["plan"]["steps"][0]["index"] == 1


def test_provider_refusing_streaming_falls_back_to_one_normal_call(monkeypatch):
    def refuse(*a, **k):
        raise llm.LLMError("LLM_BAD_REQUEST", "no stream", 502)
        yield ""  # pragma: no cover
    calls = []
    monkeypatch.setattr(teaching, "generate_plan", lambda req: calls.append(1) or teaching.validate_plan(VALID_PLAN, req))
    events = list(teaching.stream_plan(teaching.TeachRequest(**body()), refuse))
    assert [e["type"] for e in events] == ["step", "step", "done"] and calls == [1]


def test_failure_after_some_steps_is_raised_not_retried(monkeypatch):
    text = json.dumps(VALID_PLAN)

    def breaks(*a, **k):
        yield text[: text.index('"followUpSuggestions"')]
        raise llm.LLMError("LLM_TIMEOUT", "The teaching model stopped responding.", 504)
    monkeypatch.setattr(teaching, "generate_plan", lambda req: pytest.fail("no second LLM call after a partial answer"))
    gen = teaching.stream_plan(teaching.TeachRequest(**body()), breaks)
    got = []
    with pytest.raises(llm.LLMError):
        for ev in gen:
            if ev["type"] != "token":
                got.append(ev["type"])
    assert got == ["step", "step"], "the steps already written are kept"


# ---------------------------------------------------------------- endpoint

def ndjson(resp) -> list[dict]:
    return [json.loads(line) for line in resp.text.splitlines() if line.strip()]


def test_endpoint_streams_ndjson(monkeypatch):
    monkeypatch.setattr(llm, "chat_stream", make_stream(json.dumps(VALID_PLAN, ensure_ascii=False), 25, []))
    resp = client.post("/api/teach/stream", json=body(), headers={"X-Request-Id": "turn-7<script>"})
    assert resp.status_code == 200 and resp.headers["content-type"].startswith("application/x-ndjson")
    assert [e["type"] for e in ndjson(resp)] == ["token", "step", "step", "done"]


def test_endpoint_turns_llm_timeout_into_an_error_event_without_key(monkeypatch):
    def timeout(*a, **k):
        raise llm.LLMError("LLM_TIMEOUT", "The teaching model took too long to answer.", 504)
        yield ""  # pragma: no cover
    monkeypatch.setattr(llm, "chat_stream", timeout)
    resp = client.post("/api/teach/stream", json=body())
    events = ndjson(resp)
    assert events == [{"type": "error", "code": "LLM_TIMEOUT", "message": "The teaching model took too long to answer."}]
    assert FAKE_KEY not in resp.text


def test_endpoint_validates_before_streaming():
    resp = client.post("/api/teach/stream", json=body(targetComponentId="not_a_part"))
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "UNKNOWN_COMPONENT"
    assert client.post("/api/teach/stream", json=body(language="xx-XX")).status_code == 400


def test_new_question_types_are_accepted(monkeypatch):
    monkeypatch.setattr(llm, "chat_stream", make_stream(json.dumps(VALID_PLAN), 500, []))
    for qt in ("example", "general"):
        assert client.post("/api/teach/stream", json=body(questionType=qt, targetComponentId=None)).status_code == 200


# ---------------------------------------------------------------- chat_stream (SSE parsing, timeouts)

class SseResponse:
    def __init__(self, lines, status=200, raise_after=None):
        self.status_code = status
        self._lines = lines
        self.raise_after = raise_after
        self.closed = False
        self.text = ""

    def iter_lines(self):
        for i, line in enumerate(self._lines):
            if self.raise_after is not None and i == self.raise_after:
                raise requests.ReadTimeout()
            yield line

    def json(self):
        return {"error": {"status": "X", "message": "m"}}

    def close(self):
        self.closed = True


@pytest.fixture
def llm_settings(monkeypatch):
    monkeypatch.setattr(config, "llm_setting", lambda name: SETTINGS.get(name))


def sse(*deltas):
    out = [b": keep-alive"]
    for d in deltas:
        out.append(b"data: " + json.dumps({"choices": [{"delta": {"content": d}}]}, ensure_ascii=False).encode("utf-8"))
    return out + [b"data: [DONE]"]


def test_chat_stream_parses_sse_deltas_including_telugu(monkeypatch, llm_settings):
    seen = {}

    def fake_post(url, **kw):
        seen.update(kw)
        return SseResponse(sse('{"title": "', "సన్ గేర్", '"}'))
    monkeypatch.setattr(llm.requests, "post", fake_post)
    assert "".join(llm.chat_stream("s", "u", {"type": "object"})) == '{"title": "సన్ గేర్"}'
    assert seen["stream"] is True and seen["json"]["stream"] is True
    assert seen["timeout"] == (8.0, 20.0), "connect timeout + idle timeout between chunks"


def test_chat_stream_idle_timeout_and_http_errors(monkeypatch, llm_settings):
    monkeypatch.setattr(llm.requests, "post", lambda url, **kw: SseResponse(sse("a", "b"), raise_after=2))
    with pytest.raises(llm.LLMError) as e:
        list(llm.chat_stream("s", "u", {}))
    assert e.value.code == "LLM_TIMEOUT"
    monkeypatch.setattr(llm.requests, "post", lambda url, **kw: SseResponse([], status=504))
    with pytest.raises(llm.LLMError) as e:
        list(llm.chat_stream("s", "u", {}))
    assert e.value.code == "LLM_TIMEOUT" and FAKE_KEY not in e.value.message


# ---------------------------------------------------------------- Gnani 504 (the error seen in testing)

@pytest.fixture
def gnani_key(monkeypatch):
    monkeypatch.setattr(config, "gnani_api_key", lambda: "gnani-secret-key")


@pytest.mark.parametrize("path,payload,op", [
    ("/api/voice/transcribe", None, "speech recognition"),
    ("/api/voice/speak", {"text": "Hello", "language": "en-IN"}, "speech synthesis"),
])
def test_gnani_gateway_504_names_the_operation_and_is_not_retried(monkeypatch, gnani_key, caplog, path, payload, op):
    sent = []
    monkeypatch.setattr(gnani.requests, "post", lambda url, **kw: sent.append(url) or GnaniResponse(504, None))
    caplog.set_level("INFO", logger="app.timing")
    if payload is None:
        resp = client.post(path, data={"language": "te-IN"}, files={"audio": ("speech.wav", make_wav(1), "audio/wav")})
    else:
        resp = client.post(path, json=payload)
    err = resp.json()["error"]
    assert resp.status_code == 504 and err["code"] == "GNANI_GATEWAY_TIMEOUT"
    assert op in err["message"] and "504" in err["message"]
    assert len(sent) == 1, "no automatic retry of the same request"
    assert "gnani-secret-key" not in resp.text and "gnani-secret-key" not in caplog.text


# ---------------------------------------------------------------- sentence-level narration (audio-first)

def live_step(narration, **kw):
    """Step with the schema's streaming order: actions and caption BEFORE the narration."""
    base = step(narration, **kw)
    order = ["kind", "claim", "targetComponentId", "actions", "caption", "narration", "waitFor", "holdMs"]
    return {k: base[k] for k in order}


def live_plan(*narrations):
    return {"title": "t", "targetComponentId": "sun_gear", "cannotAnswer": None,
            "steps": [live_step(n) for n in narrations], "explanation": "e", "followUpSuggestions": []}


@pytest.mark.parametrize("size", [1, 2, 5, 9, 10_000])
@pytest.mark.parametrize("ascii_only", [False, True])
def test_extractor_emits_each_sentence_before_the_step_ends_in_any_script(size, ascii_only):
    narr = [
        "The slab carries the floor load to the beams. Without it, the beams carry nothing directly!",
        "अगर Slab न हो, तो फ़र्श का भार उठाने वाला हिस्सा नहीं रहेगा। Beams तक भार पहुँचाने का रास्ता भी नहीं बचेगा।",
        "స్లాబ్ లేకపోతే నేల మీద బరువును మోసే భాగం ఉండదు. Beams కి బరువు చేరదు.",
    ]
    text = json.dumps(live_plan(*narr), ensure_ascii=ascii_only)  # ascii_only: Telugu/Hindi arrive as \\uXXXX escapes
    ex = teaching.StepExtractor()
    events = [e for c in chunks(text, size) for e in ex.feed(c)]
    kinds = [k for k, _ in events]
    assert kinds.count("start") == 3 and kinds.count("step") == 3
    for i, full in enumerate(narr):
        seg = events[[n for n, (k, _) in enumerate(events) if k == "start"][i]:]
        seg = seg[: [n for n, (k, _) in enumerate(seg) if k == "step"][0] + 1]
        sentences = [p for k, p in seg if k == "sentence"]
        assert " ".join(sentences) == full, "every word kept, nothing repeated, Unicode intact"
        assert len(sentences) == 2, sentences
        assert seg[0][1]["actions"] and seg[0][1]["caption"], "the step's actions are known before its narration"


def test_extractor_does_not_split_decimals_or_short_fragments_and_flushes_an_unpunctuated_answer():
    narr = "It turns 2.5 times faster. Yes. That is the ratio shown in the model data"
    events = teaching.StepExtractor().feed(json.dumps(live_plan(narr)))
    assert [p for k, p in events if k == "sentence"] == ["It turns 2.5 times faster.", "Yes. That is the ratio shown in the model data"]


def test_first_sentence_is_sent_while_the_llm_is_still_writing_the_same_step():
    narration = "The slab carries the floor load. It passes that load to the beams. The beams pass it to the columns."
    text = json.dumps(live_plan(narration, "Second step."))
    cut = text.index("It passes")  # the model pauses right after the first sentence
    log: list = []

    def slow(system, user, schema, request_id=""):
        yield text[:cut]
        log.append("LLM_PAUSED_MID_STEP")
        yield text[cut:]
        log.append("LLM_DONE")
    for ev in teaching.stream_plan(teaching.TeachRequest(**body()), slow):
        log.append(ev["type"] if ev["type"] != "narration" else f"narration:{ev['text']}")
    assert log.index("stepStart") < log.index("LLM_PAUSED_MID_STEP")
    assert log.index("narration:The slab carries the floor load.") < log.index("LLM_PAUSED_MID_STEP")
    assert log.index("LLM_DONE") < log.index("done")
    assert log[0] == "token"


def test_unsafe_sentence_is_never_sent_and_stops_the_live_step():
    text = json.dumps(live_plan("Look closely at the slab in the model. Then visit https://example.test for more.", "A safe second step."))
    events = list(teaching.stream_plan(teaching.TeachRequest(**body()), make_stream(text, 7, [])))
    said = [e["text"] for e in events if e["type"] == "narration"]
    assert said == ["Look closely at the slab in the model.", "A safe second step."] and not any("https" in t for t in said)
    assert {"type": "rejected", "index": 0, "code": "PLAN_UNSAFE"} in events


def test_what_if_questions_are_explained_as_consequences_in_the_prompt():
    assert "what if it were missing" in teaching.SYSTEM_PROMPT and "without an engineer's assessment" in teaching.SYSTEM_PROMPT
    order = list(teaching.PLAN_JSON_SCHEMA["properties"]["steps"]["items"]["properties"])
    assert order.index("actions") < order.index("narration") and order.index("caption") < order.index("narration")
