/**
 * Task V4 — teaching plans: frontend validation, the plan player (real dispatcher, viewer
 * executor, camera, model geometry), command-vs-question routing, follow-ups and grounding.
 * The LLM is NOT involved here: plans are hand-written in the backend's output format.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import { WARREN_TRUSS_MODEL_ID } from '../src/models/civil/warrenTrussBridgeModel';
import { getSceneSnapshot } from '../src/services/scene/sceneSnapshot';
import { validateStepNow, validateTeachingPlan, type TeachingPlan } from '../src/services/teaching/teachingPlan';
import { TeachingPlanPlayer, type NarrationClip, type Narrator, type PlayerState } from '../src/services/teaching/planPlayer';
import { buildFactPack, modelLimits } from '../src/services/teaching/factPack';
import { requestTeachingPlan, TeachingServiceError } from '../src/services/teaching/teachingClient';
import { handleVoiceTurn } from '../src/services/voice/voiceSession';
import { makeWorkspace } from './sceneContext.test';

const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
const bridge = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID)!;
const ALL = modelRegistry.getAllModels();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------- fixtures --------------------------------- */

const act = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });
const step = (index: number, actions: unknown[], extra: Record<string, unknown> = {}) => ({
  index, kind: 'demonstrate', claim: 'metadata', narration: `Narration ${index}.`, caption: `Caption ${index}`,
  targetComponentId: null, actions, waitFor: 'narration', holdMs: 0, ...extra,
});

/** A plan in the backend's output format (as /api/teach returns it). */
function rawPlan(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    planId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    modelId: 'planetary_gearbox',
    targetComponentId: 'sun_gear',
    title: 'How power flows through the gearbox',
    explanation: 'The shaft turns the sun gear, which drives the planets; the planets turn the carrier.',
    cannotAnswer: null,
    steps: [
      step(0, [act('component.focus', { componentId: 'sun_gear' }), act('component.highlight', { componentIds: ['central_shaft', 'sun_gear'] })]),
      step(1, [act('animation.setSpeed', { speed: 0.5 }), act('animation.play')], { claim: 'visible' }),
      step(2, [act('component.highlight', { componentIds: ['planet_gear_1', 'planet_gear_2', 'planet_gear_3'] })]),
      step(3, [act('animation.pause')], { kind: 'explain', claim: 'engineering' }),
    ],
    rejectedSteps: [],
    followUpSuggestions: ['Why is the ring gear fixed?'],
    ...over,
  };
}

function validated(w: ReturnType<typeof makeWorkspace>, raw: unknown = rawPlan()): TeachingPlan {
  const v = validateTeachingPlan(raw, w.snapshot(false), w.dispatcher.getContext());
  assert.ok(v.ok, JSON.stringify(v));
  return (v as { plan: TeachingPlan }).plan;
}

/** Fake narrator: each clip "speaks" for `ms` of unpaused time; logs when narration starts. */
function fakeNarrator(ms = 30, onPlay?: (text: string) => void) {
  const played: string[] = [];
  const clips: { text: string; paused: boolean; stopped: boolean }[] = [];
  const narrator: Narrator = {
    prepare(text: string): NarrationClip {
      const rec = { text, paused: false, stopped: false };
      clips.push(rec);
      let resolve!: (v: 'ended' | 'failed' | 'stopped') => void;
      const done = new Promise<'ended' | 'failed' | 'stopped'>((r) => (resolve = r));
      let timer: ReturnType<typeof setInterval> | null = null;
      return {
        done,
        play() {
          played.push(text);
          onPlay?.(text);
          let left = ms;
          timer = setInterval(() => {
            if (rec.paused || rec.stopped) return;
            left -= 5;
            if (left <= 0) {
              clearInterval(timer!);
              resolve('ended');
            }
          }, 5);
        },
        pause() { rec.paused = true; },
        resume() { rec.paused = false; },
        stop() { rec.stopped = true; if (timer) clearInterval(timer); resolve('stopped'); },
      };
    },
  };
  return { narrator, played, clips };
}

