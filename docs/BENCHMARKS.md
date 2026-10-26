# Performance Benchmarks & Telemetry Specifications

## Project: Gesture-Controlled 3D Machine Explorer
**Status:** Baseline Specification & Telemetry Engine Ready | Physical Hardware Measurement: **NOT YET MEASURED**

---

## 1. Executive Summary & Design Targets

The Gesture-Controlled 3D Machine Explorer requires deterministic real-time performance to prevent user disorientation, simulation stutter, or ergonomic hand fatigue ("gorilla arm"). This document specifies the benchmarking methodology, mathematical definitions, execution protocols, and results table.

| Metric | Minimum Target | Optimal Target | Status |
| :--- | :---: | :---: | :---: |
| **WebGL Render Framerate** | $\ge 60\text{ FPS}$ | $\ge 60\text{ FPS}$ (V-Sync) | *NOT YET MEASURED* |
| **Render Frame Time (P95)** | $\le 16.67\text{ ms}$ | $\le 12.0\text{ ms}$ | *NOT YET MEASURED* |
| **Vision Tracking Framerate** | $\ge 30\text{ FPS}$ | $30\text{--}60\text{ FPS}$ | *NOT YET MEASURED* |
| **Vision Processing Duration** | $< 33.3\text{ ms}$ | $\le 20.0\text{ ms}$ | *NOT YET MEASURED* |
| **App-Level Pipeline Latency (P95)** | $\le 50.0\text{ ms}$ | $\le 30.0\text{ ms}$ | *NOT YET MEASURED* |
| **Memory Heap Drift (15 min run)** | $\le 10\text{ MB}$ growth | Flat / steady-state | *NOT YET MEASURED* |

---

## 2. Metric Definitions & Formulas

### 2.1 WebGL Render Performance
- **Frame Delta ($\Delta t_{\text{render}}$)**:
  $$\Delta t_{\text{render}} = T_{\text{frame}, n} - T_{\text{frame}, n-1}$$
  Measured via high-resolution `performance.now()` at the beginning of each `requestAnimationFrame` tick.
- **Render FPS**:
  $$\text{FPS}_{\text{render}} = \frac{N_{\text{frames}}}{\sum_{i=1}^{N} \Delta t_{i}} \times 1000$$
  Accumulated over a rolling 500–1000 ms sliding window to smooth out instantaneous timing jitter.
- **Percentiles (P50, P95, P99)**:
  Computed via nearest-rank sorting on a bounded 120-sample circular buffer (`RollingWindowStats`).

### 2.2 Computer Vision Tracking Performance
- **Landmark Inference Duration ($t_{\text{inference}}$)**:
  $$t_{\text{inference}} = T_{\text{infer\_end}} - T_{\text{infer\_start}}$$
  Execution time of MediaPipe `HandLandmarker.detectForVideo()` processing the latest webcam video frame.
- **Landmark Temporal Smoothing Duration ($t_{\text{smooth}}$)**:
  $$t_{\text{smooth}} = T_{\text{filter\_end}} - T_{\text{filter\_start}}$$
  Execution time of the One Euro Filter (`MultiHandOneEuroFilter.filterHands()`) updating state across all detected hand landmarks.
- **Combined Vision Processing Duration ($t_{\text{vision}}$)**:
  $$t_{\text{vision}} = t_{\text{inference}} + t_{\text{smooth}}$$
  Must remain $< 33.3\text{ ms}$ per frame to sustain real-time 30 FPS video tracking.
- **Vision Tracking FPS**:
  $$\text{FPS}_{\text{tracking}} = \frac{N_{\text{vision\_frames}}}{\Delta T_{\text{window}}} \times 1000$$

### 2.3 Application-Level Pipeline Latency
- **Pipeline Latency ($L_{\text{pipeline}}$)**:
  $$L_{\text{pipeline}} = T_{\text{scene\_applied}} - T_{\text{capture\_timestamp}}$$
  Measures the elapsed duration from when a video frame is timestamped by the webcam vision pipeline to when the resulting hand transform or raycast selection is applied to the Three.js scene graph.
- **Scope & Exclusions**:
  - **INCLUDED**: MediaPipe WASM inference, One Euro Filter temporal smoothing, state machine debouncing, coordinate screen projection, Three.js spherical camera update, and mesh raycast highlighting.
  - **EXCLUDED**: Physical CMOS sensor exposure, camera internal ISP processing, USB bus transfer to host, OS kernel video decoding, and GPU display scanout to physical monitor pixels.

---

## 3. Hardware & Software Test Environment Fields

When physical benchmarking is conducted, the test operator must record the following hardware and environment details:

