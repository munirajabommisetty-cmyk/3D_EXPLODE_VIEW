/**
 * Model Lifecycle & Runtime Session Manager
 * Phase 9 - Task 9.3: Dynamic ViewerCanvas Model Switching & Safe WebGL Disposal
 *
 * Manages the mounting, animation, and safe disposal of 3D models in Three.js.
 * Guarantees that:
 * 1. Previous model runtimes are disposed cleanly before replacement.
 * 2. Shared scene fixtures (lighting, ground grid, camera) are preserved.
 * 3. Race conditions from rapid switching are safely rejected via generation checks.
 * 4. ComponentRaycaster is kept in sync with the active model's rootGroup.
 */

import * as THREE from 'three';
import type { Scene, PerspectiveCamera } from 'three';
import { modelRegistry } from '../../models/registry';
import { ComponentRaycaster } from '../../components/scene/ComponentRaycaster';
import { CameraController } from '../../components/scene/CameraController';
import type {
  EngineeringModelDefinition,
  ModelRuntimeInstance,
} from '../../types/models';

export interface ModelLifecycleOptions {
  scene: Scene;
  camera: PerspectiveCamera;
  cameraController?: CameraController | null;
  onModelLoaded?: (model: EngineeringModelDefinition) => void;
  onModelError?: (error: string) => void;
}

export interface ModelLoadResult {
  success: boolean;
  model?: EngineeringModelDefinition;
  error?: string;
}

export class ModelLifecycleManager {
  private activeRuntime: ModelRuntimeInstance | null = null;
  private activeModel: EngineeringModelDefinition | null = null;
  private raycaster: ComponentRaycaster | null = null;
  private hiddenComponentIds: Set<string> = new Set();
  private isolatedComponentId: string | null = null;
  private currentExplodedFactor = 0;
  private currentGeneration = 0;
  private isDisposed = false;
  private readonly options: ModelLifecycleOptions;

  constructor(options: ModelLifecycleOptions) {
    this.options = options;
  }

