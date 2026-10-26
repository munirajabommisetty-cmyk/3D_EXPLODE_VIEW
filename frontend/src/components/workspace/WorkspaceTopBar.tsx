import React from 'react';
import { GestureBadge } from '../hud/GestureBadge';
import type { GestureRecognitionResult } from '../../types/gestures';
import type { CameraStatus } from '../../hooks/useCamera';
import './WorkspaceLayout.css';

export interface WorkspaceTopBarProps {
  /** Name of the currently loaded model */
  modelName: string;
  /** Engineering domain for the model */
  domain?: 'mechanical' | 'civil';
  /** Optional subsystem or category breadcrumb */
  subsystem?: string;
  /** Whether the left assembly hierarchy dock is open */
  isLeftDockOpen: boolean;
  /** Toggle callback for left assembly dock */
  onToggleLeftDock: () => void;
  /** Whether the right engineering inspector dock is open */
  isRightDockOpen: boolean;
  /** Toggle callback for right engineering inspector dock */
  onToggleRightDock: () => void;
  /** Real-time WebGL render frame rate */
  renderFps: number;
  /** Current camera tracking service status */
  cameraStatus: CameraStatus;
  /** Currently recognized gesture result, if available */
  activeGesture?: GestureRecognitionResult | null;
  /** Whether the gesture diagnostics panel is open */
  showDiagnostics: boolean;
  /** Toggle callback for diagnostics panel */
  onToggleDiagnostics: () => void;
  /** Whether the project roadmap drawer is open */
  showRoadmap: boolean;
  /** Toggle callback for roadmap drawer */
  onToggleRoadmap: () => void;
  /** Optional handler to trigger camera viewpoint reset */
  onResetView?: () => void;
  /** Optional handler to return to the Engineering Explorer catalogue dashboard */
  onNavigateHome?: () => void;
  /** Current continuous exploded factor (0.0 to 1.0) */
  explodedFactor?: number;
  /** Callback to change exploded view factor */
  onExplodedFactorChange?: (factor: number) => void;
  /** Whether guided tour mode is active */
  isGuidedTourActive?: boolean;
  /** Toggle callback for guided tour */
  onToggleGuidedTour?: () => void;
}

/**
 * Top Toolbar for the CAD-Style Technical Workspace
 * Provides workspace identity, model breadcrumbs, dock toggle buttons,
 * and live system telemetry without nonfunctional controls.
 */
