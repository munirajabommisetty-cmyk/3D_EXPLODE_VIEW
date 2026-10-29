"""
Live check of the teaching LLM (Task V4). Makes REAL calls with LLM_BASE_URL / LLM_MODEL /
LLM_API_KEY, resolved exactly like the backend does (app/config.py: environment, then
backend/.env, then the project-root .env). Prints only setting sources, the model id, model
availability and the outcome; never the key. Works from any folder:

    python scripts/check_llm.py                 (from backend/)
    python backend/scripts/check_llm.py         (from the project root)
    python scripts/check_llm.py --config-only   (settings only, no network calls)

1. GET {base}/models          -> is LLM_MODEL visible to this key?
2. teaching.generate_plan() (exactly what POST /api/teach runs) with a small sample gearbox
   fact pack -> a validated plan? On failure, prints the provider's error text (key redacted).
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config, llm, teaching  # noqa: E402

# Sample facts copied from the gearbox model data (the browser builds the real pack).
SAMPLE = {
    "question": "Explain how power flows through this gearbox.",
    "language": "en-IN",
    "targetComponentId": None,
    "history": [],
    "facts": {
        "modelId": "planetary_gearbox", "modelName": "Epicyclic Planetary Gearbox", "domain": "mechanical",
        "components": [
            {"id": "central_shaft", "name": "Primary Drive Shaft", "role": "Axial Alignment & Power Transfer",
             "relationships": [{"type": "drives", "target": "sun_gear", "description": "The drive shaft turns the sun gear through a keyway."}]},
            {"id": "sun_gear", "name": "Sun Gear", "role": "Central Driving Input",
             "relationships": [{"type": "driven_by", "target": "central_shaft"}, {"type": "drives", "target": "planet_gear_1"}]},
            {"id": "planet_gear_1", "name": "Planet Gear A", "role": "Epicyclic Torque Transfer",
             "relationships": [{"type": "mates_with", "target": "ring_gear"}, {"type": "drives", "target": "planet_carrier"}]},
            {"id": "ring_gear", "name": "Annulus (Ring Gear)", "role": "Stationary Outer Reaction Ring",
             "relationships": [{"type": "mates_with", "target": "planet_gear_1"}]},
            {"id": "planet_carrier", "name": "Planet Carrier & Output Plate", "role": "Output Torque Collector",
             "relationships": [{"type": "driven_by", "target": "planet_gear_1"}]},
        ],
        "animations": [{"id": "gear_train_rotation", "label": "Epicyclic gear train in motion"}],
        "allowedActions": ["component.select", "component.focus", "component.highlight", "component.clearHighlight",
                           "animation.play", "animation.pause", "camera.view", "camera.reset"],
        "supportsExplodedView": True,
        "limits": ["The animation is a kinematic visual demonstration, not a physics simulation."],
        "scene": {},
    },
}


def report_config() -> bool:
    """Prints where settings are looked up and where each one was found. Never prints values."""
    print("looking in: environment, " + ", ".join(f"{p} ({'found' if p.is_file() else 'not found'})" for p in config.ENV_FILES))
    sources = config.setting_sources(config.LLM_SETTINGS)
    for name, source in sources.items():
        print(f"  {name}: {'set (from ' + source + ')' if source else 'MISSING'}")
    missing = [n for n, s in sources.items() if not s]
    if missing:
        print("BLOCKED: missing " + ", ".join(missing) + ". Add them to backend/.env (or the project-root .env).")
        return False
    print("model:", llm.model_name())
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check the teaching LLM configuration (and, by default, make live calls).")
    parser.add_argument("--config-only", action="store_true", help="only check settings; make no network calls")
    args = parser.parse_args(argv)
    if not report_config():
        return 2
    if args.config_only:
        print("config-only: no network calls made.")
        return 0
    model = llm.model_name()
    try:
        models = llm.list_models()
    except llm.LLMError as exc:
        print(f"[FAIL] list models: {exc.code} {exc.message} | provider: {exc.detail}")
        return 1
    visible = model in models or f"models/{model}" in models
    print(f"[{'ok' if visible else 'FAIL'}] {len(models)} models visible; configured model listed: {visible}")

    t0 = time.perf_counter()
    try:
        plan = teaching.generate_plan(teaching.TeachRequest(**SAMPLE))
    except llm.LLMError as exc:
        print(f"[FAIL] teaching plan: {exc.code} {exc.message} | provider: {exc.detail} ({round(time.perf_counter() - t0, 1)}s)")
        return 1
    except teaching.TeachError as exc:
        print(f"[FAIL] teaching plan rejected by validation: {exc.code} {exc.message}")
        return 1
    took = round(time.perf_counter() - t0, 1)
    mode = "json_object fallback (schema rejected by provider)" if llm.schema_rejected() else "json_schema"
    print(f"[ok] response mode: {mode}")
    print(f"[ok] plan in {took}s: '{plan['title']}' - {len(plan['steps'])} valid steps, {len(plan['rejectedSteps'])} rejected")
    for s in plan["steps"]:
        acts = ", ".join(a["type"] for a in s["actions"]) or "-"
        print(f"   {s['index']}. [{s['kind']}/{s['claim']}] {s['caption']}  | actions: {acts}")
    for rej in plan["rejectedSteps"]:
        print(f"   rejected step {rej['index']}: {rej['code']} {rej['reason']}")
    return 0 if visible else 1


if __name__ == "__main__":
    sys.exit(main())
