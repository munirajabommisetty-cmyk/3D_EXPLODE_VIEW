/**
 * Gesture Classifier & Temporal Stabilizer
 * Combines geometric rules with hysteresis debouncing to prevent frame-to-frame flickering.
 */

import type { Handedness, NormalizedLandmark } from '../../types/landmarks';
import {
  DEFAULT_GESTURE_THRESHOLDS,
  type GestureRecognitionResult,
  type GestureThresholds,
  type GestureType,
} from '../../types/gestures';
import { classifyInstantaneousGesture } from './gestureRules';

export class GestureTemporalStabilizer {
  private thresholds: GestureThresholds;
  private currentStableGesture: GestureType = 'NONE';
  private candidateGesture: GestureType = 'NONE';
  private candidateFrameCount: number = 0;
  private stableFrameCount: number = 0;
  private lastConfidence: number = 0;

  constructor(thresholds: Partial<GestureThresholds> = {}) {
    this.thresholds = { ...DEFAULT_GESTURE_THRESHOLDS, ...thresholds };
  }

  /** Update thresholds dynamically */
  public setThresholds(thresholds: Partial<GestureThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  /** Reset internal state history */
  public reset(): void {
    this.currentStableGesture = 'NONE';
    this.candidateGesture = 'NONE';
    this.candidateFrameCount = 0;
    this.stableFrameCount = 0;
    this.lastConfidence = 0;
  }

  /**
   * Process a single video frame of 21 landmarks.
   */
  public update(
    landmarks: NormalizedLandmark[] | null | undefined,
    handedness: Handedness = 'Right',
    trackingScore?: number
  ): GestureRecognitionResult {
    // Missing or invalid data defaults to NONE
    if (!landmarks || landmarks.length < 21) {
      this.reset();
      return {
        gesture: 'NONE',
        rawGesture: 'NONE',
        confidence: 0,
        isStable: true,
        consecutiveFrames: 0,
        handedness,
        rejectionReason: 'No hand landmarks detected',
        metrics: {
          pinchDistanceNorm: 999,
          handScale: 0.1,
          indexExtension: 0,
          middleExtension: 0,
          ringExtension: 0,
          pinkyExtension: 0,
        },
      };
    }

    // 1. Compute instantaneous geometric classification with hysteresis context and tracking score
    const { gesture: rawGesture, confidence, fingerState, debugReason } = classifyInstantaneousGesture(
      landmarks,
      this.thresholds,
      this.currentStableGesture,
      trackingScore
    );

    // 2. Apply temporal hysteresis
    if (rawGesture === this.currentStableGesture) {
      // Sustained active gesture
      this.stableFrameCount += 1;
      this.candidateGesture = 'NONE';
      this.candidateFrameCount = 0;
      this.lastConfidence = confidence;
    } else {
      // Potential transition detected
      if (rawGesture === this.candidateGesture) {
        this.candidateFrameCount += 1;
      } else {
        this.candidateGesture = rawGesture;
        this.candidateFrameCount = 1;
      }

      // Check if candidate has reached required stability frames
      if (this.candidateFrameCount >= this.thresholds.stabilityFramesRequired) {
        this.currentStableGesture = this.candidateGesture;
        this.stableFrameCount = this.candidateFrameCount;
        this.candidateGesture = 'NONE';
        this.candidateFrameCount = 0;
        this.lastConfidence = confidence;
      }
    }

    const isStable = this.stableFrameCount >= this.thresholds.stabilityFramesRequired;

    return {
      gesture: this.currentStableGesture,
      rawGesture,
      confidence: this.lastConfidence,
      isStable,
      consecutiveFrames: this.stableFrameCount,
      handedness,
      rejectionReason: debugReason,
      metrics: {
        pinchDistanceNorm: fingerState?.pinchDistanceNorm ?? 999,
        handScale: fingerState?.handScale ?? 0.1,
        indexExtension: fingerState?.index.extensionRatio ?? 0,
        middleExtension: fingerState?.middle.extensionRatio ?? 0,
        ringExtension: fingerState?.ring.extensionRatio ?? 0,
        pinkyExtension: fingerState?.pinky.extensionRatio ?? 0,
      },
    };
  }
}