/** Workspace + player with the render loop simulated (camera transitions advance in real time). */
function setup(model = gearbox, narratorMs = 30) {
  const w = makeWorkspace(model);
  const loop = setInterval(() => w.tick(16), 4);
  loop.unref?.(); // a failing assertion must not leave the simulated render loop keeping Node alive
  const n = fakeNarrator(narratorMs);
  const player = new TeachingPlanPlayer({
    dispatcher: w.dispatcher,
    getSnapshot: () => getSceneSnapshot(w.dispatcher, w.ws.model),
    narrator: n.narrator,
    pollMs: 4,
    settleTimeoutMs: 1500,
  });
  const detach = player.attach();
  const states: PlayerState['status'][] = [];
  player.subscribe((s) => { if (states[states.length - 1] !== s.status) states.push(s.status); });
  const done = async (timeout = 4000) => {
    const t0 = Date.now();
    while (player.isActive() && Date.now() - t0 < timeout) await sleep(5);
  };
  const close = () => { clearInterval(loop); detach(); player.cancel(); };
  return { w, player, n, states, done, close };
}

const aiTypes = (w: ReturnType<typeof makeWorkspace>, from = 0) =>
  w.dispatcher.getHistory().slice(from).filter((r) => r.source === 'ai').map((r) => (r.command as { type: string }).type);

/* ============================ 1. Plan validation (frontend) ============================ */

describe('Teaching plan validation (Task V4, frontend)', () => {
  it('accepts a valid plan and returns clean V1 commands', () => {
    const w = makeWorkspace();
    const plan = validated(w);
    assert.equal(plan.steps.length, 4);
    assert.deepEqual(plan.steps[0].actions, [
      { type: 'component.focus', componentId: 'sun_gear' },
      { type: 'component.highlight', componentIds: ['central_shaft', 'sun_gear'] },
    ]);
  });

  it('rejects a plan for another model (stale model id)', () => {
    const w = makeWorkspace();
    const v = validateTeachingPlan(rawPlan({ modelId: 'warren_truss_bridge' }), w.snapshot(false), w.dispatcher.getContext());
    assert.deepEqual(v.ok ? 'ok' : v.code, 'STALE_MODEL');
  });

  const badStep = (actions: unknown[]) => rawPlan({ steps: [step(0, [act('component.select', { componentId: 'sun_gear' })]), step(1, actions)] });
  const cases: [string, unknown[], string][] = [
    ['unknown command', [act('scene.deleteAll')], 'ACTION_UNSUPPORTED'],
    ['hiding parts is not teachable', [act('component.visibility', { componentIds: ['sun_gear'], visible: false })], 'ACTION_UNSUPPORTED'],
    ['model switching is not teachable', [act('workspace.switchModel', { modelId: 'warren_truss_bridge' })], 'ACTION_UNSUPPORTED'],
    ['invented component', [act('component.focus', { componentId: 'piston' })], 'UNKNOWN_COMPONENT'],
    ['component from the bridge', [act('component.highlight', { componentIds: ['bridge_deck'] })], 'UNKNOWN_COMPONENT'],
    ['bottom view', [act('camera.view', { view: 'bottom' })], 'INVALID_ARGUMENT'],
    ['speed out of range', [act('animation.setSpeed', { speed: 9 })], 'INVALID_ARGUMENT'],
    ['too many actions', [act('camera.reset'), act('camera.reset'), act('camera.reset'), act('camera.reset')], 'PLAN_INVALID'],
  ];
  for (const [name, actions, code] of cases) {
    it(`rejects the step, not the plan: ${name}`, () => {
      const w = makeWorkspace();
      const plan = validated(w, badStep(actions));
      assert.deepEqual(plan.steps.map((s) => s.index), [0]);
      assert.equal(plan.rejectedSteps[0].code, code);
    });
  }

  it('rejects animation on a model that has none (bridge)', () => {
    const w = makeWorkspace(bridge);
    const raw = rawPlan({
      modelId: 'warren_truss_bridge', targetComponentId: null,
      steps: [step(0, [act('component.focus', { componentId: 'bridge_deck' })]), step(1, [act('animation.play')])],
    });
    const plan = validated(w, raw);
    assert.equal(plan.rejectedSteps[0].code, 'ACTION_UNAVAILABLE');
  });

  it('rejects malformed or oversized plans', () => {
    const w = makeWorkspace();
    const check = (raw: unknown) => {
      const v = validateTeachingPlan(raw, w.snapshot(false), w.dispatcher.getContext());
      return v.ok ? 'ok' : v.code;
    };
    assert.equal(check(null), 'PLAN_INVALID');
    assert.equal(check('plan'), 'PLAN_INVALID');
    assert.equal(check(rawPlan({ schemaVersion: 2 })), 'PLAN_INVALID');
    assert.equal(check(rawPlan({ steps: [] })), 'PLAN_INVALID');
    assert.equal(check(rawPlan({ steps: Array.from({ length: 9 }, (_, i) => step(i, [])) })), 'PLAN_TOO_LONG');
    assert.equal(check(rawPlan({ title: '' })), 'PLAN_INVALID');
    assert.equal(check(rawPlan({ title: 'See https://example.com' })), 'PLAN_UNSAFE');
    assert.equal(check(rawPlan({ targetComponentId: 'crankshaft' })), 'UNKNOWN_COMPONENT');
    assert.equal(check(rawPlan({ steps: [step(0, [act('component.focus', { componentId: 'piston' })])] })), 'PLAN_INVALID');
  });

  it('rejects steps with code, markup or links in the narration', () => {
    const w = makeWorkspace();
    for (const narration of ['<script>alert(1)</script>', 'Run eval(x) now', 'Use THREE.Mesh to add it', 'Visit www.example.com']) {
      const plan = validated(w, rawPlan({ steps: [step(0, []), step(1, [], { narration })] }));
      assert.equal(plan.rejectedSteps[0].code, 'PLAN_UNSAFE', narration);
    }
  });

  it('re-validates each step right before it runs', () => {
    const w = makeWorkspace();
    const plan = validated(w);
    assert.equal(validateStepNow(plan.steps[0], plan.modelId, w.dispatcher.getContext()).ok, true);
    w.dispatcher.dispatch({ type: 'workspace.switchModel', modelId: bridge.id }, 'ui');
    const later = validateStepNow(plan.steps[0], plan.modelId, w.dispatcher.getContext());
    assert.deepEqual(later.ok ? 'ok' : later.code, 'STALE_MODEL');
  });
});

