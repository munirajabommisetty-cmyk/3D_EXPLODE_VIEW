/**
 * Unit & Integration Tests for Model Architecture Improvements
 * Phase 10 - Model Architecture Modernization
 *
 * Covers:
 * 1. Generic component identification in ComponentRaycaster (model-scoped, no cross-model leakage)
 * 2. Explicit component relationships and assembly role validation (BaseComponentMetadata)
 * 3. Consistent isolation and focus contracts in ModelLifecycleManager and CameraController
 * 4. Backward compatibility with existing planetary_gearbox and warren_truss_bridge
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  resolveComponentId,
  ComponentRaycaster,
} from '../src/components/scene/ComponentRaycaster';
import {
  validateComponentRelationships,
  type BaseComponentMetadata,
} from '../src/types/engineering';
import { ModelLifecycleManager } from '../src/services/models/modelLifecycle';
import { CameraController } from '../src/components/scene/CameraController';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import { WARREN_TRUSS_MODEL_ID } from '../src/models/civil/warrenTrussBridgeModel';

describe('Model Architecture Improvements (Phase 10)', () => {
  describe('1. Generic Component Identification (ComponentRaycaster)', () => {
    it('prefers explicit userData.componentId regardless of mesh name', () => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
      mesh.name = 'mesh_random_unrelated_name';
      mesh.userData = { componentId: 'piston_assembly' };

      const resolved = resolveComponentId(mesh);
      assert.equal(resolved, 'piston_assembly');
    });

    it('resolves userData.componentId from ancestor object', () => {
      const parent = new THREE.Group();
      parent.userData = { componentId: 'cylinder_block' };

      const childMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
      childMesh.name = 'inner_bore_face';
      parent.add(childMesh);

      const resolved = resolveComponentId(childMesh);
      assert.equal(resolved, 'cylinder_block');
    });

    it('resolves mesh name only when accepted by model-scoped validator', () => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
      mesh.name = 'crankshaft';

      // Custom model validator that knows 'crankshaft'
      const engineValidator = new Set(['crankshaft', 'camshaft', 'flywheel']);
      assert.equal(resolveComponentId(mesh, engineValidator), 'crankshaft');

      // Validator that does not know 'crankshaft'
      const bridgeValidator = new Set(['top_chord', 'bottom_chord']);
      assert.equal(resolveComponentId(mesh, bridgeValidator), null);
    });

    it('does NOT fallback to hardcoded gearbox components when no validator matches', () => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
      mesh.name = 'sun_gear';

      // For a non-gearbox model, 'sun_gear' must NOT be resolved as a component
      const civilModelValidator = new Set(['span_truss', 'end_post']);
      const resolved = resolveComponentId(mesh, civilModelValidator);
      assert.equal(resolved, null, 'Gearbox ID must not leak into non-gearbox model');
    });

    it('ComponentRaycaster respects model-scoped validator in raycast', () => {
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(0, 0, 5);
      camera.lookAt(0, 0, 0);

      const scene = new THREE.Scene();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.1), new THREE.MeshBasicMaterial());
      mesh.name = 'test_engine_valve';
      scene.add(mesh);
      mesh.updateMatrixWorld(true);

      // Raycaster scoped to civil bridge - must ignore engine valve mesh name
      const civilRaycaster = new ComponentRaycaster(camera, scene, {
        validComponentIds: new Set(['deck', 'piers']),
      });

      const civilHit = civilRaycaster.raycast({ x: 0, y: 0 });
      assert.equal(civilHit, null, 'Should not match unknown mesh name');

      // Raycaster scoped to engine model - resolves test_engine_valve
      const engineRaycaster = new ComponentRaycaster(camera, scene, {
        validComponentIds: new Set(['test_engine_valve', 'spark_plug']),
      });

      const engineHit = engineRaycaster.raycast({ x: 0, y: 0 });
      assert.notEqual(engineHit, null);
      assert.equal(engineHit?.componentId, 'test_engine_valve');
    });
  });

  describe('2. Component Relationships & Assembly Role Metadata', () => {
    it('validates correct relationships without errors', () => {
      const validIds = new Set(['crankshaft', 'connecting_rod', 'piston']);
      const pistonMetadata: BaseComponentMetadata = {
        id: 'piston',
        name: 'Piston Head',
        domain: 'mechanical',
        role: 'Prime mover reciprocating in cylinder',
        assemblyRole: 'prime_mover',
        relationships: [
          {
            targetComponentId: 'connecting_rod',
            relationshipType: 'driven_by',
            description: 'Transfers combustion force to connecting rod via wrist pin',
          },
        ],
      };

      const result = validateComponentRelationships(pistonMetadata, validIds);
      assert.equal(result.isValid, true);
      assert.equal(result.errors.length, 0);
    });

    it('flags error when relationship references non-existent component', () => {
      const validIds = new Set(['crankshaft', 'connecting_rod']);
      const metadata: BaseComponentMetadata = {
        id: 'crankshaft',
        name: 'Crankshaft',
        domain: 'mechanical',
        role: 'Converts reciprocating motion into rotary torque',
        assemblyRole: 'power_transmission',
        relationships: [
          {
            targetComponentId: 'turbocharger_turbine', // Not in validIds
            relationshipType: 'connected_to',
          },
        ],
      };

      const result = validateComponentRelationships(metadata, validIds);
      assert.equal(result.isValid, false);
      assert.match(result.errors[0], /unknown targetComponentId "turbocharger_turbine"/);
    });

    it('flags error when relationship references self', () => {
      const validIds = new Set(['flywheel']);
      const metadata: BaseComponentMetadata = {
        id: 'flywheel',
        name: 'Flywheel',
        domain: 'mechanical',
        role: 'Rotational inertia storage',
        assemblyRole: 'power_transmission',
        relationships: [
          {
            targetComponentId: 'flywheel',
            relationshipType: 'connected_to',
          },
        ],
      };

      const result = validateComponentRelationships(metadata, validIds);
      assert.equal(result.isValid, false);
      assert.match(result.errors[0], /cannot have a relationship targeting itself/);
    });

    it('flags error when relationshipType is empty or whitespace', () => {
      const validIds = new Set(['part_a', 'part_b']);
      const metadata: BaseComponentMetadata = {
        id: 'part_a',
        name: 'Part A',
        domain: 'mechanical',
        role: 'Part',
        relationships: [
          {
            targetComponentId: 'part_b',
            relationshipType: '   ',
          },
        ],
      };

      const result = validateComponentRelationships(metadata, validIds);
      assert.equal(result.isValid, false);
      assert.match(result.errors[0], /missing relationshipType/);
    });

    it('passes validation when relationships array is omitted or empty (backward compatibility)', () => {
      const validIds = new Set(['gear_a', 'gear_b']);
      const metadataNoRels: BaseComponentMetadata = {
        id: 'gear_a',
        name: 'Gear A',
        domain: 'mechanical',
        role: 'Transmission',
      };

      const result1 = validateComponentRelationships(metadataNoRels, validIds);
      assert.equal(result1.isValid, true);
      assert.equal(result1.errors.length, 0);

      const metadataEmptyRels: BaseComponentMetadata = {
        ...metadataNoRels,
        relationships: [],
      };
      const result2 = validateComponentRelationships(metadataEmptyRels, validIds);
      assert.equal(result2.isValid, true);
      assert.equal(result2.errors.length, 0);
    });
  });

  describe('3. Consistent Isolation and Focus Contracts', () => {
    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let lifecycle: ModelLifecycleManager;

    beforeEach(() => {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 100);
      modelRegistry.resetToDefaults();
      lifecycle = new ModelLifecycleManager({ scene, camera });
    });

    it('isolates a selected component by showing only matching meshes', () => {
      lifecycle.loadModel(PLANETARY_GEARBOX_MODEL_ID);
      const activeRuntime = lifecycle.getActiveRuntime();
      assert.notEqual(activeRuntime, null);

      // Isolate 'sun_gear'
      const success = lifecycle.isolateComponent('sun_gear');
      assert.equal(success, true);
      assert.equal(lifecycle.getIsolatedComponentId(), 'sun_gear');

      // Verify scene visibility: meshes with userData.componentId === 'sun_gear' are visible, others hidden
      let sunMeshFound = false;
      let nonSunVisibleCount = 0;

      activeRuntime!.rootGroup.traverse((obj) => {
        const compId = obj.userData?.componentId;
        if (compId === 'sun_gear') {
          sunMeshFound = true;
          assert.equal(obj.visible, true);
        } else if (compId && compId !== 'sun_gear') {
          if (obj.visible) {
            nonSunVisibleCount++;
          }
        }
      });

      assert.equal(sunMeshFound, true);
      assert.equal(nonSunVisibleCount, 0, 'All non-isolated components must be hidden');
    });

    it('clearing isolation (null) restores normal assembly visibility', () => {
      lifecycle.loadModel(PLANETARY_GEARBOX_MODEL_ID);
      const activeRuntime = lifecycle.getActiveRuntime();

      // Isolate sun_gear
      lifecycle.isolateComponent('sun_gear');
      assert.equal(lifecycle.getIsolatedComponentId(), 'sun_gear');

      // Clear isolation
      const success = lifecycle.isolateComponent(null);
      assert.equal(success, true);
      assert.equal(lifecycle.getIsolatedComponentId(), null);

      // Verify all components with userData.componentId are visible again
      activeRuntime!.rootGroup.traverse((obj) => {
        if (obj.userData?.componentId) {
          assert.equal(obj.visible, true, `Component ${obj.userData.componentId} should be visible after clearing isolation`);
        }
      });
    });

    it('clearing isolation respects existing hiddenComponents set', () => {
      lifecycle.loadModel(PLANETARY_GEARBOX_MODEL_ID);
      const activeRuntime = lifecycle.getActiveRuntime();

      // User has hidden ring_gear via assembly tree
      lifecycle.setHiddenComponents(new Set(['ring_gear']));

      // Isolate sun_gear
      lifecycle.isolateComponent('sun_gear');
      assert.equal(lifecycle.getIsolatedComponentId(), 'sun_gear');

      // Clear isolation
      lifecycle.isolateComponent(null);

      // sun_gear should be visible, ring_gear should remain hidden
      activeRuntime!.rootGroup.traverse((obj) => {
        const compId = obj.userData?.componentId;
        if (compId === 'sun_gear') {
          assert.equal(obj.visible, true);
        } else if (compId === 'ring_gear') {
          assert.equal(obj.visible, false, 'Hidden component must remain hidden after isolation is cleared');
        }
      });
    });

    it('resets isolation state on model switch', () => {
      lifecycle.loadModel(PLANETARY_GEARBOX_MODEL_ID);
      lifecycle.isolateComponent('sun_gear');
      assert.equal(lifecycle.getIsolatedComponentId(), 'sun_gear');

      // Switch to bridge model
      lifecycle.loadModel(WARREN_TRUSS_MODEL_ID);
      assert.equal(lifecycle.getIsolatedComponentId(), null, 'Isolation must be cleared on model switch');
    });

    it('resets isolation state on disposal', () => {
      lifecycle.loadModel(PLANETARY_GEARBOX_MODEL_ID);
      lifecycle.isolateComponent('sun_gear');
      assert.equal(lifecycle.getIsolatedComponentId(), 'sun_gear');

      lifecycle.dispose();
      assert.equal(lifecycle.getIsolatedComponentId(), null);
    });

    it('focusComponent focuses camera on valid component bounding box', () => {
      const mockDomElement = {
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
        getRootNode: () => ({ addEventListener: () => {}, removeEventListener: () => {} }),
        ownerDocument: {
          addEventListener: () => {},
          removeEventListener: () => {},
          elementFromPoint: () => null,
        },
        clientWidth: 800,
        clientHeight: 600,
        style: {},
      } as unknown as HTMLElement;

      const cameraController = new CameraController(camera, mockDomElement, {
        minDistance: 1,
        maxDistance: 100,
        enableDamping: false,
      });

      const lifecycleWithCam = new ModelLifecycleManager({
        scene,
        camera,
        cameraController,
      });
      lifecycleWithCam.loadModel(PLANETARY_GEARBOX_MODEL_ID);

      const initialPos = camera.position.clone();
      const focusResult = lifecycleWithCam.focusComponent('sun_gear');
      assert.equal(focusResult, true);

      // Camera position should have adjusted to frame the sun gear
      assert.notDeepEqual(camera.position, initialPos);

      // Focusing on an invalid ID returns false and does not throw
      const invalidFocus = lifecycleWithCam.focusComponent('non_existent_engine_part');
      assert.equal(invalidFocus, false);
    });
  });

  describe('4. Backward Compatibility with Existing Models', () => {
    it('validates planetary_gearbox metadata without errors', () => {
      const gearboxModel = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
      assert.notEqual(gearboxModel, null);

      const allIds = gearboxModel!.getAllComponentIds();
      const idSet = new Set(allIds);

      for (const id of allIds) {
        const meta = gearboxModel!.getComponentMetadata(id);
        assert.notEqual(meta, null, `Metadata must exist for ${id}`);
        const val = validateComponentRelationships(meta!, idSet);
        assert.equal(val.isValid, true, `Component ${id} relationship validation failed`);
        assert.equal(val.errors.length, 0);
      }
    });

    it('validates warren_truss_bridge metadata without errors', () => {
      const bridgeModel = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID);
      assert.notEqual(bridgeModel, null);

      const allIds = bridgeModel!.getAllComponentIds();
      const idSet = new Set(allIds);

      for (const id of allIds) {
        const meta = bridgeModel!.getComponentMetadata(id);
        assert.notEqual(meta, null, `Metadata must exist for ${id}`);
        const val = validateComponentRelationships(meta!, idSet);
        assert.equal(val.isValid, true, `Component ${id} relationship validation failed`);
        assert.equal(val.errors.length, 0);
      }
    });
  });
});
