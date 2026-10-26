/**
 * Unit Test Suite for Task 4.2: Gesture-Based Pinch-to-Zoom
 *
 * Validates:
 * 1. Normalized pinch-distance calculation and scale-invariance.
 * 2. Zoom-in and zoom-out direction mapping.
 * 3. Deadband tremor filtering.
 * 4. Single-frame tracking jump rejection.
 * 5. Tracking loss and re-entry handling.
 * 6. Conflict handling with OPEN_PALM, POINTING, and mouse controls.
 * 7. Camera min/max distance clamping via CameraController.zoomBy.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  GesturePinchZoomEngine,
  DEFAULT_GESTURE_PINCH_ZOOM_CONFIG,
} from '../src/components/scene/GestureCameraController';
import { CameraController } from '../src/components/scene/CameraController';
import type { NormalizedLandmark } from '../src/types/landmarks';

/**
 * Creates synthetic 21-point hand landmark array with customizable thumb and index tip positions.
 */
function createHandWithPinch(
  thumbTip: { x: number; y: number; z?: number },
  indexTip: { x: number; y: number; z?: number },
  scaleFactor: number = 1.0
): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = Array.from({ length: 21 }, () => ({
    x: 0.5 * scaleFactor,
    y: 0.5 * scaleFactor,
    z: 0,
  }));

  // Rigid palm landmarks defining hand scale (wrist 0 and middle MCP 9)
  // Distance = 0.22 * scaleFactor
  landmarks[0] = { x: 0.5 * scaleFactor, y: 0.8 * scaleFactor, z: 0 }; // Wrist
  landmarks[5] = { x: 0.45 * scaleFactor, y: 0.6 * scaleFactor, z: 0 }; // Index MCP
  landmarks[9] = { x: 0.5 * scaleFactor, y: 0.58 * scaleFactor, z: 0 }; // Middle MCP
  landmarks[13] = { x: 0.55 * scaleFactor, y: 0.6 * scaleFactor, z: 0 }; // Ring MCP
  landmarks[17] = { x: 0.6 * scaleFactor, y: 0.63 * scaleFactor, z: 0 }; // Pinky MCP

  // Thumb Tip (4) and Index Tip (8)
  landmarks[4] = {
    x: thumbTip.x * scaleFactor,
    y: thumbTip.y * scaleFactor,
    z: (thumbTip.z ?? 0) * scaleFactor,
  };
  landmarks[8] = {
    x: indexTip.x * scaleFactor,
    y: indexTip.y * scaleFactor,
    z: (indexTip.z ?? 0) * scaleFactor,
  };

  return landmarks;
}

