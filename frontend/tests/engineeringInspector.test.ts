/**
 * Unit & Integration Test Suite for General-Purpose Engineering Inspector Panel
 * Phase 9 - Task 9.6
 *
 * Validates:
 * 1. Rendering empty state when no component is selected.
 * 2. Rendering fallback alert state when component ID has no metadata.
 * 3. Resolving and rendering mechanical component metadata (Planetary Gearbox).
 * 4. Rendering partial metadata gracefully without runtime errors.
 * 5. Omitting absent optional fields without fabricating default values.
 * 6. Rendering civil engineering metadata across Overview, Specifications, and Materials tabs.
 * 7. Rendering a clear materials empty state when no material info is present.
 * 8. Dynamic metadata resolution with model switching and selection clearing.
 * 9. Keyboard, WAI-ARIA tab semantics, and accessibility attributes.
 * 10. String formatting and MetadataRow helper utilities.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  EngineeringInspectorPanel,
  MetadataRow,
} from '../src/components/workspace/EngineeringInspectorPanel';
import {
  resolveInspectorMetadata,
  formatRoleTitle,
} from '../src/utils/inspectorUtils';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import type {
  MechanicalComponentMetadata,
  CivilComponentMetadata,
  BaseComponentMetadata,
} from '../src/types/engineering';

// Representative civil engineering metadata fixture (Warren truss chord)
const MOCK_CIVIL_COMPONENT: CivilComponentMetadata = {
  id: 'truss_top_chord_01',
  name: 'Warren Truss Top Chord',
  domain: 'civil',
  role: 'Primary Compression Chord',
  materialName: 'Structural Steel',
  description: 'Main upper compression member of the Warren truss span.',
  specifications: [
    { label: 'Section Designation', value: 'W12x96' },
    { label: 'Yield Strength', value: '50 ksi (345 MPa)' },
  ],
  engineeringNotes: ['Braced at panel points against out-of-plane buckling.'],
  structuralRole: 'top_chord',
  nominalForceType: 'compression',
  designLoadAnnotation: 'AASHTO HL-93 LRFD Strength I',
  materialGrade: 'ASTM A992 Grade 50',
  spanLength: '12.0 m (39.4 ft)',
  slendernessAnnotation: 'KL/r = 78 (governed by Euler buckling limit KL/r < 120)',
  educationalNotes: [
    'Compression members are susceptible to flexural and torsional buckling.',
    'Cross-section requires adequate radius of gyration.',
  ],
};

// Partial mechanical component fixture (omits optional lubrication, service interval, torque rating)
const MOCK_PARTIAL_MECHANICAL: MechanicalComponentMetadata = {
  id: 'intermediate_spur_gear',
  name: 'Intermediate Spur Gear',
  domain: 'mechanical',
  role: 'Intermediate Stage Pinion',
  materialName: 'AISI 4140 Alloy Steel',
  description: 'Precision intermediate reduction gear.',
  specifications: [
    { label: 'Pressure Angle', value: '20°' },
  ],
  engineeringNotes: ['Hardened teeth surface per ISO 6336.'],
  nominalRpm: '1200 RPM',
  gearRatio: '2.5:1',
  teethCount: 24,
  pitchDiameter: '48.0 mm',
  modulePitch: '2.0 mm',
  // lubricationSpec, serviceIntervalHours, torqueRating omitted
};

// Component with zero material data fixture
const MOCK_NO_MATERIAL_COMPONENT: CivilComponentMetadata = {
  id: 'theoretical_pin_joint',
  name: 'Idealized Pin Joint Node',
  domain: 'civil',
  role: 'Kinematic Boundary Node',
  materialName: '',
  description: 'Theoretical frictionless hinge connecting truss members at panel point.',
  specifications: [],
  engineeringNotes: ['Assumed frictionless in idealized planar analysis.'],
  structuralRole: 'gusset_plate',
  nominalForceType: 'combined',
  // materialGrade omitted
};

describe('EngineeringInspectorPanel — Empty & Fallback States', () => {
  it('renders clear empty state placeholder when no component is selected', () => {
    const html = renderToStaticMarkup(
      React.createElement(EngineeringInspectorPanel, {
        componentId: null,
        onClose: () => {},
      })
    );

    assert.ok(html.includes('No Component Selected'), 'Expected empty state title');
    assert.ok(html.includes('Task 9.6 Ready'), 'Expected Task 9.6 placeholder badge');
    assert.ok(
      html.includes('aria-label="Engineering Component Inspector (No Selection)"'),
      'Expected accessible ARIA label for empty inspector'
    );
    assert.ok(html.includes('Point at component to target'), 'Expected laser pointer hint');
  });

  it('renders fallback warning when component ID is provided but metadata is not found', () => {
    const html = renderToStaticMarkup(
      React.createElement(EngineeringInspectorPanel, {
        componentId: 'non_existent_part_99',
        onClose: () => {},
      })
    );

    assert.ok(html.includes('ID: non_existent_part_99'), 'Expected part ID in fallback header');
    assert.ok(
      html.includes('Component metadata unavailable for &quot;non_existent_part_99&quot;') ||
        html.includes('Component metadata unavailable for "non_existent_part_99"'),
      'Expected metadata unavailable warning'
    );
  });
});

describe('EngineeringInspectorPanel — Mechanical Component Rendering', () => {
  const gearboxModel = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);

  it('renders planetary gearbox sun gear overview tab accurately from registry', () => {
    const html = renderToStaticMarkup(
      React.createElement(EngineeringInspectorPanel, {
        componentId: 'sun_gear',
        activeModel: gearboxModel,
        onClose: () => {},
        initialTab: 'overview',
      })
    );

    // Header info
    assert.ok(html.includes('Sun Gear'), 'Expected component name');
    assert.ok(html.includes('ID: sun_gear'), 'Expected component ID');
    assert.ok(html.includes('Central Driving Input'), 'Expected functional role subtitle');
    assert.ok(html.includes('⚙️ Mechanical'), 'Expected mechanical domain pill');

    // Overview content
    assert.ok(html.includes('Functional Description'), 'Expected functional description header');
    assert.ok(
      html.includes('Central input gear that meshes with all three planet gears'),
      'Expected description snippet'
    );
    assert.ok(html.includes('System Identification'), 'Expected system identification card');
    assert.ok(html.includes('Mechanical Engineering'), 'Expected discipline row');
    assert.ok(
      html.includes('High-tensile brass hub minimizes frictional heat'),
      'Expected engineering note'
    );
  });

  it('renders mechanical specifications and omits missing optional fields without defaults', () => {
    const html = renderToStaticMarkup(
      React.createElement(EngineeringInspectorPanel, {
        metadata: MOCK_PARTIAL_MECHANICAL,
        onClose: () => {},
        initialTab: 'specifications',
      })
    );

    // Present specifications
    assert.ok(html.includes('Nominal Speed'), 'Expected Nominal Speed label');
    assert.ok(html.includes('1200 RPM'), 'Expected 1200 RPM value');
    assert.ok(html.includes('Gear Ratio'), 'Expected Gear Ratio label');
    assert.ok(html.includes('2.5:1'), 'Expected 2.5:1 value');
    assert.ok(html.includes('Teeth Count'), 'Expected Teeth Count label');
    assert.ok(html.includes('24 teeth'), 'Expected 24 teeth formatted count');
    assert.ok(html.includes('Pitch Diameter'), 'Expected Pitch Diameter label');
    assert.ok(html.includes('48.0 mm'), 'Expected 48.0 mm value');
    assert.ok(html.includes('Module Pitch'), 'Expected Module Pitch label');
    assert.ok(html.includes('2.0 mm'), 'Expected 2.0 mm value');

    // Missing optional specifications must NOT be rendered with fabricated defaults
    assert.ok(!html.includes('Torque Rating'), 'Omitted torque rating must not appear');
    assert.ok(!html.includes('Lubrication'), 'Omitted lubrication spec must not appear');
    assert.ok(!html.includes('Service Interval'), 'Omitted service interval must not appear');
  });

  it('renders mechanical materials tab when material data is present', () => {
    const html = renderToStaticMarkup(
      React.createElement(EngineeringInspectorPanel, {
        metadata: MOCK_PARTIAL_MECHANICAL,
        onClose: () => {},
        initialTab: 'materials',
      })
    );

    assert.ok(html.includes('Material Specification'), 'Expected Material Specification section');
    assert.ok(html.includes('AISI 4140 Alloy Steel'), 'Expected material name');
    assert.ok(!html.includes('No Material Data Available'), 'Should not show empty state');
  });
});

describe('EngineeringInspectorPanel — Civil Component Rendering', () => {
  it('renders civil component Overview tab with domain pill and structural role', () => {
    const html = renderToStaticMarkup(
      React.createElement(EngineeringInspectorPanel, {
        metadata: MOCK_CIVIL_COMPONENT,
        onClose: () => {},
        initialTab: 'overview',
      })
    );

    assert.ok(html.includes('Warren Truss Top Chord'), 'Expected civil member name');
    assert.ok(html.includes('ID: truss_top_chord_01'), 'Expected civil part ID');
    assert.ok(html.includes('🌉 Civil'), 'Expected civil domain pill');
    assert.ok(html.includes('Primary Compression Chord'), 'Expected functional role');
    assert.ok(html.includes('Top Chord'), 'Expected formatted structural position');
    assert.ok(html.includes('Educational Notes'), 'Expected Educational Notes header for civil component');
    assert.ok(html.includes('Compression members are susceptible to flexural'), 'Expected educational note text');
  });

  it('renders civil-specific fields in Specifications tab accurately', () => {
    const html = renderToStaticMarkup(
      React.createElement(EngineeringInspectorPanel, {
        metadata: MOCK_CIVIL_COMPONENT,
        onClose: () => {},
        initialTab: 'specifications',
      })
    );

    assert.ok(html.includes('Structural Design Annotations'), 'Expected structural design annotations header');
    assert.ok(html.includes('Educational Spec'), 'Expected educational spec badge');
    assert.ok(html.includes('Structural Member'), 'Expected Structural Member row');
    assert.ok(html.includes('Top Chord'), 'Expected formatted structural role');
    assert.ok(html.includes('Nominal Force'), 'Expected Nominal Force row');
    assert.ok(html.includes('Compression'), 'Expected formatted compression force');
    assert.ok(html.includes('Design Load Ref'), 'Expected Design Load Ref row');
    assert.ok(html.includes('AASHTO HL-93 LRFD Strength I'), 'Expected AASHTO design load text');
    assert.ok(html.includes('Material Grade'), 'Expected Material Grade row in specifications');
    assert.ok(html.includes('ASTM A992 Grade 50'), 'Expected ASTM grade value');
    assert.ok(html.includes('Span / Length'), 'Expected Span / Length row');
    assert.ok(html.includes('12.0 m (39.4 ft)'), 'Expected span length value');
    assert.ok(html.includes('Slenderness Ref'), 'Expected Slenderness Ref row');
    assert.ok(html.includes('KL/r = 78'), 'Expected slenderness annotation value');
  });

  it('renders civil materials tab with structural grade and designated alloy', () => {
    const html = renderToStaticMarkup(
      React.createElement(EngineeringInspectorPanel, {
        metadata: MOCK_CIVIL_COMPONENT,
        onClose: () => {},
        initialTab: 'materials',
      })
    );

    assert.ok(html.includes('Structural Steel'), 'Expected designated material name');
    assert.ok(html.includes('Structural Grade'), 'Expected structural grade label');
    assert.ok(html.includes('ASTM A992 Grade 50'), 'Expected ASTM A992 Grade 50 value');
    assert.ok(html.includes('Yield Strength'), 'Expected yield strength specification');
    assert.ok(html.includes('50 ksi (345 MPa)'), 'Expected yield strength value');
  });

  it('renders clear materials empty state when component lacks material data', () => {
    const html = renderToStaticMarkup(
      React.createElement(EngineeringInspectorPanel, {
        metadata: MOCK_NO_MATERIAL_COMPONENT,
        onClose: () => {},
        initialTab: 'materials',
      })
    );

    assert.ok(html.includes('No Material Data Available'), 'Expected No Material Data Available title');
    assert.ok(
      html.includes('This component does not specify alloy composition'),
      'Expected educational explanation that material is absent'
    );
    assert.ok(!html.includes('Designated Material'), 'Designated Material row must not be rendered');
  });
});

describe('EngineeringInspectorPanel — Graceful Handling of Partial Metadata', () => {
  it('renders minimal component metadata without runtime errors', () => {
    const minimalComponent: BaseComponentMetadata = {
      id: 'minimal_part',
      name: 'Minimal Component',
      domain: 'mechanical',
      role: 'Test Bracket',
      materialName: '',
      description: '',
      specifications: [],
      engineeringNotes: [],
    };

    const html = renderToStaticMarkup(
      React.createElement(EngineeringInspectorPanel, {
        metadata: minimalComponent,
        onClose: () => {},
      })
    );

    assert.ok(html.includes('Minimal Component'), 'Expected minimal component name rendered');
    assert.ok(html.includes('ID: minimal_part'), 'Expected minimal ID rendered');
    assert.ok(html.includes('Test Bracket'), 'Expected role rendered');
  });
});

describe('EngineeringInspectorPanel — Selection Dynamics & Resolution Flow', () => {
  const gearboxModel = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);

  it('resolves metadata from explicit prop first', () => {
    const resolved = resolveInspectorMetadata(MOCK_CIVIL_COMPONENT, 'sun_gear', gearboxModel);
    assert.equal(resolved?.id, 'truss_top_chord_01', 'Prop metadata should take priority');
  });

  it('resolves component metadata from activeModel when componentId is provided', () => {
    const resolved = resolveInspectorMetadata(null, 'planet_carrier', gearboxModel);
    assert.equal(resolved?.id, 'planet_carrier');
    assert.equal(resolved?.name, 'Planet Carrier & Output Plate');
  });

  it('falls back to default gearbox model if activeModel does not provide it', () => {
    const resolved = resolveInspectorMetadata(null, 'ring_gear', null);
    assert.equal(resolved?.id, 'ring_gear');
    assert.equal(resolved?.name, 'Annulus (Ring Gear)');
  });

  it('returns null when neither metadata nor valid componentId is passed', () => {
    const resolved = resolveInspectorMetadata(null, null, gearboxModel);
    assert.equal(resolved, null, 'Expected null when componentId is null');
  });
});

describe('EngineeringInspectorPanel — Accessibility & Helpers', () => {
  it('renders tab navigation with proper WAI-ARIA role and aria-selected states', () => {
    const html = renderToStaticMarkup(
      React.createElement(EngineeringInspectorPanel, {
        metadata: MOCK_CIVIL_COMPONENT,
        onClose: () => {},
        initialTab: 'specifications',
      })
    );

    // Tablist role
    assert.ok(html.includes('role="tablist"'), 'Expected tablist container role');

    // Selected tab
    assert.ok(html.includes('aria-selected="true"'), 'Expected one selected tab');
    assert.ok(html.includes('aria-controls='), 'Expected aria-controls link to tabpanel');

    // Tabpanel role
    assert.ok(html.includes('role="tabpanel"'), 'Expected active tabpanel role');

    // Close button accessibility
    assert.ok(html.includes('aria-label="Close component inspector"'), 'Expected accessible close button label');
  });

  it('formatRoleTitle converts snake_case to Title Case safely', () => {
    assert.equal(formatRoleTitle('top_chord'), 'Top Chord');
    assert.equal(formatRoleTitle('vertical_strut'), 'Vertical Strut');
    assert.equal(formatRoleTitle('gusset_plate'), 'Gusset Plate');
    assert.equal(formatRoleTitle(null), '');
    assert.equal(formatRoleTitle(undefined), '');
  });

  it('MetadataRow omits rendering when value is undefined, null, or empty string', () => {
    const htmlNull = renderToStaticMarkup(
      React.createElement(MetadataRow, { label: 'Empty Spec', value: null })
    );
    assert.equal(htmlNull, '', 'Expected null value to yield empty output');

    const htmlEmpty = renderToStaticMarkup(
      React.createElement(MetadataRow, { label: 'Empty Spec', value: '' })
    );
    assert.equal(htmlEmpty, '', 'Expected empty string to yield empty output');

    const htmlValue = renderToStaticMarkup(
      React.createElement(MetadataRow, { label: 'Speed', value: 1200, unit: 'RPM' })
    );
    assert.ok(htmlValue.includes('Speed'), 'Expected label in output');
    assert.ok(htmlValue.includes('1200 RPM'), 'Expected value and unit in output');
  });
});
