# GestureLab CAD: Project Explanation

**Great Indian AI Internship Challenge 2026 (Gnani AI): Jugaad Genius Award entry**

---

## 1. Project Title

**GestureLab CAD: a voice- and gesture-driven 3D engineering tutor**

## 2. Problem Statement

Beginners in mechanical engineering usually meet a complex assembly, such as a planetary gearbox, through textbooks, static diagrams, CAD models and separate videos. Each of these shows *something*, but none of them answers the learner's own question at the moment it arises:

- A diagram shows the parts but not how they move or depend on each other.
- A 3D viewer lets you rotate a model, but it does not explain *why* a part is there or *what happens without it*.
- A long written or recorded explanation is not connected to the part the student is looking at.
- Help in the student's own language (Telugu, Hindi) is rarely available outside the classroom.

The result: students can look at an assembly, yet still not understand how its components work together.

## 3. Target Audience

**Primary**
- Mechanical engineering and diploma students learning machine elements and mechanisms.
- Engineering beginners exploring an assembly for the first time.
- Students who understand better by asking questions aloud, including in Telugu or Hindi.

**Secondary**
- Engineering educators and technical trainers who demonstrate assemblies in class.
- Learners who prefer interactive, voice-based learning to reading.

**Why it helps them:** the student can point at a part, ask about it in their own words, and hear the answer while the same parts light up in 3D, so the explanation and the physical structure are understood together. This is a project prototype. It has not been deployed in colleges or evaluated with students yet.

## 4. Proposed Solution

GestureLab CAD turns a 3D engineering viewer into a **tutor that listens, explains and shows**:

1. The student selects a part with the mouse, or **points at it with a hand gesture** through an ordinary webcam.
2. The student **asks aloud**, for example *"What happens if I remove this gear?"*
3. **Gnani Prisma** converts the speech to text (English, Telugu, Hindi; mixed Telugu-English and Hindi-English speech is handled).
4. The application resolves *"this gear"* to the real selected or pointed part.
5. **Gemini** writes a short **lesson plan**: each step pairs one or two spoken sentences with a 3D action (focus a part, highlight the parts it drives, separate the assembly).
6. Every action is **validated** against the model's real parts and recorded relationships before it runs.
7. **Gnani Timbre** speaks each step **while** its parts are highlighted, in the learner's language.
8. When the explanation ends, the assembly is restored automatically. Speaking again interrupts the tutor at once.

## 5. Main Features (implemented)

| Feature | Details |
| :--- | :--- |
| Interactive 3D models | 5 learning modules: planetary gearbox, steam locomotive, reinforced-concrete frame, Warren truss bridge, human eye (Three.js) |
| Exploded view / reassembly | Toolbar, X key, voice command, or two-hand gesture; colour-coded X-ray view with part labels |
| Engineering inspector | Role, specifications, materials and a relationship map (*drives*, *meshes with*, *supports*) from the model data |
| Assembly tree | Browse, search, select, hide parts |
| Voice tutor | Push-to-talk (button or M), live states (listening, understanding, preparing, explaining step x of y, paused, speaking, complete, error), transcript shown as "You asked" |
| Explanation ↔ 3D sync | Each step highlights or focuses the parts it names; the panel lists them under "Shown in the 3D model"; the assembly is restored at the end |
| Honest claims | Every step is labelled: *shown in the 3D model*, *from the model data*, *engineering explanation*, or *not simulated in this app* |
| Hand gestures (MediaPipe, in the browser) | Open palm → orbit, pinch → zoom, point and hold 1.2 s → select, two hands pinch-and-spread → explode or reassemble |
| Voice + gesture together | "This" means the part you are pointing at or have selected |
| Follow-ups | Context-aware suggested questions and one-click follow-ups (same path as speaking) |
| Multilingual | English, Telugu, Hindi (Bengali in beta) |
| Fallback | If the LLM is unavailable, a grounded explanation is built from the model data and plays the same way |

## 6. Creative Use of Gnani AI

Most voice integrations use speech-to-text as a keyboard and text-to-speech as a loudspeaker. GestureLab CAD makes **Gnani's voice models the controls of a 3D engineering lesson**:

