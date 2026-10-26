import React, { useState, useEffect } from 'react';
import { useCamera, type UseCameraReturn } from '../../hooks/useCamera';
import { useHandLandmarker } from '../../hooks/useHandLandmarker';
import { useGestureRecognition } from '../../hooks/useGestureRecognition';
import { SkeletonOverlay } from './SkeletonOverlay';
import { GestureBadge } from './GestureBadge';
import type { HandLandmarkResult } from '../../types/landmarks';
import type { GestureRecognitionResult } from '../../types/gestures';
import './WebcamPreview.css';

interface WebcamPreviewProps {
  camera?: UseCameraReturn;
  className?: string;
  onHandsDetected?: (hands: HandLandmarkResult[]) => void;
  onGestureChange?: (gesture: GestureRecognitionResult) => void;
}

export const WebcamPreview: React.FC<WebcamPreviewProps> = ({
  camera: externalCamera,
  className,
  onHandsDetected,
  onGestureChange,
}) => {
  // Use externally passed camera hook if provided, otherwise initialize internal hook
  const internalCamera = useCamera();
  const camera = externalCamera || internalCamera;

  const [isMinimized, setIsMinimized] = useState<boolean>(false);

  const { status, errorMessage, startCamera, stopCamera, videoRef } = camera;

  const isStreaming = status === 'active';
  const isRequesting = status === 'requesting';

  // Initialize MediaPipe HandLandmarker when camera stream is active
  const handTracker = useHandLandmarker({
    videoRef,
    isCameraActive: isStreaming,
  });

  // Recognize geometric gestures with temporal hysteresis from detected hands
  const { primaryGesture } = useGestureRecognition({
    hands: handTracker.hands,
  });

  // Notify parent of detected hands if listener was provided
  useEffect(() => {
    if (onHandsDetected) {
      onHandsDetected(handTracker.hands);
    }
  }, [handTracker.hands, onHandsDetected]);

  // Notify parent of recognized gesture if listener was provided
  useEffect(() => {
    if (onGestureChange) {
      onGestureChange(primaryGesture);
    }
  }, [primaryGesture, onGestureChange]);

  return (
    <aside
      className={`webcam-pip-container ${isMinimized ? 'minimized' : ''} ${className || ''}`}
      aria-label="Webcam Preview & Tracking Feed"
    >
      {/* Header bar with title and minimize button */}
      <div className="pip-header">
        <div className="pip-title-group">
          <span className={`pip-status-dot ${status}`} />
          <span className="pip-title">Webcam Feed</span>
        </div>
        <div className="pip-header-actions">
          <button
            type="button"
            className="pip-minimize-btn"
            onClick={() => setIsMinimized((prev) => !prev)}
            title={isMinimized ? 'Expand Webcam Preview' : 'Minimize Webcam Preview'}
            aria-label={isMinimized ? 'Expand Webcam Preview' : 'Minimize Webcam Preview'}
          >
            {isMinimized ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Main Body (hidden when minimized) */}
      {!isMinimized && (
        <div className="pip-body">
          <div className="video-viewport">
            {/* Live Video Element - Horizontally mirrored for natural interaction */}
            <video
              ref={videoRef}
              className={`pip-video ${isStreaming ? 'visible' : 'hidden'}`}
              autoPlay
              playsInline
              muted
              aria-label="Live mirrored webcam stream"
            />

            {/* State Overlay: Idle / Camera Off */}
            {status === 'idle' && (
              <div className="pip-state-overlay idle">
                <div className="state-icon">📷</div>
                <p className="state-title">Camera Disconnected</p>
                <p className="state-desc">Click below to start local webcam tracking</p>
              </div>
            )}

            {/* State Overlay: Requesting Permission */}
            {isRequesting && (
              <div className="pip-state-overlay requesting">
                <div className="pip-spinner" />
                <p className="state-title">Requesting Access...</p>
                <p className="state-desc">Please allow camera access in browser prompt</p>
              </div>
            )}

            {/* State Overlay: Permission Denied */}
            {status === 'denied' && (
              <div className="pip-state-overlay denied">
                <div className="state-icon warning">🚫</div>
                <p className="state-title">Permission Denied</p>
                <p className="state-desc">{errorMessage || 'Camera access blocked in browser'}</p>
              </div>
            )}

            {/* State Overlay: Device Not Found */}
            {status === 'not_found' && (
              <div className="pip-state-overlay not-found">
                <div className="state-icon warning">🔌</div>
                <p className="state-title">No Camera Found</p>
                <p className="state-desc">{errorMessage || 'Connect a webcam to continue'}</p>
              </div>
            )}

            {/* State Overlay: Hardware Unavailable */}
            {status === 'unavailable' && (
              <div className="pip-state-overlay unavailable">
                <div className="state-icon warning">⚠️</div>
                <p className="state-title">Camera In Use</p>
                <p className="state-desc">{errorMessage || 'Camera is in use by another application'}</p>
              </div>
            )}

            {/* State Overlay: Unsupported API */}
            {status === 'unsupported' && (
              <div className="pip-state-overlay unsupported">
                <div className="state-icon warning">❌</div>
                <p className="state-title">Unsupported Browser</p>
                <p className="state-desc">{errorMessage || 'MediaDevices API not supported'}</p>
              </div>
            )}

            {/* State Overlay: General Error */}
            {status === 'error' && (
              <div className="pip-state-overlay error">
                <div className="state-icon warning">⚠️</div>
                <p className="state-title">Camera Error</p>
                <p className="state-desc">{errorMessage || 'An error occurred'}</p>
              </div>
            )}

            {/* Live Indicator Pill (shown only when active) */}
            {isStreaming && (
              <div className="pip-live-badge" aria-label="Webcam active badge">
                <span className="live-dot" /> LIVE (MIRRORED)
              </div>
            )}

            {/* Gesture Recognition Badge (top-right of preview) */}
            {isStreaming && (
              <div className="pip-gesture-overlay">
                <GestureBadge gestureResult={primaryGesture} compact />
              </div>
            )}

            {/* MediaPipe 21-point Hand Skeleton & Telemetry Overlay */}
            {isStreaming && (
              <SkeletonOverlay
                hands={handTracker.hands}
                status={handTracker.status}
                trackingFps={handTracker.trackingFps}
              />
            )}

            {/* Tracker initialization error overlay (if tracking fails while camera is active) */}
            {isStreaming && handTracker.status === 'error' && (
              <div className="pip-state-overlay error">
                <div className="state-icon warning">⚠️</div>
                <p className="state-title">Hand Tracker Error</p>
                <p className="state-desc">{handTracker.errorMessage || 'Could not load hand tracking'}</p>
              </div>
            )}
          </div>

          {/* Action Toolbar */}
          <div className="pip-controls">
            {!isStreaming ? (
              <button
                type="button"
                className="pip-action-btn start"
                onClick={startCamera}
                disabled={isRequesting}
                aria-label="Start Webcam Stream"
              >
                {isRequesting ? 'Connecting...' : 'Start Camera'}
              </button>
            ) : (
              <button
                type="button"
                className="pip-action-btn stop"
                onClick={stopCamera}
                aria-label="Stop Webcam Stream"
              >
                Stop Camera
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};

export default WebcamPreview;
