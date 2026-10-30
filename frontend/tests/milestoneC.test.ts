/**
 * Milestone C — two-hand explode / reassemble, animation, labels and transform restore.
 * Hand input is SYNTHETIC landmark data (no camera); no live services.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Object3D } from 'three';
import type { NormalizedLandmark } from '../src/types/landmarks';
import { handOpenness, TwoHandExplodeMachine, type TwoHandInput } from '../src/services/gestures/twoHandExplode';
import {
  approach, componentLabels, ExplodeAnimator, EXPLODE_ANIMATION_MS, labelPhase, layoutLabels, mixColor,
} from '../src/services/scene/explodePresentation';
import { buildPlanetaryGearbox } from '../src/components/scene/PlanetaryGearbox';
import { buildWarrenTrussBridge } from '../src/models/civil/WarrenTrussBridge';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import { handleVoiceTurn } from '../src/services/voice/voiceSession';
import { makeWorkspace } from './sceneContext.test';

/**
 * A synthetic right-size hand: palm size `scale` (wrist->middle MCP), thumb tip near the index
 * MCP; index and middle fingertips `indexOpen` / `middleOpen` palm-sizes away from the thumb tip.
 */
function hand(wristX: number, indexOpen: number, middleOpen = indexOpen, scale = 0.2): { landmarks: NormalizedLandmark[]; score: number } {
  const p = (x: number, y: number): NormalizedLandmark => ({ x, y, z: 0 });
  const lm: NormalizedLandmark[] = Array.from({ length: 21 }, () => p(wristX, 0.8));
  lm[0] = p(wristX, 0.8); // wrist
  lm[5] = p(wristX - 0.25 * scale, 0.8 - 0.9 * scale); // index MCP
  lm[9] = p(wristX, 0.8 - scale); // middle MCP
  lm[17] = p(wristX + 0.25 * scale, 0.8 - 0.85 * scale); // pinky MCP
  const thumb = p(wristX - 0.4 * scale, 0.8 - 1.1 * scale);
  lm[4] = thumb;
  lm[8] = p(thumb.x, thumb.y - indexOpen * scale);
  lm[12] = p(thumb.x + 0.1 * scale, thumb.y - Math.sqrt(Math.max(0, middleOpen * middleOpen - 0.01)) * scale);
  return { landmarks: lm, score: 0.95 };
}

const PINCH = 0.15;
const OPEN = 1.2;

/** Runs frames at 30 fps; returns every action emitted. */
function run(m: TwoHandExplodeMachine, frames: number, input: (i: number) => Omit<TwoHandInput, 'timeMs'>, clock: { t: number }) {
  const actions: string[] = [];
  let last = m.update({ ...input(0), timeMs: clock.t });
  if (last.action) actions.push(last.action);
  for (let i = 1; i < frames; i++) {
    clock.t += 33;
    last = m.update({ ...input(i), timeMs: clock.t });
    if (last.action) actions.push(last.action);
  }
  return { actions, last };
}

const scene = (hands: ReturnType<typeof hand>[], modelExploded = false, animating = false) =>
  ({ hands, modelExploded, animating, canExplode: true });
const both = (o: number, o2 = o) => [hand(0.3, o), hand(0.7, o2)];

describe('Milestone C: hand opening measurement', () => {
  it('is normalised by palm size: the same pose near and far gives the same value', () => {
    const near = handOpenness(hand(0.5, 1.0, 1.0, 0.3).landmarks)!;
    const far = handOpenness(hand(0.5, 1.0, 1.0, 0.1).landmarks)!;
    assert.ok(Math.abs(near.index - far.index) < 0.02 && Math.abs(near.index - 1.0) < 0.05);
    assert.ok(handOpenness(hand(0.5, PINCH).landmarks)!.index < 0.35);
    assert.equal(handOpenness([]), null);
  });
});

