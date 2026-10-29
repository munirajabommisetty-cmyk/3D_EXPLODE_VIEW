/**
 * Unified Scene Command Interface (Task V1)
 *
 * One typed vocabulary for every way of operating the 3D workspace — hand gestures, voice,
 * keyboard, toolbar buttons and (later) the AI teacher. Commands are plain data, never code.
 *
 * `validateSceneCommand` treats its input as untrusted (`unknown`) because voice and LLM output
 * will be parsed into commands: it checks the shape, ranges, and — crucially — that every
 * component ID, animation and lesson step really exists in the currently loaded model.
 */

import type { ViewerFacts, WorkspaceFacts } from '../scene/sceneFacts';

/** Views the camera can move to. "bottom" is intentionally absent: the camera is
 *  constrained above the ground grid (OrbitControls maxPolarAngle), so it is unsupported. */
export const CAMERA_VIEWS = ['isometric', 'top', 'front', 'back', 'left', 'right'] as const;
export type CameraViewName = (typeof CAMERA_VIEWS)[number];

export const PAN_DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export type PanDirection = (typeof PAN_DIRECTIONS)[number];

export type ZoomDirection = 'in' | 'out';

export type SceneCommand =
  // Camera
  | { type: 'camera.orbit'; yawDeg: number; pitchDeg?: number }
  | { type: 'camera.pan'; direction: PanDirection; amount?: number }
  | { type: 'camera.zoom'; direction: ZoomDirection; steps?: number }
  | { type: 'camera.view'; view: CameraViewName }
  | { type: 'camera.reset' }
  | { type: 'camera.autoOrbit'; enabled: boolean }
  // Components
  | { type: 'component.select'; componentId: string | null }
  | { type: 'component.focus'; componentId: string }
  | { type: 'component.isolate'; componentId: string | null }
  | { type: 'component.visibility'; componentIds: string[]; visible: boolean }
  | { type: 'component.showAll' }
  // Highlight several components together, e.g. the parts connected to the selected one (Task V3)
  | { type: 'component.highlight'; componentIds: string[] }
  | { type: 'component.clearHighlight' }
  // Assembly
  | { type: 'assembly.explode'; factor: number }
  | { type: 'assembly.restore' }
  // Animation
  | { type: 'animation.play' }
  | { type: 'animation.pause' }
  | { type: 'animation.setSpeed'; speed: number }
  // Guided lessons
  | { type: 'lesson.start' }
  | { type: 'lesson.next' }
  | { type: 'lesson.previous' }
  | { type: 'lesson.goTo'; stepIndex: number }
  | { type: 'lesson.exit' }
  // Workspace navigation
  | { type: 'workspace.switchModel'; modelId: string }
  | { type: 'workspace.goHome' };

export type SceneCommandType = SceneCommand['type'];

/** Who issued a command. Recorded for arbitration, history and future UI feedback. */
export type CommandSource = 'gesture' | 'voice' | 'keyboard' | 'mouse' | 'ui' | 'ai' | 'dev';

/** Commands that move the camera. They are deferred while a hand or the mouse is steering it. */
export const CAMERA_MOTION_TYPES: ReadonlySet<SceneCommandType> = new Set<SceneCommandType>([
  'camera.orbit',
  'camera.pan',
  'camera.zoom',
  'camera.view',
  'camera.reset',
  'component.focus',
]);

export const ALL_COMMAND_TYPES: ReadonlySet<SceneCommandType> = new Set<SceneCommandType>([
  'camera.orbit', 'camera.pan', 'camera.zoom', 'camera.view', 'camera.reset', 'camera.autoOrbit',
  'component.select', 'component.focus', 'component.isolate', 'component.visibility', 'component.showAll',
  'component.highlight', 'component.clearHighlight',
  'assembly.explode', 'assembly.restore',
  'animation.play', 'animation.pause', 'animation.setSpeed',
  'lesson.start', 'lesson.next', 'lesson.previous', 'lesson.goTo', 'lesson.exit',
  'workspace.switchModel', 'workspace.goHome',
]);

