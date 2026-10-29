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
| **Phase 11** | AI Teacher: Voice + Gesture Control & Visual Explanations | **In Progress (Task V1 Complete; V2 awaiting approval)** |

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




---

## Phase 11: AI Teacher — Voice + Gesture Control & Visual Explanations

Goal: users operate the same 3D scene with hand gestures or voice (Gnani speech models, 10 Indian languages), ask questions about components, and watch an AI teacher demonstrate answers through validated scene actions (select, focus, isolate, explode, animate). See ARCHITECTURE.md §8.

### Task V1: Unified Scene Command Channel
- **Purpose**: One validated, typed command interface through which gestures, keyboard, toolbar, voice and (later) the AI teacher operate the workspace — no parallel control systems.
- **Dependencies**: Phases 4, 5, 9, 10.
- **Implemented**:
  - `frontend/src/services/commands/sceneCommands.ts` (new): command vocabulary (camera orbit/pan/zoom/view/reset/auto-orbit; component select/focus/isolate/visibility/show-all; assembly explode/restore; animation play/pause/speed; lesson start/next/previous/goTo/exit; workspace switch-model/home) and `validateSceneCommand(unknown, context)` that treats input as untrusted, strips unknown fields, enforces ranges, and validates component IDs, animations, exploded-view support, lesson state and registered models against the live model.
  - `frontend/src/services/commands/sceneCommandDispatcher.ts` (new): single entry point; validates → routes to the owning handler → records executed/deferred/rejected/expired with source; bounded history; listener isolation; never throws.
  - `frontend/src/services/commands/viewerCommandExecutor.ts` (new): runs camera/focus/isolate/animation commands; arbitration — camera commands are deferred while a hand gesture or mouse drag steers the camera (latest wins, 2.5 s expiry), and a gesture/drag starting mid-transition cancels the transition (user always wins).
  - `CameraController.tsx`: smooth spherical transitions (`animateTo`, 350 ms ease-in-out), `orbitBy`, `panBy`, `zoomSmooth`, `goToView` (isometric/top/front + new back/left/right), `getFocusPose`, `cancelTransition`; auto-orbit suspended during transitions and restored to the user's intent. Existing `setPreset`/`reset`/`zoomBy`/`focusOnBounds` unchanged (instant presets now cancel a running transition).
  - `GestureCameraController.tsx`: `isInteracting()` accessor.
  - `modelLifecycle.ts`: `getComponentBounds()`; **bug fix** in fallback `isolateComponent` — it hid the named root container (`planetary_gearbox_assembly`), so an isolated component never rendered; now only real component IDs are toggled and ancestors of the isolated component stay visible.
  - `types/models.ts` + `planetaryGearboxModel.ts`: explicit `animations` capability (`gear_train_rotation`). The bridge declares none (its update hook is a no-op), so animation commands are rejected for it.
  - `ViewerCanvas.tsx`: registers the viewer handler/context on the shared dispatcher; animation playback separated from camera auto-orbit with speed control (speed scales time uniformly, preserving gear ratios); "Pause Rotation" button keeps its previous behaviour (pauses both).
  - `WorkspaceLayout.tsx` / `App.tsx`: creates the dispatcher, handles workspace commands, routes the `X` and `L` shortcuts through it (same behaviour), adds `onSwitchModel`, and exposes a **development-only** console hook `window.__sceneCommands` (`dispatch`, `context`, `history`).
  - Not implemented on purpose (missing capability, documented): multi-component highlighting, bottom view (camera is constrained above the ground grid — rejected with a reason), animations for the bridge, component relationship data.
