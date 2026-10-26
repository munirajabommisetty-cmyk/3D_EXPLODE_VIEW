/**
 * Unit & Integration Tests for Civil Warren Truss Bridge Model
 * Phase 9 - Task 9.8: Civil Engineering Warren Truss Bridge Model
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  warrenTrussBridgeModel,
  WARREN_TRUSS_MODEL_ID,
  WARREN_TRUSS_BRIDGE_COMPONENT_IDS,
  getWarrenTrussAssemblyTree,
  getWarrenTrussComponentMetadata,
} from '../src/models/civil/warrenTrussBridgeModel';
import {
  buildWarrenTrussBridge,
  WARREN_TRUSS_COMPONENT_IDS,
} from '../src/models/civil/WarrenTrussBridge';
import { modelRegistry } from '../src/models/registry';
import {
  isEngineeringModelDefinition,
  isAssemblyTreeNode,
  type AssemblyTreeNode,
} from '../src/types/models';
import { isCivilMetadata } from '../src/types/engineering';
import { resolveInspectorMetadata } from '../src/utils/inspectorUtils';
import { ModelLifecycleManager } from '../src/services/models/modelLifecycle';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';

describe('Civil Engineering Warren Truss Bridge Model', () => {
  beforeEach(() => {
    modelRegistry.resetToDefaults();
  });

  describe('Model Definition & Contract Compliance', () => {
    it('satisfies the EngineeringModelDefinition contract', () => {
      assert.equal(isEngineeringModelDefinition(warrenTrussBridgeModel), true);
    });

    it('has the correct model ID and Civil engineering domain', () => {
      assert.equal(warrenTrussBridgeModel.id, 'warren_truss_bridge');
      assert.equal(warrenTrussBridgeModel.id, WARREN_TRUSS_MODEL_ID);
      assert.equal(warrenTrussBridgeModel.domain, 'civil');
    });

    it('provides complete catalogue metadata and tags', () => {
      assert.ok(warrenTrussBridgeModel.name.includes('Warren Truss'));
      assert.equal(warrenTrussBridgeModel.category, 'Structural & Bridge Engineering');
      assert.ok(warrenTrussBridgeModel.description.length > 30);
      assert.equal(warrenTrussBridgeModel.difficulty, 'Advanced');
      assert.ok(Array.isArray(warrenTrussBridgeModel.tags));
      assert.ok(warrenTrussBridgeModel.tags!.includes('Civil Engineering'));
      assert.ok(warrenTrussBridgeModel.tags!.includes('Warren Truss'));
      assert.equal(warrenTrussBridgeModel.componentCount, 8);
    });

    it('specifies custom camera configuration optimized for bridge aspect ratio', () => {
      const cameraConfig = warrenTrussBridgeModel.cameraConfig;
      assert.ok(cameraConfig, 'Expected cameraConfig to be defined');
      assert.deepEqual(cameraConfig.initialPosition, [18, 12, 22]);
      assert.deepEqual(cameraConfig.target, [0, 1.5, 0]);
      assert.equal(cameraConfig.minDistance, 3.0);
      assert.equal(cameraConfig.maxDistance, 70.0);
      assert.equal(cameraConfig.fov, 45);
      assert.equal(cameraConfig.defaultPreset, 'isometric');
    });
  });

  describe('Assembly Tree Hierarchy & Component IDs', () => {
    it('provides a valid AssemblyTreeNode root', () => {
      const tree = getWarrenTrussAssemblyTree();
      assert.equal(isAssemblyTreeNode(tree), true);
      assert.equal(tree.id, 'warren_truss_root');
      assert.equal(tree.type, 'assembly');
      assert.ok(tree.children && tree.children.length >= 3);
    });

    it('includes all 8 addressable components without duplicate references', () => {
      const tree = warrenTrussBridgeModel.getAssemblyTree();
      const discoveredComponentIds: string[] = [];

      function collectComponentIds(node: AssemblyTreeNode) {
        if (node.type === 'component' && node.componentId) {
          discoveredComponentIds.push(node.componentId);
        }
        if (node.children) {
          for (const child of node.children) {
            collectComponentIds(child);
          }
        }
      }

      collectComponentIds(tree);

      assert.equal(discoveredComponentIds.length, 8);
      const uniqueIds = new Set(discoveredComponentIds);
      assert.equal(uniqueIds.size, 8, 'Expected all 8 component IDs in assembly tree to be unique');

      for (const expectedId of WARREN_TRUSS_BRIDGE_COMPONENT_IDS) {
        assert.ok(
          uniqueIds.has(expectedId),
          `Missing component ID in assembly tree: ${expectedId}`
        );
      }
    });

    it('getAllComponentIds returns all 8 unique component IDs', () => {
      const ids = warrenTrussBridgeModel.getAllComponentIds?.();
      assert.ok(ids);
      assert.equal(ids.length, 8);
      assert.deepEqual(ids.sort(), [...WARREN_TRUSS_COMPONENT_IDS].sort());
    });
  });

  describe('Civil Component Metadata & Educational Annotations', () => {
    it('returns valid CivilComponentMetadata for each component', () => {
      for (const componentId of WARREN_TRUSS_BRIDGE_COMPONENT_IDS) {
        const metadata = getWarrenTrussComponentMetadata(componentId);
        assert.ok(metadata, `Expected metadata for component ${componentId}`);
        assert.equal(metadata.id, componentId);
        assert.equal(metadata.domain, 'civil');
        assert.equal(isCivilMetadata(metadata), true);
        assert.ok(metadata.name.length > 0);
        assert.ok(metadata.description && metadata.description.length > 0);
        assert.ok(metadata.role && metadata.role.length > 0);
        assert.ok(metadata.materialName && metadata.materialName.length > 0);
        assert.ok(metadata.structuralRole, `Expected structuralRole for ${componentId}`);
        assert.ok(metadata.nominalForceType, `Expected nominalForceType for ${componentId}`);
        assert.ok(Array.isArray(metadata.specifications) && metadata.specifications.length > 0);
        assert.ok(Array.isArray(metadata.engineeringNotes) && metadata.engineeringNotes.length > 0);
        assert.ok(Array.isArray(metadata.educationalNotes) && metadata.educationalNotes.length > 0);
      }
    });

    it('provides realistic material annotations for structural members', () => {
      const topChordMeta = getWarrenTrussComponentMetadata('top_chords')!;
      assert.ok(topChordMeta.materialName.includes('Steel'));
      assert.ok(topChordMeta.materialGrade?.includes('A709'));

      const deckMeta = getWarrenTrussComponentMetadata('bridge_deck')!;
      assert.ok(deckMeta.materialName.includes('Concrete'));

      const pierMeta = getWarrenTrussComponentMetadata('support_piers')!;
      assert.ok(pierMeta.materialName.includes('Concrete'));
    });

    it('returns null safely for nonexistent component IDs', () => {
      assert.equal(getWarrenTrussComponentMetadata('sun_gear'), null);
      assert.equal(getWarrenTrussComponentMetadata('unknown_component'), null);
      assert.equal(getWarrenTrussComponentMetadata(''), null);
    });

    it('clearly labels educational annotations as conceptual without false FEA claims', () => {
      const topChordMeta = getWarrenTrussComponentMetadata('top_chords')!;
      assert.ok(
        topChordMeta.educationalNotes?.some(
          (note) => note.includes('Educational Concept') || note.includes('FEA')
        ),
        'Expected conceptual educational disclaimer'
      );
    });
  });

  describe('Model Registry Integration & Discovery', () => {
    it('is registered in modelRegistry by default', () => {
      assert.equal(modelRegistry.hasModel(WARREN_TRUSS_MODEL_ID), true);
      const retrieved = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID);
      assert.equal(retrieved, warrenTrussBridgeModel);
    });

    it('is discovered when filtering models by Civil domain', () => {
      const civilModels = modelRegistry.getModelsByDomain('civil');
      assert.ok(civilModels.length >= 1);
      const found = civilModels.find((m) => m.id === WARREN_TRUSS_MODEL_ID);
      assert.ok(found, 'Expected warren_truss_bridge in Civil domain models');
      assert.equal(found?.name, 'Warren Truss Bridge Assembly');
    });

    it('preserves existing mechanical models in the registry', () => {
      const mechModels = modelRegistry.getModelsByDomain('mechanical');
      assert.ok(mechModels.length >= 1);
      const foundGearbox = mechModels.find((m) => m.id === PLANETARY_GEARBOX_MODEL_ID);
      assert.ok(foundGearbox, 'Expected planetary_gearbox in Mechanical domain models');
    });

    it('resetToDefaults preserves both mechanical and civil default models', () => {
      modelRegistry.clear();
      assert.equal(modelRegistry.getAllModels().length, 0);

      modelRegistry.resetToDefaults();
      assert.equal(modelRegistry.hasModel(PLANETARY_GEARBOX_MODEL_ID), true);
      assert.equal(modelRegistry.hasModel(WARREN_TRUSS_MODEL_ID), true);
    });
  });

  describe('Procedural 3D Scene Construction & WebGL Disposal', () => {
    it('builds a Three.js scene containing all 8 tagged components', () => {
      const scene = new THREE.Scene();
      const runtime = warrenTrussBridgeModel.buildScene(scene);

      assert.ok(runtime.rootGroup instanceof THREE.Group);
      assert.ok(scene.children.includes(runtime.rootGroup));
      assert.equal(runtime.rootGroup.userData.modelId, 'warren_truss_bridge');

      // Verify all 8 component IDs exist as tagged objects in the hierarchy
      const foundComponentIds = new Set<string>();
      runtime.rootGroup.traverse((obj) => {
        if (obj.userData?.componentId) {
          foundComponentIds.add(obj.userData.componentId);
        }
      });

      for (const expectedId of WARREN_TRUSS_BRIDGE_COMPONENT_IDS) {
        assert.ok(
          foundComponentIds.has(expectedId),
          `Expected 3D scene to contain component tagged with: ${expectedId}`
        );
      }

      // Dispose runtime safely
      runtime.dispose();
      assert.equal(scene.children.includes(runtime.rootGroup), false);
    });

    it('controller dispose() cleans up geometries, materials, and children cleanly', () => {
      const controller = buildWarrenTrussBridge();
      assert.ok(controller.group.children.length > 0);

      // Animation update runs without throwing
      assert.doesNotThrow(() => {
        controller.update(0.016);
      });

      controller.dispose();
      assert.equal(controller.group.children.length, 0);
    });
  });

  describe('Inspector Metadata Resolution & Domain Isolation', () => {
    it('resolves civil component metadata when active model is the bridge', () => {
      const resolved = resolveInspectorMetadata(null, 'top_chords', warrenTrussBridgeModel);
      assert.ok(resolved);
      assert.equal(resolved.id, 'top_chords');
      assert.equal(resolved.domain, 'civil');
      assert.equal(isCivilMetadata(resolved), true);
    });

    it('never resolves or leaks planetary gearbox metadata for an unresolved bridge component', () => {
      // 'sun_gear' is not a component of the Warren Truss Bridge
      const resolved = resolveInspectorMetadata(null, 'sun_gear', warrenTrussBridgeModel);
      assert.equal(
        resolved,
        null,
        'Should not resolve planetary gearbox metadata when active model is the bridge'
      );
    });
  });

  describe('Model Switching & Lifecycle Integration', () => {
    it('switches between planetary gearbox and warren truss bridge smoothly', () => {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      const fakeControls = {
        minDistance: 0,
        maxDistance: 100,
        target: new THREE.Vector3(),
        update: () => {},
      };
      const lifecycle = new ModelLifecycleManager({
        scene,
        camera,
        cameraController: { controls: fakeControls } as any,
      });

      // 1. Load Gearbox
      const res1 = lifecycle.loadModel(PLANETARY_GEARBOX_MODEL_ID);
      assert.equal(res1.success, true);
      assert.equal(lifecycle.getActiveModel()?.id, PLANETARY_GEARBOX_MODEL_ID);

      // 2. Switch to Warren Truss Bridge
      const res2 = lifecycle.loadModel(WARREN_TRUSS_MODEL_ID);
      assert.equal(res2.success, true);
      assert.equal(lifecycle.getActiveModel()?.id, WARREN_TRUSS_MODEL_ID);

      // Camera was adjusted to bridge config
      assert.equal(camera.position.x, 18);
      assert.equal(camera.position.y, 12);
      assert.equal(camera.position.z, 22);

      // 3. Switch back to Gearbox
      const res3 = lifecycle.loadModel(PLANETARY_GEARBOX_MODEL_ID);
      assert.equal(res3.success, true);
      assert.equal(lifecycle.getActiveModel()?.id, PLANETARY_GEARBOX_MODEL_ID);

      // 4. Dispose lifecycle
      lifecycle.dispose();
      assert.equal(lifecycle.getActiveModel(), null);
    });
  });
});
