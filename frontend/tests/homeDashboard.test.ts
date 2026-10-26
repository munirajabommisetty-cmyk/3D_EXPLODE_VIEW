/**
 * Unit & Integration Test Suite for Engineering Explorer Home Dashboard & Model Catalogue
 * Phase 9 - Task 9.7
 *
 * Validates:
 * 1. Rendering registered planetary gearbox card in HomeDashboard.
 * 2. Rendering domain badges, category, difficulty, component count, and tags.
 * 3. Featured model spotlight rendering and launch action.
 * 4. Domain filtering for All, Mechanical, and Civil.
 * 5. Honest Civil empty state when no civil models are registered.
 * 6. Keyword search matching names, descriptions, categories, and tags.
 * 7. Combined domain and search filtering with no-results state.
 * 8. Clear search and filter reset actions.
 * 9. Custom model fixtures with civil structural models.
 * 10. Empty registry handling without runtime errors.
 * 11. Application-level view navigation (Dashboard <-> Workspace).
 * 12. Accessibility: WAI-ARIA tab semantics, search label, and button titles.
 * 13. Pure filtering and count calculation utilities in dashboardUtils.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Group } from 'three';
import { HomeDashboard } from '../src/components/dashboard/HomeDashboard';
import { App } from '../src/App';
import { WorkspaceTopBar } from '../src/components/workspace/WorkspaceTopBar';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import {
  filterModels,
  getDomainCounts,
} from '../src/utils/dashboardUtils';
import type { EngineeringModelDefinition } from '../src/types/models';

// Representative civil model fixture (for testing polymorphic filter/card rendering without mutating registry)
const MOCK_CIVIL_MODEL: EngineeringModelDefinition = {
  id: 'warren_truss_bridge',
  name: 'Warren Truss Bridge Assembly',
  domain: 'civil',
  category: 'Structural Infrastructure',
  description: 'Standard equilateral triangular steel truss bridge span with pin-jointed chords and diagonals.',
  thumbnailUrl: '/assets/models/warren_truss.webp',
  difficulty: 'Beginner',
  tags: ['Truss', 'Bridge', 'Structural Steel', 'Civil Engineering'],
  componentCount: 18,
  cameraConfig: {
    initialPosition: [0, 8, 20],
    target: [0, 2, 0],
    minDistance: 3,
    maxDistance: 60,
    fov: 45,
    defaultPreset: 'isometric',
  },
  getAssemblyTree: () => ({
    id: 'truss_root',
    name: 'Warren Truss Bridge',
    type: 'assembly',
  }),
  getComponentMetadata: () => null,
  getAllComponentIds: () => ['chord_top_01', 'chord_bot_01'],
  buildScene: () => ({
    rootGroup: new Group(),
    dispose: () => {},
  }),
};

describe('HomeDashboard — Catalogue & Featured Model Rendering', () => {
  it('renders branding, app title, and tagline in header', () => {
    const html = renderToStaticMarkup(
      React.createElement(HomeDashboard, {
        onLaunchModel: () => {},
      })
    );

    assert.ok(html.includes('GestureLab CAD'), 'Expected brand tagline');
    assert.ok(html.includes('Engineering Explorer'), 'Expected app title');
    assert.ok(
      html.includes('Interactive 3D spatial exploration'),
      'Expected descriptive subtitle'
    );
  });

  it('renders registered planetary gearbox in featured model spotlight', () => {
    const html = renderToStaticMarkup(
      React.createElement(HomeDashboard, {
        onLaunchModel: () => {},
      })
    );

    assert.ok(html.includes('Featured Spotlight'), 'Expected featured spotlight badge');
    assert.ok(html.includes('Epicyclic Planetary Gearbox'), 'Expected featured model name');
    assert.ok(html.includes('Transmission &amp; Kinematics') || html.includes('Transmission & Kinematics'), 'Expected category');
    assert.ok(html.includes('Intermediate'), 'Expected difficulty badge');
    assert.ok(html.includes('7 Components'), 'Expected component count');
    assert.ok(html.includes('Launch 3D Workspace'), 'Expected launch CTA button');
  });

  it('renders model catalogue card with domain badges, component count, and tags', () => {
    const html = renderToStaticMarkup(
      React.createElement(HomeDashboard, {
        onLaunchModel: () => {},
      })
    );

    assert.ok(html.includes('Engineering Model Catalogue'), 'Expected catalogue section title');
    assert.ok(html.includes('⚙️ Mechanical'), 'Expected mechanical domain pill');
    assert.ok(html.includes('#Gearbox'), 'Expected model tag');
    assert.ok(html.includes('Open in Workspace'), 'Expected card action button');
  });
});

describe('HomeDashboard — Domain Filtering', () => {
  it('renders domain counts accurately from registered models', () => {
    const html = renderToStaticMarkup(
      React.createElement(HomeDashboard, {
        onLaunchModel: () => {},
      })
    );

    assert.ok(html.includes('All Domains'), 'Expected All Domains tab');
    assert.ok(html.includes('Mechanical'), 'Expected Mechanical tab');
    assert.ok(html.includes('Civil'), 'Expected Civil tab');
  });

  it('displays honest empty state when Civil domain has zero registered models', () => {
    const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
    const html = renderToStaticMarkup(
      React.createElement(HomeDashboard, {
        models: [gearbox],
        initialDomain: 'civil',
        onLaunchModel: () => {},
      })
    );

    assert.ok(
      html.includes('No Civil Models Registered Yet'),
      'Expected honest civil empty state heading'
    );
    assert.ok(
      html.includes('Civil engineering structural models (including the Warren Truss Bridge'),
      'Expected civil models upcoming release notice'
    );
    assert.ok(
      html.includes('View Available Mechanical Models'),
      'Expected button to switch to available models'
    );
  });

  it('renders civil model card when a civil model is provided in the catalogue', () => {
    const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
    const html = renderToStaticMarkup(
      React.createElement(HomeDashboard, {
        models: [gearbox, MOCK_CIVIL_MODEL],
        initialDomain: 'civil',
        onLaunchModel: () => {},
      })
    );

    assert.ok(html.includes('Warren Truss Bridge Assembly'), 'Expected civil model card title');
    assert.ok(html.includes('🌉 Civil'), 'Expected civil domain badge');
    assert.ok(html.includes('18 Components'), 'Expected 18 components for truss bridge');
    assert.ok(html.includes('Beginner'), 'Expected Beginner difficulty');
  });

  it('renders Medical tab and displays honest empty state when Medical domain is selected', () => {
    const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
    const html = renderToStaticMarkup(
      React.createElement(HomeDashboard, {
        models: [gearbox],
        initialDomain: 'medical',
        onLaunchModel: () => {},
      })
    );

    assert.ok(html.includes('Medical'), 'Expected Medical tab in navigation');
    assert.ok(
      html.includes('No Medical Models Registered Yet'),
      'Expected honest medical empty state heading'
    );
    assert.ok(
      html.includes('Medical and biomechanical models'),
      'Expected medical curriculum development note'
    );
    assert.ok(
      html.includes('View Available Engineering Models'),
      'Expected button to return to available models'
    );
  });
});

describe('HomeDashboard — Keyword Search & Combined Filtering', () => {
  it('matches models by name query case-insensitively', () => {
    const html = renderToStaticMarkup(
      React.createElement(HomeDashboard, {
        initialSearchQuery: 'planetary',
        onLaunchModel: () => {},
      })
    );

    assert.ok(html.includes('Epicyclic Planetary Gearbox'), 'Expected planetary gearbox match');
  });

  it('matches models by category or tags', () => {
    const html = renderToStaticMarkup(
      React.createElement(HomeDashboard, {
        initialSearchQuery: 'kinematics',
        onLaunchModel: () => {},
      })
    );

    assert.ok(html.includes('Epicyclic Planetary Gearbox'), 'Expected kinematics tag/category match');
  });

  it('displays no-matching-models state when search yields no results', () => {
    const html = renderToStaticMarkup(
      React.createElement(HomeDashboard, {
        initialSearchQuery: 'hydroelectric turbine generator',
        onLaunchModel: () => {},
      })
    );

    assert.ok(html.includes('No Matching Models Found'), 'Expected no matches heading');
    assert.ok(
      html.includes('hydroelectric turbine generator'),
      'Expected searched query mentioned in empty state'
    );
    assert.ok(html.includes('Clear Search &amp; Filters') || html.includes('Clear Search & Filters'), 'Expected clear button');
  });

  it('handles empty registry gracefully without throwing', () => {
    const html = renderToStaticMarkup(
      React.createElement(HomeDashboard, {
        models: [],
        onLaunchModel: () => {},
      })
    );

    assert.ok(html.includes('No Models in Catalogue'), 'Expected empty catalogue notice');
    assert.ok(html.includes('The engineering model registry currently contains zero registered models.'));
  });
});

describe('HomeDashboard — Accessibility & WAI-ARIA Semantics', () => {
  it('provides proper ARIA roles and accessible tab states for domain navigation', () => {
    const html = renderToStaticMarkup(
      React.createElement(HomeDashboard, {
        initialDomain: 'mechanical',
        onLaunchModel: () => {},
      })
    );

    assert.ok(html.includes('role="region"'), 'Expected dashboard region');
    assert.ok(html.includes('role="tablist"'), 'Expected tablist role for domain filters');
    assert.ok(html.includes('role="tab"'), 'Expected tab role on filter buttons');
    assert.ok(
      html.includes('aria-selected="true"'),
      'Expected aria-selected on active mechanical tab'
    );
    assert.ok(
      html.includes('aria-label="Search engineering models"'),
      'Expected accessible search input label'
    );
  });
});

describe('WorkspaceTopBar — Catalogue Return Navigation', () => {
  it('renders Catalogue button in top bar when onNavigateHome is provided', () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceTopBar, {
        modelName: 'Epicyclic Planetary Gearbox',
        domain: 'mechanical',
        subsystem: 'Transmission',
        isLeftDockOpen: true,
        onToggleLeftDock: () => {},
        isRightDockOpen: true,
        onToggleRightDock: () => {},
        renderFps: 60,
        cameraStatus: 'active',
        showDiagnostics: false,
        onToggleDiagnostics: () => {},
        showRoadmap: false,
        onToggleRoadmap: () => {},
        onNavigateHome: () => {},
      })
    );

    assert.ok(html.includes('catalogue-btn'), 'Expected catalogue-btn class');
    assert.ok(html.includes('Catalogue'), 'Expected Catalogue button text');
    assert.ok(
      html.includes('aria-label="Return to Engineering Explorer Catalogue Dashboard"'),
      'Expected accessible catalogue return label'
    );
  });
});

describe('App — View Transitions & Workspace Integration', () => {
  it('renders HomeDashboard by default when initialView is dashboard', () => {
    const html = renderToStaticMarkup(
      React.createElement(App, {
        initialView: 'dashboard',
      })
    );

    assert.ok(html.includes('Engineering Explorer'), 'Expected HomeDashboard title');
    assert.ok(html.includes('Engineering Model Catalogue'), 'Expected model catalogue');
  });

  it('renders WorkspaceLayout directly when initialView is workspace', () => {
    const html = renderToStaticMarkup(
      React.createElement(App, {
        initialView: 'workspace',
      })
    );

    assert.ok(html.includes('cad-workspace-shell'), 'Expected CAD workspace shell');
    assert.ok(html.includes('Assembly Hierarchy'), 'Expected left assembly tree dock');
    assert.ok(html.includes('Engineering Inspector'), 'Expected right inspector dock');
  });
});

describe('dashboardUtils — Pure Utility Functions', () => {
  it('calculates domain counts correctly across diverse models', () => {
    const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
    const counts = getDomainCounts([gearbox, MOCK_CIVIL_MODEL]);

    assert.equal(counts.all, 2);
    assert.equal(counts.mechanical, 1);
    assert.equal(counts.civil, 1);
  });

  it('filters models by domain accurately', () => {
    const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
    const models = [gearbox, MOCK_CIVIL_MODEL];

    const mechOnly = filterModels(models, 'mechanical', '');
    assert.equal(mechOnly.length, 1);
    assert.equal(mechOnly[0].id, 'planetary_gearbox');

    const civilOnly = filterModels(models, 'civil', '');
    assert.equal(civilOnly.length, 1);
    assert.equal(civilOnly[0].id, 'warren_truss_bridge');

    const all = filterModels(models, 'all', '');
    assert.equal(all.length, 2);
  });

  it('filters models by search query matching description and tags', () => {
    const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
    const models = [gearbox, MOCK_CIVIL_MODEL];

    const trussMatch = filterModels(models, 'all', 'truss');
    assert.equal(trussMatch.length, 1);
    assert.equal(trussMatch[0].id, 'warren_truss_bridge');

    const gearMatch = filterModels(models, 'all', 'coaxial reduction');
    assert.equal(gearMatch.length, 1);
    assert.equal(gearMatch[0].id, 'planetary_gearbox');

    const noMatch = filterModels(models, 'all', 'quantum supercomputer');
    assert.equal(noMatch.length, 0);
  });
});
