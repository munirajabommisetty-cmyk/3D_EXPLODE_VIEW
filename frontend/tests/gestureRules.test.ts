/**
 * Automated Unit Tests for Geometric Gesture Recognition & Temporal Stabilizer
 * Executed via Node.js native test runner (node:test + node:assert).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NormalizedLandmark } from '../src/types/landmarks.ts';
import {
  calculateHandScale,
  classifyInstantaneousGesture,
} from '../src/services/gestures/gestureRules.ts';
import { GestureTemporalStabilizer } from '../src/services/gestures/gestureClassifier.ts';

// Helper to create empty 21-landmark array
function createEmptyLandmarks(): NormalizedLandmark[] {
  return Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
}

// 1. Fixture: OPEN_PALM (all digits extended and separated)
function createOpenPalmFixture(): NormalizedLandmark[] {
  const lm = createEmptyLandmarks();
  // Wrist
  lm[0] = { x: 0.5, y: 0.8, z: 0 };

  // Thumb
  lm[1] = { x: 0.45, y: 0.75, z: 0 };
  lm[2] = { x: 0.40, y: 0.70, z: 0 };
  lm[3] = { x: 0.35, y: 0.65, z: 0 };
  lm[4] = { x: 0.30, y: 0.60, z: 0 }; // Thumb Tip

  // Index
  lm[5] = { x: 0.45, y: 0.60, z: 0 }; // MCP
  lm[6] = { x: 0.45, y: 0.46, z: 0 }; // PIP
  lm[7] = { x: 0.45, y: 0.36, z: 0 }; // DIP
  lm[8] = { x: 0.45, y: 0.25, z: 0 }; // TIP

  // Middle
  lm[9] = { x: 0.50, y: 0.58, z: 0 }; // MCP
  lm[10] = { x: 0.50, y: 0.42, z: 0 }; // PIP
  lm[11] = { x: 0.50, y: 0.30, z: 0 }; // DIP
  lm[12] = { x: 0.50, y: 0.18, z: 0 }; // TIP

  // Ring
  lm[13] = { x: 0.55, y: 0.60, z: 0 }; // MCP
  lm[14] = { x: 0.55, y: 0.46, z: 0 }; // PIP
  lm[15] = { x: 0.55, y: 0.36, z: 0 }; // DIP
  lm[16] = { x: 0.55, y: 0.25, z: 0 }; // TIP

  // Pinky
  lm[17] = { x: 0.60, y: 0.63, z: 0 }; // MCP
  lm[18] = { x: 0.60, y: 0.52, z: 0 }; // PIP
  lm[19] = { x: 0.60, y: 0.44, z: 0 }; // DIP
  lm[20] = { x: 0.60, y: 0.35, z: 0 }; // TIP

  return lm;
}

// 2. Fixture: POINTING (Index extended, others curled)
function createPointingFixture(): NormalizedLandmark[] {
  const lm = createOpenPalmFixture();

  // Curl middle, ring, pinky so tips are tucked close to MCP
  // Middle
  lm[10] = { x: 0.50, y: 0.50, z: 0 };
  lm[11] = { x: 0.50, y: 0.55, z: 0.05 };
  lm[12] = { x: 0.50, y: 0.60, z: 0.05 }; // Tucked

  // Ring
  lm[14] = { x: 0.55, y: 0.52, z: 0 };
  lm[15] = { x: 0.55, y: 0.57, z: 0.05 };
  lm[16] = { x: 0.55, y: 0.62, z: 0.05 }; // Tucked

  // Pinky
  lm[18] = { x: 0.60, y: 0.56, z: 0 };
  lm[19] = { x: 0.60, y: 0.61, z: 0.05 };
  lm[20] = { x: 0.60, y: 0.65, z: 0.05 }; // Tucked

  // Thumb folded across
  lm[3] = { x: 0.42, y: 0.68, z: 0.02 };
  lm[4] = { x: 0.44, y: 0.66, z: 0.02 };

  return lm;
}

// 3. Fixture: PINCH (Thumb Tip & Index Tip touching)
function createPinchFixture(): NormalizedLandmark[] {
  const lm = createOpenPalmFixture();

  // Bring thumb tip (4) and index tip (8) close together
  lm[4] = { x: 0.44, y: 0.38, z: 0 };
  lm[8] = { x: 0.45, y: 0.38, z: 0 };

  return lm;
}

// 4. Fixture: FIST (None of the supported gestures)
function createFistFixture(): NormalizedLandmark[] {
  const lm = createPointingFixture();
  // Curl index as well
  lm[6] = { x: 0.45, y: 0.52, z: 0 };
  lm[7] = { x: 0.45, y: 0.57, z: 0.05 };
  lm[8] = { x: 0.45, y: 0.62, z: 0.05 };

  // Thumb rests across folded fingers (not touching index tip)
  lm[3] = { x: 0.48, y: 0.56, z: -0.02 };
  lm[4] = { x: 0.52, y: 0.54, z: -0.03 };
  return lm;
}

describe('Geometric Gesture Recognition Rules', () => {
  it('correctly calculates hand scale from rigid palm landmarks', () => {
    const landmarks = createOpenPalmFixture();
    const scale = calculateHandScale(landmarks);
    assert.ok(scale > 0.15 && scale < 0.4, `Expected scale around 0.22, got ${scale}`);
  });

  it('recognizes OPEN_PALM with high confidence when all fingers are extended', () => {
    const landmarks = createOpenPalmFixture();
    const result = classifyInstantaneousGesture(landmarks);
    assert.strictEqual(result.gesture, 'OPEN_PALM');
    assert.ok(result.confidence >= 0.70, `Expected confidence >= 0.70, got ${result.confidence}`);
  });

  it('recognizes POINTING when index is extended and other fingers are curled', () => {
    const landmarks = createPointingFixture();
    const result = classifyInstantaneousGesture(landmarks);
    assert.strictEqual(result.gesture, 'POINTING');
    assert.ok(result.confidence >= 0.70, `Expected confidence >= 0.70, got ${result.confidence}`);
  });

  it('recognizes PINCH when thumb tip and index tip are in close contact', () => {
    const landmarks = createPinchFixture();
    const result = classifyInstantaneousGesture(landmarks);
    assert.strictEqual(result.gesture, 'PINCH');
    assert.ok(result.confidence >= 0.70, `Expected confidence >= 0.70, got ${result.confidence}`);
  });

  it('returns NONE for a fist where no gesture is active', () => {
    const landmarks = createFistFixture();
    const result = classifyInstantaneousGesture(landmarks);
    assert.strictEqual(result.gesture, 'NONE');
  });

  it('safely handles null, undefined, empty, and partial landmark arrays', () => {
    const nullRes = classifyInstantaneousGesture(null as unknown as NormalizedLandmark[]);
    assert.strictEqual(nullRes.gesture, 'NONE');

    const emptyRes = classifyInstantaneousGesture([]);
    assert.strictEqual(emptyRes.gesture, 'NONE');

    const partialRes = classifyInstantaneousGesture(createOpenPalmFixture().slice(0, 10));
    assert.strictEqual(partialRes.gesture, 'NONE');
  });

  it('safely handles NaN and non-finite coordinates', () => {
    const landmarks = createOpenPalmFixture();
    landmarks[4] = { x: NaN, y: 0.5, z: 0 };
    const result = classifyInstantaneousGesture(landmarks);
    assert.strictEqual(result.gesture, 'NONE');
  });

  it('verifies scale normalization invariance when landmarks are scaled by 2x', () => {
    const original = createPinchFixture();
    // Scale all coordinates away from center (simulating hand moved 2x closer)
    const scaled = original.map((lm) => ({
      x: (lm.x - 0.5) * 2 + 0.5,
      y: (lm.y - 0.5) * 2 + 0.5,
      z: lm.z * 2,
    }));

    const resultOriginal = classifyInstantaneousGesture(original);
    const resultScaled = classifyInstantaneousGesture(scaled);

    assert.strictEqual(resultOriginal.gesture, 'PINCH');
    assert.strictEqual(resultScaled.gesture, 'PINCH');
  });
});

describe('GestureTemporalStabilizer (Hysteresis & Transitions)', () => {
  it('requires consecutive frames before transitioning away from NONE', () => {
    const stabilizer = new GestureTemporalStabilizer({ stabilityFramesRequired: 3 });
    const pointing = createPointingFixture();

    // Frame 1: Candidate detected, but confirmed gesture remains NONE
    const f1 = stabilizer.update(pointing);
    assert.strictEqual(f1.rawGesture, 'POINTING');
    assert.strictEqual(f1.gesture, 'NONE');
    assert.strictEqual(f1.isStable, false);

    // Frame 2: Still settling
    const f2 = stabilizer.update(pointing);
    assert.strictEqual(f2.rawGesture, 'POINTING');
    assert.strictEqual(f2.gesture, 'NONE');

    // Frame 3: Stability threshold reached -> Confirmed state flips to POINTING
    const f3 = stabilizer.update(pointing);
    assert.strictEqual(f3.gesture, 'POINTING');
    assert.strictEqual(f3.isStable, true);
    assert.strictEqual(f3.consecutiveFrames, 3);
  });

  it('filters out single-frame noisy glitches during sustained gesture', () => {
    const stabilizer = new GestureTemporalStabilizer({ stabilityFramesRequired: 3 });
    const palm = createOpenPalmFixture();
    const fist = createFistFixture();

    // Establish stable OPEN_PALM
    stabilizer.update(palm);
    stabilizer.update(palm);
    const stable = stabilizer.update(palm);
    assert.strictEqual(stable.gesture, 'OPEN_PALM');

    // Introduce 1 frame of transient noise/glitch (Fist)
    const noisyFrame = stabilizer.update(fist);
    // The raw gesture saw NONE, but confirmed gesture remains OPEN_PALM due to hysteresis!
    assert.strictEqual(noisyFrame.rawGesture, 'NONE');
    assert.strictEqual(noisyFrame.gesture, 'OPEN_PALM');

    // Next frame hand returns to OPEN_PALM
    const recovered = stabilizer.update(palm);
    assert.strictEqual(recovered.gesture, 'OPEN_PALM');
  });

  it('resets cleanly when tracking is lost', () => {
    const stabilizer = new GestureTemporalStabilizer({ stabilityFramesRequired: 3 });
    const pinch = createPinchFixture();

    stabilizer.update(pinch);
    stabilizer.update(pinch);
    stabilizer.update(pinch);

    const lost = stabilizer.update(null);
    assert.strictEqual(lost.gesture, 'NONE');
    assert.strictEqual(lost.consecutiveFrames, 0);
  });
});

describe('Phase 2 & 3 Bug Fix Verification (Robust Gesture Recognition & Precision Pinch)', () => {
  // 1. Precision pinch with curled fingers (previously falsely rejected as a fist)
  it('correctly recognizes precision PINCH when middle, ring, and pinky are curled into palm', () => {
    const lm = createPointingFixture(); // Middle, ring, pinky are curled into palm
    // Bring thumb tip (4) and index tip (8) close together
    lm[4] = { x: 0.44, y: 0.40, z: 0 };
    lm[8] = { x: 0.45, y: 0.40, z: 0 };

    const res = classifyInstantaneousGesture(lm);
    assert.strictEqual(res.gesture, 'PINCH', `Expected PINCH for curled-finger precision pinch, got ${res.gesture}`);
    assert.ok(res.confidence >= 0.70);
  });

  // 2. Natural open palm with relaxed finger spacing (previously failed rigid span >= 0.12)
  it('recognizes natural OPEN_PALM when fingers are extended without exaggerated splay', () => {
    const lm = createOpenPalmFixture();
    // Move middle and ring closer together (span = 0.03, below previous 0.12 threshold)
    lm[9] = { x: 0.49, y: 0.58, z: 0 };
    lm[10] = { x: 0.49, y: 0.42, z: 0 };
    lm[11] = { x: 0.49, y: 0.30, z: 0 };
    lm[12] = { x: 0.49, y: 0.18, z: 0 };

    lm[13] = { x: 0.52, y: 0.60, z: 0 };
    lm[14] = { x: 0.52, y: 0.46, z: 0 };
    lm[15] = { x: 0.52, y: 0.36, z: 0 };
    lm[16] = { x: 0.52, y: 0.25, z: 0 };

    const res = classifyInstantaneousGesture(lm);
    assert.strictEqual(res.gesture, 'OPEN_PALM', `Expected natural un-splayed hand to be OPEN_PALM, got ${res.gesture}`);
    assert.ok(res.confidence >= 0.70);
  });

  // 3. Ambiguous pose: "Peace sign" / V-sign (Index + Middle extended, others curled)
  it('rejects ambiguous two-finger "peace sign" and returns NONE', () => {
    const lm = createPointingFixture(); // Index extended, middle/ring/pinky curled
    // Extend middle finger as well
    lm[10] = { x: 0.50, y: 0.42, z: 0 };
    lm[11] = { x: 0.50, y: 0.30, z: 0 };
    lm[12] = { x: 0.50, y: 0.18, z: 0 }; // Extended

    const res = classifyInstantaneousGesture(lm);
    assert.strictEqual(res.gesture, 'NONE', `Expected peace sign to return NONE, got ${res.gesture}`);
    assert.ok(res.rejectionReason, 'Should include diagnostic rejection reason');
  });

  // 4. Ambiguous pose: Three fingers extended (Index + Middle + Ring extended, Pinky curled)
  it('rejects ambiguous three-finger pose and returns NONE', () => {
    const lm = createOpenPalmFixture();
    // Curl pinky only
    lm[18] = { x: 0.60, y: 0.56, z: 0 };
    lm[19] = { x: 0.60, y: 0.61, z: 0.05 };
    lm[20] = { x: 0.60, y: 0.65, z: 0.05 }; // Tucked

    const res = classifyInstantaneousGesture(lm);
    assert.strictEqual(res.gesture, 'NONE', `Expected 3-finger pose to return NONE, got ${res.gesture}`);
  });

  // 5. Hysteresis during pinch: fingers moving apart during active pinch session
  it('maintains PINCH candidate under hysteresis when fingers expand up to release distance', () => {
    const lm = createOpenPalmFixture();
    // Moderate separation between thumb tip and index tip (norm distance ~0.48)
    lm[4] = { x: 0.38, y: 0.40, z: 0 };
    lm[8] = { x: 0.48, y: 0.40, z: 0 };

    // From cold start (previousGesture = NONE), distance 0.10 / scale 0.22 ~ 0.45 exceeds 0.38 max
    const coldRes = classifyInstantaneousGesture(lm, undefined, 'NONE');
    assert.notStrictEqual(coldRes.gesture, 'PINCH', 'Cold pinch at 0.45 norm dist should not trigger PINCH');

    // With previousGesture = 'PINCH', hysteresis allows separation up to 0.60
    const activeRes = classifyInstantaneousGesture(lm, undefined, 'PINCH');
    assert.strictEqual(activeRes.gesture, 'PINCH', 'Active pinch should maintain PINCH under hysteresis');
  });
});

describe('Task 6.3: Lighting & Occlusion Edge-Case Hardening', () => {
  it('rejects gestures when tracking confidence falls below minTrackingConfidence threshold', () => {
    const palm = createOpenPalmFixture();
    // Valid open palm geometry, but degraded tracking score (e.g. 0.40 due to low lighting)
    const result = classifyInstantaneousGesture(palm, undefined, 'NONE', 0.40);
    assert.strictEqual(result.gesture, 'NONE');
    assert.strictEqual(result.confidence, 0.40);
    assert.ok(result.rejectionReason?.includes('Low tracking confidence'));
  });

  it('stabilizer filters transient low-confidence frames without losing active gesture state immediately', () => {
    const stabilizer = new GestureTemporalStabilizer({ stabilityFramesRequired: 3 });
    const palm = createOpenPalmFixture();

    // Establish stable OPEN_PALM
    stabilizer.update(palm, 'Right', 0.95);
    stabilizer.update(palm, 'Right', 0.95);
    const stable = stabilizer.update(palm, 'Right', 0.95);
    assert.strictEqual(stable.gesture, 'OPEN_PALM');

    // 1 frame of low-confidence tracking (dim lighting flicker or motion blur)
    const lowConfFrame = stabilizer.update(palm, 'Right', 0.35);
    assert.strictEqual(lowConfFrame.rawGesture, 'NONE');
    // Stable gesture maintained due to debouncing
    assert.strictEqual(lowConfFrame.gesture, 'OPEN_PALM');

    // Tracking recovers
    const recovered = stabilizer.update(palm, 'Right', 0.95);
    assert.strictEqual(recovered.gesture, 'OPEN_PALM');
  });

  it('rejects POINTING when index finger landmarks are occluded or collapsed', () => {
    const pointing = createPointingFixture();
    // Collapse index MCP, PIP, and TIP onto the same coordinate (simulating occluded finger)
    pointing[5] = { x: 0.45, y: 0.60, z: 0 };
    pointing[6] = { x: 0.45, y: 0.60, z: 0 };
    pointing[7] = { x: 0.45, y: 0.60, z: 0 };
    pointing[8] = { x: 0.45, y: 0.60, z: 0 };

    const result = classifyInstantaneousGesture(pointing);
    assert.strictEqual(result.gesture, 'NONE');
    assert.ok(result.rejectionReason?.includes('occluded or collapsed'));
  });

  it('rejects PINCH when thumb contact landmark is collapsed or occluded', () => {
    const pinch = createPinchFixture();
    // Collapse thumb base and tip onto each other
    pinch[1] = { x: 0.45, y: 0.75, z: 0 };
    pinch[2] = { x: 0.45, y: 0.75, z: 0 };
    pinch[3] = { x: 0.45, y: 0.75, z: 0 };
    pinch[4] = { x: 0.45, y: 0.75, z: 0 };

    const result = classifyInstantaneousGesture(pinch);
    assert.strictEqual(result.gesture, 'NONE');
  });

  it('safely handles non-finite z-coordinates and degenerate palm scale', () => {
    const palm = createOpenPalmFixture();
    // z is NaN
    palm[4] = { x: 0.30, y: 0.60, z: NaN };
    const nanRes = classifyInstantaneousGesture(palm);
    assert.strictEqual(nanRes.gesture, 'NONE');
    assert.ok(nanRes.rejectionReason?.includes('Non-finite / NaN'));

    // Degenerate palm (all landmarks at the exact same location)
    const collapsed = createEmptyLandmarks().map(() => ({ x: 0.5, y: 0.5, z: 0 }));
    const degenerateRes = classifyInstantaneousGesture(collapsed);
    assert.strictEqual(degenerateRes.gesture, 'NONE');
    assert.ok(degenerateRes.rejectionReason?.includes('Degenerate palm'));
  });
});


