import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WorkspaceTopBar } from './WorkspaceTopBar';
import { Icon } from '../ui/Icon';
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
import { SceneCommandDispatcher, type CommandHandler } from '../../services/commands/sceneCommandDispatcher';
import type { SceneCommand, SceneCommandType } from '../../services/commands/sceneCommands';
import { VoiceDock } from '../voice/VoiceDock';
import { getSceneSnapshot } from '../../services/scene/sceneSnapshot';
import './WorkspaceLayout.css';
// Final design layer (Clean Engineering Workstation): must stay the last stylesheet imported here
import '../ui/workstation.css';

/** Commands owned by the workspace (React state), as opposed to the viewer (Three.js). */
const WORKSPACE_COMMAND_TYPES: ReadonlySet<SceneCommandType> = new Set<SceneCommandType>([
  'component.select', 'component.visibility', 'component.showAll',
  'assembly.explode', 'assembly.restore',
  'lesson.start', 'lesson.next', 'lesson.previous', 'lesson.goTo', 'lesson.exit',
  'workspace.switchModel', 'workspace.goHome',
]);

/** Default separation used by the X shortcut and explode commands without a factor. */
const DEFAULT_EXPLODE_FACTOR = 0.75;

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
  /** Optional handler to open another registered model (enables the workspace.switchModel command) */
  onSwitchModel?: (modelId: string) => void;
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
  onNavigateHome,
  onSwitchModel,
}) => {
  // One shared scene command channel for gestures, keyboard, UI, voice and (later) the AI teacher
  const [commandDispatcher] = useState(() => new SceneCommandDispatcher());
  // Lets the inspector ask the voice tutor (registered by the VoiceDock)
  const voiceAskRef = useRef<((text: string) => void) | null>(null);
  const askTutor = useCallback((text: string) => voiceAskRef.current?.(text), []);

  // Collapsible dock state (defaulting to open on desktop)
  // On narrow screens (≤ 1024 px) the docks overlay the viewport, so they start collapsed and do
  // not cover the model or the voice dock; they open with their buttons or the [ / ] keys.
  // UI pass: the 3D model gets the whole width by default. Parts are picked by pointing, voice or
  // clicking in the model, so the parts list opens only on request ("Parts" / [ key), and the
  // inspector opens by itself when a part is selected (handleSelectComponent).
  const [isLeftDockOpen, setIsLeftDockOpen] = useState<boolean>(false);
  const [isRightDockOpen, setIsRightDockOpen] = useState<boolean>(false);
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

  // Milestone C: the two-hand gesture goes through the same validated dispatcher as voice and keys
  const handleTwoHandGesture = useCallback((action: 'explode' | 'restore') => {
    commandDispatcher.dispatch(
      action === 'explode' ? { type: 'assembly.explode', factor: DEFAULT_EXPLODE_FACTOR } : { type: 'assembly.restore' },
      'gesture'
    );
  }, [commandDispatcher]);

  // Exit guided tour safely and restore prior selection if valid
  const handleExitGuidedTour = useCallback(() => {
    setIsGuidedTourActive(false);
    // Anatomy lessons may have switched to the inside view: show the outer surface again
    const insideIds = activeModel?.insideView?.hideComponentIds ?? [];
    if (activeLesson?.frameEachStep && insideIds.length) {
      commandDispatcher.dispatch({ type: 'component.visibility', componentIds: insideIds, visible: true }, 'ui');
    }
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
  }, [previousSelectionBeforeTour, activeModelId, activeModel, onSelectComponent, activeLesson, commandDispatcher]);

  // Start guided tour with previous selection capture
  // Anatomy lessons (frameEachStep): frame each structure and switch to the inside view for deep
  // structures, all through the shared dispatcher (the same validation as voice and mouse)
  const applyLessonView = useCallback((stepIndex: number | null) => {
    if (!activeLesson?.frameEachStep) return;
    const insideIds = activeModel?.insideView?.hideComponentIds ?? [];
    const step = stepIndex === null ? null : activeLesson.steps[stepIndex];
    if (insideIds.length) {
      commandDispatcher.dispatch({ type: 'component.visibility', componentIds: insideIds, visible: !step?.revealInside }, 'ui');
    }
    if (step) commandDispatcher.dispatch({ type: 'component.focus', componentId: step.componentId }, 'ui');
  }, [activeLesson, activeModel, commandDispatcher]);

  const handleStartGuidedTour = useCallback(() => {
    if (!activeLesson || activeLesson.steps.length === 0) return;
    setPreviousSelectionBeforeTour({
      modelId: activeModelId,
      componentId: selectedComponentId,
    });
    setCurrentTourStep(0);
    setIsGuidedTourActive(true);
    onSelectComponent(activeLesson.steps[0].componentId);
    applyLessonView(0);
  }, [activeLesson, activeModelId, selectedComponentId, onSelectComponent, applyLessonView]);

  // Switch tour step and sync viewport/tree/inspector selection
  const handleTourStepChange = useCallback(
    (stepIndex: number) => {
      if (!activeLesson) return;
      const clampedIndex = Math.max(0, Math.min(activeLesson.steps.length - 1, stepIndex));
      setCurrentTourStep(clampedIndex);
      const step = activeLesson.steps[clampedIndex];
      if (step) {
        onSelectComponent(step.componentId);
        applyLessonView(clampedIndex);
      }
    },
    [activeLesson, onSelectComponent, applyLessonView]
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

  // ---------------- Unified scene command channel: workspace side (Task V1) ----------------
  // Latest workspace state/handlers, read by the long-lived command handler and context provider.
  const workspaceRef = useRef({
    activeModel,
    selectedComponentId,
    activeLesson,
    isGuidedTourActive,
    currentTourStep,
    explodedFactor,
    hiddenComponentIds,
    handleSelectComponent,
    handleExplodedFactorChange,
    handleStartGuidedTour,
    handleExitGuidedTour,
    handleTourStepChange,
    handleNavigateHomeWrapped,
    onSwitchModel,
  });
  useEffect(() => {
    workspaceRef.current = {
      activeModel,
      selectedComponentId,
      activeLesson,
      isGuidedTourActive,
      currentTourStep,
      explodedFactor,
      hiddenComponentIds,
      handleSelectComponent,
      handleExplodedFactorChange,
      handleStartGuidedTour,
      handleExitGuidedTour,
      handleTourStepChange,
      handleNavigateHomeWrapped,
      onSwitchModel,
    };
  });

  useEffect(() => {
    const unregisterContext = commandDispatcher.registerContextProvider('workspace', () => {
      const ws = workspaceRef.current;
      return {
        modelId: ws.activeModel?.id ?? null,
        componentIds: new Set(ws.activeModel?.getAllComponentIds() ?? []),
        animationIds: (ws.activeModel?.animations ?? []).map((a) => a.id),
        lesson: {
          available: Boolean(ws.activeLesson && ws.activeLesson.steps.length > 0),
          active: ws.isGuidedTourActive,
          stepCount: ws.activeLesson?.steps.length ?? 0,
          currentStep: ws.currentTourStep,
        },
        registeredModelIds: new Set(modelRegistry.getCatalogueModels().map((m) => m.id)),
        selectedComponentId: ws.selectedComponentId,
        workspaceFacts: {
          hiddenComponentIds: [...ws.hiddenComponentIds],
          explodedFactor: ws.explodedFactor,
          lessonStepTitle: ws.isGuidedTourActive ? ws.activeLesson?.steps[ws.currentTourStep]?.title ?? null : null,
          lessonStepComponentId: ws.isGuidedTourActive ? ws.activeLesson?.steps[ws.currentTourStep]?.componentId ?? null : null,
        },
      };
    });

    const handler: CommandHandler = {
      id: 'workspace',
      canHandle: (type) => WORKSPACE_COMMAND_TYPES.has(type),
      execute: (command: SceneCommand, source) => {
        const ws = workspaceRef.current;
        switch (command.type) {
          case 'component.select':
            ws.handleSelectComponent(command.componentId);
            return { status: 'executed' };
          case 'component.visibility':
            setHiddenComponentIds((prev) => {
              const next = new Set(prev);
              command.componentIds.forEach((id) => (command.visible ? next.delete(id) : next.add(id)));
              return next;
            });
            return { status: 'executed' };
          case 'component.showAll':
            setHiddenComponentIds(new Set());
            commandDispatcher.dispatch({ type: 'component.isolate', componentId: null }, source);
            return { status: 'executed' };
          case 'assembly.explode':
            ws.handleExplodedFactorChange(command.factor);
            return { status: 'executed' };
          case 'assembly.restore':
            ws.handleExplodedFactorChange(0);
            return { status: 'executed' };
          case 'lesson.start':
            if (ws.isGuidedTourActive) ws.handleTourStepChange(0);
            else ws.handleStartGuidedTour();
            return { status: 'executed' };
          case 'lesson.next':
            ws.handleTourStepChange(ws.currentTourStep + 1);
            return { status: 'executed' };
          case 'lesson.previous':
            ws.handleTourStepChange(ws.currentTourStep - 1);
            return { status: 'executed' };
          case 'lesson.goTo':
            ws.handleTourStepChange(command.stepIndex);
            return { status: 'executed' };
          case 'lesson.exit':
            ws.handleExitGuidedTour();
            return { status: 'executed' };
          case 'workspace.switchModel':
            if (!ws.onSwitchModel) return { status: 'rejected', code: 'NO_HANDLER', detail: 'Model switching is not available here.' };
            ws.onSwitchModel(command.modelId);
            return { status: 'executed' };
          case 'workspace.goHome':
            ws.handleNavigateHomeWrapped();
            return { status: 'executed' };
          default:
            return { status: 'rejected', code: 'NO_HANDLER', detail: `Workspace cannot handle "${command.type}".` };
        }
      },
    };
    const unregisterHandler = commandDispatcher.registerHandler(handler);

    // Development-only console hook for manual verification, e.g.
    //   __sceneCommands.dispatch({ type: 'camera.view', view: 'back' })
    const devWindow = window as unknown as { __sceneCommands?: unknown };
    if (import.meta.env.DEV) {
      devWindow.__sceneCommands = {
        dispatch: (command: unknown) => commandDispatcher.dispatch(command, 'dev'),
        context: () => commandDispatcher.getContext(),
        history: () => commandDispatcher.getHistory(),
        snapshot: () => getSceneSnapshot(commandDispatcher, workspaceRef.current.activeModel),
      };
    }

    return () => {
      unregisterContext();
      unregisterHandler();
      if (import.meta.env.DEV) delete devWindow.__sceneCommands;
    };
  }, [commandDispatcher]);

  // Keyboard shortcuts for dock toggles, exploded view, and guided tour.
  // X and L now travel through the shared command channel (same behaviour as before).
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
        commandDispatcher.dispatch(
          workspaceRef.current.explodedFactor > 0
            ? { type: 'assembly.restore' }
            : { type: 'assembly.explode', factor: DEFAULT_EXPLODE_FACTOR },
          'keyboard'
        );
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        commandDispatcher.dispatch(
          { type: workspaceRef.current.isGuidedTourActive ? 'lesson.exit' : 'lesson.start' },
          'keyboard'
        );
      }
    },
    [commandDispatcher]
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
        onReassemble={() => commandDispatcher.dispatch({ type: 'assembly.restore' }, 'ui')}
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
                <Icon name="layers" />
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
              <Icon name="chevronLeft" />
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
              commandDispatcher={commandDispatcher}
              onTwoHandGesture={handleTwoHandGesture}
              onToggleExplode={() => commandDispatcher.dispatch(
                explodedFactor > 0 ? { type: 'assembly.restore' } : { type: 'assembly.explode', factor: DEFAULT_EXPLODE_FACTOR },
                'ui'
              )}
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

            {/* UI pass: bottom-right corner stack. The webcam chip sits above the voice tutor
                whatever its height; opened, the webcam preview moves to the top-right corner. */}
            <div className="viewport-corner-stack">
              <WebcamPreview
                camera={camera}
                onGestureChange={onGestureChange}
                onHandsDetected={onHandsDetected}
              />

              {/* Voice control (Task V2): commands go through the same V1 dispatcher */}
              <VoiceDock
                dispatcher={commandDispatcher}
                model={activeModel}
                allModels={modelRegistry.getCatalogueModels()}
                askRef={voiceAskRef}
              />
            </div>

            {/* Gesture Diagnostics Overlay Panel */}
            <GestureDiagnosticPanel
              isOpen={showDiagnostics}
              onToggle={onToggleDiagnostics}
            />

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
              <Icon name="chevronRight" />
            </button>
            <div className="dock-title-group">
              <span className="dock-icon" aria-hidden="true">
                <Icon name="info" />
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
                onAskTutor={askTutor}
              />
            </div>
          </div>
        </aside>
      </div>

      {/* 3. Bottom Status / Telemetry Area */}
      <footer className="workspace-status-bar" aria-label="Workspace Status">
        {/* Modality Status Indicator */}
        <div className="status-modality">
          <Icon name={hasActiveHand ? 'hand' : camera.status === 'active' ? 'camera' : 'mouse'} size={14}
            className={`modality-icon ${hasActiveHand ? 'gesture' : 'mouse'}`} />
          <span className="modality-text">
            {hasActiveHand
              ? `Gesture Active (${detectedHands.length} hand${detectedHands.length > 1 ? 's' : ''})`
              : camera.status === 'active'
              ? 'Camera on: show your hand to use gestures'
              : 'Camera off: mouse, keyboard and voice'}
          </span>
        </div>

        {/* Gesture Cheat Sheet Hint */}
        <div className="status-gesture-hints">
          {camera.status === 'active' ? (
            <>
              <span className="hint-item"><Icon name="hand" size={14} /> Orbit</span>
              <span className="hint-item"><Icon name="pinch" size={14} /> Zoom</span>
              <span className="hint-item"><Icon name="pointer" size={14} /> Point &amp; hold to select</span>
            </>
          ) : (
            <>
              <span className="hint-item"><kbd>Drag</kbd> Orbit</span>
              <span className="hint-item"><kbd>Scroll</kbd> Zoom</span>
              <span className="hint-item"><kbd>X</kbd> Explode</span>
              <span className="hint-item"><kbd>M</kbd> Ask</span>
            </>
          )}
          <span className="hint-item"><kbd>[</kbd><kbd>]</kbd> Panels</span>
        </div>

        {/* Right Status Info */}
        <div className="status-meta">
          <span className="meta-item">{modelName}</span>
        </div>
      </footer>
    </div>
  );
};

export default WorkspaceLayout;
