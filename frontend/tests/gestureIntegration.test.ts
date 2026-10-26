/**
 * Multi-Frame Synthetic Gesture & Camera Rig Integration Tests (Task 6.1)
 *
 * Validates the integrated operation of:
 * 1. GestureCameraController coordinating GestureOrbitEngine and GesturePinchZoomEngine.
 * 2. Three.js PerspectiveCamera and CameraController (OrbitControls).
 * 3. Multi-frame synthetic landmark sequences driving orbit and zoom.
 * 4. Gesture transition exclusivity (OPEN_PALM -> PINCH -> POINTING -> NONE).
 * 5. Tracking loss and re-entry without snapping.
 * 6. Camera clamp boundaries [minDistance, maxDistance] under extreme zoom deltas.
 * 7. Mouse contention priority over gesture commands.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraController } from '../src/components/scene/CameraController';
import { GestureCameraController } from '../src/components/scene/GestureCameraController';
import type { NormalizedLandmark, HandLandmarkResult } from '../src/types/landmarks';
import type { GestureRecognitionResult } from '../src/types/gestures';

/**
 * Creates a complete mock DOM element suitable for Three.js OrbitControls in Node.js.
 */
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

/**
 * Generates synthetic 21-point hand landmark array with customizable palm centroid
 * and thumb/index tip coordinates.
 */
function createSyntheticHand(
  palmCenter: { x: number; y: number } = { x: 0.5, y: 0.5 },
  pinchOffset?: { thumb: { x: number; y: number }; index: { x: number; y: number } }
): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = Array.from({ length: 21 }, () => ({
    x: palmCenter.x,
    y: palmCenter.y,
    z: 0,
  }));

  // Rigid palm landmarks (Wrist 0, Index MCP 5, Middle MCP 9, Ring MCP 13, Pinky MCP 17)
  landmarks[0] = { x: palmCenter.x, y: palmCenter.y + 0.12, z: 0 };
  landmarks[5] = { x: palmCenter.x - 0.05, y: palmCenter.y - 0.04, z: 0 };
  landmarks[9] = { x: palmCenter.x, y: palmCenter.y - 0.08, z: 0 };
  landmarks[13] = { x: palmCenter.x + 0.04, y: palmCenter.y - 0.05, z: 0 };
  landmarks[17] = { x: palmCenter.x + 0.08, y: palmCenter.y, z: 0 };

  // Thumb Tip (4) and Index Tip (8)
  if (pinchOffset) {
    landmarks[4] = { x: pinchOffset.thumb.x, y: pinchOffset.thumb.y, z: 0 };
    landmarks[8] = { x: pinchOffset.index.x, y: pinchOffset.index.y, z: 0 };
  } else {
    landmarks[4] = { x: palmCenter.x - 0.1, y: palmCenter.y - 0.05, z: 0 };
    landmarks[8] = { x: palmCenter.x - 0.05, y: palmCenter.y - 0.18, z: 0 };
  }

  return landmarks;
}

function wrapHandsResult(landmarks: NormalizedLandmark[]): HandLandmarkResult[] {
  return [
    {
      landmarks,
      rawLandmarks: landmarks.map((p) => ({ ...p })),
      handedness: 'Right',
      score: 0.95,
    },
  ];
}

