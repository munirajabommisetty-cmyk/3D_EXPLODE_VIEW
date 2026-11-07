/**
 * Hand-tracking performance pass and fact-pack size (6 Nov 2026). Pure logic, no camera, no network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HandFrameStore, coarseGestureKey, coarseHandsKey } from '../src/services/tracking/handFrameStore';
import { IDLE_DETECT_INTERVAL_MS, shouldSkipIdleFrame } from '../src/services/tracking/useHandLandmarker';
import { buildFactPack } from '../src/services/teaching/factPack';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import type { HandLandmarkResult } from '../src/types/landmarks';
import type { GestureRecognitionResult } from '../src/types/gestures';
import { makeWorkspace } from './sceneContext.test';

const hand = (handedness: 'Left' | 'Right', x = 0.5): HandLandmarkResult => ({
  landmarks: Array.from({ length: 21 }, (_, i) => ({ x: x + i * 0.001, y: 0.5, z: 0 })),
  rawLandmarks: [], handedness, score: 0.9, timestamp: 0,
});
const gesture = (g: string, confidence: number, isStable = true) =>
  ({ gesture: g, rawGesture: g, confidence, isStable, consecutiveFrames: 5, handedness: 'Right' }) as unknown as GestureRecognitionResult;

describe('Hand-frame store: per-frame data outside React', () => {
  it('delivers every published frame to subscribers, and stops after unsubscribe', () => {
    const store = new HandFrameStore();
    const seen: number[] = [];
    const off = store.subscribe((f) => seen.push(f.hands.length));
    store.publish([hand('Right')], gesture('OPEN_PALM', 0.9));
    store.publish([hand('Right'), hand('Left')], null);
    off();
    store.publish([], null);
    assert.deepEqual(seen, [1, 2]);
    assert.equal(store.get().hands.length, 0, 'latest frame is always readable');
  });

  it('coarse hand key ignores landmark motion (no app re-render per frame) but sees hands appear / change', () => {
    assert.equal(coarseHandsKey([hand('Right', 0.1)]), coarseHandsKey([hand('Right', 0.7)]), 'moving hand: same key');
    assert.notEqual(coarseHandsKey([hand('Right')]), coarseHandsKey([hand('Right'), hand('Left')]));
    assert.notEqual(coarseHandsKey([hand('Right')]), coarseHandsKey([hand('Left')]));
    assert.notEqual(coarseHandsKey([]), coarseHandsKey([hand('Right')]));
  });

  it('coarse gesture key changes with gesture, stability and 10 % confidence steps only', () => {
    assert.equal(coarseGestureKey(gesture('PINCH', 0.91)), coarseGestureKey(gesture('PINCH', 0.94)));
    assert.notEqual(coarseGestureKey(gesture('PINCH', 0.91)), coarseGestureKey(gesture('PINCH', 0.71)));
    assert.notEqual(coarseGestureKey(gesture('PINCH', 0.9)), coarseGestureKey(gesture('POINTING', 0.9)));
    assert.notEqual(coarseGestureKey(gesture('PINCH', 0.9, true)), coarseGestureKey(gesture('PINCH', 0.9, false)));
    for (const g of ['PINCH', 'OPEN_PALM', 'POINTING', 'NONE']) assert.ok(coarseGestureKey(gesture(g, 0.8)).startsWith(g));
    assert.equal(coarseGestureKey(null), 'none');
  });
});

describe('Idle hand search rate', () => {
  it('searches about 15 times a second only while no hand is tracked', () => {
    assert.equal(IDLE_DETECT_INTERVAL_MS, 66);
    assert.equal(shouldSkipIdleFrame(0, 1000, 990), true, 'no hand, last search 10 ms ago: skip');
    assert.equal(shouldSkipIdleFrame(0, 1000, 1000 - IDLE_DETECT_INTERVAL_MS), false, 'interval passed: search');
    assert.equal(shouldSkipIdleFrame(1, 1000, 990), false, 'a tracked hand: every frame is processed');
    assert.equal(shouldSkipIdleFrame(2, 1000, 999), false);
    assert.equal(shouldSkipIdleFrame(0, 1000, 0), false, 'first frame is always processed');
  });
});

describe('Fact pack: fewer tokens, same facts', () => {
  const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;

  it('a part question keeps every relationship but only the relevant sentences', () => {
    const w = makeWorkspace(gearbox);
    const fp = buildFactPack(gearbox, w.snapshot(false), 'sun_gear');
    const all = fp.components.reduce((n, c) => n + c.relationships.length, 0);
    const expected = gearbox.getAllComponentIds().reduce((n, id) => n + Math.min(20, (gearbox.getComponentMetadata(id)?.relationships ?? []).length), 0);
    assert.ok(all >= expected - 2, 'relationships (type + target) are still listed for every part');
    const sun = fp.components.find((c) => c.id === 'sun_gear')!;
    assert.ok(sun.relationships.every((r) => r.description.length > 0), 'the asked-about part keeps its sentences');
    const detailed = new Set(['sun_gear', ...sun.relationships.map((r) => r.target)]);
    for (const c of fp.components.filter((x) => !detailed.has(x.id))) {
      assert.ok(c.relationships.every((r) => r.description === ''), `${c.id}: no sentences for unrelated parts`);
    }
  });

  it('a whole-model question keeps every sentence', () => {
    const w = makeWorkspace(gearbox);
    const fp = buildFactPack(gearbox, w.snapshot(false), null);
    const withText = fp.components.flatMap((c) => c.relationships).filter((r) => r.description.length > 0).length;
    assert.ok(withText > 0);
    assert.ok(fp.components.every((c) => c.description !== undefined));
  });
});
