/**
 * Unified Scene Command Channel Tests (Task V1)
 *
 * 1. Validation of untrusted command input against the live model context
 * 2. Dispatcher routing, history, listeners and fault isolation
 * 3. Smooth command-driven camera transitions (CameraController)
 * 4. Arbitration with live hand gestures and mouse drags (ViewerCommandExecutor)
 * 5. End-to-end with the real planetary gearbox model and lifecycle manager
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraController, CAMERA_PRESETS } from '../src/components/scene/CameraController';
import { GestureCameraController } from '../src/components/scene/GestureCameraController';
import { ModelLifecycleManager } from '../src/services/models/modelLifecycle';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import { WARREN_TRUSS_MODEL_ID } from '../src/models/civil/warrenTrussBridgeModel';
import {
  EMPTY_COMMAND_CONTEXT,
  validateSceneCommand,
  type SceneCommandContext,
} from '../src/services/commands/sceneCommands';
import { SceneCommandDispatcher, type CommandHandler } from '../src/services/commands/sceneCommandDispatcher';
import { ViewerCommandExecutor, PENDING_TTL_MS } from '../src/services/commands/viewerCommandExecutor';
import type { NormalizedLandmark, HandLandmarkResult } from '../src/types/landmarks';
import type { GestureRecognitionResult } from '../src/types/gestures';

/* ------------------------------ helpers ------------------------------ */

function createMockDom(): HTMLElement {
  const doc = { addEventListener: () => {}, removeEventListener: () => {} };
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
    ownerDocument: doc,
    getRootNode: () => doc,
    style: {},
  } as unknown as HTMLElement;
}

function makeCamera(opts: { autoRotate?: boolean } = {}) {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  const controller = new CameraController(camera, createMockDom(), {
    enableDamping: false,
    minDistance: 2,
    maxDistance: 25,
    autoRotate: opts.autoRotate ?? false,
  });
  return { camera, controller };
}

function gearboxContext(overrides: Partial<SceneCommandContext> = {}): SceneCommandContext {
  const model = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
  return {
    ...EMPTY_COMMAND_CONTEXT,
    modelId: model.id,
    componentIds: new Set(model.getAllComponentIds()),
    animationIds: (model.animations ?? []).map((a) => a.id),
    supportsExplodedView: true,
    viewerReady: true,
    lesson: { available: true, active: false, stepCount: 5, currentStep: 0 },
    registeredModelIds: new Set(modelRegistry.getAllModels().map((m) => m.id)),
    ...overrides,
  };
}

function hand(x: number): HandLandmarkResult[] {
  const landmarks: NormalizedLandmark[] = Array.from({ length: 21 }, () => ({ x, y: 0.5, z: 0 }));
  landmarks[0] = { x, y: 0.62, z: 0 };
  landmarks[5] = { x: x - 0.05, y: 0.46, z: 0 };
  landmarks[9] = { x, y: 0.42, z: 0 };
  landmarks[13] = { x: x + 0.04, y: 0.45, z: 0 };
  landmarks[17] = { x: x + 0.08, y: 0.5, z: 0 };
  landmarks[4] = { x: x - 0.1, y: 0.45, z: 0 };
  landmarks[8] = { x: x - 0.05, y: 0.32, z: 0 };
  return [{ landmarks, rawLandmarks: landmarks.map((p) => ({ ...p })), handedness: 'Right', score: 0.95 }];
}

const PALM: GestureRecognitionResult = { gesture: 'OPEN_PALM', confidence: 0.95, isStable: true, handedness: 'Right' };
const NONE: GestureRecognitionResult = { gesture: 'NONE', confidence: 0, isStable: true, handedness: 'Right' };

