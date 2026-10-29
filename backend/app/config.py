"""
Voice backend configuration.

Settings (GNANI_API_KEY, LLM_BASE_URL, LLM_MODEL, LLM_API_KEY) are resolved in this order:
  1. the process environment,
  2. backend/.env,
  3. the project-root .env (CV_3D_GESTURE/.env).
Both files are located from this file's path (not the working directory), so the backend and
scripts resolve the same values from any folder. Empty values count as missing. Values are
never logged, returned or included in error messages; only names and sources are reported.
"""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent
ENV_FILE = BACKEND_DIR / ".env"
ENV_FILES: tuple[Path, ...] = (ENV_FILE, PROJECT_DIR / ".env")  # earlier file wins
KEY_NAME = "GNANI_API_KEY"

GNANI_BASE_URL = "https://api.vachana.ai"
STT_PATH = "/stt/v3"
TTS_PATH = "/api/v1/tts/inference"
TTS_MODEL = "timbre-v2.5"

# The 10 languages Gnani Prisma and Timbre support. Voice = native Timbre v2.5 voice.
# "status" reflects command-parser support in this app, not just speech support.
LANGUAGES: dict[str, dict] = {
    "en-IN": {"name": "English", "native": "English", "voice": "Kaveri", "status": "supported"},
    "te-IN": {"name": "Telugu", "native": "తెలుగు", "voice": "Suhana", "status": "supported"},
    "hi-IN": {"name": "Hindi", "native": "हिन्दी", "voice": "Nalini", "status": "supported"},
    "ta-IN": {"name": "Tamil", "native": "தமிழ்", "voice": "Asmita", "status": "beta"},
    "kn-IN": {"name": "Kannada", "native": "ಕನ್ನಡ", "voice": "Saanvi", "status": "beta"},
    "ml-IN": {"name": "Malayalam", "native": "മലയാളം", "voice": "Reshma", "status": "beta"},
    "bn-IN": {"name": "Bengali", "native": "বাংলা", "voice": "Kirra", "status": "beta"},
    "mr-IN": {"name": "Marathi", "native": "मराठी", "voice": "Zahira", "status": "beta"},
    "gu-IN": {"name": "Gujarati", "native": "ગુજરાતી", "voice": "Falak", "status": "beta"},
    "pa-IN": {"name": "Punjabi", "native": "ਪੰਜਾਬੀ", "voice": "Mehuli", "status": "beta"},
}

# Request limits
MAX_AUDIO_BYTES = 2 * 1024 * 1024        # ~60 s of 16 kHz mono WAV; recorder caps at 25 s
MAX_TTS_CHARS = 400
REQUEST_TIMEOUT_S = 20
ALLOWED_AUDIO_TYPES = {"audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"}

# Words Prisma should listen harder for (single words, letters only — per Gnani docs)
STT_BIAS_WORDS = ["zoom", "rotate", "explode", "assembly", "select", "gear", "carrier", "shaft", "animation"]


def _parse_env_file(path: Path) -> dict[str, str]:
    """NAME=value lines (comments, blanks and lines without '=' ignored; quotes stripped)."""
    values: dict[str, str] = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            name, sep, value = line.partition("=")
            name = name.strip()
            if name.startswith("export "):
                name = name[len("export "):].strip()
            if sep and name and not name.startswith("#"):
                values[name] = value.strip().strip("'\"").strip()
    return values


def _describe(path: Path) -> str:
    return "backend/.env" if path == ENV_FILE else ".env (project root)" if path == PROJECT_DIR / ".env" else str(path)


def resolve_setting(name: str) -> tuple[str | None, str | None]:
    """(value, source) for a setting, following the documented precedence. Never log the value."""
    env_value = os.environ.get(name, "").strip()
    if env_value:
        return env_value, "environment"
    for path in ENV_FILES:
        value = _parse_env_file(path).get(name)
        if value:
            return value, _describe(path)
    return None, None


def setting_sources(names) -> dict[str, str | None]:
    """Where each setting comes from (or None if missing). Names and sources only — no values."""
    return {name: resolve_setting(name)[1] for name in names}


def gnani_api_key() -> str | None:
    """The configured key, or None. Never log or return this value."""
    return resolve_setting(KEY_NAME)[0]


# --- Teaching LLM (Task V4): any OpenAI-compatible endpoint; the project uses Gemini. ---
LLM_SETTINGS = ("LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY")
LLM_TIMEOUT_S = 30


def llm_setting(name: str) -> str | None:
    """LLM_BASE_URL / LLM_MODEL / LLM_API_KEY from the environment or backend/.env.
    LLM_API_KEY must never be logged or returned."""
    return resolve_setting(name)[0]


def llm_configured() -> dict[str, bool]:
    """Which LLM settings are present (booleans only, never values)."""
    return {name: bool(llm_setting(name)) for name in LLM_SETTINGS}


# Optional, non-secret provider settings (environment or backend/.env). Both are unset by default,
# which keeps the current behaviour exactly as it is.
#   LLM_PROVIDER        "gemini" | "evon" | "openai_compatible". Unset: inferred from the base URL
#                       host (Google's endpoint = gemini, anything else = openai_compatible). Only an
#                       explicit "evon" ever enables Evon-specific request fields.
#   LLM_EVON_THINKING   "on" | "off". Used only when LLM_PROVIDER=evon: sends
#                       chat_template_kwargs.enable_thinking (Evon model card, vLLM / SGLang serving).
LLM_PROVIDERS = ("gemini", "evon", "openai_compatible")
LLM_OPTION_SETTINGS = ("LLM_PROVIDER", "LLM_EVON_THINKING")