describe('Milestone C: two-hand state machine', () => {
  it('a stable two-hand pinch arms without moving anything; spreading both hands explodes once', () => {
    const m = new TwoHandExplodeMachine();
    const clock = { t: 0 };
    const armed = run(m, 8, () => scene(both(PINCH)), clock);
    assert.deepEqual([armed.actions, armed.last.state, armed.last.engaged], [[], 'PINCH_ARMED', true]);
    const open = run(m, 8, () => scene(both(OPEN)), clock);
    assert.deepEqual(open.actions, ['explode'], 'exactly one request');
    assert.equal(open.last.state, 'EXPLODING');
    const done = run(m, 2, () => scene(both(OPEN), true, false), clock);
    assert.equal(done.last.state, 'EXPLODED');
  });

  it('opening without first pinching does nothing (no explode from arbitrary hand movement)', () => {
    const m = new TwoHandExplodeMachine();
    const r = run(m, 30, () => scene(both(OPEN)), { t: 0 });
    assert.deepEqual([r.actions, r.last.state], [[], 'ASSEMBLED']);
  });

  it('one hand only (pinch then open) never explodes and does not take the camera away', () => {
    const m = new TwoHandExplodeMachine();
    const clock = { t: 0 };
    const a = run(m, 10, () => scene([hand(0.5, PINCH)]), clock);
    const b = run(m, 10, () => scene([hand(0.5, OPEN)]), clock);
    assert.deepEqual([...a.actions, ...b.actions], []);
    assert.equal(b.last.engaged, false);
  });

  it('only one hand open (the other still pinched) does not explode', () => {
    const m = new TwoHandExplodeMachine();
    const clock = { t: 0 };
    run(m, 8, () => scene(both(PINCH)), clock);
    const r = run(m, 20, () => scene(both(OPEN, PINCH)), clock);
    assert.deepEqual([r.actions, r.last.state], [[], 'PINCH_ARMED']);
  });

  it('values jittering inside the hysteresis band never trigger', () => {
    const m = new TwoHandExplodeMachine();
    const clock = { t: 0 };
    run(m, 8, () => scene(both(PINCH)), clock);
    const r = run(m, 60, (i) => scene(both(i % 2 ? 0.8 : 0.45)), clock);
    assert.deepEqual(r.actions, []);
  });

  it('a brief loss of one hand does not flicker the state or fire an action', () => {
    const m = new TwoHandExplodeMachine();
    const clock = { t: 0 };
    run(m, 8, () => scene(both(PINCH)), clock);
    const gap = run(m, 6, () => scene([hand(0.3, OPEN)]), clock); // ~200 ms with one hand
    assert.deepEqual([gap.actions, gap.last.state, gap.last.engaged], [[], 'PINCH_ARMED', true]);
    const back = run(m, 3, () => scene(both(OPEN)), clock);
    assert.deepEqual(back.actions, [], 'the open count restarts after the gap');
    const more = run(m, 3, () => scene(both(OPEN)), clock);
    assert.deepEqual(more.actions, ['explode']);
  });

  it('closing both hands while exploded reassembles once; the state follows the model back', () => {
    const m = new TwoHandExplodeMachine();
    const clock = { t: 0 };
    run(m, 8, () => scene(both(PINCH)), clock);
    run(m, 8, () => scene(both(OPEN)), clock);
    run(m, 2, () => scene(both(OPEN), true, false), clock);
    const close = run(m, 10, () => scene(both(PINCH), true, false), clock);
    assert.deepEqual([close.actions, close.last.state], [['restore'], 'REASSEMBLING']);
    const done = run(m, 2, () => scene(both(PINCH), false, false), clock);
    assert.ok(['ASSEMBLED', 'PINCH_ARMED'].includes(done.last.state));
  });

  it('closing during the explode animation interrupts it safely (reassembles)', () => {
    const m = new TwoHandExplodeMachine();
    const clock = { t: 0 };
    run(m, 8, () => scene(both(PINCH)), clock);
    run(m, 6, () => scene(both(OPEN), true, true), clock);
    const r = run(m, 10, () => scene(both(PINCH), true, true), clock);
    assert.deepEqual([r.actions, r.last.state], [['restore'], 'REASSEMBLING']);
  });

  it('long tracking loss: TRACKING_LOST, model untouched; on return it follows the model and needs a fresh pinch', () => {
    const m = new TwoHandExplodeMachine();
    const clock = { t: 0 };
    run(m, 8, () => scene(both(PINCH)), clock);
    run(m, 8, () => scene(both(OPEN)), clock);
    run(m, 2, () => scene(both(OPEN), true, false), clock);
    const lost = run(m, 60, () => scene([], true, false), clock); // ~2 s without hands
    assert.deepEqual([lost.actions, lost.last.state, lost.last.engaged], [[], 'TRACKING_LOST', false]);
    const back = run(m, 3, () => scene(both(PINCH), true, false), clock);
    assert.deepEqual([back.actions, back.last.state], [[], 'EXPLODED'], 'no instant reassembly on reacquire');
    const again = run(m, 6, () => scene(both(PINCH), true, false), clock);
    assert.deepEqual(again.actions, ['restore'], 'a held pinch then reassembles');
  });

  it('follows explode / restore from voice or the X key', () => {
    const m = new TwoHandExplodeMachine();
    const clock = { t: 0 };
    assert.equal(run(m, 2, () => scene(both(OPEN), true, false), clock).last.state, 'EXPLODED');
    assert.equal(run(m, 2, () => scene(both(OPEN), false, false), clock).last.state, 'ASSEMBLED');
  });

  it('a model without an exploded view: the gesture is off and camera gestures stay available', () => {
    const m = new TwoHandExplodeMachine();
    const r = run(m, 30, (i) => ({ ...scene(both(i < 10 ? PINCH : OPEN)), canExplode: false }), { t: 0 });
    assert.deepEqual([r.actions, r.last.engaged], [[], false]);
  });

  it('a rejected explode (model never reports it) returns to ASSEMBLED', () => {
    const m = new TwoHandExplodeMachine();
    const clock = { t: 0 };
    run(m, 8, () => scene(both(PINCH)), clock);
    run(m, 6, () => scene(both(OPEN)), clock);
    const r = run(m, 60, () => scene(both(OPEN), false, false), clock);
    assert.equal(r.last.state, 'ASSEMBLED');
  });
});

