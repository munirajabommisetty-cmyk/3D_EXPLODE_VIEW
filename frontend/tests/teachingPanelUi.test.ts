/**
 * UI redesign: the tutor panel distinguishes the question from the answer and shows real step
 * progress (one segment per plan step). Rendered with a stubbed session: no network, no player.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeachingPanel } from '../src/components/voice/TeachingPanel';
import type { TeachingSession } from '../src/services/teaching/teachingSession';

const step = (caption: string) => ({ caption, narration: `${caption} narration`, claim: 'visible' });
const plan = {
  title: 'How the sun gear works', explanation: 'The whole explanation.', cannotAnswer: null,
  steps: [step('One'), step('Two'), step('Three'), step('Four')], rejectedSteps: [], followUpSuggestions: ['Why?'],
};

function session(status: string, stepPosition: number, extra: Partial<TeachingSession> = {}): TeachingSession {
  return {
    state: { status, plan, stepPosition, stepCount: 4, phase: 'idle', caption: 'Two', narration: 'Two narration', message: null, runtimeRejected: [] },
    pending: false, error: null, notice: null, question: 'How does the sun gear work?', plan,
    player: { isActive: () => status === 'running' || status === 'paused' || status === 'waitingForUser' },
    ...extra,
  } as unknown as TeachingSession;
}

describe('TeachingPanel (UI redesign)', () => {
  it('labels the learner question separately from the tutor answer', () => {
    const html = renderToStaticMarkup(React.createElement(TeachingPanel, { session: session('running', 1) }));
    assert.ok(html.includes('class="teach-question"') && html.includes('class="bubble-role">Question<'));
    assert.ok(html.includes('How does the sun gear work?'));
  });

  it('shows one progress segment per real plan step: done, current, upcoming', () => {
    const html = renderToStaticMarkup(React.createElement(TeachingPanel, { session: session('running', 1) }));
    const segments = html.match(/<li[^>]*>/g) ?? [];
    assert.equal(segments.length, 4);
    assert.ok(segments[0].includes('is-done') && segments[1].includes('is-current'));
    assert.ok(!segments[2].includes('is-') && !segments[3].includes('is-'));
    assert.ok(html.includes('Step 2 / 4'));
  });

  it('marks every step done when finished, and shows clear controls while running', () => {
    const done = renderToStaticMarkup(React.createElement(TeachingPanel, { session: session('finished', 3) }));
    assert.equal((done.match(/is-done/g) ?? []).length, 4);
    const running = renderToStaticMarkup(React.createElement(TeachingPanel, { session: session('running', 1) }));
    assert.ok(running.includes('>Pause<') && running.includes('Stop explanation'));
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(running), 'no emoji icons');
  });

  it('shows a preparing state with no invented content while the plan is pending', () => {
    const html = renderToStaticMarkup(React.createElement(TeachingPanel, {
      session: session('idle', -1, { pending: true, plan: null, state: { status: 'idle', plan: null, stepPosition: -1, stepCount: 0 } as never }),
    }));
    assert.ok(html.includes('Preparing an explanation'));
    assert.ok(!html.includes('teach-steps'));
  });
});