/** Rig with a real gesture controller and an executor on a fake clock. */
function makeRig() {
  const { camera, controller } = makeCamera();
  const gestures = new GestureCameraController(controller);
  let clock = 1000;
  const animation = { playing: true, speed: 1 };
  let autoOrbit = false;
  const deferred: string[] = [];
  const executor = new ViewerCommandExecutor(
    {
      camera: controller,
      lifecycle: {
        getComponentBounds: () => null,
        isolateComponent: () => true,
        getActiveModel: () => modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID) ?? null,
        getActiveRuntime: () => null,
      },
      isGestureInteracting: () => gestures.isInteracting(),
      animation: { setPlaying: (p) => (animation.playing = p), setSpeed: (s) => (animation.speed = s) },
      setAutoOrbit: (e) => (autoOrbit = e),
      now: () => clock,
    },
    (cmd, _src, status) => deferred.push(`${cmd.type}:${status}`)
  );
  const advance = (ms: number) => {
    clock += ms;
  };
  const frame = (g: GestureRecognitionResult, h: HandLandmarkResult[]) => {
    gestures.update(g, h);
    executor.tick(clock);
    controller.update(clock);
  };
  return { camera, controller, gestures, executor, animation, deferred, advance, frame, getClock: () => clock, getAutoOrbit: () => autoOrbit };
}

/* ------------------------------ 1. validation ------------------------------ */

