/**
 * Viewer Command Executor (Task V1)
 *
 * Executes the scene commands that act on the Three.js viewer itself: camera motion, component
 * focus/isolation and model animation. Workspace-state commands (selection, visibility, explode,
 * lessons, navigation) are handled by the workspace layer.
 *
 * Arbitration with hands and mouse (the user always wins):
 *  - A camera command arriving while a gesture or mouse drag is steering the camera is DEFERRED
 *    (latest one wins) and runs as soon as the hand/mouse lets go, or expires after PENDING_TTL_MS.
 *  - If a gesture or drag starts while a command transition is animating, the transition is
 *    cancelled on that frame, leaving the camera where the user took it.
 */

import * as THREE from 'three';
import type { CameraController } from '../../components/scene/CameraController';
import type { ModelLifecycleManager } from '../models/modelLifecycle';
import type { CommandHandler, HandlerOutcome } from './sceneCommandDispatcher';
import type { PointerSource, ViewerFacts } from '../scene/sceneFacts';
import {
  CAMERA_MOTION_TYPES,
  type CommandSource,
  type SceneCommand,
  type SceneCommandContext,
  type SceneCommandType,
} from './sceneCommands';

export const PENDING_TTL_MS = 2500;
export const ZOOM_STEP_FACTOR = 0.75; // each "zoom in" step covers 25% of the distance

const VIEWER_TYPES: ReadonlySet<SceneCommandType> = new Set<SceneCommandType>([
  'camera.orbit', 'camera.pan', 'camera.zoom', 'camera.view', 'camera.reset', 'camera.autoOrbit',
  'component.focus', 'component.isolate', 'component.highlight', 'component.clearHighlight',
  'animation.play', 'animation.pause', 'animation.setSpeed',
]);

export interface AnimationControls {
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
}

export interface ViewerCommandTarget {
  camera: CameraController;
  lifecycle: Pick<ModelLifecycleManager, 'getComponentBounds' | 'isolateComponent' | 'getActiveModel' | 'getActiveRuntime'> &
    Partial<Pick<ModelLifecycleManager, 'getRaycaster' | 'getIsolatedComponentId'>>;
  isGestureInteracting: () => boolean;
  animation: AnimationControls;
  setAutoOrbit: (enabled: boolean) => void;
  /** Task V3: live pointer (mouse hover or hand laser) and animation state for the scene snapshot. */
  getPointer?: () => { componentId: string | null; source: PointerSource | null };
  getAnimationState?: () => { playing: boolean; speed: number };
  now?: () => number;
}

interface PendingCommand {
  command: SceneCommand;
  source: CommandSource;
  queuedAt: number;
}

export type DeferredOutcomeReporter = (
  command: SceneCommand,
  source: CommandSource,
  status: 'executed' | 'expired',
  detail?: string
) => void;

export class ViewerCommandExecutor implements CommandHandler {
  public readonly id = 'viewer';
  private pending: PendingCommand | null = null;
  /** Last command-driven focus; cleared when the camera is moved by anything else. */
  private focused: { modelId: string; componentId: string } | null = null;
  private readonly target: ViewerCommandTarget;
  private readonly onDeferredOutcome?: DeferredOutcomeReporter;
  private readonly now: () => number;

