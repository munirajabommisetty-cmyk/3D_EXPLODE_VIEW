import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CameraController, type CameraPreset } from './CameraController';
import { GestureCameraController } from './GestureCameraController';
import { ComponentSelector } from './ComponentSelector';
import { VirtualCursor, projectFingertipToScreen } from '../hud/VirtualCursor';
import { getComponentMetadata } from '../../data/machineMetadata';
import { ModelLifecycleManager } from '../../services/models/modelLifecycle';
import { PLANETARY_GEARBOX_MODEL_ID } from '../../models/mechanical/planetaryGearboxModel';
import type { EngineeringModelDefinition } from '../../types/models';
import type { GestureRecognitionResult } from '../../types/gestures';
import type { HandLandmarkResult } from '../../types/landmarks';
import { defaultTelemetry, type TelemetrySnapshot } from '../../utils/telemetry';
import './ViewerCanvas.css';

export interface ViewerCanvasProps {
  modelId?: string;
  onModelLoaded?: (model: EngineeringModelDefinition) => void;
  onModelLoadError?: (error: string) => void;
  onFpsUpdate?: (fps: number) => void;
  onTelemetryUpdate?: (snapshot: TelemetrySnapshot) => void;
  className?: string;
  gestureResult?: GestureRecognitionResult | null;
  hands?: HandLandmarkResult[];
  selectedComponentId?: string | null;
  onSelectComponent?: (componentId: string | null) => void;
  hiddenComponentIds?: Set<string> | string[];
  isolatedComponentId?: string | null;
  explodedFactor?: number;
  onExplodedFactorChange?: (factor: number) => void;
}

const checkWebGLSupport = (): string | null => {
  if (typeof window === 'undefined') return null;
  const testCanvas = document.createElement('canvas');
  const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
  if (!gl) {
    return 'WebGL is not supported or hardware acceleration is disabled in your browser.';
  }
  return null;
};

