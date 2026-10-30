/**
 * Task V3 — scene snapshot, component reference resolution, relationships and multi-component
 * highlighting. Runs the real dispatcher, viewer executor, camera controller, model lifecycle
 * (real procedural geometry) and voice session; only the React workspace state is simulated.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import { WARREN_TRUSS_MODEL_ID } from '../src/models/civil/warrenTrussBridgeModel';
import { getGuidedLessonForModel } from '../src/data/guidedLessons';
import { SceneCommandDispatcher } from '../src/services/commands/sceneCommandDispatcher';
import { ViewerCommandExecutor } from '../src/services/commands/viewerCommandExecutor';
import { validateSceneCommand } from '../src/services/commands/sceneCommands';
import { CameraController } from '../src/components/scene/CameraController';
import { ModelLifecycleManager } from '../src/services/models/modelLifecycle';
import { buildSceneSnapshot, getSceneSnapshot, type SceneSnapshot } from '../src/services/scene/sceneSnapshot';
import { resolveComponentReference } from '../src/services/scene/referenceResolver';
import {
  getComponentRelationships,
  getNeighbourhood,
  getRelatedComponentIds,
  validateModelRelationships,
} from '../src/services/scene/componentRelationships';
import { handleVoiceTurn } from '../src/services/voice/voiceSession';
import type { EngineeringModelDefinition } from '../src/types/models';
import type { PointerSource } from '../src/services/scene/sceneFacts';

const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
const bridge = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID)!;
const ALL = modelRegistry.getAllModels();

function mockDom(): HTMLElement {
  const doc = { addEventListener: () => {}, removeEventListener: () => {} };
  return { addEventListener: () => {}, removeEventListener: () => {}, ownerDocument: doc, getRootNode: () => doc, style: {} } as unknown as HTMLElement;
}

/**
 * The workspace + viewer wiring of WorkspaceLayout/ViewerCanvas, without React or WebGL.
 * Workspace state is a plain object updated synchronously by the workspace handler.
 */