/* ================================ 2. Plan player ================================ */

describe('Teaching plan player (Task V4)', () => {
  it('runs steps in order: actions, camera settled, then narration', async () => {
    const t = setup();
    const settledAtNarration: boolean[] = [];
    const n = fakeNarrator(20, () => {
      const cam = t.w.snapshot(false).camera;
      settledAtNarration.push(cam.status === 'known' && cam.value.settled);
    });
    const player = new TeachingPlanPlayer({
      dispatcher: t.w.dispatcher, getSnapshot: () => getSceneSnapshot(t.w.dispatcher, t.w.ws.model), narrator: n.narrator, pollMs: 4,
    });
    const h0 = t.w.dispatcher.getHistory().length;
    try {
      assert.equal(player.start(validated(t.w)), true);
      const t0 = Date.now();
      while (player.isActive() && Date.now() - t0 < 4000) await sleep(5);
      assert.equal(player.getState().status, 'finished');
      assert.deepEqual(n.played, ['Narration 0.', 'Narration 1.', 'Narration 2.', 'Narration 3.']);
      assert.ok(settledAtNarration.every(Boolean), 'narration only starts after the camera settled');
      // Task V5: the plan's target part is selected first, then the steps' actions run in order
      assert.deepEqual(aiTypes(t.w, h0).slice(0, 7), [
        'component.select', 'component.focus', 'component.highlight', 'animation.setSpeed', 'animation.play', 'component.highlight', 'animation.pause',
      ]);
    } finally {
      player.cancel();
      t.close();
    }
  });

  it('restores what the plan changed when it finishes (selection kept, camera untouched)', async () => {
    const t = setup();
    t.w.dispatcher.dispatch({ type: 'component.select', componentId: 'ring_gear' }, 'ui');
    t.player.start(validated(t.w, rawPlan({
      steps: [step(0, [act('component.select', { componentId: 'sun_gear' }), act('component.highlight', { componentIds: ['planet_gear_1'] }), act('component.isolate', { componentId: 'sun_gear' })]),
        step(1, [act('assembly.explode', { factor: 0.5 }), act('animation.setSpeed', { speed: 2 })])],
    })));
    await t.done();
    const s = t.w.snapshot(false);
    assert.deepEqual(s.highlightedComponentIds, { status: 'known', value: [] });
    assert.deepEqual(s.isolatedComponentId, { status: 'known', value: null });
    assert.equal(s.exploded.factor, 0);
    assert.deepEqual(t.w.anim, { playing: true, speed: 1 });
    assert.equal(s.selectedComponentId, 'sun_gear', 'topic stays selected for follow-ups');
    t.close();
  });

  it('pause stops progress and the narration; resume continues', async () => {
    const t = setup(gearbox, 60);
    t.player.start(validated(t.w));
    while (t.player.getState().phase !== 'narrating') await sleep(3);
    t.player.pause();
    const pos = t.player.getState().stepPosition;
    await sleep(150);
    assert.equal(t.player.getState().status, 'paused');
    assert.equal(t.player.getState().stepPosition, pos, 'no progress while paused');
    assert.ok(t.n.clips.some((c) => c.paused), 'narration paused');
    t.player.resume();
    await t.done();
    assert.equal(t.player.getState().status, 'finished');
    t.close();
  });

  it('cancel stops speech, dispatches nothing more and restores the scene (incl. selection)', async () => {
    const t = setup(gearbox, 80);
    t.w.dispatcher.dispatch({ type: 'component.select', componentId: 'ring_gear' }, 'ui');
    t.player.start(validated(t.w, rawPlan({
      steps: [step(0, [act('component.select', { componentId: 'sun_gear' }), act('component.highlight', { componentIds: ['planet_gear_1'] }), act('component.isolate', { componentId: 'sun_gear' })]),
        step(1, [act('animation.pause')])],
    })));
    while (t.player.getState().phase !== 'narrating') await sleep(3);
    t.player.cancel();
    const h = t.w.dispatcher.getHistory().length;
    await sleep(150);
    assert.equal(t.player.getState().status, 'cancelled');
    assert.ok(t.n.clips[0].stopped, 'speech stopped');
    assert.equal(t.w.dispatcher.getHistory().length, h, 'nothing dispatched after cancel');
    const s = t.w.snapshot(false);
    assert.deepEqual(s.highlightedComponentIds, { status: 'known', value: [] });
    assert.deepEqual(s.isolatedComponentId, { status: 'known', value: null });
    assert.equal(s.selectedComponentId, 'ring_gear');
    assert.equal(t.w.anim.playing, true, 'step 1 (pause) never ran');
    t.close();
  });

  it('manual takeover: a command from the user pauses the plan', async () => {
    const t = setup(gearbox, 80);
    t.player.start(validated(t.w));
    while (t.player.getState().phase !== 'narrating') await sleep(3);
    t.w.dispatcher.dispatch({ type: 'component.select', componentId: 'ring_gear' }, 'mouse');
    assert.equal(t.player.getState().status, 'paused');
    assert.match(t.player.getState().message ?? '', /changed the scene/);
    t.close();
  });

  it('manual takeover: steering the camera by hand pauses the plan', async () => {
    const t = setup(gearbox, 120);
    t.player.start(validated(t.w));
    while (t.player.getState().phase !== 'narrating') await sleep(3);
    t.w.steer.on = true;
    await sleep(40);
    assert.equal(t.player.getState().status, 'paused');
    assert.match(t.player.getState().message ?? '', /moved the view/);
    t.w.steer.on = false;
    t.close();
  });

  it('a model switch during playback cancels without touching the new model', async () => {
    const t = setup(gearbox, 80);
    t.player.start(validated(t.w));
    while (t.player.getState().phase !== 'narrating') await sleep(3);
    t.w.dispatcher.dispatch({ type: 'workspace.switchModel', modelId: bridge.id }, 'ui');
    const h = t.w.dispatcher.getHistory().length;
    await sleep(80);
    assert.equal(t.player.getState().status, 'cancelled');
    assert.match(t.player.getState().message ?? '', /model changed/);
    assert.equal(aiTypes(t.w, h).length, 0, 'no command dispatched on the bridge');
    t.close();
  });

  it('refuses to start a plan for a model that is no longer loaded', () => {
    const t = setup();
    const plan = validated(t.w);
    t.w.dispatcher.dispatch({ type: 'workspace.switchModel', modelId: bridge.id }, 'ui');
    assert.equal(t.player.start(plan), false);
    assert.equal(t.player.getState().status, 'failed');
    t.close();
  });

  it('a step that no longer validates is skipped without changing the scene', async () => {
    const t = setup();
    const plan = validated(t.w);
    // Simulate a step that became invalid after validation (bypassing the validator on purpose)
    plan.steps[1] = { ...plan.steps[1], actions: [{ type: 'component.focus', componentId: 'piston' }] };
    const h0 = t.w.dispatcher.getHistory().length;
    t.player.start(plan);
    await t.done();
    assert.equal(t.player.getState().status, 'finished');
    assert.deepEqual(t.player.getState().runtimeRejected.map((r) => [r.index, r.code]), [[1, 'UNKNOWN_COMPONENT']]);
    assert.ok(!t.w.dispatcher.getHistory().slice(h0).some((r) => JSON.stringify(r.command).includes('piston')));
    assert.ok(!t.n.played.includes('Narration 1.'), 'skipped step is not narrated');
    t.close();
  });

  it('never runs two plans at once', async () => {
    const t = setup(gearbox, 60);
    assert.equal(t.player.start(validated(t.w)), true);
    assert.equal(t.player.start(validated(t.w)), false);
    t.close();
  });

  it('waits for Continue on a "user" step', async () => {
    const t = setup();
    t.player.start(validated(t.w, rawPlan({ steps: [step(0, [], { waitFor: 'user' }), step(1, [])] })));
    while (t.player.getState().status !== 'waitingForUser') await sleep(3);
    await sleep(60);
    assert.equal(t.player.getState().stepPosition, 0);
    t.player.continue();
    await t.done();
    assert.deepEqual(t.n.played, ['Narration 0.', 'Narration 1.']);
    t.close();
  });

  it('commands are dispatched through V1 with source "ai" and validated again there', async () => {
    const t = setup();
    t.player.start(validated(t.w));
    await t.done();
    const ai = t.w.dispatcher.getHistory().filter((r) => r.source === 'ai');
    assert.ok(ai.length > 0 && ai.every((r) => r.status === 'executed'));
    t.close();
  });
});