/** Live facts about the loaded model and workspace, used to validate every command. */
export interface SceneCommandContext {
  modelId: string | null;
  componentIds: ReadonlySet<string>;
  /** IDs of animations the model genuinely supports (see ModelAnimationCapability). */
  animationIds: readonly string[];
  supportsExplodedView: boolean;
  viewerReady: boolean;
  lesson: { available: boolean; active: boolean; stepCount: number; currentStep: number };
  registeredModelIds: ReadonlySet<string>;
  /** Currently selected component, so inputs like "separate this part" can refer to it (Task V2). */
  selectedComponentId?: string | null;
  /** Live workspace facts for the scene snapshot (Task V3); absent = not reported. */
  workspaceFacts?: WorkspaceFacts;
  /** Live viewer facts for the scene snapshot (Task V3); absent = viewer not mounted. */
  viewerFacts?: ViewerFacts;
}

export const EMPTY_COMMAND_CONTEXT: SceneCommandContext = {
  modelId: null,
  componentIds: new Set(),
  animationIds: [],
  supportsExplodedView: false,
  viewerReady: false,
  lesson: { available: false, active: false, stepCount: 0, currentStep: 0 },
  registeredModelIds: new Set(),
  selectedComponentId: null,
};

export type RejectionCode =
  | 'MALFORMED'
  | 'UNKNOWN_COMMAND'
  | 'INVALID_ARGUMENT'
  | 'UNKNOWN_COMPONENT'
  | 'UNSUPPORTED_ANIMATION'
  | 'UNSUPPORTED_EXPLODED_VIEW'
  | 'VIEWER_NOT_READY'
  | 'NO_LESSON'
  | 'LESSON_NOT_ACTIVE'
  | 'UNKNOWN_MODEL'
  | 'NO_HANDLER';

export type ValidationResult =
  | { ok: true; command: SceneCommand }
  | { ok: false; code: RejectionCode; reason: string };

// Argument limits
export const LIMITS = {
  orbitDeg: 180,
  pitchDeg: 80,
  panAmountMax: 1,
  panAmountDefault: 0.15,
  zoomStepsMax: 5,
  speedMin: 0.1,
  speedMax: 3,
  highlightMax: 20,
} as const;

const reject = (code: RejectionCode, reason: string): ValidationResult => ({ ok: false, code, reason });
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function checkComponent(id: unknown, ctx: SceneCommandContext): ValidationResult | null {
  if (!isStr(id)) return reject('INVALID_ARGUMENT', 'componentId must be a non-empty string.');
  if (!ctx.componentIds.has(id)) {
    return reject('UNKNOWN_COMPONENT', `Component "${id}" does not exist in model "${ctx.modelId ?? 'none'}".`);
  }
  return null;
}

/**
 * Validates and normalises a command against the current scene context.
 * Returns a clean, fully-typed command (defaults filled in) or a rejection with a reason.
 */
