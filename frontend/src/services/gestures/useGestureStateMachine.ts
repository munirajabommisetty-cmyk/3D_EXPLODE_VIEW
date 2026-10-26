import { useMemo } from 'react';
import type { HandLandmarkResult, Handedness } from '../../types/landmarks';
import {
  DEFAULT_GESTURE_THRESHOLDS,
  type GestureRecognitionResult,
  type GestureThresholds,
} from '../../types/gestures';
import { GestureTemporalStabilizer } from './gestureClassifier';
import { gestureDiagnostics } from '../../utils/telemetry';

const EMPTY_GESTURE_RESULT: GestureRecognitionResult = {
  gesture: 'NONE',
  rawGesture: 'NONE',
  confidence: 0,
  isStable: true,
  consecutiveFrames: 0,
  handedness: 'Right',
  metrics: {
    pinchDistanceNorm: 999,
    handScale: 0.1,
    indexExtension: 0,
    middleExtension: 0,
    ringExtension: 0,
    pinkyExtension: 0,
  },
};

export interface UseGestureRecognitionOptions {
  hands: HandLandmarkResult[];
  thresholds?: Partial<GestureThresholds>;
  preferredHand?: Handedness;
}

export function useGestureRecognition({
  hands,
  thresholds,
  preferredHand = 'Right',
}: UseGestureRecognitionOptions): {
  primaryGesture: GestureRecognitionResult;
  allGestures: GestureRecognitionResult[];
  thresholds: GestureThresholds;
} {
  const mergedThresholds = useMemo<GestureThresholds>(() => {
    return { ...DEFAULT_GESTURE_THRESHOLDS, ...thresholds };
  }, [thresholds]);

  // Create stabilizers for both hands, preserving instances across renders
  const stabilizers = useMemo(() => {
    return {
      right: new GestureTemporalStabilizer(mergedThresholds),
      left: new GestureTemporalStabilizer(mergedThresholds),
    };
  }, [mergedThresholds]);

  // Derive recognition results directly from incoming hands without setState in effect
  const { primaryGesture, allGestures } = useMemo(() => {
    if (!hands || hands.length === 0) {
      stabilizers.right.reset();
      stabilizers.left.reset();
      return {
        primaryGesture: EMPTY_GESTURE_RESULT,
        allGestures: [],
      };
    }

    const results: GestureRecognitionResult[] = [];
    for (const hand of hands) {
      const stabilizer = hand.handedness === 'Left' ? stabilizers.left : stabilizers.right;
      const res = stabilizer.update(hand.landmarks, hand.handedness, hand.score);
      results.push(res);
    }

    // Prioritize a hand that has an active recognized gesture over a hand returning 'NONE'
    const activeResult = results.find((r) => r.gesture !== 'NONE' && r.isStable);
    const preferredResult =
      activeResult ||
      results.find((r) => r.handedness === preferredHand) ||
      results[0] ||
      EMPTY_GESTURE_RESULT;

    gestureDiagnostics.update({
      rawGesture: preferredResult.rawGesture,
      stableGesture: preferredResult.gesture,
      confidence: preferredResult.confidence,
      pinchDistanceNorm: preferredResult.metrics.pinchDistanceNorm,
      rejectionReason:
        preferredResult.rejectionReason ||
        (preferredResult.gesture !== 'NONE' ? 'Gesture Confirmed' : 'Pose unconfirmed'),
    });

    return {
      primaryGesture: preferredResult,
      allGestures: results,
    };
  }, [hands, preferredHand, stabilizers]);

  return {
    primaryGesture,
    allGestures,
    thresholds: mergedThresholds,
  };
}

export default useGestureRecognition;
