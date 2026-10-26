# Security & Privacy Policy

## Project: Gesture-Controlled 3D Machine Explorer

---

## 1. Core Privacy Principle: Zero Remote Transmission of Video

The fundamental privacy guarantee of this project is that **raw webcam video feeds never leave the user's local device**.

- **Local-First Processing**: All computer vision inference (MediaPipe Hand Landmarker), frame reading, landmark coordinate extraction, and gesture classification occur strictly inside the user's local client runtime (in-browser WebAssembly/WebGL or local host loopback).
- **No Video Recording or Storage**: Webcam frames are analyzed in transient memory buffers on a per-frame basis and immediately overwritten. No video clips, snapshots, or biometric images are ever saved to disk or transmitted across external networks.
- **Explicit Permission**: Webcam access requires explicit browser permission via standard W3C `navigator.mediaDevices.getUserMedia` APIs. The user can revoke access at any time through standard browser site settings.

---

## 2. Secrets & Configuration Management

1. **Environment Variables**:
   - Configuration files such as `.env`, `.env.local`, and any credential files must be strictly excluded from version control via `.gitignore`.
   - The repository must never contain hardcoded API tokens, credentials, or private file paths.
2. **Local AI / Ollama Configuration**:
   - The project utilizes locally hosted models (e.g. Ollama running on `localhost:11434`), eliminating the need for paid commercial cloud API keys (e.g. OpenAI, Anthropic) during initial development.
   - If an optional cloud LLM integration is evaluated in the future, keys must be loaded exclusively via runtime environment variables and never bundled into frontend client distributions.

---

## 3. Dependency Safety & Supply Chain

1. **Minimal Dependencies**:
   - Avoid bloated third-party utility packages. Use standard browser and language APIs wherever practical.
2. **Package Auditing**:
   - Maintain lockfiles (`package-lock.json` or `pnpm-lock.yaml` for Node, `uv.lock` or pinned `requirements.txt` for Python).
   - Periodically execute automated dependency vulnerability scans:
     ```bash
     npm audit
     pip-audit
     ```
3. **Official Model Sources**:
   - Pretrained MediaPipe models must be loaded exclusively from official Google MediaPipe CDNs or bundled directly as verified static assets within the project.

---

## 4. Input Validation & IPC Boundaries

1. **Gesture Event Sanitization**:
   - Coordinate data consumed by the 3D scene must be validated against expected bounds:
     - Landmark normalized coordinates: $x, y \in [0.0, 1.0]$.
     - Screen NDC: $x, y \in [-1.0, 1.0]$.
     - Non-finite values (`NaN`, `Infinity`) must be caught and discarded before reaching Three.js matrix transforms.
2. **WebSocket Gateway (when used in Phase 7/8)**:
   - WebSocket servers running in Python must bind strictly to the local loopback interface (`127.0.0.1` / `localhost`) and never to public interfaces (`0.0.0.0`).
   - Validate incoming and outgoing message payloads against strict Pydantic schemas.

---

## 5. Potential Risks in Future Phases & Mitigations

| Future Feature | Potential Security/Privacy Risk | Mitigation Strategy |
| :--- | :--- | :--- |
| **Phase 7: Labeled Data Collection** | Storing landmark datasets might inadvertently capture sensitive user biometrics. | Record only normalized, relative joint coordinates (21 floating-point vectors); never store raw video or RGB images in dataset files. |
| **Phase 8: Local LLM Integration** | Prompt injection via user input; accidental exposure of local system files. | Enforce rigid system prompt templates; restrict the LLM to predefined mechanical engineering schemas; strictly read-only execution. |
| **Phase 8: Local Port Exposure** | Running a local HTTP/WebSocket server could expose an unauthenticated endpoint on the local network. | Bind strictly to `127.0.0.1`; apply Origin header checks on incoming WebSocket connections. |