- **Verification Results**:
  - Automated: 337/337 tests passing across 84 suites (297 pre-existing + 40 new in `frontend/tests/sceneCommands.test.ts`, incl. real-gesture-controller conflict tests and an isolation regression test); `tsc -b` clean; `oxlint` 0 warnings/errors; `vite build` succeeds (pre-existing large-chunk warning).
  - Manual (browser, mouse/keyboard/console — **no webcam**): live context correct; reset/zoom/view/select/explode/isolate+focus/show-all/lesson/switch-model/go-home executed on screen; `X` and `L` routed via the channel with unchanged behaviour; toolbar Pause/Auto Rotate unchanged; rejections verified for invented parts, cross-model parts, unknown command, bottom view, bad zoom, lesson-not-active, bridge animation; no console errors.
  - **Not verified manually**: webcam gesture + command conflicts (covered only by automated synthetic-landmark tests); transition smoothness timing in a visible browser (covered by automated mid-transition tests; the preview pane was hidden, which pauses rendering).
- **Status**: **COMPLETE** (awaiting approval for Task V2).

### Task V2: Multilingual Voice Control on the Command Channel (Gnani Prisma + Timbre)
- **Purpose**: Operate the same workspace by voice in English, Telugu and Hindi (incl. code-mixed speech), with spoken/captioned replies — through the V1 `SceneCommandDispatcher`, never a separate execution path.
- **Dependencies**: Task V1. Approved packages only (`backend/requirements.txt`, pinned to the already-installed versions): fastapi, uvicorn, python-multipart, requests, pytest, httpx. No new frontend dependencies.
- **Implemented**:
  - `backend/app/config.py`, `gnani.py`, `main.py` (new): FastAPI `GET /api/voice/health` (reports `keyConfigured` only, never the key), `POST /api/voice/transcribe` (Prisma `stt/v3`; validates language, WAV type, ≤2 MB, 0.2–30 s), `POST /api/voice/speak` (Timbre `timbre-v2.5`, native voice per language, ≤400 chars). Gnani errors mapped to stable codes (`KEY_MISSING`, `GNANI_FORBIDDEN` = key/credits, `GNANI_RATE_LIMIT`, `GNANI_UNAVAILABLE`, `GNANI_TIMEOUT`, `GNANI_UNREACHABLE` …). Key read from `GNANI_API_KEY` (environment, else `backend/.env`).
  - `backend/scripts/smoke_gnani.py` (new): live Timbre→Prisma round trip per language through our own API.
  - `frontend/src/services/voice/partLexicon.ts`: part aliases built from the **loaded model** (IDs, tree names, metadata names, parenthesised names, singulars, unique single words, Telugu/Hindi transliterations of English engineering words).
  - `phraseParser.ts`: deterministic EN/TE/HI + code-mixed grammar → `SceneCommand[]`; "this/ఇది/इसे" resolves to the selected part; parts of other models and common machine parts (piston, crankshaft…) are recognised so they can be rejected by name.
  - `voiceReplies.ts`: short EN/TE/HI replies; beta languages reply in English.
  - `recorder.ts` (16 kHz mono WAV, end-of-speech detection, 25 s cap, mic error classification), `voiceClient.ts` (timeouts, cancellation, error mapping), `voiceSession.ts` (turn → dispatcher with source `voice`; stops at first V1 rejection).
  - `frontend/src/components/voice/VoiceDock.tsx/.css`: workspace dock (top-left of viewport) — push-to-talk mic with level ring, language selector (beta labels), always-visible transcript + caption + status chip, Cancel (stops recording, aborts requests, stops playback; a turn counter discards stale responses), "speak every reply" toggle (default: only problems are spoken), deferred-command follow-up, error notices. Development-only hook `window.__voiceDock` (`say`, `submitAudio`, `setLanguage`).
  - `sceneCommands.ts` + `WorkspaceLayout.tsx`: optional `selectedComponentId` in the command context (backward compatible). `vite.config.ts`: `/api` proxy (target overridable with `VOICE_BACKEND_URL`).
  - Not implemented on purpose: LLM/teaching assistant (V3+), a gesture to start listening (no new gestures in V2), full command grammar for the 7 beta languages (speech in/out works; commands need English words).