/* ======================= 3. Routing: deterministic commands vs teaching ======================= */

describe('Command vs teaching-question routing (Task V4)', () => {
  const turn = (w: ReturnType<typeof makeWorkspace>, transcript: string, language = 'en-IN') => {
    const r = handleVoiceTurn({ transcript, language, dispatcher: w.dispatcher, model: w.ws.model, allModels: ALL, lastDiscussed: w.memory.last, teachingAvailable: true });
    if (r.discussedComponentId) w.memory.last = { modelId: w.ws.model.id, componentId: r.discussedComponentId };
    return r;
  };

  it('simple commands stay on the deterministic path (no LLM)', () => {
    const w = makeWorkspace();
    for (const t of ['zoom in', 'show the back', 'hide the sun gear', 'rotate left', 'show me the parts connected to the ring gear', 'put it back']) {
      const r = turn(w, t);
      assert.notEqual(r.status, 'teach', t);
      assert.equal(r.teach, undefined, t);
    }
  });

  it('"what is this?" is still answered locally from metadata', () => {
    const w = makeWorkspace();
    w.dispatcher.dispatch({ type: 'component.select', componentId: 'sun_gear' }, 'ui');
    assert.equal(turn(w, 'what is this').status, 'answered');
  });

  const teachCases: [string, string | null, string][] = [
    ['Explain how this gearbox works.', null, 'explain'],
    ['Show me how power flows through the gearbox.', null, 'howWorks'],
    ['What happens when the sun gear rotates?', 'sun_gear', 'howWorks'],
    ['Why do we need the planet carrier?', 'planet_carrier', 'purpose'],
    ['What would happen if this component failed?', 'ring_gear', 'failure'],
    ['గేర్‌బాక్స్ ఎలా పనిచేస్తుంది?', null, 'howWorks'],
    ['प्लैनेट कैरियर की ज़रूरत क्यों है?', 'planet_carrier', 'purpose'],
  ];
  for (const [q, target, type] of teachCases) {
    it(`teaching question: "${q}"`, () => {
      const w = makeWorkspace();
      w.dispatcher.dispatch({ type: 'component.select', componentId: 'ring_gear' }, 'ui');
      const lang = /[ఀ-౿]/.test(q) ? 'te-IN' : /[ऀ-ॿ]/.test(q) ? 'hi-IN' : 'en-IN';
      const r = turn(w, q, lang);
      assert.equal(r.status, 'teach', JSON.stringify(r.outcome));
      assert.deepEqual(r.teach, { question: q, questionType: type, targetComponentId: target });
      assert.equal(r.records.length, 0, 'nothing executed before a plan is validated');
    });
  }

  it('bridge: load-transfer questions are whole-model, path questions name several parts', () => {
    const w = makeWorkspace(bridge);
    const a = turn(w, "Explain the bridge's load-transfer mechanism.");
    assert.equal(a.status, 'teach');
    assert.equal(a.teach!.targetComponentId, null);
    const b = turn(w, 'Show me how forces travel from the deck to the piers.');
    assert.equal(b.status, 'teach');
    assert.deepEqual(b.outcome.kind === 'question' && b.outcome.mentionedIds!.sort(), ['bridge_deck', 'support_piers']);
  });

  it('one name shared by several parts is ambiguous, not a path', () => {
    const w = makeWorkspace();
    const r = turn(w, 'explain the planet gear');
    assert.equal(r.outcome.kind, 'ambiguous');
    assert.equal(r.status, 'needsInput');
  });

  it('teaching questions about parts of other models are rejected locally', () => {
    const w = makeWorkspace();
    const r = turn(w, 'why does the piston need oil');
    assert.equal(r.outcome.kind, 'unknownPart');
    assert.equal(r.teach, undefined);
  });

  it('without a configured teaching model, questions keep the V3 "not available yet" reply', () => {
    const w = makeWorkspace();
    const r = handleVoiceTurn({ transcript: 'why do we need the planet carrier', language: 'en-IN', dispatcher: w.dispatcher, model: gearbox, allModels: ALL });
    assert.equal(r.status, 'unavailable');
    assert.match(r.caption, /not available yet/);
  });
});