describe('Synthetic Multi-Frame Gesture Stream Integration', () => {
  it('drives orbital rotation across sequential OPEN_PALM frames without snapping', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    const mockDom = createMockDom();
    const cameraController = new CameraController(camera, mockDom, { enableDamping: false });
    const gestureController = new GestureCameraController(cameraController);

    const initialPos = camera.position.clone();

    // Frame 0: First OPEN_PALM frame registers reference anchor (zero rotation)
    const hand0 = wrapHandsResult(createSyntheticHand({ x: 0.5, y: 0.5 }));
    const gestureResult: GestureRecognitionResult = {
      gesture: 'OPEN_PALM',
      confidence: 0.95,
      isStable: true,
      handedness: 'Right',
    };

    const res0 = gestureController.update(gestureResult, hand0);
    assert.equal(res0.orbit.isActive, true);
    assert.equal(res0.orbit.deltaYaw, 0);
    assert.equal(res0.orbit.deltaPitch, 0);

    // Frame 1 to 4: Hand moves progressively to the right (x: 0.5 -> 0.55 -> 0.60)
    for (let i = 1; i <= 3; i++) {
      const hand = wrapHandsResult(createSyntheticHand({ x: 0.5 + i * 0.03, y: 0.5 }));
      const res = gestureController.update(gestureResult, hand);
      assert.equal(res.orbit.isActive, true);
      assert.notEqual(res.orbit.deltaYaw, 0);
    }

    // Camera position should have orbited away from the initial position
    assert.ok(camera.position.distanceTo(initialPos) > 0.05);

    cameraController.dispose();
  });

  it('drives smooth camera zoom across sequential PINCH frames', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    const mockDom = createMockDom();
    const cameraController = new CameraController(camera, mockDom, {
      minDistance: 2.0,
      maxDistance: 25.0,
      enableDamping: false,
    });
    const gestureController = new GestureCameraController(cameraController);

    const initialDist = cameraController.getDistance();
    assert.ok(initialDist > 0);

    const pinchGesture: GestureRecognitionResult = {
      gesture: 'PINCH',
      confidence: 0.92,
      isStable: true,
      handedness: 'Right',
    };

    // Frame 0: Initialize pinch session
    const hand0 = wrapHandsResult(
      createSyntheticHand(
        { x: 0.5, y: 0.5 },
        { thumb: { x: 0.46, y: 0.4 }, index: { x: 0.48, y: 0.4 } }
      )
    );
    const res0 = gestureController.update(pinchGesture, hand0);
    assert.equal(res0.pinch.isActive, true);
    assert.equal(res0.pinch.deltaZoom, 0);

    // Frames 1..3: Fingers move closer together (closing pinch zooms in: distance decreases)
    for (let i = 1; i <= 3; i++) {
      const hand = wrapHandsResult(
        createSyntheticHand(
          { x: 0.5, y: 0.5 },
          { thumb: { x: 0.46 + i * 0.005, y: 0.4 }, index: { x: 0.48, y: 0.4 } }
        )
      );
      const res = gestureController.update(pinchGesture, hand);
      assert.equal(res.pinch.isActive, true);
      assert.ok(res.pinch.deltaZoom > 0, 'Closing fingers must zoom in');
    }

    // Camera distance should now be closer to target (< 10)
    const currentDist = cameraController.getDistance();
    assert.ok(currentDist < initialDist, `Expected distance < 10, got ${currentDist}`);

    cameraController.dispose();
  });

  it('switches between OPEN_PALM, PINCH, and POINTING without simultaneous conflicting actions', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    const mockDom = createMockDom();
    const cameraController = new CameraController(camera, mockDom, { enableDamping: false });
    const gestureController = new GestureCameraController(cameraController);

    const hand = wrapHandsResult(
      createSyntheticHand(
        { x: 0.5, y: 0.5 },
        { thumb: { x: 0.45, y: 0.4 }, index: { x: 0.48, y: 0.4 } }
      )
    );

    // 1. In OPEN_PALM mode: orbit active, pinch inactive
    const palmGesture: GestureRecognitionResult = {
      gesture: 'OPEN_PALM',
      confidence: 0.9,
      isStable: true,
      handedness: 'Right',
    };
    const palmRes = gestureController.update(palmGesture, hand);
    assert.equal(palmRes.orbit.isActive, true);
    assert.equal(palmRes.pinch.isActive, false);

    // 2. In PINCH mode: pinch active, orbit inactive
    const pinchGesture: GestureRecognitionResult = {
      gesture: 'PINCH',
      confidence: 0.9,
      isStable: true,
      handedness: 'Right',
    };
    const pinchRes = gestureController.update(pinchGesture, hand);
    assert.equal(pinchRes.orbit.isActive, false);
    assert.equal(pinchRes.pinch.isActive, true);

    // 3. In POINTING mode: both orbit and pinch camera actions remain inactive
    const pointingGesture: GestureRecognitionResult = {
      gesture: 'POINTING',
      confidence: 0.9,
      isStable: true,
      handedness: 'Right',
    };
    const pointRes = gestureController.update(pointingGesture, hand);
    assert.equal(pointRes.orbit.isActive, false);
    assert.equal(pointRes.pinch.isActive, false);

    cameraController.dispose();
  });

  it('safely handles tracking loss and hand re-entry without camera snapping', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    const mockDom = createMockDom();
    const cameraController = new CameraController(camera, mockDom, { enableDamping: false });
    const gestureController = new GestureCameraController(cameraController);

    const palmGesture: GestureRecognitionResult = {
      gesture: 'OPEN_PALM',
      confidence: 0.95,
      isStable: true,
      handedness: 'Right',
    };

    // Tracking active
    const handActive = wrapHandsResult(createSyntheticHand({ x: 0.5, y: 0.5 }));
    gestureController.update(palmGesture, handActive);

    // Tracking lost (empty hands array)
    const lostRes = gestureController.update(palmGesture, []);
    assert.equal(lostRes.orbit.isActive, false);
    assert.equal(lostRes.orbit.deltaYaw, 0);

    const posAtLoss = camera.position.clone();

    // Hand re-enters at a different screen position (e.g. x: 0.25)
    const handReentry = wrapHandsResult(createSyntheticHand({ x: 0.25, y: 0.3 }));
    const reentryRes = gestureController.update(palmGesture, handReentry);

    // Initial frame must anchor without applying false rotation
    assert.equal(reentryRes.orbit.isActive, true);
    assert.equal(reentryRes.orbit.deltaYaw, 0);
    assert.equal(reentryRes.orbit.deltaPitch, 0);
    assert.equal(camera.position.distanceTo(posAtLoss), 0);

    cameraController.dispose();
  });

  it('clamps zoom to configured minimum and maximum limits under sustained deltas', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    const mockDom = createMockDom();
    const cameraController = new CameraController(camera, mockDom, {
      minDistance: 2.0,
      maxDistance: 25.0,
      enableDamping: false,
    });

    // Zoom in beyond minDistance (50 units)
    cameraController.zoomBy(50);
    assert.equal(cameraController.getDistance(), 2.0);

    // Zoom out beyond maxDistance (-50 units)
    cameraController.zoomBy(-50);
    assert.equal(cameraController.getDistance(), 25.0);

    cameraController.dispose();
  });

  it('yields immediately when user mouse interaction is active on OrbitControls', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    const mockDom = createMockDom();
    const cameraController = new CameraController(camera, mockDom, { enableDamping: false });
    const gestureController = new GestureCameraController(cameraController);

    const hand = wrapHandsResult(createSyntheticHand({ x: 0.5, y: 0.5 }));
    const palmGesture: GestureRecognitionResult = {
      gesture: 'OPEN_PALM',
      confidence: 0.95,
      isStable: true,
      handedness: 'Right',
    };

    // Simulate active mouse drag
    (cameraController as unknown as { isInteracting: boolean }).isInteracting = true;

    const res = gestureController.update(palmGesture, hand);
    assert.equal(res.orbit.isActive, false);
    assert.equal(res.pinch.isActive, false);
    assert.equal(res.orbit.deltaYaw, 0);

    cameraController.dispose();
  });

  it('safely handles hand disappearance and re-entry during pinch-to-zoom without camera snapping', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    const mockDom = createMockDom();
    const cameraController = new CameraController(camera, mockDom, { enableDamping: false });
    const gestureController = new GestureCameraController(cameraController);

    const pinchGesture: GestureRecognitionResult = {
      gesture: 'PINCH',
      confidence: 0.95,
      isStable: true,
      handedness: 'Right',
    };

    // Frame 0: Engage pinch
    const initialHand = wrapHandsResult(
      createSyntheticHand(
        { x: 0.5, y: 0.5 },
        { thumb: { x: 0.45, y: 0.4 }, index: { x: 0.48, y: 0.4 } }
      )
    );
    gestureController.update(pinchGesture, initialHand);

    // Frame 1: Zoom in (move closer)
    const zoomHand = wrapHandsResult(
      createSyntheticHand(
        { x: 0.5, y: 0.5 },
        { thumb: { x: 0.465, y: 0.4 }, index: { x: 0.48, y: 0.4 } }
      )
    );
    const zoomRes = gestureController.update(pinchGesture, zoomHand);
    assert.equal(zoomRes.pinch.isActive, true);
    assert.ok(zoomRes.pinch.deltaZoom > 0);

    const distBeforeLoss = cameraController.getDistance();

    // Frame 2: Hand drops out of camera view (tracking lost)
    const lostRes = gestureController.update(pinchGesture, []);
    assert.equal(lostRes.pinch.isActive, false);
    assert.equal(lostRes.pinch.deltaZoom, 0);
    assert.equal(cameraController.getDistance(), distBeforeLoss);

    // Frame 3: Hand re-enters at a completely different pinch spacing
    const reentryHand = wrapHandsResult(
      createSyntheticHand(
        { x: 0.3, y: 0.3 },
        { thumb: { x: 0.25, y: 0.3 }, index: { x: 0.32, y: 0.3 } }
      )
    );
    const reentryRes = gestureController.update(pinchGesture, reentryHand);

    // Re-entry must establish a fresh anchor: zero delta zoom, camera distance unchanged
    assert.equal(reentryRes.pinch.isActive, true);
    assert.equal(reentryRes.pinch.deltaZoom, 0);
    assert.equal(cameraController.getDistance(), distBeforeLoss);

    cameraController.dispose();
  });

  it('safely handles degenerate or out-of-bounds landmarks without throwing or applying camera deltas', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    const mockDom = createMockDom();
    const cameraController = new CameraController(camera, mockDom, { enableDamping: false });
    const gestureController = new GestureCameraController(cameraController);

    const palmGesture: GestureRecognitionResult = {
      gesture: 'OPEN_PALM',
      confidence: 0.9,
      isStable: true,
      handedness: 'Right',
    };

    // Degenerate hand (all landmarks at 0,0,0)
    const degenerateHand = wrapHandsResult(
      Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))
    );
    const res = gestureController.update(palmGesture, degenerateHand);

    assert.equal(res.orbit.isActive, false);
    assert.equal(res.orbit.deltaYaw, 0);
    assert.equal(res.orbit.deltaPitch, 0);

    cameraController.dispose();
  });
});

