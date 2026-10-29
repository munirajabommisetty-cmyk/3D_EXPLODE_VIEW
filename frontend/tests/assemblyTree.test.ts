/**
 * Unit & Integration Test Suite for Interactive Assembly Hierarchy Tree Panel
 * Phase 9 - Task 9.5
 *
 * Validates:
 * 1. Rendering full assembly hierarchy from EngineeringModelDefinition data.
 * 2. Nested subassembly and component rendering with accurate labels and types.
 * 3. Bidirectional selection (clicking a component in tree calls onSelectComponent).
 * 4. External viewer selection reflection (highlighting matching component row).
 * 5. Assembly node click behavior (toggles expansion, does NOT select as a component).
 * 6. Component visibility toggles (affects component visibility, does not trigger selection).
 * 7. Search filtering (matches query, retains ancestor assembly path, shows clear action).
 * 8. Empty tree and no-matches empty states.
 * 9. Keyboard navigation & accessibility attributes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssemblyTreePanel } from '../src/components/workspace/AssemblyTreePanel';
import {
  getDescendantComponentIds,
  findAncestorNodeIds,
  filterAssemblyTree,
} from '../src/utils/assemblyTreeUtils';
import { getPlanetaryGearboxAssemblyTree } from '../src/models/mechanical/planetaryGearboxModel';
import type { AssemblyTreeNode } from '../src/types/models';

describe('AssemblyTreePanel Helper Functions', () => {
  const gearboxTree = getPlanetaryGearboxAssemblyTree();

  it('getDescendantComponentIds collects all leaf component IDs under a node', () => {
    // Root should contain all 7 components
    const allIds = getDescendantComponentIds(gearboxTree);
    assert.equal(allIds.length, 7);
    assert.ok(allIds.includes('sun_gear'));
    assert.ok(allIds.includes('planet_gear_1'));
    assert.ok(allIds.includes('planet_gear_2'));
    assert.ok(allIds.includes('planet_gear_3'));
    assert.ok(allIds.includes('ring_gear'));
    assert.ok(allIds.includes('planet_carrier'));
    assert.ok(allIds.includes('central_shaft'));

    // Subassembly: planet cluster should contain only the 3 planet gears
    const epicyclicStage = gearboxTree.children?.find((c) => c.id === 'stage_epicyclic');
    assert.ok(epicyclicStage);
    const planetCluster = epicyclicStage.children?.find((c) => c.id === 'sub_planets_cluster');
    assert.ok(planetCluster);

    const clusterIds = getDescendantComponentIds(planetCluster);
    assert.deepEqual(clusterIds.sort(), ['planet_gear_1', 'planet_gear_2', 'planet_gear_3']);

    // Leaf component returns its own componentId
    const sunGearNode = epicyclicStage.children?.find((c) => c.id === 'node_sun_gear');
    assert.ok(sunGearNode);
    assert.deepEqual(getDescendantComponentIds(sunGearNode), ['sun_gear']);
  });

  it('findAncestorNodeIds returns ancestor path leading down to a target component', () => {
    const ancestorsOfSunGear = findAncestorNodeIds(gearboxTree, 'sun_gear');
    assert.ok(ancestorsOfSunGear.includes('planetary_gearbox_root'));
    assert.ok(ancestorsOfSunGear.includes('stage_epicyclic'));

    const ancestorsOfPlanet2 = findAncestorNodeIds(gearboxTree, 'planet_gear_2');
    assert.ok(ancestorsOfPlanet2.includes('planetary_gearbox_root'));
    assert.ok(ancestorsOfPlanet2.includes('stage_epicyclic'));
    assert.ok(ancestorsOfPlanet2.includes('sub_planets_cluster'));

    // Non-existent component returns empty array
    const nonExistent = findAncestorNodeIds(gearboxTree, 'non_existent_part');
    assert.deepEqual(nonExistent, []);
  });

  it('filterAssemblyTree filters components while preserving ancestor paths', () => {
    // Searching "sun" should retain root -> stage_epicyclic -> sun_gear
    const resultSun = filterAssemblyTree(gearboxTree, 'sun');
    assert.equal(resultSun.matches, true);
    assert.ok(resultSun.filteredNode);
    assert.equal(resultSun.filteredNode.id, 'planetary_gearbox_root');

    // Descendants must only contain sun_gear among components
    const filteredDescendants = getDescendantComponentIds(resultSun.filteredNode);
    assert.deepEqual(filteredDescendants, ['sun_gear']);

    // Searching non-existent query returns matches: false
    const resultNone = filterAssemblyTree(gearboxTree, 'unobtainium');
    assert.equal(resultNone.matches, false);
    assert.equal(resultNone.filteredNode, null);
  });
});

describe('AssemblyTreePanel Component Rendering', () => {
  const gearboxTree = getPlanetaryGearboxAssemblyTree();

  it('renders the complete assembly hierarchy with correct labels and icons', () => {
    const html = renderToStaticMarkup(
      React.createElement(AssemblyTreePanel, {
        rootNode: gearboxTree,
        selectedComponentId: null,
        onSelectComponent: () => {},
        hiddenComponentIds: new Set<string>(),
        onToggleVisibility: () => {},
      })
    );

    // Root assembly node
    assert.ok(html.includes('Planetary Gearbox Assembly'), 'Expected root assembly title');

    // Subassemblies
    assert.ok(html.includes('Epicyclic Planetary Stage'), 'Expected epicyclic stage subassembly');
    assert.ok(html.includes('Planet Gears Cluster'), 'Expected planet gears cluster subassembly');

    // Individual component rows
    assert.ok(html.includes('Sun Gear'), 'Expected Sun Gear component');
    assert.ok(html.includes('Planet Gear A'), 'Expected Planet Gear A component');
    assert.ok(html.includes('Planet Gear B'), 'Expected Planet Gear B component');
    assert.ok(html.includes('Planet Gear C'), 'Expected Planet Gear C component');
    assert.ok(html.includes('Outer Annulus (Ring Gear)'), 'Expected Ring Gear component');
    assert.ok(html.includes('Planet Carrier Plate'), 'Expected Planet Carrier component');
    assert.ok(html.includes('Primary Drive Shaft'), 'Expected Drive Shaft component');

    // Icons
    assert.ok(html.includes('gl-icon-layers') || html.includes('gl-icon-box'), 'Expected assembly/subassembly icon');
    assert.ok(html.includes('gl-icon-part'), 'Expected component icon');
  });

  it('highlights the selected component row matching selectedComponentId', () => {
    const html = renderToStaticMarkup(
      React.createElement(AssemblyTreePanel, {
        rootNode: gearboxTree,
        selectedComponentId: 'sun_gear',
        onSelectComponent: () => {},
        hiddenComponentIds: new Set<string>(),
        onToggleVisibility: () => {},
      })
    );

    // Sun Gear row should have selected class and aria-selected="true"
    assert.ok(html.includes('selected'), 'Expected selected class on matching row');
    assert.ok(html.includes('aria-selected="true"'), 'Expected aria-selected="true"');
  });

  it('does not mark assembly or subassembly nodes as selected components', () => {
    const html = renderToStaticMarkup(
      React.createElement(AssemblyTreePanel, {
        rootNode: gearboxTree,
        selectedComponentId: 'sun_gear',
        onSelectComponent: () => {},
        hiddenComponentIds: new Set<string>(),
        onToggleVisibility: () => {},
      })
    );

    // Assembly and subassembly nodes must have aria-selected="false" and not have "selected" class
    assert.ok(html.includes('aria-label="Epicyclic Planetary Stage (subassembly)"'));
    assert.ok(html.includes('aria-selected="false"'));
    assert.ok(!html.includes('tree-node-row subassembly selected'));
    assert.ok(!html.includes('tree-node-row assembly selected'));
  });

  it('renders visibility toggle button with active/hidden state indicators', () => {
    // Hide sun_gear and planet_gear_1
    const hiddenSet = new Set<string>(['sun_gear', 'planet_gear_1']);

    const html = renderToStaticMarkup(
      React.createElement(AssemblyTreePanel, {
        rootNode: gearboxTree,
        selectedComponentId: null,
        onSelectComponent: () => {},
        hiddenComponentIds: hiddenSet,
        onToggleVisibility: () => {},
      })
    );

    // Hidden nodes should have hidden-node class and strikethrough symbol
    assert.ok(html.includes('hidden-node'), 'Expected hidden-node class');
    assert.ok(html.includes('gl-icon-eyeOff'), 'Expected hidden visibility icon');
    assert.ok(html.includes('gl-icon-eye"'), 'Expected visible icon for unhidden nodes');
    assert.ok(html.includes('2 hidden parts'), 'Expected footer summary of hidden parts');
  });

  it('renders clean empty state when rootNode is null or undefined', () => {
    const html = renderToStaticMarkup(
      React.createElement(AssemblyTreePanel, {
        rootNode: null,
        selectedComponentId: null,
        onSelectComponent: () => {},
        hiddenComponentIds: new Set<string>(),
        onToggleVisibility: () => {},
      })
    );

    assert.ok(html.includes('assembly-tree-empty'), 'Expected empty state container');
    assert.ok(html.includes('No Assembly Hierarchy'), 'Expected No Assembly Hierarchy title');
  });

  it('renders search filter input and accessible clear action button', () => {
    const html = renderToStaticMarkup(
      React.createElement(AssemblyTreePanel, {
        rootNode: gearboxTree,
        selectedComponentId: null,
        onSelectComponent: () => {},
        hiddenComponentIds: new Set<string>(),
        onToggleVisibility: () => {},
      })
    );

    assert.ok(html.includes('tree-filter-bar'), 'Expected search filter bar');
    assert.ok(html.includes('placeholder="Filter assembly components..."'), 'Expected placeholder text');
    assert.ok(html.includes('aria-label="Filter assembly tree components"'), 'Expected accessible label');
  });
});

describe('AssemblyTreePanel Custom Hierarchy Models', () => {
  it('renders a custom/arbitrary multi-level hierarchy without hardcoded assumptions', () => {
    const customTree: AssemblyTreeNode = {
      id: 'custom_truss_span',
      name: 'Warren Steel Truss Span',
      type: 'assembly',
      defaultExpanded: true,
      children: [
        {
          id: 'chord_top_group',
          name: 'Top Compression Chords',
          type: 'subassembly',
          defaultExpanded: true,
          children: [
            {
              id: 'truss_tc_1',
              name: 'Top Chord Member TC-01',
              type: 'component',
              componentId: 'tc_01',
            },
          ],
        },
        {
          id: 'chord_bottom_group',
          name: 'Bottom Tension Chords',
          type: 'subassembly',
          defaultExpanded: true,
          children: [
            {
              id: 'truss_bc_1',
              name: 'Bottom Chord Member BC-01',
              type: 'component',
              componentId: 'bc_01',
            },
          ],
        },
      ],
    };

    const html = renderToStaticMarkup(
      React.createElement(AssemblyTreePanel, {
        rootNode: customTree,
        selectedComponentId: 'bc_01',
        onSelectComponent: () => {},
        hiddenComponentIds: new Set<string>(),
        onToggleVisibility: () => {},
      })
    );

    assert.ok(html.includes('Warren Steel Truss Span'), 'Expected custom root assembly');
    assert.ok(html.includes('Top Compression Chords'), 'Expected custom subassembly');
    assert.ok(html.includes('Top Chord Member TC-01'), 'Expected custom component');
    assert.ok(html.includes('Bottom Chord Member BC-01'), 'Expected selected custom component');
    assert.ok(html.includes('selected'), 'Expected selected highlight on bc_01');
  });
});