export function makeWorkspace(startModel: EngineeringModelDefinition = gearbox) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  const controller = new CameraController(camera, mockDom(), { enableDamping: false, autoRotate: false });
  const lifecycle = new ModelLifecycleManager({ scene, camera, cameraController: controller });
  let clock = 0;
  const ws = {
    model: startModel,
    selected: null as string | null,
    hidden: new Set<string>(),
    exploded: 0,
    lessonActive: false,
    lessonStep: 0,
  };
  const pointer: { componentId: string | null; source: PointerSource | null } = { componentId: null, source: null };
  const anim = { playing: true, speed: 1 };
  const steer = { on: false }; // simulated hand gesture steering the camera
  lifecycle.loadModel(ws.model.id);

  const dispatcher = new SceneCommandDispatcher();
  const executor = new ViewerCommandExecutor({
    camera: controller, lifecycle,
    isGestureInteracting: () => steer.on,
    animation: { setPlaying: (p) => (anim.playing = p), setSpeed: (s) => (anim.speed = s) },
    setAutoOrbit: () => {},
    getPointer: () => pointer,
    getAnimationState: () => ({ ...anim }),
    now: () => clock,
  }, (cmd, src, status, detail) => dispatcher.reportDeferredOutcome(cmd, src, status, detail));
  dispatcher.registerContextProvider('workspace', () => {
    const lesson = getGuidedLessonForModel(ws.model.id);
    return {
      modelId: ws.model.id,
      componentIds: new Set(ws.model.getAllComponentIds()),
      animationIds: (ws.model.animations ?? []).map((a) => a.id),
      lesson: { available: Boolean(lesson?.steps.length), active: ws.lessonActive, stepCount: lesson?.steps.length ?? 0, currentStep: ws.lessonStep },
      registeredModelIds: new Set(ALL.map((m) => m.id)),
      selectedComponentId: ws.selected,
      workspaceFacts: {
        hiddenComponentIds: [...ws.hidden],
        explodedFactor: ws.exploded,
        lessonStepTitle: ws.lessonActive ? lesson?.steps[ws.lessonStep]?.title ?? null : null,
        lessonStepComponentId: ws.lessonActive ? lesson?.steps[ws.lessonStep]?.componentId ?? null : null,
      },
    };
  });
  dispatcher.registerContextProvider('viewer', executor.contextProvider);
  dispatcher.registerHandler(executor);
  dispatcher.registerHandler({
    id: 'workspace',
    canHandle: (t) => ['component.select', 'component.visibility', 'component.showAll', 'assembly.explode', 'assembly.restore',
      'lesson.start', 'lesson.next', 'lesson.exit', 'workspace.switchModel'].includes(t),
    execute: (cmd, source) => {
      switch (cmd.type) {
        case 'component.select': ws.selected = cmd.componentId; break;
        case 'component.visibility': cmd.componentIds.forEach((id) => (cmd.visible ? ws.hidden.delete(id) : ws.hidden.add(id))); break;
        case 'component.showAll': ws.hidden.clear(); dispatcher.dispatch({ type: 'component.isolate', componentId: null }, source); break;
        case 'assembly.explode': ws.exploded = cmd.factor; break;
        case 'assembly.restore': ws.exploded = 0; break;
        case 'lesson.start': ws.lessonActive = true; ws.lessonStep = 0; break;
        case 'lesson.next': ws.lessonStep += 1; break;
        case 'lesson.exit': ws.lessonActive = false; break;
        case 'workspace.switchModel': {
          // Same reconciliation as WorkspaceLayout + ViewerCanvas on a model change
          ws.model = modelRegistry.getModel(cmd.modelId)!;
          ws.selected = null; ws.hidden.clear(); ws.exploded = 0; ws.lessonActive = false;
          lifecycle.loadModel(cmd.modelId);
          break;
        }
      }
      return { status: 'executed' };
    },
  });

  const memory: { last: { modelId: string; componentId: string } | null } = { last: null };
  const snapshot = (withConversation = true): SceneSnapshot =>
    getSceneSnapshot(dispatcher, ws.model, withConversation ? { lastDiscussed: memory.last } : {});
  /** One voice turn, keeping conversation memory like the VoiceDock does. */
  const say = (transcript: string, language = 'en-IN') => {
    const r = handleVoiceTurn({ transcript, language, dispatcher, model: ws.model, allModels: ALL, lastDiscussed: memory.last });
    if (r.discussedComponentId) memory.last = { modelId: ws.model.id, componentId: r.discussedComponentId };
    return r;
  };
  const tick = (ms: number) => { clock += ms; controller.update(clock); executor.tick(clock); };
  return { dispatcher, executor, controller, lifecycle, ws, pointer, anim, steer, memory, snapshot, say, tick };
}

const known = <T>(f: { status: string; value?: T }): T => {
  assert.equal(f.status, 'known');
  return f.value as T;
};

/** Meshes that belong to a component (own or ancestor userData.componentId). */
function meshesOf(root: THREE.Object3D, componentId: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let cur: THREE.Object3D | null = m;
    while (cur && !cur.userData?.componentId) cur = cur.parent;
    if (cur?.userData.componentId === componentId) out.push(m);
  });
  return out;
}
const emissiveHex = (m: THREE.Mesh) => (m.material as THREE.MeshStandardMaterial).emissive.getHex();

/* ================================ 1. Scene snapshot ================================ */

