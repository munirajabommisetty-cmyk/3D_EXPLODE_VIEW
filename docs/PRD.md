# Product Requirements Document (PRD)

## Project: Gesture-Controlled 3D Machine Explorer

---

## 1. Problem Statement

Interacting with complex 3D Computer-Aided Design (CAD) and mechanical engineering models typically requires specialized workstation software, two-button mouse chording, and complex keyboard modifiers. This input barrier creates friction for students, educators, and design reviewers who need an intuitive, spatial way to inspect machinery. 

Furthermore, in manufacturing, cleanroom, and educational exhibition contexts, physical mice or keyboards may be impractical or unhygienic. **Gesture-Controlled 3D Machine Explorer** solves this by providing a zero-install, browser-based 3D mechanical assembly viewer controlled entirely via natural hand gestures captured by a standard consumer webcam.

---

## 2. Target Users & Needs

| User Persona | Key Needs | Primary Pain Point Addressed |
| :--- | :--- | :--- |
| **Mechanical Engineering Student** | Inspect sub-assemblies (e.g., gears, shafts, bearings) in 3D to understand mechanical motion and relationships. | Complex desktop CAD tools require heavy licenses and steep learning curves just to inspect an assembly. |
| **STEM Educator / Presenter** | Present mechanical mechanisms in a classroom or lecture using intuitive contactless physical gestures. | Awkward mouse-clicking at a podium detracts from presentation flow and spatial engagement. |
| **Interactive Exhibition Visitor** | Touchless, immediate engagement with a virtual 3D machine kiosk without touching shared peripherals. | Contactless hygiene and immediate, friction-free interaction without training. |

---

## 3. Product Goals & Measurable Success Criteria

> [!NOTE]
> All quantitative metrics listed below represent **proposed design targets**, not verified or currently achieved results.

1. **Goal 1: Frictionless Access**: Run entirely in modern desktop web browsers without specialized hardware or native desktop installations.
   - *Target*: First contentful paint of the 3D scene in $< 3.0\text{ seconds}$ on broadband connections.
2. **Goal 2: Real-Time Landmark Tracking**: Detect 21 3D hand landmarks using standard $720\text{p}/1080\text{p}$ webcams.
   - *Target*: Maintain $\ge 30\text{ FPS}$ landmark tracking on modern commodity quad-core CPUs.
3. **Goal 3: Interactive Latency**: Enable real-time manipulation without motion sickness or perceptible lag.
   - *Proposed Target*: Glass-to-mesh response latency $< 100\text{ ms}$ (from hand motion to 3D mesh transformation).
4. **Goal 4: Gesture Disambiguation**: Recognize basic gestures reliably under reasonable indoor lighting.
   - *Proposed Target*: $\ge 90\%$ classification accuracy for steady-state poses (`OPEN_PALM`, `POINTING`, `PINCH`).
5. **Goal 5: Component Inspection Clarity**: Provide 100% accurate component identification and structural metadata upon raycast selection.

---

## 4. Scope: MVP vs. Future Enhancements

### 4.1 In Scope for MVP
- Interactive 3D scene rendering a multi-part mechanical assembly (e.g. planetary gearbox, engine, or transmission).
- Webcam stream initialization with explicit user permission handling and status indicators.
- Pretrained MediaPipe Hand Landmarker integration tracking 21 landmarks.
- Geometric, rule-based gesture recognition for:
  - **Open Palm**: Rotate/orbit the 3D machine.
  - **Pointing (Index extended)**: Steer a 3D raycasting cursor to hover and highlight parts.
  - **Pinch (Thumb-Index contact)**: Zoom camera / dolly or trigger component selection.
  - **Idle / Neutral**: Hand absent or resting posture without inadvertent scene movement.
- Jitter reduction via temporal smoothing (Exponential Moving Average / One Euro Filter).
- Interactive component inspection panel (name, material, mechanical function, specifications).
- Persistent mouse and keyboard fallback controls for testing and accessibility.

### 4.2 Out of Scope for MVP (Future Enhancements)
- Custom-trained ML gesture classifier (deferred to Phase 7 experiment sandbox).
- Multi-hand bimanual interaction (e.g., one hand rotates, other hand zooms).
- Exploded-view mechanical simulation with physics engines.
- AI/LLM-powered conversational component explanation (deferred to Phase 8).
- User authentication, cloud database storage, or multi-user collaboration.
- Mobile browser optimization (desktop browsers prioritized for initial performance).

---

## 5. Core User Journeys

