"""
Live Gnani smoke test (Task V2). Calls the REAL Gnani services through our own API:

    text --/api/voice/speak (Timbre)--> WAV --/api/voice/transcribe (Prisma)--> transcript

for each of the 10 languages. It only reports whether the key is configured, never its value.
Spends a small number of Gnani credits (one TTS + one STT call per phrase).

    cd backend
    python scripts/smoke_gnani.py [--out DIR] [--lang te-IN ...]

With --out, the WAVs and a results.json (phrase, transcript, timings) are saved so the same
audio can be replayed through the browser's voice path.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app import config  # noqa: E402
from app.main import app  # noqa: E402

# Command phrases per language. en/te/hi are the fully supported command languages (incl. code-mixed);
# the beta languages only check that speech in/out works.
PHRASES: dict[str, list[str]] = {
    "en-IN": ["Zoom in", "Show the sun gear", "Rotate left", "Isolate the ring gear", "Show me the piston"],
    "te-IN": ["జూమ్ ఇన్ చేయండి", "సన్ గేర్ చూపించు", "ఎడమ వైపు తిప్పు", "రింగ్ గేర్ ని ఐసొలేట్ చేయండి", "ప్లానెట్ క్యారియర్ ని దాచు"],
    "hi-IN": ["ज़ूम इन करो", "सन गियर दिखाओ", "बाएं घुमाओ", "रिंग गियर को आइसोलेट करो", "प्लैनेट कैरियर को छुपाओ"],
    "ta-IN": ["ஜூம் இன் செய்"],
    "kn-IN": ["ಜೂಮ್ ಇನ್ ಮಾಡಿ"],
    "ml-IN": ["സൂം ഇൻ ചെയ്യുക"],
    "bn-IN": ["জুম ইন করো"],
    "mr-IN": ["झूम इन करा"],
    "gu-IN": ["ઝૂમ ઇન કરો"],
    "pa-IN": ["ਜ਼ੂਮ ਇਨ ਕਰੋ"],
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--lang", nargs="*", default=list(PHRASES))
    args = parser.parse_args()

    client = TestClient(app)
    health = client.get("/api/voice/health").json()
    print(f"keyConfigured: {health['keyConfigured']}")
    if not health["keyConfigured"]:
        print("GNANI_API_KEY is not configured; live test not run.")
        return 2

    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
    results = []
    failures = 0
    for lang in args.lang:
        for i, phrase in enumerate(PHRASES[lang]):
            row = {"language": lang, "phrase": phrase, "status": config.LANGUAGES[lang]["status"]}
            t0 = time.perf_counter()
            tts = client.post("/api/voice/speak", json={"text": phrase, "language": lang})
            row["ttsStatus"] = tts.status_code
            row["ttsSeconds"] = round(time.perf_counter() - t0, 2)
            if tts.status_code != 200:
                row["error"] = tts.json().get("error", {}).get("code")
                failures += 1
                results.append(row)
                print(f"[FAIL] {lang} TTS {tts.status_code} {row['error']}  {phrase}")
                continue
            row["ttsBytes"] = len(tts.content)
            wav_name = f"{lang}_{i}.wav"
            if args.out:
                (args.out / wav_name).write_bytes(tts.content)
                row["wav"] = wav_name
            t1 = time.perf_counter()
            stt = client.post(
                "/api/voice/transcribe",
                data={"language": lang},
                files={"audio": ("speech.wav", tts.content, "audio/wav")},
            )
            row["sttStatus"] = stt.status_code
            row["sttSeconds"] = round(time.perf_counter() - t1, 2)
            if stt.status_code != 200:
                row["error"] = stt.json().get("error", {}).get("code")
                failures += 1
                print(f"[FAIL] {lang} STT {stt.status_code} {row['error']}  {phrase}")
            else:
                row["transcript"] = stt.json()["transcript"]
                print(f"[ ok ] {lang}  TTS {row['ttsSeconds']}s  STT {row['sttSeconds']}s  "
                      f"said: {phrase}  |  heard: {row['transcript']}")
            results.append(row)

    if args.out:
        (args.out / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{len(results) - failures}/{len(results)} round trips completed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
