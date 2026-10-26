/**
 * Unit Tests for Engineering Model Registry & Planetary Gearbox Adapter
 * Phase 9 - Task 9.2: Modular Model Registry & Planetary Gearbox Refactor
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ModelRegistryService } from '../src/models/registry';
import {
  planetaryGearboxModel,
  PLANETARY_GEARBOX_MODEL_ID,
  PLANETARY_GEARBOX_COMPONENT_IDS,
} from '../src/models/mechanical/planetaryGearboxModel';
import {
  isEngineeringModelDefinition,
  isAssemblyTreeNode,
  type EngineeringModelDefinition,
} from '../src/types/models';
import { isMechanicalMetadata } from '../src/types/engineering';

describe('Model Registry Core Engine', () => {
  let registry: ModelRegistryService;

  beforeEach(() => {
    registry = new ModelRegistryService();
  });

  const createDummyModel = (
    id: string,
    name: string,
    domain: 'mechanical' | 'civil'
  ): EngineeringModelDefinition => ({
    id,
    name,
    domain,
    category: 'Test Category',
    description: 'Test description',
    thumbnailUrl: '/thumb.webp',
    difficulty: 'Beginner',
    tags: ['Test'],
    componentCount: 1,
    cameraConfig: {
      initialPosition: [0, 5, 10],
      target: [0, 0, 0],
      minDistance: 1,
      maxDistance: 20,
    },
    getAssemblyTree: () => ({ id: `${id}_root`, name, type: 'assembly' }),
    getComponentMetadata: () => null,
    getAllComponentIds: () => ['part_1'],
    buildScene: () => ({
      rootGroup: new THREE.Group(),
      dispose: () => {},
    }),
  });

  it('registers and retrieves a model by unique ID', () => {
    const mockModel = createDummyModel('beam_bridge', 'Beam Bridge Span', 'civil');

    assert.equal(registry.hasModel('beam_bridge'), false);
    registry.register(mockModel);
    assert.equal(registry.hasModel('beam_bridge'), true);

    const retrieved = registry.getModel('beam_bridge');
    assert.equal(retrieved, mockModel);
    assert.equal(retrieved?.name, 'Beam Bridge Span');
  });

  it('returns undefined and false for nonexistent model IDs', () => {
    assert.equal(registry.hasModel('unknown_id'), false);
    assert.equal(registry.getModel('unknown_id'), undefined);
  });

  it('lists all registered models and filters accurately by domain', () => {
    const mech1 = createDummyModel('lathe', 'Engine Lathe', 'mechanical');
    const mech2 = createDummyModel('pump', 'Centrifugal Pump', 'mechanical');
    const civil1 = createDummyModel('arch_bridge', 'Arch Bridge', 'civil');

    registry.register(mech1);
    registry.register(mech2);
    registry.register(civil1);

    const all = registry.getAllModels();
    assert.equal(all.length, 3);

    const mechanicalModels = registry.getModelsByDomain('mechanical');
    assert.equal(mechanicalModels.length, 2);
    assert.deepEqual(
      mechanicalModels.map((m) => m.id),
      ['lathe', 'pump']
    );

    const civilModels = registry.getModelsByDomain('civil');
    assert.equal(civilModels.length, 1);
    assert.equal(civilModels[0].id, 'arch_bridge');
  });

  it('allows idempotent re-registration of the exact same model instance', () => {
    const mockModel = createDummyModel('spur_stage', 'Spur Stage', 'mechanical');

    registry.register(mockModel);
    // Re-registering the same instance should succeed quietly without throwing
    assert.doesNotThrow(() => {
      registry.register(mockModel);
    });
    assert.equal(registry.getAllModels().length, 1);
  });

  it('deliberately rejects duplicate registrations of different models with the same ID', () => {
    const original = createDummyModel('truss', 'Original Warren Truss', 'civil');
    const duplicate = createDummyModel('truss', 'Different Pratt Truss', 'civil');

    registry.register(original);

    assert.throws(
      () => {
        registry.register(duplicate);
      },
      (err: Error) => {
        assert.match(err.message, /Duplicate model registration rejected/);
        assert.match(err.message, /truss/);
        return true;
      }
    );
  });

  it('rejects invalid or empty model IDs', () => {
    const badModel = { ...createDummyModel('', 'Bad', 'mechanical'), id: '' };
    assert.throws(() => {
      registry.register(badModel);
    }, /Cannot register model: model must have a valid non-empty string ID/);
  });

  it('supports unregister and clear operations', () => {
    const model = createDummyModel('test_m', 'Test', 'mechanical');
    registry.register(model);

    assert.equal(registry.unregister('test_m'), true);
    assert.equal(registry.unregister('test_m'), false);
    assert.equal(registry.hasModel('test_m'), false);

    registry.register(model);
    registry.clear();
    assert.equal(registry.getAllModels().length, 0);
  });
});

describe('Planetary Gearbox Model Adapter', () => {
  it('conforms strictly to the EngineeringModelDefinition contract', () => {
    assert.equal(isEngineeringModelDefinition(planetaryGearboxModel), true);
    assert.equal(planetaryGearboxModel.id, PLANETARY_GEARBOX_MODEL_ID);
    assert.equal(planetaryGearboxModel.domain, 'mechanical');
    assert.equal(planetaryGearboxModel.componentCount, 7);
  });

  it('provides a valid hierarchical assembly tree with subassemblies and leaf components', () => {
    const tree = planetaryGearboxModel.getAssemblyTree();
    assert.equal(isAssemblyTreeNode(tree), true);
    assert.equal(tree.type, 'assembly');
    assert.ok(tree.children && tree.children.length >= 3);

    // Verify subassembly exists
    const epicyclicStage = tree.children?.find((c) => c.id === 'stage_epicyclic');
    assert.ok(epicyclicStage);
    assert.equal(epicyclicStage.type, 'subassembly');

    // Verify nested planet cluster
    const planetsCluster = epicyclicStage.children?.find((c) => c.id === 'sub_planets_cluster');
    assert.ok(planetsCluster);
    assert.equal(planetsCluster.children?.length, 3);
  });

  it('exposes all 7 addressable gearbox component IDs and preserves metadata compatibility', () => {
    const allIds = planetaryGearboxModel.getAllComponentIds();
    assert.equal(allIds.length, 7);

    for (const expectedId of PLANETARY_GEARBOX_COMPONENT_IDS) {
      assert.ok(allIds.includes(expectedId), `Missing component ID: ${expectedId}`);

      const metadata = planetaryGearboxModel.getComponentMetadata(expectedId);
      assert.ok(metadata, `Missing metadata for: ${expectedId}`);
      assert.equal(metadata.id, expectedId);
      assert.equal(metadata.domain, 'mechanical');
      assert.equal(isMechanicalMetadata(metadata), true);
      assert.ok(metadata.name.length > 0);
      assert.ok(metadata.materialName.length > 0);
      assert.ok(metadata.description.length > 0);
    }
  });

  it('returns null for nonexistent component IDs safely', () => {
    assert.equal(planetaryGearboxModel.getComponentMetadata('nonexistent_gear'), null);
    assert.equal(planetaryGearboxModel.getComponentMetadata(''), null);
  });

  it('builds a Three.js scene runtime instance and provides clean disposal', () => {
    const scene = new THREE.Scene();
    const runtimeInstance = planetaryGearboxModel.buildScene(scene);

    assert.ok(runtimeInstance.rootGroup instanceof THREE.Group);
    assert.ok(scene.children.includes(runtimeInstance.rootGroup));
    assert.equal(typeof runtimeInstance.updateAnimation, 'function');
    assert.equal(typeof runtimeInstance.dispose, 'function');

    // Run animation step without throwing
    assert.doesNotThrow(() => {
      runtimeInstance.updateAnimation?.(0.016, 1.0);
    });

    // Invoke disposal
    runtimeInstance.dispose();
    assert.equal(scene.children.includes(runtimeInstance.rootGroup), false);
  });
});
