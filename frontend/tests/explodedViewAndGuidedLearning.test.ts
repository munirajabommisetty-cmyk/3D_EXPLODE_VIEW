/**
 * Unit & Integration Tests for Exploded View & Guided Learning
 * Phase 9 - Task 9.9: Exploded View and Guided Learning
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  buildPlanetaryGearbox,
  type PlanetaryGearboxController,
} from '../src/components/scene/PlanetaryGearbox';
import {
  buildWarrenTrussBridge,
  type WarrenTrussBridgeController,
} from '../src/models/civil/WarrenTrussBridge';
import {
  planetaryGearboxModel,
  PLANETARY_GEARBOX_MODEL_ID,
} from '../src/models/mechanical/planetaryGearboxModel';
import {
  warrenTrussBridgeModel,
  WARREN_TRUSS_MODEL_ID,
} from '../src/models/civil/warrenTrussBridgeModel';
import {
  getGuidedLessonForModel,
  PLANETARY_GEARBOX_LESSON,
  WARREN_TRUSS_BRIDGE_LESSON,
} from '../src/data/guidedLessons';
import { ModelLifecycleManager } from '../src/services/models/modelLifecycle';
import { modelRegistry } from '../src/models/registry';

describe('Exploded View & Guided Learning (Task 9.9)', () => {
  beforeEach(() => {
    modelRegistry.resetToDefaults();
  });

  /* -------------------------------------------------------------------------
   * 1. Planetary Gearbox Exploded View & Kinematic Animation Composition
   * ------------------------------------------------------------------------- */
  describe('Planetary Gearbox Exploded View', () => {
    it('creates a controller with setExplodedFactor interface', () => {
      const scene = new THREE.Scene();
      const controller: PlanetaryGearboxController = buildPlanetaryGearbox(scene);

      assert.equal(typeof controller.setExplodedFactor, 'function');
      assert.equal(typeof controller.update, 'function');
      assert.equal(typeof controller.dispose, 'function');

      controller.dispose();
    });

    it('separates components axially and radially at factor 1.0', () => {
      const scene = new THREE.Scene();
      const controller = buildPlanetaryGearbox(scene);

      const centralShaft = controller.group.getObjectByName('central_shaft') as THREE.Mesh;
      const sunGear = controller.group.getObjectByName('sun_gear') as THREE.Group;
      const carrierGroup = controller.group.getObjectByName('planet_carrier') as THREE.Group;
      const ringGear = controller.group.getObjectByName('ring_gear') as THREE.Group;

      assert.ok(centralShaft, 'Expected central_shaft object');
      assert.ok(sunGear, 'Expected sun_gear object');
      assert.ok(carrierGroup, 'Expected planet_carrier object');
      assert.ok(ringGear, 'Expected ring_gear object');

      // Record baseline positions at factor 0
      controller.setExplodedFactor!(0);
      const initialSunY = sunGear.position.y;
      const initialCarrierY = carrierGroup.position.y;
      const initialShaftY = centralShaft.position.y;
      const initialRingY = ringGear.position.y;

      // Expand to factor 1.0
      controller.setExplodedFactor!(1.0);

      // Sun and Shaft should explode upward (+Y)
      assert.ok(
        centralShaft.position.y > initialShaftY + 2.0,
        `Expected shaft Y > ${initialShaftY + 2.0}, got ${centralShaft.position.y}`
      );
      assert.ok(
        sunGear.position.y > initialSunY + 1.0,
        `Expected sun gear Y > ${initialSunY + 1.0}, got ${sunGear.position.y}`
      );

      // Carrier and Ring gear should explode downward (-Y)
      assert.ok(
        carrierGroup.position.y < initialCarrierY - 1.0,
        `Expected carrier group Y < ${initialCarrierY - 1.0}, got ${carrierGroup.position.y}`
      );
      assert.ok(
        ringGear.position.y < initialRingY - 2.0,
        `Expected ring gear Y < ${initialRingY - 2.0}, got ${ringGear.position.y}`
      );

      controller.dispose();
    });

    it('composes exploded radial offsets with kinematic animation without drift', () => {
      const scene = new THREE.Scene();
      const controller = buildPlanetaryGearbox(scene);

      const sunGear = controller.group.getObjectByName('sun_gear') as THREE.Group;
      const planetMesh = controller.group.getObjectByName('planet_gear_1') as THREE.Group;
      assert.ok(sunGear, 'Expected sun_gear object');
      assert.ok(planetMesh, 'Expected planet_gear_1 object');

      // Set exploded factor to 0.5
      controller.setExplodedFactor!(0.5);

      // Animate 20 frames while exploded in rotating state
      for (let i = 0; i < 20; i++) {
        controller.update(0.016, true);
      }

      // Sun gear rotation should have advanced
      assert.notEqual(sunGear.rotation.y, 0);

      // Planet gears must orbit at the expanded radius
      const radiusAt0_5 = Math.sqrt(
        planetMesh.position.x * planetMesh.position.x +
        planetMesh.position.z * planetMesh.position.z
      );
      const expectedRadius0_5 = 1.26 + 0.5 * 0.85; // 1.26 + 0.425 = 1.685
      assert.ok(
        Math.abs(radiusAt0_5 - expectedRadius0_5) < 0.05,
        `Planet radius at factor 0.5 expected ~${expectedRadius0_5}, got ${radiusAt0_5}`
      );

      // Restore to factor 0
      controller.setExplodedFactor!(0);
      controller.update(0.016, false); // Stationary update

      const radiusAt0 = Math.sqrt(
        planetMesh.position.x * planetMesh.position.x +
        planetMesh.position.z * planetMesh.position.z
      );
      assert.ok(
        Math.abs(radiusAt0 - 1.26) < 0.05,
        `Planet radius at factor 0 expected ~1.26, got ${radiusAt0}`
      );

      controller.dispose();
    });

    it('does not cause cumulative drift after repeated factor changes', () => {
      const scene = new THREE.Scene();
      const controller = buildPlanetaryGearbox(scene);

      const centralShaft = controller.group.getObjectByName('central_shaft') as THREE.Mesh;
      const sunGear = controller.group.getObjectByName('sun_gear') as THREE.Group;
      const carrierGroup = controller.group.getObjectByName('planet_carrier') as THREE.Group;
      const ringGear = controller.group.getObjectByName('ring_gear') as THREE.Group;

      controller.setExplodedFactor!(0);
      const baseShaftY = centralShaft.position.y;
      const baseSunY = sunGear.position.y;
      const baseCarrierY = carrierGroup.position.y;
      const baseRingY = ringGear.position.y;

      // Cycle through multiple factor variations
      const factorSequence = [0.2, 0.8, 1.0, 0.4, 0.95, 0.1, 0.6, 0.0];
      for (const factor of factorSequence) {
        controller.setExplodedFactor!(factor);
        controller.update(0.016, true);
      }

      // Check that positions exactly return to baseline at factor 0
      controller.setExplodedFactor!(0);
      assert.equal(centralShaft.position.y, baseShaftY);
      assert.equal(sunGear.position.y, baseSunY);
      assert.equal(carrierGroup.position.y, baseCarrierY);
      assert.equal(ringGear.position.y, baseRingY);

      controller.dispose();
    });

    it('works correctly when stationary (isRotating = false)', () => {
      const scene = new THREE.Scene();
      const controller = buildPlanetaryGearbox(scene);

      const centralShaft = controller.group.getObjectByName('central_shaft') as THREE.Mesh;
      controller.setExplodedFactor!(0.8);
      // Update with isRotating = false
      controller.update(0.05, false);

      const shaftY = centralShaft.position.y;
      controller.update(0.05, false);

      // Shaft position should remain stable and not drift
      assert.equal(centralShaft.position.y, shaftY);

      controller.dispose();
    });
  });

  /* -------------------------------------------------------------------------
   * 2. Warren Truss Bridge Exploded View & Structural Readability
   * ------------------------------------------------------------------------- */
  describe('Warren Truss Bridge Exploded View', () => {
    it('creates a controller with setExplodedFactor interface', () => {
      const controller: WarrenTrussBridgeController = buildWarrenTrussBridge();

      assert.equal(typeof controller.setExplodedFactor, 'function');
      assert.equal(typeof controller.dispose, 'function');

      controller.dispose();
    });

    it('separates structural systems with readable multi-axis offsets at factor 1.0', () => {
      const controller = buildWarrenTrussBridge();

      const topChordsGroup = controller.group.getObjectByName('top_chords') as THREE.Group;
      const deckGroup = controller.group.getObjectByName('bridge_deck') as THREE.Group;
      const bottomChordsGroup = controller.group.getObjectByName('bottom_chords') as THREE.Group;
      const piersGroup = controller.group.getObjectByName('support_piers') as THREE.Group;
      const portalsGroup = controller.group.getObjectByName('end_portals') as THREE.Group;
      const diagonalsGroup = controller.group.getObjectByName('diagonal_members') as THREE.Group;

      assert.ok(topChordsGroup, 'Expected top_chords');
      assert.ok(deckGroup, 'Expected bridge_deck');
      assert.ok(bottomChordsGroup, 'Expected bottom_chords');
      assert.ok(piersGroup, 'Expected support_piers');
      assert.ok(portalsGroup, 'Expected end_portals');
      assert.ok(diagonalsGroup, 'Expected diagonal_members');

      controller.setExplodedFactor!(0);
      const initialTopChordsY = topChordsGroup.position.y;
      const initialDeckY = deckGroup.position.y;
      const initialBottomChordsY = bottomChordsGroup.position.y;
      const initialPiersY = piersGroup.position.y;

      // Explode to factor 1.0
      controller.setExplodedFactor!(1.0);

      // 1. Vertical hierarchy: top chords lift up (+3.0), deck lifts (+1.2), bottom chords lower (-1.2), piers lower (-2.8)
      assert.equal(topChordsGroup.position.y, initialTopChordsY + 3.0);
      assert.equal(deckGroup.position.y, initialDeckY + 1.2);
      assert.equal(bottomChordsGroup.position.y, initialBottomChordsY - 1.2);
      assert.equal(piersGroup.position.y, initialPiersY - 2.8);

      // 2. Longitudinal separation: end portals separate along X
      const portalA = portalsGroup.children[0];
      if (portalA) {
        assert.ok(
          Math.abs(portalA.position.x) > Math.abs((portalA.userData as any).baseX),
          'End portal should displace along X axis'
        );
      }

      // 3. Lateral separation: diagonals separate outward along Z
      const diagLeft = diagonalsGroup.children.find(c => (c.userData as any).baseZ > 0);
      if (diagLeft) {
        assert.ok(
          diagLeft.position.z > (diagLeft.userData as any).baseZ,
          'Truss diagonal on +Z side should explode further +Z'
        );
      }

      // 4. Exact restoration to 0
      controller.setExplodedFactor!(0);
      assert.equal(topChordsGroup.position.y, initialTopChordsY);
      assert.equal(deckGroup.position.y, initialDeckY);
      assert.equal(bottomChordsGroup.position.y, initialBottomChordsY);
      assert.equal(piersGroup.position.y, initialPiersY);

      controller.dispose();
    });

    it('clamps negative factors to 0 and factors > 1 to 1', () => {
      const controller = buildWarrenTrussBridge();
      const topChordsGroup = controller.group.getObjectByName('top_chords') as THREE.Group;

      controller.setExplodedFactor!(-0.5);
      assert.equal(topChordsGroup.position.y, 0);

      controller.setExplodedFactor!(2.5);
      assert.equal(topChordsGroup.position.y, 3.0);

      controller.dispose();
    });

    it('does not accumulate drift after multiple factor fluctuations', () => {
      const controller = buildWarrenTrussBridge();
      const topChordsGroup = controller.group.getObjectByName('top_chords') as THREE.Group;
      const deckGroup = controller.group.getObjectByName('bridge_deck') as THREE.Group;
      const bottomChordsGroup = controller.group.getObjectByName('bottom_chords') as THREE.Group;
      const piersGroup = controller.group.getObjectByName('support_piers') as THREE.Group;

      const factors = [0.1, 0.7, 0.35, 1.0, 0.6, 0.0, 0.8, 0.0];
      for (const factor of factors) {
        controller.setExplodedFactor!(factor);
      }

      assert.equal(topChordsGroup.position.y, 0);
      assert.equal(deckGroup.position.y, 0);
      assert.equal(bottomChordsGroup.position.y, 0);
      assert.equal(piersGroup.position.y, 0);

      controller.dispose();
    });
  });

  /* -------------------------------------------------------------------------
   * 3. ModelLifecycleManager Exploded View & Runtime Safety
   * ------------------------------------------------------------------------- */
  describe('ModelLifecycleManager Exploded View Integration', () => {
    it('manages exploded factor and forwards it to active model instance', () => {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      const manager = new ModelLifecycleManager({ scene, camera });

      const loadResult = manager.loadModel(PLANETARY_GEARBOX_MODEL_ID);
      assert.equal(loadResult.success, true);
      assert.equal(manager.getExplodedFactor(), 0);

      manager.setExplodedFactor(0.75);
      assert.equal(manager.getExplodedFactor(), 0.75);

      manager.dispose();
      assert.equal(manager.getExplodedFactor(), 0);
    });

    it('automatically resets exploded factor to 0 upon switching models', () => {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      const manager = new ModelLifecycleManager({ scene, camera });

      // Mount planetary gearbox and explode
      manager.loadModel(PLANETARY_GEARBOX_MODEL_ID);
      manager.setExplodedFactor(0.6);
      assert.equal(manager.getExplodedFactor(), 0.6);

      // Switch to civil Warren truss bridge
      manager.loadModel(WARREN_TRUSS_MODEL_ID);
      // Exploded factor should have been cleanly reset to 0
      assert.equal(manager.getExplodedFactor(), 0);

      manager.dispose();
    });

    it('safely releases controller references and cleans up scene on disposal', () => {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      const manager = new ModelLifecycleManager({ scene, camera });

      manager.loadModel(PLANETARY_GEARBOX_MODEL_ID);
      manager.setExplodedFactor(0.5);

      // Verify scene has objects
      assert.ok(scene.children.length > 0);

      manager.dispose();

      // Verify scene has no remaining model objects
      assert.equal(scene.children.length, 0);
      assert.equal(manager.getActiveModel(), null);
      assert.equal(manager.getActiveRuntime(), null);
    });
  });

  /* -------------------------------------------------------------------------
   * 4. Guided Learning Curriculum & Schema Validation
   * ------------------------------------------------------------------------- */
  describe('Guided Learning Curriculum', () => {
    it('provides valid guided lesson for planetary gearbox', () => {
      const lesson = getGuidedLessonForModel(PLANETARY_GEARBOX_MODEL_ID);
      assert.ok(lesson, 'Expected planetary gearbox lesson to exist');
      assert.equal(lesson.modelId, PLANETARY_GEARBOX_MODEL_ID);
      assert.equal(lesson.discipline, 'mechanical');
      assert.ok(lesson.steps.length >= 5);
    });

    it('provides valid guided lesson for warren truss bridge', () => {
      const lesson = getGuidedLessonForModel(WARREN_TRUSS_MODEL_ID);
      assert.ok(lesson, 'Expected warren truss bridge lesson to exist');
      assert.equal(lesson.modelId, WARREN_TRUSS_MODEL_ID);
      assert.equal(lesson.discipline, 'civil');
      assert.ok(lesson.steps.length >= 8);
    });

    it('returns null for unregistered model ID', () => {
      const lesson = getGuidedLessonForModel('non_existent_model');
      assert.equal(lesson, null);
    });

    it('validates that every step in Planetary Gearbox lesson matches an existing component ID', () => {
      const validIds = planetaryGearboxModel.getAllComponentIds();
      for (const step of PLANETARY_GEARBOX_LESSON.steps) {
        assert.ok(
          validIds.includes(step.componentId),
          `Component ID '${step.componentId}' in lesson step ${step.stepIndex} must exist in planetary gearbox`
        );
        const metadata = planetaryGearboxModel.getComponentMetadata(step.componentId);
        assert.ok(metadata, `Metadata must exist for step component '${step.componentId}'`);
        assert.ok(step.title.length > 0);
        assert.ok(step.description.length > 20);
        assert.ok(step.educationalNotes.length > 0);
      }
    });

    it('validates that every step in Warren Truss Bridge lesson matches an existing component ID', () => {
      const validIds = warrenTrussBridgeModel.getAllComponentIds();
      for (const step of WARREN_TRUSS_BRIDGE_LESSON.steps) {
        assert.ok(
          validIds.includes(step.componentId),
          `Component ID '${step.componentId}' in lesson step ${step.stepIndex} must exist in bridge model`
        );
        const metadata = warrenTrussBridgeModel.getComponentMetadata(step.componentId);
        assert.ok(metadata, `Metadata must exist for step component '${step.componentId}'`);
        assert.ok(step.title.length > 0);
        assert.ok(step.description.length > 20);
        assert.ok(step.educationalNotes.length > 0);
      }
    });
  });

  /* -------------------------------------------------------------------------
   * 5. Guided Learning Selection Synchronization & Restoration Logic
   * ------------------------------------------------------------------------- */
  describe('Guided Learning Selection Restoration', () => {
    it('restores previous selection on lesson exit if component exists in active model', () => {
      // Simulate selection capture before tour
      const initialSelection = 'sun_gear';
      const activeModelId = PLANETARY_GEARBOX_MODEL_ID;
      const priorState = { modelId: activeModelId, componentId: initialSelection };

      // Simulate tour stepping
      let currentSelection: string | null = PLANETARY_GEARBOX_LESSON.steps[0].componentId;
      assert.equal(currentSelection, 'sun_gear');
      currentSelection = PLANETARY_GEARBOX_LESSON.steps[2].componentId;
      assert.equal(currentSelection, 'planet_carrier');

      // Simulate exit on same model
      const model = modelRegistry.getModel(activeModelId);
      assert.ok(model);
      const validIds = model.getAllComponentIds();

      let restoredSelection: string | null = null;
      if (
        priorState.modelId === activeModelId &&
        priorState.componentId !== null &&
        validIds.includes(priorState.componentId)
      ) {
        restoredSelection = priorState.componentId;
      }

      assert.equal(restoredSelection, 'sun_gear');
    });

    it('clears selection safely if model changed during or before exit', () => {
      const priorState = {
        modelId: PLANETARY_GEARBOX_MODEL_ID,
        componentId: 'sun_gear',
      };
      // Active model switched to Warren Truss
      const activeModelId = WARREN_TRUSS_MODEL_ID;
      const model = modelRegistry.getModel(activeModelId);
      assert.ok(model);
      const validIds = model.getAllComponentIds();

      let restoredSelection: string | null = null;
      if (
        priorState.modelId === activeModelId &&
        priorState.componentId !== null &&
        validIds.includes(priorState.componentId)
      ) {
        restoredSelection = priorState.componentId;
      } else {
        restoredSelection = null;
      }

      // Must be null because model changed and sun_gear doesn't belong to bridge
      assert.equal(restoredSelection, null);
    });

    it('clears selection safely if captured component ID is no longer valid', () => {
      const priorState = {
        modelId: PLANETARY_GEARBOX_MODEL_ID,
        componentId: 'invalid_component_id_that_does_not_exist',
      };
      const activeModelId = PLANETARY_GEARBOX_MODEL_ID;
      const model = modelRegistry.getModel(activeModelId);
      assert.ok(model);
      const validIds = model.getAllComponentIds();

      let restoredSelection: string | null = null;
      if (
        priorState.modelId === activeModelId &&
        priorState.componentId !== null &&
        validIds.includes(priorState.componentId)
      ) {
        restoredSelection = priorState.componentId;
      } else {
        restoredSelection = null;
      }

      assert.equal(restoredSelection, null);
    });
  });
});