describe('Scene command validation (untrusted input)', () => {
  const ctx = gearboxContext();

  it('rejects malformed and unknown commands', () => {
    assert.equal(validateSceneCommand(null, ctx).ok, false);
    assert.equal(validateSceneCommand('zoom in', ctx).ok, false);
    assert.equal(validateSceneCommand([], ctx).ok, false);
    const noType = validateSceneCommand({ direction: 'in' }, ctx);
    assert.ok(!noType.ok && noType.code === 'MALFORMED');
    const unknown = validateSceneCommand({ type: 'scene.deleteEverything' }, ctx);
    assert.ok(!unknown.ok && unknown.code === 'UNKNOWN_COMMAND');
  });

  it('strips unexpected fields so injected data never reaches handlers', () => {
    const res = validateSceneCommand({ type: 'camera.zoom', direction: 'in', eval: 'alert(1)', steps: 2 }, ctx);
    assert.ok(res.ok);
    assert.deepEqual(res.command, { type: 'camera.zoom', direction: 'in', steps: 2 });
  });

  it('validates orbit ranges and fills defaults', () => {
    assert.ok(!validateSceneCommand({ type: 'camera.orbit', yawDeg: 0 }, ctx).ok);
    assert.ok(!validateSceneCommand({ type: 'camera.orbit', yawDeg: 720 }, ctx).ok);
    assert.ok(!validateSceneCommand({ type: 'camera.orbit', yawDeg: 'left' }, ctx).ok);
    const ok = validateSceneCommand({ type: 'camera.orbit', yawDeg: 30 }, ctx);
    assert.ok(ok.ok);
    assert.deepEqual(ok.command, { type: 'camera.orbit', yawDeg: 30, pitchDeg: 0 });
  });

  it('validates pan direction and amount', () => {
    assert.ok(!validateSceneCommand({ type: 'camera.pan', direction: 'forward' }, ctx).ok);
    assert.ok(!validateSceneCommand({ type: 'camera.pan', direction: 'left', amount: 5 }, ctx).ok);
    const ok = validateSceneCommand({ type: 'camera.pan', direction: 'right' }, ctx);
    assert.ok(ok.ok && ok.command.type === 'camera.pan' && ok.command.amount === 0.15);
  });

  it('validates zoom steps', () => {
    assert.ok(!validateSceneCommand({ type: 'camera.zoom', direction: 'sideways' }, ctx).ok);
    assert.ok(!validateSceneCommand({ type: 'camera.zoom', direction: 'in', steps: 0 }, ctx).ok);
    assert.ok(!validateSceneCommand({ type: 'camera.zoom', direction: 'in', steps: 1.5 }, ctx).ok);
  });

  it('rejects the unsupported bottom view with an explanation, accepts back/left/right', () => {
    const bottom = validateSceneCommand({ type: 'camera.view', view: 'bottom' }, ctx);
    assert.ok(!bottom.ok && /ground grid/.test(bottom.reason));
    for (const view of ['back', 'left', 'right', 'isometric', 'top', 'front']) {
      assert.ok(validateSceneCommand({ type: 'camera.view', view }, ctx).ok, view);
    }
  });

  it('rejects component IDs that do not exist in the loaded model', () => {
    const bridgePart = validateSceneCommand({ type: 'component.select', componentId: 'top_chords' }, ctx);
    assert.ok(!bridgePart.ok && bridgePart.code === 'UNKNOWN_COMPONENT');
    const invented = validateSceneCommand({ type: 'component.focus', componentId: 'piston' }, ctx);
    assert.ok(!invented.ok && invented.code === 'UNKNOWN_COMPONENT');
    assert.ok(validateSceneCommand({ type: 'component.select', componentId: 'sun_gear' }, ctx).ok);
    assert.ok(validateSceneCommand({ type: 'component.select', componentId: null }, ctx).ok);
    assert.ok(validateSceneCommand({ type: 'component.isolate', componentId: null }, ctx).ok);
  });

  it('validates visibility lists (non-empty, all known, de-duplicated)', () => {
    assert.ok(!validateSceneCommand({ type: 'component.visibility', componentIds: [], visible: false }, ctx).ok);
    const mixed = validateSceneCommand({ type: 'component.visibility', componentIds: ['sun_gear', 'ghost'], visible: false }, ctx);
    assert.ok(!mixed.ok && mixed.code === 'UNKNOWN_COMPONENT');
    const ok = validateSceneCommand({ type: 'component.visibility', componentIds: ['sun_gear', 'sun_gear'], visible: false }, ctx);
    assert.ok(ok.ok && ok.command.type === 'component.visibility' && ok.command.componentIds.length === 1);
  });

  it('requires the viewer for camera, focus, isolate and animation commands', () => {
    const notReady = gearboxContext({ viewerReady: false });
    for (const cmd of [
      { type: 'camera.zoom', direction: 'in' },
      { type: 'component.focus', componentId: 'sun_gear' },
      { type: 'animation.play' },
    ]) {
      const res = validateSceneCommand(cmd, notReady);
      assert.ok(!res.ok && res.code === 'VIEWER_NOT_READY', cmd.type);
    }
  });

  it('rejects exploded-view commands for models without one, and bad factors', () => {
    const noExplode = gearboxContext({ supportsExplodedView: false });
    assert.ok(!validateSceneCommand({ type: 'assembly.explode', factor: 0.5 }, noExplode).ok);
    assert.ok(!validateSceneCommand({ type: 'assembly.restore' }, noExplode).ok);
    assert.ok(!validateSceneCommand({ type: 'assembly.explode', factor: 1.5 }, ctx).ok);
    assert.ok(validateSceneCommand({ type: 'assembly.explode', factor: 0.6 }, ctx).ok);
  });

  it('only allows animation commands for models that declare a real animation', () => {
    const bridge = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID)!;
    const bridgeCtx = gearboxContext({
      modelId: bridge.id,
      componentIds: new Set(bridge.getAllComponentIds()),
      animationIds: (bridge.animations ?? []).map((a) => a.id),
    });
    const res = validateSceneCommand({ type: 'animation.play' }, bridgeCtx);
    assert.ok(!res.ok && res.code === 'UNSUPPORTED_ANIMATION');
    assert.ok(validateSceneCommand({ type: 'animation.play' }, ctx).ok);
    assert.ok(!validateSceneCommand({ type: 'animation.setSpeed', speed: 10 }, ctx).ok);
    assert.ok(validateSceneCommand({ type: 'animation.setSpeed', speed: 0.5 }, ctx).ok);
  });

  it('declares the gearbox animation honestly and none for the bridge (whose update hook is a no-op)', () => {
    assert.deepEqual(
      modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!.animations?.map((a) => a.id),
      ['gear_train_rotation']
    );
    assert.equal(modelRegistry.getModel(WARREN_TRUSS_MODEL_ID)!.animations?.length ?? 0, 0);
  });

  it('validates lesson state and step bounds', () => {
    const noLesson = gearboxContext({ lesson: { available: false, active: false, stepCount: 0, currentStep: 0 } });
    assert.ok(!validateSceneCommand({ type: 'lesson.start' }, noLesson).ok);
    const next = validateSceneCommand({ type: 'lesson.next' }, ctx);
    assert.ok(!next.ok && next.code === 'LESSON_NOT_ACTIVE');
    const active = gearboxContext({ lesson: { available: true, active: true, stepCount: 5, currentStep: 0 } });
    assert.ok(validateSceneCommand({ type: 'lesson.next' }, active).ok);
    assert.ok(!validateSceneCommand({ type: 'lesson.goTo', stepIndex: 5 }, active).ok);
    assert.ok(validateSceneCommand({ type: 'lesson.goTo', stepIndex: 4 }, active).ok);
  });

  it('only switches to registered models', () => {
    const res = validateSceneCommand({ type: 'workspace.switchModel', modelId: 'v8_engine' }, ctx);
    assert.ok(!res.ok && res.code === 'UNKNOWN_MODEL');
    assert.ok(validateSceneCommand({ type: 'workspace.switchModel', modelId: WARREN_TRUSS_MODEL_ID }, ctx).ok);
  });
});

