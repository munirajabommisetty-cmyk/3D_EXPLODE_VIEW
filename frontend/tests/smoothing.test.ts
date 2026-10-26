/**
 * Automated Unit Tests for One Euro Filter (Temporal Smoothing)
 * Validates noise attenuation, responsiveness, scale invariance, and multi-hand isolation.
 * Executed via Node.js native test runner (node:test + node:assert).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NormalizedLandmark, HandLandmarkResult } from '../src/types/landmarks.ts';
import {
  OneEuroFilter,
  Point3DOneEuroFilter,
  HandLandmarkOneEuroFilter,
  MultiHandOneEuroFilter,
} from '../src/services/tracking/smoothing.ts';

// Helper to calculate variance of an array of numbers
function calculateVariance(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
}

// Helper to create synthetic 21 landmarks
function createDummyLandmarks(baseX = 0.5, baseY = 0.5, baseZ = 0): NormalizedLandmark[] {
  return Array.from({ length: 21 }, (_, i) => ({
    x: baseX + i * 0.005,
    y: baseY + i * 0.005,
    z: baseZ,
  }));
}

describe('OneEuroFilter (1D Scalar)', () => {
  it('1. correctly initializes first sample without artificial jump', () => {
    const filter = new OneEuroFilter({ minCutoff: 1.0, beta: 1.0 });
    const initialValue = 0.456;
    const output = filter.filter(initialValue, 1000);
    assert.strictEqual(output, initialValue, 'First sample must equal input exactly');
  });

  it('2. keeps stationary coordinates completely stable without drift', () => {
    const filter = new OneEuroFilter({ minCutoff: 1.0, beta: 1.0 });
    filter.filter(0.5, 1000);

    for (let i = 1; i <= 30; i++) {
      const output = filter.filter(0.5, 1000 + i * 33);
      assert.strictEqual(output, 0.5, 'Stationary input should output exact constant value');
    }
  });

  it('3. significantly attenuates synthetic high-frequency coordinate noise', () => {
    const filter = new OneEuroFilter({ minCutoff: 1.0, beta: 0.1 }); // Lower beta for stationary smoothing test
    const center = 0.5;
    const noiseAmplitude = 0.015; // Typical high-frequency hand tremor (~1.5% screen width)

    const rawSamples: number[] = [];
    const smoothedSamples: number[] = [];

    // Deterministic high-frequency pseudo-noise (sine + alternating sign)
    for (let frame = 0; frame < 90; frame++) {
      const t = 1000 + frame * 33.33; // ~30 FPS
      const noise = Math.sin(frame * 1.5) * noiseAmplitude + ((frame % 2 === 0 ? 1 : -1) * 0.005);
      const raw = center + noise;
      const smoothed = filter.filter(raw, t);

      // Record after initial settling frames
      if (frame >= 10) {
        rawSamples.push(raw);
        smoothedSamples.push(smoothed);
      }
    }

    const rawVariance = calculateVariance(rawSamples);
    const smoothedVariance = calculateVariance(smoothedSamples);
    const noiseReduction = 1.0 - (smoothedVariance / rawVariance);

    assert.ok(
      smoothedVariance < rawVariance * 0.4,
      `Expected >=60% noise variance reduction, got ${(noiseReduction * 100).toFixed(1)}% reduction`
    );
  });

  it('4. dynamically adapts cutoff for deliberate fast movement to maintain low lag', () => {
    const filter = new OneEuroFilter({ minCutoff: 1.0, beta: 1.5 });

    // Establish slow baseline at x = 0.1
    filter.filter(0.1, 1000);
    filter.filter(0.1, 1033);

    // Sudden rapid swipe to x = 0.8 in 3 frames (100 ms)
    filter.filter(0.3, 1066);
    filter.filter(0.6, 1100);
    const finalFastOutput = filter.filter(0.8, 1133);

    // Fast movement should track closely due to speed coefficient beta
    assert.ok(
      finalFastOutput > 0.65,
      `Expected fast movement to reach > 0.65, got ${finalFastOutput.toFixed(3)}`
    );
  });

  it('5. handles variable frame timestamps (jittery frame rate) correctly', () => {
    const filter = new OneEuroFilter({ minCutoff: 1.0, beta: 1.0 });

    filter.filter(0.2, 1000);
    const out1 = filter.filter(0.25, 1016); // 60 FPS interval (16ms)
    const out2 = filter.filter(0.30, 1066); // 20 FPS interval (50ms)
    const out3 = filter.filter(0.35, 1099); // 30 FPS interval (33ms)

    assert.ok(Number.isFinite(out1) && Number.isFinite(out2) && Number.isFinite(out3));
    assert.ok(out3 > out2 && out2 > out1);
  });

  it('6. resets cleanly and initializes the next sample without carrying stale momentum', () => {
    const filter = new OneEuroFilter({ minCutoff: 1.0, beta: 1.0 });

    // Drive filter to 0.9
    filter.filter(0.9, 1000);
    filter.filter(0.9, 1033);
    assert.strictEqual(filter.hasHistory(), true);

    // Tracking lost -> reset
    filter.reset();
    assert.strictEqual(filter.hasHistory(), false);

    // Hand re-enters at 0.1 -> should initialize immediately at 0.1 without pulling from 0.9
    const afterReset = filter.filter(0.1, 5000);
    assert.strictEqual(afterReset, 0.1, 'After reset, filter must initialize to new sample directly');
  });

  it('7. safely handles invalid coordinates (NaN, Infinity) and non-increasing timestamps', () => {
    const filter = new OneEuroFilter();

    const f1 = filter.filter(0.5, 1000);
    assert.strictEqual(f1, 0.5);

    // Non-increasing timestamp (out-of-order or duplicate frame)
    const fDup = filter.filter(0.8, 1000);
    assert.strictEqual(fDup, 0.5, 'Must ignore duplicate non-increasing timestamp and return previous valid');

    const fBack = filter.filter(0.8, 900);
    assert.strictEqual(fBack, 0.5, 'Must ignore backward timestamp');

    // NaN input
    const fNaN = filter.filter(NaN, 1033);
    assert.strictEqual(fNaN, 0.5, 'Must safely ignore NaN input');

    // Infinity input
    const fInf = filter.filter(Infinity, 1066);
    assert.strictEqual(fInf, 0.5, 'Must safely ignore Infinity input');
  });
});

describe('Point3DOneEuroFilter & HandLandmarkOneEuroFilter', () => {
  it('filters 3D coordinates (x, y, z) independently', () => {
    const filter = new Point3DOneEuroFilter();
    const rawPoint: NormalizedLandmark = { x: 0.3, y: 0.6, z: -0.1 };

    const smoothed = filter.filter(rawPoint, 1000);
    assert.strictEqual(smoothed.x, 0.3);
    assert.strictEqual(smoothed.y, 0.6);
    assert.strictEqual(smoothed.z, -0.1);
  });

  it('9. does NOT mutate the original input landmark array or objects', () => {
    const handFilter = new HandLandmarkOneEuroFilter();
    const originalLandmarks = createDummyLandmarks(0.4, 0.4, 0);

    // Deep clone snapshot before filtering
    const snapshot = originalLandmarks.map((p) => ({ ...p }));

    // Run filter
    const smoothed = handFilter.filter(originalLandmarks, 1000);

    // Verify input landmarks were not mutated
    assert.strictEqual(originalLandmarks.length, 21);
    for (let i = 0; i < 21; i++) {
      assert.strictEqual(originalLandmarks[i].x, snapshot[i].x);
      assert.strictEqual(originalLandmarks[i].y, snapshot[i].y);
      assert.strictEqual(originalLandmarks[i].z, snapshot[i].z);
      // Smoothed objects must be new instances
      assert.notStrictEqual(smoothed[i], originalLandmarks[i]);
    }
  });

  it('measures computational execution overhead of filtering 21 landmarks', () => {
    const handFilter = new HandLandmarkOneEuroFilter();
    const landmarks = createDummyLandmarks();

    const iterations = 1000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      handFilter.filter(landmarks, 1000 + i * 33);
    }
    const totalMs = performance.now() - start;
    const avgMicrosPerHand = (totalMs * 1000) / iterations;

    // Filter execution overhead must be negligible (< 100 microseconds per 21 landmarks)
    assert.ok(
      avgMicrosPerHand < 100,
      `Expected filter overhead < 100 µs per hand, measured: ${avgMicrosPerHand.toFixed(1)} µs`
    );
  });
});

describe('MultiHandOneEuroFilter (Multi-Hand Isolation)', () => {
  it('8. ensures Left and Right hands do NOT share or cross-contaminate filter state', () => {
    const multiFilter = new MultiHandOneEuroFilter();

    const leftHandInput: HandLandmarkResult = {
      landmarks: createDummyLandmarks(0.2, 0.2, 0),
      handedness: 'Left',
      score: 0.95,
    };

    const rightHandInput: HandLandmarkResult = {
      landmarks: createDummyLandmarks(0.8, 0.8, 0),
      handedness: 'Right',
      score: 0.95,
    };

    // Frame 1: Both hands present
    const frame1 = multiFilter.filterHands([leftHandInput, rightHandInput], 1000);
    assert.strictEqual(frame1.length, 2);
    assert.strictEqual(frame1[0].landmarks[0].x, 0.2);
    assert.strictEqual(frame1[1].landmarks[0].x, 0.8);

    // Frame 2: Only Right hand present -> Left hand filter should reset
    const frame2 = multiFilter.filterHands([rightHandInput], 1033);
    assert.strictEqual(frame2.length, 1);
    assert.strictEqual(frame2[0].handedness, 'Right');

    // Frame 3: Left hand returns at new position (0.5) -> must initialize cleanly at 0.5 without pulling from 0.2
    const leftNewInput: HandLandmarkResult = {
      landmarks: createDummyLandmarks(0.5, 0.5, 0),
      handedness: 'Left',
      score: 0.95,
    };

    const frame3 = multiFilter.filterHands([leftNewInput, rightHandInput], 1066);
    assert.strictEqual(frame3.length, 2);
    const leftResult = frame3.find((h) => h.handedness === 'Left');
    assert.ok(leftResult);
    assert.strictEqual(leftResult.landmarks[0].x, 0.5, 'Re-entered hand must initialize directly at new position');
  });

  it('preserves cloned rawLandmarks alongside smoothed landmarks', () => {
    const multiFilter = new MultiHandOneEuroFilter();
    const handInput: HandLandmarkResult = {
      landmarks: createDummyLandmarks(0.3, 0.4, 0),
      handedness: 'Right',
      score: 0.9,
    };

    const results = multiFilter.filterHands([handInput], 1000);
    assert.ok(results[0].rawLandmarks, 'rawLandmarks must be present on output');
    assert.strictEqual(results[0].rawLandmarks.length, 21);
    assert.strictEqual(results[0].rawLandmarks[0].x, 0.3);
  });
});