describe('Scene snapshot (Task V3)', () => {
  it('describes the initial scene', () => {
    const w = makeWorkspace();
    const s = w.snapshot(false);
    assert.equal(s.version, 1);
    assert.deepEqual(s.model, { id: 'planetary_gearbox', name: gearbox.name, domain: 'mechanical', category: gearbox.category });
    assert.deepEqual(s.components.map((c) => c.id), gearbox.getAllComponentIds());
    assert.ok(s.components.every((c) => c.visible && c.name && c.role));
    assert.equal(s.selectedComponentId, null);
    assert.deepEqual(known(s.pointer), { componentId: null, source: null });
    assert.equal(known(s.focusedComponentId), null);
    assert.deepEqual(s.hiddenComponentIds, []);
    assert.equal(known(s.isolatedComponentId), null);
    assert.deepEqual(known(s.highlightedComponentIds), []);
    assert.deepEqual(s.exploded, { supported: true, factor: 0, active: false });
    // The model's own initial camera pose ([0, 4, 9]) is not one of the named presets
    assert.equal(known(s.camera).view, 'custom');
    assert.equal(known(s.camera).userSteering, false);
    assert.deepEqual(known(s.animation.state), { playing: true, speed: 1 });
    assert.deepEqual(s.animation.available.map((a) => a.id), ['gear_train_rotation']);
    assert.deepEqual(s.lesson, { available: true, active: false, stepCount: s.lesson.stepCount, currentStep: null, stepTitle: null, stepComponentId: null });
    assert.equal(s.lastDiscussedComponentId.status, 'unavailable', 'no conversation context was given');
    for (const a of ['component.highlight', 'assembly.explode', 'animation.play', 'lesson.start'] as const) assert.ok(s.availableActions.includes(a), a);
    assert.ok(!s.availableActions.includes('lesson.next'), 'lesson.next needs a running lesson');
  });

  it('marks viewer facts unavailable (not empty) when the 3D viewer is not mounted', () => {
    const d = new SceneCommandDispatcher();
    d.registerContextProvider('workspace', () => ({ modelId: gearbox.id, componentIds: new Set(gearbox.getAllComponentIds()) }));
    const s = getSceneSnapshot(d, gearbox);
    assert.equal(s.pointer.status, 'unavailable');
    assert.equal(s.isolatedComponentId.status, 'unavailable');
    assert.equal(s.camera.status, 'unavailable');
    assert.equal(s.animation.state.status, 'unavailable');
    assert.ok(!s.availableActions.includes('camera.zoom'));
  });

  it('follows selection, pointing, hide/show, isolation, explode, animation and lessons live', () => {
    const w = makeWorkspace();
    w.dispatcher.dispatch({ type: 'component.select', componentId: 'ring_gear' }, 'ui');
    assert.equal(w.snapshot().selectedComponentId, 'ring_gear');

    w.pointer.componentId = 'sun_gear'; w.pointer.source = 'gesture';
    assert.deepEqual(known(w.snapshot().pointer), { componentId: 'sun_gear', source: 'gesture' });
    w.pointer.componentId = null; w.pointer.source = null; // pointer moved away
    assert.deepEqual(known(w.snapshot().pointer), { componentId: null, source: null });

    w.dispatcher.dispatch({ type: 'component.visibility', componentIds: ['planet_carrier'], visible: false }, 'ui');
    let s = w.snapshot();
    assert.deepEqual(s.hiddenComponentIds, ['planet_carrier']);
    assert.equal(s.components.find((c) => c.id === 'planet_carrier')!.visible, false);
    w.dispatcher.dispatch({ type: 'component.visibility', componentIds: ['planet_carrier'], visible: true }, 'ui');
    assert.deepEqual(w.snapshot().hiddenComponentIds, []);

    w.dispatcher.dispatch({ type: 'component.isolate', componentId: 'sun_gear' }, 'ui');
    s = w.snapshot();
    assert.equal(known(s.isolatedComponentId), 'sun_gear');
    assert.deepEqual(s.components.filter((c) => c.visible).map((c) => c.id), ['sun_gear']);
    w.dispatcher.dispatch({ type: 'component.isolate', componentId: null }, 'ui');
    assert.equal(known(w.snapshot().isolatedComponentId), null);

    w.dispatcher.dispatch({ type: 'assembly.explode', factor: 0.6 }, 'ui');
    assert.deepEqual(w.snapshot().exploded, { supported: true, factor: 0.6, active: true });

    w.dispatcher.dispatch({ type: 'animation.pause' }, 'ui');
    w.dispatcher.dispatch({ type: 'animation.setSpeed', speed: 2 }, 'ui');
    assert.deepEqual(known(w.snapshot().animation.state), { playing: false, speed: 2 });

    w.dispatcher.dispatch({ type: 'lesson.start' }, 'ui');
    w.dispatcher.dispatch({ type: 'lesson.next' }, 'ui');
    s = w.snapshot();
    const step = getGuidedLessonForModel(gearbox.id)!.steps[1];
    assert.deepEqual({ ...s.lesson, stepCount: 0 }, { available: true, active: true, stepCount: 0, currentStep: 1, stepTitle: step.title, stepComponentId: step.componentId });
    assert.ok(s.availableActions.includes('lesson.next'));
  });

  it('tracks the focused part and drops it once the camera is moved elsewhere', () => {
    const w = makeWorkspace();
    w.dispatcher.dispatch({ type: 'component.focus', componentId: 'ring_gear' }, 'voice');
    assert.equal(known(w.snapshot().focusedComponentId), 'ring_gear');
    w.dispatcher.dispatch({ type: 'camera.orbit', yawDeg: 30 }, 'voice');
    assert.equal(known(w.snapshot().focusedComponentId), null);
  });

  it('names the real camera view and reports "custom" after free orbiting', () => {
    const w = makeWorkspace();
    w.dispatcher.dispatch({ type: 'camera.view', view: 'top' }, 'ui');
    w.tick(1000);
    assert.equal(known(w.snapshot().camera).view, 'top');
    w.dispatcher.dispatch({ type: 'camera.view', view: 'back' }, 'ui');
    w.tick(1000);
    assert.equal(known(w.snapshot().camera).view, 'back');
    w.dispatcher.dispatch({ type: 'camera.orbit', yawDeg: 45, pitchDeg: 20 }, 'ui');
    w.tick(1000);
    assert.equal(known(w.snapshot().camera).view, 'custom');
  });

  it('clears stale references when the model is switched', () => {
    const w = makeWorkspace();
    w.dispatcher.dispatch({ type: 'component.select', componentId: 'sun_gear' }, 'ui');
    w.dispatcher.dispatch({ type: 'component.highlight', componentIds: ['ring_gear'] }, 'ui');
    w.memory.last = { modelId: gearbox.id, componentId: 'sun_gear' };
    w.dispatcher.dispatch({ type: 'workspace.switchModel', modelId: bridge.id }, 'ui');
    w.pointer.componentId = 'sun_gear'; // a pointer value left over from the previous model
    w.pointer.source = 'mouse';
    const s = w.snapshot();
    assert.equal(s.model!.id, bridge.id);
    assert.deepEqual(s.components.map((c) => c.id), bridge.getAllComponentIds());
    assert.equal(s.selectedComponentId, null);
    assert.deepEqual(known(s.pointer), { componentId: null, source: null });
    assert.deepEqual(known(s.highlightedComponentIds), []);
    assert.equal(known(s.lastDiscussedComponentId), null, 'gearbox memory is not carried to the bridge');
    assert.ok(!s.availableActions.includes('animation.play'), 'the bridge has no animation');
  });

  it('ignores context that belongs to a different model than the one passed in', () => {
    const w = makeWorkspace();
    const s = buildSceneSnapshot(w.dispatcher.getContext(), bridge);
    assert.equal(s.model, null);
    assert.deepEqual(s.components, []);
  });

  it('is plain serialisable data: no Three.js objects, geometry or secrets', () => {
    const w = makeWorkspace();
    w.dispatcher.dispatch({ type: 'component.select', componentId: 'sun_gear' }, 'ui');
    const snapshot = w.snapshot();
    const json = JSON.stringify(snapshot);
    assert.deepEqual(JSON.parse(json), snapshot, 'round-trips through JSON (plain data only)');
    assert.ok(json.length < 8000, `snapshot is small (${json.length} chars)`);
    for (const banned of ['geometry', 'material', 'uuid', 'Float32Array', 'api_key', 'GNANI']) {
      assert.ok(!json.includes(banned), `contains "${banned}"`);
    }
  });
});

