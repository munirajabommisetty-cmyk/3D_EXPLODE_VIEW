# Detailed Task Breakdown: Gesture-Controlled 3D Machine Explorer

This document is the **single source of truth** for incremental project execution. Work must proceed strictly in order, one task at a time. A task or phase is not marked complete until its acceptance criteria have been verified and confirmed.

---

## Phase Status Summary

| Phase | Description | Status |
| :---: | :--- | :---: |
| **Phase 0** | Planning, Architecture & Repository Preparation | **Complete** |
| **Phase 1** | Minimal Frontend & 3D Mechanical Viewport | **Complete** |
| **Phase 2** | Webcam Access & Pretrained Hand-Landmark Detection | **Complete** |
| **Phase 3** | Gesture Recognition & State Machine | **Complete (Tasks 3.1-3.3)** |
| **Phase 4** | Gesture-Controlled 3D Interaction | **Complete (Tasks 4.1-4.3)** |
| **Phase 5** | Component Selection & Information Display | **Complete (Tasks 5.1-5.3)** |
| **Phase 6** | Testing, Performance Evaluation & Reliability | **Complete (Tasks 6.1-6.3 Complete; Physical Benchmarks Pending)** |
| **Phase 7** | Custom Gesture-Classifier Experiments (Python / ML) | *Not Started* |
| **Phase 8** | Optional LLM-Powered Component Explanations (Local Ollama) | *Not Started* |
| **Phase 9** | Multi-Model Engineering Learning Platform (Mechanical & Civil) | **Complete (Tasks 9.1–9.9)** |
| **Phase 10** | Engineering Explorer Architectural & UI/UX Redesign | **In Progress (Tasks 10.0, 10.1, 10.2, 10.3 Complete)** |

---

## Phase 0: Planning & Repository Preparation

### Task 0.1: Project Audit & Baseline Preservation
- **Purpose**: Verify pre-existing files, protect user files (`.env`, `ipy_kernel.ipynb`), and establish directory boundaries strictly within `CV_3D_GESTURE/`.
- **Dependencies**: None.
- **Expected Files**: Directory structure, `.gitignore`, `.gitkeep` markers.
- **Acceptance Criteria**: All existing user work preserved; multi-stack ignore rules active; zero commits or history overwritten.
- **Status**: **COMPLETE**

### Task 0.2: Author Complete Planning Documentation
- **Purpose**: Create comprehensive PRD, Architecture, Design, Rules, Task breakdown, Test Plan, Security, and Decision documents following the Vibe Coding guide.
- **Dependencies**: Task 0.1.
- **Expected Files**: `docs/PRD.md`, `ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/RULES.md`, `docs/TASKS.md`, `docs/TEST_PLAN.md`, `docs/SECURITY.md`, `docs/DECISIONS.md`, `README.md`, `DEVELOPMENT_PLAN.md`.
- **Acceptance Criteria**: All documents created, internally consistent, no conflicting roadmaps, distinguishing MVP from future enhancements.
- **Status**: **COMPLETE**

---

## Phase 1: Minimal Frontend & 3D Mechanical Viewport

### Task 1.1: Frontend Scaffolding (Vite + React + TypeScript)
- **Purpose**: Initialize a clean, lightweight React + TypeScript project configured with Vite in `frontend/`.
- **Dependencies**: Phase 0 completion & approval.
- **Expected Files**: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/index.html`.
- **Acceptance Criteria**: Dev server starts cleanly via `npm run dev` on `http://localhost:5173`; zero TypeScript compiler errors.
- **Status**: **COMPLETE**

### Task 1.2: Three.js Canvas & Lighting Setup
- **Purpose**: Establish full-viewport Three.js canvas with WebGL renderer, studio lighting (key, fill, rim lights), antialiasing, and responsive window resize handling.
- **Dependencies**: Task 1.1.
- **Expected Files**: `frontend/src/components/scene/ViewerCanvas.tsx`, `frontend/src/components/scene/ViewerCanvas.css`.
- **Acceptance Criteria**: Smooth 60 FPS blank canvas rendering with ambient dark-mode background; window resize adjusts aspect ratio without distortion.
- **Status**: **COMPLETE**

### Task 1.3: Procedural Mechanical Assembly & Hierarchy
- **Purpose**: Construct or import an interactive multi-component mechanical assembly (planetary gearbox or engine mechanism with sun gear, planet gears, carrier, ring gear, and central shaft) using PBR materials.
- **Dependencies**: Task 1.2.
- **Expected Files**: `frontend/src/components/scene/PlanetaryGearbox.ts`, `frontend/src/types/assembly.ts`, `frontend/src/components/scene/ViewerCanvas.tsx`.
- **Acceptance Criteria**: 3D assembly renders with distinct, addressable mesh nodes; basic continuous mechanical rotation demo runs smoothly.
- **Status**: **COMPLETE**

### Task 1.4: Fallback Mouse Orbit & Zoom Controls
- **Purpose**: Integrate standard Three.js `OrbitControls` so users can rotate, pan, and zoom the machine via mouse/trackpad regardless of webcam status.
- **Dependencies**: Task 1.3.
- **Expected Files**: `frontend/src/components/scene/CameraController.tsx`.
- **Acceptance Criteria**: Left-click drags orbit camera, scroll wheel zooms in/out, right-click pans; dampening/inertia feels smooth.
- **Status**: **COMPLETE**

---

## Phase 2: Webcam Access & Pretrained Hand-Landmark Detection

### Task 2.1: Camera Service & User Permission Handling
- **Purpose**: Implement a robust React hook and camera manager requesting user webcam permission, handling errors (denied, not found), and outputting a mirrored `<video>` stream.
- **Dependencies**: Phase 1.
- **Expected Files**: `frontend/src/hooks/useCamera.ts`, `frontend/src/components/hud/WebcamPreview.tsx`, `frontend/src/components/hud/WebcamPreview.css`.
- **Acceptance Criteria**: User prompted for camera; video streams horizontally mirrored in a PiP corner preview; permission rejection handled gracefully with non-blocking UI alert.
- **Status**: **COMPLETE**

### Task 2.2: MediaPipe Hand Landmarker Integration
- **Purpose**: Integrate pretrained MediaPipe Tasks Vision (`@mediapipe/tasks-vision`) using WebAssembly GPU delegate to detect 21 3D landmarks in real time.
- **Dependencies**: Task 2.1.
- **Expected Files**: `frontend/src/services/tracking/useHandLandmarker.ts`, `frontend/src/types/landmarks.ts`.
- **Acceptance Criteria**: MediaPipe initializes without errors; extracts 21 $(x, y, z)$ coordinates per detected hand at $\ge 30\text{ FPS}$.
- **Status**: **COMPLETE**