- **Speech becomes a spatial action.** A Prisma transcript like *"What is this connected to?"* is resolved against what the student is pointing at, and the connected parts light up in the 3D model.
- **Speech is synchronised with motion.** Timbre speaks each lesson step at the moment its parts are highlighted, or when the assembly separates, so hearing and seeing happen together. Long answers are spoken sentence by sentence as they stream in, so the first words come quickly.
- **Voice and hands are one interface.** The learner points with a finger and asks with their voice, and can interrupt the tutor by speaking.
- **Indian-language learning.** A Telugu or Hindi question is answered in the same language, with technical terms kept in English, as students actually speak.

**The "jugaad":** a laptop, a webcam and Gnani's Indian-language voice models stand in for an expensive cut-away model and a tutor who speaks the student's language.

## 7. Technical Architecture

```
Microphone ─► Browser (React, TypeScript) ─► FastAPI backend ─► Gnani Prisma (STT)
                                                 │
   transcript ◄──────────────────────────────────┘
       │
       ▼
Deterministic parser + part resolver (named / pointed / selected / last topic)
       │
       ├─► scene command ─► validated command dispatcher ─► Three.js viewer
       └─► question ─► fact pack (model data + scene state) ─► FastAPI ─► Gemini (streamed lesson plan)
                                                                          │
              validated plan steps ◄──────────────────────────────────────┘
                     │
                     ▼
              Plan player: 3D actions (dispatcher) + narration ─► FastAPI ─► Gnani Timbre (TTS)

Webcam ─► MediaPipe Hand Landmarker (in the browser) ─► gestures ─► same command dispatcher
```

- **Frontend:** React 19, TypeScript, Three.js, Vite.
- **Backend:** Python, FastAPI. It holds the API keys; the browser never calls Gnani or Gemini directly.
- **Safety:** the LLM returns data, never code. Actions are limited to an allowed list, validated in the backend and again in the browser, and run through the same dispatcher as mouse, keyboard and gestures.
- **Quality:** 873 automated frontend tests and 173 backend tests. Gnani and Gemini are simulated in tests, so no credits are used.

## 8. Gnani AI Models / APIs Used

| Model | API | Where in the code | Purpose |
| :--- | :--- | :--- | :--- |
| **Gnani Prisma** (speech-to-text, `stt/v3`) | `POST {GNANI_BASE}/stt/v3` | `backend/app/gnani.py` `transcribe()`, exposed as `POST /api/voice/transcribe` | Spoken questions and commands → text; engineering-vocabulary bias list; language codes `en-IN`, `te-IN`, `hi-IN` (`bn-IN` beta) |
| **Gnani Timbre** (text-to-speech, `timbre-v2.5`) | `POST {GNANI_BASE}/api/v1/tts/inference` | `backend/app/gnani.py` `synthesize()`, exposed as `POST /api/voice/speak` | Every reply and every lesson step spoken in the learner's language |

Reasoning layer (not Gnani): **Gemini**, via an OpenAI-compatible client (`backend/app/llm.py`, `backend/app/teaching.py`).

## 9. Expected Educational Impact

- **Faster understanding of mechanisms:** the explanation and the highlighted parts arrive together, so learners connect *what a part does* with *where it is*.
- **"What if" thinking:** students can ask what happens without a part and see which connected parts depend on it, with clear labels on what is reasoning and what is not simulated.
- **Learning in one's own language:** Telugu and Hindi questions get spoken answers in the same language.
- **Low cost:** an ordinary laptop and webcam. No physical models or special hardware.

These are expected benefits of the design. No classroom study has been carried out yet.

## 10. Current Limitations

- **Live latency** depends on Gnani and Gemini response times and the network; it has not been formally benchmarked.
- **Gestures** need reasonable lighting and a visible hand. Mouse, keyboard and voice always remain available.
- **No physics simulation:** failures, forces and stresses are explained as engineering reasoning and clearly marked *not simulated*.
- **Context-aware suggested questions** are English only; spoken questions work in English, Telugu and Hindi. Bengali is beta.
- **The knowledge comes from each model's own data** (parts, roles, relationships). Questions beyond it are answered as general engineering knowledge or declined.
- **A prototype:** it runs locally (backend plus dev server). It is not yet deployed or evaluated with students.