/* ======================== 4. Follow-ups, context and grounding ======================== */

describe('Teaching follow-ups, context and grounding (Task V4)', () => {
  const turn = (w: ReturnType<typeof makeWorkspace>, transcript: string) => {
    const r = handleVoiceTurn({ transcript, language: 'en-IN', dispatcher: w.dispatcher, model: w.ws.model, allModels: ALL, lastDiscussed: w.memory.last, teachingAvailable: true });
    if (r.discussedComponentId) w.memory.last = { modelId: w.ws.model.id, componentId: r.discussedComponentId };
    return r;
  };

  it('follow-up pronouns keep the discussed part; a model switch forgets it', () => {
    const w = makeWorkspace();
    assert.equal(turn(w, 'Explain the planet carrier.').teach!.targetComponentId, 'planet_carrier');
    const why = turn(w, 'Why is it needed?');
    assert.deepEqual([why.teach!.targetComponentId, why.teach!.questionType], ['planet_carrier', 'purpose']);
    const broke = turn(w, 'What would happen if it broke?');
    assert.deepEqual([broke.teach!.targetComponentId, broke.teach!.questionType], ['planet_carrier', 'failure']);
    w.dispatcher.dispatch({ type: 'workspace.switchModel', modelId: bridge.id }, 'ui');
    const after = turn(w, 'Why is it needed?');
    assert.equal(after.outcome.kind, 'needsSelection');
    assert.equal(after.teach, undefined);
  });

  it('a pointed part is used for "this"; an explicit name overrides it', () => {
    const w = makeWorkspace();
    w.pointer.componentId = 'sun_gear'; w.pointer.source = 'gesture';
    assert.equal(turn(w, 'why is this part needed').teach!.targetComponentId, 'sun_gear');
    assert.equal(turn(w, 'why do we need the ring gear').teach!.targetComponentId, 'ring_gear');
  });

  it('missing context asks the user instead of guessing', () => {
    const w = makeWorkspace();
    const r = turn(w, 'why is this needed');
    assert.equal(r.outcome.kind, 'needsSelection');
    assert.equal(r.teach, undefined);
  });

  it('fact pack: grounded in model data, minimal, and states what is not simulated', () => {
    const w = makeWorkspace();
    const pack = buildFactPack(gearbox, w.snapshot(false), 'planet_carrier');
    assert.equal(pack.modelId, 'planetary_gearbox');
    const carrier = pack.components.find((c) => c.id === 'planet_carrier')!;
    assert.ok(carrier.notes.length > 0 && carrier.description.length > 0, 'target in full');
    assert.deepEqual(carrier.relationships.map((r) => `${r.type}:${r.target}`).sort(),
      ['driven_by:planet_gear_1', 'driven_by:planet_gear_2', 'driven_by:planet_gear_3',
        'supports:planet_gear_1', 'supports:planet_gear_2', 'supports:planet_gear_3']);
    const shaft = pack.components.find((c) => c.id === 'central_shaft')!;
    assert.equal(shaft.description, '', 'parts outside the question are sent briefly');
    assert.deepEqual(pack.animations.map((a) => a.id), ['gear_train_rotation']);
    assert.ok(pack.limits.some((l) => /not simulate forces, torque/.test(l)));
    assert.ok(pack.allowedActions.every((a) => !['component.visibility', 'workspace.switchModel', 'workspace.goHome'].includes(a)));
    const json = JSON.stringify(pack);
    assert.ok(json.length < 9000, `pack size ${json.length}`);
    for (const banned of ['geometry', 'uuid', 'GNANI', 'api_key', 'LLM_API_KEY']) assert.ok(!json.includes(banned), banned);
  });

  it('fact pack: the bridge declares no structural analysis and no animation', () => {
    const w = makeWorkspace(bridge);
    const pack = buildFactPack(bridge, w.snapshot(false), null);
    assert.deepEqual(pack.animations, []);
    assert.ok(modelLimits(bridge).some((l) => /No structural analysis/.test(l)));
    assert.ok(!pack.allowedActions.includes('animation.play'));
    const deck = pack.components.find((c) => c.id === 'bridge_deck')!;
    assert.deepEqual(deck.relationships.map((r) => r.target).sort(), ['bottom_chords', 'vertical_struts']);
    assert.ok(pack.components.every((c) => c.relationships.every((r) => bridge.getAllComponentIds().includes(r.target))));
  });
});

