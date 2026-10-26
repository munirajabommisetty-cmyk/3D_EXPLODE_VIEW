/**
 * Geometric Gesture Recognition Rules
 * Pure mathematical functions for classifying 21 MediaPipe hand landmarks.
 * Fully decoupled from React and browser APIs for standalone testability.
 */

import { LANDMARK_INDEX, type NormalizedLandmark } from '../../types/landmarks';
import {
  DEFAULT_GESTURE_THRESHOLDS,
  type GestureThresholds,
  type GestureType,
  type HandFingersState,
} from '../../types/gestures';

/** Compute Euclidean distance in 3D normalized space */
export function distance3D(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Compute Euclidean distance in 2D (xy) normalized screen space */
export function distance2D(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute the scale of the hand using the rigid palm base dimension.
 * Distance between Wrist (0) and Middle MCP (9) is invariant to finger curling.
 */
export function calculateHandScale(landmarks: NormalizedLandmark[]): number {
  if (!landmarks || landmarks.length < 21) return 0.1;

  const wrist = landmarks[LANDMARK_INDEX.WRIST];
  const middleMcp = landmarks[LANDMARK_INDEX.MIDDLE_MCP];
  const indexMcp = landmarks[LANDMARK_INDEX.INDEX_MCP];
  const pinkyMcp = landmarks[LANDMARK_INDEX.PINKY_MCP];

  if (!wrist || !middleMcp || !indexMcp || !pinkyMcp) return 0.1;

  const wristToMiddleMcp = distance3D(wrist, middleMcp);
  const palmWidth = distance3D(indexMcp, pinkyMcp);
  const rawPalmDim = Math.max(wristToMiddleMcp, palmWidth);

  // If palm landmarks are collapsed/degenerate (e.g. all at 0,0,0), return 0
  if (rawPalmDim < 0.02 || !Number.isFinite(rawPalmDim)) {
    return 0;
  }

  // Return maximum of palm height and palm width, with a safe lower clamp
  return Math.max(rawPalmDim, 0.05);
}

/**
 * Analyze finger extension state for a 4-joint finger chain (Index, Middle, Ring, Pinky).
 */
export function analyzeFinger(
  landmarks: NormalizedLandmark[],
  mcpIdx: number,
  pipIdx: number,
  _dipIdx: number,
  tipIdx: number,
  handScale: number,
  thresholds: GestureThresholds
): { isExtended: boolean; isCurled: boolean; extensionRatio: number; tipToMcpNorm: number; isOccluded: boolean } {
  const wrist = landmarks[LANDMARK_INDEX.WRIST];
  const mcp = landmarks[mcpIdx];
  const pip = landmarks[pipIdx];
  const tip = landmarks[tipIdx];

  const distWristToTip = distance3D(wrist, tip);
  const distWristToPip = Math.max(distance3D(wrist, pip), 0.001);
  const extensionRatio = distWristToTip / distWristToPip;

  const tipToMcpNorm = distance3D(mcp, tip) / Math.max(handScale, 0.001);

  // Occlusion detection: collapsed landmark points or anatomically implausible bone stretch
  const boneMcpPip = distance3D(mcp, pip);
  const bonePipTip = distance3D(pip, tip);
  const isOccluded =
    (boneMcpPip < 0.002 && bonePipTip < 0.002) ||
    distWristToTip / Math.max(handScale, 0.001) > 3.8;

  // Pinky is anatomically ~25% shorter than middle/index fingers
  const isPinky = mcpIdx === LANDMARK_INDEX.PINKY_MCP;
  const minMcpToTipNorm = isPinky
    ? thresholds.minExtendedMcpToTipNorm * 0.72
    : thresholds.minExtendedMcpToTipNorm;

  const isExtended =
    !isOccluded &&
    extensionRatio >= thresholds.fingerExtensionRatio &&
    tipToMcpNorm >= minMcpToTipNorm;

  const isCurled =
    !isOccluded &&
    (extensionRatio <= thresholds.fingerCurlRatio ||
      tipToMcpNorm < minMcpToTipNorm * 0.75);

  return { isExtended, isCurled, extensionRatio, tipToMcpNorm, isOccluded };
}

/**
 * Extract comprehensive digit states for a hand
 */
export function extractHandFingersState(
  landmarks: NormalizedLandmark[],
  thresholds: GestureThresholds = DEFAULT_GESTURE_THRESHOLDS
): HandFingersState | null {
  if (!landmarks || landmarks.length < 21) {
    return null;
  }

  // Validate all coordinates are finite numbers (including optional z)
  for (let i = 0; i < 21; i++) {
    const lm = landmarks[i];
    if (
      !lm ||
      typeof lm.x !== 'number' ||
      typeof lm.y !== 'number' ||
      !Number.isFinite(lm.x) ||
      !Number.isFinite(lm.y) ||
      !Number.isFinite(lm.z ?? 0)
    ) {
      return null;
    }
  }

  const handScale = calculateHandScale(landmarks);
  // Degenerate palm geometry (e.g. tracking collapse where palm landmarks merge)
  if (handScale < 0.02 || !Number.isFinite(handScale)) {
    return null;
  }

  const thumbTip = landmarks[LANDMARK_INDEX.THUMB_TIP];
  const thumbMcp = landmarks[LANDMARK_INDEX.THUMB_MCP];
  const pinkyMcp = landmarks[LANDMARK_INDEX.PINKY_MCP];
  const indexTip = landmarks[LANDMARK_INDEX.INDEX_TIP];

  // Thumb analysis & occlusion
  const thumbSpan = distance3D(thumbTip, pinkyMcp) / handScale;
  const thumbTipToMcpNorm = distance3D(thumbMcp, thumbTip) / handScale;
  const thumbOccluded = distance3D(thumbMcp, thumbTip) < 0.003 || thumbSpan > 4.0;
  // Thumb is considered extended if it spans out from pinky MCP or extends from its base
  const thumbExtended =
    !thumbOccluded &&
    (thumbSpan >= thresholds.thumbOpenNormDist || thumbTipToMcpNorm >= 0.52);

  // Normalized pinch distance between Thumb Tip and Index Tip
  const pinchDistanceNorm = distance3D(thumbTip, indexTip) / handScale;

  // Analyze 4 long fingers
  const index = analyzeFinger(
    landmarks,
    LANDMARK_INDEX.INDEX_MCP,
    LANDMARK_INDEX.INDEX_PIP,
    LANDMARK_INDEX.INDEX_DIP,
    LANDMARK_INDEX.INDEX_TIP,
    handScale,
    thresholds
  );

  const middle = analyzeFinger(
    landmarks,
    LANDMARK_INDEX.MIDDLE_MCP,
    LANDMARK_INDEX.MIDDLE_PIP,
    LANDMARK_INDEX.MIDDLE_DIP,
    LANDMARK_INDEX.MIDDLE_TIP,
    handScale,
    thresholds
  );

  const ring = analyzeFinger(
    landmarks,
    LANDMARK_INDEX.RING_MCP,
    LANDMARK_INDEX.RING_PIP,
    LANDMARK_INDEX.RING_DIP,
    LANDMARK_INDEX.RING_TIP,
    handScale,
    thresholds
  );

  const pinky = analyzeFinger(
    landmarks,
    LANDMARK_INDEX.PINKY_MCP,
    LANDMARK_INDEX.PINKY_PIP,
    LANDMARK_INDEX.PINKY_DIP,
    LANDMARK_INDEX.PINKY_TIP,
    handScale,
    thresholds
  );

  return {
    thumb: {
      isExtended: thumbExtended,
      isCurled: !thumbExtended && !thumbOccluded,
      extensionRatio: thumbSpan,
      tipToMcpNorm: thumbTipToMcpNorm,
      isOccluded: thumbOccluded,
    },
    index,
    middle,
    ring,
    pinky,
    handScale,
    pinchDistanceNorm,
  };
}

/**
 * Instantaneous raw gesture classification based on normalized hand posture.
 * Supports hysteresis via previousGesture (e.g. maintaining PINCH across wider zoom distances).
 */
export function classifyInstantaneousGesture(
  landmarks: NormalizedLandmark[],
  thresholds: GestureThresholds = DEFAULT_GESTURE_THRESHOLDS,
  previousGesture: GestureType = 'NONE',
  trackingScore?: number
): { gesture: GestureType; confidence: number; fingerState: HandFingersState | null; debugReason: string; rejectionReason?: string } {
  // Low-confidence tracking guard (e.g. severe motion blur or low lighting)
  const minTrackingConf = thresholds.minTrackingConfidence ?? 0.50;
  if (trackingScore !== undefined && trackingScore < minTrackingConf) {
    const reason = `Low tracking confidence (${Math.round(trackingScore * 100)}% < ${Math.round(minTrackingConf * 100)}%)`;
    return {
      gesture: 'NONE',
      confidence: trackingScore,
      fingerState: null,
      debugReason: reason,
      rejectionReason: reason,
    };
  }

  const fingerState = extractHandFingersState(landmarks, thresholds);
  if (!fingerState) {
    let reason = 'Invalid or missing landmarks';
    if (!landmarks || landmarks.length < 21) {
      reason = 'Insufficient landmarks (< 21 points)';
    } else {
      const hasNonFinite = landmarks.some(
        (lm) => !lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y) || !Number.isFinite(lm.z ?? 0)
      );
      if (hasNonFinite) {
        reason = 'Non-finite / NaN landmark coordinates';
      } else {
        reason = 'Degenerate palm geometry (scale < 0.02)';
      }
    }
    return {
      gesture: 'NONE',
      confidence: 0,
      fingerState: null,
      debugReason: reason,
      rejectionReason: reason,
    };
  }

  const { thumb, index, middle, ring, pinky, pinchDistanceNorm, handScale } = fingerState;
  const thumbTip = landmarks[LANDMARK_INDEX.THUMB_TIP];
  const pinkyTip = landmarks[LANDMARK_INDEX.PINKY_TIP];

  // Partial occlusion guard: if pointing finger is occluded, reject immediately to prevent false cursor actions
  if (index.isOccluded) {
    const reason = 'Index finger landmark occluded or collapsed';
    return {
      gesture: 'NONE',
      confidence: 0,
      fingerState,
      debugReason: reason,
      rejectionReason: reason,
    };
  }

  // 1. PINCH CHECK (Thumb Tip & Index Tip contact or proximity)
  // Apply release hysteresis: wider distance tolerated if already in PINCH session
  const pinchThreshold =
    previousGesture === 'PINCH'
      ? thresholds.pinchReleaseNormDist ?? 0.60
      : thresholds.pinchMaxNormDist;

  // Distinguish pinch from a closed fist:
  // In a fist, all 4 fingers are tightly curled into the palm, and thumb tip is close to pinky/middle
  const allFourCurled = index.isCurled && middle.isCurled && ring.isCurled && pinky.isCurled;
  const distThumbToPinky = distance3D(thumbTip, pinkyTip) / handScale;
  const isClosedFist = allFourCurled && (distThumbToPinky < pinchDistanceNorm * 1.3 || pinchDistanceNorm > 0.32);

  if (pinchDistanceNorm <= pinchThreshold && !isClosedFist && !thumb.isOccluded && !index.isOccluded) {
    const normalizedCloseness = Math.max(0, 1.0 - pinchDistanceNorm / pinchThreshold);
    const confidence = Math.min(1.0, 0.65 + normalizedCloseness * 0.35);

    if (confidence >= thresholds.minConfidence) {
      return {
        gesture: 'PINCH',
        confidence,
        fingerState,
        debugReason: `Pinch engaged (norm dist: ${pinchDistanceNorm.toFixed(2)} <= ${pinchThreshold.toFixed(2)})`,
        rejectionReason: `Pinch engaged (norm dist: ${pinchDistanceNorm.toFixed(2)} <= ${pinchThreshold.toFixed(2)})`,
      };
    }
  }

  // 2. POINTING CHECK (Index extended, remaining fingers folded)
  const isPinching = pinchDistanceNorm <= (previousGesture === 'PINCH' ? (thresholds.pinchReleaseNormDist ?? 0.60) : thresholds.pinchMaxNormDist);
  if (index.isExtended && !isPinching && !index.isOccluded) {
    const othersFolded = !middle.isExtended && !ring.isExtended && !pinky.isExtended;

    if (othersFolded) {
      const indexStrength = Math.min(1.0, index.extensionRatio / (thresholds.fingerExtensionRatio * 1.2));
      const foldScore =
        (Number(!middle.isExtended) + Number(!ring.isExtended) + Number(!pinky.isExtended)) / 3;
      const confidence = Math.min(1.0, 0.55 + indexStrength * 0.25 + foldScore * 0.2);

      if (confidence >= thresholds.minConfidence) {
        return {
          gesture: 'POINTING',
          confidence,
          fingerState,
          debugReason: `Pointing active (index ext: ${index.extensionRatio.toFixed(2)})`,
        };
      }
    }
  }

  // 3. OPEN_PALM CHECK (All four long fingers extended and not pinching)
  if (!isPinching) {
    const allFourExtended =
      index.isExtended && middle.isExtended && ring.isExtended && pinky.isExtended;

    if (allFourExtended && !thumb.isOccluded) {
      // Natural open hand: thumb is out or comfortably relaxed (not pinched tightly against index)
      const thumbIsNotTucked = thumb.isExtended || pinchDistanceNorm >= 0.25;

      if (thumbIsNotTucked) {
        const avgExtension =
          (index.extensionRatio + middle.extensionRatio + ring.extensionRatio + pinky.extensionRatio) /
          4;
        const confidence = Math.min(1.0, 0.65 + Math.min(0.35, (avgExtension - 1.15) * 0.5));

        if (confidence >= thresholds.minConfidence) {
          return {
            gesture: 'OPEN_PALM',
            confidence,
            fingerState,
            debugReason: `Open palm active (avg ext: ${avgExtension.toFixed(2)})`,
          };
        }
      }
    }
  }

  // 4. Default: No supported posture confidently recognized
  let debugReason = 'Ambiguous hand pose';
  if (thumb.isOccluded || index.isOccluded || middle.isOccluded || ring.isOccluded || pinky.isOccluded) {
    debugReason = 'Hand landmarks partially occluded or collapsed';
  } else if (allFourCurled) {
    debugReason = 'Fist / clenched hand';
  } else if (index.isExtended && !middle.isExtended) {
    debugReason = `Near pointing (ring: ${ring.isExtended ? 'ext' : 'curl'}, pinky: ${pinky.isExtended ? 'ext' : 'curl'})`;
  } else if (index.isExtended && middle.isExtended) {
    debugReason = `Partial extension (index+middle, pinky: ${pinky.isExtended ? 'ext' : 'curl'})`;
  }

  return { gesture: 'NONE', confidence: 0, fingerState, debugReason, rejectionReason: debugReason };
}
