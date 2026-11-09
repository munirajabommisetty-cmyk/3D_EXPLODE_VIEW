# GestureLab CAD

### A 3D engineering tutor you can talk to, point at, and learn from, in your own language

| | |
| :--- | :--- |
| 📄 **One-page solution pitch** | [docs/GestureLab_CAD_Solution_Pitch.pdf](docs/GestureLab_CAD_Solution_Pitch.pdf) |
| 🌐 **Live app** | [https://3dexplodeview-frontend.vercel.app/](https://3dexplodeview-frontend.vercel.app/) |
| 📘 **Full project document** (technology, gestures, voice pipeline) | [docs/GestureLab_CAD_Project_Document.pdf](docs/GestureLab_CAD_Project_Document.pdf) |

GestureLab CAD turns a 3D model of a real machine into a tutor. A learner points at a part with their hand (or the mouse), asks a question out loud in **English, Telugu or Hindi**, and the machine answers: the right parts light up and move in 3D while a natural voice explains, step by step, in the same language the learner spoke.

It is built for the **Great Indian AI Internship Challenge 2026 by Gnani AI** as an entry for the **Jugaad Genius Award** ("the most creative or unexpected use of Gnani AI's models"), and is powered by **Gnani Prisma** (speech-to-text) and **Gnani Timbre** (text-to-speech).

--------



## 1. The Problem

Every engineering student knows this moment: you are looking at a machine (a planetary gearbox, a steam engine, the steel inside a concrete column) and you have one simple question. *Why is this part here? What is it connected to? What happens if it is missing?* And there is no one to ask.

The way machines are taught today leaves that question unanswered:

- **Textbooks and slides are flat.** A 2D cross-section cannot show how gears mesh, how motion passes from one part to the next, or how a structure carries its load. Students end up memorising diagrams instead of understanding mechanisms.
- **3D models show shape, not meaning.** A CAD viewer lets you rotate a model, but it never explains *why* a part exists or *how* it works with the parts around it. Professional CAD tools are also expensive and built for designers, not learners.
- **Physical cut-away models are rare.** They are costly and fragile, and in many colleges, polytechnics and ITIs, especially outside big cities, students never get to take a real machine apart.
- **Help is not available when the doubt comes.** Doubts appear late at night, during revision, or alone in a lab, when no teacher is around.
- **Help is rarely in the learner's own language.** Many students think in Telugu or Hindi, but explanations, videos and tools are almost always in English. The language barrier sits on top of the engineering one.
- **Chatbots don't solve it.** A text chatbot can write a paragraph, but it cannot see the part the student is looking at, cannot show anything on the machine, and does not know the actual parts of the model in front of them.

The result: **students can see a machine, but they cannot ask it anything.**

---




## 2. Our Unique Solution

GestureLab CAD makes the machine itself answer. It combines three things that normally live in separate tools (a 3D model, a voice conversation and a teacher's explanation) into one experience in the browser.

### 2.1 How it works: one question, end to end

1. **The learner chooses a part.** They point at it with a finger through an ordinary webcam, click it, or simply name it. The part lights up, and the inspector shows its role, specifications, materials and what it drives, meshes with or supports.
2. **The learner asks out loud**, naturally, the way they would ask a teacher, for example *"What is this connected to and why does that matter?"*. They press the microphone once. The app detects when they start speaking, lets them pause naturally, and stops recording by itself when they finish.
3. **Gnani Prisma listens and detects the language.** The recording is sent to Gnani Prisma (v3.0, automatic Indic language detection). There is no language menu: Prisma detects whether the learner spoke English, Telugu or Hindi, and the exact words appear on screen as **"You asked · Telugu: …"** in the learner's own script, never translated. The names of the model's parts are sent as key terms, so engineering words like *sun gear* or *carrier* are recognised correctly.
4. **The app understands what "this" means.** A deterministic parser resolves the question against what the learner is pointing at, has selected, or was just talking about. Simple requests ("zoom in", "separate the parts", "what is this?") are answered instantly from the model's own data, without any AI call.
5. **The AI teacher plans a lesson grounded in the real model.** For explanations, the backend sends Gemini a fact pack: the model's real parts, roles and relationships, plus the current scene. Gemini writes a short **lesson plan**, where each step pairs one or two spoken sentences with a 3D action (focus a part, highlight the parts it drives, explode the assembly, play the animation).
6. **Every step is checked before it runs.** Actions must come from an allowed list and refer to parts that really exist. They are validated on the server and again in the browser, then executed through the same command system as the mouse, keyboard and gestures. The AI returns data, never code.
7. **Gnani Timbre speaks while the machine moves.** Each step's narration is spoken by Gnani Timbre in the learner's language **at the same moment** its parts light up or move. The answer streams in: the first sentence is spoken while the rest is still being written, so the learner hears the answer within seconds.
8. **The tutor checks understanding.** After an explanation, the tutor asks whether it made sense, offers to explain again, and can ask **two short quiz questions**, evaluating the learner's spoken answers.
9. **The conversation stays natural.** The learner can interrupt at any time by pressing the mic: the current speech stops instantly and no stale answer plays over the new question. Each new question is detected in its own language, so a learner can switch from English to Telugu to Hindi between turns.

### 2.2 What makes it unique: not just another chatbot or tutor

| A chatbot or video tutor… | GestureLab CAD… |
| :--- | :--- |
| answers in text beside a picture | **shows the answer on the machine** while it speaks |
| cannot see what you mean | **knows the part you point at** ("this gear") |
| invents from general knowledge | **answers from the model's real parts data**, and every action is validated |
| needs you to choose a language | **detects English, Telugu or Hindi automatically** and answers in the same language |
| only talks | **checks that you understood** with a short spoken quiz |
| is one more screen to read | is controlled by **voice and hand gestures together** |

**Creative use of Gnani AI (the "jugaad"):** in most apps, speech-to-text is a keyboard and text-to-speech is a loudspeaker. Here, Gnani's voice models are the **controls of a 3D lesson**:

- **Gnani Prisma turns speech into spatial action.** A spoken question becomes a validated action on a real 3D machine, with automatic Indic language detection and part names used as key terms.
- **Gnani Timbre is synchronised with motion.** Each sentence is spoken exactly when its parts are highlighted or the assembly opens, so hearing and seeing happen together.
- **Indian-language learning, as students actually speak.** A Telugu or Hindi question gets a Telugu or Hindi answer, with technical terms kept in English, the way engineering is taught in Indian classrooms.

A laptop, a webcam and Gnani's Indian-language voice models stand in for an expensive cut-away machine and a tutor who speaks the student's language.

### 2.3 Key features

**Interactive 3D learning**
- **Five learning modules:** an epicyclic planetary gearbox and a steam engine (mechanical), a reinforced-concrete building frame and a Warren truss bridge (civil), and the human eye (biology).
- **Exploded view and reassembly:** every part separates into a colour-coded, see-through view with labels, and goes back together in one action.
- **Engineering inspector and assembly tree:** role, specifications, materials and a relationship map (drives, meshes with, supports) for every part; browse, search, select and hide parts.

**Voice tutor (Gnani Prisma + Gemini + Gnani Timbre)**
- **One press to talk:** automatic speech detection, natural pauses allowed, automatic stop, and short replies like *"Yes"*, *"అవును"* or *"हाँ"* are kept, not discarded.
- **Automatic language detection** for English, Telugu and Hindi, with the transcript shown in the original script.
- **Explanation synchronised with the 3D model**, spoken sentence by sentence as it streams in, with smooth pacing and no artificial pauses.
- **Understanding checks:** "does that make sense?", "explain again", and a two-question spoken quiz.
- **Interrupt any time;** stale answers never play over a new question.
- **Honest by design:** each step is labelled *shown in the 3D model*, *from the model data*, *engineering explanation* or *not simulated in this app*. Failures and forces are explained as reasoning, never presented as simulations.
- **Always answers:** if the AI teacher is unavailable, a grounded explanation is built from the model data and plays the same way.
- **Clear error messages:** a muted microphone, a denied permission, a busy device or a service error each has its own clear message, instead of a generic "say it again".

**Hand-gesture control (in the browser, through any webcam)**
- **Open palm** to orbit, **pinch** to zoom, **point and hold** (1.2 s) to select a part, and **two hands pinch-and-spread** to explode or reassemble the model.
- **Voice and gesture together:** point at a part and ask about *"this"*.
- Hand tracking runs **entirely in the browser**: the camera video never leaves the device.

**One safe command system**
- Mouse, keyboard, gestures, voice and the AI teacher all send the **same validated scene commands**, so every input behaves the same way and the AI can only do what a user could do.

### 2.4 Architecture

```
Microphone ─► Browser: recording, speech detection, 16 kHz WAV
                 │
                 ▼
            FastAPI backend (holds all API keys) ─► Gnani Prisma (speech-to-text, language detection)
                 │
           transcript + language
                 ▼
Browser: parser + part resolver (pointed / selected / named / last topic)
     ├─► scene command ─────────────────────────► validated command dispatcher ─► Three.js 3D viewer
     └─► question ─► fact pack (model data + scene) ─► FastAPI ─► Gemini (streamed lesson plan)
                                                                     │
                      validated lesson steps ◄───────────────────────┘
                              │
                              ▼
            Plan player: 3D actions (dispatcher) + narration ─► FastAPI ─► Gnani Timbre (speech)

Webcam ─► MediaPipe Hand Landmarker (in the browser) ─► gestures ─► same command dispatcher
```

- **Security:** the browser never calls Gnani or Gemini directly. All keys stay on the backend and never appear in responses, logs or error messages. There is no login or database, and no recordings are stored.
- **Quality:** 983 automated frontend tests and 222 backend tests. Gnani and Gemini are simulated in the tests, so testing never spends credits.
- **Deployment:** the frontend is hosted on **Vercel**, and the backend on **Render**. Vercel forwards `/api/*` to the backend, so the browser sees one site and the keys stay on the server.

---



## 3. Tech Stack

| Layer | Technology | Used for |
| :--- | :--- | :--- |
| **Frontend** | **React 19**, **TypeScript 6** | The application and its interface |
| | **Vite 8** | Development server and production build |
| | **Three.js** | Real-time 3D rendering, exploded views, highlighting, camera control and animation |
| | **MediaPipe Tasks Vision** (Hand Landmarker) | In-browser hand tracking (21 landmarks per hand) for gesture control |
| | **Web Audio API** | Microphone capture, speech detection and WAV encoding in the browser |
| **Backend** | **Python 3.12**, **FastAPI**, **Uvicorn** | Voice and teaching API; keeps every key on the server |
| | **Requests**, **python-multipart** | Calls to Gnani and Gemini; audio uploads |
| **Speech AI (Gnani AI)** | **Gnani Prisma** (`stt/v3`, Prisma v3.0, automatic Indic language detection) | Speech-to-text in English, Telugu and Hindi, with part names as key terms |
| | **Gnani Timbre** (`timbre-v2.5`) | Natural text-to-speech with a native voice for each language |
| **Reasoning AI** | **Gemini** (`gemini-3.5-flash`, OpenAI-compatible API, streamed JSON) | Lesson plans grounded in the model's data, quiz answer checking |
| **Quality** | **Node test runner**, **pytest**, **oxlint**, TypeScript type checking | Automated tests, linting and type checking |
| **Hosting** | **Vercel** (frontend), **Render** (backend) | Public deployment over HTTPS (required for microphone and camera access) |

---

## 4. Main Users

**Primary users**
- **Mechanical and civil engineering students** meeting a machine or structure for the first time: gear trains, engines, frames, trusses.
- **Diploma, polytechnic and ITI students**, who learn machine elements and mechanisms hands-on but often lack access to cut-away models and labs.
- **Students who learn best in their own language:** learners who think in Telugu or Hindi and can now ask and hear answers in the same language, with technical terms kept in English.
- **Self-learners revising alone**, who need an answer at the moment the doubt appears, not the next day.

**Secondary users**
- **Teachers and technical trainers**, who can demonstrate a machine to a whole class with a laptop and a projector, controlling it by voice or gesture instead of standing at a keyboard.
- **Colleges and training centres with limited lab budgets**, which can offer an interactive 3D lab with nothing more than a browser, a webcam and a microphone.
- **Biology and science learners**, through the human eye module, and **science fairs and exhibitions**, where touchless gesture and voice control works well.

**Why it scales:** a new subject is simply a new 3D model with its parts data. The tutor, voice, gestures and validation work on it unchanged. And because Gnani's voice models cover many Indian languages, more languages are the natural next step after English, Telugu and Hindi.

---




## 5. Conclusion

GestureLab CAD starts from a simple observation: **students can see a machine, but they cannot ask it anything.** Our answer is to make the machine itself the teacher. The learner points at a part, asks in their own words and their own language, and the machine responds: the right parts light up and move while a natural voice explains, step by step, and then checks that they understood.

What makes this possible is a creative use of Gnani AI. **Gnani Prisma** does more than transcribe: it detects the learner's language automatically and turns a spoken question into an action on a real 3D model. **Gnani Timbre** does more than read text aloud: it speaks each sentence exactly when its parts appear, in English, Telugu or Hindi. Together with a lesson planner grounded in real model data, a strict validation layer and in-browser hand tracking, the result is **not another chatbot, but an interactive engineering tutor**.

It runs on hardware every student already has: a laptop, a webcam and a browser. GestureLab CAD is a working prototype; it has not yet been deployed in colleges or evaluated in a classroom study. But it shows what learning could look like when every student can ask *why*, and hear the answer in their own language.

> **Every student deserves to ask *why*. GestureLab CAD lets them ask the machine itself.**

------------------------------------------------------------------------------------------------

## LIVE WEB:

https://3dexplodeview-frontend.vercel.app/

## DEMO LINK

https://drive.google.com/file/d/1MLg2I3ydJhqdjJDC1ZDeKl-2RdqIB8-7/view?usp=sharing




----------------------------------------------------------------------------------------------

*Built with **Gnani Prisma** and **Gnani Timbre** · Great Indian AI Internship Challenge 2026 · Jugaad Genius Award entry · #GreatIndianAIInternshipChallenge #GnaniAI*
