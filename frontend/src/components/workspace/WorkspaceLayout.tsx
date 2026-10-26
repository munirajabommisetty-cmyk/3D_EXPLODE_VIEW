import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WorkspaceTopBar } from './WorkspaceTopBar';
import { AssemblyTreePanel } from './AssemblyTreePanel';
import { getDescendantComponentIds } from '../../utils/assemblyTreeUtils';
import { ViewerCanvas } from '../scene/ViewerCanvas';
import { WebcamPreview } from '../hud/WebcamPreview';
import { EngineeringInspectorPanel } from './EngineeringInspectorPanel';
import { GestureDiagnosticPanel } from '../hud/GestureDiagnosticPanel';
import { modelRegistry } from '../../models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../../models/mechanical/planetaryGearboxModel';
import { getGuidedLessonForModel, type GuidedLesson } from '../../data/guidedLessons';
import { GuidedLearningPanel } from './GuidedLearningPanel';
import type { UseCameraReturn } from '../../hooks/useCamera';
import type { GestureRecognitionResult } from '../../types/gestures';
import type { HandLandmarkResult } from '../../types/landmarks';
import type { ModuleStatus } from '../../types/app';
import type { EngineeringModelDefinition, AssemblyTreeNode } from '../../types/models';
import './WorkspaceLayout.css';

export interface WorkspaceLayoutProps {
  /** Active model identifier to mount in the 3D viewport */
  activeModelId?: string;
  /** Current render frame rate */
  renderFps: number;
  /** Callback when render FPS updates */
  onFpsUpdate?: (fps: number) => void;
  /** Camera management service hook */
  camera: UseCameraReturn;
  /** Current gesture recognition result */
  activeGesture: GestureRecognitionResult | null;
  /** Callback when gesture state updates */
  onGestureChange: (gesture: GestureRecognitionResult | null) => void;
  /** Current detected hand landmarks */
  detectedHands: HandLandmarkResult[];
  /** Callback when hand landmarks update */
  onHandsDetected: (hands: HandLandmarkResult[]) => void;
  /** Currently selected component ID */
  selectedComponentId: string | null;
  /** Callback when a component is selected or deselected */
  onSelectComponent: (id: string | null) => void;
  /** Whether the diagnostic telemetry panel is open */
  showDiagnostics: boolean;
  /** Toggle callback for diagnostics panel */
  onToggleDiagnostics: () => void;
  /** Whether the project roadmap drawer is open */
  showRoadmap: boolean;
  /** Toggle callback for roadmap drawer */
  onToggleRoadmap: () => void;
  /** List of roadmap modules */
  modules?: ModuleStatus[];
  /** Optional handler to navigate back to the Engineering Explorer catalogue dashboard */
  onNavigateHome?: () => void;
}

/**
 * CAD-Style Technical Workspace Shell (Task 9.4)
 * Provides a responsive layout with top toolbar, collapsible assembly dock,
 * central flex-1 3D viewport, collapsible engineering inspector, and status telemetry.
 */
