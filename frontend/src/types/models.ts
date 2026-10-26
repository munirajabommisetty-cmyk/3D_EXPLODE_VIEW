/**
 * Engineering Model Definitions & CAD Assembly Hierarchy Schemas
 * Phase 9 - Task 9.1: Polymorphic Engineering Domain Schemas & Model Contracts
 *
 * Defines structural contracts for multi-model registration, CAD assembly trees,
 * camera viewpoint configurations, and model runtime instances.
 */

import type { Group, Scene } from 'three';
import type {
  EngineeringDomain,
  EngineeringComponentMetadata,
} from './engineering';

/**
 * Camera preset identifier
 */
export type CameraPresetType = 'isometric' | 'front' | 'top' | 'side';

/**
 * Camera viewpoint configuration tailored per engineering model
 */
export interface ModelCameraConfig {
  initialPosition: [number, number, number];
  target: [number, number, number];
  minDistance: number;
  maxDistance: number;
  fov?: number;
  defaultPreset?: CameraPresetType;
}

/**
 * CAD-style hierarchical assembly tree node.
 * Represents nested sub-assemblies and selectable component meshes.
 */
export interface AssemblyTreeNode {
  id: string;
  name: string;
  type: 'assembly' | 'subassembly' | 'component';
  /**
   * Component ID linking this tree node to the 3D mesh `userData.componentId`.
   * Only leaf components require this link, but subassemblies may optionally provide one.
   */
  componentId?: string;
  children?: AssemblyTreeNode[];
  defaultExpanded?: boolean;
  defaultVisible?: boolean;
}

/**
 * Runtime instance created when a model is built and mounted in Three.js
 */
export interface ModelRuntimeInstance {
  /**
   * Root Three.js Group hosting all model meshes
   */
  rootGroup: Group;

  /**
   * Optional animation tick callback for kinematic models (e.g. rotating gear trains)
   */
  updateAnimation?: (deltaSeconds: number, elapsedSeconds: number) => void;

  /**
   * Optional exploded-view position interpolation (factor ranges from 0.0 [assembled] to 1.0 [fully exploded])
   */
  setExplodedFactor?: (factor: number) => void;

  /**
   * Optional component isolation handler (fading unselected parts)
   */
  isolateComponent?: (componentId: string | null) => void;

  /**
   * Mandatory resource disposal hook.
   * Explicitly disposes all model-owned geometries, materials, and textures
   * to guarantee zero WebGL memory leaks during model switching.
   */
  dispose: () => void;
}

/**
 * Difficulty level tag for model catalogue filtering
 */
export type ModelDifficulty = 'Beginner' | 'Intermediate' | 'Advanced';

/**
 * Comprehensive static definition of an engineering model.
 * Implemented by each registered model (e.g. planetary gearbox, truss bridge).
 */
export interface EngineeringModelDefinition {
  id: string;
  name: string;
  domain: EngineeringDomain;
  category: string;
  description: string;
  thumbnailUrl: string;
  difficulty: ModelDifficulty;
  tags: string[];
  componentCount: number;
  cameraConfig: ModelCameraConfig;

  /**
   * Returns the root hierarchical CAD assembly tree for the model
   */
  getAssemblyTree: () => AssemblyTreeNode;

  /**
   * Looks up engineering metadata for a component ID
   */
  getComponentMetadata: (componentId: string) => EngineeringComponentMetadata | null;

  /**
   * Returns all addressable component IDs for raycasting validation
   */
  getAllComponentIds: () => string[];

  /**
   * Procedural builder: constructs Three.js meshes and returns a disposable runtime instance
   */
  buildScene: (scene: Scene) => ModelRuntimeInstance;
}

/* ========================================================================= */
/*                              Type Guards                                  */
/* ========================================================================= */

/**
 * Safe runtime type guard for AssemblyTreeNode
 */
export function isAssemblyTreeNode(value: unknown): value is AssemblyTreeNode {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const hasValidType =
    candidate.type === 'assembly' ||
    candidate.type === 'subassembly' ||
    candidate.type === 'component';

  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || !hasValidType) {
    return false;
  }

  if (candidate.children !== undefined) {
    if (!Array.isArray(candidate.children)) {
      return false;
    }
    for (const child of candidate.children) {
      if (!isAssemblyTreeNode(child)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Safe runtime type guard for EngineeringModelDefinition
 */
export function isEngineeringModelDefinition(value: unknown): value is EngineeringModelDefinition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    (candidate.domain === 'mechanical' || candidate.domain === 'civil') &&
    typeof candidate.category === 'string' &&
    typeof candidate.description === 'string' &&
    typeof candidate.thumbnailUrl === 'string' &&
    (candidate.difficulty === 'Beginner' ||
      candidate.difficulty === 'Intermediate' ||
      candidate.difficulty === 'Advanced') &&
    Array.isArray(candidate.tags) &&
    typeof candidate.componentCount === 'number' &&
    typeof candidate.cameraConfig === 'object' &&
    candidate.cameraConfig !== null &&
    typeof candidate.getAssemblyTree === 'function' &&
    typeof candidate.getComponentMetadata === 'function' &&
    typeof candidate.getAllComponentIds === 'function' &&
    typeof candidate.buildScene === 'function'
  );
}