/* ============================ 2. Reference resolution ============================ */

describe('Component reference resolution (Task V3)', () => {
  const sceneWith = (o: { pointed?: string | null; selected?: string | null; last?: string | null; model?: EngineeringModelDefinition }) => {
    const model = o.model ?? gearbox;
    return {
      components: model.getAllComponentIds().map((id) => ({ id, name: id, role: null, visible: true, relatedComponentIds: [] })),
      pointer: { status: 'known' as const, value: { componentId: o.pointed ?? null, source: o.pointed ? ('mouse' as const) : null } },
      selectedComponentId: o.selected ?? null,
      lastDiscussedComponentId: { status: 'known' as const, value: o.last ?? null },
    };
  };

  it('uses priority explicit > pointed > selected > last discussed', () => {
    const all = sceneWith({ pointed: 'sun_gear', selected: 'ring_gear', last: 'planet_carrier' });
    assert.deepEqual(resolveComponentReference({ explicitIds: ['central_shaft'], contextual: true }, all),
      { kind: 'resolved', componentId: 'central_shaft', via: 'explicit' });
    assert.deepEqual(resolveComponentReference({ explicitIds: [], contextual: true }, all),
      { kind: 'resolved', componentId: 'sun_gear', via: 'pointed' });
    assert.deepEqual(resolveComponentReference({ explicitIds: [], contextual: true }, sceneWith({ selected: 'ring_gear', last: 'planet_carrier' })),
      { kind: 'resolved', componentId: 'ring_gear', via: 'selected' });
    assert.deepEqual(resolveComponentReference({ explicitIds: [], contextual: true }, sceneWith({ last: 'planet_carrier' })),
      { kind: 'resolved', componentId: 'planet_carrier', via: 'lastDiscussed' });
  });

  it('asks for clarification instead of guessing', () => {
    assert.deepEqual(resolveComponentReference({ explicitIds: [], contextual: true }, sceneWith({})), { kind: 'needsClarification' });
    assert.deepEqual(resolveComponentReference({ explicitIds: [], contextual: false }, sceneWith({ selected: 'sun_gear' })), { kind: 'needsClarification' });
  });

  it('reports several explicit matches as ambiguous', () => {
    assert.deepEqual(resolveComponentReference({ explicitIds: ['planet_gear_1', 'planet_gear_2'], contextual: false }, sceneWith({ selected: 'sun_gear' })),
      { kind: 'ambiguous', options: ['planet_gear_1', 'planet_gear_2'] });
  });

  it('never resolves to a component of another model', () => {
    const onBridge = sceneWith({ model: bridge, pointed: 'sun_gear', selected: 'ring_gear', last: 'planet_carrier' });
    assert.deepEqual(resolveComponentReference({ explicitIds: ['sun_gear'], contextual: true }, onBridge), { kind: 'needsClarification' });
  });
});

