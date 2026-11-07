# GestureLab: Gesture-Controlled 3D Machine Explorer

**From static diagrams to interactive exploration**, for students, educators and curious learners.

An interactive engineering-education web app. Learners explore real machines, structures and anatomy in 3D, take them apart with an exploded view, control them with hand gestures from an ordinary webcam, and ask a voice tutor how each part works, in English, Telugu or Hindi.

---

## 🧩 The Problem

Engineering and science students learn how machines and structures work mostly from **flat textbook diagrams and static slides**. That creates real gaps:

- **Hard to visualise in 3D.** A planetary gearbox or a steam locomotive is difficult to understand from a 2D cross-section: how parts mesh, move and connect stays abstract.
- **Physical models are expensive and limited.** Cut-away models and lab equipment are costly, fragile and shared by many students, and most learners never get to take a real machine apart.
- **CAD tools are built for designers, not learners.** Professional CAD software is costly, complex and explains nothing about *why* a part exists.
- **Questions go unanswered.** Outside the classroom there is no one to ask "why is this part needed?" or "what happens if it fails?", and help in a student's own language is rare.
- **Mouse-and-keyboard only.** Demonstrating a model in a classroom, lab or exhibition means standing at a computer instead of interacting naturally.

## 💡 Our Solution

GestureLab turns the browser into a **hands-on 3D engineering lab with a built-in tutor**:

| Problem | How GestureLab solves it |
| :--- | :--- |
| Hard to visualise in 3D | Realistic, interactive 3D models you can orbit, zoom and inspect from any angle (Three.js). |
| Can't take real machines apart | **Exploded view**: every part separates into a colour-coded, see-through X-ray view with labels, then **reassembles** in one click. |
| CAD tools explain nothing | An **inspector** for every part: its role, specifications, materials and how it connects to other parts, all from the model's own data. |
| No one to ask | A **voice tutor** that answers spoken questions and explains step by step while it highlights the parts on the model. |
| Language barrier | Ask and listen in **English, Telugu or Hindi** (Bengali in beta). |
| Mouse-only interaction | **Touchless hand-gesture control** through a standard webcam: open palm to orbit, pinch to zoom, point and hold to select, and two hands to explode or reassemble. Mouse, keyboard and voice always work too. |
| Cost and access | Runs in a normal web browser. Hand tracking runs **locally in the browser**, so video never leaves the device. |

---

## 🎯 Major Use Cases

### 1. Self-study for engineering students
A mechanical or civil engineering student opens the planetary gearbox, explodes it, selects the sun gear and asks *"How does it work?"*. The tutor explains step by step while highlighting the gears that mesh with it.

### 2. Classroom and lab demonstrations
A teacher projects a model and controls it with hand gestures from the front of the room, rotating, zooming and separating the parts without going back to the keyboard.

### 3. Learning in a regional language
A student who is more comfortable in Telugu or Hindi asks questions aloud in that language and hears the explanation in the same language.

### 4. Understanding how parts depend on each other
Using the inspector's relationship view, a learner sees which parts drive, mesh with or support a selected part, and can ask *"What happens if it fails?"*.

### 5. Seeing inside structures and anatomy
Cutaway and section views reveal hidden internals: the inside of a steam engine, the reinforcement in a concrete frame, or the internal structures of the human eye.

### 6. Exhibitions, museums and science fairs
A touchless, gesture-driven display lets visitors explore a machine without touching shared hardware.

### 7. Accessible, low-cost access to engineering models
Schools and colleges without physical cut-away models can give every student the same interactive model on an ordinary laptop with a webcam.

---

## 🧱 Learning Modules

| Module | Field | What you can explore |
| :--- | :--- | :--- |
| **Epicyclic Planetary Gearbox** | Mechanical | Sun, planet and ring gears, carrier and drive shaft; how gears mesh and transmit power. |
| **Steam Engine Explorer** | Mechanical | A steam locomotive: boiler, steam circuit, cylinders and moving parts, with animation speed control and a cutaway. |
| **Reinforced Concrete Structural System Explorer** | Civil | Columns, beams and slabs, a section view, the reinforcement only, and an illustrative load path. |
| **Warren Truss Bridge** | Civil | Truss members and how the structure carries load. |
| **Human Eye Explorer** | Anatomy | Real eye structures, with a cutaway to see inside. |

---

## ✨ Key Features

- **Interactive 3D viewer**: realistic materials, view presets (isometric, top, front), auto-rotate, grid and model-specific learning views.
- **Exploded view and reassembly**: from the toolbar, the **X** key, a voice command or a two-hand gesture.
- **Hand-gesture control** (MediaPipe Hand Landmarker, 21 landmarks per hand):
  - **Open palm**: orbit the model
  - **Pinch**: zoom
  - **Point and hold**: select a part
  - **Two hands**: pinch, then spread to explode; pinch again to reassemble
- **Voice tutor**: speech-to-text, step-by-step teaching plans grounded in the model's own data, and spoken answers. Steps that cannot be shown safely on the model are skipped rather than invented.
- **Engineering inspector**: overview, specifications, materials and a component relationship map for every part.
- **Assembly tree**: browse, search, select and hide parts.
- **One validated command system**: mouse, keyboard, gestures and voice all send the same checked scene commands, so every input method behaves the same way.
- **Responsive, accessible interface**: works from desktop down to phone width, with keyboard shortcuts, accessible labels and reduced-motion support.

---

## ⚙️ How It Works