describe('Milestone C: explode animation', () => {
  it('eases to the target in the set time; reversing mid-way continues from the current value', () => {
    const a = new ExplodeAnimator();
    a.setTarget(0.75, 0);
    assert.equal(a.update(0), 0);
    const mid = a.update(EXPLODE_ANIMATION_MS / 2);
    assert.ok(mid > 0.2 && mid < 0.6, String(mid));
    a.setTarget(0, EXPLODE_ANIMATION_MS / 2); // reassemble half way
    assert.equal(a.update(EXPLODE_ANIMATION_MS / 2), mid, 'no jump when reversed');
    assert.equal(a.update(EXPLODE_ANIMATION_MS * 2), 0);
    assert.equal(a.isAnimating(), false);
    a.setTarget(0.75, 0);
    a.snap(0);
    assert.deepEqual([a.getValue(), a.getTarget(), a.isAnimating()], [0, 0, false]);
  });

  it('presentation helpers: colour blend and rate-limited approach', () => {
    assert.equal(mixColor(0x000000, 0xffffff, 0), 0x000000);
    assert.equal(mixColor(0x000000, 0xffffff, 1), 0xffffff);
    assert.equal(approach(0, 1, 2.5, 0.1), 0.25);
    assert.equal(approach(0.9, 1, 2.5, 0.1), 1);
  });
});

/** Every object's local position and rotation (the assembled pose). */
function pose(root: Object3D): string[] {
  const out: string[] = [];
  root.traverse((o) => out.push(`${o.uuid} ${o.position.toArray().map((v) => v.toFixed(9))} ${o.rotation.toArray().slice(0, 3).map((v) => Number(v).toFixed(9))}`));
  return out;
}

