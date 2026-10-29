import React from 'react';
import { GestureBadge } from '../hud/GestureBadge';
import { Icon } from '../ui/Icon';
import type { GestureRecognitionResult } from '../../types/gestures';
import type { CameraStatus } from '../../hooks/useCamera';
import './WorkspaceLayout.css';

export interface WorkspaceTopBarProps {
  /** Name of the currently loaded model */
  modelName: string;
  /** Engineering domain for the model */
  domain?: 'mechanical' | 'civil' | 'medical';
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
  /** Reassemble the exploded model (sends assembly.restore through the command dispatcher). */
  onReassemble?: () => void;
  /** Open the "More" menu initially (tests and stories). */
  defaultMenuOpen?: boolean;
  /** Show development-only items (project roadmap). Defaults to development builds. */
  showDevTools?: boolean;
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
  isRightDockOpen,
  onToggleRightDock,
  cameraStatus,
  activeGesture,
  onNavigateHome,
  explodedFactor = 0,
  onReassemble,
}) => {
  const gestureLive = cameraStatus === 'active' && activeGesture && activeGesture.gesture !== 'NONE';
  const mode = cameraStatus === 'active'
    ? { key: 'camera', icon: 'camera' as const, text: 'Camera on', hint: 'Hand tracking is on: show your hand to use gestures' }
    : { key: 'mouse', icon: 'mouse' as const, text: 'Mouse & voice', hint: 'Camera off: use the mouse, keyboard and voice' };

  // Learner-facing bar: where you are, how you are interacting, the assembly state and part
  // information. The parts tree ( [ ), guided lesson ( L ), gesture diagnostics ( D ) and every
  // voice command still work as before.
  return (
    <header className="workspace-top-bar" aria-label="Explorer toolbar">
      <div className="top-bar-branding">
        {onNavigateHome ? (
          <button
            type="button"
            className="toolbar-btn catalogue-btn"
            onClick={onNavigateHome}
            title="Back to all models"
            aria-label="Back to all models"
          >
            <Icon name="arrowLeft" />
            <span className="btn-label">All models</span>
          </button>
        ) : (
          <div className="brand-badge"><span className="brand-name">GestureLab</span></div>
        )}
        <span className="top-bar-sep" aria-hidden="true" />
        <nav className="workspace-breadcrumbs" aria-label="Current model">
          <span className={`domain-tag ${domain}`}>
            {domain === 'mechanical' ? 'Mechanical' : domain === 'medical' ? 'Anatomy' : 'Civil'}
          </span>
          <span className="breadcrumb-model" title={`${modelName} — ${subsystem}`}>
            {modelName}
          </span>
        </nav>
      </div>

      <div className="top-bar-controls">
        {/* Interaction mode: live gesture (with real confidence) when one is recognised */}
        <div className="top-bar-telemetry">
          {gestureLive ? (
            <div className="telemetry-gesture-badge">
              <GestureBadge gestureResult={activeGesture} compact />
            </div>
          ) : (
            <span className={`mode-chip mode-${mode.key}`} role="status" title={mode.hint} aria-label={`Interaction mode: ${mode.hint}`}>
              <Icon name={mode.icon} size={14} />
              <span className="btn-label">{mode.text}</span>
            </span>
          )}
        </div>

        {explodedFactor > 0 && (
          <div className="exploded-state" role="status">
            <span className="exploded-state-label">
              <Icon name="explode" size={14} />
              <span className="btn-label">Exploded view</span>
            </span>
            {onReassemble && (
              <button
                type="button"
                className="toolbar-btn reassemble-btn"
                onClick={onReassemble}
                aria-label="Reassemble the model"
                title="Put the parts back together (X, voice “put it back together”, or pinch both hands)"
              >
                <Icon name="collapse" size={14} />
                <span className="btn-label">Reassemble</span>
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          className={`toolbar-btn info-btn ${isRightDockOpen ? 'active' : ''}`}
          onClick={onToggleRightDock}
          aria-pressed={isRightDockOpen}
          aria-label={isRightDockOpen ? 'Hide part information' : 'Show part information'}
          title={isRightDockOpen ? 'Hide part information ( ] )' : 'Show part information ( ] )'}
        >
          <Icon name="panel" />
          <span className="btn-label">Part info</span>
        </button>
      </div>
    </header>
  );
};

export default WorkspaceTopBar;