/* ------------------------------ 2. dispatcher ------------------------------ */

describe('SceneCommandDispatcher', () => {
  function makeDispatcher() {
    const dispatcher = new SceneCommandDispatcher(() => 42);
    dispatcher.registerContextProvider('test', () => gearboxContext());
    const calls: string[] = [];
    const handler: CommandHandler = {
      id: 'h',
      canHandle: (t) => t.startsWith('camera.'),
      execute: (cmd, source) => {
        calls.push(`${cmd.type}@${source}`);
        return { status: 'executed' };
      },
    };
    dispatcher.registerHandler(handler);
    return { dispatcher, calls };
  }

  it('routes valid commands to the owning handler and records the source', () => {
    const { dispatcher, calls } = makeDispatcher();
    const rec = dispatcher.dispatch({ type: 'camera.zoom', direction: 'in' }, 'voice');
    assert.equal(rec.status, 'executed');
    assert.equal(rec.source, 'voice');
    assert.deepEqual(calls, ['camera.zoom@voice']);
  });

  it('rejects without calling any handler when validation fails', () => {
    const { dispatcher, calls } = makeDispatcher();
    const rec = dispatcher.dispatch({ type: 'component.select', componentId: 'piston' }, 'ai');
    assert.equal(rec.status, 'rejected');
    assert.equal(rec.code, 'UNKNOWN_COMPONENT');
    assert.equal(calls.length, 0);
  });

  it('reports NO_HANDLER for valid commands nobody owns', () => {
    const { dispatcher } = makeDispatcher();
    const rec = dispatcher.dispatch({ type: 'animation.play' }, 'ui');
    assert.equal(rec.status, 'rejected');
    assert.equal(rec.code, 'NO_HANDLER');
  });

  it('never throws when a handler or listener fails', () => {
    const dispatcher = new SceneCommandDispatcher();
    dispatcher.registerContextProvider('t', () => gearboxContext());
    dispatcher.registerHandler({ id: 'bad', canHandle: () => true, execute: () => { throw new Error('boom'); } });
    dispatcher.subscribe(() => { throw new Error('listener boom'); });
    const rec = dispatcher.dispatch({ type: 'camera.reset' }, 'ui');
    assert.equal(rec.status, 'rejected');
    assert.match(rec.detail ?? '', /boom/);
  });

  it('notifies listeners and keeps a bounded history', () => {
    const { dispatcher } = makeDispatcher();
    const seen: string[] = [];
    const unsubscribe = dispatcher.subscribe((r) => seen.push(r.status));
    for (let i = 0; i < 60; i++) dispatcher.dispatch({ type: 'camera.reset' }, 'ui');
    unsubscribe();
    dispatcher.dispatch({ type: 'camera.reset' }, 'ui');
    assert.equal(seen.length, 60);
    assert.equal(dispatcher.getHistory().length, 50);
  });

  it('merges context from several providers and unregisters cleanly', () => {
    const dispatcher = new SceneCommandDispatcher();
    dispatcher.registerContextProvider('workspace', () => ({ modelId: 'planetary_gearbox' }));
    const off = dispatcher.registerContextProvider('viewer', () => ({ viewerReady: true }));
    assert.equal(dispatcher.getContext().modelId, 'planetary_gearbox');
    assert.equal(dispatcher.getContext().viewerReady, true);
    off();
    assert.equal(dispatcher.getContext().viewerReady, false);
  });
});

/* ------------------------------ 3. camera transitions ------------------------------ */