/* ============================== 3. Relationships ============================== */

describe('Component relationships (Task V3)', () => {
  it('every relationship of both models is valid and has its inverse', () => {
    for (const model of [gearbox, bridge]) {
      const report = validateModelRelationships(model);
      assert.deepEqual(report.errors, [], model.id);
      assert.ok(report.isValid);
    }
  });

  it('gearbox: kinematic links match the model', () => {
    assert.deepEqual(getRelatedComponentIds(gearbox, 'sun_gear').sort(), ['central_shaft', 'planet_gear_1', 'planet_gear_2', 'planet_gear_3']);
    assert.deepEqual(getRelatedComponentIds(gearbox, 'ring_gear').sort(), ['planet_gear_1', 'planet_gear_2', 'planet_gear_3']);
    assert.deepEqual(getRelatedComponentIds(gearbox, 'planet_gear_2').sort(), ['planet_carrier', 'ring_gear', 'sun_gear']);
    assert.deepEqual(getRelatedComponentIds(gearbox, 'central_shaft'), ['sun_gear']);
    assert.deepEqual(getRelatedComponentIds(gearbox, 'sun_gear', ['driven_by']), ['central_shaft']);
    assert.deepEqual(getRelatedComponentIds(gearbox, 'planet_carrier', ['driven_by']).sort(), ['planet_gear_1', 'planet_gear_2', 'planet_gear_3']);
    const types = getComponentRelationships(gearbox, 'planet_gear_1').map((r) => `${r.relationshipType}:${r.targetComponentId}`).sort();
    assert.deepEqual(types, ['driven_by:sun_gear', 'drives:planet_carrier', 'mates_with:ring_gear', 'mates_with:sun_gear', 'supported_by:planet_carrier']);
  });

  it('gearbox: no invented links (shaft-carrier, planet-planet, ring mounting)', () => {
    assert.ok(!getRelatedComponentIds(gearbox, 'central_shaft').includes('planet_carrier'));
    assert.ok(!getRelatedComponentIds(gearbox, 'planet_gear_1').includes('planet_gear_2'));
  });

  it('bridge: connections and load path match the model metadata', () => {
    assert.deepEqual(getRelatedComponentIds(bridge, 'diagonal_members').sort(), ['bottom_chords', 'gusset_plates', 'top_chords']);
    assert.deepEqual(getRelatedComponentIds(bridge, 'end_portals'), ['support_piers']);
    assert.deepEqual(getRelatedComponentIds(bridge, 'bridge_deck').sort(), ['bottom_chords', 'vertical_struts']);
    assert.deepEqual(getRelatedComponentIds(bridge, 'support_piers', ['supports']), ['bottom_chords']);
  });

  it('returns nothing for unknown or cross-model component IDs', () => {
    assert.deepEqual(getComponentRelationships(gearbox, 'no_such_part'), []);
    assert.deepEqual(getRelatedComponentIds(bridge, 'sun_gear'), []);
    assert.deepEqual(getComponentRelationships(gearbox, ''), []);
  });

  it('walks the relationship graph by depth', () => {
    assert.deepEqual(getNeighbourhood(gearbox, 'central_shaft', 1), ['sun_gear']);
    const two = getNeighbourhood(gearbox, 'central_shaft', 2).sort();
    assert.deepEqual(two, ['planet_gear_1', 'planet_gear_2', 'planet_gear_3', 'sun_gear']);
    assert.ok(!getNeighbourhood(gearbox, 'central_shaft', 3).includes('central_shaft'));
  });

  it('detects invalid targets and components without relationships', () => {
    const broken: EngineeringModelDefinition = {
      ...gearbox,
      getComponentMetadata: (id) => {
        const meta = gearbox.getComponentMetadata(id);
        if (!meta) return null;
        if (id === 'sun_gear') return { ...meta, relationships: [{ targetComponentId: 'piston', relationshipType: 'drives' }] };
        return { ...meta, relationships: [] };
      },
    };
    const report = validateModelRelationships(broken);
    assert.equal(report.isValid, false);
    assert.ok(report.errors.some((e) => e.includes('piston')));
    assert.ok(report.componentsWithoutRelationships.includes('ring_gear'));
    assert.deepEqual(getRelatedComponentIds(broken, 'sun_gear'), [], 'invalid targets are never returned');
  });
});