```
Webcam ──► MediaPipe hand tracking (in the browser) ──► gesture recognition ──┐
Mouse / keyboard ─────────────────────────────────────────────────────────────┼──► validated scene commands ──► Three.js 3D viewer
Microphone ──► FastAPI backend ──► speech-to-text ──► command / question ─────┘
                                     │
                                     └──► LLM teaching plan ──► step-by-step explanation + text-to-speech
```

| Layer | Technology |
| :--- | :--- |
| Frontend | React 19, TypeScript, Three.js, Vite |
| Hand tracking | MediaPipe Tasks Vision (runs locally in the browser) |
| Backend | Python, FastAPI (voice and teaching API) |
| Speech | **Gnani Prisma** (speech-to-text) and **Gnani Timbre** (text-to-speech) |
| Tutor | **Gemini**, via an OpenAI-compatible client |

---

## 🏆 Creative Use of Gnani AI (Jugaad Genius)

Most apps use speech-to-text and text-to-speech as a microphone and a loudspeaker. In GestureLab, **Gnani's voice models drive a 3D engineering lesson**:

1. **Your voice becomes a 3D action.** Gnani Prisma turns a spoken question, such as *"What happens if I remove this gear?"*, into text in English, Telugu or Hindi, including mixed Telugu-English or Hindi-English. A deterministic parser maps it to the part you selected or are pointing at with your hand.
2. **The answer is a lesson plan, not a paragraph.** Gemini writes a plan in which every step pairs a sentence with a 3D action ("highlight the Sun Gear and Planet Gear A"). Every action is checked against the model's real parts and relationships before it runs.
3. **Gnani Timbre speaks each step while the model moves.** Each sentence is spoken in the learner's language at the moment its parts light up, so the learner hears and sees the same idea together.
4. **Voice and hands work together.** Point at a part with your finger, then just say *"Explain this"*. Speaking again interrupts the tutor immediately.

**Why this is "jugaad":** an ordinary laptop, a webcam and Gnani's Indian-language voice models replace an expensive cut-away machine model and a tutor who speaks the student's language.

### Where each Gnani model is used

| Gnani model | Code | What it does |
| :--- | :--- | :--- |
| **Prisma (STT)** | `backend/app/gnani.py` → `transcribe()`, called by `POST /api/voice/transcribe` | Spoken question → text, with an engineering-vocabulary bias list, auto language detection (en / te / hi) |
| **Timbre (TTS)** | `backend/app/gnani.py` → `synthesize()`, called by `POST /api/voice/speak` | Every reply and every lesson step is spoken in the conversation language; long answers are spoken sentence by sentence as they stream in |

The Gnani API key stays on the server. The browser only talks to this backend.

---

## 🎬 Demonstration for Judges: "Understand a Gearbox Through Voice and 3D"

About 3 minutes, using only the app (no code or data changes).

| # | Do this | What you see and hear |
| :--- | :--- | :--- |
| 1 | Open the app → **Explore the models** → **Planetary Gearbox** | The realistic 3D gearbox |
| 2 | Press **M** and say *"Can you explain how this gearbox works?"* | **Prisma** transcript appears ("You asked"). The tutor walks the drive path one link at a time: *Sun Gear drives Planet Gear A* → those two gears light up and are listed under "Shown in the 3D model". The parts then separate to show how they fit together. **Timbre** speaks each step. A step bar shows progress. |
| 3 | Wait for the end | The assembly goes back together by itself, and follow-up questions appear as buttons |
| 4 | Click the **Sun Gear** (or turn on the camera, **point at it and hold for 1.2 s**) | The tutor bar says "Sun Gear selected — tap the mic and ask about it", and the suggestions change to that part |
| 5 | Press **M** and say *"What happens if I remove this gear?"* | Focus on the Sun Gear, then the parts that depend on it are highlighted. Each step is labelled *Engineering explanation* or *Not simulated in this app*, so nothing is overclaimed. |
| 6 | Say *"What is this connected to?"* | The recorded neighbours (Primary Drive Shaft, Planet Gears A–C) light up and are named |
| 7 | While it is speaking, press **M** again and ask something new | It stops talking at once and answers the new question |
| 8 | Ask in **Telugu**: *"సన్ గేర్ ఎలా పనిచేస్తుంది?"* | Prisma detects Telugu; the answer is spoken in Telugu by Timbre |
| 9 | Gesture: **two hands, pinch then spread** (or press **X**) | The model separates; **Reassemble** puts it back |

Every suggestion can also be **clicked** instead of spoken (same path, minus speech-to-text), which helps in a noisy hall.

---

## 🚀 Running the Project

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

Settings go in `backend/.env` (never committed): `GNANI_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`. Check that port 8000 is free first. Without the backend, the 3D viewer, gestures and the model-data tutor still work, but nothing is spoken.

---

## ✅ Verification Status

| Area | Status |
| :--- | :--- |
| 3D viewer, explode / reassemble, inspector, assembly tree, gestures (logic) | Automated tests (873 frontend tests passing) + browser checks |
| Voice turn routing: parser, part resolution (selected / pointed / named), follow-ups, interruption guards | Automated tests with simulated Prisma and Timbre |
| Explanation → 3D sync: highlights, separated view, assembly restored at the end | Automated tests with the real plan player; checked in the browser using the model-data tutor |
| Gemini teaching plans | Backend tests with a simulated LLM (no live calls during testing) |
| **Live Gnani Prisma / Timbre and live Gemini calls** | **Need a live run with real keys before recording.** These were not called during testing, to avoid using credits. |

---