describe('CameraController command transitions', () => {
  it('moves smoothly to the back view over the transition duration', () => {
    const { camera, controller } = makeCamera();
    const startDist = controller.getDistance();
    controller.goToView('back', 400, 0);
    controller.update(200); // halfway
    assert.ok(controller.isTransitioning());
    assert.ok(camera.position.z > -startDist * 0.9, 'not yet at the back at mid-transition');
    controller.update(400);
    assert.equal(controller.isTransitioning(), false);
    assert.ok(camera.position.z < 0, 'camera ends behind the model');
    assert.ok(Math.abs(controller.getDistance() - startDist) < 0.01, 'distance preserved');
    assert.ok(controller.controls.target.length() < 1e-6, 'target preserved');
  });

  it('reaches fixed presets exactly when animated', () => {
    const { camera, controller } = makeCamera();
    controller.goToView('top', 300, 0);
    controller.update(300);
    assert.ok(camera.position.distanceTo(CAMERA_PRESETS.top.position) < 0.01);
  });

  it('accumulates rapid orbit commands from the goal pose (two 45° = 90°)', () => {
    const { camera, controller } = makeCamera();
    const start = new THREE.Spherical().setFromVector3(camera.position.clone());
    controller.orbitBy(Math.PI / 4, 0, 300, 0);
    controller.update(100);
    controller.orbitBy(Math.PI / 4, 0, 300, 100);
    controller.update(400);
    const end = new THREE.Spherical().setFromVector3(camera.position.clone());
    let d = end.theta - start.theta;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    assert.ok(Math.abs(d - Math.PI / 2) < 0.02, `expected 90°, got ${THREE.MathUtils.radToDeg(d)}`);
  });

  it('clamps smooth zoom to the distance limits', () => {
    const { controller } = makeCamera();
    controller.zoomSmooth(0.0001, 100, 0);
    controller.update(100);
    assert.ok(Math.abs(controller.getDistance() - 2) < 0.01);
    controller.zoomSmooth(1000, 100, 200);
    controller.update(300);
    assert.ok(Math.abs(controller.getDistance() - 25) < 0.01);
  });

  it('pans camera and target together, keeping the view direction', () => {
    const { camera, controller } = makeCamera();
    const offsetBefore = camera.position.clone().sub(controller.controls.target);
    controller.panBy(0.2, 0, 100, 0);
    controller.update(100);
    const offsetAfter = camera.position.clone().sub(controller.controls.target);
    assert.ok(controller.controls.target.length() > 0.5, 'target moved');
    assert.ok(offsetAfter.distanceTo(offsetBefore) < 0.01, 'view direction and distance unchanged');
  });

  it('suspends auto-orbit during a transition and restores it afterwards', () => {
    const { controller } = makeCamera({ autoRotate: true });
    controller.goToView('front', 200, 0);
    assert.equal(controller.controls.autoRotate, false);
    assert.equal(controller.isAutoRotating(), true, 'intent preserved');
    controller.update(200);
    assert.equal(controller.controls.autoRotate, true);
  });

  it('remembers an auto-orbit change requested during a transition', () => {
    const { controller } = makeCamera({ autoRotate: true });
    controller.goToView('front', 200, 0);
    controller.setAutoRotate(false);
    controller.update(200);
    assert.equal(controller.controls.autoRotate, false);
  });

  it('an instant preset (key/button) cancels a running transition', () => {
    const { camera, controller } = makeCamera();
    controller.goToView('back', 400, 0);
    controller.update(100);
    controller.setPreset('top');
    assert.equal(controller.isTransitioning(), false);
    controller.update(400);
    assert.ok(camera.position.distanceTo(CAMERA_PRESETS.top.position) < 0.01);
  });
});

/* ------------------------------ 4. arbitration with hands and mouse ------------------------------ */