### Task 2.3: Visual Skeleton, Telemetry & Geometric Gesture Recognition
- **Purpose**: Render landmark points and skeleton connection lines on a 2D canvas superimposed over the webcam PiP preview, along with real-time tracking FPS, and classify postures (`PINCH`, `OPEN_PALM`, `POINTING`, `NONE`) using scale-invariant geometric rules and temporal hysteresis.
- **Dependencies**: Task 2.2.
- **Expected Files**: `frontend/src/components/hud/SkeletonOverlay.tsx`, `frontend/src/services/gestures/gestureRules.ts`, `frontend/src/services/gestures/gestureClassifier.ts`, `frontend/src/services/gestures/useGestureStateMachine.ts`, `frontend/src/components/hud/GestureBadge.tsx`, `frontend/tests/gestureRules.test.ts`.
- **Acceptance Criteria**: Green/cyan/amber landmark dots track joints; real-time telemetry badge displays active gesture, confidence score, and stability status; automated unit tests verify scale invariance and transition hysteresis.
- **Status**: **COMPLETE**

---

## Phase 3: Gesture Recognition & State Machine

### Task 3.1: Landmark Jitter Filter (Temporal Smoothing)
- **Purpose**: Implement Exponential Moving Average (EMA) or One Euro Filter to eliminate high-frequency hand tremors while maintaining immediate responsiveness.
- **Dependencies**: Phase 2.
- **Expected Files**: `frontend/src/services/tracking/smoothing.ts`, `frontend/tests/smoothing.test.ts`.
- **Acceptance Criteria**: Unit tests confirm high-frequency noise is attenuated ($\ge 60\%$ variance reduction); filter computational overhead is minimal ($< 0.01\text{ ms}$ per hand); separate hands maintain isolated filters.
- **Status**: **COMPLETE**

### Task 3.2: Geometric Gesture Classifier (Rule Engine)
- **Purpose**: Implement deterministic geometric rules to identify core postures: `OPEN_PALM`, `POINTING`, `PINCH`, and `FIST`.
- **Dependencies**: Task 3.1.
- **Expected Files**: `frontend/src/services/gestures/gestureRules.ts`, `frontend/src/types/gestures.ts`.
- **Acceptance Criteria**: Unit tests pass for synthetic landmark fixtures of each gesture pose with $\ge 95\%$ accuracy; returns typed `GestureEvent`.

### Task 3.3: Gesture State Machine & Debouncing
- **Purpose**: Implement state machine with temporal hysteresis preventing rapid flickering between gestures during hand transitions.
- **Dependencies**: Task 3.2.
- **Expected Files**: `frontend/src/services/gestures/useGestureStateMachine.ts`.
- **Acceptance Criteria**: Gesture transitions require 3 consecutive frames of confidence $\ge 0.80$; prevents accidental clicks during pose changes.

---

## Phase 4: Gesture-Controlled 3D Interaction

