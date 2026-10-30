import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TwoHandExplodeMachine, type TwoHandState } from '../../services/gestures/twoHandExplode';
import { VirtualWorkspace } from './VirtualWorkspace';
import { XrayStyle } from './xrayStyle';
import { createStudioEnvironment } from './studioEnvironment';
import { modelRegistry } from '../../models/registry';
import {
  approach, calloutLayout, componentLabels, ExplodeAnimator, LAB_BACKGROUND, labelPhase, mixColor, STUDIO_BACKGROUND,
} from '../../services/scene/explodePresentation';
import { CameraController, type CameraPreset, type CameraView } from './CameraController';
import { GestureCameraController } from './GestureCameraController';
import { ViewerCommandExecutor } from '../../services/commands/viewerCommandExecutor';
import type { SceneCommandDispatcher } from '../../services/commands/sceneCommandDispatcher';
import { ComponentSelector } from './ComponentSelector';
import { VirtualCursor, projectFingertipToScreen } from '../hud/VirtualCursor';
import { getComponentMetadata } from '../../data/machineMetadata';
import { ModelLifecycleManager } from '../../services/models/modelLifecycle';
import { PLANETARY_GEARBOX_MODEL_ID } from '../../models/mechanical/planetaryGearboxModel';
import type { EngineeringModelDefinition } from '../../types/models';
import type { GestureRecognitionResult } from '../../types/gestures';
import type { HandLandmarkResult } from '../../types/landmarks';
import { defaultTelemetry, type TelemetrySnapshot } from '../../utils/telemetry';
import { Icon } from '../ui/Icon';
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
  /** Kept for API compatibility; Milestone C removed the on-canvas explode button and slider
   *  (explode now comes from the two-hand gesture, voice or the X key, all through the dispatcher). */
  onExplodedFactorChange?: (factor: number) => void;
  /** Explode / reassemble from the toolbar (the parent dispatches assembly.explode / assembly.restore). */
  onToggleExplode?: () => void;
  /** Shared scene command channel; the viewer registers its camera/animation handler on it. */
  commandDispatcher?: SceneCommandDispatcher;
  /** Milestone C: the two-hand gesture asks for explode / restore (the workspace dispatches it). */
  onTwoHandGesture?: (action: 'explode' | 'restore') => void;
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
  commandDispatcher,
  onTwoHandGesture,
  onToggleExplode,
}) => {
  // Milestone C: the workspace owns the explode TARGET; the viewer animates the displayed factor
  const explodeAnimatorRef = useRef(new ExplodeAnimator());
  const onTwoHandGestureRef = useRef(onTwoHandGesture);
  useEffect(() => {
    onTwoHandGestureRef.current = onTwoHandGesture;
  }, [onTwoHandGesture]);
  const labelLayerRef = useRef<HTMLDivElement | null>(null);
  // Models look real (their own materials) until they are exploded; the x-ray technical look
  // (colour-coded, see-through, labelled) is used only while the parts are separated.
  // Two-hand gesture feedback (updated only when the state changes)
  const [twoHand, setTwoHand] = useState<{ state: TwoHandState; engaged: boolean }>({ state: 'ASSEMBLED', engaged: false });
  // Command channel is created once by the workspace; keep a ref so the mount effect can register on it
  const commandDispatcherRef = useRef<SceneCommandDispatcher | undefined>(commandDispatcher);
  useEffect(() => {
    commandDispatcherRef.current = commandDispatcher;
  }, [commandDispatcher]);

  // Model animation playback (separate from camera auto-orbit so commands can control each)
  const animationPlayingRef = useRef<boolean>(true);
  const animationSpeedRef = useRef<number>(1);
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
  // Task V3: component currently under the mouse or the hand laser pointer (shared via the dispatcher)
  const pointedRef = useRef<{ componentId: string | null; source: 'mouse' | 'gesture' | null }>({
    componentId: null,
    source: null,
  });
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
  // Brain module: its GLB loads asynchronously; show progress and report failures clearly
  const [assetLoading, setAssetLoading] = useState<string | null>(null);
  const assetPendingRef = useRef(false);

  /** Follows a model whose geometry loads from a file (runtime.ready). */
  const watchAssetLoad = useCallback(() => {
    const lm = lifecycleManagerRef.current;
    const runtime = lm?.getActiveRuntime();
    const model = lm?.getActiveModel();
    if (!lm || !runtime?.ready || !model) {
      setAssetLoading(null);
      return;
    }
    setAssetLoading(model.name);
    assetPendingRef.current = true;
    runtime.ready.then(
      () => {
        if (lm.getActiveRuntime() !== runtime) return; // a newer model replaced it
        assetPendingRef.current = false;
        setAssetLoading(null);
        lm.setHiddenComponents(lm.getHiddenComponents()); // apply visibility to the new meshes
      },
      (err: unknown) => {
        if (lm.getActiveRuntime() !== runtime) return;
        assetPendingRef.current = false;
        setAssetLoading(null);
        setModelError(err instanceof Error ? err.message : String(err));
      }
    );
  }, []);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [gridVisible, setGridVisible] = useState<boolean>(true);
  const [activePreset, setActivePreset] = useState<CameraView>('isometric');

  // Keep autoRotate in sync with CameraController
  const autoRotateRef = useRef<boolean>(autoRotate);
  useEffect(() => {
    autoRotateRef.current = autoRotate;
    if (cameraControllerRef.current) {
      cameraControllerRef.current.setAutoRotate(autoRotate);
    }
  }, [autoRotate]);

  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  // The user's grid choice; the render loop also hides the grid while the model floats exploded
  const gridVisibleRef = useRef<boolean>(gridVisible);
  useEffect(() => {
    gridVisibleRef.current = gridVisible;
  }, [gridVisible]);

  // Milestone C: the explode factor is animated by the render loop toward the workspace's target
  const explodedFactorRef = useRef(explodedFactor);
  useEffect(() => {
    explodedFactorRef.current = explodedFactor;
  }, [explodedFactor]);
  useEffect(() => {
    if (typeof explodedFactor === 'number') explodeAnimatorRef.current.setTarget(explodedFactor, performance.now());
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
      // CSS sizes the canvas (100% of the viewport); only the drawing buffer is set here, so the
      // canvas grows and shrinks with the docks instead of keeping its first pixel size
      renderer.setSize(initialWidth, initialHeight, false);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      // Realistic materials: a studio environment for reflections on metal and soft overall light
      scene.environment = createStudioEnvironment(renderer);
      scene.environmentIntensity = 0.45; // the scene already has its own key, fill and rim lights
      // Learning views use real sections (material clipping planes): eye cutaway, RC section, engine cylinder
      renderer.localClippingEnabled = true;
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

    const rimLight = new THREE.DirectionalLight(0xdfe8f5, 1.1); // neutral edge rim (no colour cast on real materials)
    rimLight.position.set(-7, -2, -7);
    scene.add(rimLight);

    const fillLight = new THREE.DirectionalLight(0x94a3b8, 0.8);
    fillLight.position.set(-6, 8, 4);
    scene.add(fillLight);

    const accentLight = new THREE.PointLight(0xf59e0b, 1.2, 12);
    accentLight.position.set(0, 3.5, 1.5);
    scene.add(accentLight);

    // Milestone C: soft sky/ground light for the bright "floating workspace" (off when assembled)
    const labLight = new THREE.HemisphereLight(0xffffff, 0x8a94a6, 0);
    scene.add(labLight);
    // Milestone C (UI pass): pastel sky, holographic platform, particles and hologram parts
    const virtualWs = new VirtualWorkspace(scene);
    const xray = new XrayStyle();

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

    // Unified scene command channel (Task V1): camera, focus/isolate and animation commands from
    // any input source run here, arbitrated against live gesture and mouse interaction.
    const dispatcher = commandDispatcherRef.current;
    const commandExecutor = new ViewerCommandExecutor(
      {
        camera: cameraController,
        lifecycle: lifecycleManager,
        isGestureInteracting: () => gestureCameraController.isInteracting(),
        animation: {
          setPlaying: (playing) => {
            animationPlayingRef.current = playing;
          },
          setSpeed: (speed) => {
            animationSpeedRef.current = speed;
          },
        },
        setAutoOrbit: (enabled) => setAutoRotate(enabled),
        getPointer: () => pointedRef.current,
        getAnimationState: () => ({ playing: animationPlayingRef.current, speed: animationSpeedRef.current }),
      },
      (command, source, status, detail) => dispatcher?.reportDeferredOutcome(command, source, status, detail)
    );
    const unregisterHandler = dispatcher?.registerHandler(commandExecutor);
    const unregisterContext = dispatcher?.registerContextProvider('viewer', commandExecutor.contextProvider);

    // Load initial model from ref
    const initialLoadResult = lifecycleManager.loadModel(modelIdRef.current);
    if (!initialLoadResult.success) {
      setModelError(initialLoadResult.error ?? 'Failed to load initial model');
    } else {
      setModelError(null);
      watchAssetLoad();
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

    // Milestone C: two-hand gesture, explode animation and exploded-view presentation state
    const explodeAnimator = explodeAnimatorRef.current;
    explodeAnimator.snap(0);
    // a remounted viewer follows the workspace's current explode state (no "Exploded" mismatch)
    explodeAnimator.setTarget(explodedFactorRef.current ?? 0, performance.now());
    const twoHandMachine = new TwoHandExplodeMachine();
    let lastTwoHand: { state: TwoHandState; engaged: boolean } = { state: 'ASSEMBLED', engaged: false };
    let stageMix = 0;
    let stageApplied = false;
    let settledTarget = 0;
    let framedModelId: string | null = null;
    let framedFrom: { position: THREE.Vector3; target: THREE.Vector3; distance: number } | null = null;
    let labelMix = 0;
    let labelsShown = false;
    let labelModelId: string | null = null;
    let leaderSvg: SVGSVGElement | null = null;
    let labelEls: { id: string; name: string; el: HTMLDivElement; anchorMesh: THREE.Object3D | null; meshes: THREE.Mesh[] }[] = [];
    const meshCenter = new THREE.Vector3();
    /** The part's mesh nearest the camera (e.g. the visible hemisphere of a left+right structure). */
    const nearestMesh = (meshes: THREE.Mesh[]): THREE.Object3D | null => {
      let best: THREE.Object3D | null = null;
      let bestD = Infinity;
      // Only the structure's larger pieces (a lobe's main gyri, not a tiny one deep in a sulcus)
      const size = (m: THREE.Mesh) => m.geometry.getAttribute('position')?.count ?? 0;
      const largest = Math.max(...meshes.map(size));
      for (const m of meshes) {
        if (size(m) < largest * 0.5) continue;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        m.geometry.boundingBox!.getCenter(meshCenter).applyMatrix4(m.matrixWorld);
        const d = meshCenter.distanceToSquared(camera.position);
        if (d < bestD) { bestD = d; best = m; }
      }
      return best;
    };
    const anchorBox = new THREE.Box3();
    const anchor = new THREE.Vector3();

    /** Part-name labels (DOM, no React re-render): one per component with a name in the model data. */
    const updateLabels = (active: boolean) => {
      const layer = labelLayerRef.current;
      if (!layer) return;
      if (!active) {
        if (layer.style.display !== 'none') layer.style.display = 'none';
        return;
      }
      const model = lifecycleManager.getActiveModel();
      if (!model) return;
      if (labelModelId !== model.id) {
        layer.replaceChildren();
        // Anchor each label on one representative piece of its part (its first mesh): a part made of
        // many members spread over the model (e.g. the bridge's chords) would otherwise put every
        // label at the same centre point.
        const firstMesh = new Map<string, THREE.Object3D>();
        const allMeshes = new Map<string, THREE.Mesh[]>();
        lifecycleManager.getActiveRuntime()?.rootGroup.traverse((o) => {
          const cid = o.userData?.componentId as string | undefined;
          if (!cid || !(o as THREE.Mesh).isMesh) return;
          if (!firstMesh.has(cid)) firstMesh.set(cid, o);
          allMeshes.set(cid, [...(allMeshes.get(cid) ?? []), o as THREE.Mesh]);
        });
        const context = new Set(model.contextComponentIds ?? []);
        labelEls = componentLabels(model.getAllComponentIds().filter((id) => !context.has(id)), (id) => model.getComponentMetadata(id)?.name).map(({ id, name }) => {
          const el = document.createElement('div');
          el.className = 'exploded-label';
          el.textContent = name;
          el.style.setProperty('--label-accent', xray.cssColorFor(id) ?? '#38bdf8');
          layer.appendChild(el);
          return { id, name, el, anchorMesh: firstMesh.get(id) ?? null, meshes: allMeshes.get(id) ?? [] };
        });
        // Leader lines (one SVG under the labels)
        leaderSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        leaderSvg.setAttribute('class', 'callout-leaders');
        layer.prepend(leaderSvg);
        labelModelId = model.id;
      }
      layer.style.display = 'block';
      const width = container.clientWidth || initialWidth;
      const height = container.clientHeight || initialHeight;
      const hidden = lifecycleManager.getHiddenComponents();
      const isolated = lifecycleManager.getIsolatedComponentId();
      const boxes: { id: string; x: number; y: number; width: number; height: number }[] = [];
      for (const l of labelEls) {
        // Paired structures (left + right, e.g. the brain) are labelled on the side facing the camera
        const anchorObj = l.meshes.length > 1 && lifecycleManager.getActiveModel()?.domain === 'medical' ? nearestMesh(l.meshes) : l.anchorMesh;
        const box = hidden.has(l.id) || (isolated && isolated !== l.id) || !anchorObj
          ? null
          : anchorBox.setFromObject(anchorObj);
        if (!box) {
          l.el.style.display = 'none';
          continue;
        }
        box.getCenter(anchor);
        anchor.project(camera);
        if (anchor.z > 1) {
          l.el.style.display = 'none';
          continue;
        }
        boxes.push({ id: l.id, x: (anchor.x * 0.5 + 0.5) * width, y: (-anchor.y * 0.5 + 0.5) * height, width: l.name.length * 7.4 + 30, height: 24 });
      }
      // Callouts: labels in two neat columns beside the model, with elbow leader lines to each part
      const callouts = calloutLayout(boxes, { width, height });
      let paths = '';
      for (const c of callouts) {
        const l = labelEls.find((e) => e.id === c.id)!;
        const color = xray.cssColorFor(c.id) ?? '#38bdf8';
        l.el.style.display = 'block';
        l.el.style.opacity = labelMix.toFixed(2);
        l.el.dataset.side = c.side;
        l.el.style.transform = c.side === 'left'
          ? `translate(${Math.round(c.labelX)}px, ${Math.round(c.labelY)}px) translate(-100%, -50%)`
          : `translate(${Math.round(c.labelX)}px, ${Math.round(c.labelY)}px) translate(0, -50%)`;
        const elbow = c.side === 'left' ? c.labelX + 14 : c.labelX - 14;
        paths += `<path d="M${c.anchorX.toFixed(1)} ${c.anchorY.toFixed(1)} L${elbow.toFixed(1)} ${c.labelY.toFixed(1)} L${c.labelX.toFixed(1)} ${c.labelY.toFixed(1)}" stroke="${color}" />`
          + `<circle cx="${c.anchorX.toFixed(1)}" cy="${c.anchorY.toFixed(1)}" r="3.2" fill="${color}" />`;
      }
      if (leaderSvg) {
        leaderSvg.setAttribute('width', String(width));
        leaderSvg.setAttribute('height', String(height));
        leaderSvg.style.opacity = labelMix.toFixed(2);
        leaderSvg.innerHTML = paths;
      }
    };

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

      // Update model internal animation / kinematics (speed scales time uniformly, so the
      // gear-train ratios stay physically consistent)
      if (animationPlayingRef.current) {
        lifecycleManager.updateAnimation(delta * animationSpeedRef.current, performance.now() / 1000);
      }

      // --- Milestone C: animated explode factor (the model moves every part along its own direction) ---
      const shownFactor = explodeAnimator.update(now);
      if (shownFactor !== lifecycleManager.getExplodedFactor()) lifecycleManager.setExplodedFactor(shownFactor);

      // --- Milestone C: two-hand explode gesture. Two hands visible = model gesture; the one-hand
      // camera gestures (orbit, pinch-zoom, pointing) stand down so they can never fire by accident.
      const th = twoHandMachine.update({
        hands: handsRef.current,
        timeMs: now,
        modelExploded: explodeAnimator.getTarget() > 0,
        animating: explodeAnimator.isAnimating(),
        canExplode: Boolean(lifecycleManager.getActiveRuntime()?.setExplodedFactor),
      });
      if (th.action) onTwoHandGestureRef.current?.(th.action);
      if (th.state !== lastTwoHand.state || th.engaged !== lastTwoHand.engaged) {
        lastTwoHand = { state: th.state, engaged: th.engaged };
        setTwoHand(lastTwoHand);
      }

      // Open-Palm gesture orbit navigation update (suspended while both hands drive the model)
      gestureCameraController.update(th.engaged ? null : gestureResultRef.current, th.engaged ? [] : handsRef.current);

      // --- Milestone C: floating workspace look while exploded (bright lab, no floor grid) ---
      // dark technical backdrop for the x-ray look and for models shown solid by design (the eye)
      const stageGoal = xray.isOn() ? 1 : 0;
      const nextMix = approach(stageMix, stageGoal, 2.5, delta);
      if (nextMix !== stageMix || !stageApplied) {
        stageMix = nextMix;
        stageApplied = true;
        (scene.background as THREE.Color).setHex(mixColor(STUDIO_BACKGROUND, LAB_BACKGROUND, stageMix));
        virtualWs.setMix(stageMix);
        labLight.intensity = 1.1 * stageMix;
        accentLight.intensity = 1.2 * (1 - stageMix); // no warm glare in the x-ray look
        rimLight.intensity = 1.5 * (1 - 0.5 * stageMix);
        shadowMat.opacity = 0.4 * (1 - stageMix); // parts float: no floor shadow
        renderer.toneMappingExposure = 0.95; // realistic look and x-ray share one exposure
      }
      gridHelper.visible = gridVisibleRef.current && stageMix < 0.02;
      virtualWs.update(delta);

      // Parts become light holograms as soon as an explode starts, and get their real materials
      // back once reassembly has finished. Highlights are cleared around the swap and re-applied.
      const runtimeRoot = lifecycleManager.getActiveRuntime()?.rootGroup ?? null;
      // X-ray look: every part colour-coded and see-through with glowing outlines. On by default
      // ("Solid" turns it off), and always on while exploded. Outlines only for hard-surface models.
      const runtimeReady = Boolean(runtimeRoot && !assetPendingRef.current);
      const wantXray = runtimeReady && (explodeAnimator.getTarget() > 0 || explodeAnimator.isAnimating());
      if (runtimeRoot && wantXray !== xray.isOn()) {
        const rc = lifecycleManager.getRaycaster();
        const related = rc?.getRelatedHighlightIds() ?? [];
        rc?.clearAllHighlights();
        if (wantXray) {
          virtualWs.placeUnder(runtimeRoot);
          const activeDef = lifecycleManager.getActiveModel();
          xray.apply(runtimeRoot, {
            edges: activeDef?.hologramEdges !== false,
            edgeAngle: activeDef?.xrayEdgeAngle,
            contextIds: activeDef?.contextComponentIds ?? [],
          });
        } else {
          xray.restore();
        }
        rc?.setRelatedHighlight(related);
      }
      // Assembled = monochrome white technical drawing; parts take their own colours as they separate
      const colorT = Math.min(1, shownFactor / 0.6);
      xray.setColorMix(colorT * colorT * (3 - 2 * colorT));
      xray.update(30);
      xray.syncClipping();

      // Keep the whole exploded assembly in view (once per explode / reassemble, when the parts have
      // settled). Keyed on the settled TARGET, not on "animation just ended", so it also works when
      // frames are sparse (background tab) and the animation completes within one frame.
      const activeId = lifecycleManager.getActiveModel()?.id ?? null;
      if (activeId !== framedModelId) {
        framedModelId = activeId; // a new model starts assembled with its own default view
        framedFrom = null;
        settledTarget = 0;
        virtualWs.resetForModel();
        xray.reset();
        virtualWs.setComponents(lifecycleManager.getActiveModel()?.getAllComponentIds() ?? []);
        xray.setComponents(lifecycleManager.getActiveModel()?.getAllComponentIds() ?? []);
      }
      if (!explodeAnimator.isAnimating() && explodeAnimator.getTarget() !== settledTarget) {
        settledTarget = explodeAnimator.getTarget();
        const root = lifecycleManager.getActiveRuntime()?.rootGroup;
        const target = cameraController.controls.target;
        if (explodeAnimator.getTarget() > 0 && root) virtualWs.placeUnder(root);
        if (explodeAnimator.getTarget() > 0 && root && !cameraController.isUserInteracting()) {
          // Centre the separated assembly and back off (never zoom in) until all of it fits, with a margin for the hint bar, toolbar and
          // part labels cover the canvas edges); the user's view is put back on reassembly.
          const sphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere());
          const vfov = THREE.MathUtils.degToRad(camera.fov);
          const fov = Math.min(vfov, 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect));
          const fit = ((sphere.radius * 1.15) / Math.sin(fov / 2)) * (lifecycleManager.getActiveModel()?.explodeFrameScale ?? 1);
          const needed = Math.min(cameraController.getMaxDistance(), Math.max(cameraController.getDistance(), fit));
          // A model may ask for a particular viewing direction for its exploded layout (e.g. the eye
          // is viewed across its optical axis so its layers read as a row)
          const preferred = lifecycleManager.getActiveModel()?.explodeViewDirection;
          const dir = preferred ? new THREE.Vector3(...preferred).normalize() : camera.position.clone().sub(target).normalize();
          framedFrom = { position: camera.position.clone(), target: target.clone(), distance: needed };
          cameraController.animateTo(sphere.center.clone().add(dir.multiplyScalar(needed)), sphere.center.clone());
        } else if (explodeAnimator.getTarget() === 0 && framedFrom) {
          // Back to the assembled view the user had, unless they moved the camera meanwhile
          if (Math.abs(cameraController.getDistance() - framedFrom.distance) < framedFrom.distance * 0.05) {
            cameraController.animateTo(framedFrom.position, framedFrom.target);
          }
          framedFrom = null;
        }
      }

      // --- Milestone C: part names, only while fully exploded; fade out when reassembly starts ---
      const phase = labelPhase(explodeAnimator.getTarget(), shownFactor, labelsShown);
      labelsShown = phase === 'shown' || (phase === 'fadingOut' && labelMix > 0);
      labelMix = approach(labelMix, phase === 'shown' ? 1 : 0, 4, delta);
      updateLabels(phase !== 'hidden' || labelMix > 0);

      // Command arbitration: hands/mouse win over command transitions; flush deferred commands
      commandExecutor.tick();

      // Component Raycasting & Dwell Selection
      let candidateNdc: { x: number; y: number } | null = null;
      let isGesturePointing = false;
      let pointingPixelPos: { x: number; y: number } | null = null;

      const activeGesture = gestureResultRef.current;
      const activeHands = handsRef.current;

      if (
        !th.engaged &&
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
      pointedRef.current = {
        componentId: selectorResult.hoveredId,
        source: selectorResult.hoveredId ? (isGesturePointing ? 'gesture' : 'mouse') : null,
      };

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
      unregisterHandler?.();
      unregisterContext?.();
      commandExecutor.clearPending();
      gestureCameraController.dispose();
      virtualWs.dispose();
      xray.dispose();

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
      scene.environment?.dispose();
      renderer.dispose();
    };
  }, [initError, onFpsUpdate, onTelemetryUpdate, watchAssetLoad]);

  // Dynamic model switching effect (Phase 9 - Task 9.3)
  useEffect(() => {
    if (lifecycleManagerRef.current) {
      const targetId = modelId || PLANETARY_GEARBOX_MODEL_ID;
      if (lifecycleManagerRef.current.getActiveModel()?.id !== targetId) {
        const result = lifecycleManagerRef.current.loadModel(targetId);
        explodeAnimatorRef.current.snap(0); // a new model starts assembled (no animation across models)
        if (!result.success) {
          setModelError(result.error ?? 'Failed to load model.');
        } else {
          setModelError(null);
          watchAssetLoad();
          onSelectComponentRef.current?.(null);
        }
      }
    }
  }, [modelId, watchAssetLoad]);

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

  // Learning views: cutaway (real section) and overlays, applied on the active runtime; reset on model change
  const [cutawayOn, setCutawayOn] = useState(false);
  const [overlaysOn, setOverlaysOn] = useState<Record<string, boolean>>({});
  const [animSpeed, setAnimSpeed] = useState(1);
  const toggleCutaway = () => {
    const next = !cutawayOn;
    lifecycleManagerRef.current?.getActiveRuntime()?.setCutaway?.(next);
    setCutawayOn(next);
  };
  const toggleOverlay = (id: string) => {
    const next = !overlaysOn[id];
    lifecycleManagerRef.current?.getActiveRuntime()?.setOverlay?.(id, next);
    setOverlaysOn((o) => ({ ...o, [id]: next }));
  };
  const [viewsModelId, setViewsModelId] = useState(modelId);
  if (viewsModelId !== modelId) {
    // a new model starts without section, overlays or speed changes
    setViewsModelId(modelId);
    setCutawayOn(false);
    setOverlaysOn({});
    setAnimSpeed(1);
  }

  // Anatomy "inside" view: active when every outer component is hidden
  const activeDefinition = modelRegistry.getModel(modelId || PLANETARY_GEARBOX_MODEL_ID);
  const insideIds = activeDefinition?.insideView?.hideComponentIds;
  const hiddenSet = hiddenComponentIds instanceof Set ? hiddenComponentIds : new Set(hiddenComponentIds ?? []);
  const insideActive = Boolean(insideIds?.length && insideIds.every((id) => hiddenSet.has(id)));

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
          <div className="error-icon"><Icon name="alert" size={28} /></div>
          <h3>WebGL Initialization Error</h3>
          <p>{initError}</p>
        </div>
      )}

      {/* Model Loading Error Overlay (Phase 9 - Task 9.3) */}
      {!initError && modelError && (
        <div className="viewport-overlay error-overlay" role="alert">
          <div className="error-icon"><Icon name="alert" size={28} /></div>
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

      {/* Viewport toolbar, grouped: View | Motion | Display | Assembly. Every button keeps its
          existing handler; Explode / Reassemble goes through the same dispatcher as the X key. */}
      {!initError && !modelError && (
        <div className="viewport-controls-toolbar" role="toolbar" aria-label="Viewport tools">
          <div className="toolbar-group preset-group" role="group" aria-label="Camera Presets">
            <button
              type="button"
              className={`toolbar-btn preset-btn ${activePreset === 'isometric' ? 'active' : ''}`}
              onClick={() => handleSelectPreset('isometric')}
              title="Isometric view (1)"
              aria-label="Switch to Isometric View"
              aria-pressed={activePreset === 'isometric'}
            >
              <Icon name="cube" size={15} /><span className="btn-label">Iso</span>
            </button>
            <button
              type="button"
              className={`toolbar-btn preset-btn ${activePreset === 'top' ? 'active' : ''}`}
              onClick={() => handleSelectPreset('top')}
              title="Top view (2)"
              aria-label="Switch to Top View"
              aria-pressed={activePreset === 'top'}
            >
              <Icon name="viewTop" size={15} /><span className="btn-label">Top</span>
            </button>
            <button
              type="button"
              className={`toolbar-btn preset-btn ${activePreset === 'front' ? 'active' : ''}`}
              onClick={() => handleSelectPreset('front')}
              title="Front view (3)"
              aria-label="Switch to Front View"
              aria-pressed={activePreset === 'front'}
            >
              <Icon name="viewFront" size={15} /><span className="btn-label">Front</span>
            </button>
            <button
              type="button"
              className="toolbar-btn icon-only"
              onClick={handleResetCamera}
              title="Reset the view (R)"
              aria-label="Reset camera viewpoint"
            >
              <Icon name="reset" size={15} />
            </button>
          </div>

          <div className="toolbar-group" role="group" aria-label="Motion">
            <button
              type="button"
              className={`toolbar-btn ${autoRotate ? 'active' : ''}`}
              onClick={() =>
                setAutoRotate((prev) => {
                  // Preserved behaviour: this button pauses/resumes both auto-orbit and the model animation
                  animationPlayingRef.current = !prev;
                  return !prev;
                })
              }
              title={autoRotate ? 'Pause rotation and motion' : 'Start rotation and motion'}
              aria-label="Toggle animation rotation and auto-orbit"
              aria-pressed={autoRotate}
            >
              <Icon name={autoRotate ? 'pause' : 'play'} size={15} />
              <span className="btn-label">{autoRotate ? 'Pause' : 'Rotate'}</span>
            </button>
            {/* Animated mechanisms (steam engine): speed and reset; play/pause is the button above */}
            {activeDefinition?.animationControls ? (
              <>
                <select
                  className="toolbar-btn toolbar-select"
                  value={animSpeed}
                  onChange={(e) => {
                    const speed = Number(e.target.value);
                    setAnimSpeed(speed);
                    commandDispatcher?.dispatch({ type: 'animation.setSpeed', speed }, 'ui');
                  }}
                  aria-label="Animation speed"
                  title="Animation speed"
                >
                  {[0.25, 0.5, 1, 2].map((v) => <option key={v} value={v}>{v}×</option>)}
                </select>
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={() => lifecycleManagerRef.current?.getActiveRuntime()?.resetAnimation?.()}
                  title="Put the mechanism back to its starting position"
                  aria-label="Reset motion"
                >
                  <Icon name="reset" size={15} /><span className="btn-label">Reset motion</span>
                </button>
              </>
            ) : null}
          </div>

          {(explodedFactor === 0 || activeDefinition?.cutaway || (insideIds && insideIds.length > 0) || (activeDefinition?.overlays?.length ?? 0) > 0) && (
            <div className="toolbar-group" role="group" aria-label="Display">
              {explodedFactor === 0 && <button
                type="button"
                className={`toolbar-btn ${gridVisible ? 'active' : ''}`}
                onClick={() => setGridVisible((prev) => !prev)}
                title={gridVisible ? 'Hide the ground grid' : 'Show the ground grid'}
                aria-label="Toggle ground reference grid"
                aria-pressed={gridVisible}
              >
                <Icon name="grid" size={15} /><span className="btn-label">Grid</span>
              </button>}

              {/* Learning views declared by the model (only shown when the model supports them) */}
              {activeDefinition?.cutaway && (
                <button
                  type="button"
                  className={`toolbar-btn ${cutawayOn ? 'active' : ''}`}
                  onClick={() => toggleCutaway()}
                  title="Real section view: cut the model open to see inside"
                  aria-label={`${activeDefinition.cutaway.label} view`}
                  aria-pressed={cutawayOn}
                >
                  <Icon name="cut" size={15} /><span className="btn-label">{activeDefinition.cutaway.label}</span>
                </button>
              )}
              {insideIds && insideIds.length > 0 && (
                <button
                  type="button"
                  className={`toolbar-btn ${insideActive ? 'active' : ''}`}
                  onClick={() => commandDispatcher?.dispatch(
                    { type: 'component.visibility', componentIds: insideIds, visible: insideActive }, 'ui')}
                  title={insideActive ? 'Show every part again' : `Show only: ${activeDefinition?.insideView?.label ?? 'inside'}`}
                  aria-label={insideActive ? 'Show every part' : `Show ${activeDefinition?.insideView?.label ?? 'inside'} only`}
                  aria-pressed={insideActive}
                >
                  <Icon name="eye" size={15} /><span className="btn-label">{activeDefinition?.insideView?.label ?? 'Inside view'}</span>
                </button>
              )}
              {activeDefinition?.overlays?.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`toolbar-btn ${overlaysOn[o.id] ? 'active' : ''}`}
                  onClick={() => toggleOverlay(o.id)}
                  aria-pressed={Boolean(overlaysOn[o.id])}
                  title={o.note}
                >
                  <Icon name="layers" size={15} /><span className="btn-label">{o.label}</span>
                </button>
              ))}
            </div>
          )}

          {onToggleExplode && (
            <div className="toolbar-group toolbar-group-primary" role="group" aria-label="Assembly">
              <button
                type="button"
                className={`toolbar-btn explode-btn ${explodedFactor > 0 ? 'active' : ''}`}
                onClick={onToggleExplode}
                title={explodedFactor > 0 ? 'Put the parts back together (X)' : 'Separate the parts (X)'}
                aria-label={explodedFactor > 0 ? 'Reassemble the model' : 'Explode the model'}
                aria-pressed={explodedFactor > 0}
              >
                <Icon name={explodedFactor > 0 ? 'collapse' : 'explode'} size={15} />
                <span className="btn-label">{explodedFactor > 0 ? 'Reassemble' : 'Explode'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Asset loading (eye GLB) */}
      {!initError && !modelError && assetLoading && (
        <div className="viewport-overlay loading-overlay" role="status" aria-live="polite">
          <div className="pip-spinner" aria-hidden="true" />
          <p>Loading the 3D model: {assetLoading}…</p>
        </div>
      )}

      {/* Overlay notes (e.g. "illustration only, not a structural analysis") */}
      {!initError && !modelError && explodedFactor === 0 && activeDefinition?.overlays?.filter((o) => overlaysOn[o.id]).map((o) => (
        <div key={o.id} className="overlay-note" role="note">{o.note}</div>
      ))}

      {/* Licence credit for models built from an attributed asset (CC BY) */}
      {!initError && !modelError && activeDefinition?.attribution && (
        <div className="model-attribution">{activeDefinition.attribution}</div>
      )}

      {/* Milestone C: exploded-view part names (positioned by the render loop) */}
      <div ref={labelLayerRef} className="exploded-label-layer" aria-hidden="true" style={{ display: 'none' }} />

      {/* Milestone C: two-hand gesture feedback (text, not colour alone) */}
      {!initError && !modelError && twoHand.engaged && (
        <div className={`two-hand-status state-${twoHand.state.toLowerCase()}`} role="status" aria-live="polite">
          {twoHand.state === 'ASSEMBLED' && 'Two hands: pinch both to get ready'}
          {twoHand.state === 'PINCH_ARMED' && 'Ready: spread your fingers to separate the parts'}
          {twoHand.state === 'EXPLODING' && 'Separating the parts…'}
          {twoHand.state === 'EXPLODED' && 'Two hands: pinch both to put the parts back'}
          {twoHand.state === 'REASSEMBLING' && 'Putting the parts back…'}
          {twoHand.state === 'TRACKING_LOST' && 'Hands lost: show both hands to continue'}
        </div>
      )}
    </div>
  );
};

export default ViewerCanvas;