describe('Command arbitration with live gestures and mouse', () => {
  it('defers a camera command while an open-palm gesture is orbiting, then runs it on release', () => {
    const rig = makeRig();
    // Hand starts orbiting
    rig.frame(PALM, hand(0.5));
    for (let i = 1; i <= 3; i++) rig.frame(PALM, hand(0.5 + i * 0.03));
    assert.equal(rig.gestures.isInteracting(), true);

    const distBefore = rig.controller.getDistance();
    const outcome = rig.executor.execute({ type: 'camera.zoom', direction: 'in', steps: 1 }, 'voice');
    assert.equal(outcome.status, 'deferred');
    rig.advance(16);
    rig.frame(PALM, hand(0.59));
    assert.ok(Math.abs(rig.controller.getDistance() - distBefore) < 0.01, 'zoom must not fight the hand');

    // Hand drops: the deferred zoom runs and animates
    rig.advance(16);
    rig.frame(NONE, []);
    assert.deepEqual(rig.deferred, ['camera.zoom:executed']);
    rig.advance(500);
    rig.frame(NONE, []);
    assert.ok(rig.controller.getDistance() < distBefore * 0.8, 'zoom applied after release');
  });

  it('keeps only the latest deferred camera command', () => {
    const rig = makeRig();
    rig.frame(PALM, hand(0.5));
    for (let i = 1; i <= 3; i++) rig.frame(PALM, hand(0.5 + i * 0.03));
    rig.executor.execute({ type: 'camera.zoom', direction: 'in' }, 'voice');
    rig.executor.execute({ type: 'camera.view', view: 'top' }, 'voice');
    assert.deepEqual(rig.executor.getPending(), { type: 'camera.view', view: 'top' });
    assert.deepEqual(rig.deferred, ['camera.zoom:expired']);
  });

  it('expires a deferred command if the hand keeps steering past the timeout', () => {
    const rig = makeRig();
    rig.frame(PALM, hand(0.5));
    for (let i = 1; i <= 3; i++) rig.frame(PALM, hand(0.5 + i * 0.03));
    rig.executor.execute({ type: 'camera.reset' }, 'voice');
    for (let i = 0; i < 6; i++) {
      rig.advance(PENDING_TTL_MS / 4);
      rig.frame(PALM, hand(0.6 + (i % 2) * 0.03));
    }
    assert.equal(rig.executor.getPending(), null);
    assert.deepEqual(rig.deferred, ['camera.reset:expired']);
  });

  it('a hand that starts orbiting mid-transition takes over without snapping back', () => {
    const rig = makeRig();
    rig.executor.execute({ type: 'camera.view', view: 'back' }, 'voice');
    rig.advance(100);
    rig.frame(NONE, []);
    assert.equal(rig.controller.isTransitioning(), true);

    rig.frame(PALM, hand(0.5));
    for (let i = 1; i <= 3; i++) {
      rig.advance(16);
      rig.frame(PALM, hand(0.5 + i * 0.03));
    }
    assert.equal(rig.controller.isTransitioning(), false, 'transition cancelled by the hand');
    const takenOver = rig.camera.position.clone();
    rig.advance(1000);
    rig.frame(NONE, []);
    assert.ok(rig.camera.position.distanceTo(takenOver) < 0.05, 'camera stays where the hand left it');
  });

  it('defers camera commands during a mouse drag too', () => {
    const rig = makeRig();
    rig.controller.controls.dispatchEvent({ type: 'start' });
    assert.equal(rig.executor.execute({ type: 'camera.orbit', yawDeg: 30 }, 'voice').status, 'deferred');
    rig.controller.controls.dispatchEvent({ type: 'end' });
    rig.frame(NONE, []);
    assert.deepEqual(rig.deferred, ['camera.orbit:executed']);
  });

  it('runs non-camera commands immediately even while the hand is steering', () => {
    const rig = makeRig();
    rig.frame(PALM, hand(0.5));
    for (let i = 1; i <= 3; i++) rig.frame(PALM, hand(0.5 + i * 0.03));
    assert.equal(rig.executor.execute({ type: 'animation.pause' }, 'voice').status, 'executed');
    assert.equal(rig.animation.playing, false);
    assert.equal(rig.executor.execute({ type: 'animation.setSpeed', speed: 0.5 }, 'voice').status, 'executed');
    assert.equal(rig.animation.speed, 0.5);
    assert.equal(rig.executor.execute({ type: 'camera.autoOrbit', enabled: true }, 'voice').status, 'executed');
    assert.equal(rig.getAutoOrbit(), true);
  });
});

/* ------------------------------ 5. end-to-end with the real gearbox ------------------------------ */