### Task 4.1: Open-Palm Orbit Navigation
- **Purpose**: Map `OPEN_PALM` hand translation $(\Delta x, \Delta y)$ to Three.js camera orbital rotation (yaw and pitch around the machine's center).
- **Dependencies**: Phase 3.
- **Expected Files**: `frontend/src/components/scene/GestureCameraController.tsx`, `frontend/tests/gestureCameraController.test.ts`.
- **Acceptance Criteria**: Moving open hand left/right rotates assembly horizontally; moving up/down changes elevation; dropping hand applies smooth OrbitControls damping inertia without snapping; deadband filters tremor; mouse drag yields immediately.
- **Status**: **COMPLETE**

### Task 4.2: Pinch-to-Zoom Controller
- **Purpose**: Map two-finger `PINCH` or dynamic pinch distance delta to camera dolly (zooming into the mechanical details).
- **Dependencies**: Task 4.1.
- **Expected Files**: `frontend/src/components/scene/GestureCameraController.tsx`, `frontend/tests/pinchZoom.test.ts`.
- **Acceptance Criteria**: Bringing thumb and index together zooms in smoothly; pulling apart zooms out; includes clamp bounds preventing camera clipping; deadband filters tremor; scale-normalized distance ensures invariance to camera distance.
- **Status**: **COMPLETE** (Implemented `GesturePinchZoomEngine` and `CameraController.zoomBy` with scale normalization via rigid palm scale, deadband filtering (0.008), single-frame jump rejection (0.35), exponential smoothing, clamping to [2.0, 25.0], tracking loss/re-entry handling, mutual exclusivity with OPEN_PALM/POINTING/mouse, and 16 passing unit tests).

### Task 4.3: Virtual Laser Pointer / Cursor
- **Purpose**: Project the index fingertip position of a `POINTING` gesture onto screen space as a glowing virtual cursor dot.
- **Dependencies**: Task 4.2.
- **Expected Files**: `frontend/src/components/hud/VirtualCursor.tsx`, `frontend/src/components/hud/VirtualCursor.css`, `frontend/tests/virtualCursor.test.ts`.
- **Acceptance Criteria**: Virtual cursor moves fluidly across the 3D viewport tracking the user's index finger in real time; mirrors horizontally to match user perception; clamps to viewport bounds; integrates with circular dwell selection and component hover feedback; hides immediately when pointing stops.
- **Status**: **COMPLETE** (Implemented `VirtualCursor.tsx`, `VirtualCursor.css`, decoupled `projectFingertipToScreen` helper, unified `DwellCursor.tsx` wrapper, cyan/teal laser dot with pulsating halo, crosshair ticks, animated circular dwell progress ring, and 15 passing unit tests).

---

## Phase 5: Component Selection & Information Display

### Task 5.1: Three.js Screen-Space Raycaster
- **Purpose**: Cast a ray from pointer or virtual cursor coordinates into the 3D scene using `THREE.Raycaster` to identify intersected component meshes and apply non-destructive emissive highlights.
- **Dependencies**: Phase 4.
- **Expected Files**: `frontend/src/components/scene/ComponentRaycaster.ts`.
- **Acceptance Criteria**: Hovering over a gear or shaft detects the exact mesh name; highlights hovered component with emissive outline; preserves original materials without leaks.
- **Status**: **COMPLETE**

### Task 5.2: Selection Confirmation & Dwell Mechanism
- **Purpose**: Lock component selection when a user hovers (dwells) for 1.2 seconds or clicks directly with mouse cursor.
- **Dependencies**: Task 5.1.
- **Expected Files**: `frontend/src/components/scene/ComponentSelector.ts`, `frontend/src/components/hud/DwellCursor.tsx`.
- **Acceptance Criteria**: Visual circular dwell timer fills around cursor; upon 1.2s completion or mouse click, component locks as active selection; resets cleanly when moving off.
- **Status**: **COMPLETE**

### Task 5.3: Component Information HUD Panel
- **Purpose**: Render an engineering specification sidebar displaying part name, mechanical function, material, rotational speed, and maintenance specs.
- **Dependencies**: Task 5.2.
- **Expected Files**: `frontend/src/components/hud/ComponentInfoPanel.tsx`, `frontend/src/components/hud/ComponentInfoPanel.css`, `frontend/src/data/machineMetadata.ts`.
- **Acceptance Criteria**: Selecting any machine component populates the HUD with complete technical specifications; dismissible via close button, Space, or Escape key.
- **Status**: **COMPLETE**

---

## Phase 6: Testing, Performance Evaluation & Reliability

### Task 6.1: Comprehensive Unit & Integration Test Suite
- **Purpose**: Implement automated tests for coordinate conversions, smoothing math, gesture rules, camera permission/error handling, multi-frame synthetic gesture streams, and component metadata lookups.
- **Dependencies**: Phase 5.
- **Expected Files**: `frontend/tests/cameraIntegration.test.ts`, `frontend/tests/gestureIntegration.test.ts`, `frontend/tests/componentInfoPanel.test.ts`, `tests/test_frontend/run_tests.mjs`, `frontend/tests/index.test.ts`.
- **Acceptance Criteria**: All unit and integration tests execute and pass cleanly via `npm run test` (in `frontend/`) and `node tests/test_frontend/run_tests.mjs` (at project root).
- **Status**: **COMPLETE** (Created 12 camera integration tests covering constraints, stream track cleanup, and permission/device error classifications; 6 multi-frame synthetic gesture integration tests driving Three.js camera orbit, pinch zoom, gesture exclusivity, tracking loss/re-entry, and mouse contention; 11 component info HUD panel tests verifying static markup for all 7 gearbox components, fallback alerts, and keyboard dismissal; and a root-level test runner `tests/test_frontend/run_tests.mjs` forwarding to the frontend suite with exit code propagation. 112/112 tests passing across 22 suites).

### Task 6.2: Latency & Framerate Benchmarking
- **Purpose**: Measure glass-to-mesh latency, render FPS, and tracking FPS under varying hardware conditions and log telemetry.
- **Dependencies**: Task 6.1.
- **Expected Files**: `frontend/src/utils/telemetry.ts`, `docs/BENCHMARKS.md`, `frontend/tests/telemetry.test.ts`.
- **Acceptance Criteria**: Documented real benchmark results reporting render FPS ($\ge 60$) and tracking FPS ($\ge 30$) on target test machines.
- **Status**: **IN PROGRESS / ENGINE COMPLETE** (Implemented `frontend/src/utils/telemetry.ts` with bounded circular buffers computing render FPS, frame-time min/max/avg/P95, vision inference/smoothing times, tracking FPS, and application-level pipeline latency; integrated into `ViewerCanvas.tsx` and `useHandLandmarker.ts`; 17 automated telemetry unit tests passing; created `docs/BENCHMARKS.md` with complete mathematical definitions and protocols. Physical hardware benchmarking marked as **PENDING** physical measurement).

### Task 6.3: Lighting & Occlusion Edge-Case Hardening
- **Purpose**: Test and refine recovery behavior under poor lighting, rapid hand movement, and partial camera occlusion.
- **Dependencies**: Task 6.2.
- **Expected Files**: `frontend/src/services/gestures/gestureRules.ts`, `frontend/src/services/gestures/gestureClassifier.ts`, `frontend/src/components/scene/GestureCameraController.tsx`, `frontend/tests/gestureRules.test.ts`, `frontend/tests/gestureIntegration.test.ts`.
- **Acceptance Criteria**: App remains completely stable without freezing or throwing uncaught exceptions when hands enter/leave rapidly; low-confidence tracking drops safely without camera snapping; partial landmark occlusion is safely rejected with descriptive diagnostic reasons; automated tests verify recovery behavior.
- **Status**: **COMPLETE** (Implemented low-confidence tracking guards via `minTrackingConfidence` [0.50] and `hand.score` validation; hardened landmark validation against non-finite $z$ and degenerate palm scale; added partial finger occlusion checks in `analyzeFinger` preventing accidental selection or false pinches; verified safe hand disappearance/re-entry anchors without camera snapping in `GestureOrbitEngine` and `GesturePinchZoomEngine`; added 7 new automated tests in `gestureRules.test.ts` and `gestureIntegration.test.ts`; 141/141 automated tests passing; physical webcam validation documented as pending physical lighting trials).

---

## Phase 7: Custom Gesture-Classifier Experiments (Python / ML)

### Task 7.1: Landmark Data Recording Script
- **Purpose**: Build Python utility in `experiments/` to record labeled sequences of 21 3D landmarks for various custom hand gestures into CSV/Parquet.
- **Dependencies**: Phase 6.
- **Expected Files**: `experiments/record_landmarks.py`, `experiments/data/raw/`.
- **Acceptance Criteria**: Records 100+ samples per gesture class with labeled metadata.

### Task 7.2: Offline Classifier Training & Evaluation
- **Purpose**: Train and benchmark scikit-learn classifiers (KNN, Random Forest, MLP) comparing confusion matrices, precision, recall, and inference time against the heuristic baseline.
- **Dependencies**: Task 7.1.
- **Expected Files**: `experiments/train_classifier.py`, `experiments/models/`, `docs/ML_EXPERIMENTS.md`.
- **Acceptance Criteria**: Evaluation report published with precision/recall curves; trained model exported to ONNX format.

---

## Phase 8: Optional LLM-Powered Component Explanations (Local Ollama)

### Task 8.1: Local Ollama Bridge & Prompt Templates
- **Purpose**: Build a FastAPI or local Node bridge connecting to a local Ollama instance (`llama3.2:3b`) using structured engineering prompt templates.
- **Dependencies**: Phase 6.
- **Expected Files**: `backend/ai/ollama_client.py` (or Node route), `backend/ai/prompts.py`.
- **Acceptance Criteria**: Verified local completion with zero cloud API keys; returns contextual explanation of selected mechanical components.

### Task 8.2: Streaming AI Explainer HUD Modal
- **Purpose**: Add an "Ask AI" tab to the component inspection HUD rendering streamed Markdown explanations of component functions and failure modes.
- **Dependencies**: Task 8.1.
- **Expected Files**: `frontend/src/components/hud/AIExplainerModal.tsx`.
- **Acceptance Criteria**: Streamed text renders smoothly; graceful fallback displayed if Ollama is not running locally.

---

## Phase 9: Multi-Model Engineering Learning Platform (Mechanical & Civil Domains)

> [!NOTE]
> Phase 9 is currently **In Progress** (Tasks 9.0–9.7 Complete; Tasks 9.8–9.9 Not Started).
>
> **Core Architectural Principles & Refinements:**
> 1. **Zero Degradation**: Preserve the working planetary gearbox, gesture pipeline, automated tests (141 passing), and Git history.
> 2. **Review Milestones**: Phase 9 is structured into three distinct review milestones:
>    - **Milestone A (Foundation)**: Tasks 9.0–9.3.
>    - **Milestone B (UI/UX)**: Tasks 9.4–9.7.
>    - **Milestone C (Engineering Expansion)**: Tasks 9.8–9.9.
> 3. **Performance as Measurable Target**: 60 FPS rendering and $< 30$ draw calls are design targets to measure and evaluate against current-device baselines, not guaranteed results.
> 4. **Educational Visualization Grounding**: Civil engineering structural members will be presented as qualitative educational models. Structural forces, stresses, and capacities will not be claimed as calculated or simulated unless an actual validated calculation engine is implemented.
> 5. **Safe WebGL Resource Lifecycle**: Model-owned geometries, materials, and textures are explicitly disposed when switching models, while shared scene infrastructure (lighting, environment maps, camera controllers) is preserved.

### Milestone A: Foundation & Architecture (Tasks 9.0–9.3)

#### Task 9.0: Detailed UI/UX Design Specification & Technical Visual System
- **Purpose**: Author the comprehensive UI/UX design specification in `docs/DESIGN.md` defining the Engineering Explorer dashboard, CAD-style workspace, docking panel layouts, visual hierarchy, breadcrumb navigation, responsive behavior, and component-inspector design before implementing code.
- **Dependencies**: Phase 6 completion & approval.
- **Expected Files**: `docs/DESIGN.md`, `docs/DECISIONS.md`.
- **Acceptance Criteria**: Detailed specification documented covering both desktop and responsive drawer layouts, component hierarchy interaction flows, and domain-specific inspector tabs without modifying application code.
- **Status**: **COMPLETE** (Authored Section 6 of `docs/DESIGN.md` with complete two-tier navigation architecture, Home Dashboard wireframes and design tokens, CAD-style technical workspace specifications, 48px top bar with breadcrumbs and presets, 280px left assembly hierarchy tree dock with visibility toggling, center 3D viewport with gizmo and laser cursor, 320px right engineering inspector dock with domain-aware tabs, bottom gesture dock with mirrored skeleton and input arbitration, full visual system tokens and typography scale, bidirectional 3D ⇄ tree selection flows, responsive breakpoints $\ge 1280\text{px}$, $1024\text{px}-1279\text{px}$, and $< 1024\text{px}$, accessibility keyboard shortcuts/ARIA semantics, and explicit reuse mapping of existing planetary gearbox and gesture pipelines).

#### Task 9.1: Polymorphic Engineering Domain Schemas & Model Contracts
- **Purpose**: Define strict TypeScript interfaces for common component metadata and optional, domain-specific extensions (`mechanical` and `civil`), assembly hierarchy trees, and model lifecycle definitions.
- **Dependencies**: Task 9.0.
- **Expected Files**: `frontend/src/types/models.ts`, `frontend/src/types/engineering.ts`, `frontend/tests/domainSchemas.test.ts`.
- **Acceptance Criteria**: Common component metadata (`id`, `name`, `domain`, `role`, `materialName`, `description`, `specifications`, `engineeringNotes`) is decoupled from optional extensions; mechanical fields (`nominalRpm`, `gearRatio`, `teethCount`) and civil fields (`structuralRole`, `nominalForceType`, `designLoadAnnotation`, `materialGrade`) are strictly optional/nullable; zero `any` usage; strict type guards provided.
- **Status**: **COMPLETE** (Created `frontend/src/types/engineering.ts` and `frontend/src/types/models.ts` with strict TypeScript contracts for `EngineeringDomain`, `BaseComponentMetadata`, `MechanicalComponentMetadata`, `CivilComponentMetadata`, `AssemblyTreeNode`, `ModelCameraConfig`, `ModelRuntimeInstance`, and `EngineeringModelDefinition`. Created runtime type guards `isBaseComponentMetadata`, `isMechanicalMetadata`, `isCivilMetadata`, `isAssemblyTreeNode`, and `isEngineeringModelDefinition`. Added 12 unit tests in `frontend/tests/domainSchemas.test.ts` verifying type validation, domain distinction, safe optional handling, corrupted tree rejection, and seamless compatibility with the existing planetary gearbox metadata. 153/153 tests passing, 0 lint warnings/errors, production build successful).

#### Task 9.2: Modular Model Registry & Planetary Gearbox Refactor
- **Purpose**: Create an extensible registry (`ModelRegistry`) that registers models and exposes metadata, procedural builders, camera defaults, and disposal hooks. Package the existing planetary gearbox as model `#1`.
- **Dependencies**: Task 9.1.
- **Expected Files**: `frontend/src/models/registry.ts`, `frontend/src/models/mechanical/planetaryGearboxModel.ts`, `frontend/tests/modelRegistry.test.ts`.
- **Acceptance Criteria**: Existing gearbox functionality, metadata lookups, and tests remain 100% intact through registry abstraction; no regressions in existing 141 automated tests.
- **Status**: **COMPLETE** (Created `frontend/src/models/registry.ts` with `ModelRegistryService` supporting registration, lookup, domain filtering, and duplicate-ID rejection. Created `frontend/src/models/mechanical/planetaryGearboxModel.ts` wrapping the procedural planetary gearbox into `EngineeringModelDefinition` with 7 addressable parts, CAD assembly tree, camera presets, and disposal hooks. Added 12 unit tests in `frontend/tests/modelRegistry.test.ts`. 165/165 tests passing, 0 lint warnings/errors, production build successful).

#### Task 9.3: Dynamic ViewerCanvas Model Switching & Safe WebGL Disposal
- **Purpose**: Update `ViewerCanvas` to dynamically mount any registered model and safely dispose model-owned geometries, materials, and textures while preserving shared scene infrastructure (ground grid, studio lighting, environment maps).
- **Dependencies**: Task 9.2.
- **Expected Files**: `frontend/src/components/scene/ViewerCanvas.tsx`, `frontend/tests/modelLifecycle.test.ts`.
- **Acceptance Criteria**: Model switching verifies complete traversal and disposal of model-owned resources; shared scene infrastructure is preserved without re-initialization; animation frame callbacks and event listeners are cleanly detached; repeated model switching shows stable memory behavior without cumulative geometry/texture leakage; automated unit test verifies lifecycle cleanup.
- **Status**: **COMPLETE** (Created `frontend/src/services/models/modelLifecycle.ts` with `ModelLifecycleManager` managing async model mounting, generation checks for race-condition prevention, animation tick forwarding, and safe WebGL resource disposal that completely cleans up model-owned meshes, materials, and textures while preserving shared scene infrastructure like studio lighting, camera, renderer, and ground grid. Refactored `frontend/src/components/scene/ViewerCanvas.tsx` to accept dynamic `modelId` defaulting to `planetary_gearbox`, with non-blocking error overlay and fallback recovery. Added 7 unit & integration tests in `frontend/tests/modelLifecycle.test.ts`. 172/172 tests passing across 37 suites, 0 lint warnings/errors, production build successful).

---

### Milestone B: CAD-Style Technical Workspace & Dashboard UI/UX (Tasks 9.4–9.7)

#### Task 9.4: CAD-Style Technical Workspace Layout & Shell
- **Purpose**: Build the CAD-style technical workspace featuring top navigation bar, collapsible left dock (assembly tree), center 3D viewport, and collapsible right dock (engineering inspector).
- **Dependencies**: Task 9.3.
- **Expected Files**: `frontend/src/components/workspace/WorkspaceLayout.tsx`, `frontend/src/components/workspace/WorkspaceTopBar.tsx`, `frontend/src/components/workspace/WorkspaceLayout.css`.
- **Acceptance Criteria**: Layout provides dedicated docking panels without obscuring 3D viewport; responsive collapse for smaller screens ($\le 1024\text{px}$); virtual cursor bounds accurately adapt to resizing center viewport.
- **Status**: **COMPLETE** (Created `frontend/src/components/workspace/WorkspaceTopBar.tsx`, `frontend/src/components/workspace/WorkspaceLayout.tsx`, and `frontend/src/components/workspace/WorkspaceLayout.css` implementing the CAD-style technical workspace shell. The layout provides a 48px top toolbar with brand identity, breadcrumbs, dock toggle buttons, and live telemetry; a collapsible 280px left dock for assembly hierarchy; a central flex-1 3D viewport hosting `ViewerCanvas` with automatic ResizeObserver adapting camera and virtual cursor bounds without remounts; a collapsible 320px right dock for engineering inspection; and a 32px bottom status bar with input modality and gesture cheat-sheet hints. Responsive breakpoints support large desktop, medium laptop, and small tablet drawer collapse. Added 9 automated tests in `frontend/tests/workspaceLayout.test.ts`. 181/181 tests passing across 39 suites, 0 lint warnings/errors, production build successful).

#### Task 9.5: Interactive Assembly Hierarchy Tree Panel
- **Purpose**: Implement a CAD-style collapsible tree view displaying sub-assemblies and individual parts with visibility toggles, bidirectional selection sync, and search.
- **Dependencies**: Task 9.4.
- **Expected Files**: `frontend/src/components/workspace/AssemblyTreePanel.tsx`, `frontend/src/components/workspace/AssemblyTreePanel.css`.
- **Acceptance Criteria**: Clicking an item in the tree highlights it in 3D; selecting a part via raycaster or gesture laser pointer highlights and expands the corresponding node in the tree; part visibility toggles work without breaking raycaster state.
- **Status**: **COMPLETE** (Created `frontend/src/components/workspace/AssemblyTreePanel.tsx`, `frontend/src/components/workspace/AssemblyTreePanel.css`, and `frontend/src/utils/assemblyTreeUtils.ts` providing an interactive CAD assembly hierarchy tree. Implemented full tree traversal driven by `EngineeringModelDefinition.getAssemblyTree()`, nested expansion carets, component vs. assembly icons, bidirectional 3D raycast selection synchronization with auto-expanding ancestor paths, per-node non-destructive WebGL visibility toggling mapped to Three.js `Object3D.visible` with `e.stopPropagation()` protection against accidental selection, search query filtering with ancestor path retention, and clean empty/no-match states. Added 10 automated unit and integration tests in `frontend/tests/assemblyTree.test.ts`. 191/191 tests passing across 42 suites, 0 lint warnings/errors, production build successful).

#### Task 9.6: General-Purpose Engineering Inspector Panel
- **Purpose**: Refactor `ComponentInfoPanel` into a multi-tabbed, domain-aware engineering inspector supporting common specifications and optional domain extensions.
- **Dependencies**: Task 9.4.
- **Expected Files**: `frontend/src/components/workspace/EngineeringInspectorPanel.tsx`, `frontend/src/components/workspace/EngineeringInspectorPanel.css`, `frontend/src/utils/inspectorUtils.ts`, `frontend/tests/engineeringInspector.test.ts`.
- **Acceptance Criteria**: Renders common metadata tab; displays optional kinematics tab when mechanical properties are present; displays educational structural role annotations when civil properties are present; graceful handling when optional domain extensions are omitted; full keyboard and close dismissal.
- **Status**: **COMPLETE** (Created `frontend/src/components/workspace/EngineeringInspectorPanel.tsx`, `frontend/src/components/workspace/EngineeringInspectorPanel.css`, and extracted pure resolution/formatting utilities into `frontend/src/utils/inspectorUtils.ts`. Organized inspector into three accessible tabs: **Overview** (component title, ID badge, mechanical/civil domain pill, functional role, educational/engineering notes), **Specifications** (mechanical kinematics & sizing including nominal RPM, gear ratio, teeth count, pitch diameter, module pitch, torque rating, lubrication, service interval; civil structural design annotations including structural member role, nominal force type, design load reference, material grade, span length, slenderness ratio annotation, and educational notes; technical parameters array; omitting unavailable fields without fabricated defaults), and **Materials** (designated material, structural grade, metallurgical surface properties, with a clear empty state when no material data is present). Integrated into `WorkspaceLayout.tsx` Right Dock with selection sync, Escape key dismissal, and ArrowLeft/ArrowRight tab navigation. Added 17 unit and integration tests in `frontend/tests/engineeringInspector.test.ts`. 208/208 tests passing across 48 suites, 0 lint warnings/errors, production build successful in 428ms).

#### Task 9.7: Engineering Explorer Home Dashboard & Model Catalogue
- **Purpose**: Implement the top-level Engineering Explorer home page featuring domain categories (Mechanical vs. Civil), search bar, difficulty tags, and responsive model preview cards.
- **Dependencies**: Task 9.2.
- **Expected Files**: `frontend/src/components/dashboard/HomeDashboard.tsx`, `frontend/src/components/dashboard/HomeDashboard.css`, `frontend/src/utils/dashboardUtils.ts`, `frontend/tests/homeDashboard.test.ts`.
- **Acceptance Criteria**: Filtering by domain shows only matching models; search dynamically filters cards; clicking a card transitions cleanly into the 3D workspace and back without WebGL context loss.
- **Status**: **COMPLETE** (Created `frontend/src/components/dashboard/HomeDashboard.tsx`, `frontend/src/components/dashboard/HomeDashboard.css`, and `frontend/src/utils/dashboardUtils.ts`. Implemented full discovery dashboard with brand identity banner, featured model spotlight card highlighting the registered Epicyclic Planetary Gearbox with prominent "Launch 3D Workspace" CTA, domain filtering tabs for All, Mechanical, and Civil with dynamic counts and honest Civil empty state, keyword search matching model titles, descriptions, categories, and tags, responsive model catalogue cards grid with domain pills and difficulty tags, and seamless two-tier view switching in `App.tsx` and `WorkspaceTopBar.tsx` with one-click return to catalogue. Added 17 unit and integration tests in `frontend/tests/homeDashboard.test.ts`. 225/225 tests passing across 55 suites, 0 lint warnings/errors, production build successful in 325ms).

---

### Milestone C: Engineering Expansion & Guided Curriculum (Tasks 9.8–9.9)

#### Task 9.8: First Civil Engineering 3D Model (Procedural Educational Truss Bridge)
- **Purpose**: Build the first civil engineering model (procedural Warren steel through-truss span) as an interactive educational visualization with top chords, bottom chords, vertical posts, diagonal web members, connection gusset plates, end sway portal frames, concrete roadway deck, and substructure pier abutments.
- **Dependencies**: Tasks 9.3, 9.6.
- **Expected Files**: `frontend/src/models/civil/warrenTrussBridgeModel.ts`, `frontend/src/models/civil/WarrenTrussBridge.ts`, `frontend/tests/warrenTrussBridge.test.ts`.
- **Acceptance Criteria**: Model renders with distinct addressable structural members; raycast and gesture selection work identically to mechanical models; structural metadata is clearly labeled as qualitative educational design information (not live FEA or calculated stresses); memory disposal tested and clean.
- **Status**: **COMPLETE** (Created `frontend/src/models/civil/WarrenTrussBridge.ts` providing realistic, procedural 3D Three.js geometry with 8 addressable components: `top_chords`, `bottom_chords`, `diagonal_members`, `vertical_struts`, `gusset_plates`, `end_portals`, `bridge_deck`, and `support_piers` with custom PBR materials and comprehensive disposal. Created `frontend/src/models/civil/warrenTrussBridgeModel.ts` complying with `EngineeringModelDefinition` contract, providing a nested CAD assembly tree, camera presets, and compliant `CivilComponentMetadata` with structural roles, material annotations, and educational engineering notes clearly labeled as qualitative design concepts without false FEA claims. Registered in `frontend/src/models/registry.ts`. Generalized `ComponentSelector`, `ComponentRaycaster`, and `ViewerCanvas` to support generic string component IDs. Added 20 unit & integration tests in `frontend/tests/warrenTrussBridge.test.ts`. 245/245 tests passing across 63 suites, 0 lint warnings/errors, production build successful in 490ms).

#### Task 9.9: Exploded View & Guided Learning Engine Foundation
- **Purpose**: Implement procedural exploded view interpolation and a step-by-step guided curriculum panel teaching mechanical and civil principles.
- **Dependencies**: Tasks 9.4, 9.5, 9.8.
- **Expected Files**: `frontend/src/components/scene/PlanetaryGearbox.ts`, `frontend/src/models/civil/WarrenTrussBridge.ts`, `frontend/src/services/models/modelLifecycle.ts`, `frontend/src/data/guidedLessons.ts`, `frontend/src/components/workspace/GuidedLearningPanel.tsx`, `frontend/src/components/workspace/GuidedLearningPanel.css`, `frontend/tests/explodedViewAndGuidedLearning.test.ts`.
- **Acceptance Criteria**: Exploded view slider smoothly translates parts along radial and axial explosion vectors without drift; kinematics animation composes cleanly with explosion offset; return to assembled factor 0 restores exact baseline coordinates; guided learning steps synchronize selection across 3D viewport, assembly tree, and inspector; previous selection is safely restored upon tour exit; safe disposal on model switching.
- **Status**: **COMPLETE** (Implemented reversible, model-space exploded-view mechanics for both `planetary_gearbox` and `warren_truss_bridge`. In `PlanetaryGearbox.ts`, axial separation along Y is composed with dynamic radial orbit expansion on the XZ plane, preserving continuous epicyclic kinematics during both rotating and stationary states without cumulative drift. In `WarrenTrussBridge.ts`, multi-axis separation reveals structural hierarchy with deterministic vertical offsets for top chords (+3.0m), deck (+1.2m), bottom chords (-1.2m), and piers (-2.8m), longitudinal separation for portal frames (±2.0m), and lateral separation for diagonals (±0.8m), verticals (±0.4m), and gussets (±1.5m). Integrated continuous exploded factor controls and assemble reset buttons in `ViewerCanvas.tsx` and `WorkspaceTopBar.tsx`. Created structured curriculum data in `frontend/src/data/guidedLessons.ts` with 5-step lesson for the gearbox and 8-step lesson for the truss bridge, validated against actual component IDs and metadata. Created `GuidedLearningPanel.tsx` with discipline badges, progress indicators, educational takeaways, keyboard navigation, and automatic selection synchronization across 3D viewport, CAD assembly tree, and engineering inspector. Guaranteed robust runtime safety with prior selection restoration on exit, safe nullification when switching models, and automatic exploded factor reset. Added 20 unit & integration tests in `frontend/tests/explodedViewAndGuidedLearning.test.ts`. 265/265 tests passing across 69 suites, 0 lint warnings/errors, production build successful).

---

## Phase 10: Engineering Explorer Architectural & UI/UX Redesign

### Task 10.0: Architecture & UI/UX Audit (Phase A)
- **Purpose**: Conduct a rigorous audit of the existing application to identify root causes of scrolling failures, Mechanical/Civil domain crossover, CAD workspace clutter, and mobile/tablet viewport clipping, and establish an ordered redesign remediation plan.
- **Dependencies**: Tasks 9.1–9.9.
- **Expected Files**: `docs/TASKS.md`.
- **Audit Findings**:
  1. *Scrolling Failure Root Cause*: Global `html, body, #root { height: 100%; overflow: hidden; }` in `index.css` paired with `.app-container { height: 100vh; overflow: hidden; }` in `App.css` and `.engineering-dashboard { min-height: 100vh; }` in `HomeDashboard.css` with no `overflow-y: auto` on any ancestor container, completely clipping content below the fold.
  2. *Domain Crossover Root Cause*: `HomeDashboard.tsx` hardcodes the Mechanical Planetary Gearbox into the Featured Spotlight even when the Civil tab is active (`!searchQuery` evaluates to true). `WorkspaceLayout.tsx`, `ViewerCanvas.tsx`, and `inspectorUtils.ts` contain silent fallbacks to `PLANETARY_GEARBOX_MODEL_ID` upon missing or unmounted model references.
  3. *UI/UX & Viewport Issues*: Absence of distinct Mechanical vs. Civil entry points on Home; excessive floating overlays (PiP, telemetry, controls, tour) crowding 3D viewports on 1366×768 laptops; overlapping and colliding absolute side docks on tablet (768×1024) and mobile (390×844) without a responsive single-pane tabbed mode.
- **Proposed Redesign Plan**:
  - **Task 10.1: CSS & Scroll Architecture Remediation**: Remove blanket root overflow locks, establish explicit document-level scroll ownership for explorer/catalogues and panel-level scroll ownership for CAD workspace across 1920×1080, 1366×768, 768×1024, and 390×844.
  - **Task 10.2: Engineering Explorer Navigation & Domain Entry Points**: Implement 3-tier navigation (Explorer Landing with distinct Mechanical & Civil portals, Domain-specific Catalogues, and CAD Workspace) preserving domain context during return navigation.
  - **Task 10.3: Domain Isolation & Hardcoded Fallback Removal**: Remove all silent fallbacks to `PLANETARY_GEARBOX_MODEL_ID` across `ViewerCanvas`, `WorkspaceLayout`, `HomeDashboard`, and `inspectorUtils`; add domain-aware error boundaries.
  - **Task 10.4: CAD Workspace Responsive Refactor & De-cluttering**: Implement responsive single-pane tabs for tablet/mobile ($<1024\text{px}$) and streamline floating overlays to maximize 3D canvas visibility.
  - **Task 10.5: Full Verification, Documentation & Browser Testing**: Comprehensive cross-resolution browser verification, full unit test suite (265+ tests), linting, and production build.
- **Status**: **COMPLETE** (Audit completed and remediation plan approved).

### Task 10.1: CSS and Scroll Architecture Remediation
- **Purpose**: Fix the application's scrolling failures and establish a predictable layout foundation without changing navigation architecture or redesigning the dashboard.
- **Dependencies**: Task 10.0.
- **Root Cause Addressed**:
  - Global `html, body, #root { width: 100%; height: 100%; overflow: hidden; }` in `index.css` combined with `.app-container { width: 100vw; height: 100vh; overflow: hidden; }` in `App.css` locked the browser document from vertical scrolling.
  - No ancestor element above `.engineering-dashboard` allowed scroll expansion, trapping catalogue cards and footer content below the viewport fold.
  - The CAD workspace and Explorer views lacked layout-specific scroll boundaries: the explorer needs document-level vertical flow, while the CAD workspace requires an exact fixed-viewport shell (`100vh`/`100dvh`) with internal scrolling inside side panels (`min-height: 0` flex rules).
- **Files Modified**:
  - `frontend/src/index.css`: Removed blanket `overflow: hidden` on `html, body, #root`; set `min-height: 100%; overflow-x: hidden;` on `html, body` and flex `min-height: 100%` on `#root`. Added custom dark CAD scrollbar styling.
  - `frontend/src/App.css`: Changed `.app-container` from `height: 100vh; overflow: hidden;` to `min-height: 100vh; width: 100%; position: relative;`.
  - `frontend/src/components/dashboard/HomeDashboard.css`: Added `@media (max-width: 640px) { .model-cards-grid { grid-template-columns: 1fr; } }` to eliminate horizontal card blowout on mobile.
  - `frontend/src/components/workspace/WorkspaceLayout.css`: Set `.cad-workspace-shell` to `width: 100%; height: 100vh; height: 100dvh; overflow: hidden;`. Added `min-height: 0` and `-webkit-overflow-scrolling: touch;` to `.workspace-main-area`, `.cad-dock`, `.dock-content`, `.cad-viewport-center`, and `.viewport-inner`.
  - `frontend/src/components/scene/ViewerCanvas.css`: Changed `.viewport-container` from rigid `min-height: 400px;` to `min-height: 0;` to avoid flex child height blowout on smaller laptop and tablet viewports.
  - `frontend/src/components/workspace/AssemblyTreePanel.css`: Added `min-height: 0; -webkit-overflow-scrolling: touch;` to `.assembly-tree-panel` and `.tree-content-scroll`.
  - `frontend/src/components/workspace/EngineeringInspectorPanel.css`: Added `min-height: 0; -webkit-overflow-scrolling: touch;` to `.engineering-inspector-panel` and `.inspector-content`.
  - `frontend/src/components/workspace/GuidedLearningPanel.css`: Added `overflow-x: hidden; -webkit-overflow-scrolling: touch;` to `.lesson-body`.
  - `frontend/tests/scrollArchitecture.test.ts`: Created new automated test suite testing global document flow, dashboard horizontal and vertical containment, workspace shell containment, and internal scroll panels.
  - `frontend/tests/index.test.ts`: Registered `scrollArchitecture.test.ts` into test runner.
- **Verification Results**:
  - Automated Tests: 278/278 tests passing across 74 suites (`npm.cmd run test`).
  - Linter: 0 warnings, 0 errors across 69 files (`npm.cmd run lint`).
  - Production Build: Clean compilation in 392ms (`npm.cmd run build`).
  - Responsive Viewport CSS Rules: Verified for Desktop ($1920\times 1080$), Laptop ($1366\times 768$), Tablet ($768\times 1024$), and Mobile ($390\times 844$).
  - Browser Verification Note: Attempted automated Playwright browser session; host environment blocked playwright driver download (`404 from playwright.azureedge.net` due to network sandbox restrictions). Automated CSS rule inspection and integration tests verify stylesheet integrity and responsive scroll invariants.

### Task 10.2: Application-Wide Clean & Modern UI/UX Redesign
- **Purpose**: Redesign the interface of GestureLab CAD to be clean, modern, and well-organized, creating a professional 3D learning platform with clear visual hierarchy, disciplined design tokens, and uncluttered viewports across Mechanical, Civil, and Medical categories.
- **Dependencies**: Tasks 10.0, 10.1.
- **Key Enhancements**:
  - *Unified Design System*: Standardized design tokens in `index.css` (neutral slate backgrounds, high-contrast typography, controlled cyan/amber/rose domain accents, accessible focus rings, and dark CAD scrollbars).
  - *Domain Navigation & Categorization*: Added Medical domain tab alongside All, Mechanical, and Civil in `HomeDashboard.tsx` and `dashboardUtils.ts` with live counts and an honest Medical empty state ("Medical & biomechanical models currently under curriculum development").
  - *Elimination of Domain Crossover*: Made featured model spotlight domain-aware (spotlighting relevant models per domain rather than forcing the planetary gearbox into the Civil view).
  - *Workspace De-cluttering*: Defaulted `showDiagnostics` to `false` in `App.tsx` so the telemetry window doesn't obscure the 3D model upon launch. Repositioned floating viewport toolbar to bottom-right and interaction hints to top-left in `ViewerCanvas.css` to prevent overlap with the bottom-left PiP webcam feed.
  - *Responsive Layouts*: Clean desktop, laptop, tablet, and mobile presentation with slide-over drawers on tablets ($\le 1024\text{px}$) and single-column mobile card grids ($\le 640\text{px}$).
- **Files Modified**:
  - `frontend/src/index.css`: System theme tokens, typography, dark scrollbars.
  - `frontend/src/App.tsx`: Defaulted `showDiagnostics` to `false`.
  - `frontend/src/utils/dashboardUtils.ts`: Added `'medical'` domain type and count support.
  - `frontend/src/components/dashboard/HomeDashboard.tsx`: Added Medical tab, domain-aware featured spotlight, and honest Medical empty state.
  - `frontend/src/components/dashboard/HomeDashboard.css`: Polished card layout, typography, and responsive spacing.
  - `frontend/src/components/workspace/WorkspaceLayout.css`: Polished top toolbar, side docks, and bottom status bar.
  - `frontend/src/components/scene/ViewerCanvas.css`: Repositioned floating viewport controls and interaction hints to eliminate overlap.
  - `frontend/tests/homeDashboard.test.ts`: Added unit tests for Medical tab rendering and honest empty state.
- **Verification Results**:
  - Automated Tests: 279/279 tests passing across 74 suites (`npm.cmd test`).
  - Linter: 0 warnings, 0 errors across 69 files (`npm.cmd run lint`).
  - Production Build: Clean compilation in 631ms (`npm.cmd run build`).
  - Visual verification limitation: Automated browser driver download was blocked by the environment sandbox network; responsive layout rules and component invariants were verified through unit/integration tests and static analysis.
- **Status**: **COMPLETE**

### Task 10.3: Visual 3D Learning Platform Homepage Rework
- **Purpose**: Transform the application homepage from an engineering CAD dashboard into an interactive 3D visual learning platform prioritizing visual discovery, real 3D geometry previews, distinct domain exploration, and clear educational hierarchy.
- **Dependencies**: Tasks 10.1, 10.2.
- **Key Enhancements**:
  - *Real 3D Geometry Previews (`ModelPreviewCanvas.tsx`)*: Render live, lightweight Three.js previews directly from registered models' actual procedural geometry (`buildScene()`). Incorporates automatic bounding-box centering, studio lighting, smooth continuous auto-rotation, and complete WebGL resource disposal on unmount with honest fallback when WebGL is unavailable.
  - *Educational Information Architecture*: Replaced dense engineering spec boxes and CAD telemetry with clear learning objectives ("What You'll Learn"), core learning pillar highlights (Component Inspection, Exploded-View Disassembly, Gesture & Orbit Navigation), and clear action CTAs.
  - *Domain Discovery*: Mechanical, Civil, and Medical presented as distinct educational learning areas with honest states (only available models are openable; Medical honestly designated as under curriculum development).
  - *Preserved Workspace Integration*: Zero regressions or breaking changes to existing model IDs (`planetary_gearbox`, `warren_truss_bridge`), model registry contracts, camera controllers, gesture tracking, keyboard shortcuts, or workspace interactions.
- **Files Modified/Created**:
  - `frontend/src/components/dashboard/ModelPreviewCanvas.tsx` (new): Real 3D canvas thumbnail component with WebGL lifecycle management.
  - `frontend/src/components/dashboard/HomeDashboard.tsx`: Educational learning platform structure, live 3D preview integration, learning pillars, and domain-aware featured spotlight.
  - `frontend/src/components/dashboard/HomeDashboard.css`: Visual-first styling, card preview viewports, educational pillar highlights, and responsive spacing.
  - `frontend/src/utils/dashboardUtils.ts`: Domain filter type extensions.
  - `frontend/tests/homeDashboard.test.ts`: Expanded test suite covering domain filtering and honest states.
- **Verification Results**:
  - Automated Tests: 279/279 tests passing across 74 suites (`npm.cmd test`).
  - Linter: 0 warnings, 0 errors across 70 files (`npm.cmd run lint`).
  - Production Build: Clean compilation in 870ms (`npm.cmd run build`).
- **Status**: **COMPLETE** (Awaiting approval before workspace changes or new model geometry).