/* ======================== 4. Multi-component highlighting ======================== */

describe('Related-component highlighting (Task V3)', () => {
  it('highlights several parts together and restores the previous state', () => {
    const w = makeWorkspace();
    const raycaster = w.lifecycle.getRaycaster()!;
    const root = w.lifecycle.getActiveRuntime()!.rootGroup;
    const ring = meshesOf(root, 'ring_gear');
    const sun = meshesOf(root, 'sun_gear');
    const planet = meshesOf(root, 'planet_gear_1');
    assert.ok(ring.length && sun.length && planet.length);
    const originalRing = ring.map((m) => m.material);

    raycaster.setSelectionHighlight('sun_gear');
    const rec = w.dispatcher.dispatch({ type: 'component.highlight', componentIds: ['ring_gear', 'planet_gear_1', 'sun_gear'] }, 'voice');
    assert.equal(rec.status, 'executed');
    assert.ok(ring.every((m) => emissiveHex(m) === 0x22c55e), 'ring glows green');
    assert.ok(planet.every((m) => emissiveHex(m) === 0x22c55e), 'planet glows green');
    assert.ok(sun.every((m) => emissiveHex(m) === 0xf59e0b), 'selection colour wins over the related glow');
    assert.deepEqual(known(w.snapshot().highlightedComponentIds).sort(), ['planet_gear_1', 'ring_gear', 'sun_gear']);

    w.dispatcher.dispatch({ type: 'component.clearHighlight' }, 'voice');
    assert.deepEqual(ring.map((m) => m.material), originalRing, 'original materials restored');
    assert.ok(sun.every((m) => emissiveHex(m) === 0xf59e0b), 'selection highlight kept');
    assert.deepEqual(known(w.snapshot().highlightedComponentIds), []);
  });

  it('hover and selection still behave as before with the new layer', () => {
    const w = makeWorkspace();
    const raycaster = w.lifecycle.getRaycaster()!;
    const root = w.lifecycle.getActiveRuntime()!.rootGroup;
    const ring = meshesOf(root, 'ring_gear');
    const original = ring.map((m) => m.material);
    raycaster.setHoverHighlight('ring_gear');
    assert.ok(ring.every((m) => emissiveHex(m) === 0x06b6d4));
    raycaster.setSelectionHighlight('ring_gear');
    assert.ok(ring.every((m) => emissiveHex(m) === 0xf59e0b));
    raycaster.setSelectionHighlight(null);
    assert.ok(ring.every((m) => emissiveHex(m) === 0x06b6d4), 'hover glow returns when deselected while hovered');
    raycaster.setHoverHighlight(null);
    assert.deepEqual(ring.map((m) => m.material), original);
  });

  it('validates highlight commands through V1', () => {
    const ctx = makeWorkspace().dispatcher.getContext();
    assert.equal(validateSceneCommand({ type: 'component.highlight', componentIds: ['piston'] }, ctx).ok, false);
    assert.equal(validateSceneCommand({ type: 'component.highlight', componentIds: [] }, ctx).ok, false);
    assert.equal(validateSceneCommand({ type: 'component.highlight', componentIds: Array(21).fill('sun_gear') }, ctx).ok, false);
    const ok = validateSceneCommand({ type: 'component.highlight', componentIds: ['sun_gear', 'sun_gear'], extra: 1 }, ctx);
    assert.deepEqual(ok, { ok: true, command: { type: 'component.highlight', componentIds: ['sun_gear'] } });
  });
});

