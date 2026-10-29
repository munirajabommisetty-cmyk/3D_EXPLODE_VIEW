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

const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(React.createElement(HomeDashboard, { onLaunchModel: () => {}, ...props }));

describe('Model catalogue — cards', () => {
  it('lists every catalogue model with its correct domain, level, description and an open action', () => {
    const html = render();
    assert.ok(html.includes('Model catalogue'), 'page title');
    for (const m of modelRegistry.getCatalogueModels()) {
      assert.ok(html.includes(m.name), m.name);
      assert.ok(html.includes(`aria-label="Open ${m.name}"`), `${m.name}: preview opens the model`);
    }
    assert.ok(html.includes('data-domain="medical">Anatomy</span>'), 'the eye is labelled Anatomy (not Civil)');
    assert.ok(html.includes('data-domain="mechanical">Mechanical</span>'));
    assert.ok(html.includes('data-domain="civil">Civil</span>'));
    assert.ok((html.match(/Open in 3D/g) ?? []).length === modelRegistry.getCatalogueModels().length);
  });

  it('"what you can explore" comes from each model, never another model’s text', () => {
    const html = render();
    assert.ok(!html.includes('bridge truss physics'), 'no copied bridge text on other cards');
    const eye = modelRegistry.getCatalogueModels().find((m) => m.domain === 'medical')!;
    assert.ok(html.includes(`${eye.componentCount} parts to inspect`));
    assert.ok(!html.includes('🧠'), 'no leftover brain placeholder');
  });

  it('renders a civil model card from a supplied list', () => {
    const html = render({ models: [MOCK_CIVIL_MODEL] });
    assert.ok(html.includes('Warren Truss Bridge Assembly'));
    assert.ok(html.includes('18 parts to inspect'));
    assert.ok(html.includes('Beginner'));
  });
});

describe('Model catalogue — filtering, search and empty states', () => {
  it('domain tabs show live counts, with Anatomy for medical models', () => {
    const html = render();
    const counts = getDomainCounts(modelRegistry.getCatalogueModels());
    for (const [label, n] of [['All models', counts.all], ['Mechanical', counts.mechanical], ['Civil', counts.civil], ['Anatomy', counts.medical]] as const) {
      assert.match(html, new RegExp(`${label}<span class="catalogue-count">${n}</span>`), label);
    }
  });

  it('an empty domain says so plainly and offers a way back', () => {
    const html = render({ models: [modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!], initialDomain: 'civil' });
    assert.ok(html.includes('No matching models'));
    assert.ok(html.includes('There are no Civil models yet.'));
    assert.ok(html.includes('Show all models'));
  });

  it('search matches names, categories and tags case-insensitively', () => {
    assert.ok(render({ initialSearchQuery: 'PLANETARY' }).includes('Epicyclic Planetary Gearbox'));
    assert.ok(render({ initialSearchQuery: 'kinematics' }).includes('Epicyclic Planetary Gearbox'));
    const none = render({ initialSearchQuery: 'quantum flux capacitor' });
    assert.ok(none.includes('No matching models') && none.includes('Nothing matches “quantum flux capacitor”.'));
  });

  it('an empty registry is handled without throwing', () => {
    const html = render({ models: [] });
    assert.ok(html.includes('No models in the catalogue'));
  });

  it('uses proper roles: region, search, tablist with selected state', () => {
    const html = render();
    assert.ok(html.includes('role="region"') && html.includes('role="search"') && html.includes('role="tablist"'));
    assert.ok(html.includes('role="tab" aria-selected="true"'));
    assert.ok(html.includes('<label for=') && html.includes('Search models'));
  });
});

describe('Explorer top bar — back to the catalogue', () => {
  it('has a clear "All models" action when a home handler is given', () => {
    const html = renderToStaticMarkup(React.createElement(WorkspaceTopBar, {
      modelName: 'Epicyclic Planetary Gearbox', isLeftDockOpen: false, onToggleLeftDock: () => {}, isRightDockOpen: false,
      onToggleRightDock: () => {}, renderFps: 60, cameraStatus: 'off', showDiagnostics: false, onToggleDiagnostics: () => {},
      showRoadmap: false, onToggleRoadmap: () => {}, onNavigateHome: () => {},
    }));
    assert.ok(html.includes('All models') && html.includes('aria-label="Back to all models"'));
  });
});

describe('App — fixed views (tests and embedded demos)', () => {
  it('renders the catalogue when initialView is dashboard', () => {
    const html = renderToStaticMarkup(React.createElement(App, { initialView: 'dashboard' }));
    assert.ok(html.includes('Model catalogue'));
  });

  it('renders the explorer directly when initialView is workspace', () => {
    const html = renderToStaticMarkup(React.createElement(App, { initialView: 'workspace' }));
    assert.ok(html.includes('cad-workspace-shell'), 'Expected CAD workspace shell');
    assert.ok(html.includes('Assembly Hierarchy'), 'parts tree still available (keyboard [ )');
    assert.ok(html.includes('Engineering Inspector'), 'part information dock');
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
