/* oxlint-disable react/only-export-components */
/**
 * GestureCameraController, GestureOrbitEngine & GesturePinchZoomEngine
 * Task 4.1: Open-Palm Orbit Navigation
 * Task 4.2: Pinch-to-Zoom Controller
 *
 * Maps continuous 2D hand translation deltas to Three.js OrbitControls yaw and pitch
 * when a stable OPEN_PALM gesture is confirmed.
 * Maps dynamic thumb-to-index pinch distance deltas to smooth camera zoom-in / zoom-out
 * when a stable PINCH gesture is confirmed.
 */

import { CameraController } from './CameraController';
import { LANDMARK_INDEX, type NormalizedLandmark, type HandLandmarkResult } from '../../types/landmarks';
import type { GestureRecognitionResult } from '../../types/gestures';
import { distance3D, calculateHandScale } from '../../services/gestures/gestureRules';
import { gestureDiagnostics } from '../../utils/telemetry';

export interface Point2D {
  x: number;
  y: number;
}

export interface GestureOrbitConfig {
  /** Horizontal yaw sensitivity in radians per normalized screen-width displacement */
  yawSensitivity: number;
  /** Vertical elevation (pitch) sensitivity in radians per normalized screen-height displacement */
  pitchSensitivity: number;
  /** Minimum normalized displacement distance required before registering rotation (filters tremor) */
  deadband: number;
  /** Maximum single-frame normalized displacement before rejecting as tracking anomaly/jump */
  maxJumpThreshold: number;
  /** True if webcam video is horizontally mirrored (flips deltaX to match user intuition) */
  mirrorX: boolean;
  /** Invert horizontal yaw rotation direction */
  invertYaw: boolean;
  /** Invert vertical elevation rotation direction */
  invertPitch: boolean;
  /** Landmark indices defining the rigid palm boundary for anchor computation */
  palmLandmarkIndices: readonly number[];
}

export const DEFAULT_GESTURE_ORBIT_CONFIG: GestureOrbitConfig = {
  yawSensitivity: 3.2,
  pitchSensitivity: 2.6,
  deadband: 0.0035,
  maxJumpThreshold: 0.20,
  mirrorX: true,
  invertYaw: false,
  invertPitch: false,
  palmLandmarkIndices: [0, 5, 9, 13, 17], // 0: Wrist, 5: Index MCP, 9: Middle MCP, 13: Ring MCP, 17: Pinky MCP
};

export interface GestureOrbitDelta {
  /** Radians to rotate around the vertical Y axis via OrbitControls.rotateLeft() */
  deltaYaw: number;
  /** Radians to rotate around the horizontal axis via OrbitControls.rotateUp() */
  deltaPitch: number;
  /** Whether gesture-based orbit is currently active */
  isActive: boolean;
  /** Current tracked palm anchor point, or null if tracking is inactive */
  anchor: Point2D | null;
  /** Raw displacement vector between the current sample and previous anchor */
  rawDisplacement: Point2D;
}

/**
 * Pure mathematical engine for palm anchor calculation, coordinate transformation,
 * deadband filtering, jump rejection, and delta generation.
 * Decoupled from Three.js and DOM for automated unit testing.
 */
export class GestureOrbitEngine {
  private config: GestureOrbitConfig;
  private lastAnchor: Point2D | null = null;
  private wasActive: boolean = false;

  constructor(config: Partial<GestureOrbitConfig> = {}) {
    this.config = { ...DEFAULT_GESTURE_ORBIT_CONFIG, ...config };
  }

  public getConfig(): GestureOrbitConfig {
    return { ...this.config };
  }

  public setConfig(partialConfig: Partial<GestureOrbitConfig>): void {
    this.config = { ...this.config, ...partialConfig };
  }

