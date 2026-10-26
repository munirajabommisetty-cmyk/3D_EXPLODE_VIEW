# Gesture-Controlled 3D Machine Explorer

An interactive web application enabling touchless exploration and inspection of 3D mechanical assemblies using hand gestures captured through a standard consumer webcam.

---

## 📌 Current Project Status

- **Current Phase**: **Phase 6: Testing, Performance Evaluation & Reliability (Task 6.1 Complete, Task 6.2 Telemetry Engine Complete)**
- **Application Status**: Task 6.2 (Latency & Framerate Benchmarking Engine) is **Implemented**. The project features a typed, memory-bounded performance telemetry service (`telemetry.ts`) tracking WebGL render FPS, frame-time statistics (min/max/avg/P95), vision inference and temporal smoothing durations, tracking FPS, and application-level pipeline latency without GC pauses or loop overhead. Complete benchmarking protocols and metric formulas are documented in `docs/BENCHMARKS.md` (physical hardware measurements remain pending).
- **Verification**: 129 automated unit and integration tests across 27 suites (`npm test` in `frontend/` or `node tests/test_frontend/run_tests.mjs` at repository root), lint (`oxlint`), and production build (`tsc -b && vite build`) all pass with 0 errors and 0 warnings.
- **Next Task**: **Phase 6, Task 6.2 Physical Benchmark Execution & Task 6.3: Lighting & Occlusion Edge-Case Hardening**.

---

## 🎯 Planned Capabilities (Design Targets)

> [!NOTE]
> The capabilities below describe the **intended design targets**, not yet implemented functionality:

- **Browser-Based 3D Mechanical Viewer**: Interactive rendering of a multi-part mechanical assembly (e.g. planetary gearbox, engine) using Three.js.
- **Real-Time Hand Tracking**: Pretrained MediaPipe Hand Landmarker detecting 21 3D landmarks via webcam.
- **Geometric Gesture Recognition**:
  - `Open Palm`: Natural orbital rotation of the 3D model.
  - `Pointing`: Screen-space raycasting cursor to hover and select mechanical components.
  - `Pinch`: Camera zoom / dolly and inspection triggers.
- **Component Inspection HUD**: Interactive sidebar displaying engineering specifications (materials, gear ratios, operational speeds) of selected parts.
- **Offline ML Gesture Experiments (Future Phase 7)**: Dataset recording and training pipeline in Python to compare heuristic rules against custom machine learning classifiers.
- **Local AI Explainer (Future Phase 8)**: Optional context-aware engineering explanations powered by local open-weight models (e.g. Ollama `llama3.2:3b`) without paid cloud APIs.

---

## 📚 Documentation Index

All planning, architectural, and design specifications are cataloged below:

| Document | Description |
| :--- | :--- |
| **[docs/PRD.md](docs/PRD.md)** | Product Requirements Document: problem statement, personas, MVP vs. future scope, and acceptance criteria. |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | System architecture, browser-first MVP strategy, module responsibilities, coordinate transforms, and event interfaces. |
| **[docs/DESIGN.md](docs/DESIGN.md)** | Visual design principles, UI layout, screen wireframes, component inspection panel, and application states. |
| **[docs/RULES.md](docs/RULES.md)** | Engineering and collaboration rules governing AI pair programming and code safety. |
| **[docs/TASKS.md](docs/TASKS.md)** | **Single source of truth** for incremental tasks across Phases 0 through 8 with explicit dependencies and verification criteria. |
| **[docs/TEST_PLAN.md](docs/TEST_PLAN.md)** | Testing strategy covering automated unit/component tests, manual webcam protocols, and failure edge-cases. |
| **[docs/BENCHMARKS.md](docs/BENCHMARKS.md)** | Performance benchmark specifications, telemetry metric formulas, targets, and measurement protocols. |
| **[docs/SECURITY.md](docs/SECURITY.md)** | Security and privacy guarantees: 100% local video processing, zero camera data transmission, and secret management. |
| **[docs/DECISIONS.md](docs/DECISIONS.md)** | Architectural Decision Records (ADRs) logging technology choices, evaluated alternatives, and open proposals. |
| **[DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)** | High-level phased roadmap aligned directly with `docs/TASKS.md`. |

---

## 🛠️ Repository Layout

```
CV_3D_GESTURE/
├── docs/                           # Central planning and specification documents
│   ├── PRD.md                      # Product Requirements Document
│   ├── DESIGN.md                   # UI layout and visual design specification
│   ├── RULES.md                    # AI development rules and guidelines
│   ├── TASKS.md                    # Detailed task breakdown (source of truth)
│   ├── TEST_PLAN.md                # Automated and manual verification strategy
│   ├── SECURITY.md                 # Privacy and security policies
│   └── DECISIONS.md                # Architectural Decision Records (ADRs)
├── frontend/                       # React + TypeScript + Three.js web application (scaffold)
├── hand_tracker/                   # Python vision pipeline (deferred/scaffold)
├── backend/                        # FastAPI & WebSocket server (deferred/scaffold)
├── experiments/                    # ML experiment sandbox and landmark datasets
│   ├── data/                       # Raw and processed landmark records
│   └── models/                     # Saved classifier weights (.pkl, .onnx)
├── assets/                         # 3D models (GLTF/GLB) and static media
│   └── models_3d/                  # Mechanical assembly meshes
├── tests/                          # Automated test suites
├── .gitignore                      # Multi-stack ignore rules (Python, Node, ML artifacts)
├── .env                            # User environment configuration (preserved)
├── ipy_kernel.ipynb                # User exploratory notebook (preserved)
├── README.md                       # Project index and documentation portal
├── ARCHITECTURE.md                 # System architecture and data flow
└── DEVELOPMENT_PLAN.md             # Phased implementation roadmap
```

---

## 🔍 Phase 0 Verification on Windows

In this planning phase, only documentation and repository structure are established. To inspect the planning artifacts:

```powershell
# Navigate into the project folder
cd c:\Users\munir\Music\folder1\CV_3D_GESTURE

# List all documentation and scaffold files
Get-ChildItem -Recurse -File | Select-Object FullName
```
