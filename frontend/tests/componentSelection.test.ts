/**
 * Automated Unit Test Suite for Component Selection & Information HUD
 * Phase 5: Tasks 5.1, 5.2, 5.3
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  resolveComponentId,
  ComponentRaycaster,
} from '../src/components/scene/ComponentRaycaster';
import {
  ComponentSelector,
  DEFAULT_SELECTOR_CONFIG,
} from '../src/components/scene/ComponentSelector';
import {
  getComponentMetadata,
  getAllComponentMetadata,
  isValidComponentId,
  EXTENDED_GEARBOX_METADATA,
} from '../src/data/machineMetadata';
import type { MechanicalComponentId } from '../src/types/assembly';

describe('Machine Metadata Service (Task 5.3)', () => {
  it('correctly retrieves rich engineering specifications for all 7 gearbox components', () => {
    const componentIds: MechanicalComponentId[] = [
      'sun_gear',
      'planet_gear_1',
      'planet_gear_2',
      'planet_gear_3',
      'ring_gear',
      'planet_carrier',
      'central_shaft',
    ];

    for (const id of componentIds) {
      const meta = getComponentMetadata(id);
      assert.ok(meta !== null, `Expected metadata for ${id}`);
      assert.equal(meta.id, id);
      assert.ok(meta.name.length > 0);
      assert.ok(meta.materialName.length > 0);
      assert.ok(meta.nominalRpm.length > 0);
      assert.ok(meta.gearRatio.length > 0);
      assert.ok(meta.specifications.length > 0);
      assert.ok(meta.engineeringNotes.length > 0);
    }
  });

  it('safely handles missing, invalid, null, and undefined component IDs', () => {
    assert.equal(getComponentMetadata(null), null);
    assert.equal(getComponentMetadata(undefined), null);
    assert.equal(getComponentMetadata(''), null);
    assert.equal(getComponentMetadata('non_existent_turbo_rotor'), null);
    assert.equal(getComponentMetadata('random_string'), null);
  });

  it('validates component IDs accurately with isValidComponentId', () => {
    assert.equal(isValidComponentId('sun_gear'), true);
    assert.equal(isValidComponentId('planet_gear_2'), true);
    assert.equal(isValidComponentId('ring_gear'), true);
    assert.equal(isValidComponentId('central_shaft'), true);
    assert.equal(isValidComponentId('fake_gear'), false);
    assert.equal(isValidComponentId(null), false);
    assert.equal(isValidComponentId(undefined), false);
  });

  it('returns all 7 registered components via getAllComponentMetadata', () => {
    const all = getAllComponentMetadata();
    assert.equal(all.length, 7);
    assert.equal(all.length, Object.keys(EXTENDED_GEARBOX_METADATA).length);
  });
});

describe('Component Hierarchy Resolution (Task 5.1)', () => {
  it('resolves directly tagged mesh to its component ID', () => {
    const mesh = new THREE.Mesh();
    mesh.name = 'sun_gear_hub';
    mesh.userData = { componentId: 'sun_gear' };

    const resolved = resolveComponentId(mesh);
    assert.equal(resolved, 'sun_gear');
  });

  it('resolves deep child mesh upward through parent hierarchy to component ID', () => {
    const parentGroup = new THREE.Group();
    parentGroup.name = 'planet_gear_1';
    parentGroup.userData = { componentId: 'planet_gear_1' };

    const intermediateGroup = new THREE.Group();
    parentGroup.add(intermediateGroup);

    const toothMesh = new THREE.Mesh();
    toothMesh.name = 'planet_gear_1_tooth_5';
    // Deep child has no direct componentId on itself
    intermediateGroup.add(toothMesh);

    const resolved = resolveComponentId(toothMesh);
    assert.equal(resolved, 'planet_gear_1');
  });

  it('returns null for untagged objects or arbitrary scene meshes', () => {
    const grid = new THREE.GridHelper(10, 10);
    assert.equal(resolveComponentId(grid), null);

    const plainMesh = new THREE.Mesh();
    assert.equal(resolveComponentId(plainMesh), null);
  });

  it('safely handles null and undefined inputs in hierarchy traversal', () => {
    assert.equal(resolveComponentId(null), null);
  });
});

describe('ComponentSelector & Dwell Confirmation State Machine (Task 5.2)', () => {
  it('exposes default 1200ms dwell duration configuration', () => {
    const selector = new ComponentSelector();
    assert.equal(selector.getConfig().dwellDurationMs, 1200);
    assert.equal(DEFAULT_SELECTOR_CONFIG.dwellDurationMs, 1200);
  });

  it('resets dwell progress and timer when candidate hover target changes', () => {
    const selector = new ComponentSelector({ dwellDurationMs: 1200 });

    // Hover sun_gear for 600ms (50% progress)
    const update1 = selector.update('sun_gear', 600);
    assert.equal(update1.hoveredId, 'sun_gear');
    assert.equal(update1.selectedId, null);
    assert.ok(Math.abs(update1.dwellProgress - 0.5) < 1e-4);

    // Switch to planet_gear_1: timer must immediately reset to 0
    const update2 = selector.update('planet_gear_1', 0);
    assert.equal(update2.hoveredId, 'planet_gear_1');
    assert.equal(update2.dwellProgress, 0);
  });

  it('confirms selection when user dwells on a component for the full duration (1.2s)', () => {
    const selector = new ComponentSelector({ dwellDurationMs: 1200 });

    // Step 1: 400ms
    const res1 = selector.update('ring_gear', 400);
    assert.equal(res1.selectedId, null);
    assert.equal(res1.justSelected, false);
    assert.ok(Math.abs(res1.dwellProgress - 400 / 1200) < 1e-4);

    // Step 2: Another 500ms (total 900ms)
    const res2 = selector.update('ring_gear', 500);
    assert.equal(res2.selectedId, null);
    assert.equal(res2.justSelected, false);
    assert.ok(Math.abs(res2.dwellProgress - 900 / 1200) < 1e-4);

    // Step 3: Another 300ms (total 1200ms - threshold reached!)
    const res3 = selector.update('ring_gear', 300);
    assert.equal(res3.selectedId, 'ring_gear');
    assert.equal(res3.justSelected, true);
    assert.equal(res3.dwellProgress, 0, 'Dwell progress resets after selection lock');

    // Step 4: Subsequent frames hovering the already-selected component do not re-trigger
    const res4 = selector.update('ring_gear', 100);
    assert.equal(res4.selectedId, 'ring_gear');
    assert.equal(res4.justSelected, false);
    assert.equal(res4.dwellProgress, 0);
  });

  it('supports immediate direct selection (mouse click modality)', () => {
    const selector = new ComponentSelector();

    const res = selector.select('central_shaft');
    assert.equal(res.selectedId, 'central_shaft');
    assert.equal(res.justSelected, true);
    assert.equal(selector.getSelectedId(), 'central_shaft');
  });

  it('clears active selection cleanly and restores null state', () => {
    const selector = new ComponentSelector();

    selector.select('planet_carrier');
    assert.equal(selector.getSelectedId(), 'planet_carrier');

    const clearRes = selector.clearSelection();
    assert.equal(clearRes.selectedId, null);
    assert.equal(clearRes.justDeselected, true);
    assert.equal(selector.getSelectedId(), null);
  });

  it('resets timer when pointer moves to empty space', () => {
    const selector = new ComponentSelector({ dwellDurationMs: 1200 });

    selector.update('sun_gear', 800);
    assert.ok(selector.getDwellProgress() > 0);

    const emptyRes = selector.update(null, 100);
    assert.equal(emptyRes.hoveredId, null);
    assert.equal(emptyRes.dwellProgress, 0);
    assert.equal(selector.getDwellProgress(), 0);
  });
});

describe('ComponentRaycaster Non-Destructive Highlighting (Task 5.1)', () => {
  it('applies and clears emissive highlight without permanently mutating shared materials', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

    // Create two meshes that share the exact same material
    const sharedMaterial = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
    });

    const meshA = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMaterial);
    meshA.name = 'planet_gear_1_mesh';
    meshA.userData = { componentId: 'planet_gear_1' };
    scene.add(meshA);

    const meshB = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMaterial);
    meshB.name = 'planet_gear_2_mesh';
    meshB.userData = { componentId: 'planet_gear_2' };
    scene.add(meshB);

    const raycaster = new ComponentRaycaster(camera, scene);

    // 1. Highlight planet_gear_1 only
    raycaster.setSelectionHighlight('planet_gear_1');

    // meshA must now have a cloned material with emissive glow
    assert.notEqual(meshA.material, sharedMaterial, 'meshA must have cloned highlighted material');
    assert.ok((meshA.material as THREE.MeshStandardMaterial).emissiveIntensity > 0);

    // meshB MUST still retain its original sharedMaterial without pollution!
    assert.equal(meshB.material, sharedMaterial, 'meshB must remain untouched');
    assert.equal((meshB.material as THREE.MeshStandardMaterial).emissiveIntensity, 0);

    // 2. Clear selection highlight
    raycaster.setSelectionHighlight(null);

    // meshA must be completely restored to its original sharedMaterial
    assert.equal(meshA.material, sharedMaterial, 'meshA must restore original material');
    assert.equal(meshA.userData._originalMaterial, undefined);

    raycaster.dispose();
  });
});