  /**
   * Loads and mounts a model by its registered ID.
   * If a previous model is active, disposes it first before mounting the replacement.
   */
  public loadModel(modelId: string): ModelLoadResult {
    if (this.isDisposed) {
      return { success: false, error: 'Cannot load model: lifecycle manager has been disposed.' };
    }

    // Increment generation to cancel any competing asynchronous operations
    const gen = ++this.currentGeneration;

    // 1. Dispose previous model runtime and its raycaster
    this.disposeCurrentRuntime();

    // 2. Resolve model definition from registry
    const modelDef = modelRegistry.getModel(modelId);
    if (!modelDef) {
      const errorMsg = `Model "${modelId}" is not registered in ModelRegistry.`;
      this.options.onModelError?.(errorMsg);
      return { success: false, error: errorMsg };
    }

    // 3. Build Three.js scene meshes
    try {
      const runtime = modelDef.buildScene(this.options.scene);

      // Guard against race conditions: if a newer request arrived while building, abort
      if (gen !== this.currentGeneration || this.isDisposed) {
        runtime.dispose();
        return { success: false, error: 'Model load superseded by newer request.' };
      }

      this.activeRuntime = runtime;
      this.activeModel = modelDef;
      this.isolatedComponentId = null;

      // 4. Bind ComponentRaycaster to the new model's rootGroup scoped to active model component IDs
      const validComponentIds = new Set(modelDef.getAllComponentIds());
      this.raycaster = new ComponentRaycaster(this.options.camera, runtime.rootGroup, {
        validComponentIds,
      });

      // 5. Apply model-specific camera configuration if available
      if (this.options.cameraController && modelDef.cameraConfig) {
        const { minDistance, maxDistance, initialPosition, target } = modelDef.cameraConfig;
        if (typeof minDistance === 'number') {
          this.options.cameraController.controls.minDistance = minDistance;
        }
        if (typeof maxDistance === 'number') {
          this.options.cameraController.controls.maxDistance = maxDistance;
        }
        if (initialPosition) {
          this.options.camera.position.set(...initialPosition);
        }
        if (target) {
          this.options.cameraController.controls.target.set(...target);
        }
        this.options.cameraController.controls.update();
      }

      // 6. Re-apply component visibility state if any components are hidden
      if (this.hiddenComponentIds.size > 0) {
        this.setHiddenComponents(this.hiddenComponentIds);
      }

      this.options.onModelLoaded?.(modelDef);
      return { success: true, model: modelDef };
    } catch (err) {
      const errorMsg = `Failed to build model "${modelId}": ${err instanceof Error ? err.message : String(err)}`;
      this.options.onModelError?.(errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Sets the hidden components for the active model.
   * Modifies only the Object3D.visible property of matching meshes without
   * disposing geometries, materials, or runtime resources.
   * If a component is actively isolated, preserves the isolation view state.
   */
  public setHiddenComponents(hiddenIds: Set<string> | ReadonlySet<string> | string[]): void {
    this.hiddenComponentIds = hiddenIds instanceof Set ? new Set(hiddenIds) : new Set(hiddenIds);
    if (!this.activeRuntime) return;

    if (this.isolatedComponentId) {
      return;
    }

    // Only objects that belong to a real component are toggled: named helpers such as an overlay
    // group (e.g. the RC frame's 'load_path_overlay') keep their own visibility
    const validIds = new Set(this.activeModel?.getAllComponentIds() ?? []);
    this.activeRuntime.rootGroup.traverse((obj) => {
      const compId = obj.userData?.componentId || obj.name;
      if (typeof compId === 'string' && validIds.has(compId)) {
        obj.visible = !this.hiddenComponentIds.has(compId);
      }
    });
  }

  /**
   * Isolates a specific component by hiding or fading all other components in the assembly.
   * Passing `null` restores normal assembly visibility according to `hiddenComponentIds`.
   */
  public isolateComponent(componentId: string | null): boolean {
    this.isolatedComponentId = componentId;
    if (!this.activeRuntime) return false;

    // 1. Delegate to active runtime's custom isolation if implemented
    if (this.activeRuntime.isolateComponent) {
      this.activeRuntime.isolateComponent(componentId);
      return true;
    }

    // 2. Generic fallback isolation via scene traversal.
    // Only objects that resolve to one of the model's real component IDs are toggled. Named
    // containers (e.g. the 'planetary_gearbox_assembly' wrapper group) are left alone — hiding
    // them would hide every child, including the isolated component itself.
    const validIds = new Set(this.activeModel?.getAllComponentIds() ?? []);
    const resolve = (obj: THREE.Object3D): string | null => {
      const compId = obj.userData?.componentId || obj.name;
      return typeof compId === 'string' && validIds.has(compId) ? compId : null;
    };
    const root = this.activeRuntime.rootGroup;

    if (componentId) {
      const isolatedObjects: THREE.Object3D[] = [];
      root.traverse((obj) => {
        const compId = resolve(obj);
        if (compId) {
          obj.visible = compId === componentId;
          if (compId === componentId) isolatedObjects.push(obj);
        }
      });
      // Every ancestor of the isolated component must be visible for it to render
      for (const obj of isolatedObjects) {
        let parent = obj.parent;
        while (parent && parent !== root.parent) {
          parent.visible = true;
          parent = parent.parent;
        }
      }
    } else {
      // Re-apply normal visibility states
      root.traverse((obj) => {
        const compId = resolve(obj);
        if (compId) {
          obj.visible = !this.hiddenComponentIds.has(compId);
        }
      });
    }
    return true;
  }

  /**
   * Returns the currently isolated component ID, or null if no component is isolated
   */
  public getIsolatedComponentId(): string | null {
    return this.isolatedComponentId;
  }

  /**
   * World-space bounding box of a component's meshes, or null if it has none in the active model.
   */
  public getComponentBounds(componentId: string): THREE.Box3 | null {
    if (!this.activeRuntime) return null;
    const box = new THREE.Box3();
    let found = false;
    this.activeRuntime.rootGroup.traverse((obj) => {
      const compId = obj.userData?.componentId || obj.name;
      if (compId === componentId && (obj as THREE.Mesh).isMesh) {
        box.expandByObject(obj);
        found = true;
      }
    });
    return found && !box.isEmpty() ? box : null;
  }

  /**
   * Focuses the camera on the 3D bounding box of the specified component.
   */
  public focusComponent(componentId: string): boolean {
    if (!this.activeRuntime || !this.options.cameraController) return false;

    const box = new THREE.Box3();
    let found = false;

    this.activeRuntime.rootGroup.traverse((obj) => {
      const compId = obj.userData?.componentId || obj.name;
      if (compId === componentId && (obj as THREE.Mesh).isMesh) {
        box.expandByObject(obj);
        found = true;
      }
    });

    if (found && !box.isEmpty()) {
      this.options.cameraController.focusOnBounds(box);
      return true;
    }

    return false;
  }

  /**
   * Returns a read-only set of currently hidden component IDs
   */
  public getHiddenComponents(): ReadonlySet<string> {
    return this.hiddenComponentIds;
  }

  /**
   * Returns the currently active model runtime instance
   */
  public getActiveRuntime(): ModelRuntimeInstance | null {
    return this.activeRuntime;
  }

  /**
   * Returns the currently active model definition
   */
  public getActiveModel(): EngineeringModelDefinition | null {
    return this.activeModel;
  }

  /**
   * Returns the active ComponentRaycaster targeting the current model's meshes
   */
  public getRaycaster(): ComponentRaycaster | null {
    return this.raycaster;
  }

  /**
   * Updates the active model's internal kinematics/animation tick
   */
  public updateAnimation(deltaSeconds: number, elapsedSeconds: number): void {
    if (this.isDisposed || !this.activeRuntime) return;
    this.activeRuntime.updateAnimation?.(deltaSeconds, elapsedSeconds);
  }

  /**
   * Updates the continuous exploded-view separation factor (0.0 = assembled, 1.0 = fully exploded)
   */
  public setExplodedFactor(factor: number): void {
    if (this.isDisposed || !this.activeRuntime) return;
    const clamped = Math.max(0, Math.min(1, factor));
    this.currentExplodedFactor = clamped;
    this.activeRuntime.setExplodedFactor?.(clamped);
  }

  /**
   * Returns the current exploded-view factor
   */
  public getExplodedFactor(): number {
    return this.currentExplodedFactor;
  }

  /**
   * Disposes the current model runtime and its raycaster without touching shared fixtures
   */
  private disposeCurrentRuntime(): void {
    if (this.raycaster) {
      this.raycaster.dispose();
      this.raycaster = null;
    }

    if (this.activeRuntime) {
      try {
        if (this.currentExplodedFactor > 0) {
          this.activeRuntime.setExplodedFactor?.(0);
        }
        this.activeRuntime.dispose();
      } catch (err) {
        console.warn('Error during model runtime disposal:', err);
      }
      this.activeRuntime = null;
      this.activeModel = null;
      this.isolatedComponentId = null;
      this.currentExplodedFactor = 0;
    }
  }

  /**
   * Full unmount cleanup: disposes the active model runtime and detaches listeners
   */
  public dispose(): void {
    this.isDisposed = true;
    this.currentGeneration++;
    this.disposeCurrentRuntime();
  }
}
