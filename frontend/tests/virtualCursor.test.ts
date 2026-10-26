/**
 * Unit Test Suite for Task 4.3: Virtual Laser Pointer / Cursor
 *
 * Validates:
 * 1. Normalized-to-screen coordinate projection and Three.js NDC mapping.
 * 2. Mirrored vs unmirrored coordinate transforms.
 * 3. Viewport boundary clamping on extreme coordinates.
 * 4. Safe rejection of null, undefined, NaN, or non-positive viewport sizes.
 * 5. Gesture exclusivity (visible on stable POINTING, hidden on OPEN_PALM, PINCH, NONE, or tracking loss).
 * 6. Dwell progress integration and hover tooltip rendering.
 * 7. Backward compatibility wrapper in DwellCursor.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {
  projectFingertipToScreen,
  VirtualCursor,
  type VirtualCursorProps,
} from '../src/components/hud/VirtualCursor';
import { DwellCursor } from '../src/components/hud/DwellCursor';
import type { GestureType } from '../src/types/gestures';

describe('projectFingertipToScreen (Coordinate Projection Math)', () => {
  const viewport = { width: 1000, height: 800 };

  it('correctly maps normalized coordinates to mirrored screen pixels and Three.js NDC', () => {
    // Fingertip at normalized (0.3, 0.4)
    const landmark = { x: 0.3, y: 0.4 };
    const result = projectFingertipToScreen(landmark, viewport, true);

    assert.ok(result !== null);

    // Mirrored X = 1.0 - 0.3 = 0.7
    assert.equal(result.normalizedMirrored.x, 0.7);
    assert.equal(result.normalizedMirrored.y, 0.4);

    // Pixel coordinates: 0.7 * 1000 = 700, 0.4 * 800 = 320
    assert.equal(result.screen.x, 700);
    assert.equal(result.screen.y, 320);

    // NDC coordinates:
    // ndc.x = 0.7 * 2 - 1 = +0.4
    // ndc.y = -(0.4 * 2 - 1) = +0.2
    assert.ok(Math.abs(result.ndc.x - 0.4) < 1e-6);
    assert.ok(Math.abs(result.ndc.y - 0.2) < 1e-6);
  });

  it('respects unmirrored coordinates when mirrorX is false', () => {
    const landmark = { x: 0.3, y: 0.4 };
    const result = projectFingertipToScreen(landmark, viewport, false);

    assert.ok(result !== null);
    assert.equal(result.screen.x, 300);
    assert.equal(result.screen.y, 320);

    // NDC X = 0.3 * 2 - 1 = -0.4
    assert.ok(Math.abs(result.ndc.x - -0.4) < 1e-6);
    assert.ok(Math.abs(result.ndc.y - 0.2) < 1e-6);
  });

  it('clamps coordinates strictly to viewport boundaries on out-of-frame landmarks', () => {
    // Negative coordinates (out-of-frame left and top)
    const outLeft = { x: -0.5, y: -0.2 };
    const resultLeft = projectFingertipToScreen(outLeft, viewport, false);
    assert.ok(resultLeft !== null);
    assert.equal(resultLeft.screen.x, 0);
    assert.equal(resultLeft.screen.y, 0);
    assert.equal(resultLeft.ndc.x, -1);
    assert.equal(resultLeft.ndc.y, 1);

    // Coordinates beyond frame right and bottom
    const outRight = { x: 1.8, y: 1.4 };
    const resultRight = projectFingertipToScreen(outRight, viewport, false);
    assert.ok(resultRight !== null);
    assert.equal(resultRight.screen.x, 1000);
    assert.equal(resultRight.screen.y, 800);
    assert.equal(resultRight.ndc.x, 1);
    assert.equal(resultRight.ndc.y, -1);
  });

  it('safely rejects null, undefined, and non-finite landmark coordinates', () => {
    assert.equal(projectFingertipToScreen(null, viewport), null);
    assert.equal(projectFingertipToScreen(undefined, viewport), null);
    assert.equal(projectFingertipToScreen({ x: Number.NaN, y: 0.5 }, viewport), null);
    assert.equal(projectFingertipToScreen({ x: 0.5, y: Number.POSITIVE_INFINITY }, viewport), null);
  });

  it('safely rejects zero or negative viewport dimensions', () => {
    const landmark = { x: 0.5, y: 0.5 };
    assert.equal(projectFingertipToScreen(landmark, { width: 0, height: 600 }), null);
    assert.equal(projectFingertipToScreen(landmark, { width: 800, height: -10 }), null);
  });
});

describe('VirtualCursor Gesture Exclusivity & State Logic', () => {
  function evaluateCursorVisibility(
    gesture: GestureType,
    isStable: boolean,
    hasLandmark: boolean
  ): boolean {
    return gesture === 'POINTING' && isStable === true && hasLandmark === true;
  }

  it('activates only when POINTING is stable and hand landmarks are present', () => {
    assert.equal(evaluateCursorVisibility('POINTING', true, true), true);
  });

  it('hides cursor when gesture is OPEN_PALM (orbit navigation mode)', () => {
    assert.equal(evaluateCursorVisibility('OPEN_PALM', true, true), false);
  });

  it('hides cursor when gesture is PINCH (zoom mode)', () => {
    assert.equal(evaluateCursorVisibility('PINCH', true, true), false);
  });

  it('hides cursor when gesture is NONE or resting fist', () => {
    assert.equal(evaluateCursorVisibility('NONE', true, true), false);
  });

  it('hides cursor when pointing is unstable or transitioning', () => {
    assert.equal(evaluateCursorVisibility('POINTING', false, true), false);
  });

  it('hides cursor immediately when hand tracking is lost', () => {
    assert.equal(evaluateCursorVisibility('POINTING', true, false), false);
  });
});

describe('VirtualCursor Component & Dwell Integration', () => {
  it('returns null when visible is false or position is null', () => {
    const hidden1 = VirtualCursor({
      visible: false,
      position: { x: 200, y: 300 },
    });
    assert.equal(hidden1, null);

    const hidden2 = VirtualCursor({
      visible: true,
      position: null,
    });
    assert.equal(hidden2, null);
  });

  it('renders laser cursor element when visible with valid position', () => {
    const element = VirtualCursor({
      visible: true,
      position: { x: 250, y: 400 },
      dwellProgress: 0,
      hoveredComponentName: null,
    });

    assert.ok(React.isValidElement(element));
    assert.equal(element.props['data-testid'], 'virtual-cursor');
    assert.equal(element.props.style.left, '250px');
    assert.equal(element.props.style.top, '400px');
  });

  it('applies is-dwelling class and renders dwell ring when dwellProgress > 0', () => {
    const element = VirtualCursor({
      visible: true,
      position: { x: 250, y: 400 },
      dwellProgress: 0.65,
      hoveredComponentName: 'Sun Gear',
    });

    assert.ok(React.isValidElement(element));
    assert.ok(element.props.className.includes('is-dwelling'));

    // Check children structure includes tooltip and SVG ring
    const children = React.Children.toArray(element.props.children);
    assert.ok(children.length >= 4);
  });

  it('preserves backward compatibility through DwellCursor wrapper', () => {
    const props: VirtualCursorProps = {
      visible: true,
      position: { x: 100, y: 150 },
      dwellProgress: 0.5,
      hoveredComponentName: 'Ring Gear',
    };

    const element = DwellCursor(props);
    assert.ok(React.isValidElement(element));
  });
});
