/**
 * Scene snapshot (Task V3): one typed, serialisable description of what the 3D workspace shows
 * right now — for context-aware voice commands today and the AI teacher (V4) later.
 *
 * Built on demand from the dispatcher's live context providers (no cached copies), so it always
 * reflects the current scene. It contains IDs, names and states only: no geometry, no Three.js
 * objects, no credentials.
 *
 * Unavailable vs empty: facts the viewer owns are wrapped in `Fact<T>`. `{ status: 'known',
 * value: null }` means "known to be nothing" (e.g. nothing is hovered); `{ status: 'unavailable' }`
 * means the information cannot be read (e.g. the 3D viewer is not mounted yet).
 */

import type { SceneCommandDispatcher } from '../commands/sceneCommandDispatcher';
import type { CameraViewName, SceneCommandContext, SceneCommandType } from '../commands/sceneCommands';
import type { EngineeringModelDefinition } from '../../types/models';
import type { PointerSource } from './sceneFacts';
import { getRelatedComponentIds } from './componentRelationships';

export const SCENE_SNAPSHOT_VERSION = 1;

export type Fact<T> = { status: 'known'; value: T } | { status: 'unavailable'; reason: string };

const known = <T>(value: T): Fact<T> => ({ status: 'known', value });
const unavailable = <T>(reason: string): Fact<T> => ({ status: 'unavailable', reason });

export interface SnapshotComponent {
  id: string;
  name: string;
  role: string | null;
  visible: boolean;
  /** IDs of directly related components recorded in the model ([] = none recorded). */
  relatedComponentIds: string[];
}

export interface SceneSnapshot {
  version: typeof SCENE_SNAPSHOT_VERSION;
  capturedAt: number;
  model: { id: string; name: string; domain: string; category: string } | null;
  components: SnapshotComponent[];
  selectedComponentId: string | null;
  pointer: Fact<{ componentId: string | null; source: PointerSource | null }>;
  focusedComponentId: Fact<string | null>;
  hiddenComponentIds: string[];
  isolatedComponentId: Fact<string | null>;
  highlightedComponentIds: Fact<string[]>;
  exploded: { supported: boolean; factor: number; active: boolean };
  camera: Fact<{
    view: CameraViewName | 'custom';
    autoOrbit: boolean;
    transitioning: boolean;
    userSteering: boolean;
    /** Task V4: no camera transition running and no deferred camera command waiting. */
    settled: boolean;
  }>;
  animation: {
    available: { id: string; label: string }[];
    state: Fact<{ playing: boolean; speed: number }>;
  };
  lesson: {
    available: boolean;
    active: boolean;
    stepCount: number;
    /** 0-based index of the current step, null when no lesson is running. */
    currentStep: number | null;
    stepTitle: string | null;
    stepComponentId: string | null;
  };
  /** Last component discussed in the voice conversation; unavailable when there is no conversation. */
  lastDiscussedComponentId: Fact<string | null>;
  /** Command types that can succeed for this model right now (capabilities, not permissions). */
  availableActions: SceneCommandType[];
}

export interface SnapshotExtras {
  /** Conversation memory owned by the caller (e.g. the voice dock); omit if there is none. */
  lastDiscussed?: { modelId: string; componentId: string } | null;
  now?: number;
}

/** Keeps an ID only if it belongs to the loaded model (guards against stale references). */
const inModel = (id: string | null | undefined, ids: ReadonlySet<string>): string | null => (id && ids.has(id) ? id : null);