```yaml
Client Machine:
  Host OS: Windows 11 / macOS / Linux
  CPU: [Model, e.g. Intel Core i7 / AMD Ryzen 7 / Apple Silicon]
  RAM: [e.g. 16 GB DDR4/DDR5]
  GPU: [e.g. NVIDIA RTX 3070 / Integrated Intel Iris Xe]
  Webcam: [Model, e.g. Logitech C920 / Integrated 720p 30 FPS USB Webcam]
  Native Display Resolution: [e.g. 1920x1080 @ 60 Hz / 144 Hz]

Software Environment:
  Browser: [e.g. Google Chrome 124.0 / Edge / Firefox]
  WebGL Version: [WebGL 2.0 (OpenGL ES 3.0)]
  MediaPipe Vision Version: 1.1.1
  Three.js Version: 0.174.0
  Video Feed Resolution: 640x480 @ 30 FPS
```

---

## 4. Benchmark Measurement Protocols

### Protocol B-1: Continuous 3D Scene Rotation (Render FPS)
1. **Setup**: Launch the application in a production build (`npm run preview` or deployed URL).
2. **Procedure**:
   - Enable `autoRotate` or hold a stable `OPEN_PALM` gesture to continuously orbit the planetary gearbox assembly for 60 seconds.
   - Sample render metrics via `defaultTelemetry.render.getSnapshot()`.
3. **Pass Criteria**:
   - Average Render FPS $\ge 60\text{ FPS}$.
   - P95 Frame Time $\le 16.67\text{ ms}$.

### Protocol B-2: Active Hand Tracking & Inference (Vision Tracking FPS)
1. **Setup**: Position hand in standard desk lighting ($40\text{--}70\text{ cm}$ distance).
2. **Procedure**:
   - Perform continuous hand movements across `OPEN_PALM`, `POINTING`, and `PINCH` poses for 60 seconds.
   - Record `defaultTelemetry.vision.getSnapshot()`.
3. **Pass Criteria**:
   - Tracking FPS $\ge 30\text{ FPS}$.
   - Average Vision Processing Time $< 25\text{ ms}$ (P95 $< 33.3\text{ ms}$).

### Protocol B-3: Memory Leak & Heap Stability Profiling
1. **Setup**: Open Chrome DevTools $\to$ *Memory* panel $\to$ *Allocation instrumentation on timeline*.
2. **Procedure**:
   - Run the application with active camera tracking and continuous 3D rendering for 15 minutes.
   - Take heap snapshots at $t = 1\text{ min}$, $t = 5\text{ min}$, and $t = 15\text{ min}$.
3. **Pass Criteria**:
   - Zero detached DOM elements from HUD modals or cursors.
   - Zero unretained Three.js geometries, textures, or materials.
   - JS heap memory stabilizes at steady state ($\le 10\text{ MB}$ variation after initial asset warmup).

---

## 5. Known Measurement Limitations

1. **Browser Timer Precision**: High-resolution timers (`performance.now()`) are clamped by modern browsers (typically to $0.1\text{ ms}$ or $1\text{ ms}$) to mitigate Spectre and side-channel timing attacks.
2. **Hardware In-The-Loop**: Glass-to-glass (end-to-end user perception) latency requires high-speed external camera recording (e.g. 240 FPS or 1000 FPS camera filming user hand movement simultaneously with display pixels). The software telemetry pipeline explicitly isolates application-level latency.
3. **Headless CI Testing**: Automated unit tests validate the mathematical correctness of bounded buffers, windowed rate estimators, and percentile calculations using synthetic deterministic clock ticks, but cannot replace physical GPU/webcam benchmark runs.

---

## 6. Actual Benchmark Results Table

> [!NOTE]
> Physical hardware benchmarking has not yet been executed in this environment. The table below represents the benchmark template awaiting physical test execution on target hardware.

| Test Scenario | Render FPS (Avg) | Render FrameTime (P95) | Tracking FPS (Avg) | Inference Time (Avg) | Pipeline Latency (P95) | Heap Drift | Result Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Idle 3D Viewport** | *NOT YET MEASURED* | *NOT YET MEASURED* | N/A | N/A | N/A | *NOT YET MEASURED* | Pending |
| **Continuous Orbit (Mouse)** | *NOT YET MEASURED* | *NOT YET MEASURED* | N/A | N/A | N/A | *NOT YET MEASURED* | Pending |
| **Live Vision Tracking (Static Hand)** | *NOT YET MEASURED* | *NOT YET MEASURED* | *NOT YET MEASURED* | *NOT YET MEASURED* | *NOT YET MEASURED* | *NOT YET MEASURED* | Pending |
| **Active Gesture Manipulation (Orbit/Zoom)** | *NOT YET MEASURED* | *NOT YET MEASURED* | *NOT YET MEASURED* | *NOT YET MEASURED* | *NOT YET MEASURED* | *NOT YET MEASURED* | Pending |
| **15-Min Continuous Stress Test** | *NOT YET MEASURED* | *NOT YET MEASURED* | *NOT YET MEASURED* | *NOT YET MEASURED* | *NOT YET MEASURED* | *NOT YET MEASURED* | Pending |
