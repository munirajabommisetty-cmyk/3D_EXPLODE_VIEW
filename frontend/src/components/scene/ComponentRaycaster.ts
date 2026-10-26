/**
 * ComponentRaycaster & Mesh Highlighter
 * Task 5.1: Three.js Screen-Space Raycaster
 *
 * Implements screen-space raycasting from mouse or virtual pointing coordinates
 * into the 3D scene, resolves meshes to parent engineering component IDs,
 * and manages non-destructive emissive visual highlighting.
 */

import * as THREE from 'three';

export interface RaycasterCoordinates {
  /** Normalized Device Coordinate x in range [-1, 1] */
  x: number;
  /** Normalized Device Coordinate y in range [-1, 1] */
  y: number;
}

export interface RaycastHitResult {
  componentId: string;
  distance: number;
  point: THREE.Vector3;
  mesh: THREE.Mesh;
}

export type ComponentIdValidator =
  | ((id: string) => boolean)
  | ReadonlySet<string>
  | readonly string[];

/**
 * Traverses up the Three.js scene hierarchy from an intersected mesh
 * to resolve its parent engineering component ID.
 *
 * Rules:
 * 1. Prioritizes explicit `current.userData.componentId`.
 * 2. If a model-scoped validator is provided, ensures candidate ID is valid for the active model.
 * 3. Falls back to meaningful `current.name` only if validated against active model component IDs.
 * 4. Never assumes a global or single-model component list.
 */
export function resolveComponentId(
  object: THREE.Object3D | null,
  validator?: ComponentIdValidator
): string | null {
  let current: THREE.Object3D | null = object;

  const isValid = (id: string): boolean => {
    if (!validator) return true;
    if (typeof validator === 'function') return validator(id);
    if (validator instanceof Set) return validator.has(id);
    if (Array.isArray(validator)) return validator.includes(id);
    return true;
  };

  while (current) {
    // 1. Explicitly tagged componentId is prioritized
    if (
      current.userData &&
      typeof current.userData.componentId === 'string' &&
      current.userData.componentId.trim() !== ''
    ) {
      const candidateId = current.userData.componentId.trim();
      if (isValid(candidateId)) {
        return candidateId;
      }
    }

    // 2. Meaningful mesh name fallback (only if active validator confirms it as a valid component ID)
    if (
      current.name &&
      typeof current.name === 'string' &&
      current.name.trim() !== '' &&
      validator &&
      isValid(current.name.trim())
    ) {
      return current.name.trim();
    }

    current = current.parent;
  }

  return null;
}

export interface ComponentRaycasterOptions {
  hoverColor?: number;
  hoverIntensity?: number;
  selectedColor?: number;
  selectedIntensity?: number;
  validComponentIds?: ReadonlySet<string> | readonly string[];
  isValidComponentId?: (id: string) => boolean;
}

export const DEFAULT_RAYCASTER_OPTIONS = {
  hoverColor: 0x06b6d4, // Cyan mechanical edge glow
  hoverIntensity: 0.55,
  selectedColor: 0xf59e0b, // Amber / warm gold active selection glow
  selectedIntensity: 0.85,
};

/**
 * Manages 3D screen-space raycasting and non-destructive component highlighting.
 */
export class ComponentRaycaster {
  private readonly camera: THREE.Camera;
  private readonly rootObject: THREE.Object3D;
  private readonly raycaster: THREE.Raycaster;
  private readonly options: typeof DEFAULT_RAYCASTER_OPTIONS;

  private activeHoveredId: string | null = null;
  private activeSelectedId: string | null = null;
  private readonly validator?: (id: string) => boolean;

  // Tracks meshes currently modified by highlighting
  private readonly highlightedMeshes = new Set<THREE.Mesh>();

  constructor(
    camera: THREE.Camera,
    rootObject: THREE.Object3D,
    options: ComponentRaycasterOptions = {}
  ) {
    this.camera = camera;
    this.rootObject = rootObject;
    this.raycaster = new THREE.Raycaster();
    this.options = { ...DEFAULT_RAYCASTER_OPTIONS, ...options };

    if (options.isValidComponentId) {
      this.validator = options.isValidComponentId;
    } else if (options.validComponentIds) {
      const idSet =
        options.validComponentIds instanceof Set
          ? options.validComponentIds
          : new Set(options.validComponentIds);
      this.validator = (id: string) => idSet.has(id);
    }
  }

