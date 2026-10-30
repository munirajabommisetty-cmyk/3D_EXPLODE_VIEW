"""
Configuration loading tests (LLM .env fix). No network calls; all keys here are fakes.

Root cause covered: LLM_* settings placed in the project-root .env were ignored because only
backend/.env was read. Settings now resolve: environment -> backend/.env -> project-root .env,
from paths derived from app/config.py (independent of the working directory).
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import config, main

BACKEND = Path(__file__).resolve().parent.parent
PROJECT = BACKEND.parent
FAKE_LLM_KEY = "fake-llm-key-ABC123xyz"
FAKE_GNANI_KEY = "fake-gnani-key-999"


@pytest.fixture
def env_files(tmp_path, monkeypatch):
    """Two temporary .env files standing in for backend/.env and the project-root .env."""
    backend_env = tmp_path / "backend" / ".env"
    root_env = tmp_path / ".env"
    backend_env.parent.mkdir()
    monkeypatch.setattr(config, "ENV_FILE", backend_env)
    monkeypatch.setattr(config, "PROJECT_DIR", tmp_path)
    monkeypatch.setattr(config, "ENV_FILES", (backend_env, root_env))
    for name in (*config.LLM_SETTINGS, config.KEY_NAME):
        monkeypatch.delenv(name, raising=False)
    return backend_env, root_env


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


ROOT_LLM = (
    'LLM_BASE_URL=https://llm.example.test/v1/\n'
    'LLM_MODEL="test-model"\n'
    f'LLM_API_KEY="{FAKE_LLM_KEY}"\n'
)


def test_env_files_are_absolute_and_derived_from_the_code_location():
    assert all(p.is_absolute() for p in config.ENV_FILES)
    assert config.ENV_FILES == (BACKEND / ".env", PROJECT / ".env")


def test_llm_settings_in_project_root_env_are_found(env_files):
    """The reported failure: settings in the root .env, Gnani key in backend/.env."""
    backend_env, root_env = env_files
    write(backend_env, f'GNANI_API_KEY="{FAKE_GNANI_KEY}"\n')
    write(root_env, ROOT_LLM)
    assert config.llm_configured() == {"LLM_BASE_URL": True, "LLM_MODEL": True, "LLM_API_KEY": True}
    assert config.setting_sources(config.LLM_SETTINGS) == dict.fromkeys(config.LLM_SETTINGS, ".env (project root)")
    assert config.llm_setting("LLM_MODEL") == "test-model"


@pytest.mark.parametrize("cwd", ["backend", "root", "elsewhere"])
def test_resolution_does_not_depend_on_the_working_directory(env_files, tmp_path, monkeypatch, cwd):
    backend_env, root_env = env_files
    write(root_env, ROOT_LLM)
    other = tmp_path / "elsewhere"
    other.mkdir()
    monkeypatch.chdir({"backend": backend_env.parent, "root": tmp_path, "elsewhere": other}[cwd])
    assert all(config.llm_configured().values())


def test_backend_env_wins_over_project_root(env_files):
    backend_env, root_env = env_files
    write(backend_env, "LLM_MODEL=backend-model\n")
    write(root_env, ROOT_LLM)
    assert config.resolve_setting("LLM_MODEL") == ("backend-model", "backend/.env")


def test_process_environment_wins_but_empty_values_do_not_block(env_files, monkeypatch):
    _, root_env = env_files
    write(root_env, ROOT_LLM)
    monkeypatch.setenv("LLM_MODEL", "env-model")
    assert config.resolve_setting("LLM_MODEL") == ("env-model", "environment")
    monkeypatch.setenv("LLM_MODEL", "   ")  # empty process value must not hide the file value
    assert config.resolve_setting("LLM_MODEL") == ("test-model", ".env (project root)")


def test_missing_and_empty_settings_are_reported_as_missing(env_files):
    backend_env, root_env = env_files
    write(root_env, 'LLM_BASE_URL=https://llm.example.test/\nLLM_MODEL=""\n# LLM_API_KEY=commented-out\n')
    assert config.setting_sources(config.LLM_SETTINGS) == {
        "LLM_BASE_URL": ".env (project root)", "LLM_MODEL": None, "LLM_API_KEY": None,
    }
    assert config.llm_configured() == {"LLM_BASE_URL": True, "LLM_MODEL": False, "LLM_API_KEY": False}


def test_no_env_files_at_all(env_files):
    assert config.setting_sources(config.LLM_SETTINGS) == dict.fromkeys(config.LLM_SETTINGS)
    assert config.gnani_api_key() is None


def test_export_prefix_and_whitespace_are_tolerated(env_files):
    _, root_env = env_files
    write(root_env, f'export LLM_API_KEY = "{FAKE_LLM_KEY}"  \n')
    assert config.llm_setting("LLM_API_KEY") == FAKE_LLM_KEY


def test_gnani_configuration_is_unchanged(env_files):
    """GNANI_API_KEY still comes from backend/.env; the root file's lowercase api_key is not used."""
    backend_env, root_env = env_files
    write(backend_env, f'GNANI_API_KEY="{FAKE_GNANI_KEY}"\n')
    write(root_env, 'api_key="something-else"\n' + ROOT_LLM)
    assert config.gnani_api_key() == FAKE_GNANI_KEY
    assert config.resolve_setting("GNANI_API_KEY")[1] == "backend/.env"
    write(backend_env, "")
    assert config.gnani_api_key() is None, "a lowercase api_key is not GNANI_API_KEY"


def test_check_script_reports_sources_without_values(env_files, capsys):
    sys.path.insert(0, str(BACKEND / "scripts"))
    import check_llm  # noqa: E402

    _, root_env = env_files
    write(root_env, ROOT_LLM)
    assert check_llm.main(["--config-only"]) == 0
    out = capsys.readouterr().out
    assert "LLM_API_KEY: set (from .env (project root))" in out
    assert FAKE_LLM_KEY not in out and "llm.example.test" not in out

    write(root_env, "LLM_BASE_URL=https://llm.example.test/\n")
    assert check_llm.main(["--config-only"]) == 2
    out = capsys.readouterr().out
    assert "BLOCKED: missing LLM_MODEL, LLM_API_KEY" in out


def test_health_and_errors_never_contain_keys(env_files):
    backend_env, root_env = env_files
    write(backend_env, f'GNANI_API_KEY="{FAKE_GNANI_KEY}"\n')
    write(root_env, ROOT_LLM)
    client = TestClient(main.app)
    health = client.get("/api/voice/health").text
    assert FAKE_LLM_KEY not in health and FAKE_GNANI_KEY not in health
    bad = client.post("/api/teach", json={"question": "", "language": "en-IN", "facts": {}}).text
    assert FAKE_LLM_KEY not in bad


@pytest.mark.parametrize("cwd, script", [(BACKEND, "scripts/check_llm.py"), (PROJECT, "backend/scripts/check_llm.py")])
def test_check_script_runs_from_backend_and_project_root(cwd, script):
    """Real subprocess launch from both folders (settings via environment; no network: --config-only)."""
    env = {**os.environ, "LLM_BASE_URL": "https://llm.example.test/v1/", "LLM_MODEL": "test-model",
           "LLM_API_KEY": FAKE_LLM_KEY, "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1"}
    r = subprocess.run([sys.executable, script, "--config-only"], cwd=cwd, env=env, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "LLM_API_KEY: set (from environment)" in r.stdout
    assert FAKE_LLM_KEY not in r.stdout + r.stderr