export function buildSceneSnapshot(
  ctx: SceneCommandContext,
  model: EngineeringModelDefinition | null | undefined,
  extras: SnapshotExtras = {}
): SceneSnapshot {
  const activeModel = model && ctx.modelId === model.id ? model : null;
  const ids = activeModel ? ctx.componentIds : new Set<string>();
  const ws = ctx.workspaceFacts;
  const vf = ctx.viewerFacts;
  const viewerUp = Boolean(vf && ctx.viewerReady);
  const noViewer = 'The 3D viewer is not ready.';

  const hidden = (ws?.hiddenComponentIds ?? []).filter((id) => ids.has(id));
  const isolated = viewerUp ? inModel(vf!.isolatedComponentId, ids) : null;
  const components: SnapshotComponent[] = activeModel
    ? activeModel.getAllComponentIds().map((id) => {
        const meta = activeModel.getComponentMetadata(id);
        return {
          id,
          name: meta?.name ?? id,
          role: meta?.role ?? null,
          visible: !hidden.includes(id) && (!isolated || isolated === id),
          relatedComponentIds: getRelatedComponentIds(activeModel, id),
        };
      })
    : [];

  const explodedFactor = ws?.explodedFactor ?? 0;
  const lessonActive = ctx.lesson.active;

  const actions: SceneCommandType[] = [];
  if (activeModel) {
    actions.push('component.select', 'component.visibility', 'component.showAll');
    if (ctx.viewerReady) {
      actions.push('camera.orbit', 'camera.pan', 'camera.zoom', 'camera.view', 'camera.reset', 'camera.autoOrbit',
        'component.focus', 'component.isolate', 'component.highlight', 'component.clearHighlight');
      if (ctx.animationIds.length > 0) actions.push('animation.play', 'animation.pause', 'animation.setSpeed');
    }
    if (ctx.supportsExplodedView) actions.push('assembly.explode', 'assembly.restore');
    if (ctx.lesson.available) actions.push('lesson.start');
    if (lessonActive) actions.push('lesson.next', 'lesson.previous', 'lesson.goTo', 'lesson.exit');
  }
  if (ctx.registeredModelIds.size > 1) actions.push('workspace.switchModel');
  actions.push('workspace.goHome');

  const lastDiscussed = extras.lastDiscussed === undefined
    ? unavailable<string | null>('No conversation context.')
    : known(extras.lastDiscussed && activeModel && extras.lastDiscussed.modelId === activeModel.id
        ? inModel(extras.lastDiscussed.componentId, ids)
        : null);

  return {
    version: SCENE_SNAPSHOT_VERSION,
    capturedAt: extras.now ?? Date.now(),
    model: activeModel
      ? { id: activeModel.id, name: activeModel.name, domain: activeModel.domain, category: activeModel.category }
      : null,
    components,
    selectedComponentId: inModel(ctx.selectedComponentId, ids),
    pointer: viewerUp
      ? known({ componentId: inModel(vf!.hoveredComponentId, ids), source: inModel(vf!.hoveredComponentId, ids) ? vf!.hoverSource : null })
      : unavailable(noViewer),
    focusedComponentId: viewerUp ? known(inModel(vf!.focusedComponentId, ids)) : unavailable(noViewer),
    hiddenComponentIds: hidden,
    isolatedComponentId: viewerUp ? known(isolated) : unavailable(noViewer),
    highlightedComponentIds: viewerUp ? known(vf!.highlightedComponentIds.filter((id) => ids.has(id))) : unavailable(noViewer),
    exploded: { supported: ctx.supportsExplodedView, factor: explodedFactor, active: explodedFactor > 0 },
    camera: viewerUp
      ? known({ ...vf!.camera, settled: !vf!.camera.transitioning && !vf!.pendingCommand })
      : unavailable(noViewer),
    animation: {
      available: (activeModel?.animations ?? []).map((a) => ({ id: a.id, label: a.label })),
      state: !viewerUp
        ? unavailable(noViewer)
        : ctx.animationIds.length === 0
          ? known({ playing: false, speed: vf!.animation.speed })
          : known({ ...vf!.animation }),
    },
    lesson: {
      available: ctx.lesson.available,
      active: lessonActive,
      stepCount: ctx.lesson.stepCount,
      currentStep: lessonActive ? ctx.lesson.currentStep : null,
      stepTitle: lessonActive ? ws?.lessonStepTitle ?? null : null,
      stepComponentId: lessonActive ? inModel(ws?.lessonStepComponentId, ids) : null,
    },
    lastDiscussedComponentId: lastDiscussed,
    availableActions: actions,
  };
}

/** Convenience: snapshot of the scene behind a dispatcher. */
export function getSceneSnapshot(
  dispatcher: SceneCommandDispatcher,
  model: EngineeringModelDefinition | null | undefined,
  extras?: SnapshotExtras
): SceneSnapshot {
  return buildSceneSnapshot(dispatcher.getContext(), model, extras);
}
