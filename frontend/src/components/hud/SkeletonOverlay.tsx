import React, { useEffect, useRef } from 'react';
import {
  HAND_CONNECTIONS,
  LANDMARK_INDEX,
  type HandLandmarkResult,
  type HandLandmarkerStatus,
} from '../../types/landmarks';
import './SkeletonOverlay.css';

export interface SkeletonOverlayProps {
  hands: HandLandmarkResult[];
  status: HandLandmarkerStatus;
  trackingFps: number;
  width?: number;
  height?: number;
}

// Landmark color palettes for hands
const HAND_COLORS = {
  Right: {
    joint: '#00e5ff', // Cyan
    tip: '#38bdf8',
    bone: 'rgba(0, 229, 255, 0.75)',
    wrist: '#ffffff',
  },
  Left: {
    joint: '#f59e0b', // Amber / Gold
    tip: '#fbbf24',
    bone: 'rgba(245, 158, 11, 0.75)',
    wrist: '#ffffff',
  },
};

const FINGERTIP_INDICES = new Set<number>([
  LANDMARK_INDEX.THUMB_TIP,
  LANDMARK_INDEX.INDEX_TIP,
  LANDMARK_INDEX.MIDDLE_TIP,
  LANDMARK_INDEX.RING_TIP,
  LANDMARK_INDEX.PINKY_TIP,
]);

export const SkeletonOverlay: React.FC<SkeletonOverlayProps> = ({
  hands,
  status,
  trackingFps,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Maintain internal canvas resolution matching display element
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.round(rect.width * dpr);
    const displayHeight = Math.round(rect.height * dpr);

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (hands.length === 0) {
      ctx.restore();
      return;
    }

    const w = canvas.width;
    const h = canvas.height;

    for (const hand of hands) {
      const palette = HAND_COLORS[hand.handedness] || HAND_COLORS.Right;
      const { landmarks } = hand;

      if (!landmarks || landmarks.length < 21) continue;

      // 1. Draw Bones (Skeleton Lines)
      ctx.lineWidth = Math.max(2, Math.round(2 * dpr));
      ctx.strokeStyle = palette.bone;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
        const start = landmarks[startIdx];
        const end = landmarks[endIdx];

        if (start && end) {
          ctx.beginPath();
          ctx.moveTo(start.x * w, start.y * h);
          ctx.lineTo(end.x * w, end.y * h);
          ctx.stroke();
        }
      }

      // 2. Draw Landmark Joints (Points)
      for (let i = 0; i < landmarks.length; i++) {
        const lm = landmarks[i];
        const isTip = FINGERTIP_INDICES.has(i);
        const isWrist = i === LANDMARK_INDEX.WRIST;

        const radius = isTip
          ? Math.max(4, Math.round(4.5 * dpr))
          : isWrist
          ? Math.max(3.5, Math.round(4 * dpr))
          : Math.max(2.5, Math.round(3 * dpr));

        ctx.beginPath();
        ctx.arc(lm.x * w, lm.y * h, radius, 0, 2 * Math.PI);

        if (isWrist) {
          ctx.fillStyle = palette.wrist;
        } else if (isTip) {
          ctx.fillStyle = palette.tip;
        } else {
          ctx.fillStyle = palette.joint;
        }

        ctx.shadowColor = palette.joint;
        ctx.shadowBlur = Math.round(6 * dpr);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    ctx.restore();
  }, [hands]);

  return (
    <div className="skeleton-overlay-container">
      {/* Superimposed 2D skeleton canvas with horizontal mirroring matching the video */}
      <canvas ref={canvasRef} className="pip-skeleton-canvas" aria-label="21-point hand skeleton" />

      {/* Telemetry pill (not mirrored so text remains readable) */}
      <div className="skeleton-telemetry-badge">
        {status === 'initializing' ? (
          <span className="telemetry-item init">
            <span className="telemetry-spinner" /> Loading MediaPipe...
          </span>
        ) : status === 'detecting' ? (
          <>
            <span className="telemetry-item tracking">
              <span className="telemetry-dot active" />
              {hands.length} {hands.length === 1 ? 'Hand' : 'Hands'}
            </span>
            <span className="telemetry-divider">|</span>
            <span className="telemetry-item fps">{trackingFps} FPS</span>
          </>
        ) : status === 'ready' ? (
          <span className="telemetry-item ready">
            <span className="telemetry-dot ready" /> Ready (No Hands)
          </span>
        ) : null}
      </div>
    </div>
  );
};

export default SkeletonOverlay;
