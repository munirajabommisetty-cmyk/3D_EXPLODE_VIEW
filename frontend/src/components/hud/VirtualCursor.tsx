/* oxlint-disable react/only-export-components */
import React from 'react';
import './VirtualCursor.css';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ViewportDimensions {
  width: number;
  height: number;
}

export interface ProjectedCursorCoordinates {
  /** Screen space pixel position clamped to viewport */
  screen: ScreenPoint;
  /** Three.js Normalized Device Coordinates [-1, 1] */
  ndc: ScreenPoint;
  /** Normalized mirrored coordinates [0, 1] */
  normalizedMirrored: ScreenPoint;
}

/**
 * Maps normalized fingertip coordinates to viewport pixel space and Three.js NDC.
 * Accounts for horizontal webcam mirroring and clamps to viewport bounds.
 * Pure decoupled function for high-performance execution and automated testing.
 */
export function projectFingertipToScreen(
  landmark: { x: number; y: number } | null | undefined,
  viewport: ViewportDimensions,
  mirrorX: boolean = true
): ProjectedCursorCoordinates | null {
  if (!landmark) return null;
  if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return null;
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) return null;

  const rawX = landmark.x;
  const rawY = landmark.y;

  // Mirror X if requested (matches mirrored webcam preview)
  const mirroredX = mirrorX ? 1.0 - rawX : rawX;
  const normalizedY = rawY;

  // Clamp normalized coordinates to [0, 1]
  const clampedX = Math.max(0, Math.min(1, mirroredX));
  const clampedY = Math.max(0, Math.min(1, normalizedY));

  // Map to viewport pixel coordinates
  const pixelX = clampedX * viewport.width;
  const pixelY = clampedY * viewport.height;

  // Map to Three.js Normalized Device Coordinates [-1, 1]
  // In Three.js NDC: X goes from -1 (left) to +1 (right), Y goes from -1 (bottom) to +1 (top)
  const ndcX = clampedX * 2.0 - 1.0;
  const ndcY = -(clampedY * 2.0 - 1.0);

  return {
    screen: { x: pixelX, y: pixelY },
    ndc: { x: ndcX, y: ndcY },
    normalizedMirrored: { x: clampedX, y: clampedY },
  };
}

export interface VirtualCursorProps {
  /** True if cursor should be displayed */
  visible: boolean;
  /** Screen position in pixels { x, y } */
  position: ScreenPoint | null;
  /** Dwell timer progress normalized from 0.0 to 1.0 */
  dwellProgress?: number;
  /** Name or label of the hovered component, if any */
  hoveredComponentName?: string | null;
  /** Optional custom class name */
  className?: string;
}

export const VirtualCursor: React.FC<VirtualCursorProps> = ({
  visible,
  position,
  dwellProgress = 0,
  hoveredComponentName,
  className = '',
}) => {
  if (!visible || !position) {
    return null;
  }

  const radius = 22;
  const strokeWidth = 3.5;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = Math.max(0, Math.min(1, dwellProgress));
  const strokeDashoffset = circumference - clampedProgress * circumference;
  const isDwelling = clampedProgress > 0;

  return (
    <div
      className={`virtual-cursor-container ${isDwelling ? 'is-dwelling' : ''} ${className}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      aria-hidden="true"
      data-testid="virtual-cursor"
    >
      {/* Outer ambient laser glow halo */}
      <div className="laser-halo" />

      {/* Crosshair precision reticle ticks */}
      <div className="crosshair-tick tick-top" />
      <div className="crosshair-tick tick-bottom" />
      <div className="crosshair-tick tick-left" />
      <div className="crosshair-tick tick-right" />

      {/* Central High-Intensity Laser Dot */}
      <div className={`laser-dot ${isDwelling ? 'dwelling' : ''}`}>
        <div className="laser-core" />
      </div>

      {/* Circular SVG Dwell Progress Ring */}
      {isDwelling && (
        <svg
          className="dwell-svg-ring"
          width="56"
          height="56"
          viewBox="0 0 56 56"
        >
          {/* Background track circle */}
          <circle
            className="dwell-track"
            cx="28"
            cy="28"
            r={radius}
            strokeWidth={strokeWidth}
          />
          {/* Animated active progress circle */}
          <circle
            className="dwell-progress"
            cx="28"
            cy="28"
            r={radius}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
          />
        </svg>
      )}

      {/* Floating Hover Label Tooltip */}
      {hoveredComponentName && (
        <div className="laser-hover-tooltip">
          <span className="tooltip-name">{hoveredComponentName}</span>
          {isDwelling && (
            <span className="tooltip-hint">
              {clampedProgress >= 1.0 ? 'Locked' : `Holding... ${Math.round(clampedProgress * 100)}%`}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default VirtualCursor;