describe('GesturePinchZoomEngine (Task 4.2 Math & Interaction)', () => {
  it('exposes centrally configured default pinch zoom parameters', () => {
    assert.equal(DEFAULT_GESTURE_PINCH_ZOOM_CONFIG.spreadIsZoomIn, false);
    assert.equal(DEFAULT_GESTURE_PINCH_ZOOM_CONFIG.invertZoom, false);
    assert.ok(DEFAULT_GESTURE_PINCH_ZOOM_CONFIG.deadband > 0);
    assert.ok(DEFAULT_GESTURE_PINCH_ZOOM_CONFIG.zoomSensitivity > 0);
    assert.ok(DEFAULT_GESTURE_PINCH_ZOOM_CONFIG.maxJumpThreshold > 0);
    assert.ok(DEFAULT_GESTURE_PINCH_ZOOM_CONFIG.smoothingAlpha > 0);
    assert.ok(DEFAULT_GESTURE_PINCH_ZOOM_CONFIG.maxPinchSessionDistance > 0);
  });

  it('correctly calculates pinch distance normalized against hand scale', () => {
    const engine = new GesturePinchZoomEngine();

    // Scale 1.0 hand with thumb at (0.44, 0.40) and index at (0.48, 0.40)
    // Distance = 0.04
    const hand1 = createHandWithPinch({ x: 0.44, y: 0.4 }, { x: 0.48, y: 0.4 }, 1.0);
    const result1 = engine.computePinchDistance(hand1);
    assert.ok(result1 !== null);
    assert.ok(result1.pinchDistanceNorm > 0);

    // Scale 2.0 hand (closer to webcam) with 2x raw coordinate spacing
    // Normalized distance must remain identical (scale-invariant)
    const hand2 = createHandWithPinch({ x: 0.44, y: 0.4 }, { x: 0.48, y: 0.4 }, 2.0);
    const result2 = engine.computePinchDistance(hand2);
    assert.ok(result2 !== null);

    assert.ok(
      Math.abs(result1.pinchDistanceNorm - result2.pinchDistanceNorm) < 1e-4,
      `Expected scale-invariance: scale 1 (${result1.pinchDistanceNorm}) vs scale 2 (${result2.pinchDistanceNorm})`
    );
  });

  it('safely handles null, empty, or incomplete landmarks in computePinchDistance', () => {
    const engine = new GesturePinchZoomEngine();
    assert.equal(engine.computePinchDistance(null), null);
    assert.equal(engine.computePinchDistance(undefined), null);
    assert.equal(engine.computePinchDistance([]), null);
    assert.equal(engine.computePinchDistance(Array(15).fill({ x: 0, y: 0 })), null);
  });

  it('safely handles non-finite landmark coordinates', () => {
    const engine = new GesturePinchZoomEngine();
    const hand = createHandWithPinch({ x: Number.NaN, y: 0.4 }, { x: 0.48, y: 0.4 });
    assert.equal(engine.computePinchDistance(hand), null);
  });

  it('initiates pinch session upon stable PINCH gesture and anchors without camera jump', () => {
    const engine = new GesturePinchZoomEngine();
    const hand = createHandWithPinch({ x: 0.44, y: 0.4 }, { x: 0.48, y: 0.4 });

    // Frame 1: Stable PINCH confirmed
    const delta = engine.update(true, hand, false, false);
    assert.equal(delta.isActive, true);
    assert.equal(delta.deltaZoom, 0); // Must anchor first, no camera snap
    assert.equal(engine.isSessionActive(), true);
  });

  it('zooms in when fingers move closer together (spreadIsZoomIn: false default)', () => {
    const engine = new GesturePinchZoomEngine({ smoothingAlpha: 1.0 }); // instant alpha for testing raw mapping

    // Frame 1: Initial pinch distance ~0.04 raw (norm ~0.18)
    const hand1 = createHandWithPinch({ x: 0.44, y: 0.4 }, { x: 0.48, y: 0.4 });
    engine.update(true, hand1, false, false);

    // Frame 2: Fingers move closer together: thumb moves from 0.44 to 0.46 (distance decreases by 0.02)
    const hand2 = createHandWithPinch({ x: 0.46, y: 0.4 }, { x: 0.48, y: 0.4 });
    const delta = engine.update(true, hand2, false, false);

    assert.equal(delta.isActive, true);
    assert.ok(delta.deltaZoom > 0, `Expected zoom-in (deltaZoom > 0), got ${delta.deltaZoom}`);
    assert.ok(delta.rawDeltaDistance < 0, `Expected rawDeltaDistance < 0, got ${delta.rawDeltaDistance}`);
  });

  it('zooms out when fingers move farther apart (spreadIsZoomIn: false default)', () => {
    const engine = new GesturePinchZoomEngine({ smoothingAlpha: 1.0 });

    // Frame 1: Initial pinch distance
    const hand1 = createHandWithPinch({ x: 0.46, y: 0.4 }, { x: 0.48, y: 0.4 });
    engine.update(true, hand1, false, false);

    // Frame 2: Fingers move farther apart: thumb moves from 0.46 to 0.42 (distance increases)
    const hand2 = createHandWithPinch({ x: 0.42, y: 0.4 }, { x: 0.48, y: 0.4 });
    const delta = engine.update(true, hand2, false, false);

    assert.equal(delta.isActive, true);
    assert.ok(delta.deltaZoom < 0, `Expected zoom-out (deltaZoom < 0), got ${delta.deltaZoom}`);
    assert.ok(delta.rawDeltaDistance > 0, `Expected rawDeltaDistance > 0, got ${delta.rawDeltaDistance}`);
  });

  it('reverses zoom direction when spreadIsZoomIn is configured to true', () => {
    const engine = new GesturePinchZoomEngine({
      spreadIsZoomIn: true,
      smoothingAlpha: 1.0,
    });

    const hand1 = createHandWithPinch({ x: 0.46, y: 0.4 }, { x: 0.48, y: 0.4 });
    engine.update(true, hand1, false, false);

    // Moving fingers farther apart should now zoom IN
    const hand2 = createHandWithPinch({ x: 0.42, y: 0.4 }, { x: 0.48, y: 0.4 });
    const delta = engine.update(true, hand2, false, false);

    assert.ok(delta.deltaZoom > 0, `Expected zoom-in with spreadIsZoomIn: true, got ${delta.deltaZoom}`);
  });

  it('filters micro-tremors below deadband threshold', () => {
    const engine = new GesturePinchZoomEngine({ deadband: 0.015, smoothingAlpha: 1.0 });

    const hand1 = createHandWithPinch({ x: 0.46, y: 0.4 }, { x: 0.48, y: 0.4 });
    engine.update(true, hand1, false, false);

    // Very slight micro-tremor shift (0.0005) well below deadband
    const hand2 = createHandWithPinch({ x: 0.4605, y: 0.4 }, { x: 0.48, y: 0.4 });
    const delta = engine.update(true, hand2, false, false);

    assert.equal(delta.deltaZoom, 0, 'Micro-tremor below deadband must produce zero delta');
  });

  it('rejects sudden single-frame tracking jumps and re-anchors safely', () => {
    const engine = new GesturePinchZoomEngine({ maxJumpThreshold: 0.35, smoothingAlpha: 1.0 });

    const hand1 = createHandWithPinch({ x: 0.46, y: 0.4 }, { x: 0.48, y: 0.4 });
    engine.update(true, hand1, false, false);

    // Huge sudden tracking jump across frames (thumb teleports by 0.20 screen width -> ~0.90 normalized)
    const handJump = createHandWithPinch({ x: 0.25, y: 0.4 }, { x: 0.48, y: 0.4 });
    const delta = engine.update(true, handJump, false, false);

    assert.equal(delta.deltaZoom, 0, 'Single-frame jump exceeding threshold must be rejected with 0 delta');
  });

  it('safely handles tracking loss and hand re-entry', () => {
    const engine = new GesturePinchZoomEngine({ smoothingAlpha: 1.0 });

    const hand1 = createHandWithPinch({ x: 0.46, y: 0.4 }, { x: 0.48, y: 0.4 });
    engine.update(true, hand1, false, false);

    // Tracking lost: landmarks become null
    const deltaLost = engine.update(true, null, false, false);
    assert.equal(deltaLost.isActive, false);
    assert.equal(deltaLost.deltaZoom, 0);
    assert.equal(engine.isSessionActive(), false);

    // Hand re-enters: re-establishes anchor without camera jump
    const handReentry = createHandWithPinch({ x: 0.43, y: 0.4 }, { x: 0.48, y: 0.4 });
    const deltaReentry = engine.update(true, handReentry, false, false);
    assert.equal(deltaReentry.isActive, true);
    assert.equal(deltaReentry.deltaZoom, 0); // Fresh anchor, zero motion
  });

  it('yields immediately when conflicting gestures (OPEN_PALM or POINTING) are active', () => {
    const engine = new GesturePinchZoomEngine();
    const hand = createHandWithPinch({ x: 0.46, y: 0.4 }, { x: 0.48, y: 0.4 });
    engine.update(true, hand, false, false);

    // Conflicting gesture becomes active (e.g. user opens palm or points)
    const deltaConflict = engine.update(true, hand, false, true);
    assert.equal(deltaConflict.isActive, false);
    assert.equal(deltaConflict.deltaZoom, 0);
    assert.equal(engine.isSessionActive(), false);
  });

  it('yields immediately when user mouse or touch interaction is active', () => {
    const engine = new GesturePinchZoomEngine();
    const hand = createHandWithPinch({ x: 0.46, y: 0.4 }, { x: 0.48, y: 0.4 });
    engine.update(true, hand, false, false);

    // Mouse is active
    const deltaMouse = engine.update(true, hand, true, false);
    assert.equal(deltaMouse.isActive, false);
    assert.equal(deltaMouse.deltaZoom, 0);
    assert.equal(engine.isSessionActive(), false);
  });

  it('terminates pinch session when fingers spread beyond maxPinchSessionDistance', () => {
    const engine = new GesturePinchZoomEngine({ maxPinchSessionDistance: 0.65 });
    const hand1 = createHandWithPinch({ x: 0.46, y: 0.4 }, { x: 0.48, y: 0.4 });
    engine.update(true, hand1, false, false);

    // Fingers spread extremely far apart
    const handWide = createHandWithPinch({ x: 0.1, y: 0.4 }, { x: 0.6, y: 0.4 });
    const delta = engine.update(false, handWide, false, false);
    assert.equal(delta.isActive, false);
    assert.equal(engine.isSessionActive(), false);
  });
});