  /**
   * Computes the palm centroid anchor from rigid palm boundary landmarks (0, 5, 9, 13, 17).
   * Validates coordinates and rejects null, undefined, or NaN inputs.
   */
  public computeAnchor(landmarks?: NormalizedLandmark[] | null): Point2D | null {
    if (!landmarks || landmarks.length === 0) return null;

    const indices = this.config.palmLandmarkIndices;
    let sumX = 0;
    let sumY = 0;
    let validCount = 0;

    for (const idx of indices) {
      const lm = landmarks[idx];
      if (!lm) continue;
      if (!Number.isFinite(lm.x) || !Number.isFinite(lm.y)) continue;
      // Allow realistic normalized bounds with slight margin for partial edge tracking
      if (lm.x < -0.2 || lm.x > 1.2 || lm.y < -0.2 || lm.y > 1.2) continue;

      sumX += lm.x;
      sumY += lm.y;
      validCount++;
    }

    // Require at least 3 valid palm landmarks to form a reliable centroid
    if (validCount < 3) return null;

    // Check if valid palm landmarks have degenerate spread (e.g. all points collapsed onto exact same coordinate like 0,0,0)
    const avgX = sumX / validCount;
    const avgY = sumY / validCount;
    let maxDistFromCentroid = 0;
    for (const idx of indices) {
      const lm = landmarks[idx];
      if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) continue;
      if (lm.x < -0.2 || lm.x > 1.2 || lm.y < -0.2 || lm.y > 1.2) continue;
      const d = Math.hypot(lm.x - avgX, lm.y - avgY);
      if (d > maxDistFromCentroid) maxDistFromCentroid = d;
    }
    if (maxDistFromCentroid < 0.005) {
      return null;
    }

    return {
      x: avgX,
      y: avgY,
    };
  }

  /**
   * Core stateful update step.
   *
   * @param isGestureActive - true if OPEN_PALM is stable and valid
   * @param landmarks - current hand landmarks
   * @param isMouseActive - true if mouse or touch drag is currently active
   * @returns calculated yaw and elevation rotation deltas
   */
  public update(
    isGestureActive: boolean,
    landmarks?: NormalizedLandmark[] | null,
    isMouseActive: boolean = false
  ): GestureOrbitDelta {
    // Suppress and reset if mouse interaction is taking precedence or gesture is not active
    if (isMouseActive || !isGestureActive) {
      this.reset();
      return {
        deltaYaw: 0,
        deltaPitch: 0,
        isActive: false,
        anchor: null,
        rawDisplacement: { x: 0, y: 0 },
      };
    }

    const currentAnchor = this.computeAnchor(landmarks);
    if (!currentAnchor) {
      // Tracking lost: reset anchor to avoid teleportation when tracking resumes
      this.reset();
      return {
        deltaYaw: 0,
        deltaPitch: 0,
        isActive: false,
        anchor: null,
        rawDisplacement: { x: 0, y: 0 },
      };
    }

    // First frame of confirmed gesture: register fresh anchor without generating camera motion
    if (!this.wasActive || this.lastAnchor === null) {
      this.lastAnchor = currentAnchor;
      this.wasActive = true;
      return {
        deltaYaw: 0,
        deltaPitch: 0,
        isActive: true,
        anchor: currentAnchor,
        rawDisplacement: { x: 0, y: 0 },
      };
    }

    // Raw displacement relative to previous anchor
    const rawDx = currentAnchor.x - this.lastAnchor.x;
    const rawDy = currentAnchor.y - this.lastAnchor.y;
    const distance = Math.hypot(rawDx, rawDy);

    // Jump rejection: if displacement exceeds maxJumpThreshold in a single frame,
    // discard delta and re-anchor to prevent camera whipping
    if (distance > this.config.maxJumpThreshold) {
      this.lastAnchor = currentAnchor;
      return {
        deltaYaw: 0,
        deltaPitch: 0,
        isActive: true,
        anchor: currentAnchor,
        rawDisplacement: { x: 0, y: 0 },
      };
    }

    // Deadband filtering: ignore micro-tremors below threshold
    if (distance < this.config.deadband) {
      return {
        deltaYaw: 0,
        deltaPitch: 0,
        isActive: true,
        anchor: currentAnchor,
        rawDisplacement: { x: rawDx, y: rawDy },
      };
    }

    // Account for mirrored preview:
    // In mirrored video, moving physical hand to user's right moves anchor toward right side of screen.
    // Raw camera coordinate moves left (decreasing x), so mirrored dx = -rawDx.
    const effectiveDx = this.config.mirrorX ? -rawDx : rawDx;

    // Moving hand UP corresponds to decreasing y in image space (y = 0 at top).
    // Moving hand UP should elevate the viewpoint (rotateUp > 0 increases elevation angle).
    const effectiveDy = -rawDy;

    // Map to radians
    let deltaYaw = effectiveDx * this.config.yawSensitivity;
    let deltaPitch = effectiveDy * this.config.pitchSensitivity;

    if (this.config.invertYaw) deltaYaw = -deltaYaw;
    if (this.config.invertPitch) deltaPitch = -deltaPitch;

    // Normalize negative zero (-0) to 0
    if (deltaYaw === 0) deltaYaw = 0;
    if (deltaPitch === 0) deltaPitch = 0;

    // Advance anchor to current position
    this.lastAnchor = currentAnchor;

    return {
      deltaYaw,
      deltaPitch,
      isActive: true,
      anchor: currentAnchor,
      rawDisplacement: { x: rawDx, y: rawDy },
    };
  }

  /**
   * Resets internal tracking anchor and active flag.
   */
  public reset(): void {
    this.lastAnchor = null;
    this.wasActive = false;
  }
}