- **Verification Results**:
  - Automated (simulated Gnani): frontend 433/433 tests, 93 suites (incl. live Prisma transcripts as regression cases); `tsc -b` clean; `oxlint` 0 warnings; `vite build` OK (pre-existing large-chunk warning). Backend `pytest` 23/23 with mocked Gnani (validation, size/duration limits, unsupported language, timeouts, every error mapping, key never in responses).
  - Live Gnani (26 Oct 2026): 22/22 Timbre→Prisma round trips across all 10 languages. Prisma mis-heard "సన్ గేర్" as "సంగీత" and "ring gear" as "ring air/ear" (te/hi); the parser still resolves "ring" uniquely and never acts on a wrong part.
  - Browser (Vite + backend, dev hook): EN/TE/HI/code-mixed commands executed through the dispatcher; live audio → Prisma → command for EN/TE/HI; piston, bridge part and nonsense rejected with zero commands dispatched; voice camera command deferred during a mouse drag and run on release; Cancel discarded an in-flight transcription; mic denied and backend-down messages shown; one live Gnani 429 on rapid TTS handled (caption kept).
  - **Not verified**: a real microphone recording (the preview pane blocks the mic), audible playback quality, webcam gesture + voice together.
- **Status**: **COMPLETE** (awaiting approval for Task V3).
- **Next**: Task V3 (below).

### Task V3: Scene Snapshot & Context-Aware Part Resolution
- **Purpose**: Know which model and component the user means ("this", "that", "it", pointing, selection, conversation) and expose accurate, typed scene context that V4's teacher can consume, without an LLM.
- **Dependencies**: V1, V2. No new dependencies.
- **Context already available before V3 (audit)**: selection, lesson index, model/component IDs, animations, exploded-view support and viewer readiness (dispatcher providers). Missing: hover/pointing (the raycast result stayed inside ViewerCanvas), hidden/isolated state, exploded intensity, the real camera view (`activePreset` goes stale after manual orbit), animation playing/speed, relationships (type + inspector UI existed, no data).
- **Implemented**:
  - `services/scene/sceneFacts.ts`, `sceneSnapshot.ts` (new): typed snapshot built from the existing context providers; `Fact<T>` distinguishes unavailable from empty; stale IDs filtered; dev hook `__sceneCommands.snapshot()`.
  - `services/scene/referenceResolver.ts` (new): explicit → pointed → selected → last discussed → clarify.
  - `services/scene/relationshipTable.ts`, `componentRelationships.ts`, `models/mechanical/planetaryGearboxRelationships.ts`, `models/civil/warrenTrussRelationships.ts` (new): evidence-backed relationships merged into model metadata; query, graph and validation helpers.
  - `sceneCommands.ts`: `component.highlight` / `component.clearHighlight` (validated IDs, max 20) + optional `workspaceFacts` / `viewerFacts` context fields. `viewerCommandExecutor.ts`: executes highlights, tracks focus, reports viewer facts. `ComponentRaycaster.ts`: related-highlight layer (priority-based refresh; hover/selection behaviour preserved). `CameraController.tsx`: `classifyView()`. `ViewerCanvas.tsx`: shares the pointed component (mouse or hand laser) and animation state. `WorkspaceLayout.tsx`: workspace facts + snapshot dev hook.
  - Voice: `phraseParser.ts` uses the resolver and adds questions, related parts, clear highlight and contextual "put it back"; `voiceSession.ts` builds the snapshot per turn and returns the discussed part; `voiceReplies.ts` new EN/TE/HI replies; `VoiceDock.tsx` keeps per-model conversation memory and new status chips.
- **Relationship accuracy**: every edge cites the model's own metadata text, animation description or procedural geometry (see the edge tables). Not defined for lack of evidence: ring-gear mounting (no housing component), carrier↔shaft, planet↔planet; bridge end-portal↔top-chord joint and the upper lateral bracing (not a component).
- **Verification Results**:
  - Automated: 466/466 tests, 98 suites (433 existing + 33 new in `tests/sceneContext.test.ts`: snapshot initial/selection/pointing/hide-show/isolate-restore/explode/animation/lesson/focus/camera view/model switch/serialisation; resolver priority, ambiguity, clarification, cross-model; relationships valid + inverse, gearbox/bridge links, invalid IDs, no-relationship model, graph depth; highlight layering + material restore + V1 validation; scenarios A–E and EN/TE/HI contextual turns). `tsc -b` clean, `oxlint` 0 warnings, `vite build` OK.
  - Browser (dev server, real mouse): hover tracked live (`sun_gear`, `planet_carrier`) and cleared on leaving the canvas; "What does this do?" while hovering the sun gear resolved it (pointed) without inventing an answer; "show the parts connected to it" selected the sun gear and lit the shaft + 3 planets green (screenshot); clear highlight, separate this part, put it back (undo, then "nothing to put back"); after switching to the bridge "hide it" asked for clarification with 0 commands; bridge related parts and question; no console errors.
  - **Not verified**: hand laser-pointer context with a real webcam (same code path as the mouse, covered by unit tests only).
