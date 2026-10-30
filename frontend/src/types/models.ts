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
   * Set when the model's geometry loads asynchronously from an asset file (e.g. the brain GLB).
   * Resolves when every mesh is in rootGroup; rejects with a user-readable message on failure.
   */
  ready?: Promise<void>;

  /** Real section view: clips the model with a plane so internal structures can be seen. */
  setCutaway?: (on: boolean) => void;

  /** Toggles an educational overlay (e.g. a load-path illustration) declared in `overlays`. */
  setOverlay?: (overlayId: string, on: boolean) => void;

  /** Puts animated mechanisms back to their initial state (e.g. crank angle 0). */
  resetAnimation?: () => void;

  /**
   * Mandatory resource disposal hook.
   * Explicitly disposes all model-owned geometries, materials, and textures
   * to guarantee zero WebGL memory leaks during model switching.
   */
  dispose: () => void;
}

/**
 * A physically meaningful animation a model can actually play (e.g. a gear train turning).
 * Declared explicitly so commands (and later the AI teacher) can only request animations
 * that really exist — an `updateAnimation` hook alone is not proof (it may be a no-op).
 */
export interface ModelAnimationCapability {
  id: string;
  label: string;
  description: string;
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
   * Animations this model genuinely supports. Omitted or empty = no playable animation.
   */
  animations?: ModelAnimationCapability[];

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

  /** The model loads a large asset file: build it only in the workspace (no live dashboard preview). */
  loadsExternalAsset?: boolean;

  /** Licence / source credit shown with the model (required for CC BY assets). */
  attribution?: string;

  /** Components hidden by the "Inside" learning view to reveal deep structures. */
  insideView?: { hideComponentIds: string[]; label?: string };

  /** Listed in the student catalogue (default true). Retired models stay registered for tests. */
  inCatalogue?: boolean;

  /** The runtime supports a real section view (setCutaway); the label names it in the toolbar. */
  cutaway?: { label: string };

  /** Educational overlays the runtime can show (setOverlay); `note` is shown while it is on. */
  overlays?: { id: string; label: string; note: string }[];

  /** Show animation speed and "Reset motion" controls (the runtime implements resetAnimation). */
  animationControls?: boolean;

  /** Camera direction (from the model centre) for framing the exploded view. */
  explodeViewDirection?: [number, number, number];

  /** Exploded-view camera distance relative to the bounding-sphere fit (long, flat layouts fit
   *  closer than their sphere suggests). Default 1. */
  explodeFrameScale?: number;

  /** Exploded parts are shown as hologram outlines (engineering); off for organic anatomy meshes. */
  hologramEdges?: boolean;

  /** Assembled look: 'xray' (white technical wireframe, default) or 'solid' (the model's own
   *  materials, e.g. natural anatomy colours). Exploded views are always colour-coded x-ray. */
  assembledLook?: 'xray' | 'solid';

  /** Crease angle (degrees) for x-ray outlines; small values draw a dense wireframe. Default 20. */
  xrayEdgeAngle?: number;

  /** Components shown for context only: never labelled, drawn faintly in the exploded view. */
  contextComponentIds?: string[];

  /** false = keep the model's own colours in the exploded view (anatomy: real structure colours
   *  stay readable; pastel hologram materials wash out organic shapes). Default true. */
  hologramMaterials?: boolean;
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
    (candidate.domain === 'mechanical' || candidate.domain === 'civil' || candidate.domain === 'medical') &&
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
