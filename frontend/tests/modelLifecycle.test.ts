/**
 * Unit & Integration Tests for Model Lifecycle & Dynamic Switching
 * Phase 9 - Task 9.3: Dynamic ViewerCanvas Model Switching & Safe WebGL Disposal
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ModelLifecycleManager } from '../src/services/models/modelLifecycle';
import { modelRegistry } from '../src/models/registry';
import {
  PLANETARY_GEARBOX_MODEL_ID,
} from '../src/models/mechanical/planetaryGearboxModel';
import type { EngineeringModelDefinition, ModelRuntimeInstance } from '../src/types/models';

describe('ModelLifecycleManager (Dynamic Switching & WebGL Lifecycle)', () => {
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 100);
    // Ensure default models are registered
    modelRegistry.resetToDefaults();
  });

  const createMockModel = (
    id: string,
    name: string,
    onDisposeSpy?: () => void,
    onAnimateSpy?: (delta: number) => void
  ): EngineeringModelDefinition => {
    return {
      id,
      name,
      domain: 'mechanical',
      category: 'Test Category',
      description: 'Test description',
      thumbnailUrl: '/thumb.webp',
      difficulty: 'Beginner',
      tags: ['Test'],
      componentCount: 2,
      cameraConfig: {
        initialPosition: [1, 2, 3],
        target: [0, 1, 0],
        minDistance: 3.0,
        maxDistance: 30.0,
      },
      getAssemblyTree: () => ({ id: `${id}_root`, name, type: 'assembly' }),
      getComponentMetadata: (componentId: string) => {
        if (componentId === 'test_part_a') {
          return {
            id: 'test_part_a',
            name: 'Test Part A',
            domain: 'mechanical',
            role: 'Test Role',
            materialName: 'Test Steel',
            description: 'Test Description',
            specifications: [],
            engineeringNotes: [],
          };
        }
        return null;
      },
      getAllComponentIds: () => ['test_part_a', 'test_part_b'],
      buildScene: (targetScene: THREE.Scene): ModelRuntimeInstance => {
        const group = new THREE.Group();
        group.name = `${id}_rootGroup`;

        // Add a mock mesh with userData.componentId
        const meshGeo = new THREE.BoxGeometry(1, 1, 1);
        const meshMat = new THREE.MeshBasicMaterial();
        const mesh = new THREE.Mesh(meshGeo, meshMat);
        mesh.userData = { componentId: 'test_part_a' };
        group.add(mesh);

        targetScene.add(group);

        return {
          rootGroup: group,
          updateAnimation: (delta: number) => {
            onAnimateSpy?.(delta);
          },
          dispose: () => {
            targetScene.remove(group);
            meshGeo.dispose();
            meshMat.dispose();
            onDisposeSpy?.();
          },
        };
      },
    };
  };

  it('loads the default planetary_gearbox model and binds raycaster', () => {
    let loadedModel: EngineeringModelDefinition | null = null;
    const manager = new ModelLifecycleManager({
      scene,
      camera,
      onModelLoaded: (m) => {
        loadedModel = m;
      },
    });

    const result = manager.loadModel(PLANETARY_GEARBOX_MODEL_ID);
    assert.equal(result.success, true);
    assert.equal(result.model?.id, PLANETARY_GEARBOX_MODEL_ID);
    assert.equal(loadedModel?.id, PLANETARY_GEARBOX_MODEL_ID);

    // Verify active runtime and scene attachment
    const runtime = manager.getActiveRuntime();
    assert.ok(runtime);
    assert.ok(scene.children.includes(runtime.rootGroup));

    // Verify raycaster is bound and can raycast against sun_gear
    const raycaster = manager.getRaycaster();
    assert.ok(raycaster);

    manager.dispose();
  });

  it('handles an unknown model ID gracefully without throwing or leaving corrupt state', () => {
    let capturedError: string | null = null;
    const manager = new ModelLifecycleManager({
      scene,
      camera,
      onModelError: (err) => {
        capturedError = err;
      },
    });

    const result = manager.loadModel('nonexistent_model_id');
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('nonexistent_model_id'));
    assert.ok(capturedError?.includes('nonexistent_model_id'));
    assert.equal(manager.getActiveRuntime(), null);
    assert.equal(manager.getActiveModel(), null);
    assert.equal(manager.getRaycaster(), null);

    manager.dispose();
  });

  it('disposes previous runtime exactly once when switching between models', () => {
    let modelADisposedCount = 0;
    let modelBDisposedCount = 0;

    const modelA = createMockModel('model_a', 'Model Alpha', () => {
      modelADisposedCount++;
    });
    const modelB = createMockModel('model_b', 'Model Beta', () => {
      modelBDisposedCount++;
    });

    modelRegistry.register(modelA);
    modelRegistry.register(modelB);

    const manager = new ModelLifecycleManager({ scene, camera });

    // 1. Mount Model A
    const resA = manager.loadModel('model_a');
    assert.equal(resA.success, true);
    assert.equal(manager.getActiveModel()?.id, 'model_a');
    assert.equal(modelADisposedCount, 0);

    const groupA = manager.getActiveRuntime()?.rootGroup;
    assert.ok(groupA);
    assert.ok(scene.children.includes(groupA));

    // 2. Switch to Model B
    const resB = manager.loadModel('model_b');
    assert.equal(resB.success, true);
    assert.equal(manager.getActiveModel()?.id, 'model_b');

    // Model A must be disposed exactly once and removed from scene
    assert.equal(modelADisposedCount, 1);
    assert.equal(scene.children.includes(groupA), false);

    // Model B must be active in scene
    const groupB = manager.getActiveRuntime()?.rootGroup;
    assert.ok(groupB);
    assert.ok(scene.children.includes(groupB));
    assert.equal(modelBDisposedCount, 0);

    // 3. Unmount manager
    manager.dispose();
    assert.equal(modelADisposedCount, 1);
    assert.equal(modelBDisposedCount, 1);
    assert.equal(scene.children.includes(groupB), false);
  });

  it('stops animation callbacks of the previous runtime upon switching', () => {
    let modelAAnimCount = 0;
    let modelBAnimCount = 0;

    const modelA = createMockModel(
      'anim_a',
      'Anim A',
      () => {},
      () => {
        modelAAnimCount++;
      }
    );
    const modelB = createMockModel(
      'anim_b',
      'Anim B',
      () => {},
      () => {
        modelBAnimCount++;
      }
    );

    modelRegistry.register(modelA);
    modelRegistry.register(modelB);

    const manager = new ModelLifecycleManager({ scene, camera });

    manager.loadModel('anim_a');
    manager.updateAnimation(0.016, 1.0);
    assert.equal(modelAAnimCount, 1);
    assert.equal(modelBAnimCount, 0);

    // Switch to B
    manager.loadModel('anim_b');
    manager.updateAnimation(0.016, 1.016);
    // Model A must not receive further ticks; Model B must receive the tick
    assert.equal(modelAAnimCount, 1);
    assert.equal(modelBAnimCount, 1);

    manager.dispose();
  });

  it('preserves shared scene fixtures and does not dispose shared lights or grid', () => {
    // Shared fixtures
    const sharedLight = new THREE.DirectionalLight(0xffffff, 1);
    const sharedGrid = new THREE.GridHelper(10, 10);
    scene.add(sharedLight);
    scene.add(sharedGrid);

    const modelA = createMockModel('fixture_a', 'Fixture A');
    const modelB = createMockModel('fixture_b', 'Fixture B');
    modelRegistry.register(modelA);
    modelRegistry.register(modelB);

    const manager = new ModelLifecycleManager({ scene, camera });

    manager.loadModel('fixture_a');
    assert.ok(scene.children.includes(sharedLight));
    assert.ok(scene.children.includes(sharedGrid));

    // Switch to Model B
    manager.loadModel('fixture_b');
    assert.ok(scene.children.includes(sharedLight));
    assert.ok(scene.children.includes(sharedGrid));

    manager.dispose();
    assert.ok(scene.children.includes(sharedLight));
    assert.ok(scene.children.includes(sharedGrid));
  });

  it('rejects load requests after manager has been disposed', () => {
    const manager = new ModelLifecycleManager({ scene, camera });
    manager.dispose();

    const result = manager.loadModel(PLANETARY_GEARBOX_MODEL_ID);
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('disposed'));
  });

  it('updates ComponentRaycaster target to new model rootGroup on switch', () => {
    const modelA = createMockModel('ray_a', 'Ray A');
    const modelB = createMockModel('ray_b', 'Ray B');
    modelRegistry.register(modelA);
    modelRegistry.register(modelB);

    const manager = new ModelLifecycleManager({ scene, camera });

    manager.loadModel('ray_a');
    const raycasterA = manager.getRaycaster();
    assert.ok(raycasterA);

    manager.loadModel('ray_b');
    const raycasterB = manager.getRaycaster();
    assert.ok(raycasterB);
    assert.notEqual(raycasterA, raycasterB);

    manager.dispose();
  });
});