  constructor(target: ViewerCommandTarget, onDeferredOutcome?: DeferredOutcomeReporter) {
    this.target = target;
    this.onDeferredOutcome = onDeferredOutcome;
    this.now = target.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  public canHandle(type: SceneCommandType): boolean {
    return VIEWER_TYPES.has(type);
  }

  /** True while a hand gesture or mouse drag is steering the camera. */
  public isUserSteering(): boolean {
    return this.target.isGestureInteracting() || this.target.camera.isUserInteracting();
  }

  public getPending(): SceneCommand | null {
    return this.pending?.command ?? null;
  }

  /** Live facts the viewer knows best, merged into the dispatcher context. */
  public contextProvider = (): Partial<SceneCommandContext> => {
    const runtime = this.target.lifecycle.getActiveRuntime();
    return {
      viewerReady: Boolean(this.target.lifecycle.getActiveModel() && runtime),
      supportsExplodedView: Boolean(runtime?.setExplodedFactor),
      viewerFacts: this.getFacts(),
    };
  };

  /** Task V3: what the viewer knows right now, read from the live objects (never cached copies). */
  public getFacts(): ViewerFacts {
    const { camera, lifecycle } = this.target;
    const modelId = lifecycle.getActiveModel()?.id ?? null;
    const pointer = this.target.getPointer?.() ?? { componentId: null, source: null };
    return {
      hoveredComponentId: pointer.componentId,
      hoverSource: pointer.componentId ? pointer.source : null,
      isolatedComponentId: lifecycle.getIsolatedComponentId?.() ?? null,
      focusedComponentId: this.focused && this.focused.modelId === modelId ? this.focused.componentId : null,
      camera: {
        view: camera.classifyView(),
        autoOrbit: camera.isAutoRotating(),
        transitioning: camera.isTransitioning(),
        userSteering: this.isUserSteering(),
      },
      animation: this.target.getAnimationState?.() ?? { playing: false, speed: 1 },
      highlightedComponentIds: lifecycle.getRaycaster?.()?.getRelatedHighlightIds() ?? [],
      pendingCommand: this.pending !== null,
    };
  }

  public execute(command: SceneCommand, source: CommandSource): HandlerOutcome {
    if (CAMERA_MOTION_TYPES.has(command.type) && this.isUserSteering()) {
      if (this.pending) {
        this.onDeferredOutcome?.(this.pending.command, this.pending.source, 'expired', 'Replaced by a newer camera command.');
      }
      this.pending = { command, source, queuedAt: this.now() };
      return { status: 'deferred', detail: 'Hand or mouse is steering the camera; will run when released.' };
    }
    return this.run(command);
  }

  /**
   * Called once per frame, after gesture input has been applied and before the camera updates.
   * Cancels transitions the user has taken over, and flushes or expires the deferred command.
   */
  public tick(now: number = this.now()): void {
    const steering = this.isUserSteering();
    if (steering && this.target.camera.isTransitioning()) {
      this.target.camera.cancelTransition();
    }
    if (steering) this.focused = null; // the user moved the camera away from the focused part
    if (!this.pending) return;
    if (now - this.pending.queuedAt > PENDING_TTL_MS) {
      const { command, source } = this.pending;
      this.pending = null;
      this.onDeferredOutcome?.(command, source, 'expired', 'Hand or mouse kept steering the camera.');
      return;
    }
    if (!steering) {
      const { command, source } = this.pending;
      this.pending = null;
      const outcome = this.run(command);
      this.onDeferredOutcome?.(command, source, outcome.status === 'executed' ? 'executed' : 'expired', outcome.detail);
    }
  }

  public clearPending(): void {
    this.pending = null;
  }

  private run(command: SceneCommand): HandlerOutcome {
    if (CAMERA_MOTION_TYPES.has(command.type) && command.type !== 'component.focus') this.focused = null;
    const cam = this.target.camera;
    const now = this.now();
    switch (command.type) {
      case 'camera.orbit':
        cam.orbitBy(THREE.MathUtils.degToRad(command.yawDeg), THREE.MathUtils.degToRad(command.pitchDeg ?? 0), undefined, now);
        return { status: 'executed' };
      case 'camera.pan': {
        const a = command.amount ?? 0.15;
        const [right, up] = {
          left: [-a, 0], right: [a, 0], up: [0, a], down: [0, -a],
        }[command.direction] as [number, number];
        cam.panBy(right, up, undefined, now);
        return { status: 'executed' };
      }
      case 'camera.zoom': {
        const steps = command.steps ?? 1;
        const factor = command.direction === 'in' ? Math.pow(ZOOM_STEP_FACTOR, steps) : Math.pow(1 / ZOOM_STEP_FACTOR, steps);
        cam.zoomSmooth(factor, undefined, now);
        return { status: 'executed' };
      }
      case 'camera.view':
        cam.goToView(command.view, undefined, now);
        return { status: 'executed' };
      case 'camera.reset':
        cam.goToView('isometric', undefined, now);
        return { status: 'executed' };
      case 'camera.autoOrbit':
        this.target.setAutoOrbit(command.enabled);
        return { status: 'executed' };
      case 'component.focus': {
        const box = this.target.lifecycle.getComponentBounds(command.componentId);
        const pose = box ? cam.getFocusPose(box) : null;
        if (!pose) return { status: 'rejected', code: 'UNKNOWN_COMPONENT', detail: `No geometry found for "${command.componentId}".` };
        cam.animateTo(pose.position, pose.target, undefined, now);
        const modelId = this.target.lifecycle.getActiveModel()?.id;
        this.focused = modelId ? { modelId, componentId: command.componentId } : null;
        return { status: 'executed' };
      }
      case 'component.highlight':
      case 'component.clearHighlight': {
        const raycaster = this.target.lifecycle.getRaycaster?.();
        if (!raycaster) return { status: 'rejected', code: 'VIEWER_NOT_READY', detail: 'Highlighting is not available yet.' };
        raycaster.setRelatedHighlight(command.type === 'component.highlight' ? command.componentIds : []);
        return { status: 'executed' };
      }
      case 'component.isolate':
        this.target.lifecycle.isolateComponent(command.componentId);
        return { status: 'executed' };
      case 'animation.play':
        this.target.animation.setPlaying(true);
        return { status: 'executed' };
      case 'animation.pause':
        this.target.animation.setPlaying(false);
        return { status: 'executed' };
      case 'animation.setSpeed':
        this.target.animation.setSpeed(command.speed);
        return { status: 'executed' };
      default:
        return { status: 'rejected', code: 'NO_HANDLER', detail: `Viewer cannot handle "${command.type}".` };
    }
  }
}
