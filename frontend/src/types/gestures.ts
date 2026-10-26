/**
 * Gesture Recognition Types & Configuration Interfaces
 */

import type { Handedness, NormalizedLandmark } from './landmarks';

/** Supported discrete gesture classes */
export type GestureType = 'NONE' | 'OPEN_PALM' | 'POINTING' | 'PINCH';

/** State of individual fingers */
export interface FingerState {
  isExtended: boolean;
  isCurled: boolean;
  extensionRatio: number;
  tipToMcpNorm: number;
  isOccluded?: boolean;
}

/** Complete finger states for a hand */
export interface HandFingersState {
  thumb: FingerState;
  index: FingerState;
  middle: FingerState;
  ring: FingerState;
  pinky: FingerState;
  handScale: number;
  pinchDistanceNorm: number;
}

/** Configurable recognition thresholds */
export interface GestureThresholds {
  /** Maximum normalized distance between thumb tip and index tip for pinch engagement (default: ~0.38) */
  pinchMaxNormDist: number;
  /** Maximum normalized distance to maintain an active pinch session before releasing (hysteresis, default: ~0.60) */
  pinchReleaseNormDist: number;
  /** Minimum ratio of tip-to-wrist distance over pip-to-wrist distance for extension (default: ~1.15) */
  fingerExtensionRatio: number;
  /** Maximum ratio of tip-to-wrist distance over pip-to-wrist distance for curled finger (default: ~1.05) */
  fingerCurlRatio: number;
  /** Minimum normalized distance from MCP to TIP for extended finger (default: ~0.65) */
  minExtendedMcpToTipNorm: number;
  /** Minimum thumb tip to pinky MCP distance for open thumb (default: ~0.60) */
  thumbOpenNormDist: number;
  /** Minimum detection confidence (0-1) to accept a gesture (default: ~0.60) */
  minConfidence: number;
  /** Minimum tracking presence confidence score from landmarker before rejecting as low-confidence tracking (default: ~0.50) */
  minTrackingConfidence: number;
  /** Consecutive frames required to stabilize a gesture transition (default: 3) */
  stabilityFramesRequired: number;
}

/** Default tuned thresholds */
export const DEFAULT_GESTURE_THRESHOLDS: GestureThresholds = {
  pinchMaxNormDist: 0.38,
  pinchReleaseNormDist: 0.60,
  fingerExtensionRatio: 1.15,
  fingerCurlRatio: 1.05,
  minExtendedMcpToTipNorm: 0.65,
  thumbOpenNormDist: 0.60,
  minConfidence: 0.60,
  minTrackingConfidence: 0.50,
  stabilityFramesRequired: 3,
};

/** Recognition output for a single detected hand */
export interface GestureRecognitionResult {
  /** Confirmed gesture after hysteresis filtering */
  gesture: GestureType;
  /** Raw instantaneous gesture before hysteresis */
  rawGesture: GestureType;
  /** Confidence score between 0.0 and 1.0 */
  confidence: number;
  /** Whether the gesture has satisfied consecutive stability frames */
  isStable: boolean;
  /** Number of consecutive frames the active gesture has persisted */
  consecutiveFrames: number;
  /** Handedness associated with this gesture */
  handedness: Handedness;
  /** Diagnostic human-readable rejection or transition explanation */
  rejectionReason?: string;
  /** Diagnostic metrics for telemetry and visualization */
  metrics: {
    pinchDistanceNorm: number;
    handScale: number;
    indexExtension: number;
    middleExtension: number;
    ringExtension: number;
    pinkyExtension: number;
  };
}

/** Input contract for gesture classifier */
export interface GestureClassifierInput {
  landmarks: NormalizedLandmark[];
  handedness: Handedness;
  score?: number;
}