- **Status**: **COMPLETE** (awaiting approval for Task V4).

### Task V4: AI Teaching Engine (explain, demonstrate, narrate)
- **Purpose**: Answer teaching questions with a grounded explanation, validated scene actions on the loaded model, and Gnani narration with synchronised captions.
- **Provider**: Google Gemini via its official OpenAI-compatible endpoint (approved), configured by `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` in `backend/.env` (set by the user). Verified from Google's docs (26 Oct 2026): base URL `https://generativelanguage.googleapis.com/v1beta/openai/`, Bearer auth, `GET /models`, structured output via `response_format` JSON schema; `gemini-3.8-flash` is the documented current stable Flash model used in the compatibility examples. **Account access is not yet verified**: the three settings were not configured during V4 (`check_llm.py` → BLOCKED). No new dependencies (`requests`, FastAPI).
- **Implemented**:
  - Backend: `app/llm.py` (OpenAI-compatible client, error mapping), `app/teaching.py` (request limits, fact-pack models, JSON schema, grounded system prompt, plan validation), `/api/teach` + teaching status in `/api/voice/health`, uniform `INVALID_REQUEST` errors, `scripts/check_llm.py` (live verification), `config.py` LLM settings (booleans only reported).
  - Frontend: `services/teaching/teachingPlan.ts` (schema + validation + per-step re-validation), `factPack.ts`, `teachingClient.ts`, `planPlayer.ts`, `teachingSession.ts` (session hook, Timbre narrator, follow-up history, stale protection); `components/voice/TeachingPanel.tsx` in the VoiceDock (question, title, step x/y, caption + narration, claim label, Pause/Resume/Continue/Stop, skipped-step notice, errors, follow-up suggestions); `phraseParser.ts` teaching routing (whole-model topics, path questions via mention groups); `voiceSession.ts` `teach` status; `partLexicon.ts` model-name words are no longer part aliases ("bridge" = the model); viewer fact `pendingCommand` / snapshot `camera.settled`.
- **Verification Results**:
  - Automated, simulated provider (backend): 81/81 (23 existing + 58 new in `tests/test_teach_api.py`: valid plan, request sent, model-id lock, stripped fields, 10 invalid-action cases, no-animation/no-explode/not-allowed actions, all-invalid, malformed/oversized, non-JSON, unexpected provider body, prompt injection (question + model text + unsafe output), 8 provider errors incl. timeout, request limits; key never in responses).
  - Automated (frontend): 513/513, 99 suites (466 existing + 47 new in `tests/teaching.test.ts`: validation, player order/settle/narration, restore on finish/cancel, pause/resume, manual takeover by command and by hand steering, model switch, stale model, runtime-invalid step, no overlap, Continue, routing commands vs questions (EN/TE/HI), path vs ambiguity, follow-up pronouns, pointed/explicit/missing context, fact-pack grounding for gearbox and bridge, client errors). `tsc -b` clean, `oxlint` 0 warnings, `vite build` OK.
  - Browser (dev server + backend, real 3D scene, real Gnani Timbre narration, **hand-written simulated plan — not LLM output**): health shows teaching not configured; a question falls back to "not available yet" and `/api/teach` returns 503 `LLM_NOT_CONFIGURED`; a 4-step gearbox plan ran in order (focus + highlight → animation → planets + ring → carrier), narration started only after actions settled and steps advanced on real audio end; Pause/Resume/Stop buttons work (audio paused/resumed, nothing dispatched after Stop except restoration); mouse drag paused the plan; model switch cancelled it with no command on the bridge and a late gearbox plan was refused; restoration correct. Found and fixed: parallel TTS prefetch triggered Gnani 429 → requests serialised with one retry (no 429 afterwards).
  - **Live Gemini: NOT RUN** — LLM settings not configured. Run `python scripts/check_llm.py` after adding them.
