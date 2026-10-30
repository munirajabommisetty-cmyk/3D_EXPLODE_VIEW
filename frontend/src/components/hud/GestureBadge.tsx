import React from 'react';
import type { GestureRecognitionResult } from '../../types/gestures';
import { Icon } from '../ui/Icon';
import { gestureIcon } from '../ui/gestureIcon';
import './GestureBadge.css';

export interface GestureBadgeProps {
  gestureResult: GestureRecognitionResult;
  className?: string;
  compact?: boolean;
}

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
  const label = GESTURE_LABELS[gesture] || gesture;
  const percent = Math.round(confidence * 100);

  return (
    <div
      className={`gesture-hud-badge ${gesture.toLowerCase()} ${isStable ? 'stable' : 'settling'} ${
        compact ? 'compact' : ''
      } ${className}`}
      title={`Gesture: ${label} (${percent}% confidence, ${consecutiveFrames} frames)`}
      role="status"
      aria-label={gesture === 'NONE' ? 'No gesture recognised' : `Gesture: ${label}, ${percent}% confidence`}
    >
      <span className="gesture-icon" aria-hidden="true">
        <Icon name={gestureIcon(gesture)} size={compact ? 14 : 16} />
      </span>
      <div className="gesture-details">
        <span className="gesture-name">{label}</span>
        {compact && gesture !== 'NONE' && <span className="gesture-confidence">{percent}%</span>}
        {!compact && (
          <span className="gesture-meta">
            {gesture !== 'NONE' ? (
              <>
                <span className="gesture-confidence">{percent}%</span>
                <span className={`gesture-stability-dot ${isStable ? 'active' : 'pending'}`} />
                <span className="gesture-stability-text">
                  {isStable ? 'Stable' : `Hold ${consecutiveFrames}/3`}
                </span>
              </>
            ) : rawGesture !== 'NONE' ? (
              <span className="gesture-settling-text">Detecting…</span>
            ) : (
              <span className="gesture-idle-text">No gesture</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
};

export default GestureBadge;