export interface GesturePinchZoomConfig {
  /** Zoom sensitivity multiplier (world units per normalized distance delta) */
  zoomSensitivity: number;
  /** Deadband threshold below which normalized distance delta is treated as 0 (filters micro-tremor) */
  deadband: number;
  /** Maximum single-frame normalized distance jump before rejecting as tracking anomaly */
  maxJumpThreshold: number;
  /**
   * If true: spreading fingers zooms in (camera moves closer), closing fingers zooms out (touchscreen style).
   * If false (default per TASKS.md acceptance criteria): closing fingers zooms in, spreading fingers zooms out.
   */
  spreadIsZoomIn: boolean;
  /** Invert final zoom direction */
  invertZoom: boolean;
  /** Smoothing alpha factor (0 = infinite lag, 1.0 = instant). Default 0.4 */
  smoothingAlpha: number;
  /** Maximum normalized pinch distance before pinch session terminates if fingers spread wide */
  maxPinchSessionDistance: number;
}

export const DEFAULT_GESTURE_PINCH_ZOOM_CONFIG: GesturePinchZoomConfig = {
  zoomSensitivity: 12.0,
  deadband: 0.008,
  maxJumpThreshold: 0.35,
  spreadIsZoomIn: false,
  invertZoom: false,
  smoothingAlpha: 0.4,
  maxPinchSessionDistance: 0.65,
};

export interface GesturePinchZoomDelta {
  /** Zoom distance delta to apply: positive zooms in (closer to target), negative zooms out */
  deltaZoom: number;
  /** Whether pinch-to-zoom is currently active */
  isActive: boolean;
  /** Current normalized distance between thumb tip and index tip (relative to hand scale) */
  pinchDistanceNorm: number;
  /** Raw normalized distance change from previous frame */
  rawDeltaDistance: number;
}

export interface GestureCameraUpdateResult {
  orbit: GestureOrbitDelta;
  pinch: GesturePinchZoomDelta;
}

/**
 * Pure mathematical engine for scale-invariant pinch-to-zoom calculation.
 * Computes normalized distance between thumb tip (4) and index tip (8) relative to hand scale,
 * tracks frame-to-frame delta, filters tremor via deadband, rejects tracking jumps,
 * and outputs smoothed zoom-in / zoom-out deltas.
 * Fully decoupled from Three.js and DOM for automated unit testing.
 */
export class GesturePinchZoomEngine {
  private config: GesturePinchZoomConfig;
  private lastDistance: number | null = null;
  private smoothedDelta: number = 0;
  private isPinchSessionActive: boolean = false;

  constructor(config: Partial<GesturePinchZoomConfig> = {}) {
    this.config = { ...DEFAULT_GESTURE_PINCH_ZOOM_CONFIG, ...config };
  }

  public getConfig(): GesturePinchZoomConfig {
    return { ...this.config };
  }