export const WorkspaceLayout: React.FC<WorkspaceLayoutProps> = ({
  activeModelId = PLANETARY_GEARBOX_MODEL_ID,
  renderFps,
  onFpsUpdate,
  camera,
  activeGesture,
  onGestureChange,
  detectedHands,
  onHandsDetected,
  selectedComponentId,
  onSelectComponent,
  showDiagnostics,
  onToggleDiagnostics,
  showRoadmap,
  onToggleRoadmap,
  modules,
  onNavigateHome,
}) => {
  // Collapsible dock state (defaulting to open on desktop)
  const [isLeftDockOpen, setIsLeftDockOpen] = useState<boolean>(true);
  const [isRightDockOpen, setIsRightDockOpen] = useState<boolean>(true);
  const [hiddenComponentIds, setHiddenComponentIds] = useState<Set<string>>(new Set());

  // Exploded view state
  const [explodedFactor, setExplodedFactor] = useState<number>(0);

  // Guided learning tour state
  const [isGuidedTourActive, setIsGuidedTourActive] = useState<boolean>(false);
  const [currentTourStep, setCurrentTourStep] = useState<number>(0);
  const [previousSelectionBeforeTour, setPreviousSelectionBeforeTour] = useState<{
    modelId: string;
    componentId: string | null;
  } | null>(null);

  // Model switching reconciliation: reset hidden components, selection, tour, and exploded factor
  const prevModelIdRef = useRef(activeModelId);
  useEffect(() => {
    if (prevModelIdRef.current !== activeModelId) {
      prevModelIdRef.current = activeModelId;
      setHiddenComponentIds(new Set());
      onSelectComponent(null);
      setExplodedFactor(0);
      setIsGuidedTourActive(false);
      setCurrentTourStep(0);
      setPreviousSelectionBeforeTour(null);
    }
  }, [activeModelId, onSelectComponent]);

  // Open right dock on component selection event
  const handleSelectComponent = useCallback(
    (id: string | null) => {
      if (id !== null) {
        setIsRightDockOpen(true);
      }
      onSelectComponent(id);
    },
    [onSelectComponent]
  );

  // Toggle component/assembly visibility in 3D viewport
  const handleToggleVisibility = useCallback((node: AssemblyTreeNode) => {
    setHiddenComponentIds((prev) => {
      const next = new Set(prev);
      const descendantIds = getDescendantComponentIds(node);
      if (descendantIds.length === 0) return prev;

      const allHidden = descendantIds.every((id) => next.has(id));
      if (allHidden) {
        descendantIds.forEach((id) => next.delete(id));
      } else {
        descendantIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, []);

  // Resolve active model definition from registry
  const activeModel: EngineeringModelDefinition | undefined =
    modelRegistry.getModel(activeModelId) ||
    modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);

  const assemblyTree = activeModel ? activeModel.getAssemblyTree() : null;
  const modelName = activeModel?.name || 'Planetary Gearbox Assembly';
  const domain = activeModel?.domain || 'mechanical';
  const subsystem = assemblyTree?.name || 'Epicyclic Powertrain';

  // Active guided lesson curriculum for current model
  const activeLesson: GuidedLesson | null = getGuidedLessonForModel(activeModelId);

  // Exploded view factor change handler
  const handleExplodedFactorChange = useCallback((factor: number) => {
    setExplodedFactor(Math.max(0, Math.min(1, factor)));
  }, []);

  // Exit guided tour safely and restore prior selection if valid
  const handleExitGuidedTour = useCallback(() => {
    setIsGuidedTourActive(false);
    if (
      previousSelectionBeforeTour &&
      previousSelectionBeforeTour.modelId === activeModelId &&
      previousSelectionBeforeTour.componentId !== null
    ) {
      const validIds = activeModel ? activeModel.getAllComponentIds() : [];
      if (validIds.includes(previousSelectionBeforeTour.componentId)) {
        onSelectComponent(previousSelectionBeforeTour.componentId);
      } else {
        onSelectComponent(null);
      }
    } else {
      onSelectComponent(null);
    }
    setPreviousSelectionBeforeTour(null);
  }, [previousSelectionBeforeTour, activeModelId, activeModel, onSelectComponent]);

  // Start guided tour with previous selection capture
  const handleStartGuidedTour = useCallback(() => {
    if (!activeLesson || activeLesson.steps.length === 0) return;
    setPreviousSelectionBeforeTour({
      modelId: activeModelId,
      componentId: selectedComponentId,
    });
    setCurrentTourStep(0);
    setIsGuidedTourActive(true);
    onSelectComponent(activeLesson.steps[0].componentId);
  }, [activeLesson, activeModelId, selectedComponentId, onSelectComponent]);

  // Switch tour step and sync viewport/tree/inspector selection
  const handleTourStepChange = useCallback(
    (stepIndex: number) => {
      if (!activeLesson) return;
      const clampedIndex = Math.max(0, Math.min(activeLesson.steps.length - 1, stepIndex));
      setCurrentTourStep(clampedIndex);
      const step = activeLesson.steps[clampedIndex];
      if (step) {
        onSelectComponent(step.componentId);
      }
    },
    [activeLesson, onSelectComponent]
  );

  // Toggle guided tour
  const handleToggleGuidedTour = useCallback(() => {
    if (isGuidedTourActive) {
      handleExitGuidedTour();
    } else {
      handleStartGuidedTour();
    }
  }, [isGuidedTourActive, handleExitGuidedTour, handleStartGuidedTour]);

  // Wrapped home navigation: restore assembled state and tour before leaving
  const handleNavigateHomeWrapped = useCallback(() => {
    setExplodedFactor(0);
    setIsGuidedTourActive(false);
    setPreviousSelectionBeforeTour(null);
    if (onNavigateHome) {
      onNavigateHome();
    }
  }, [onNavigateHome]);

  // Keyboard shortcuts for dock toggles, exploded view, and guided tour
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea') return;

      if (e.key === '[') {
        e.preventDefault();
        setIsLeftDockOpen((prev) => !prev);
      } else if (e.key === ']') {
        e.preventDefault();
        setIsRightDockOpen((prev) => !prev);
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        setExplodedFactor((prev) => (prev > 0 ? 0 : 0.75));
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        handleToggleGuidedTour();
      }
    },
    [handleToggleGuidedTour]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const hasActiveHand =
    camera.status === 'active' && detectedHands.length > 0;

  return (
    <div className="cad-workspace-shell">
      {/* 1. Top CAD Navigation & Telemetry Toolbar */}
      <WorkspaceTopBar
        modelName={modelName}
        domain={domain}
        subsystem={subsystem}
        isLeftDockOpen={isLeftDockOpen}
        onToggleLeftDock={() => setIsLeftDockOpen((prev) => !prev)}
        isRightDockOpen={isRightDockOpen}
        onToggleRightDock={() => setIsRightDockOpen((prev) => !prev)}
        renderFps={renderFps}
        cameraStatus={camera.status}
        activeGesture={activeGesture}
        showDiagnostics={showDiagnostics}
        onToggleDiagnostics={onToggleDiagnostics}
        showRoadmap={showRoadmap}
        onToggleRoadmap={onToggleRoadmap}
        onNavigateHome={handleNavigateHomeWrapped}
        explodedFactor={explodedFactor}
        onExplodedFactorChange={handleExplodedFactorChange}
        isGuidedTourActive={isGuidedTourActive}
        onToggleGuidedTour={handleToggleGuidedTour}
      />

      {/* 2. Workspace Body (Left Dock + Center Viewport + Right Dock) */}
      <div className="workspace-main-area">
        {/* Left Dock: Assembly Hierarchy & Guided Curriculum Container */}
        <aside
          className={`cad-dock cad-dock-left ${isLeftDockOpen ? 'open' : 'collapsed'}`}
          aria-label="Assembly Hierarchy Dock"
          aria-hidden={!isLeftDockOpen}
        >
          <div className="dock-header">
            <div className="dock-title-group">
              <span className="dock-icon" aria-hidden="true">
                🗂️
              </span>
              <h2 className="dock-title">Assembly Hierarchy</h2>
            </div>
            <button
              type="button"
              className="dock-collapse-btn"
              onClick={() => setIsLeftDockOpen(false)}
              title="Collapse Assembly Hierarchy Dock (Key: [)"
              aria-label="Collapse Assembly Hierarchy Dock"
            >
              ◀
            </button>
          </div>

          <div className="dock-content">
            <AssemblyTreePanel
              rootNode={assemblyTree}
              selectedComponentId={selectedComponentId}
              onSelectComponent={handleSelectComponent}
              hiddenComponentIds={hiddenComponentIds}
              onToggleVisibility={handleToggleVisibility}
            />
          </div>
        </aside>

        {/* Central 3D Viewport (Flex-1) */}
        <main className="cad-viewport-center" aria-label="3D Viewport">
          <div className="viewport-inner">
            <ViewerCanvas
              modelId={activeModelId}
              onFpsUpdate={onFpsUpdate}
              gestureResult={activeGesture}
              hands={detectedHands}
              selectedComponentId={selectedComponentId}
              onSelectComponent={handleSelectComponent}
              hiddenComponentIds={hiddenComponentIds}
              explodedFactor={explodedFactor}
              onExplodedFactorChange={handleExplodedFactorChange}
            />

            {/* Guided Learning Panel Overlay */}
            {isGuidedTourActive && activeLesson && (
              <GuidedLearningPanel
                lesson={activeLesson}
                currentStepIndex={currentTourStep}
                onStepChange={handleTourStepChange}
                onExit={handleExitGuidedTour}
              />
            )}

            {/* Floating Webcam PiP Preview (Bottom-Left) */}
            <WebcamPreview
              camera={camera}
              onGestureChange={onGestureChange}
              onHandsDetected={onHandsDetected}
            />

            {/* Gesture Diagnostics Overlay Panel */}
            <GestureDiagnosticPanel
              isOpen={showDiagnostics}
              onToggle={onToggleDiagnostics}
            />

            {/* Slide-over Project Roadmap Overlay */}
            {showRoadmap && modules && (
              <aside className="roadmap-overlay" aria-label="Project Roadmap Drawer">
                <div className="roadmap-header">
                  <h2>Project Modules &amp; Phases</h2>
                  <button
                    type="button"
                    className="close-btn"
                    onClick={onToggleRoadmap}
                    aria-label="Close Roadmap Drawer"
                  >
                    ✕
                  </button>
                </div>
                <div className="roadmap-list">
                  {modules.map((mod) => (
                    <div key={mod.id} className={`roadmap-card ${mod.status}`}>
                      <div className="card-header">
                        <span className="card-title">{mod.name}</span>
                        <span className={`card-badge ${mod.status}`}>
                          {mod.status === 'active'
                            ? 'Active'
                            : mod.status === 'ready_next'
                            ? 'Next Task'
                            : 'Pending'}
                        </span>
                      </div>
                      <div className="card-phase">{mod.phase}</div>
                      <p className="card-desc">{mod.description}</p>
                    </div>
                  ))}
                </div>
              </aside>
            )}
          </div>
        </main>

        {/* Right Dock: Engineering Inspector Container */}
        <aside
          className={`cad-dock cad-dock-right ${isRightDockOpen ? 'open' : 'collapsed'}`}
          aria-label="Engineering Inspector Dock"
          aria-hidden={!isRightDockOpen}
        >
          <div className="dock-header">
            <button
              type="button"
              className="dock-collapse-btn"
              onClick={() => setIsRightDockOpen(false)}
              title="Collapse Engineering Inspector Dock (Key: ])"
              aria-label="Collapse Engineering Inspector Dock"
            >
              ▶
            </button>
            <div className="dock-title-group">
              <span className="dock-icon" aria-hidden="true">
                🔬
              </span>
              <h2 className="dock-title">Engineering Inspector</h2>
            </div>
          </div>

          <div className="dock-content">
            <div className="dock-inspector-wrapper">
              <EngineeringInspectorPanel
                componentId={selectedComponentId}
                activeModel={activeModel}
                onClose={() => handleSelectComponent(null)}
              />
            </div>
          </div>
        </aside>
      </div>

      {/* 3. Bottom Status / Telemetry Area */}
      <footer className="workspace-status-bar" aria-label="Workspace Status">
        {/* Modality Status Indicator */}
        <div className="status-modality">
          <span
            className={`modality-dot ${hasActiveHand ? 'gesture' : 'mouse'}`}
            aria-hidden="true"
          />
          <span className="modality-text">
            {hasActiveHand
              ? `Gesture Active (${detectedHands.length} hand${detectedHands.length > 1 ? 's' : ''})`
              : camera.status === 'active'
              ? 'Gesture Ready (Awaiting Hand)'
              : 'Mouse Orbit & Click Fallback'}
          </span>
        </div>

        {/* Gesture Cheat Sheet Hint */}
        <div className="status-gesture-hints">
          <span className="hint-item">
            <strong>🖐</strong> Orbit
          </span>
          <span className="hint-sep">|</span>
          <span className="hint-item">
            <strong>🤏</strong> Zoom
          </span>
          <span className="hint-sep">|</span>
          <span className="hint-item">
            <strong>☝</strong> Point &amp; Dwell
          </span>
          <span className="hint-sep">|</span>
          <span className="hint-item">
            <strong>[ / ]</strong> Docks
          </span>
        </div>

        {/* Right Status Info */}
        <div className="status-meta">
          <span className="meta-item">Phase 9: CAD Workspace Shell</span>
          <span className="meta-sep">•</span>
          <span className="meta-item">{modelName}</span>
        </div>
      </footer>
    </div>
  );
};

export default WorkspaceLayout;
