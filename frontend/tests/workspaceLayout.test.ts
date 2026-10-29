/**
 * Unit & Integration Test Suite for CAD Workspace Shell & Responsive Layout
 * Phase 9 - Task 9.4
 *
 * Validates:
 * 1. WorkspaceTopBar rendering, breadcrumbs, toggle buttons, and live telemetry.
 * 2. WorkspaceLayout structural shell (top bar, left dock, center viewport, right dock, bottom status bar).
 * 3. Left dock assembly hierarchy placeholder and active model summary.
 * 4. Right dock engineering inspector placeholder and docked component specifications.
 * 5. Accessibility attributes (ARIA landmarks, labels, expanded states, keyboard shortcuts).
 * 6. Responsive dock state classes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceTopBar } from '../src/components/workspace/WorkspaceTopBar';
import { WorkspaceLayout } from '../src/components/workspace/WorkspaceLayout';
import type { UseCameraReturn } from '../src/hooks/useCamera';
import type { GestureRecognitionResult } from '../src/types/gestures';

// Mock camera return for test rendering
function createMockCamera(status: UseCameraReturn['status'] = 'active'): UseCameraReturn {
  return {
    stream: null,
    status,
    errorMessage: null,
    startCamera: async () => {},
    stopCamera: () => {},
    videoRef: { current: null },
  };
}

describe('WorkspaceTopBar Component', () => {
  const bar = (extra: Record<string, unknown> = {}) => renderToStaticMarkup(
    React.createElement(WorkspaceTopBar, {
      modelName: 'Planetary Gearbox Assembly', domain: 'mechanical', subsystem: 'Transmission Subsystem',
      isLeftDockOpen: false, onToggleLeftDock: () => {}, isRightDockOpen: false, onToggleRightDock: () => {},
      renderFps: 59, cameraStatus: 'off', showDiagnostics: false, onToggleDiagnostics: () => {},
      showRoadmap: false, onToggleRoadmap: () => {}, onNavigateHome: () => {}, ...extra,
    })
  );

  it('shows where the learner is: domain and model name', () => {
    const html = bar();
    assert.ok(html.includes('Mechanical'), 'Expected domain tag');
    assert.ok(html.includes('Planetary Gearbox Assembly'), 'Expected model name');
    assert.ok(bar({ domain: 'medical' }).includes('Anatomy'), 'Anatomy models are labelled as such');
  });

  it('offers only learner actions: back to all models and part information', () => {
    const html = bar();
    assert.ok(html.includes('All models') && html.includes('aria-label="Back to all models"'));
    assert.ok(html.includes('aria-label="Show part information"') && html.includes('aria-pressed="false"'));
    assert.ok(bar({ isRightDockOpen: true }).includes('aria-label="Hide part information"'));
    for (const gone of ['Guided Tour', 'Parts</span>', 'More tools', 'roadmap', 'FPS', 'Camera:']) {
      assert.ok(!html.includes(gone), `no "${gone}" in the learner toolbar`);
    }
  });

  it('shows the exploded state only while the model is exploded', () => {
    assert.ok(!bar().includes('Exploded view'));
    assert.ok(bar({ explodedFactor: 0.8 }).includes('Exploded view'));
  });

  it('offers a Reassemble action while exploded (only when a handler is wired)', () => {
    assert.ok(!bar({ explodedFactor: 0.8 }).includes('Reassemble'), 'no dead button without a handler');
    const html = bar({ explodedFactor: 0.8, onReassemble: () => {} });
    assert.ok(html.includes('aria-label="Reassemble the model"') && html.includes('>Reassemble<'));
    assert.ok(!bar({ onReassemble: () => {} }).includes('Reassemble'), 'hidden while assembled');
  });

  it('shows the interaction mode from the real camera state', () => {
    assert.ok(bar().includes('Mouse &amp; voice'));
    assert.ok(bar({ cameraStatus: 'active' }).includes('Camera on'));
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(bar({ explodedFactor: 0.5, onReassemble: () => {} })), 'no emoji icons');
  });

  it('renders active gesture badge in top bar when camera is active and gesture recognized', () => {
    const gesture: GestureRecognitionResult = {
      gesture: 'OPEN_PALM',
      confidence: 0.94,
      isStable: true,
      timestamp: 1000,
    };

    const html = renderToStaticMarkup(
      React.createElement(WorkspaceTopBar, {
        modelName: 'Test Model',
        isLeftDockOpen: true,
        onToggleLeftDock: () => {},
        isRightDockOpen: true,
        onToggleRightDock: () => {},
        renderFps: 60,
        cameraStatus: 'active',
        activeGesture: gesture,
        showDiagnostics: false,
        onToggleDiagnostics: () => {},
        showRoadmap: false,
        onToggleRoadmap: () => {},
      })
    );

    assert.ok(html.includes('Open Palm'), 'Expected Open Palm badge label');
    assert.ok(html.includes('94%'), 'Expected 94% confidence');
  });
});

describe('WorkspaceLayout Structural Shell', () => {
  it('renders full CAD layout shell with top bar, docks, viewport, and status bar', () => {
    const camera = createMockCamera('active');

    const html = renderToStaticMarkup(
      React.createElement(WorkspaceLayout, {
        renderFps: 60,
        camera,
        activeGesture: null,
        onGestureChange: () => {},
        detectedHands: [],
        onHandsDetected: () => {},
        selectedComponentId: null,
        onSelectComponent: () => {},
        showDiagnostics: false,
        onToggleDiagnostics: () => {},
        showRoadmap: false,
        onToggleRoadmap: () => {},
      })
    );

    // Shell container
    assert.ok(html.includes('cad-workspace-shell'), 'Expected cad-workspace-shell container');

    // Left Dock
    assert.ok(html.includes('cad-dock-left'), 'Expected left assembly dock');
    assert.ok(html.includes('Assembly Hierarchy'), 'Expected Assembly Hierarchy dock title');
    assert.ok(html.includes('assembly-tree-panel'), 'Expected AssemblyTreePanel mounted in left dock');

    // Central 3D Viewport
    assert.ok(html.includes('cad-viewport-center'), 'Expected center 3D viewport');
    assert.ok(html.includes('viewport-container'), 'Expected viewport-container in center viewport');

    // Right Dock
    assert.ok(html.includes('cad-dock-right'), 'Expected right inspector dock');
    assert.ok(html.includes('Engineering Inspector'), 'Expected Engineering Inspector dock title');
    assert.ok(!html.includes('Task 9.6'), 'No developer task label in the learner-facing inspector');

    // Bottom Status Bar
    assert.ok(html.includes('workspace-status-bar'), 'Expected workspace status bar');
    assert.ok(!html.includes('Phase 9'), 'No developer phase text in the learner-facing status bar');
  });

  it('renders interactive AssemblyTreePanel nodes in Left Dock', () => {
    const camera = createMockCamera('active');

    const html = renderToStaticMarkup(
      React.createElement(WorkspaceLayout, {
        activeModelId: 'planetary_gearbox',
        renderFps: 60,
        camera,
        activeGesture: null,
        onGestureChange: () => {},
        detectedHands: [],
        onHandsDetected: () => {},
        selectedComponentId: null,
        onSelectComponent: () => {},
        showDiagnostics: false,
        onToggleDiagnostics: () => {},
        showRoadmap: false,
        onToggleRoadmap: () => {},
      })
    );

    assert.ok(html.includes('Planetary Gearbox Assembly'), 'Expected root assembly name');
    assert.ok(html.includes('Epicyclic Planetary Stage'), 'Expected subassembly name');
    assert.ok(html.includes('Sun Gear'), 'Expected component name in tree');
    assert.ok(html.includes('Outer Annulus (Ring Gear)'), 'Expected ring gear name in tree');
  });

  it('docks ComponentInfoPanel in Right Dock when a component is selected', () => {
    const camera = createMockCamera('active');

    const html = renderToStaticMarkup(
      React.createElement(WorkspaceLayout, {
        activeModelId: 'planetary_gearbox',
        renderFps: 60,
        camera,
        activeGesture: null,
        onGestureChange: () => {},
        detectedHands: [],
        onHandsDetected: () => {},
        selectedComponentId: 'sun_gear',
        onSelectComponent: () => {},
        showDiagnostics: false,
        onToggleDiagnostics: () => {},
        showRoadmap: false,
        onToggleRoadmap: () => {},
      })
    );

    // Inspector dock should house the component info panel
    assert.ok(html.includes('dock-inspector-wrapper'), 'Expected dock inspector wrapper');
    assert.ok(html.includes('Sun Gear'), 'Expected Sun Gear name rendered in inspector');
    assert.ok(html.includes('ID: sun_gear'), 'Expected ID: sun_gear rendered');
    assert.ok(html.includes('Central Driving Input'), 'Expected Central Driving Input role rendered');
  });

  it('displays accurate modality indicators based on tracking state', () => {
    // Scenario 1: Camera active and hand detected
    const cameraLive = createMockCamera('active');
    const htmlGesture = renderToStaticMarkup(
      React.createElement(WorkspaceLayout, {
        renderFps: 60,
        camera: cameraLive,
        activeGesture: null,
        onGestureChange: () => {},
        detectedHands: [
          {
            landmarks: [],
            handedness: 'Right',
            score: 0.95,
          },
        ],
        onHandsDetected: () => {},
        selectedComponentId: null,
        onSelectComponent: () => {},
        showDiagnostics: false,
        onToggleDiagnostics: () => {},
        showRoadmap: false,
        onToggleRoadmap: () => {},
      })
    );
    assert.ok(htmlGesture.includes('Gesture Active (1 hand)'), 'Expected Gesture Active modality');

    // Scenario 2: Camera idle (mouse fallback)
    const cameraIdle = createMockCamera('idle');
    const htmlMouse = renderToStaticMarkup(
      React.createElement(WorkspaceLayout, {
        renderFps: 60,
        camera: cameraIdle,
        activeGesture: null,
        onGestureChange: () => {},
        detectedHands: [],
        onHandsDetected: () => {},
        selectedComponentId: null,
        onSelectComponent: () => {},
        showDiagnostics: false,
        onToggleDiagnostics: () => {},
        showRoadmap: false,
        onToggleRoadmap: () => {},
      })
    );
    assert.ok(
      htmlMouse.includes('Camera off: mouse, keyboard and voice'),
      'Expected a plain-language camera-off status'
    );
  });
});