/* ===================== 5. Contextual voice commands (scenarios) ===================== */

describe('Contextual voice commands (Task V3 scenarios)', () => {
  it('A: pointing — "What does this do?" identifies the pointed part, without inventing an answer', () => {
    const w = makeWorkspace();
    w.pointer.componentId = 'sun_gear'; w.pointer.source = 'gesture';
    const r = w.say('What does this do?');
    assert.deepEqual(r.outcome, { kind: 'question', question: 'purpose', partId: 'sun_gear', via: 'pointed' });
    assert.equal(r.status, 'unavailable');
    assert.match(r.caption, /Sun Gear.*not available yet/);
    assert.equal(r.records.length, 0, 'questions dispatch nothing');
  });

  it('A2: "What is this?" is answered from model metadata (name and role)', () => {
    const w = makeWorkspace();
    w.pointer.componentId = 'ring_gear'; w.pointer.source = 'mouse';
    const r = w.say('what is this');
    assert.equal(r.status, 'answered');
    assert.equal(r.caption, `That is the Outer Annulus (Ring Gear): ${gearbox.getComponentMetadata('ring_gear')!.role}.`);
    assert.equal(w.say('ఇది ఏమిటి', 'te-IN').status, 'answered');
    assert.equal(w.say('ये क्या है', 'hi-IN').status, 'answered');
  });

  it('B: selection — "Separate this part." isolates the selected ring gear through the dispatcher', () => {
    const w = makeWorkspace();
    w.dispatcher.dispatch({ type: 'component.select', componentId: 'ring_gear' }, 'ui');
    const r = w.say('Separate this part.');
    assert.equal(r.status, 'executed');
    assert.equal(r.outcome.kind === 'commands' && r.outcome.via, 'selected');
    assert.ok(r.records.some((rec) => rec.status === 'executed' && (rec.command as { type: string }).type === 'component.isolate'));
    assert.equal(known(w.snapshot().isolatedComponentId), 'ring_gear');
  });

  it('C: no context — "Hide that part." asks which part and changes nothing', () => {
    const w = makeWorkspace();
    const before = JSON.stringify({ ...w.snapshot(), capturedAt: 0 });
    const r = w.say('Hide that part.');
    assert.equal(r.outcome.kind, 'needsSelection');
    assert.equal(r.status, 'needsInput');
    assert.match(r.caption, /Which part do you mean/);
    assert.equal(r.records.length, 0);
    assert.equal(JSON.stringify({ ...w.snapshot(), capturedAt: 0 }), before, 'scene unchanged');
    assert.match(w.say('దాన్ని దాచు', 'te-IN').caption, /ఏ భాగం/);
    assert.match(w.say('उसे छुपाओ', 'hi-IN').caption, /कौन सा पुर्ज़ा/);
  });

  it('D: an explicit name overrides pointing', () => {
    const w = makeWorkspace();
    w.pointer.componentId = 'sun_gear'; w.pointer.source = 'gesture';
    const r = w.say('Explain the ring gear');
    assert.deepEqual(r.outcome, { kind: 'question', question: 'explain', partId: 'ring_gear', via: 'explicit' });
    const sel = w.say('select the planet carrier');
    assert.equal(sel.outcome.kind === 'commands' && sel.outcome.partId, 'planet_carrier');
  });

  it('E: after switching to the bridge, a gearbox reference cannot act on the bridge', () => {
    const w = makeWorkspace();
    w.say('select the sun gear');
    assert.equal(w.memory.last?.componentId, 'sun_gear');
    w.dispatcher.dispatch({ type: 'workspace.switchModel', modelId: bridge.id }, 'ui');
    const before = w.dispatcher.getHistory().length;
    const r = w.say('hide it');
    assert.equal(r.outcome.kind, 'needsSelection');
    assert.equal(w.dispatcher.getHistory().length, before, 'no command dispatched');
    const g = w.say('hide the sun gear');
    assert.equal(g.status, 'rejected');
    assert.equal(g.outcome.kind, 'unknownPart');
  });

  it('remembers the last discussed part for "it" in the next turn', () => {
    const w = makeWorkspace();
    w.say('what is the ring gear');
    assert.equal(w.snapshot().selectedComponentId, null, 'asking does not select');
    const r = w.say('hide it');
    assert.equal(r.outcome.kind === 'commands' && r.outcome.via, 'lastDiscussed');
    assert.deepEqual(w.ws.hidden, new Set(['ring_gear']));
  });

  it('"Show me the parts connected to it" selects the part and highlights its related parts', () => {
    const w = makeWorkspace();
    w.dispatcher.dispatch({ type: 'component.select', componentId: 'ring_gear' }, 'ui');
    const r = w.say('Show me the parts connected to it.');
    assert.equal(r.status, 'executed');
    assert.deepEqual(known(w.snapshot().highlightedComponentIds).sort(), ['planet_gear_1', 'planet_gear_2', 'planet_gear_3']);
    assert.match(r.caption, /connected to .*Ring Gear.*Planet Gear A/);
    assert.equal(w.say('దీనికి కనెక్ట్ అయిన భాగాలు చూపించు', 'te-IN').status, 'executed');
    assert.equal(w.say('इससे जुड़े पुर्ज़े दिखाओ', 'hi-IN').status, 'executed');
    assert.equal(w.say('clear the highlight').status, 'executed');
    assert.deepEqual(known(w.snapshot().highlightedComponentIds), []);
  });

  it('rejects a relationship request when the model records none for that part', () => {
    const noRels: EngineeringModelDefinition = {
      ...gearbox,
      getComponentMetadata: (id) => {
        const meta = gearbox.getComponentMetadata(id);
        return meta ? { ...meta, relationships: undefined } : null;
      },
    };
    const w = makeWorkspace(noRels);
    w.dispatcher.dispatch({ type: 'component.select', componentId: 'sun_gear' }, 'ui');
    const before = w.dispatcher.getHistory().length;
    const r = w.say('show the parts connected to it');
    assert.deepEqual(r.outcome, { kind: 'unavailable', intent: 'related', reason: 'noRelationships', partId: 'sun_gear' });
    assert.equal(r.status, 'unavailable');
    assert.equal(w.dispatcher.getHistory().length, before);
  });

  it('"Put it back" undoes what the scene shows; "put it back together" reassembles', () => {
    const w = makeWorkspace();
    assert.equal(w.say('put it back').outcome.kind, 'unavailable', 'nothing to put back');
    w.say('isolate the sun gear');
    assert.equal(known(w.snapshot().isolatedComponentId), 'sun_gear');
    assert.equal(w.say('put it back').status, 'executed');
    assert.equal(known(w.snapshot().isolatedComponentId), null);
    w.say('hide the ring gear');
    w.say('put it back');
    assert.deepEqual(w.ws.hidden, new Set());
    w.say('explode');
    assert.equal(w.ws.exploded, 0.75);
    w.say('put it back together');
    assert.equal(w.ws.exploded, 0);
  });

  it('a question about a part of another model is rejected by name', () => {
    const w = makeWorkspace();
    const r = w.say('what does the piston do');
    assert.equal(r.outcome.kind, 'unknownPart');
    assert.equal(r.records.length, 0);
  });
});
