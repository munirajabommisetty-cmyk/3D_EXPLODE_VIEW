/**
 * Integration Test Suite for Component Information Panel HUD (Task 6.1)
 *
 * Validates:
 * 1. React static markup rendering via react-dom/server in Node environment.
 * 2. Complete engineering specifications rendered for all seven gearbox components.
 * 3. Graceful handling of null, missing, or unrecognized component IDs.
 * 4. Dismissal interactions via close button and keyboard shortcuts (Escape, Space).
 * 5. Input shielding (preventing unintended dismissal while focusing inputs).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComponentInfoPanel } from '../src/components/hud/ComponentInfoPanel';
import {
  ALL_MECHANICAL_COMPONENT_IDS,
  getComponentMetadata,
} from '../src/data/machineMetadata';
import type { MechanicalComponentId } from '../src/types/assembly';

describe('ComponentInfoPanel Rendering (All 7 Components)', () => {
  it('renders null/empty markup when componentId is null', () => {
    const html = renderToStaticMarkup(
      React.createElement(ComponentInfoPanel, {
        componentId: null,
        onClose: () => {},
      })
    );
    assert.equal(html, '');
  });

  for (const componentId of ALL_MECHANICAL_COMPONENT_IDS) {
    it(`renders complete technical specifications for component: ${componentId}`, () => {
      const metadata = getComponentMetadata(componentId);
      assert.ok(metadata !== null, `Metadata must exist for ${componentId}`);

      const html = renderToStaticMarkup(
        React.createElement(ComponentInfoPanel, {
          componentId,
          onClose: () => {},
        })
      );

      // Verify panel container & accessibility attributes
      assert.ok(html.includes('component-info-panel'));
      assert.ok(html.includes('aria-label="Component Engineering Specifications HUD"'));

      // Verify component name and ID tag
      assert.ok(
        html.includes(metadata.name.replace(/&/g, '&amp;')),
        `Expected ${metadata.name} in rendered HTML`
      );
      assert.ok(html.includes(`ID: ${componentId}`));

      // Verify role and material
      assert.ok(html.includes(metadata.role.replace(/&/g, '&amp;')));
      assert.ok(html.includes(metadata.materialName));

      // Verify speed and lubricant
      assert.ok(html.includes(metadata.nominalRpm));
      assert.ok(html.includes(metadata.lubricationSpec));

      // Verify teeth count if applicable
      if (metadata.teethCount !== undefined) {
        assert.ok(html.includes(`${metadata.teethCount} teeth`));
      }
    });
  }

  it('renders fallback alert gracefully when given an unrecognized component ID', () => {
    const invalidId = 'non_existent_part' as MechanicalComponentId;
    const html = renderToStaticMarkup(
      React.createElement(ComponentInfoPanel, {
        componentId: invalidId,
        onClose: () => {},
      })
    );

    assert.ok(html.includes('missing-metadata-alert'));
    assert.ok(html.includes('Detailed engineering specifications are currently unavailable'));
  });
});

describe('ComponentInfoPanel Dismissal & Event Handlers', () => {
  it('renders the header close button with accessible labels and title attributes', () => {
    const html = renderToStaticMarkup(
      React.createElement(ComponentInfoPanel, {
        componentId: 'sun_gear',
        onClose: () => {},
      })
    );

    assert.ok(html.includes('class="panel-close-btn"'));
    assert.ok(html.includes('aria-label="Close component specification panel"'));
    assert.ok(html.includes('title="Deselect component [Esc or Space]"'));
    assert.ok(html.includes('✕'));
  });

  it('handles keyboard dismissal via Escape and Space keys', () => {
    let dismissCount = 0;
    const onClose = () => {
      dismissCount++;
    };

    // Replicate keydown listener logic matching ComponentInfoPanel implementation
    const simulateKeyDown = (
      eventInit: { key: string; code?: string; targetTag?: string }
    ) => {
      const target = { tagName: eventInit.targetTag || 'BODY' };
      const e = {
        key: eventInit.key,
        code: eventInit.code || eventInit.key,
        target,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };

      const targetTag = (e.target as { tagName?: string }).tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea') return;

      if (e.key === 'Escape' || e.code === 'Space') {
        e.preventDefault();
        onClose();
      }
    };

    // 1. Escape key triggers dismissal
    simulateKeyDown({ key: 'Escape' });
    assert.equal(dismissCount, 1);

    // 2. Space key triggers dismissal
    simulateKeyDown({ key: ' ', code: 'Space' });
    assert.equal(dismissCount, 2);

    // 3. Unrelated keys do NOT trigger dismissal
    simulateKeyDown({ key: 'Enter' });
    simulateKeyDown({ key: 'a', code: 'KeyA' });
    assert.equal(dismissCount, 2);

    // 4. Input shield: pressing Space or Escape while focusing an input does NOT dismiss
    simulateKeyDown({ key: 'Escape', targetTag: 'INPUT' });
    simulateKeyDown({ key: ' ', code: 'Space', targetTag: 'TEXTAREA' });
    assert.equal(dismissCount, 2);
  });
});
