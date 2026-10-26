/**
 * Unit Test Suite for GestureCameraController & GestureOrbitEngine
 * Task 4.1: Open-Palm Orbit Navigation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GestureOrbitEngine,
  DEFAULT_GESTURE_ORBIT_CONFIG,
} from '../src/components/scene/GestureCameraController';
import type { NormalizedLandmark } from '../src/types/landmarks';

/**
 * Generates synthetic 21-point landmark array centered precisely at (centerX, centerY).
 * Palm boundary landmarks (0, 5, 9, 13, 17) have offsets that sum to 0.
 */
function createPalmLandmarks(centerX: number, centerY: number): NormalizedLandmark[] {
  const palmOffsets: Record<number, [number, number]> = {
    0: [0, 0.04], // Wrist
    5: [-0.03, -0.01], // Index MCP
    9: [0, -0.03], // Middle MCP
    13: [0.01, -0.02], // Ring MCP
    17: [0.02, 0.02], // Pinky MCP
  };

  const landmarks: NormalizedLandmark[] = [];
  for (let i = 0; i < 21; i++) {
    const offset = palmOffsets[i] ?? [0, 0];
    landmarks.push({
      x: centerX + offset[0],
      y: centerY + offset[1],
      z: 0,
    });
  }
  return landmarks;
}