  public setConfig(partialConfig: Partial<GesturePinchZoomConfig>): void {
    this.config = { ...this.config, ...partialConfig };
  }

  public isSessionActive(): boolean {
    return this.isPinchSessionActive;
  }

  /**
   * Calculates scale-invariant normalized distance between thumb tip (4) and index tip (8).
   * Uses calculateHandScale from rigid palm landmarks so distance is invariant to webcam distance.
   */
  public computePinchDistance(landmarks?: NormalizedLandmark[] | null): {
    pinchDistanceNorm: number;
    rawDistance: number;
    handScale: number;
  } | null {
    if (!landmarks || landmarks.length < 21) return null;

    const thumbTip = landmarks[LANDMARK_INDEX.THUMB_TIP];
    const indexTip = landmarks[LANDMARK_INDEX.INDEX_TIP];
    if (!thumbTip || !indexTip) return null;

    if (
      !Number.isFinite(thumbTip.x) ||
      !Number.isFinite(thumbTip.y) ||
      !Number.isFinite(thumbTip.z ?? 0) ||
      !Number.isFinite(indexTip.x) ||
      !Number.isFinite(indexTip.y) ||
      !Number.isFinite(indexTip.z ?? 0)
    ) {
      return null;
    }

    const handScale = calculateHandScale(landmarks);
    if (handScale < 0.02 || !Number.isFinite(handScale)) {
      return null;
    }

    const rawDistance = distance3D(thumbTip, indexTip);
    if (!Number.isFinite(rawDistance)) {
      return null;
    }

    const pinchDistanceNorm = rawDistance / handScale;
    if (!Number.isFinite(pinchDistanceNorm)) {
      return null;
    }

    return {
      pinchDistanceNorm,
      rawDistance,
      handScale,
    };
  }

  /**
   * Core update step for pinch-to-zoom.
   *
   * @param isPinchGestureActive - true if gesture classifier confirms stable PINCH
   * @param landmarks - current hand landmarks
   * @param isMouseActive - true if mouse or touch is currently interacting
   * @param conflictingGestureActive - true if OPEN_PALM or POINTING is confirmed active
   */
  public update(
    isPinchGestureActive: boolean,
    landmarks?: NormalizedLandmark[] | null,
    isMouseActive: boolean = false,
    conflictingGestureActive: boolean = false
  ): GesturePinchZoomDelta {
    // Suppress immediately if mouse/touch is active or conflicting gesture (OPEN_PALM, POINTING) is active
    if (isMouseActive || conflictingGestureActive) {
      this.reset();
      return {
        deltaZoom: 0,
        isActive: false,
        pinchDistanceNorm: 0,
        rawDeltaDistance: 0,
      };
    }

    const pinchData = this.computePinchDistance(landmarks);
    if (!pinchData) {
      // Tracking lost: safely reset session to prevent camera jumps on re-entry
      this.reset();
      return {
        deltaZoom: 0,
        isActive: false,
        pinchDistanceNorm: 0,
        rawDeltaDistance: 0,
      };
    }

    const { pinchDistanceNorm } = pinchData;

    // Start session when stable PINCH gesture is confirmed
    if (isPinchGestureActive && !this.isPinchSessionActive) {
      this.isPinchSessionActive = true;
      this.lastDistance = pinchDistanceNorm;
      this.smoothedDelta = 0;
      return {
        deltaZoom: 0,
        isActive: true,
        pinchDistanceNorm,
        rawDeltaDistance: 0,
      };
    }

    // Terminate session if distance spreads too far or session is not active
    if (
      !this.isPinchSessionActive ||
      pinchDistanceNorm > this.config.maxPinchSessionDistance
    ) {
      this.reset();
      return {
        deltaZoom: 0,
        isActive: false,
        pinchDistanceNorm,
        rawDeltaDistance: 0,
      };
    }

    // First frame of tracking in active session: anchor distance
    if (this.lastDistance === null) {
      this.lastDistance = pinchDistanceNorm;
      return {
        deltaZoom: 0,
        isActive: true,
        pinchDistanceNorm,
        rawDeltaDistance: 0,
      };
    }

    const rawDeltaDistance = pinchDistanceNorm - this.lastDistance;

    // Jump rejection: if tracking jumps abruptly across a single frame, re-anchor
    if (Math.abs(rawDeltaDistance) > this.config.maxJumpThreshold) {
      this.lastDistance = pinchDistanceNorm;
      this.smoothedDelta = 0;
      return {
        deltaZoom: 0,
        isActive: true,
        pinchDistanceNorm,
        rawDeltaDistance,
      };
    }

    // Deadband stabilization: ignore micro-tremors below threshold
    if (Math.abs(rawDeltaDistance) < this.config.deadband) {
      this.smoothedDelta *= 0.7;
      if (Math.abs(this.smoothedDelta) < 0.001) this.smoothedDelta = 0;
      return {
        deltaZoom: this.smoothedDelta,
        isActive: true,
        pinchDistanceNorm,
        rawDeltaDistance,
      };
    }

    // Advance distance anchor
    this.lastDistance = pinchDistanceNorm;

    // Direction mapping:
    // spreadIsZoomIn = false (default per TASKS.md):
    //   Decreasing distance (fingers closer, rawDeltaDistance < 0) -> Zoom In (deltaZoom > 0).
    //   Increasing distance (fingers further, rawDeltaDistance > 0) -> Zoom Out (deltaZoom < 0).
    // spreadIsZoomIn = true:
    //   Increasing distance -> Zoom In (deltaZoom > 0).
    const effectiveDirection = this.config.spreadIsZoomIn ? rawDeltaDistance : -rawDeltaDistance;
    let rawZoomDelta = effectiveDirection * this.config.zoomSensitivity;

    if (this.config.invertZoom) {
      rawZoomDelta = -rawZoomDelta;
    }

    // Apply exponential smoothing filter
    const alpha = Math.min(1, Math.max(0, this.config.smoothingAlpha));
    this.smoothedDelta = this.smoothedDelta * (1 - alpha) + rawZoomDelta * alpha;

    // Normalize negative zero
    let deltaZoom = this.smoothedDelta;
    if (deltaZoom === 0 || Math.abs(deltaZoom) < 1e-6) deltaZoom = 0;

    return {
      deltaZoom,
      isActive: true,
      pinchDistanceNorm,
      rawDeltaDistance,
    };
  }

