/**
 * The demonstration workflow, end to end in the browser code: select a part (mouse or gesture),
 * ask about it, and the explanation drives the 3D scene through the validated dispatcher.
 *
 * Gnani Prisma, Gnani Timbre and the LLM are NOT called: transcripts are given as text, narration
 * uses a fake narrator, and the whole-model answer is the grounded model-data plan (the same plan
 * the app plays when the AI teacher is unavailable). Parser, resolver, dispatcher, validator,
 * player and scene restoration are the real code.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import { getSceneSnapshot } from '../src/services/scene/sceneSnapshot';
import { handleVoiceTurn, lexiconFor, type VoiceTurnResult } from '../src/services/voice/voiceSession';
import { buildComponentBrief } from '../src/services/teaching/componentBrief';
import { validateTeachingPlan, type TeachingPlan } from '../src/services/teaching/teachingPlan';
import { TeachingPlanPlayer, type NarrationClip, type Narrator } from '../src/services/teaching/planPlayer';
import { shownComponentIds, suggestedQuestions } from '../src/services/teaching/tutorSuggestions';
import { TeachingPanel } from '../src/components/voice/TeachingPanel';
import type { TeachingSession } from '../src/services/teaching/teachingSession';
import { makeWorkspace } from './sceneContext.test';

const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
const ALL = modelRegistry.getCatalogueModels();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type WS = ReturnType<typeof makeWorkspace>;

function ask(w: WS, transcript: string, language = 'en-IN'): VoiceTurnResult {
  return handleVoiceTurn({
    transcript, language, dispatcher: w.dispatcher, model: w.ws.model, allModels: ALL,
    lastDiscussed: w.memory.last, teachingAvailable: true,
  });
}
const selected = (id: string) => {
  const w = makeWorkspace(gearbox);
  w.dispatcher.dispatch({ type: 'component.select', componentId: id }, 'ui');
  return w;
};
const nameOf = (id: string) => gearbox.getComponentMetadata(id)?.name ?? id;
const relatedOf = (id: string) => [...new Set((gearbox.getComponentMetadata(id)?.relationships ?? []).map((r) => r.targetComponentId))];

function fakeNarrator() {
  const spoken: string[] = [];
  const narrator: Narrator = {
    prepare(text: string): NarrationClip {
      let resolve!: (v: 'ended' | 'failed' | 'stopped') => void;
      const done = new Promise<'ended' | 'failed' | 'stopped'>((r) => (resolve = r));
      let timer: ReturnType<typeof setTimeout> | null = null;
      return {
        done,
        play() { spoken.push(text); timer = setTimeout(() => resolve('ended'), 5); timer.unref?.(); },
        pause() {}, resume() {},
        stop() { if (timer) clearTimeout(timer); resolve('stopped'); },
      };
    },
  };
  return { narrator, spoken };
}

describe('Demo flow: questions about the selected part', () => {
  it('"What is this connected to?" highlights and names the recorded neighbours (not just the part name)', () => {
    const w = selected('planet_gear_1');
    const r = ask(w, 'What is this connected to?');
    assert.equal(r.status, 'executed');
    assert.equal(r.outcome.kind, 'commands');
    assert.equal((r.outcome as { intent: string }).intent, 'related');
    const related = relatedOf('planet_gear_1');
    assert.ok(related.length > 0);
    // Spoken replies use each part's speech-friendly display name from the model's lexicon
    const spoken = (id: string) => lexiconFor(gearbox).find((e) => e.componentId === id)?.displayName ?? nameOf(id);
    for (const id of related) assert.ok(r.caption.includes(spoken(id)), `caption names ${spoken(id)}`);
    const snap = getSceneSnapshot(w.dispatcher, gearbox);
    assert.deepEqual(
      [...(snap.highlightedComponentIds.status === 'known' ? snap.highlightedComponentIds.value : [])].sort(),
      [...related].sort(),
      'exactly the recorded relationships are highlighted'
    );
  });

  it('"What is the sun gear?" is still an identify answer (the related branch needs a connection word)', () => {
    const r = ask(makeWorkspace(gearbox), 'What is the sun gear?');
    assert.equal(r.status, 'answered');
  });

  it('"What happens if I remove this gear?" asks the teacher a failure question about the selected gear', () => {
    const r = ask(selected('planet_gear_1'), 'What happens if I remove this gear?');
    assert.equal(r.status, 'teach');
    assert.deepEqual(
      { type: r.teach!.questionType, target: r.teach!.targetComponentId },
      { type: 'failure', target: 'planet_gear_1' }
    );
  });

  it('pointing at a part (gesture cursor) is enough for "this": voice and gesture work together', () => {
    const w = makeWorkspace(gearbox);
    w.pointer.componentId = 'sun_gear';
    w.pointer.source = 'gesture';
    const r = ask(w, 'What happens if I remove this gear?');
    assert.equal(r.teach?.targetComponentId, 'sun_gear');
  });

  it('every suggested question is understood by the deterministic parser (no AI interpretation call)', () => {
    const w = selected('sun_gear');
    const [explain, remove, connected] = suggestedQuestions(nameOf('sun_gear'));
    assert.deepEqual([ask(w, explain).teach?.questionType, ask(w, explain).teach?.targetComponentId], ['explain', 'sun_gear']);
    assert.deepEqual([ask(w, remove).teach?.questionType, ask(w, remove).teach?.targetComponentId], ['failure', 'sun_gear']);
    assert.equal(ask(w, connected).status, 'executed');

    const [howWorks, separate, back] = suggestedQuestions(null);
    const whole = ask(makeWorkspace(gearbox), howWorks);
    assert.equal(whole.status, 'teach');
    assert.equal(whole.teach?.targetComponentId, null, 'a whole-model question');
    const w2 = makeWorkspace(gearbox);
    assert.equal(ask(w2, separate).status, 'executed');
    assert.ok(w2.ws.exploded > 0, 'the parts were separated');
    assert.equal(ask(makeWorkspace(gearbox), back).status, 'executed');
  });

  it('suggestions use only the given part name, and no part means whole-model suggestions', () => {
    assert.ok(suggestedQuestions('Sun Gear').every((q) => q.includes('Sun Gear')));
    assert.ok(suggestedQuestions(null).some((q) => /how does this model work/i.test(q)));
  });
});

describe('Demo flow: "How does this gearbox work?" drives the 3D view (model-data plan)', () => {
  const plan = () => {
    const w = makeWorkspace(gearbox);
    const raw = buildComponentBrief(gearbox, w.snapshot(false), null, 'howWorks');
    const v = validateTeachingPlan(raw, w.snapshot(false), w.dispatcher.getContext());
    assert.ok(v.ok, v.ok ? '' : v.reason);
    return { w, plan: (v as { plan: TeachingPlan }).plan };
  };

  it('each recorded drive link is its own step, highlighting exactly its two real parts', () => {
    const { plan: p } = plan();
    const ids = new Set(gearbox.getAllComponentIds());
    const linkSteps = p.steps.filter((s) => s.actions.some((a) => a.type === 'component.highlight'));
    assert.ok(linkSteps.length >= 2, 'several drive links are shown');
    for (const s of linkSteps) {
      const shown = shownComponentIds(s.actions);
      assert.equal(shown.length, 2);
      assert.ok(shown.every((id) => ids.has(id)), 'only real component ids');
      // the caption names both parts
      assert.ok(shown.every((id) => s.caption.includes(nameOf(id))), s.caption);
      // and the link is a recorded relationship (no invented mechanics)
      const [from, to] = shown;
      assert.ok((gearbox.getComponentMetadata(from)?.relationships ?? []).some((r) => r.targetComponentId === to));
    }
    assert.ok(p.steps.some((s) => s.actions.some((a) => a.type === 'assembly.explode')), 'a separated-view step');
    assert.ok(p.steps.length <= 8);
  });

  it('plays through the real player: highlights and explode run via the dispatcher, then the assembly is put back', async () => {
    const { w, plan: p } = plan();
    const loop = setInterval(() => w.tick(16), 4);
    loop.unref?.();
    const n = fakeNarrator();
    const player = new TeachingPlanPlayer({ dispatcher: w.dispatcher, getSnapshot: () => getSceneSnapshot(w.dispatcher, gearbox), narrator: n.narrator, pollMs: 4, settleTimeoutMs: 300 });
    const detach = player.attach();
    try {
      let maxExploded = 0;
      const unsub = w.dispatcher.subscribe(() => { maxExploded = Math.max(maxExploded, w.ws.exploded); });
      assert.ok(player.start(p));
      const t0 = Date.now();
      while (player.getState().status !== 'finished' && Date.now() - t0 < 8000) await sleep(10);
      unsub();
      assert.equal(player.getState().status, 'finished');
      const ai = w.dispatcher.getHistory().filter((h) => h.source === 'ai' && h.status === 'executed').map((h) => h.command?.type);
      assert.ok(ai.includes('component.highlight') && ai.includes('assembly.explode'), ai.join(','));
      assert.ok(maxExploded > 0, 'the model was separated during the explanation');
      assert.equal(w.ws.exploded, 0, 'the complete assembly is back at the end');
      const snap = getSceneSnapshot(w.dispatcher, gearbox);
      assert.deepEqual(snap.highlightedComponentIds.status === 'known' ? [...snap.highlightedComponentIds.value] : null, [], 'highlights cleared');
      assert.equal(n.spoken.length, p.steps.length, 'every step was narrated');
    } finally {
      player.cancel();
      detach();
      clearInterval(loop);
    }
  });

  it('its follow-ups are real questions the parser answers (one click = a new grounded request)', () => {
    for (const lang of ['en-IN', 'te-IN']) {
      const w = makeWorkspace(gearbox);
      const raw = buildComponentBrief(gearbox, w.snapshot(false), null, 'howWorks', lang) as { followUpSuggestions: string[] };
      assert.ok(raw.followUpSuggestions.length > 0, lang);
      for (const f of raw.followUpSuggestions) {
        const r = ask(makeWorkspace(gearbox), f, lang);
        assert.ok(['teach', 'executed', 'answered'].includes(r.status), `${lang}: "${f}" -> ${r.status}`);
      }
    }
  });

  it('the Telugu model-data answer also highlights the parts it names', () => {
    const w = makeWorkspace(gearbox);
    const raw = buildComponentBrief(gearbox, w.snapshot(false), null, 'howWorks', 'te-IN') as { steps: { actions: { type: string }[] }[] };
    const v = validateTeachingPlan(raw, w.snapshot(false), w.dispatcher.getContext());
    assert.ok(v.ok);
    const hl = raw.steps.flatMap((s) => s.actions).filter((a) => a.type === 'component.highlight');
    assert.ok(hl.length > 0);
    const ids = new Set(gearbox.getAllComponentIds());
    assert.ok(shownComponentIds(hl).every((id) => ids.has(id)));
  });
});

describe('Tutor panel: what is shown in 3D, and one-click follow-ups', () => {
  const session = (status: string, extra: Record<string, unknown> = {}) => {
    const plan = {
      title: 'How the sun gear works', explanation: 'x', cannotAnswer: null, rejectedSteps: [],
      followUpSuggestions: ['Why is the Sun Gear needed?'],
      steps: [{ caption: 'Sun Gear drives Planet Gear A', narration: 'n', claim: 'metadata',
        actions: [{ type: 'component.highlight', componentIds: ['sun_gear', 'planet_gear_1', 'not_a_part'] }, { type: 'assembly.explode', factor: 0.75 }] }],
    };
    return {
      state: { status, plan, stepPosition: 0, stepCount: 1, phase: 'narrating', caption: plan.steps[0].caption, narration: 'n', message: null, runtimeRejected: [] },
      pending: false, error: null, notice: null, question: 'How does it work?', plan,
      player: { isActive: () => status === 'running' },
      ...extra,
    } as unknown as TeachingSession;
  };
  const resolve = (id: string) => gearbox.getComponentMetadata(id)?.name;

  it('names the parts the current step shows (only parts of the loaded model) and the separated view', () => {
    const html = renderToStaticMarkup(React.createElement(TeachingPanel, { session: session('running'), nameOf: resolve }));
    assert.ok(html.includes('Shown in the 3D model'));
    assert.ok(html.includes(`>${nameOf('sun_gear')}<`) && html.includes(`>${nameOf('planet_gear_1')}<`));
    assert.ok(!html.includes('not_a_part'), 'unknown ids are never displayed');
    assert.ok(html.includes('Parts separated'));
  });

  it('follow-up suggestions are buttons that ask through the same path, disabled while busy', () => {
    const asked: string[] = [];
    const html = renderToStaticMarkup(React.createElement(TeachingPanel, { session: session('finished'), nameOf: resolve, onAsk: (t: string) => asked.push(t) }));
    assert.ok(html.includes('class="teach-followup-btn"') && html.includes('Why is the Sun Gear needed?'));
    const busy = renderToStaticMarkup(React.createElement(TeachingPanel, { session: session('finished'), onAsk: () => {}, askDisabled: true }));
    assert.ok(/teach-followup-btn"[^>]*disabled/.test(busy));
    const plain = renderToStaticMarkup(React.createElement(TeachingPanel, { session: session('finished') }));
    assert.ok(!plain.includes('teach-followup-btn'), 'without onAsk they stay plain text');
  });
});