function createMockDom(): HTMLElement {
  const doc = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
    ownerDocument: doc,
    getRootNode: () => doc,
    style: {},
  } as unknown as HTMLElement;
}

describe('CameraController Clamping (Min & Max Distance)', () => {
  it('clamps camera zoom distance to safe minimum limit', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    const mockDom = createMockDom();

    const controller = new CameraController(camera, mockDom, {
      minDistance: 2.0,
      maxDistance: 25.0,
      enableDamping: false,
    });

    // Initial distance is 10
    assert.equal(controller.getMinDistance(), 2.0);
    assert.equal(controller.getMaxDistance(), 25.0);

    // Huge zoom-in delta (e.g. 50 units)
    const newDist = controller.zoomBy(50);
    assert.ok(Math.abs(newDist - 2.0) < 1e-4, `Expected clamped to minDistance 2.0, got ${newDist}`);
    assert.ok(Math.abs(controller.getDistance() - 2.0) < 1e-4);

    controller.dispose();
  });

  it('clamps camera zoom distance to safe maximum limit', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    const mockDom = createMockDom();

    const controller = new CameraController(camera, mockDom, {
      minDistance: 2.0,
      maxDistance: 25.0,
      enableDamping: false,
    });

    // Huge zoom-out delta (e.g. -50 units)
    const newDist = controller.zoomBy(-50);
    assert.ok(Math.abs(newDist - 25.0) < 1e-4, `Expected clamped to maxDistance 25.0, got ${newDist}`);
    assert.ok(Math.abs(controller.getDistance() - 25.0) < 1e-4);

    controller.dispose();
  });
});
