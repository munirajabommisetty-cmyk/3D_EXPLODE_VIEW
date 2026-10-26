/**
 * Unit Tests for Polymorphic Engineering Domain Schemas & Model Contracts
 * Phase 9 - Task 9.1: Polymorphic Engineering Domain Schemas & Model Contracts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBaseComponentMetadata,
  isMechanicalMetadata,
  isCivilMetadata,
  type BaseComponentMetadata,
  type MechanicalComponentMetadata,
  type CivilComponentMetadata,
} from '../src/types/engineering';
import {
  isAssemblyTreeNode,
  isEngineeringModelDefinition,
  type AssemblyTreeNode,
  type EngineeringModelDefinition,
} from '../src/types/models';
import { EXTENDED_GEARBOX_METADATA } from '../src/data/machineMetadata';

describe('Base Component Metadata & Type Guard', () => {
  it('validates a compliant base metadata object', () => {
    const validBase: BaseComponentMetadata = {
      id: 'beam_01',
      name: 'Flange Beam',
      domain: 'civil',
      role: 'Load-Bearing Girder',
      materialName: 'Structural Steel ASTM A992',
      description: 'Wide-flange I-beam supporting vertical floor load.',
      specifications: [{ label: 'Depth', value: '350 mm' }],
      engineeringNotes: ['Inspected during fabrication.'],
    };

    assert.equal(isBaseComponentMetadata(validBase), true);
  });

  it('safely rejects null, undefined, primitives, and missing fields', () => {
    assert.equal(isBaseComponentMetadata(null), false);
    assert.equal(isBaseComponentMetadata(undefined), false);
    assert.equal(isBaseComponentMetadata('string_val'), false);
    assert.equal(isBaseComponentMetadata(42), false);
    assert.equal(isBaseComponentMetadata({}), false);

    // Missing required fields
    assert.equal(
      isBaseComponentMetadata({
        id: 'part_1',
        name: 'Part 1',
        domain: 'mechanical',
        // role missing
        materialName: 'Steel',
        description: 'Test',
        specifications: [],
        engineeringNotes: [],
      }),
      false
    );

    // Invalid domain
    assert.equal(
      isBaseComponentMetadata({
        id: 'part_1',
        name: 'Part 1',
        domain: 'aerospace', // Not mechanical or civil
        role: 'Wing',
        materialName: 'Carbon',
        description: 'Test',
        specifications: [],
        engineeringNotes: [],
      }),
      false
    );
  });
});

describe('Mechanical Component Metadata & Type Guard', () => {
  it('validates a full mechanical component metadata record', () => {
    const mechanicalPart: MechanicalComponentMetadata = {
      id: 'gear_drive',
      name: 'High-Speed Pinion',
      domain: 'mechanical',
      role: 'Torque Transmitter',
      materialName: 'Alloy Steel AISI 4340',
      description: 'Precision spur gear with induction-hardened teeth.',
      nominalRpm: '1,800 RPM',
      gearRatio: '2.5 : 1',
      teethCount: 20,
      pitchDiameter: '50.0 mm',
      modulePitch: '2.5 mm',
      lubricationSpec: 'ISO VG 320 Synthetic',
      serviceIntervalHours: 4000,
      torqueRating: '65.0 N·m',
      specifications: [
        { label: 'Pressure Angle', value: '20°' },
        { label: 'Hardness', value: '58 HRC' },
      ],
      engineeringNotes: ['Requires annual backlash verification.'],
    };

    assert.equal(isMechanicalMetadata(mechanicalPart), true);
    assert.equal(isCivilMetadata(mechanicalPart), false);
  });

  it('validates mechanical metadata when optional domain fields are omitted', () => {
    // Only base fields + domain: 'mechanical', all optional fields omitted
    const minimalMechanical: MechanicalComponentMetadata = {
      id: 'spacer_ring',
      name: 'Shaft Spacer',
      domain: 'mechanical',
      role: 'Axial Alignment',
      materialName: 'Bronze Alloy',
      description: 'Separates bearing inner races.',
      specifications: [],
      engineeringNotes: [],
    };

    assert.equal(isMechanicalMetadata(minimalMechanical), true);
    assert.equal(isCivilMetadata(minimalMechanical), false);
  });

  it('proves compatibility with existing planetary gearbox metadata', () => {
    // Existing planetary gearbox metadata seamlessly maps to MechanicalComponentMetadata
    const sunGear = EXTENDED_GEARBOX_METADATA.sun_gear;
    const mechanicalSunGear: MechanicalComponentMetadata = {
      ...sunGear,
      domain: 'mechanical',
    };

    assert.equal(isMechanicalMetadata(mechanicalSunGear), true);
    assert.equal(mechanicalSunGear.teethCount, 16);
    assert.equal(mechanicalSunGear.nominalRpm, '1,200 RPM (Input)');
    assert.equal(mechanicalSunGear.materialName, 'High-Tensile Brass Alloy');
  });
});

describe('Civil Component Metadata & Educational Annotations', () => {
  it('validates civil component metadata with qualitative educational annotations', () => {
    const civilMember: CivilComponentMetadata = {
      id: 'top_chord_t1',
      name: 'Upper Compression Chord T1',
      domain: 'civil',
      role: 'Primary Top Chord Member',
      materialName: 'Structural Steel ASTM A36',
      description: 'Horizontal member resisting axial compressive forces under bridge deck live load.',
      structuralRole: 'top_chord',
      nominalForceType: 'compression',
      designLoadAnnotation: 'Qualitative educational reference: Designed for nominal AASHTO truck loading',
      materialGrade: 'ASTM A36 (Yield 250 MPa)',
      spanLength: '6.0 m panel',
      slendernessAnnotation: 'KL/r <= 120 (AISC Specification)',
      educationalNotes: [
        'Under downward gravity loading, top chords carry compression while bottom chords carry tension.',
        'Requires lateral bracing at panel points to prevent out-of-plane buckling.',
      ],
      specifications: [
        { label: 'Profile Type', value: 'W14x90 Wide Flange' },
        { label: 'Cross-Section Area', value: '17,100 mm²' },
      ],
      engineeringNotes: ['Bolted connection via double-shear gusset plates.'],
    };

    assert.equal(isCivilMetadata(civilMember), true);
    assert.equal(isMechanicalMetadata(civilMember), false);
  });

  it('validates civil metadata when optional annotations are omitted', () => {
    // Civil components are NOT required to provide yield strength, force type, or capacity
    const minimalCivil: CivilComponentMetadata = {
      id: 'bearing_pad_01',
      name: 'Elastomeric Bearing Pad',
      domain: 'civil',
      role: 'Abutment Support',
      materialName: 'Reinforced Neoprene',
      description: 'Accommodates thermal expansion and rotational movement at the bridge support.',
      specifications: [{ label: 'Thickness', value: '50 mm' }],
      engineeringNotes: ['Replaced during 15-year bridge maintenance overhaul.'],
    };

    assert.equal(isCivilMetadata(minimalCivil), true);
    assert.equal(minimalCivil.nominalForceType, undefined);
    assert.equal(minimalCivil.structuralRole, undefined);
  });
});

describe('Assembly Tree Node Schema & Type Guard', () => {
  it('validates a single component leaf node', () => {
    const leafNode: AssemblyTreeNode = {
      id: 'node_sun_gear',
      name: 'Sun Gear',
      type: 'component',
      componentId: 'sun_gear',
      defaultVisible: true,
    };

    assert.equal(isAssemblyTreeNode(leafNode), true);
  });

  it('validates a nested hierarchical CAD assembly tree', () => {
    const assemblyTree: AssemblyTreeNode = {
      id: 'root_gearbox',
      name: 'Planetary Gearbox Assembly',
      type: 'assembly',
      defaultExpanded: true,
      children: [
        {
          id: 'sub_planetary_stage',
          name: 'Epicyclic Planetary Stage',
          type: 'subassembly',
          defaultExpanded: true,
          children: [
            {
              id: 'node_sun',
              name: 'Sun Gear',
              type: 'component',
              componentId: 'sun_gear',
            },
            {
              id: 'sub_planets',
              name: 'Planet Gears Cluster',
              type: 'subassembly',
              children: [
                { id: 'node_planet_1', name: 'Planet A', type: 'component', componentId: 'planet_gear_1' },
                { id: 'node_planet_2', name: 'Planet B', type: 'component', componentId: 'planet_gear_2' },
                { id: 'node_planet_3', name: 'Planet C', type: 'component', componentId: 'planet_gear_3' },
              ],
            },
          ],
        },
        {
          id: 'node_ring',
          name: 'Outer Ring Gear',
          type: 'component',
          componentId: 'ring_gear',
        },
      ],
    };

    assert.equal(isAssemblyTreeNode(assemblyTree), true);
  });

  it('safely rejects corrupted or malformed assembly tree nodes', () => {
    assert.equal(isAssemblyTreeNode(null), false);
    assert.equal(isAssemblyTreeNode({ id: 'bad', name: 'Bad', type: 'unknown_type' }), false);
    assert.equal(
      isAssemblyTreeNode({
        id: 'bad_children',
        name: 'Bad Children',
        type: 'assembly',
        children: 'not_an_array',
      }),
      false
    );
    assert.equal(
      isAssemblyTreeNode({
        id: 'bad_child_node',
        name: 'Bad Child Node',
        type: 'assembly',
        children: [{ id: 123 }], // child missing name/type
      }),
      false
    );
  });
});

describe('Engineering Model Definition Schema & Type Guard', () => {
  it('validates a complete EngineeringModelDefinition object', () => {
    const mockModel: EngineeringModelDefinition = {
      id: 'planetary_gearbox',
      name: 'Planetary Gearbox (Epicyclic Reduction)',
      domain: 'mechanical',
      category: 'Transmission Mechanisms',
      description: 'High-torque coaxial reduction gearbox featuring sun, planet, and annulus gears.',
      thumbnailUrl: '/assets/models/planetary_gearbox.webp',
      difficulty: 'Intermediate',
      tags: ['Gears', 'Torque', 'Kinematics', 'Transmission'],
      componentCount: 7,
      cameraConfig: {
        initialPosition: [0, 4, 9],
        target: [0, 0, 0],
        minDistance: 2.0,
        maxDistance: 25.0,
        fov: 45,
        defaultPreset: 'isometric',
      },
      getAssemblyTree: () => ({
        id: 'gearbox_root',
        name: 'Planetary Gearbox',
        type: 'assembly',
      }),
      getComponentMetadata: (id: string) => {
        if (id === 'sun_gear') {
          return {
            ...EXTENDED_GEARBOX_METADATA.sun_gear,
            domain: 'mechanical',
          };
        }
        return null;
      },
      getAllComponentIds: () => ['sun_gear', 'planet_gear_1', 'ring_gear'],
      buildScene: () => ({
        rootGroup: {} as any, // mock for test
        dispose: () => {},
      }),
    };

    assert.equal(isEngineeringModelDefinition(mockModel), true);
  });

  it('safely rejects incomplete or invalid model definitions', () => {
    assert.equal(isEngineeringModelDefinition(null), false);
    assert.equal(isEngineeringModelDefinition({ id: 'incomplete' }), false);
    assert.equal(
      isEngineeringModelDefinition({
        id: 'test',
        name: 'Test',
        domain: 'unsupported_domain',
        category: 'Cat',
        description: 'Desc',
        thumbnailUrl: '/img.webp',
        difficulty: 'Beginner',
        tags: [],
        componentCount: 1,
        cameraConfig: {},
        getAssemblyTree: () => {},
        getComponentMetadata: () => null,
        getAllComponentIds: () => [],
        buildScene: () => {},
      }),
      false
    );
  });
});