- **Status**: Implementation complete; **live teaching unverified** pending Gemini configuration. Awaiting review before V5.

### Task V4.1: LLM configuration loading fix (27 Oct 2026)
- **Root cause**: `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY` had been added to the project-root `.env`, but `app/config.py` only read `backend/.env` (which holds `GNANI_API_KEY`). The names, encoding and process environment were fine.
- **Fix**: `config.py` resolves settings from the process environment, then `backend/.env`, then the project-root `.env` (absolute `pathlib` paths from the code location; empty values = missing; `export` prefix tolerated). `resolve_setting()` / `setting_sources()` report sources without values. `scripts/check_llm.py` uses the same mechanism, lists the files it checks, and has `--config-only` (no network). No new dependencies.
- **Tests**: `tests/test_config.py` (15, no network): root-.env case, cwd independence (backend / root / elsewhere), precedence, empty values, missing reporting, Gnani key unchanged, script output and API responses never contain keys, real subprocess runs from `backend/` and the project root. Backend total 96/96.
- **Provider**: Gnani has no public text-generation API (see ARCHITECTURE §11), so the provider was not changed; the configured settings point to Gemini (`gemini-3.5-flash`). Live request not run (awaiting the user's decision).

### Task V4.2: Live Gemini verification (27 Oct 2026) — partially blocked
- **Verified live**: settings resolve from the project-root `.env`; the key authenticates (`GET /models`: 60 models); `gemini-3.5-flash` is available to the key.
- **Defect found live**: the teaching request was rejected with `400 INVALID_ARGUMENT` whenever the full plan schema was sent (`response_format: json_schema`, with or without `strict`, nullable as type arrays or `anyOf`), while the same prompt succeeded in `json_object` mode and small schemas (incl. the action enum) succeeded. Consistent with Gemini's documented schema-complexity limit; the exact keyword could not be isolated before the quota ran out.
- **Fix** (`app/llm.py`): try `json_schema`; on a 400 from the provider retry once in `json_object` mode with the schema appended to the unchanged system prompt, and remember this per (base URL, model). All output still goes through `validate_plan` and the browser validators. New `LLM_QUOTA_EXCEEDED` error (daily quota) distinct from `LLM_RATE_LIMIT`; provider error text (key redacted) kept server-side in `LLMError.detail` and printed by `check_llm.py`, never returned by the API.
- **Tests**: backend 104/104 (+8: fallback once and remembered, fallback output validated identically, unsafe/malformed fallback output rejected, 400 in both modes, other errors do not fall back, quota mapping + redaction); frontend 513/513, `tsc` clean, `oxlint` 0, build OK.
- **Blocked**: Google free-tier limit of 20 generate requests/day for this model was exhausted during diagnosis (Google: retry in ~15.5 h). No real teaching plan has been generated yet; browser end-to-end with a real plan not run.

### Fix: Featured spotlight card expanding vertically (27 Oct 2026)
- **Root cause (verified in the browser)**: CSS layout, on initial render (not hover/focus). The featured card is a grid whose row height is content-sized; its live preview canvas (`ModelPreviewCanvas`) had `height: 100%` (+ `min-height: 320px`), which cannot resolve in a content-sized row, so the canvas used its intrinsic size (the WebGL drawing buffer) and its height scaled with the pane width. Measured before the fix: desktop 1280 px → card 550 px for 450 px of content; stacked layout at 900 px → preview 848×1110 px, card 1565 px. The gearbox did render, but centred in the oversized canvas, so the visible part of the preview looked empty.
- **Fix** (`components/dashboard/HomeDashboard.css` only): the featured preview is absolutely positioned inside its pane (`inset: 0`), so it fills the pane without sizing it; the row height comes from the info pane (or the pane's existing 320 px min-height). Stacked layout (≤ 960 px): preview height `clamp(240px, 42vw, 340px)`. Content, colours, typography and the catalogue cards (already a fixed 200 px header) are unchanged.
- **Verified**: desktop 1280 px → card 455 px (= content), preview fills 420×454 with drawing buffer matching size × device pixel ratio 1.25, stable over time; 900 px → preview 340 px, card 795 px (was 1565); 375 px → preview 240 px, no clipped content, no horizontal scroll; launch button opens the workspace and Catalogue returns. Tests: +2 regression checks in `tests/scrollArchitecture.test.ts`; frontend 515/515, `tsc` clean, `oxlint` 0, build OK.
- **Not verified visually after resizing**: the browser pane stopped painting (window not in front), so the screenshot after the fix and the preview's resize-to-new-size behaviour (`ResizeObserver`, unchanged code) could not be observed; layout was verified by measurement.

### Task V5: Reliable voice interaction, explanations and interruption handling (27 Oct 2026)
- **Diagnosis (traced with real Gnani Prisma transcripts of Timbre-spoken requests, not a microphone)**:
  - Speech recognition was not the failure: Prisma returned the Telugu request almost verbatim ("…ఈ పార్టీని సెలెక్ట్ చేశాను దాన్ని ఎక్స్ప్లెయిన్ చెయ్య"), Hindi and English exactly.
  - Telugu/Hindi requests failed in **intent routing**: the transliterated verb "ఎక్స్ప్లెయిన్" / "एक्सप्लेन" was not in the vocabulary, so the narrative "సెలెక్ట్ చేశాను" / "सेलेक्ट किया है" ("I selected") was parsed as a *select command*: the part was re-selected and the confirmation ("Selected Sun Gear") was caption-only (confirmations were silent by default) — no visible or audible answer. "ఈ" alone ("ఈ పాట ఎందుకు అవసరం", Prisma's mis-hearing of "పార్ట్") and "its role in the entire gearbox" were not recognised as part references.
  - Missing/shallow explanations: answers depended entirely on the LLM (quota exhausted; the V4 schema 400) with nothing but an error otherwise; the dock enabled teaching only if the health check at load time said so; the prompt had no explanation structure and no model-level description.
  - Interruptions: a voice command during an explanation only *paused* the plan (treated as manual takeover) instead of replacing it; the request lifecycle lived in a React hook and could not be tested for races.
- **Implemented**: parser vocabulary for code-mixed EN/TE/HI explanation, purpose and role requests; whole-word Indic demonstratives; "this gearbox" (model) vs "its role in the gearbox" (part); "explain it in Telugu"; explanation controls (pause/continue/stop) only while an explanation is active. `voiceSession`: `onSupersede`, `teachingActive`, empty-transcript reply, `control` status. `teachingController.ts` (new, framework-free lifecycle) + `componentBrief.ts` (new, grounded model-data explanation) + session hook rewritten around them; player selects the plan's part first and re-checks liveness before every action; narrator uses the plan's language and skips stopped/queued clips; dock: teaching always routed, supersede on new requests, mic press pauses at once and resumes if nothing was said, confirmations spoken by default, notice for fallbacks. Backend: `questionType`, `modelDescription`, explanation framework and style in the system prompt.
- **RAG evaluation**: (1) structured metadata + deterministic retrieval — already in place, accurate, ~0 latency/cost, multilingual via the LLM, scales to new models by adding metadata → **chosen**; (2) retrieval from model-specific documents — useful later for deeper operation/failure content, needs curated sources per model; (3) vector RAG — adds a dependency, indexing and grounding risk with no demonstrated gap today; (4) fine-tuning — not justified (component names are already in the scene facts); possible later for style/intent with an evaluation set; (5) hybrid — the natural next step if curated documents are added. RAG not introduced.
- **Tests**: frontend 554/554 (+39 in `tests/voiceV5.test.ts`: routing with real Prisma transcripts in TE/HI/EN, follow-ups across languages, explicit override, model switch, clarification, unknown part, empty transcript, supersede vs follow-up vs control classification, new request interrupts narration, visual command supersedes, late LLM replies, reply after stop, model switch while pending and while playing, rapid requests, quota / not configured / backend down / timeout / invalid plan fallbacks, late TTS never plays, grounded briefs for every part of both models); backend 107/107 (+3); `tsc`, `oxlint`, build clean.
- **Live (real Gnani Prisma + Timbre, real Gemini responses = quota exhausted, browser dev hook with synthesized audio — no microphone)**: Scenario 3 (exact Telugu request) → transcribed, routed to explain the selected sun gear, Gemini 429 → grounded model-data explanation spoken with notice; Scenario 2 (correction) → planet-carrier plan, no stale sun-gear actions; Scenario 4 → narration paused 1 ms after the new speech, plan replaced, ring gear focused; Scenario 5 → plan cancelled on model switch, 0 commands on the bridge, follow-up asks which part. **Not verified**: a real microphone; a live Gemini-generated explanation (quota); Telugu/Hindi AI narration quality.

### Voice-first milestone: multilingual intelligence, navigation and workspace UX (27 Oct 2026)
- **Audit (confirmed)**: the Telugu request's original failure (vocabulary + silent re-select) and the shallow/missing explanations were fixed in V5 and re-verified here with real Prisma output. New findings: (1) switching language without the selector failed because Prisma must be told the language — live, Telugu sent as en-IN came back as "idi asal educ avasar", Hindi as "mujhe pichhe ka drishya dikhao"; (2) camera commands during an explanation cancelled it instead of pausing; (3) "zoom in on this gear" zoomed the scene instead of focusing the part; (4) "show the bottom" was answered as the bridge's "bottom chords"; (5) no LLM help for unparsed natural phrasing; (6) the selected part's facts DO reach the teacher (fact pack verified in tests); Gemini is still blocked by the free-tier daily quota (live 429).
- **Implemented**: `voiceLanguage.ts` (script language detection, same-recording re-transcription in te/hi/en when not understood); reply/teaching language follows the latest request; `previewTurn`; camera-only commands pause instead of supersede; zoom-on-part focus; bottom-view reply; "were missing" failure questions; `/api/interpret` (backend `interpret.py`, fixed intent list, part ids validated) + `interpretClient.ts` canonical phrases through the deterministic parser; analogy guidance in the teaching prompt; English-fallback note; UI: voice tutor states/topic/Stop/examples/M shortcut, inspector "Ask the tutor", webcam compact + above toolbar, docks collapsed at ≤ 1024 px, wrapping hierarchy names.
- **RAG vs fine-tuning**: unchanged recommendation — structured metadata + deterministic retrieval now; curated per-component operation/failure fields next if a gap is shown; document RAG only with a defined trusted corpus per model and an evaluation set; no fine-tuning for facts already in metadata.
- **Tests**: frontend 630/630 (+76: navigation incl. real camera transitions and transition superseding, conversation flow, scenarios A–D, language detection/retry with real Prisma transcripts, interpret mapping for every intent, inspector tutor phrases for every part of both models, fallback language honesty, inspector UI); backend 120/120 (+13 interpret); `tsc`, `oxlint`, build clean.
- **Live (browser dev hook, real Gnani Prisma/Timbre, real Gemini = quota 429)**: Telugu audio with the selector on English → re-transcribed "ఇది అసలు ఎందుకు అవసరం", language switched to Telugu, planet carrier kept, English model-data answer with an explicit note; English "Show me the back." with the selector on Telugu → heard "షో మీ ద బ్యాక్", back view executed, explanation paused; "కొనసాగించు" resumed it; unparsed phrasing → 1 interpret call → quota → honest "didn't understand", nothing executed. **Not verified**: Gemini-written explanations/analogies and LLM interpretation (quota), a real microphone, webcam gestures, the 7 beta languages (STT/TTS round trips verified on 26 Oct; commands/replies remain beta).

