import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type CameraPreset = 'isometric' | 'top' | 'front';

export interface CameraPresetConfig {
  id: CameraPreset;
  name: string;
  position: THREE.Vector3;
  target: THREE.Vector3;
  description: string;
}

export const CAMERA_PRESETS: Record<CameraPreset, CameraPresetConfig> = {
  isometric: {
    id: 'isometric',
    name: 'Isometric',
    position: new THREE.Vector3(4.5, 4.2, 5.5),
    target: new THREE.Vector3(0, 0, 0),
    description: 'Elevated 3D angle displaying all mechanical stages simultaneously.',
  },
  top: {
    id: 'top',
    name: 'Top View',
    position: new THREE.Vector3(0, 7.8, 0.001),
    target: new THREE.Vector3(0, 0, 0),
    description: 'Direct overhead view showcasing gear tooth engagement and pitch diameters.',
  },
  front: {
    id: 'front',
    name: 'Front View',
    position: new THREE.Vector3(0, 0.4, 7.2),
    target: new THREE.Vector3(0, 0, 0),
    description: 'Horizontal profile view showing carrier standoffs, pins, and output shaft.',
  },
};

/** All named views reachable by commands: the three fixed presets plus orbit-relative sides. */
export type CameraView = CameraPreset | 'back' | 'left' | 'right';

/**
 * Directions (from target towards camera) for side views. They keep the current target and
 * distance, so they work for any model size. A slight elevation keeps the ground grid readable.
 */
const SIDE_VIEW_DIRECTIONS: Record<'back' | 'left' | 'right', THREE.Vector3> = {
  back: new THREE.Vector3(0, 0.06, -1).normalize(),
  left: new THREE.Vector3(-1, 0.06, 0).normalize(),
  right: new THREE.Vector3(1, 0.06, 0).normalize(),
};

/** Default duration of command-driven camera transitions (ms). */
export const DEFAULT_TRANSITION_MS = 350;

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

interface CameraTransition {
  startMs: number;
  durationMs: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromSph: THREE.Spherical;
  toSph: THREE.Spherical;
  /** Auto-orbit state to restore when the transition ends or is cancelled. */
  restoreAutoRotate: boolean;
}

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface CameraControllerOptions {
  enableDamping?: boolean;
  dampingFactor?: number;
  minDistance?: number;
  maxDistance?: number;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  onPresetChange?: (preset: CameraView) => void;
}

/**
 * Dedicated CameraController managing OrbitControls, view presets, damping, and keyboard shortcuts.
 */
export class CameraController {
  public readonly controls: OrbitControls;
  public readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private activePreset: CameraPreset = 'isometric';
  private readonly onPresetChange?: (preset: CameraView) => void;
  private isInteracting: boolean = false;
  private transition: CameraTransition | null = null;

  // Keydown event handler ref for cleanup
  private readonly handleKeyDownBound: (e: KeyboardEvent) => void;
  private readonly onControlsStartBound: () => void;
  private readonly onControlsEndBound: () => void;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    options: CameraControllerOptions = {}
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.onPresetChange = options.onPresetChange;

    // Initialize Three.js OrbitControls
    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.enableDamping = options.enableDamping ?? true;
    this.controls.dampingFactor = options.dampingFactor ?? 0.05;
    this.controls.minDistance = options.minDistance ?? 2.0;
    this.controls.maxDistance = options.maxDistance ?? 25.0;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.1; // Limit angle to prevent viewing underneath the ground plane
    this.controls.target.set(0, 0, 0);

    this.controls.autoRotate = options.autoRotate ?? true;
    this.controls.autoRotateSpeed = options.autoRotateSpeed ?? 1.0;

    // Set initial position to default isometric preset
    this.applyPresetDirect('isometric');

    // Register OrbitControls start/end interaction events to detect active mouse drag
    this.onControlsStartBound = () => {
      this.isInteracting = true;
    };
    this.onControlsEndBound = () => {
      this.isInteracting = false;
    };
    this.controls.addEventListener('start', this.onControlsStartBound);
    this.controls.addEventListener('end', this.onControlsEndBound);

