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

export interface CameraControllerOptions {
  enableDamping?: boolean;
  dampingFactor?: number;
  minDistance?: number;
  maxDistance?: number;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  onPresetChange?: (preset: CameraPreset) => void;
}

/**
 * Dedicated CameraController managing OrbitControls, view presets, damping, and keyboard shortcuts.
 */
export class CameraController {
  public readonly controls: OrbitControls;
  public readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private activePreset: CameraPreset = 'isometric';
  private readonly onPresetChange?: (preset: CameraPreset) => void;
  private isInteracting: boolean = false;

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
   */
  public setAutoRotate(enabled: boolean): void {
    this.controls.autoRotate = enabled;
  }

  /**
   * Gets current auto-rotate state.
   */
  public isAutoRotating(): boolean {
    return this.controls.autoRotate;
  }

  /**
   * Gets current active preset identifier.
   */
  public getActivePreset(): CameraPreset {
    return this.activePreset;
  }

  /**
   * Must be called in the render loop to update damping and auto-rotation.
   */
  public update(): void {
    this.controls.update();
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
