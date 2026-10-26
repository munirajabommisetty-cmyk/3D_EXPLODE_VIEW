import React from 'react';
import type { GestureRecognitionResult } from '../../types/gestures';
import './GestureBadge.css';

export interface GestureBadgeProps {
  gestureResult: GestureRecognitionResult;
  className?: string;
  compact?: boolean;
}

const GESTURE_ICONS: Record<string, string> = {
  OPEN_PALM: '✋',
  POINTING: '☝️',
  PINCH: '🤏',
  NONE: '⚪',
};

const GESTURE_LABELS: Record<string, string> = {
  OPEN_PALM: 'Open Palm',
  POINTING: 'Pointing',
  PINCH: 'Pinch',
  NONE: 'None',
};

export const GestureBadge: React.FC<GestureBadgeProps> = ({
  gestureResult,
  className = '',
  compact = false,
}) => {
  const { gesture, rawGesture, confidence, isStable, consecutiveFrames } = gestureResult;
  const icon = GESTURE_ICONS[gesture] || '⚪';
  const label = GESTURE_LABELS[gesture] || gesture;
  const percent = Math.round(confidence * 100);

  return (
    <div
      className={`gesture-hud-badge ${gesture.toLowerCase()} ${isStable ? 'stable' : 'settling'} ${
        compact ? 'compact' : ''
      } ${className}`}
      title={`Active Gesture: ${label} (${percent}% confidence, ${consecutiveFrames} frames)`}
    >
      <span className="gesture-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="gesture-details">
        <span className="gesture-name">{label}</span>
        {!compact && (
          <span className="gesture-meta">
            {gesture !== 'NONE' ? (
              <>
                <span className="gesture-confidence">{percent}%</span>
                <span className={`gesture-stability-dot ${isStable ? 'active' : 'pending'}`} />
                <span className="gesture-stability-text">
                  {isStable ? 'STABLE' : `HOLD (${consecutiveFrames}/3)`}
                </span>
              </>
            ) : rawGesture !== 'NONE' ? (
              <span className="gesture-settling-text">DETECTING...</span>
            ) : (
              <span className="gesture-idle-text">NO GESTURE</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
};

export default GestureBadge;