```mermaid
journey
    title Core User Journey: Exploring an Engine Assembly via Gestures
    section Onboarding
      Open web application: 5: User
      Grant camera permission: 4: User
      View webcam preview & gesture cheat sheet: 5: User
    section 3D Navigation
      Raise open palm to rotate assembly: 5: User
      Move hand laterally to inspect rear casing: 4: User
      Pinch fingers to zoom into central shaft: 4: User
    section Component Inspection
      Point index finger toward planetary gear: 5: User
      Observe emissive highlight on hovered gear: 5: User
      Hold point / pinch to lock selection: 5: User
      Read mechanical specifications in HUD: 4: User
    section Recovery & Fallback
      Drop hand; camera smoothly settles (no snapping): 5: User
      Toggle mouse mode for fine cursor control: 4: User
```

---

## 6. Functional Requirements

| ID | Requirement | Priority | Verification Method |
| :--- | :--- | :---: | :--- |
| **FR-01** | Prompt for camera permission and provide clear visual status (Connecting, Active, Permission Denied, No Camera). | P0 | Browser permission mock test |
| **FR-02** | Capture webcam video feed and mirror horizontally for intuitive eye-hand coordination. | P0 | Visual inspection |
| **FR-03** | Run pretrained MediaPipe Hand Landmarker producing 21 3D coordinates $(x, y, z)$ per frame. | P0 | Automated landmark schema test |
| **FR-04** | Smooth raw landmark positions across frames to suppress tremor and high-frequency noise. | P0 | Filter jitter benchmark |
| **FR-05** | Classify core hand poses (`OPEN_PALM`, `POINTING`, `PINCH`, `IDLE`) using deterministic geometric rules. | P0 | Unit tests against synthetic landmark poses |
| **FR-06** | Map `OPEN_PALM` hand translation to 3D scene orbit (pitch and yaw rotations). | P0 | Interactive manual test |
| **FR-07** | Map `PINCH` distance delta to camera dolly (zoom in / zoom out). | P0 | Interactive manual test |
| **FR-08** | Map `POINTING` landmark to normalized screen coordinates and perform Three.js raycasting against scene meshes. | P0 | Raycast intersection unit & manual test |
| **FR-09** | Highlight hovered component with outline or emissive shader; display part name in tooltip. | P0 | Visual test |
| **FR-10** | Open side panel displaying selected component engineering metadata upon deliberate selection. | P0 | Component test |
| **FR-11** | Support full mouse drag, wheel zoom, and click selection concurrently as fallback. | P0 | Accessibility & keyboard/mouse test |
| **FR-12** | Implement clutch / deadband: small unintentional tremors ($< \text{threshold}$) produce zero camera movement. | P1 | Interaction stability test |

---

## 7. Non-Functional Requirements

- **NFR-01: Responsiveness & Framerate**: The 3D render loop must maintain $\ge 60\text{ FPS}$ on standard integrated GPUs (e.g. Intel Iris Xe / Apple M-series / AMD Radeon). Hand tracking should maintain $\ge 30\text{ FPS}$.
- **NFR-02: Latency**: Proposed glass-to-mesh interaction latency should not exceed $100\text{ ms}$.
- **NFR-03: Privacy & Security**: All webcam frames must be processed strictly within the local client runtime. No video frames, image data, or biometrics may be transmitted over network connections or stored permanently.
- **NFR-04: Cross-Platform Compatibility**: Operable on modern desktop versions of Google Chrome, Microsoft Edge, and Mozilla Firefox on Windows, macOS, and Linux.
- **NFR-05: Modularity & Separation of Concerns**: Landmark extraction, gesture interpretation, and 3D rendering must be isolated behind typed interfaces so any layer can be mocked or swapped without breaking others.

---

## 8. Assumptions & Open Questions

### Assumptions
1. The user's operating environment has a functioning webcam ($720\text{p}$ or higher) and adequate ambient indoor lighting.
2. The user has WebGL 2.0-compatible graphics hardware and modern browser drivers.
3. A modular mechanical 3D model with clean, individually addressable mesh sub-assemblies can be authored or imported.

### Open Questions
1. **Detection Runtime Location**: Can MediaPipe Web SDK (`@mediapipe/tasks-vision`) achieve satisfactory framerates directly in browser WebAssembly/WebGL, or is a native Python backend required? *(Evaluated in `ARCHITECTURE.md` and `docs/DECISIONS.md`)*.
2. **Model Asset Source**: Should the initial mechanical model be procedurally generated via Three.js primitives (gears, shafts, cylinders) to avoid large binary asset downloads, or loaded from an optimized `.glb` asset?
3. **Selection Confirmation**: Should part selection occur via a dwell timer (holding pointing pose on a part for 1.5 seconds) or via an explicit pinch action?