  /**
   * Casts a ray from normalized device coordinates (NDC) into the 3D scene.
   * Returns the first valid hit that resolves to a registered component ID.
   */
  public raycast(coords: RaycasterCoordinates): RaycastHitResult | null {
    if (!Number.isFinite(coords.x) || !Number.isFinite(coords.y)) {
      return null;
    }

    this.raycaster.setFromCamera(new THREE.Vector2(coords.x, coords.y), this.camera);
    const intersects = this.raycaster.intersectObjects(this.rootObject.children, true);

    for (const hit of intersects) {
      if ((hit.object as THREE.Mesh).isMesh) {
        const componentId = resolveComponentId(hit.object, this.validator);
        if (componentId) {
          return {
            componentId,
            distance: hit.distance,
            point: hit.point,
            mesh: hit.object as THREE.Mesh,
          };
        }
      }
    }

    return null;
  }

  /**
   * Applies hover highlighting to the specified component ID.
   * If the component is already selected, preserves selection highlighting.
   */
  public setHoverHighlight(componentId: string | null): void {
    if (this.activeHoveredId === componentId) return;

    // If an existing hover was active and it's not the currently selected component, clear it
    if (this.activeHoveredId && this.activeHoveredId !== this.activeSelectedId) {
      this.clearComponentHighlight(this.activeHoveredId);
    }

    this.activeHoveredId = componentId;

    // Apply hover glow if it's not currently selected (selection takes priority)
    if (componentId && componentId !== this.activeSelectedId) {
      this.applyComponentHighlight(
        componentId,
        this.options.hoverColor,
        this.options.hoverIntensity
      );
    }
  }

  /**
   * Applies persistent selection highlighting to the specified component ID.
   * Clears any previous selection highlight and restores original materials.
   */
  public setSelectionHighlight(componentId: string | null): void {
    if (this.activeSelectedId === componentId) return;

    // Clear previous selected component highlight
    if (this.activeSelectedId) {
      this.clearComponentHighlight(this.activeSelectedId);
    }

    this.activeSelectedId = componentId;

    // If clearing selection, re-apply hover if mouse is still over a component
    if (!componentId) {
      if (this.activeHoveredId) {
        this.applyComponentHighlight(
          this.activeHoveredId,
          this.options.hoverColor,
          this.options.hoverIntensity
        );
      }
      return;
    }

    // Apply vibrant selection highlight
    this.applyComponentHighlight(
      componentId,
      this.options.selectedColor,
      this.options.selectedIntensity
    );
  }

  /**
   * Applies an emissive highlight color to all meshes belonging to a component ID.
   * Clones each mesh's material so shared materials on other parts remain untouched.
   */
  private applyComponentHighlight(
    componentId: string,
    colorHex: number,
    intensity: number
  ): void {
    this.rootObject.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && resolveComponentId(mesh, this.validator) === componentId) {
        if (!mesh.userData._originalMaterial) {
          mesh.userData._originalMaterial = mesh.material;
        }

        // Clone material to avoid mutating other components sharing the same material
        if (mesh.userData._originalMaterial instanceof THREE.MeshStandardMaterial) {
          const clonedMat = mesh.userData._originalMaterial.clone() as THREE.MeshStandardMaterial;
          clonedMat.emissive = new THREE.Color(colorHex);
          clonedMat.emissiveIntensity = intensity;
          mesh.material = clonedMat;
          this.highlightedMeshes.add(mesh);
        }
      }
    });
  }

  /**
   * Restores original materials to all meshes belonging to a specific component ID.
   */
  private clearComponentHighlight(componentId: string): void {
    this.rootObject.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && resolveComponentId(mesh, this.validator) === componentId) {
        if (mesh.userData._originalMaterial) {
          // Dispose the temporary highlight material
          if (mesh.material && mesh.material !== mesh.userData._originalMaterial) {
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach((m) => m.dispose());
            } else {
              mesh.material.dispose();
            }
          }

          mesh.material = mesh.userData._originalMaterial;
          delete mesh.userData._originalMaterial;
          this.highlightedMeshes.delete(mesh);
        }
      }
    });
  }

  /**
   * Restores all modified meshes back to their original materials and disposes cloned materials.
   */
  public clearAllHighlights(): void {
    for (const mesh of this.highlightedMeshes) {
      if (mesh.userData._originalMaterial) {
        if (mesh.material && mesh.material !== mesh.userData._originalMaterial) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material.dispose();
          }
        }
        mesh.material = mesh.userData._originalMaterial;
        delete mesh.userData._originalMaterial;
      }
    }
    this.highlightedMeshes.clear();
    this.activeHoveredId = null;
    this.activeSelectedId = null;
  }

  public getActiveHoveredId(): string | null {
    return this.activeHoveredId;
  }

  public getActiveSelectedId(): string | null {
    return this.activeSelectedId;
  }

  public dispose(): void {
    this.clearAllHighlights();
  }
}

export default ComponentRaycaster;