describe('GestureOrbitEngine (Pure Math & Interaction Logic)', () => {
  it('exposes centrally configured default orbit parameters', () => {
    assert.equal(DEFAULT_GESTURE_ORBIT_CONFIG.mirrorX, true);
    assert.ok(DEFAULT_GESTURE_ORBIT_CONFIG.deadband > 0);
    assert.ok(DEFAULT_GESTURE_ORBIT_CONFIG.yawSensitivity > 0);
    assert.ok(DEFAULT_GESTURE_ORBIT_CONFIG.pitchSensitivity > 0);
    assert.deepEqual(DEFAULT_GESTURE_ORBIT_CONFIG.palmLandmarkIndices, [0, 5, 9, 13, 17]);
  });

  it('correctly calculates palm centroid anchor from rigid landmarks (0, 5, 9, 13, 17)', () => {
    const engine = new GestureOrbitEngine();
    const landmarks = createPalmLandmarks(0.5, 0.4);
    const anchor = engine.computeAnchor(landmarks);

    assert.ok(anchor !== null);
    assert.ok(Math.abs(anchor.x - 0.5) < 1e-5, `Expected x ~ 0.5, got ${anchor.x}`);
    assert.ok(Math.abs(anchor.y - 0.4) < 1e-5, `Expected y ~ 0.4, got ${anchor.y}`);
  });

  it('safely handles null, empty, or insufficient landmarks in anchor calculation', () => {
    const engine = new GestureOrbitEngine();

    assert.equal(engine.computeAnchor(null), null);
    assert.equal(engine.computeAnchor([]), null);

    // Less than 3 valid landmarks
    const partial: NormalizedLandmark[] = [
      { x: 0.5, y: 0.5, z: 0 },
      { x: 0.5, y: 0.5, z: 0 },
    ];
    assert.equal(engine.computeAnchor(partial), null);
  });

  it('safely filters out NaN and non-finite coordinates', () => {
    const engine = new GestureOrbitEngine();
    const landmarks = createPalmLandmarks(0.5, 0.5);
    // Corrupt one landmark
    landmarks[0] = { x: Number.NaN, y: 0.5, z: 0 };

    const anchor = engine.computeAnchor(landmarks);
    assert.ok(anchor !== null);
    assert.ok(Number.isFinite(anchor.x));
    assert.ok(Number.isFinite(anchor.y));
  });

  it('initializes anchor on the first active frame without generating false camera motion', () => {
    const engine = new GestureOrbitEngine();
    const hand = createPalmLandmarks(0.5, 0.5);

    // First frame of gesture
    const result = engine.update(true, hand, false);

    assert.equal(result.isActive, true);
    assert.equal(result.deltaYaw, 0, 'First frame must have 0 yaw delta');
    assert.equal(result.deltaPitch, 0, 'First frame must have 0 pitch delta');
    assert.ok(result.anchor !== null);
  });

  it('maps horizontal hand movement to camera yaw with mirrored coordinate handling', () => {
    const engine = new GestureOrbitEngine({ mirrorX: true });
    const hand1 = createPalmLandmarks(0.50, 0.50);
    const handRight = createPalmLandmarks(0.45, 0.50); // In raw webcam, moving right decreases x
    const handLeft = createPalmLandmarks(0.55, 0.50); // Moving left increases x

    // 1. Initial frame
    engine.update(true, hand1, false);

    // 2. Move physical hand to right (raw x drops from 0.50 to 0.45 -> mirrored dx > 0)
    const rightResult = engine.update(true, handRight, false);
    assert.equal(rightResult.isActive, true);
    assert.ok(
      rightResult.deltaYaw > 0,
      `Moving hand right must produce positive yaw (rotate camera right), got ${rightResult.deltaYaw}`
    );
    assert.equal(rightResult.deltaPitch, 0, 'Horizontal movement must not induce vertical pitch');

    // 3. Move physical hand to left (raw x rises from 0.45 to 0.55)
    const leftResult = engine.update(true, handLeft, false);
    assert.equal(leftResult.isActive, true);
    assert.ok(
      leftResult.deltaYaw < 0,
      `Moving hand left must produce negative yaw, got ${leftResult.deltaYaw}`
    );
  });

  it('maps vertical hand movement to camera elevation (pitch)', () => {
    const engine = new GestureOrbitEngine();
    const hand1 = createPalmLandmarks(0.50, 0.50);
    const handUp = createPalmLandmarks(0.50, 0.45); // Screen coordinate y decreases when moving UP
    const handDown = createPalmLandmarks(0.50, 0.55); // Screen coordinate y increases when moving DOWN

    // 1. Initial frame
    engine.update(true, hand1, false);

    // 2. Move hand UP (raw y drops from 0.50 to 0.45)
    const upResult = engine.update(true, handUp, false);
    assert.equal(upResult.isActive, true);
    assert.ok(
      upResult.deltaPitch > 0,
      `Moving hand up must produce positive elevation delta (rotateUp), got ${upResult.deltaPitch}`
    );
    assert.equal(upResult.deltaYaw, 0, 'Vertical movement must not induce horizontal yaw');

    // 3. Move hand DOWN (raw y rises from 0.45 to 0.55)
    const downResult = engine.update(true, handDown, false);
    assert.equal(downResult.isActive, true);
    assert.ok(
      downResult.deltaPitch < 0,
      `Moving hand down must produce negative elevation delta, got ${downResult.deltaPitch}`
    );
  });

  it('respects invertYaw and invertPitch configuration flags', () => {
    const engine = new GestureOrbitEngine({
      mirrorX: true,
      invertYaw: true,
      invertPitch: true,
    });

    engine.update(true, createPalmLandmarks(0.5, 0.5), false);

    // Hand moving right (raw x drops) with invertYaw: true should produce negative yaw
    const resRight = engine.update(true, createPalmLandmarks(0.45, 0.5), false);
    assert.ok(resRight.deltaYaw < 0, 'Inverted yaw must produce negative delta on rightward move');

    // Hand moving up (raw y drops) with invertPitch: true should produce negative pitch
    const resUp = engine.update(true, createPalmLandmarks(0.45, 0.45), false);
    assert.ok(resUp.deltaPitch < 0, 'Inverted pitch must produce negative delta on upward move');
  });

  it('filters out micro-tremor fluctuations within the deadband threshold', () => {
    const deadband = 0.005;
    const engine = new GestureOrbitEngine({ deadband });

    engine.update(true, createPalmLandmarks(0.5000, 0.5000), false);

    // Micro movement dx = 0.001, dy = 0.001 (distance ~ 0.0014 < 0.005)
    const tremorResult = engine.update(true, createPalmLandmarks(0.5010, 0.5010), false);
    assert.equal(tremorResult.deltaYaw, 0, 'Displacement within deadband must produce 0 yaw delta');
    assert.equal(tremorResult.deltaPitch, 0, 'Displacement within deadband must produce 0 pitch delta');
    assert.equal(tremorResult.isActive, true);

    // Larger deliberate movement dx = 0.02, dy = 0 (distance = 0.02 > 0.005)
    const moveResult = engine.update(true, createPalmLandmarks(0.4800, 0.5010), false);
    assert.notEqual(moveResult.deltaYaw, 0, 'Movement exceeding deadband must generate delta');
  });

  it('protects against sudden tracking jumps by discarding outlier delta and re-anchoring', () => {
    const maxJump = 0.15;
    const engine = new GestureOrbitEngine({ maxJumpThreshold: maxJump });

    engine.update(true, createPalmLandmarks(0.5, 0.5), false);

    // Teleportation / anomaly jump: hand moves from 0.5 to 0.85 (distance 0.35 > 0.15)
    const jumpResult = engine.update(true, createPalmLandmarks(0.85, 0.5), false);
    assert.equal(jumpResult.deltaYaw, 0, 'Outlier jump must be rejected with 0 yaw delta');
    assert.equal(jumpResult.deltaPitch, 0, 'Outlier jump must be rejected with 0 pitch delta');
    assert.equal(jumpResult.isActive, true);

    // Next normal move from the re-anchored position (0.85 -> 0.83) should work cleanly
    const nextResult = engine.update(true, createPalmLandmarks(0.83, 0.5), false);
    assert.notEqual(nextResult.deltaYaw, 0, 'Subsequent movement from re-anchored position must function');
  });

  it('resets anchor cleanly when tracking is lost, preventing jumps upon re-acquisition', () => {
    const engine = new GestureOrbitEngine();

    engine.update(true, createPalmLandmarks(0.5, 0.5), false);
    engine.update(true, createPalmLandmarks(0.48, 0.5), false);

    // Hand tracking dropped
    const lostResult = engine.update(true, null, false);
    assert.equal(lostResult.isActive, false);
    assert.equal(lostResult.anchor, null);

    // Hand re-enters at a completely different position (0.2, 0.8)
    const reacquiredResult = engine.update(true, createPalmLandmarks(0.2, 0.8), false);
    assert.equal(reacquiredResult.isActive, true);
    assert.equal(reacquiredResult.deltaYaw, 0, 'Reacquired tracking must not snap camera');
    assert.equal(reacquiredResult.deltaPitch, 0);
  });

  it('does not generate camera movement while gesture is inactive', () => {
    const engine = new GestureOrbitEngine();

    // Hand moving across frame while gesture is false (e.g. POINTING or NONE)
    const res1 = engine.update(false, createPalmLandmarks(0.5, 0.5), false);
    assert.equal(res1.isActive, false);
    assert.equal(res1.deltaYaw, 0);

    const res2 = engine.update(false, createPalmLandmarks(0.2, 0.8), false);
    assert.equal(res2.isActive, false);
    assert.equal(res2.deltaYaw, 0);
    assert.equal(res2.deltaPitch, 0);
  });

  it('yields immediately when mouse drag is active', () => {
    const engine = new GestureOrbitEngine();

    // Hand is open palm and moving, but mouse drag is active
    engine.update(true, createPalmLandmarks(0.5, 0.5), false);
    const mouseActiveResult = engine.update(true, createPalmLandmarks(0.45, 0.5), true);

    assert.equal(mouseActiveResult.isActive, false, 'Must be inactive when mouse is active');
    assert.equal(mouseActiveResult.deltaYaw, 0);
    assert.equal(mouseActiveResult.deltaPitch, 0);
  });

  it('scales rotation proportionally with configured sensitivity', () => {
    const engineLow = new GestureOrbitEngine({ yawSensitivity: 1.0, mirrorX: true });
    const engineHigh = new GestureOrbitEngine({ yawSensitivity: 4.0, mirrorX: true });

    engineLow.update(true, createPalmLandmarks(0.5, 0.5), false);
    engineHigh.update(true, createPalmLandmarks(0.5, 0.5), false);

    const resLow = engineLow.update(true, createPalmLandmarks(0.45, 0.5), false);
    const resHigh = engineHigh.update(true, createPalmLandmarks(0.45, 0.5), false);

    assert.ok(Math.abs(resHigh.deltaYaw - resLow.deltaYaw * 4) < 1e-4);
  });
});