  /**
   * Resets internal tracking anchor, smoothed delta, and session state.
   */
  public reset(): void {
    this.lastDistance = null;
    this.smoothedDelta = 0;
    this.isPinchSessionActive = false;
  }
}

/**
 * High-level GestureCameraController connecting GestureOrbitEngine and GesturePinchZoomEngine
 * to Three.js OrbitControls and CameraController.
 * Handles OrbitControls autoRotate pause/restore, damping, and mouse contention.
 */
export class GestureCameraController {
  public readonly orbitEngine: GestureOrbitEngine;
  public readonly pinchEngine: GesturePinchZoomEngine;
  private readonly cameraController: CameraController;
  private wasAutoRotatingPriorToGesture: boolean = false;
  private isGestureInteracting: boolean = false;

  /** Backward compatibility alias for orbitEngine */
  public get engine(): GestureOrbitEngine {
    return this.orbitEngine;
  }

  constructor(
    cameraController: CameraController,
    orbitConfig: Partial<GestureOrbitConfig> = {},
    pinchConfig: Partial<GesturePinchZoomConfig> = {}
  ) {
    this.cameraController = cameraController;
    this.orbitEngine = new GestureOrbitEngine(orbitConfig);
    this.pinchEngine = new GesturePinchZoomEngine(pinchConfig);
  }

