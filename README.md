# GestureLab: Gesture-Controlled 3D Machine Explorer

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
| Speech | Gnani speech-to-text and text-to-speech |
| Tutor | An OpenAI-compatible LLM endpoint (Gemini by default) |

---

