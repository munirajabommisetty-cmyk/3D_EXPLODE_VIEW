# Architectural Decision Records (ADRs)

## Project: Gesture-Controlled 3D Machine Explorer

This document logs significant architectural choices, evaluated alternatives, statuses, and open questions.

---

## Decision Status Summary

| ADR ID | Decision Title | Status | Proposed Direction |
| :---: | :--- | :---: | :--- |
| **ADR-001** | Frontend Framework Selection | **Proposed** | React 18+ with TypeScript and Vite |
| **ADR-002** | 3D Rendering Library & Scene Architecture | **Proposed** | Three.js with dedicated Canvas controller |
| **ADR-003** | Hand-Landmark Detection Runtime Location | **Under Review** | Browser-native MediaPipe Tasks Vision Web SDK for MVP |
| **ADR-004** | Gesture Recognition Methodology | **Accepted** | Rule-Based Geometric Heuristics first; ML experiments later |
| **ADR-005** | Backend Necessity for MVP | **Proposed** | No backend for MVP; introduce Python FastAPI in Phase 7/8 |
| **ADR-006** | AI / LLM Feature Inclusion & Hosting | **Proposed** | Deferred to Phase 8; strictly local Ollama, no paid APIs |

---

## Detailed Records

### ADR-001: Frontend Framework Selection
- **Status**: **PROPOSED**
- **Context**: The application requires responsive UI overlays (HUD, PiP video player, component inspection sidebar, telemetry indicators) synchronized with an active WebGL canvas.
- **Alternatives Considered**:
  1. *Vanilla HTML/CSS/JavaScript*: Maximum lightweight, zero build tooling. Disadvantage: State synchronization between HUD panels, dwell timers, and component metadata becomes difficult to scale.
  2. *React + TypeScript + Vite*: Component-driven HUD, strong ecosystem, strict static typing for complex landmark structures, rapid HMR during 3D scene authoring.
- **Proposed Decision**: Use **React + TypeScript + Vite**. TypeScript interfaces guarantee that landmark and gesture event schemas remain strictly typed across UI and graphics boundaries.

---

### ADR-002: 3D Rendering Library & Scene Architecture
- **Status**: **PROPOSED**
- **Context**: The core feature is high-performance 3D rendering of a multi-part mechanical assembly with raycasting and orbit control.
- **Alternatives Considered**:
  1. *Vanilla Three.js*: Full imperative control over render loop, matrix transforms, memory disposal, and raycasting.
  2. *React Three Fiber (R3F) + Drei*: Declarative JSX scene graph. Convenient for basic scenes, but adds an extra abstraction layer over Three.js's low-level matrix manipulation required for custom gesture cameras.
  3. *Babylon.js*: Feature-rich, but larger bundle size and steeper learning curve.
- **Proposed Decision**: Use **Three.js directly within a managed React Canvas component**. This gives absolute control over the 60 FPS animation loop, raycaster, and custom gesture-driven camera matrices while keeping the HUD in declarative React.

---

### ADR-003: Hand-Landmark Detection Runtime Location
- **Status**: **UNDER REVIEW / PROPOSED FOR MVP**
- **Context**: Hand detection can execute either entirely inside the browser via WebAssembly/WebGL or in an external Python service streaming via WebSockets.
- **Alternatives Considered**:
  1. *In-Browser MediaPipe Web SDK (`@mediapipe/tasks-vision`)*:
     - *Pros*: Zero external backend processes, zero loopback latency, zero port conflicts on Windows, seamless zero-install deployment.
     - *Cons*: Slightly higher CPU/GPU load on the browser tab; model download on first visit (~10MB Wasm/TFLite).
  2. *Python Service (OpenCV + MediaPipe Python + FastAPI WebSocket)*:
     - *Pros*: Native Python performance; straightforward integration with scikit-learn for Phase 7.
     - *Cons*: User must run two processes concurrently; network serialization latency; WebSocket connection drops.
- **Proposed Decision**: Adopt **In-Browser MediaPipe Web SDK for Phases 1–5 (MVP)**. Reserve the Python pipeline for Phase 7 (Custom ML Experimentation) and Phase 8 (Local LLM Bridge).

---

### ADR-004: Gesture Recognition Methodology
- **Status**: **ACCEPTED**
- **Context**: Interpreting hand landmarks into actions (rotate, zoom, select).
- **Decision**: Start with **deterministic geometric heuristic rules** for the MVP:
  - *Open Palm*: All finger tips extended beyond intermediate joints.
  - *Pointing*: Index tip extended, other digits folded.
  - *Pinch*: Euclidean distance between thumb tip and index tip $< \text{threshold}$.
- **Rationale**: Geometric rules are explainable, require zero training data, run in microseconds, and are easy to debug and tune. Machine learning classifiers will be explored as an experimental comparative study in Phase 7.

---

### ADR-005: Backend Necessity for MVP
- **Status**: **PROPOSED**
- **Context**: The user requirements mention FastAPI and WebSockets, but emphasize: *"FastAPI and WebSockets, introduced only when required... Evaluate whether a separate Python backend and WebSocket connection are genuinely necessary for the MVP."*
- **Proposed Decision**: **Do NOT introduce a backend for the initial MVP**.
- **Rationale**: An all-in-browser architecture delivers the entire MVP (3D visualization, webcam tracking, gesture interpretation, component inspection) with lower latency, zero multi-process friction, and simpler debugging. A backend will be introduced in Phase 7/8 when Python ML training and local LLM orchestration genuinely demand it.

---

### ADR-006: AI / LLM Feature Inclusion & Hosting
- **Status**: **PROPOSED**
- **Context**: Evaluating whether and how an LLM should provide mechanical component explanations.
- **Decision**: **Exclude from MVP; defer to Phase 8 as an optional enhancement**.
- **Rationale**: An LLM is not needed to explore 3D machinery or test gesture recognition. When introduced in Phase 8, it must use a local open-weight model (e.g. Ollama running `llama3.2:3b`, as tested in `ipy_kernel.ipynb`) to satisfy the requirement: *"Do not require a paid LLM API for the initial application."*