export const WorkspaceTopBar: React.FC<WorkspaceTopBarProps> = ({
  modelName,
  domain = 'mechanical',
  subsystem = 'Powertrain',
  isLeftDockOpen,
  onToggleLeftDock,
  isRightDockOpen,
  onToggleRightDock,
  renderFps,
  cameraStatus,
  activeGesture,
  showDiagnostics,
  onToggleDiagnostics,
  showRoadmap,
  onToggleRoadmap,
  onResetView,
  onNavigateHome,
  explodedFactor = 0,
  onExplodedFactorChange,
  isGuidedTourActive = false,
  onToggleGuidedTour,
}) => {
  return (
    <header className="workspace-top-bar" aria-label="CAD Workspace Toolbar">
      {/* Brand Identity & Breadcrumbs */}
      <div className="top-bar-branding">
        <div className="brand-badge">
          <span className="brand-icon" aria-hidden="true">
            ⚙️
          </span>
          <span className="brand-name">GestureLab CAD</span>
        </div>

        <span className="breadcrumb-separator" aria-hidden="true">
          /
        </span>

        <nav className="workspace-breadcrumbs" aria-label="Breadcrumb Navigation">
          <span className={`domain-tag ${domain}`}>
            {domain === 'mechanical' ? 'Mechanical' : 'Civil'}
          </span>
          <span className="breadcrumb-separator" aria-hidden="true">
            &gt;
          </span>
          <span className="breadcrumb-subsystem">{subsystem}</span>
          <span className="breadcrumb-separator" aria-hidden="true">
            &gt;
          </span>
          <span className="breadcrumb-model" title={modelName}>
            {modelName}
          </span>
        </nav>
      </div>

      {/* Primary Workspace Action Controls */}
      <div className="top-bar-controls">
        {/* Navigate to Catalogue Dashboard */}
        {onNavigateHome && (
          <button
            type="button"
            className="toolbar-btn catalogue-btn"
            onClick={onNavigateHome}
            title="Return to Engineering Explorer Catalogue Dashboard"
            aria-label="Return to Engineering Explorer Catalogue Dashboard"
          >
            <span className="btn-icon" aria-hidden="true">
              🏠
            </span>
            <span className="btn-label">Catalogue</span>
          </button>
        )}

        {/* Toggle Left Dock (Assembly Tree) */}
        <button
          type="button"
          className={`toolbar-btn ${isLeftDockOpen ? 'active' : ''}`}
          onClick={onToggleLeftDock}
          title={isLeftDockOpen ? 'Collapse Assembly Tree (Key: [)' : 'Expand Assembly Tree (Key: [)'}
          aria-label={isLeftDockOpen ? 'Collapse Assembly Hierarchy Dock' : 'Expand Assembly Hierarchy Dock'}
          aria-expanded={isLeftDockOpen}
        >
          <span className="btn-icon" aria-hidden="true">
            {isLeftDockOpen ? '◀' : '▶'}
          </span>
          <span className="btn-label">Assembly</span>
        </button>

        {/* Reset Camera View Button (if handler provided) */}
        {onResetView && (
          <button
            type="button"
            className="toolbar-btn"
            onClick={onResetView}
            title="Reset camera viewpoint to isometric preset [Key: R]"
            aria-label="Reset Camera View"
          >
            <span className="btn-icon" aria-hidden="true">
              ⟲
            </span>
            <span className="btn-label">Reset View</span>
          </button>
        )}

        {/* Guided Tour / Learn Button */}
        {onToggleGuidedTour && (
          <button
            type="button"
            className={`toolbar-btn ${isGuidedTourActive ? 'active' : ''}`}
            onClick={onToggleGuidedTour}
            title={isGuidedTourActive ? 'Exit Guided Tour [Esc]' : 'Start Interactive Guided Tour [Key: L]'}
            aria-label={isGuidedTourActive ? 'Exit Guided Tour' : 'Start Interactive Guided Tour'}
          >
            <span className="btn-icon" aria-hidden="true">
              🎓
            </span>
            <span className="btn-label">{isGuidedTourActive ? 'Exit Tour' : 'Guided Tour'}</span>
          </button>
        )}

        {/* Exploded View Toggle Button */}
        {onExplodedFactorChange && (
          <button
            type="button"
            className={`toolbar-btn ${explodedFactor > 0 ? 'active' : ''}`}
            onClick={() => onExplodedFactorChange(explodedFactor > 0 ? 0 : 0.6)}
            title={
              explodedFactor > 0
                ? 'Assemble Model to 0% [Key: X]'
                : 'Explode Model Components [Key: X]'
            }
            aria-label={
              explodedFactor > 0 ? 'Assemble Model' : 'Explode Model Components'
            }
          >
            <span className="btn-icon" aria-hidden="true">
              💥
            </span>
            <span className="btn-label">
              {explodedFactor > 0 ? `Exploded (${Math.round(explodedFactor * 100)}%)` : 'Exploded'}
            </span>
          </button>
        )}

        {/* Toggle Diagnostics Panel */}
        <button
          type="button"
          className={`toolbar-btn ${showDiagnostics ? 'active' : ''}`}
          onClick={onToggleDiagnostics}
          title="Toggle Gesture Diagnostics Panel [Key: D]"
          aria-label="Toggle Gesture Diagnostics Panel"
          aria-expanded={showDiagnostics}
        >
          <span className="btn-icon" aria-hidden="true">
            📊
          </span>
          <span className="btn-label">Diagnostics</span>
        </button>

        {/* Toggle Roadmap Drawer */}
        <button
          type="button"
          className={`toolbar-btn ${showRoadmap ? 'active' : ''}`}
          onClick={onToggleRoadmap}
          title="Toggle Project Roadmap Panel"
          aria-label="Toggle Project Roadmap Panel"
          aria-expanded={showRoadmap}
        >
          <span className="btn-icon" aria-hidden="true">
            🗺️
          </span>
          <span className="btn-label">Roadmap</span>
        </button>

        {/* Toggle Right Dock (Inspector) */}
        <button
          type="button"
          className={`toolbar-btn ${isRightDockOpen ? 'active' : ''}`}
          onClick={onToggleRightDock}
          title={isRightDockOpen ? 'Collapse Inspector (Key: ])' : 'Expand Inspector (Key: ])'}
          aria-label={isRightDockOpen ? 'Collapse Engineering Inspector Dock' : 'Expand Engineering Inspector Dock'}
          aria-expanded={isRightDockOpen}
        >
          <span className="btn-label">Inspector</span>
          <span className="btn-icon" aria-hidden="true">
            {isRightDockOpen ? '▶' : '◀'}
          </span>
        </button>
      </div>

      {/* Live System Telemetry Indicators */}
      <div className="top-bar-telemetry">
        {/* Render FPS Pill */}
        <div className="telemetry-pill" title="Live WebGL Render Frame Rate">
          <span className="telemetry-dot" aria-hidden="true" />
          <span className="telemetry-label">Render:</span>
          <span className="telemetry-value">{renderFps} FPS</span>
        </div>

        {/* Camera Service Status Pill */}
        <div className={`camera-pill ${cameraStatus}`} title={`Webcam tracking status: ${cameraStatus}`}>
          <span className={`cam-indicator ${cameraStatus}`} aria-hidden="true" />
          <span className="camera-label">
            {cameraStatus === 'active'
              ? 'Camera: Live'
              : cameraStatus === 'requesting'
              ? 'Camera: Connecting...'
              : cameraStatus === 'denied'
              ? 'Camera: Denied'
              : cameraStatus === 'not_found'
              ? 'Camera: None'
              : 'Camera: Off'}
          </span>
        </div>

        {/* Compact Gesture Badge (when camera is live and gesture active) */}
        {cameraStatus === 'active' && activeGesture && (
          <div className="telemetry-gesture-badge">
            <GestureBadge gestureResult={activeGesture} compact />
          </div>
        )}
      </div>
    </header>
  );
};