export function validateSceneCommand(input: unknown, ctx: SceneCommandContext): ValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return reject('MALFORMED', 'Command must be an object.');
  }
  const c = input as Record<string, unknown>;
  if (typeof c.type !== 'string') return reject('MALFORMED', 'Command is missing a "type".');
  const type = c.type as SceneCommandType;
  if (!ALL_COMMAND_TYPES.has(type)) return reject('UNKNOWN_COMMAND', `Unknown command "${c.type}".`);

  const needsViewer =
    type.startsWith('camera.') || type.startsWith('animation.') ||
    type === 'component.focus' || type === 'component.isolate' ||
    type === 'component.highlight' || type === 'component.clearHighlight';
  if (needsViewer && !ctx.viewerReady) return reject('VIEWER_NOT_READY', 'The 3D viewer is not ready.');

  switch (type) {
    case 'camera.orbit': {
      const yawDeg = c.yawDeg ?? 0;
      const pitchDeg = c.pitchDeg ?? 0;
      if (!isNum(yawDeg) || !isNum(pitchDeg)) return reject('INVALID_ARGUMENT', 'yawDeg/pitchDeg must be numbers.');
      if (Math.abs(yawDeg) > LIMITS.orbitDeg || Math.abs(pitchDeg) > LIMITS.pitchDeg) {
        return reject('INVALID_ARGUMENT', `Orbit limited to ±${LIMITS.orbitDeg}° yaw and ±${LIMITS.pitchDeg}° pitch.`);
      }
      if (yawDeg === 0 && pitchDeg === 0) return reject('INVALID_ARGUMENT', 'Orbit needs a non-zero yaw or pitch.');
      return { ok: true, command: { type, yawDeg, pitchDeg } };
    }
    case 'camera.pan': {
      if (!PAN_DIRECTIONS.includes(c.direction as PanDirection)) {
        return reject('INVALID_ARGUMENT', `Pan direction must be one of ${PAN_DIRECTIONS.join(', ')}.`);
      }
      const amount = c.amount ?? LIMITS.panAmountDefault;
      if (!isNum(amount) || amount <= 0 || amount > LIMITS.panAmountMax) {
        return reject('INVALID_ARGUMENT', `Pan amount must be in (0, ${LIMITS.panAmountMax}].`);
      }
      return { ok: true, command: { type, direction: c.direction as PanDirection, amount } };
    }
    case 'camera.zoom': {
      if (c.direction !== 'in' && c.direction !== 'out') return reject('INVALID_ARGUMENT', 'Zoom direction must be "in" or "out".');
      const steps = c.steps ?? 1;
      if (!Number.isInteger(steps) || (steps as number) < 1 || (steps as number) > LIMITS.zoomStepsMax) {
        return reject('INVALID_ARGUMENT', `Zoom steps must be an integer 1–${LIMITS.zoomStepsMax}.`);
      }
      return { ok: true, command: { type, direction: c.direction, steps: steps as number } };
    }
    case 'camera.view': {
      if (c.view === 'bottom') {
        return reject('INVALID_ARGUMENT', 'Bottom view is not supported: the camera is kept above the ground grid.');
      }
      if (!CAMERA_VIEWS.includes(c.view as CameraViewName)) {
        return reject('INVALID_ARGUMENT', `View must be one of ${CAMERA_VIEWS.join(', ')}.`);
      }
      return { ok: true, command: { type, view: c.view as CameraViewName } };
    }
    case 'camera.reset':
      return { ok: true, command: { type } };
    case 'camera.autoOrbit':
      if (typeof c.enabled !== 'boolean') return reject('INVALID_ARGUMENT', '"enabled" must be true or false.');
      return { ok: true, command: { type, enabled: c.enabled } };

    case 'component.select': {
      if (c.componentId === null) return { ok: true, command: { type, componentId: null } };
      const bad = checkComponent(c.componentId, ctx);
      return bad ?? { ok: true, command: { type, componentId: c.componentId as string } };
    }
    case 'component.focus': {
      const bad = checkComponent(c.componentId, ctx);
      return bad ?? { ok: true, command: { type, componentId: c.componentId as string } };
    }
    case 'component.isolate': {
      if (c.componentId === null) return { ok: true, command: { type, componentId: null } };
      const bad = checkComponent(c.componentId, ctx);
      return bad ?? { ok: true, command: { type, componentId: c.componentId as string } };
    }
    case 'component.visibility': {
      if (!Array.isArray(c.componentIds) || c.componentIds.length === 0) {
        return reject('INVALID_ARGUMENT', 'componentIds must be a non-empty array.');
      }
      if (typeof c.visible !== 'boolean') return reject('INVALID_ARGUMENT', '"visible" must be true or false.');
      for (const id of c.componentIds) {
        const bad = checkComponent(id, ctx);
        if (bad) return bad;
      }
      return { ok: true, command: { type, componentIds: [...new Set(c.componentIds as string[])], visible: c.visible } };
    }
    case 'component.showAll':
      return { ok: true, command: { type } };
    case 'component.highlight': {
      if (!Array.isArray(c.componentIds) || c.componentIds.length === 0) {
        return reject('INVALID_ARGUMENT', 'componentIds must be a non-empty array.');
      }
      if (c.componentIds.length > LIMITS.highlightMax) {
        return reject('INVALID_ARGUMENT', `At most ${LIMITS.highlightMax} components can be highlighted.`);
      }
      for (const id of c.componentIds) {
        const bad = checkComponent(id, ctx);
        if (bad) return bad;
      }
      return { ok: true, command: { type, componentIds: [...new Set(c.componentIds as string[])] } };
    }
    case 'component.clearHighlight':
      return { ok: true, command: { type } };

    case 'assembly.explode': {
      if (!ctx.supportsExplodedView) return reject('UNSUPPORTED_EXPLODED_VIEW', 'This model has no exploded view.');
      if (!isNum(c.factor) || c.factor < 0 || c.factor > 1) return reject('INVALID_ARGUMENT', 'Explode factor must be between 0 and 1.');
      return { ok: true, command: { type, factor: c.factor } };
    }
    case 'assembly.restore':
      if (!ctx.supportsExplodedView) return reject('UNSUPPORTED_EXPLODED_VIEW', 'This model has no exploded view.');
      return { ok: true, command: { type } };

    case 'animation.play':
    case 'animation.pause':
      if (ctx.animationIds.length === 0) {
        return reject('UNSUPPORTED_ANIMATION', `Model "${ctx.modelId ?? 'none'}" has no playable animation.`);
      }
      return { ok: true, command: { type } };
    case 'animation.setSpeed': {
      if (ctx.animationIds.length === 0) {
        return reject('UNSUPPORTED_ANIMATION', `Model "${ctx.modelId ?? 'none'}" has no playable animation.`);
      }
      if (!isNum(c.speed) || c.speed < LIMITS.speedMin || c.speed > LIMITS.speedMax) {
        return reject('INVALID_ARGUMENT', `Speed must be between ${LIMITS.speedMin} and ${LIMITS.speedMax}.`);
      }
      return { ok: true, command: { type, speed: c.speed } };
    }

    case 'lesson.start':
      if (!ctx.lesson.available) return reject('NO_LESSON', 'No guided lesson exists for this model.');
      return { ok: true, command: { type } };
    case 'lesson.next':
    case 'lesson.previous':
    case 'lesson.exit':
      if (!ctx.lesson.active) return reject('LESSON_NOT_ACTIVE', 'No guided lesson is running.');
      return { ok: true, command: { type } };
    case 'lesson.goTo': {
      if (!ctx.lesson.active) return reject('LESSON_NOT_ACTIVE', 'No guided lesson is running.');
      if (!Number.isInteger(c.stepIndex) || (c.stepIndex as number) < 0 || (c.stepIndex as number) >= ctx.lesson.stepCount) {
        return reject('INVALID_ARGUMENT', `Lesson step must be 0–${ctx.lesson.stepCount - 1}.`);
      }
      return { ok: true, command: { type, stepIndex: c.stepIndex as number } };
    }

    case 'workspace.switchModel':
      if (!isStr(c.modelId) || !ctx.registeredModelIds.has(c.modelId)) {
        return reject('UNKNOWN_MODEL', `Model "${String(c.modelId)}" is not registered.`);
      }
      return { ok: true, command: { type, modelId: c.modelId } };
    case 'workspace.goHome':
      return { ok: true, command: { type } };
  }
  return reject('UNKNOWN_COMMAND', `Unknown command "${c.type}".`);
}