describe('Milestone C: reassembly restores the exact original transforms', () => {
  for (const [name, build] of [['gearbox', buildPlanetaryGearbox], ['bridge', buildWarrenTrussBridge]] as const) {
    it(`${name}: explode (with interruptions) then reassemble -> identical positions and rotations`, () => {
      const c = build();
      const before = pose(c.group);
      for (const f of [0.2, 0.75, 0.4, 1, 0.33, 0]) c.setExplodedFactor!(f);
      assert.deepEqual(pose(c.group), before);
      c.setExplodedFactor!(0.75);
      assert.notDeepEqual(pose(c.group), before, 'the parts really moved');
      c.dispose();
    });
  }

  it('gearbox parts move in different directions (axial up/down, planets outward), not all the same way', () => {
    const c = buildPlanetaryGearbox();
    const ids = ['central_shaft', 'sun_gear', 'planet_carrier', 'ring_gear', 'planet_gear_1'];
    const at = () => Object.fromEntries(ids.map((id) => {
      let found: Object3D | null = null;
      c.group.traverse((o) => { if (!found && o.userData?.componentId === id) found = o; });
      return [id, (found as unknown as Object3D).getWorldPosition(new (found as unknown as Object3D).position.constructor() as never)];
    }));
    c.group.updateMatrixWorld(true);
    const a = at();
    c.setExplodedFactor!(0.75);
    c.group.updateMatrixWorld(true);
    const b = at();
    const dy = (id: string) => (b[id] as { y: number }).y - (a[id] as { y: number }).y;
    assert.ok(dy('central_shaft') > 0 && dy('sun_gear') > 0, 'input side moves up the axis');
    assert.ok(dy('planet_carrier') < 0 && dy('ring_gear') < 0, 'carrier and ring move down');
    const r = (p: { x: number; z: number }) => Math.hypot(p.x, p.z);
    assert.ok(r(b.planet_gear_1 as never) > r(a.planet_gear_1 as never), 'planets move outward');
    c.dispose();
  });
});

describe('Milestone C: exploded-view labels', () => {
  it('shown only once fully exploded; fade out as soon as reassembly starts; hidden when assembled', () => {
    assert.equal(labelPhase(0.75, 0.4, false), 'hidden', 'still moving apart');
    assert.equal(labelPhase(0.75, 0.75, false), 'shown');
    assert.equal(labelPhase(0, 0.6, true), 'fadingOut');
    assert.equal(labelPhase(0, 0, true), 'hidden');
    assert.equal(labelPhase(0, 0, false), 'hidden');
  });

  it('one label per part with the canonical model name; no duplicates, no unknown parts', () => {
    const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
    const labels = componentLabels([...gearbox.getAllComponentIds(), 'not_a_part', 'sun_gear'], (id) => gearbox.getComponentMetadata(id)?.name);
    assert.deepEqual(labels.map((l) => l.id), gearbox.getAllComponentIds());
    assert.deepEqual(labels.map((l) => l.name), gearbox.getAllComponentIds().map((id) => gearbox.getComponentMetadata(id)!.name));
  });

  it('overlapping labels are pushed apart', () => {
    const ys = layoutLabels([
      { id: 'a', x: 100, y: 100, width: 80, height: 22 },
      { id: 'b', x: 110, y: 105, width: 80, height: 22 },
      { id: 'c', x: 400, y: 100, width: 80, height: 22 },
    ]);
    assert.equal(ys.get('a'), 100);
    assert.ok(ys.get('b')! >= 100 + 22 + 4);
    assert.equal(ys.get('c'), 100, 'labels that do not overlap stay where they are');
  });
});

describe('Milestone C: voice explode / reassemble still work through the dispatcher', () => {
  it('"explode" and "put it back together" execute', () => {
    const w = makeWorkspace();
    const ALL = modelRegistry.getAllModels();
    const say = (t: string) => handleVoiceTurn({ transcript: t, language: 'en-IN', dispatcher: w.dispatcher, model: w.ws.model, allModels: ALL, teachingAvailable: true });
    assert.deepEqual(say('explode').records.map((r) => [r.command.type, r.status]), [['assembly.explode', 'executed']]);
    assert.deepEqual(say('put it back together').records.map((r) => [r.command.type, r.status]), [['assembly.restore', 'executed']]);
  });
});
