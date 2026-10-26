# AI Development & Collaboration Rules

## Project: Gesture-Controlled 3D Machine Explorer

These engineering rules govern all AI-assisted development across this repository. Both human engineers and AI pair programmers must strictly adhere to these directives.

---

## 1. Documentation & Context Discipline

1. **Read Before Writing**: Always read relevant project documentation (`README.md`, `ARCHITECTURE.md`, `docs/PRD.md`, `docs/DESIGN.md`, `docs/TASKS.md`) before writing or modifying code.
2. **Inspect Existing Implementations First**: Never guess APIs, file structures, or exported symbols. Inspect existing files and reuse existing patterns.
3. **Keep Docs Synchronized**: Whenever an architectural decision, interface, schema, or user flow changes, immediately update the corresponding document in `docs/`.

---

## 2. Incremental Work & Scope Isolation

1. **One Task at a Time**: Work strictly on the current task specified by the user or defined in `docs/TASKS.md`. Never jump ahead to subsequent phases without explicit user instruction.
2. **Explain Before Changing**: Before making substantial modifications or creating new modules, explain the intended implementation plan and its architectural rationale.
3. **Zero Unrelated Changes**: Never modify files, refactor unrelated modules, or change dependencies outside the immediate task scope.
4. **Strict Workspace Boundaries**: All operations for this project are strictly isolated to `c:\Users\munir\Music\folder1\CV_3D_GESTURE\`. Never touch or reference files outside this directory.

---

## 3. Data Protection, Safety & Secrets

1. **Never Overwrite User Work Without Permission**: Files containing user experiments, models, notes, or code (such as `ipy_kernel.ipynb`) must never be deleted, modified, or overwritten without explicit written authorization.
2. **Never Expose Secrets**: Never read, print, commit, or log environment variables from `.env` files. Ensure `.env*` remains safely covered by `.gitignore`.
3. **No Destructive Git Operations**: Do not run `git reset --hard`, `git clean -f`, or rewrite Git history without explicit user instruction, especially when uncommitted work exists.

---

## 4. Code Quality & Modularity Standards

1. **Strict TypeScript & Python Typing**: Avoid `any` in TypeScript and untyped parameters in Python. Use explicit interfaces and Pydantic/dataclass models for data contracts.
2. **Modular Decoupling**: Keep 3D graphics rendering, computer vision detection, gesture interpretation, and UI state logically separated behind typed interfaces.
3. **Fail Gracefully**: Every external interaction (webcam capture, model loading, WebGL context, WebSocket connection) must have explicit error boundaries and user-facing fallbacks.
4. **No Fictitious Implementations**: Never insert hardcoded mock data pretending to be a working ML model or CV pipeline without explicitly labeling it as a temporary mock.

---

## 5. Verification & Honesty

1. **Run Real Tests & Report Truthful Results**: After implementing code, execute the appropriate test or build command. Report the exact output, exit codes, and errors encountered.
2. **Never Claim Unexecuted Tests Passed**: Never state or imply that code was verified, compiled, or tested if the command was not actually executed and validated.
3. **Investigate Errors Before Fixing**: When an error occurs, diagnose its root cause rather than applying haphazard, trial-and-error workarounds.
4. **Ask When Ambiguous**: If an architectural requirement, user preference, or model constraint is ambiguous, ask the user for clarification before assuming.
