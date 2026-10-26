import React, { useState, useEffect } from 'react';
import { gestureDiagnostics, type GestureDiagnosticData } from '../../utils/telemetry';
import './GestureDiagnosticPanel.css';

export interface GestureDiagnosticPanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

export const GestureDiagnosticPanel: React.FC<GestureDiagnosticPanelProps> = ({
  isOpen,
  onToggle,
}) => {
  const [data, setData] = useState<GestureDiagnosticData>(() => gestureDiagnostics.getSnapshot());
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = gestureDiagnostics.subscribe((latest) => {
      setData(latest);
    });
    return unsubscribe;
  }, []);

  // Listen for 'D' or 'd' keyboard shortcut to toggle panel visibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;
      if (e.key === 'd' || e.key === 'D') {
        onToggle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onToggle]);

  if (!isOpen) return null;

  const getGestureBadgeClass = (g?: string) => {
    switch (g) {
      case 'OPEN_PALM':
        return 'open_palm';
      case 'PINCH':
        return 'pinch';
      case 'POINTING':
        return 'pointing';
      default:
        return 'none';
    }
  };

  const isLive = data.trackingStatus === 'tracking' && data.handsDetected > 0;

  return (
    <div
      className={`gesture-diagnostic-panel ${isCollapsed ? 'collapsed' : ''}`}
      role="region"
      aria-label="Gesture Diagnostics Telemetry"
    >
      <div className="diag-header">
        <div className="diag-title-area">
          <span className={`diag-pulse-dot ${isLive ? 'live' : 'idle'}`} />
          <span className="diag-title">Telemetry</span>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            type="button"
            className="diag-btn"
            onClick={() => setIsCollapsed((prev) => !prev)}
            title={isCollapsed ? 'Expand Panel' : 'Collapse Panel'}
          >
            {isCollapsed ? '+' : '–'}
          </button>
          <button
            type="button"
            className="diag-btn"
            onClick={onToggle}
            title="Close Panel (Press 'D')"
          >
            ✕
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="diag-body">
          <div className="diag-row">
            <span className="diag-label">Hands Detected:</span>
            <span className="diag-val">{data.handsDetected}</span>
          </div>

          <div className="diag-row">
            <span className="diag-label">Tracking Status:</span>
            <span
              className={`diag-val ${
                data.trackingStatus === 'tracking'
                  ? 'diag-status-ok'
                  : data.trackingStatus === 'detecting'
                  ? 'diag-status-warn'
                  : 'diag-status-idle'
              }`}
            >
              {data.trackingStatus.toUpperCase()}
            </span>
          </div>

          <div className="diag-row">
            <span className="diag-label">Candidate (Raw):</span>
            <span className={`diag-badge ${getGestureBadgeClass(data.rawGesture)}`}>
              {data.rawGesture}
            </span>
          </div>

          <div className="diag-row">
            <span className="diag-label">Stabilized Gesture:</span>
            <span className={`diag-badge ${getGestureBadgeClass(data.stableGesture)}`}>
              {data.stableGesture}
            </span>
          </div>

          <div className="diag-row">
            <span className="diag-label">Confidence:</span>
            <span className="diag-val">{Math.round(data.confidence * 100)}%</span>
          </div>

          <div className="diag-row">
            <span className="diag-label">Pinch Distance (norm):</span>
            <span className="diag-val">{data.pinchDistanceNorm.toFixed(3)}</span>
          </div>

          <div className="diag-row">
            <span className="diag-label">Pinch Zoom Engine:</span>
            <span
              className={`diag-val ${data.isPinchActive ? 'diag-status-ok' : 'diag-status-idle'}`}
            >
              {data.isPinchActive ? 'ACTIVE' : 'IDLE'}
            </span>
          </div>

          <div className="diag-row">
            <span className="diag-label">Zoom Delta:</span>
            <span className="diag-val">{data.zoomDelta.toFixed(4)}</span>
          </div>

          <div className="diag-row">
            <span className="diag-label">Camera Distance:</span>
            <span className="diag-val">{data.cameraDistance.toFixed(2)}</span>
          </div>

          {data.rejectionReason && (
            <div className="diag-row diag-rejection-row">
              <span className="diag-label">Last Classifier Reason:</span>
              <span className="diag-rejection-val">{data.rejectionReason}</span>
            </div>
          )}

          <div className="diag-shortcut-hint">Press &apos;D&apos; to toggle this panel</div>
        </div>
      )}
    </div>
  );
};

export default GestureDiagnosticPanel;