export const ViewerCanvas: React.FC<ViewerCanvasProps> = ({
  modelId = PLANETARY_GEARBOX_MODEL_ID,
  onModelLoaded,
  onModelLoadError,
  onFpsUpdate,
  onTelemetryUpdate,
  className,
  gestureResult,
  hands,
  selectedComponentId,
  onSelectComponent,
  hiddenComponentIds,
  isolatedComponentId,
  explodedFactor = 0,
  onExplodedFactorChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  const lifecycleManagerRef = useRef<ModelLifecycleManager | null>(null);

  // Synchronize modelId into ref for initial load without exhaustive-deps warning
  const modelIdRef = useRef<string>(modelId || PLANETARY_GEARBOX_MODEL_ID);
  useEffect(() => {
    modelIdRef.current = modelId || PLANETARY_GEARBOX_MODEL_ID;
  }, [modelId]);

  // Synchronize callbacks into refs to avoid unwanted effect re-triggers
  const onModelLoadedRef = useRef(onModelLoaded);
  useEffect(() => {
    onModelLoadedRef.current = onModelLoaded;
  }, [onModelLoaded]);

  const onModelLoadErrorRef = useRef(onModelLoadError);
  useEffect(() => {
    onModelLoadErrorRef.current = onModelLoadError;
  }, [onModelLoadError]);

  // Synchronize gestureResult and hands into refs so animation loop has zero render coupling
  const gestureResultRef = useRef<GestureRecognitionResult | null>(gestureResult ?? null);
  useEffect(() => {
    gestureResultRef.current = gestureResult ?? null;
  }, [gestureResult]);

  const handsRef = useRef<HandLandmarkResult[]>(hands ?? []);
  useEffect(() => {
    handsRef.current = hands ?? [];
  }, [hands]);

  // Synchronize selection state and callbacks
  const selectedComponentIdRef = useRef<string | null>(selectedComponentId ?? null);
  useEffect(() => {
    selectedComponentIdRef.current = selectedComponentId ?? null;
  }, [selectedComponentId]);

  const onSelectComponentRef = useRef(onSelectComponent);
  useEffect(() => {
    onSelectComponentRef.current = onSelectComponent;
  }, [onSelectComponent]);

  const pointerNdcRef = useRef<{ x: number; y: number } | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number; time: number } | null>(null);

  // Dwell cursor state for visual overlay
  const [cursorState, setCursorState] = useState<{
    visible: boolean;
    position: { x: number; y: number } | null;
    dwellProgress: number;
    hoveredComponentName: string | null;
  }>({
    visible: false,
    position: null,
    dwellProgress: 0,
    hoveredComponentName: null,
  });

  const [initError, setInitError] = useState<string | null>(() => checkWebGLSupport());
  const [modelError, setModelError] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [gridVisible, setGridVisible] = useState<boolean>(true);
  const [activePreset, setActivePreset] = useState<CameraPreset>('isometric');

  // Keep autoRotate in sync with CameraController
  const autoRotateRef = useRef<boolean>(autoRotate);
  useEffect(() => {
    autoRotateRef.current = autoRotate;
    if (cameraControllerRef.current) {
      cameraControllerRef.current.setAutoRotate(autoRotate);
    }
  }, [autoRotate]);

  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  useEffect(() => {
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = gridVisible;
    }
  }, [gridVisible]);

  // Synchronize explodedFactor with active ModelLifecycleManager
  useEffect(() => {
    if (lifecycleManagerRef.current && typeof explodedFactor === 'number') {
      lifecycleManagerRef.current.setExplodedFactor(explodedFactor);
    }
  }, [explodedFactor]);

  // Canvas & WebGL Setup Lifecycle (Runs once on mount)
  useEffect(() => {
    if (initError) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let animationFrameId: number;
    let isDisposed = false;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f19);

    // 2. Camera: Initialized with default aspect ratio
    const initialWidth = container.clientWidth || 800;
    const initialHeight = container.clientHeight || 600;
    const camera = new THREE.PerspectiveCamera(45, initialWidth / initialHeight, 0.1, 100);

    // 3. Renderer
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(initialWidth, initialHeight);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
    } catch (err) {
      const errMsg = `Failed to initialize WebGL Renderer: ${err instanceof Error ? err.message : String(err)}`;
      setTimeout(() => setInitError(errMsg), 0);
      return;
    }

    // 4. Modular Camera Controller
    const cameraController = new CameraController(camera, renderer.domElement, {
      enableDamping: true,
      dampingFactor: 0.05,
      minDistance: 2.2,
      maxDistance: 25.0,
      autoRotate: autoRotateRef.current,
      autoRotateSpeed: 1.0,
      onPresetChange: (preset) => setActivePreset(preset),
    });
    cameraControllerRef.current = cameraController;

    // Dedicated Gesture Camera Controller for Open-Palm Orbit Navigation
    const gestureCameraController = new GestureCameraController(cameraController);

    // 5. Studio Lighting Setup (Key, Fill, Rim, Top Accent)
    const ambientLight = new THREE.AmbientLight(0x8ba3c7, 0.95);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(7, 12, 9);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x06b6d4, 1.5); // Cyan mechanical edge rim
    rimLight.position.set(-7, -2, -7);
    scene.add(rimLight);

    const fillLight = new THREE.DirectionalLight(0x94a3b8, 0.8);
    fillLight.position.set(-6, 8, 4);
    scene.add(fillLight);

    const accentLight = new THREE.PointLight(0xf59e0b, 1.2, 12);
    accentLight.position.set(0, 3.5, 1.5);
    scene.add(accentLight);

    // 6. Ground Reference Grid
    const gridHelper = new THREE.GridHelper(18, 36, 0x06b6d4, 0x1e293b);
    gridHelper.position.y = -1.25;
    gridHelper.visible = gridHelperRef.current ? gridHelperRef.current.visible : true;
    gridHelperRef.current = gridHelper;
    scene.add(gridHelper);

    // Soft contact shadow disk under the outer ring
    const shadowGeo = new THREE.CircleGeometry(2.5, 48);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = -1.24;
    scene.add(shadowMesh);

    // 7. Component Dwell Selection Manager
    const componentSelector = new ComponentSelector({ dwellDurationMs: 1200 });

    // 8. Dynamic Model Lifecycle Manager (Phase 9 - Task 9.3)
    const lifecycleManager = new ModelLifecycleManager({
      scene,
      camera,
      cameraController,
      onModelLoaded: (loadedModel) => {
        onModelLoadedRef.current?.(loadedModel);
      },
      onModelError: (err) => {
        setModelError(err);
        onModelLoadErrorRef.current?.(err);
      },
    });
    lifecycleManagerRef.current = lifecycleManager;

    // Load initial model from ref
    const initialLoadResult = lifecycleManager.loadModel(modelIdRef.current);
    if (!initialLoadResult.success) {
      setModelError(initialLoadResult.error ?? 'Failed to load initial model');
    } else {
      setModelError(null);
    }

    // 9. Resize Observer for dynamic container resizing
    const resizeObserver = new ResizeObserver((entries) => {
      if (isDisposed) return;
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const height = entry.contentRect.height;
        if (width > 0 && height > 0) {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height, false);
        }
      }
    });
    resizeObserver.observe(container);

    // 10. Animation & Render Loop with FPS calculation
    let lastTime = performance.now();
    let frameCount = 0;
    let fpsTimer = 0;

    const clock = new THREE.Clock();

    const animate = () => {
      if (isDisposed) return;
      animationFrameId = requestAnimationFrame(animate);

      const delta = clock.getDelta();
      const now = performance.now();
      const elapsed = now - lastTime;
      lastTime = now;

      // Telemetry calculation
      defaultTelemetry.render.recordFrame(now);

      // Record application-level pipeline latency if primary hand landmark has a timestamp
      if (handsRef.current && handsRef.current.length > 0) {
        const primaryHand = handsRef.current[0];
        if (primaryHand.timestamp && Number.isFinite(primaryHand.timestamp)) {
          defaultTelemetry.latency.recordLatency(primaryHand.timestamp, now);
        }
      }

      frameCount++;
      fpsTimer += elapsed;
      if (fpsTimer >= 1000) {
        const renderSnapshot = defaultTelemetry.render.getSnapshot();
        const currentFps =
          renderSnapshot.fps > 0
            ? renderSnapshot.fps
            : Math.round((frameCount * 1000) / fpsTimer);
        onFpsUpdate?.(currentFps);
        onTelemetryUpdate?.(defaultTelemetry.getCombinedSnapshot(now));
        frameCount = 0;
        fpsTimer = 0;
      }

      // Update model internal animation / kinematics
      if (autoRotateRef.current) {
        lifecycleManager.updateAnimation(delta, performance.now() / 1000);
      }

      // Open-Palm gesture orbit navigation update
      gestureCameraController.update(gestureResultRef.current, handsRef.current);

      // Component Raycasting & Dwell Selection
      let candidateNdc: { x: number; y: number } | null = null;
      let isGesturePointing = false;
      let pointingPixelPos: { x: number; y: number } | null = null;

      const activeGesture = gestureResultRef.current;
      const activeHands = handsRef.current;

      if (
        activeGesture?.gesture === 'POINTING' &&
        activeGesture.isStable &&
        activeHands &&
        activeHands.length > 0
      ) {
        const matchingHand = activeGesture.handedness
          ? activeHands.find((h) => h.handedness === activeGesture.handedness) || activeHands[0]
          : activeHands[0];

        // Guard against low tracking confidence before driving virtual laser raycast
        const trackingConfidence = matchingHand.score ?? activeGesture.confidence ?? 1.0;
        if (trackingConfidence >= 0.5) {
          // Landmark 8: INDEX_TIP
          const indexTip = matchingHand.landmarks?.[8];
          const width = container.clientWidth || initialWidth;
          const height = container.clientHeight || initialHeight;

          const projected = projectFingertipToScreen(indexTip, { width, height }, true);
          if (projected) {
            isGesturePointing = true;
            candidateNdc = projected.ndc;
            pointingPixelPos = projected.screen;
          }
        }
      } else if (pointerNdcRef.current) {
        candidateNdc = pointerNdcRef.current;
      }

      const raycaster = lifecycleManager.getRaycaster();
      const hit = candidateNdc && raycaster ? raycaster.raycast(candidateNdc) : null;
      const selectorResult = componentSelector.update(hit?.componentId ?? null, delta * 1000);

      if (selectorResult.justSelected && selectorResult.selectedId) {
        onSelectComponentRef.current?.(selectorResult.selectedId);
      }

      // Update non-destructive emissive highlights
      if (raycaster) {
        raycaster.setHoverHighlight(selectorResult.hoveredId);
        raycaster.setSelectionHighlight(selectedComponentIdRef.current);
      }

      // Dwell Cursor overlay update
      if (isGesturePointing && pointingPixelPos) {
        const activeModel = lifecycleManager.getActiveModel();
        const hoveredName = hit
          ? activeModel?.getComponentMetadata(hit.componentId)?.name ||
            getComponentMetadata(hit.componentId)?.name ||
            hit.componentId
          : null;

        setCursorState((prev) => {
          if (
            prev.visible &&
            prev.hoveredComponentName === hoveredName &&
            Math.abs(prev.dwellProgress - selectorResult.dwellProgress) < 0.03 &&
            prev.position &&
            Math.hypot(prev.position.x - pointingPixelPos!.x, prev.position.y - pointingPixelPos!.y) < 3
          ) {
            return prev;
          }
          return {
            visible: true,
            position: pointingPixelPos,
            dwellProgress: selectorResult.dwellProgress,
            hoveredComponentName: hoveredName,
          };
        });
      } else {
        setCursorState((prev) => {
          if (!prev.visible && prev.hoveredComponentName === null && prev.dwellProgress === 0) {
            return prev;
          }
          return {
            visible: false,
            position: null,
            dwellProgress: 0,
            hoveredComponentName: null,
          };
        });
      }

      // Camera controller update (handles damping inertia and auto-orbit)
      cameraController.update();

      renderer.render(scene, camera);
    };

    animate();

    // 11. Cleanup on unmount
    return () => {
      isDisposed = true;
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      gestureCameraController.dispose();

      // Dispose active model runtime and raycaster
      lifecycleManager.dispose();
      lifecycleManagerRef.current = null;

      componentSelector.reset();
      cameraController.dispose();

      // Dispose all shared scene geometries and materials
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else if (mesh.material) {
            mesh.material.dispose();
          }
        }
      });

      defaultTelemetry.render.reset();
      defaultTelemetry.latency.reset();
      renderer.dispose();
    };
  }, [initError, onFpsUpdate, onTelemetryUpdate]);

  // Dynamic model switching effect (Phase 9 - Task 9.3)
  useEffect(() => {
    if (lifecycleManagerRef.current) {
      const targetId = modelId || PLANETARY_GEARBOX_MODEL_ID;
      if (lifecycleManagerRef.current.getActiveModel()?.id !== targetId) {
        const result = lifecycleManagerRef.current.loadModel(targetId);
        if (!result.success) {
          setModelError(result.error ?? 'Failed to load model.');
        } else {
          setModelError(null);
          onSelectComponentRef.current?.(null);
        }
      }
    }
  }, [modelId]);

  // Synchronize component visibility changes from assembly tree (Phase 9 - Task 9.5)
  useEffect(() => {
    if (lifecycleManagerRef.current && hiddenComponentIds !== undefined) {
      lifecycleManagerRef.current.setHiddenComponents(hiddenComponentIds);
    }
  }, [hiddenComponentIds]);

  // Synchronize component isolation (Phase 10 architecture)
  useEffect(() => {
    if (lifecycleManagerRef.current && isolatedComponentId !== undefined) {
      lifecycleManagerRef.current.isolateComponent(isolatedComponentId);
    }
  }, [isolatedComponentId]);

  const handleSelectPreset = (preset: CameraPreset) => {
    setActivePreset(preset);
    cameraControllerRef.current?.setPreset(preset);
  };

  const handleResetCamera = () => {
    setActivePreset('isometric');
    cameraControllerRef.current?.reset();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      pointerNdcRef.current = { x, y };
    }
  };

  const handlePointerLeave = () => {
    pointerNdcRef.current = null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY, time: performance.now() };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointerDownRef.current) return;
    const dist = Math.hypot(
      e.clientX - pointerDownRef.current.x,
      e.clientY - pointerDownRef.current.y
    );
    const elapsed = performance.now() - pointerDownRef.current.time;
    pointerDownRef.current = null;

    // Fast pointer click without camera drag (< 6px movement, < 400ms duration)
    if (dist < 6 && elapsed < 400) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = lifecycleManagerRef.current?.getRaycaster();
      if (raycaster) {
        const hit = raycaster.raycast({ x, y });
        if (hit) {
          onSelectComponentRef.current?.(hit.componentId);
        } else {
          onSelectComponentRef.current?.(null);
        }
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className={`viewport-container ${className || ''}`}
      aria-label="Interactive 3D Mechanical Viewport"
      role="region"
    >
      <canvas
        ref={canvasRef}
        className="three-canvas"
        tabIndex={0}
        aria-label="3D engineering scene canvas"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      />

      {/* Virtual Laser Pointer & Dwell Overlay */}
      <VirtualCursor
        visible={cursorState.visible}
        position={cursorState.position}
        dwellProgress={cursorState.dwellProgress}
        hoveredComponentName={cursorState.hoveredComponentName}
      />

      {/* WebGL Initialization Error Overlay */}
      {initError && (
        <div className="viewport-overlay error-overlay" role="alert">
          <div className="error-icon">⚠️</div>
          <h3>WebGL Initialization Error</h3>
          <p>{initError}</p>
        </div>
      )}

      {/* Model Loading Error Overlay (Phase 9 - Task 9.3) */}
      {!initError && modelError && (
        <div className="viewport-overlay error-overlay" role="alert">
          <div className="error-icon">⚠️</div>
          <h3>Model Not Found</h3>
          <p>{modelError}</p>
          <button
            type="button"
            className="toolbar-btn active"
            onClick={() => {
              if (lifecycleManagerRef.current) {
                const res = lifecycleManagerRef.current.loadModel(PLANETARY_GEARBOX_MODEL_ID);
                if (res.success) {
                  setModelError(null);
                }
              }
            }}
            style={{ marginTop: '12px' }}
          >
            Restore Default Model
          </button>
        </div>
      )}

      {/* On-Screen Viewport Controls Toolbar */}
      {!initError && !modelError && (
        <div className="viewport-controls-toolbar">
          {/* Preset Angle Buttons */}
          <div className="preset-group" role="group" aria-label="Camera Presets">
            <button
              type="button"
              className={`toolbar-btn preset-btn ${activePreset === 'isometric' ? 'active' : ''}`}
              onClick={() => handleSelectPreset('isometric')}
              title="Isometric 3D Angle [Key: 1]"
              aria-label="Switch to Isometric View"
            >
              Isometric
            </button>
            <button
              type="button"
              className={`toolbar-btn preset-btn ${activePreset === 'top' ? 'active' : ''}`}
              onClick={() => handleSelectPreset('top')}
              title="Top Overhead View [Key: 2]"
              aria-label="Switch to Top View"
            >
              Top
            </button>
            <button
              type="button"
              className={`toolbar-btn preset-btn ${activePreset === 'front' ? 'active' : ''}`}
              onClick={() => handleSelectPreset('front')}
              title="Front Elevation View [Key: 3]"
              aria-label="Switch to Front View"
            >
              Front
            </button>
          </div>

          <div className="toolbar-divider" />

          {/* Action Buttons */}
          <button
            type="button"
            className="toolbar-btn"
            onClick={handleResetCamera}
            title="Reset to default view [Key: R]"
            aria-label="Reset camera viewpoint"
          >
            Reset [R]
          </button>
          <button
            type="button"
            className={`toolbar-btn ${autoRotate ? 'active' : ''}`}
            onClick={() => setAutoRotate((prev) => !prev)}
            title="Toggle animation rotation and auto-orbit"
            aria-label="Toggle animation rotation and auto-orbit"
          >
            {autoRotate ? 'Pause Rotation' : 'Auto Rotate'}
          </button>
          <button
            type="button"
            className={`toolbar-btn ${gridVisible ? 'active' : ''}`}
            onClick={() => setGridVisible((prev) => !prev)}
            title="Toggle ground reference grid"
            aria-label="Toggle ground reference grid"
          >
            {gridVisible ? 'Hide Grid' : 'Show Grid'}
          </button>

          {/* Exploded View Separation Slider */}
          {onExplodedFactorChange && (
            <>
              <div className="toolbar-divider" />
              <div className="exploded-control-group" role="group" aria-label="Exploded View Separation">
                <button
                  type="button"
                  className={`toolbar-btn ${explodedFactor > 0 ? 'active' : ''}`}
                  onClick={() => onExplodedFactorChange(explodedFactor > 0 ? 0 : 0.6)}
                  title={explodedFactor > 0 ? 'Assemble Model [Key: X]' : 'Explode Model [Key: X]'}
                  aria-label={explodedFactor > 0 ? 'Assemble Model' : 'Explode Model'}
                >
                  💥 {explodedFactor > 0 ? `${Math.round(explodedFactor * 100)}%` : 'Explode'}
                </button>
                {explodedFactor > 0 && (
                  <>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={Math.round(explodedFactor * 100)}
                      onChange={(e) => onExplodedFactorChange(Number(e.target.value) / 100)}
                      className="viewport-slider"
                      title={`Explosion: ${Math.round(explodedFactor * 100)}%`}
                      aria-label="Exploded View Separation Factor"
                    />
                    <button
                      type="button"
                      className="toolbar-btn"
                      onClick={() => onExplodedFactorChange(0)}
                      title="Reset to 0% Assembled"
                      aria-label="Reset Exploded View to Assembled"
                    >
                      Assemble
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Interaction Hint Badge */}
      {!initError && !modelError && (
        <div className="interaction-hint">
          <span>
            🖱️ <strong>Left-Click:</strong> Orbit | <strong>Scroll:</strong> Zoom | <strong>Right-Click:</strong> Pan | <strong>R:</strong> Reset View
          </span>
        </div>
      )}
    </div>
  );
};

export default ViewerCanvas;