/* ============================ 5. Teaching client errors ============================ */

describe('Teaching client (Task V4)', () => {
  const body = { question: 'q', language: 'en-IN', targetComponentId: null, facts: {} as never, history: [] };
  const respond = (status: number, data: unknown) => (async () => new Response(JSON.stringify(data), { status })) as typeof fetch;

  it('maps server errors to stable codes and readable messages', async () => {
    for (const [code, status] of [['LLM_NOT_CONFIGURED', 503], ['LLM_TIMEOUT', 504], ['PLAN_INVALID', 422], ['LLM_RATE_LIMIT', 429]] as const) {
      await assert.rejects(requestTeachingPlan(body, undefined, respond(status, { error: { code, message: 'x' } })),
        (e: TeachingServiceError) => e.code === code && e.message.length > 5);
    }
  });

  it('reports a down backend and cancellation', async () => {
    await assert.rejects(requestTeachingPlan(body, undefined, (async () => { throw new TypeError('fetch failed'); }) as typeof fetch),
      (e: TeachingServiceError) => e.code === 'BACKEND_UNAVAILABLE');
    const c = new AbortController();
    c.abort();
    await assert.rejects(requestTeachingPlan(body, c.signal, (async () => { throw new DOMException('aborted', 'AbortError'); }) as typeof fetch),
      (e: TeachingServiceError) => e.code === 'CANCELLED');
  });

  it('returns the plan on success', async () => {
    assert.deepEqual(await requestTeachingPlan(body, undefined, respond(200, { plan: { a: 1 } })), { a: 1 });
  });
});