describe('End-to-end: dispatcher + viewer executor + real planetary gearbox', () => {
  function makeEndToEnd() {
    const scene = new THREE.Scene();
    const { camera, controller } = makeCamera();
    const lifecycle = new ModelLifecycleManager({ scene, camera, cameraController: controller });
    assert.ok(lifecycle.loadModel(PLANETARY_GEARBOX_MODEL_ID).success);
    let clock = 0;
    const executor = new ViewerCommandExecutor({
      camera: controller,
      lifecycle,
      isGestureInteracting: () => false,
      animation: { setPlaying: () => {}, setSpeed: () => {} },
      setAutoOrbit: () => {},
      now: () => clock,
    });
    const model = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
    const dispatcher = new SceneCommandDispatcher();
    dispatcher.registerContextProvider('workspace', () => ({
      modelId: model.id,
      componentIds: new Set(model.getAllComponentIds()),
      animationIds: (model.animations ?? []).map((a) => a.id),
      registeredModelIds: new Set(modelRegistry.getAllModels().map((m) => m.id)),
    }));
    dispatcher.registerContextProvider('viewer', executor.contextProvider);
    dispatcher.registerHandler(executor);
    return { scene, controller, lifecycle, dispatcher, tick: (ms: number) => { clock += ms; controller.update(clock); } };
  }

  it('reports viewer readiness and exploded-view support from the loaded runtime', () => {
    const { dispatcher } = makeEndToEnd();
    const ctx = dispatcher.getContext();
    assert.equal(ctx.viewerReady, true);
    assert.equal(ctx.supportsExplodedView, true);
  });

  it('focuses the camera smoothly on a real component', () => {
    const { controller, lifecycle, dispatcher, tick } = makeEndToEnd();
    const rec = dispatcher.dispatch({ type: 'component.focus', componentId: 'ring_gear' }, 'voice');
    assert.equal(rec.status, 'executed');
    tick(400);
    const center = lifecycle.getComponentBounds('ring_gear')!.getCenter(new THREE.Vector3());
    assert.ok(controller.controls.target.distanceTo(center) < 0.01);
  });

  it('isolates a component and restores the full assembly', () => {
    const { lifecycle, dispatcher } = makeEndToEnd();
    assert.equal(dispatcher.dispatch({ type: 'component.isolate', componentId: 'sun_gear' }, 'voice').status, 'executed');
    assert.equal(lifecycle.getIsolatedComponentId(), 'sun_gear');
    assert.equal(dispatcher.dispatch({ type: 'component.isolate', componentId: null }, 'voice').status, 'executed');
    assert.equal(lifecycle.getIsolatedComponentId(), null);
  });

  it('isolated components actually render (no hidden ancestor container) — regression', () => {
    for (const id of ['sun_gear', 'ring_gear', 'planet_carrier', 'central_shaft']) {
      const { lifecycle, dispatcher } = makeEndToEnd();
      dispatcher.dispatch({ type: 'component.isolate', componentId: id }, 'voice');
      const root = lifecycle.getActiveRuntime()!.rootGroup;
      let renderedMeshes = 0;
      let otherRendered = 0;
      root.traverse((obj) => {
        if (!(obj as THREE.Mesh).isMesh) return;
        let worldVisible = true;
        for (let o: THREE.Object3D | null = obj; o; o = o.parent) worldVisible &&= o.visible;
        const compId = obj.userData?.componentId;
        if (worldVisible && compId === id) renderedMeshes++;
        if (worldVisible && compId && compId !== id) otherRendered++;
      });
      assert.ok(renderedMeshes > 0, `${id} must be visible on screen when isolated`);
      assert.equal(otherRendered, 0, `only ${id} renders`);
    }
  });

  it('restoring isolation brings back the whole assembly on screen', () => {
    const { lifecycle, dispatcher } = makeEndToEnd();
    dispatcher.dispatch({ type: 'component.isolate', componentId: 'sun_gear' }, 'voice');
    dispatcher.dispatch({ type: 'component.isolate', componentId: null }, 'voice');
    const root = lifecycle.getActiveRuntime()!.rootGroup;
    let hiddenParts = 0;
    root.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh || !obj.userData?.componentId) return;
      let worldVisible = true;
      for (let o: THREE.Object3D | null = obj; o; o = o.parent) worldVisible &&= o.visible;
      if (!worldVisible) hiddenParts++;
    });
    assert.equal(hiddenParts, 0);
  });

  it('safely rejects parts from another model without touching the scene', () => {
    const { controller, dispatcher } = makeEndToEnd();
    const before = controller.camera.position.clone();
    const rec = dispatcher.dispatch({ type: 'component.focus', componentId: 'bridge_deck' }, 'ai');
    assert.equal(rec.status, 'rejected');
    assert.equal(rec.code, 'UNKNOWN_COMPONENT');
    assert.ok(controller.camera.position.equals(before));
  });
});