  /**
   * Invoked within the requestAnimationFrame render loop (never in React render logic).
   */
  public update(
    gestureResult?: GestureRecognitionResult | null,
    hands?: HandLandmarkResult[] | null
  ): GestureCameraUpdateResult {
    // Check if mouse/touch interaction is active on OrbitControls
    const isMouseActive = this.cameraController.isUserInteracting();

    const currentGesture = gestureResult?.gesture ?? 'NONE';
    const isGestureStable = gestureResult?.isStable ?? false;

    // Gesture exclusivity checks:
    // Conflicting gestures that terminate and suppress pinch:
    const isOpenPalmActive = !isMouseActive && currentGesture === 'OPEN_PALM' && isGestureStable;
    const isPointingActive = currentGesture === 'POINTING' && isGestureStable;
    const conflictingForPinch = isOpenPalmActive || isPointingActive;

    // Pinch is active if stable PINCH gesture is confirmed, OR if a pinch session is already ongoing
    // and no conflicting gesture has taken over.
    const isPinchActive = !isMouseActive && !conflictingForPinch && (
      (currentGesture === 'PINCH' && isGestureStable) || this.pinchEngine.isSessionActive()
    );

    // Select active hand landmarks matching the confirmed gesture handedness
    let activeLandmarks: NormalizedLandmark[] | null = null;
    if (hands && hands.length > 0) {
      if (gestureResult?.handedness) {
        const matchingHand = hands.find((h) => h.handedness === gestureResult.handedness);
        activeLandmarks = matchingHand ? matchingHand.landmarks : hands[0].landmarks;
      } else {
        activeLandmarks = hands[0].landmarks;
      }
    }

    // 1. Update Open-Palm Orbit Engine
    const orbitDelta = this.orbitEngine.update(isOpenPalmActive, activeLandmarks, isMouseActive);

    // 2. Update Pinch-to-Zoom Engine
    const pinchDelta = this.pinchEngine.update(
      isPinchActive,
      activeLandmarks,
      isMouseActive,
      conflictingForPinch
    );

    // Push diagnostic telemetry
    gestureDiagnostics.update({
      pinchDistanceNorm: Number(pinchDelta.pinchDistanceNorm.toFixed(3)),
      isPinchActive: pinchDelta.isActive,
      zoomDelta: Number(pinchDelta.deltaZoom.toFixed(4)),
      cameraDistance: Number(this.cameraController.getDistance().toFixed(2)),
    });

    // Handle OrbitControls auto-rotate pause/restore and gesture execution
    const isNowActive =
      (orbitDelta.isActive && (orbitDelta.deltaYaw !== 0 || orbitDelta.deltaPitch !== 0)) ||
      (pinchDelta.isActive && pinchDelta.deltaZoom !== 0);

    if (isNowActive && !isMouseActive) {
      if (!this.isGestureInteracting) {
        this.isGestureInteracting = true;
        this.wasAutoRotatingPriorToGesture = this.cameraController.isAutoRotating();
        if (this.wasAutoRotatingPriorToGesture) {
          this.cameraController.setAutoRotate(false);
        }
      }

      // Apply horizontal yaw rotation
      if (orbitDelta.deltaYaw !== 0) {
        this.cameraController.controls.rotateLeft(orbitDelta.deltaYaw);
      }

      // Apply vertical pitch elevation
      if (orbitDelta.deltaPitch !== 0) {
        this.cameraController.controls.rotateUp(orbitDelta.deltaPitch);
      }

      // Apply pinch zoom
      if (pinchDelta.deltaZoom !== 0) {
        this.cameraController.zoomBy(pinchDelta.deltaZoom);
      }
    } else if (!orbitDelta.isActive && !pinchDelta.isActive) {
      if (this.isGestureInteracting) {
        this.isGestureInteracting = false;
        // Restore auto-rotation if it was running before the user engaged gesture interaction
        if (this.wasAutoRotatingPriorToGesture) {
          this.cameraController.setAutoRotate(true);
        }
      }
    }

    return {
      orbit: orbitDelta,
      pinch: pinchDelta,
    };
  }

  /**
   * Resets both orbit and pinch tracking states and restores auto-rotation if active.
   */
  public reset(): void {
    this.orbitEngine.reset();
    this.pinchEngine.reset();
    if (this.isGestureInteracting && this.wasAutoRotatingPriorToGesture) {
      this.cameraController.setAutoRotate(true);
    }
    this.isGestureInteracting = false;
  }

  /**
   * Disposes controller state and releases references.
   */
  public dispose(): void {
    this.reset();
  }
}

export default GestureCameraController;