    // Register keyboard listener ('R' to reset, '1'-'3' for presets)
    this.handleKeyDownBound = this.handleKeyDown.bind(this);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDownBound);
    }
  }

  /**
   * Applies a preset view position and updates OrbitControls target.
   */
  public setPreset(preset: CameraPreset): void {
    const config = CAMERA_PRESETS[preset];
    if (!config) return;

    this.cancelTransition(); // an explicit instant preset (key/button) wins over a running transition
    this.activePreset = preset;
    this.applyPresetDirect(preset);
    this.onPresetChange?.(preset);
  }

  /**
   * Directly sets the camera position and target vectors.
   */
  private applyPresetDirect(preset: CameraPreset): void {
    const config = CAMERA_PRESETS[preset];
    this.camera.position.copy(config.position);
    this.controls.target.copy(config.target);
    this.controls.update();
  }

  /**
   * Resets the camera to the default isometric view.
   */
  public reset(): void {
    this.setPreset('isometric');
  }

  /**
   * Toggles or sets auto-rotation.
   * During a command transition auto-orbit is suspended; the request is remembered and
   * applied when the transition ends, so gesture pause/restore logic stays correct.
   */
  public setAutoRotate(enabled: boolean): void {
    if (this.transition) {
      this.transition.restoreAutoRotate = enabled;
      return;
    }
    this.controls.autoRotate = enabled;
  }

  /**
   * Gets the intended auto-rotate state (including while a transition temporarily suspends it).
   */
  public isAutoRotating(): boolean {
    return this.transition ? this.transition.restoreAutoRotate : this.controls.autoRotate;
  }

  /**
   * Task V3: names the view the camera is actually looking from (by viewing direction, within
   * `toleranceDeg`), or 'custom' after free orbiting. Unlike getActivePreset() this never goes
   * stale when the user drags the camera. Uses the transition goal while a transition runs.
   */
  public classifyView(toleranceDeg = 10): CameraView | 'custom' {
    const pose = this.getGoalPose();
    const dir = new THREE.Vector3().subVectors(pose.position, pose.target);
    if (dir.lengthSq() < 1e-9) return 'custom';
    dir.normalize();
    const candidates: [CameraView, THREE.Vector3][] = [
      ...(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map(
        (p) => [p, new THREE.Vector3().subVectors(CAMERA_PRESETS[p].position, CAMERA_PRESETS[p].target).normalize()] as [CameraView, THREE.Vector3]
      ),
      ...(Object.keys(SIDE_VIEW_DIRECTIONS) as ('back' | 'left' | 'right')[]).map(
        (v) => [v, SIDE_VIEW_DIRECTIONS[v]] as [CameraView, THREE.Vector3]
      ),
    ];
    const cosTol = Math.cos(THREE.MathUtils.degToRad(toleranceDeg));
    let best: CameraView | 'custom' = 'custom';
    let bestDot = cosTol;
    for (const [view, v] of candidates) {
      const d = dir.dot(v);
      if (d >= bestDot) {
        bestDot = d;
        best = view;
      }
    }
    return best;
  }

  /**
   * Gets current active preset identifier.
   */
  public getActivePreset(): CameraPreset {
    return this.activePreset;
  }

  /**
   * Must be called in the render loop to update damping, auto-rotation and any
   * command-driven transition. `now` (ms) is injectable for deterministic tests.
   */
  public update(now: number = nowMs()): void {
    if (this.transition) this.stepTransition(now);
    this.controls.update();
  }

  /* ---------------- Smooth, command-driven camera motion (Task V1) ---------------- */

  /** True while a command-driven transition is animating. */
  public isTransitioning(): boolean {
    return this.transition !== null;
  }

  /**
   * Stops a running transition where it is (the user took over) and restores auto-orbit intent.
   */
  public cancelTransition(): void {
    if (!this.transition) return;
    const restore = this.transition.restoreAutoRotate;
    this.transition = null;
    this.controls.autoRotate = restore;
  }

  /** The pose the camera is heading to (end of a running transition) or its current pose. */
  public getGoalPose(): CameraPose {
    if (this.transition) {
      const t = this.transition;
      return {
        target: t.toTarget.clone(),
        position: new THREE.Vector3().setFromSpherical(t.toSph).add(t.toTarget),
      };
    }
    return { position: this.camera.position.clone(), target: this.controls.target.clone() };
  }

  /**
   * Smoothly moves camera and target to a pose. Interpolates in spherical coordinates around the
   * target so the camera arcs around the model instead of cutting through it. Distance and
   * elevation are clamped to the controls' limits. durationMs <= 0 jumps immediately.
   */
  public animateTo(position: THREE.Vector3, target: THREE.Vector3, durationMs = DEFAULT_TRANSITION_MS, now = nowMs()): void {
    const restoreAutoRotate = this.isAutoRotating();
    const fromTarget = this.controls.target.clone();
    const fromSph = new THREE.Spherical().setFromVector3(new THREE.Vector3().subVectors(this.camera.position, fromTarget));
    const toSph = new THREE.Spherical().setFromVector3(new THREE.Vector3().subVectors(position, target));
    toSph.radius = THREE.MathUtils.clamp(toSph.radius, this.controls.minDistance, this.controls.maxDistance);
    // Tiny lower bound only avoids the pole singularity; the top preset itself sits at ~1.3e-4 rad
    toSph.phi = THREE.MathUtils.clamp(toSph.phi, 1e-4, this.controls.maxPolarAngle);
    // Take the shortest way around
    let dTheta = toSph.theta - fromSph.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    toSph.theta = fromSph.theta + dTheta;

    this.controls.autoRotate = false;
    this.transition = {
      startMs: now,
      durationMs: Math.max(0, durationMs),
      fromTarget,
      toTarget: target.clone(),
      fromSph,
      toSph,
      restoreAutoRotate,
    };
    if (durationMs <= 0) this.stepTransition(now);
  }

  private stepTransition(now: number): void {
    const t = this.transition;
    if (!t) return;
    const raw = t.durationMs === 0 ? 1 : THREE.MathUtils.clamp((now - t.startMs) / t.durationMs, 0, 1);
    const e = easeInOutCubic(raw);
    this.controls.target.lerpVectors(t.fromTarget, t.toTarget, e);
    const sph = new THREE.Spherical(
      THREE.MathUtils.lerp(t.fromSph.radius, t.toSph.radius, e),
      THREE.MathUtils.lerp(t.fromSph.phi, t.toSph.phi, e),
      THREE.MathUtils.lerp(t.fromSph.theta, t.toSph.theta, e)
    );
    this.camera.position.setFromSpherical(sph).add(this.controls.target);
    this.camera.lookAt(this.controls.target);
    if (raw >= 1) {
      this.transition = null;
      this.controls.autoRotate = t.restoreAutoRotate;
    }
  }

  /** Orbits around the target. Positive yaw orbits counter-clockwise seen from above;
   *  positive pitch raises the camera. Builds on the goal pose so repeated commands accumulate. */
  public orbitBy(yawRad: number, pitchRad: number, durationMs = DEFAULT_TRANSITION_MS, now = nowMs()): void {
    const goal = this.getGoalPose();
    const sph = new THREE.Spherical().setFromVector3(new THREE.Vector3().subVectors(goal.position, goal.target));
    sph.theta += yawRad;
    sph.phi = THREE.MathUtils.clamp(sph.phi - pitchRad, 0.05, this.controls.maxPolarAngle);
    this.animateTo(new THREE.Vector3().setFromSpherical(sph).add(goal.target), goal.target, durationMs, now);
  }

  /** Slides camera and target together in screen space. Amounts are fractions of the viewing
   *  distance (+right, +up). The target is kept within reach of the model. */
  public panBy(rightFraction: number, upFraction: number, durationMs = DEFAULT_TRANSITION_MS, now = nowMs()): void {
    const goal = this.getGoalPose();
    const offset = new THREE.Vector3().subVectors(goal.position, goal.target);
    const dist = offset.length();
    const forward = offset.clone().negate().normalize();
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0); // looking straight down
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const delta = right.multiplyScalar(rightFraction * dist).add(up.multiplyScalar(upFraction * dist));
    const newTarget = goal.target.clone().add(delta);
    const limit = this.controls.maxDistance * 0.4;
    if (newTarget.length() > limit) newTarget.setLength(limit);
    this.animateTo(newTarget.clone().add(offset), newTarget, durationMs, now);
  }

  /** Multiplies the viewing distance by `factor` (< 1 zooms in), clamped to the limits. */
  public zoomSmooth(factor: number, durationMs = DEFAULT_TRANSITION_MS, now = nowMs()): void {
    const goal = this.getGoalPose();
    const offset = new THREE.Vector3().subVectors(goal.position, goal.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance));
    this.animateTo(goal.target.clone().add(offset), goal.target, durationMs, now);
  }

  /** Smoothly moves to a named view. Presets use their fixed poses (as the toolbar does);
   *  back/left/right keep the current target and distance. */
  public goToView(view: CameraView, durationMs = DEFAULT_TRANSITION_MS, now = nowMs()): void {
    if (view === 'isometric' || view === 'top' || view === 'front') {
      const config = CAMERA_PRESETS[view];
      this.activePreset = view;
      this.animateTo(config.position, config.target, durationMs, now);
    } else {
      const goal = this.getGoalPose();
      const dist = goal.position.distanceTo(goal.target);
      const position = goal.target.clone().addScaledVector(SIDE_VIEW_DIRECTIONS[view], dist);
      this.animateTo(position, goal.target, durationMs, now);
    }
    this.onPresetChange?.(view);
  }

  /** Pose that frames a bounding box (same framing maths as focusOnBounds). */
  public getFocusPose(box: THREE.Box3, offsetRatio = 1.6): CameraPose | null {
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.1);
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const cameraDistance = THREE.MathUtils.clamp(
      (maxDim / 2 / Math.tan(fovRad / 2)) * offsetRatio,
      this.controls.minDistance,
      this.controls.maxDistance
    );
    const goal = this.getGoalPose();
    const direction = new THREE.Vector3().subVectors(goal.position, goal.target).normalize();
    if (direction.lengthSq() < 1e-4) direction.set(0.7, 0.5, 0.7).normalize();
    return { target: center, position: center.clone().addScaledVector(direction, cameraDistance) };
  }

  /**
   * Adjusts the camera distance relative to controls.target by delta.
   * Positive delta zooms in (moves camera closer), negative zooms out (moves camera farther).
   * Clamped to [minDistance, maxDistance].
   * Returns the new distance.
   */
  public zoomBy(delta: number): number {
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const currentDist = offset.length();
    if (currentDist === 0) return 0;
    const newDist = THREE.MathUtils.clamp(
      currentDist - delta,
      this.controls.minDistance,
      this.controls.maxDistance
    );
    offset.setLength(newDist);
    this.camera.position.addVectors(this.controls.target, offset);
    this.controls.update();
    return newDist;
  }

  /**
   * Focuses camera and OrbitControls target on a given 3D bounding box.
   */
  public focusOnBounds(box: THREE.Box3, offsetRatio = 1.6): void {
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.1);
    const fovRad = (this.camera.fov * Math.PI) / 180;
    let cameraDistance = (maxDim / 2 / Math.tan(fovRad / 2)) * offsetRatio;
    cameraDistance = THREE.MathUtils.clamp(
      cameraDistance,
      this.controls.minDistance,
      this.controls.maxDistance
    );

    const direction = new THREE.Vector3()
      .subVectors(this.camera.position, this.controls.target)
      .normalize();

    if (direction.lengthSq() < 1e-4) {
      direction.set(0.7, 0.5, 0.7).normalize();
    }

    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, cameraDistance);
    this.controls.update();
  }

  /**
   * Gets current distance between camera and controls.target.
   */
  public getDistance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  /**
   * Gets minDistance configured in controls.
   */
  public getMinDistance(): number {
    return this.controls.minDistance;
  }

  /**
   * Gets maxDistance configured in controls.
   */
  public getMaxDistance(): number {
    return this.controls.maxDistance;
  }

  /**
   * Returns true if user is actively dragging or interacting via mouse/touch controls.
   */
  public isUserInteracting(): boolean {
    const internalState = (this.controls as unknown as { state?: number }).state;
    return this.isInteracting || (internalState !== undefined && internalState !== -1);
  }

  /**
   * Keyboard shortcuts handling.
   * 'R' / 'r' -> Reset to isometric view
   * '1' -> Isometric, '2' -> Top, '3' -> Front
   */
  private handleKeyDown(e: KeyboardEvent): void {
    // Ignore input if user is focusing an input element
    const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    if (targetTag === 'input' || targetTag === 'textarea') return;

    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      this.reset();
    } else if (e.key === '1') {
      this.setPreset('isometric');
    } else if (e.key === '2') {
      this.setPreset('top');
    } else if (e.key === '3') {
      this.setPreset('front');
    }
  }

  /**
   * Cleans up event listeners and disposes OrbitControls.
   */
  public dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeyDownBound);
    }
    this.controls.removeEventListener('start', this.onControlsStartBound);
    this.controls.removeEventListener('end', this.onControlsEndBound);
    this.controls.dispose();
  }
}
