/**
 * Task V5 — voice reliability, explanations and interruption handling.
 *
 * Transcripts marked "Prisma" are the real Gnani Prisma output for Timbre-spoken requests
 * (27 Oct 2026), including its mis-hearings. The LLM is SIMULATED here (controllable promises);
 * the dispatcher, viewer executor, camera, model geometry, plan validation and player are real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import { WARREN_TRUSS_MODEL_ID } from '../src/models/civil/warrenTrussBridgeModel';
import { getSceneSnapshot } from '../src/services/scene/sceneSnapshot';
import { handleVoiceTurn, type VoiceTurnResult } from '../src/services/voice/voiceSession';
import { TeachingPlanPlayer, type NarrationClip, type Narrator } from '../src/services/teaching/planPlayer';
import { TeachingController, FALLBACK_NOTICES, fallbackCause } from '../src/services/teaching/teachingController';
import { TeachingServiceError, type TeachRequestBody } from '../src/services/teaching/teachingClient';
import { buildComponentBrief } from '../src/services/teaching/componentBrief';
import { validateTeachingPlan } from '../src/services/teaching/teachingPlan';
import { createTimbreNarrator } from '../src/services/teaching/teachingSession';
import { makeWorkspace } from './sceneContext.test';

const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
const bridge = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID)!;
const ALL = modelRegistry.getAllModels();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type WS = ReturnType<typeof makeWorkspace>;

/* -------------------------------- helpers -------------------------------- */

function turn(w: WS, transcript: string, language = 'en-IN', extra: { teachingActive?: boolean; onSupersede?: () => void } = {}): VoiceTurnResult {
  const r = handleVoiceTurn({
    transcript, language, dispatcher: w.dispatcher, model: w.ws.model, allModels: ALL,
    lastDiscussed: w.memory.last, teachingAvailable: true, ...extra,
  });
  if (r.discussedComponentId) w.memory.last = { modelId: w.ws.model.id, componentId: r.discussedComponentId };
  return r;
}

function selected(component: string, model = gearbox): WS {
  const w = makeWorkspace(model);
  w.dispatcher.dispatch({ type: 'component.select', componentId: component }, 'ui');
  return w;
}

/** Narrator that "speaks" for `ms` of unpaused time; records starts and stops. */
function fakeNarrator(ms = 40) {
  const played: string[] = [];
  const clips: { text: string; stopped: boolean; paused: boolean }[] = [];
  const narrator: Narrator = {
    prepare(text: string): NarrationClip {
      const rec = { text, stopped: false, paused: false };
      clips.push(rec);
      let resolve!: (v: 'ended' | 'failed' | 'stopped') => void;
      const done = new Promise<'ended' | 'failed' | 'stopped'>((r) => (resolve = r));
      let timer: ReturnType<typeof setInterval> | null = null;
      return {
        done,
        play() {
          played.push(text);
          let left = ms;
          timer = setInterval(() => {
            if (rec.paused || rec.stopped) return;
            left -= 5;
            if (left <= 0) { clearInterval(timer!); resolve('ended'); }
          }, 5);
          timer.unref?.();
        },
        pause() { rec.paused = true; },
        resume() { rec.paused = false; },
        stop() { rec.stopped = true; if (timer) clearInterval(timer); resolve('stopped'); },
      };
    },
  };
  return { narrator, played, clips };
}

/** A teaching plan as the backend returns it, for whichever part the request targeted. */
function llmPlan(target: string | null, model = gearbox, nSteps = 3) {
  return {
    schemaVersion: 1,
    planId: Array.from({ length: 32 }, (_, i) => ((i * 7 + (target?.length ?? 3)) % 16).toString(16)).join(''),
    modelId: model.id, targetComponentId: target,
    title: `About ${target ?? model.name}`, explanation: 'Grounded explanation.', cannotAnswer: null,
    steps: Array.from({ length: nSteps }, (_, i) => ({
      index: i, kind: 'demonstrate', claim: 'metadata', narration: `${target ?? 'model'} step ${i}.`, caption: `Step ${i}`,
      targetComponentId: target, actions: target ? [{ type: 'component.focus', componentId: target }] : [], waitFor: 'narration', holdMs: 0,
    })),
    rejectedSteps: [], followUpSuggestions: [],
  };
}

/** Controller + real player with a simulated LLM whose replies the test resolves. */
function lifecycle(w: WS, narratorMs = 40) {
  const loop = setInterval(() => w.tick(16), 4);
  loop.unref?.();
  const n = fakeNarrator(narratorMs);
  const player = new TeachingPlanPlayer({
    dispatcher: w.dispatcher, getSnapshot: () => getSceneSnapshot(w.dispatcher, w.ws.model), narrator: n.narrator, pollMs: 4, settleTimeoutMs: 1500,
  });
  const detach = player.attach();
  const requests: { body: TeachRequestBody; signal: AbortSignal; resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  const started: string[] = [];
  const controller = new TeachingController({
    dispatcher: w.dispatcher, player,
    getModel: () => w.ws.model, getLanguage: () => 'en-IN',
    requestPlan: (body, signal) => new Promise((resolve, reject) => requests.push({ body, signal, resolve, reject })),
    onPlanStarted: (p) => started.push(`${p.source}:${p.targetComponentId}`),
  });
  const close = () => { controller.cancel(); detach(); clearInterval(loop); };
  const until = async (cond: () => boolean, ms = 3000) => {
    const t0 = Date.now();
    while (!cond() && Date.now() - t0 < ms) await sleep(5);
    return cond();
  };
  return { player, controller, requests, started, n, close, until };
}

const aiSince = (w: WS, from: number) => w.dispatcher.getHistory().slice(from).filter((r) => r.source === 'ai').map((r) => JSON.stringify(r.command));

/* ===================== 1. Intent routing with real transcripts ===================== */

describe('V5 intent routing: selected part + natural requests (EN / TE / HI, code-mixed)', () => {
  const cases: [string, string, string][] = [
    // [language, transcript, expected questionType] — the sun gear is selected
    ['te-IN', 'చూడు ఇప్పుడు నేను ఈ పార్ట్ ని సెలెక్ట్ చేశాను దాన్ని ఎక్స్ప్లెయిన్ చేయ', 'explain'], // user's exact words
    ['te-IN', 'చూడు ఇప్పుడు నేను ఈ పార్టీని సెలెక్ట్ చేశాను దాన్ని ఎక్స్ప్లెయిన్ చెయ్య', 'explain'], // Prisma
    ['te-IN', 'ఈ పాట ఎందుకు అవసరం', 'purpose'], // Prisma (mis-heard "పార్ట్")
    ['te-IN', 'ఇది ఎలా పని చేస్తుంది', 'howWorks'],
    ['hi-IN', 'देखो मैंने यह पार्ट सेलेक्ट किया है इसे एक्सप्लेन करो।', 'explain'], // Prisma
    ['hi-IN', 'इसकी जरूरत क्यों है', 'purpose'],
    ['en-IN', 'Explain this part. Why is it used, and how does it work?', 'explain'],
    ['en-IN', 'Why do we need this?', 'purpose'],
    ['en-IN', 'How does it work?', 'howWorks'],
    ['en-IN', 'What happens if it fails?', 'failure'],
    ['en-IN', 'Show me how it interacts with the other gears.', 'howWorks'],
    ['en-IN', 'What is its role in the entire gearbox?', 'purpose'],
  ];
  for (const [language, transcript, type] of cases) {
    it(`${language}: "${transcript}" -> explain the selected sun gear (${type})`, () => {
      const w = selected('sun_gear');
      const r = turn(w, transcript, language);
      assert.equal(r.status, 'teach', JSON.stringify(r.outcome));
      assert.equal(r.teach!.targetComponentId, 'sun_gear');
      assert.equal(r.teach!.questionType, type);
      assert.equal(r.records.length, 0, 'the selection is not re-dispatched');
    });
  }

  it('"Explain it in Telugu" keeps the part and asks for Telugu', () => {
    const r = turn(selected('sun_gear'), 'Explain it in Telugu');
    assert.deepEqual([r.teach!.targetComponentId, r.teach!.language], ['sun_gear', 'te-IN']);
  });

  it('"Explain how this gearbox works" is about the whole model even with a part selected', () => {
    const r = turn(selected('sun_gear'), 'Explain how this gearbox works');
    assert.equal(r.status, 'teach');
    assert.equal(r.teach!.targetComponentId, null);
  });

  it('an explicit name overrides the selection ("No, not that part. Explain the planet carrier instead.")', () => {
    const r = turn(selected('sun_gear'), 'no not that part explain the planet carrier instead'); // Prisma
    assert.equal(r.teach!.targetComponentId, 'planet_carrier');
  });

  it('a follow-up keeps the discussed part; a model switch clears it', () => {
    const w = makeWorkspace();
    assert.equal(turn(w, 'Explain the planet carrier.').teach!.targetComponentId, 'planet_carrier');
    assert.equal(turn(w, 'Why is it needed?').teach!.targetComponentId, 'planet_carrier');
    assert.equal(turn(w, 'అది ఎందుకు అవసరం', 'te-IN').teach!.targetComponentId, 'planet_carrier', 'follow-up in another language');
    w.dispatcher.dispatch({ type: 'workspace.switchModel', modelId: bridge.id }, 'ui');
    assert.equal(turn(w, 'Why is it needed?').outcome.kind, 'needsSelection');
  });

  it('missing context gets a spoken clarification, never an arbitrary part', () => {
    for (const [t, lang] of [['Explain this part.', 'en-IN'], ['దాన్ని ఎక్స్ప్లెయిన్ చెయ్యి', 'te-IN']]) {
      const r = turn(makeWorkspace(), t, lang);
      assert.equal(r.status, 'needsInput');
      assert.equal(r.speak, true);
      assert.equal(r.teach, undefined);
    }
  });

  it('a part from another model is named, not substituted', () => {
    const r = turn(selected('sun_gear'), 'explain the piston');
    assert.equal(r.outcome.kind, 'unknownPart');
    assert.equal(r.teach, undefined);
  });

  it('an empty transcript asks to repeat and starts nothing', () => {
    let superseded = 0;
    const r = turn(selected('sun_gear'), '   ', 'te-IN', { onSupersede: () => superseded++ });
    assert.equal(r.status, 'needsInput');
    assert.match(r.caption, /ఇంకోసారి/);
    assert.equal(superseded, 0);
  });
});

/* ===================== 2. Supersede vs follow-up vs control ===================== */

describe('V5 request classification during an explanation', () => {
  it('new requests supersede; clarifications, unknown speech and controls do not', () => {
    const w = selected('ring_gear');
    const count = (t: string, active = true) => {
      let n = 0;
      turn(w, t, 'en-IN', { teachingActive: active, onSupersede: () => n++ });
      return n;
    };
    assert.equal(count('Actually, just show me where it is.'), 1, 'visual command');
    assert.equal(count('Explain the planet carrier'), 1, 'new teaching question');
    assert.equal(count('Why is it needed?'), 1, 'follow-up question (new plan, same part)');
    assert.equal(count('make me a sandwich'), 0, 'unrecognised speech');
    assert.equal(count('wait'), 0, 'control');
    assert.equal(count('explain the piston'), 0, 'unknown part keeps the explanation');
  });

  it('"wait / continue / stop" control the explanation only while one is active', () => {
    const w = selected('sun_gear');
    const c = (t: string, lang = 'en-IN') => turn(w, t, lang, { teachingActive: true });
    assert.deepEqual([c('wait').control, c('continue').control, c('stop').control], ['pause', 'resume', 'stop']);
    assert.deepEqual([c('ఆగు', 'te-IN').control, c('కొనసాగించు', 'te-IN').control, c('బస్ చాలు', 'te-IN').control], ['pause', 'resume', 'stop']);
    assert.deepEqual([c('रुको', 'hi-IN').control, c('जारी रखो', 'hi-IN').control, c('बस', 'hi-IN').control], ['pause', 'resume', 'stop']);
    const idle = turn(w, 'stop', 'en-IN', { teachingActive: false });
    assert.equal(idle.outcome.kind, 'commands', 'without an explanation, "stop" keeps its V2 meaning (pause the animation)');
    const named = c('stop and explain the ring gear');
    assert.equal(named.status, 'teach', 'a part name or question makes it a new request, not a control');
  });

  it('"Actually, just show me where it is" targets the part being explained', () => {
    const w = makeWorkspace();
    w.memory.last = { modelId: gearbox.id, componentId: 'ring_gear' };
    const r = turn(w, 'Actually, just show me where it is.', 'en-IN', { teachingActive: true });
    assert.equal(r.status, 'executed');
    assert.deepEqual(r.records.map((x) => (x.command as { componentId?: string }).componentId), ['ring_gear', 'ring_gear']);
  });
});

/* ===================== 3. Interruption lifecycle and races ===================== */

describe('V5 interruption lifecycle (simulated LLM, real player and dispatcher)', () => {
  it('a new component request stops the old narration and plays the new plan', async () => {
    const w = selected('sun_gear');
    const L = lifecycle(w, 150);
    try {
      void L.controller.ask({ question: 'Explain the sun gear', questionType: 'explain', targetComponentId: 'sun_gear' });
      L.requests[0].resolve(llmPlan('sun_gear'));
      assert.ok(await L.until(() => L.player.getState().phase === 'narrating'));
      const sunClip = L.n.clips.find((c) => c.text.startsWith('sun_gear'))!;
      void L.controller.ask({ question: 'Explain the planet carrier instead', questionType: 'explain', targetComponentId: 'planet_carrier' });
      assert.ok(sunClip.stopped, 'old narration stopped immediately');
      assert.equal(L.player.getState().status, 'cancelled');
      const h = w.dispatcher.getHistory().length;
      L.requests[1].resolve(llmPlan('planet_carrier'));
      assert.ok(await L.until(() => L.player.getState().plan?.targetComponentId === 'planet_carrier' && L.player.getState().phase === 'narrating'));
      assert.ok(aiSince(w, h).every((c) => !c.includes('sun_gear')), 'no stale sun-gear action after the interruption');
      assert.deepEqual(L.started, ['llm:sun_gear', 'llm:planet_carrier']);
    } finally { L.close(); }
  });

  it('a visual command supersedes the plan: no further plan actions, the command runs', async () => {
    const w = selected('ring_gear');
    const L = lifecycle(w, 150);
    try {
      void L.controller.ask({ question: 'Explain the ring gear', questionType: 'explain', targetComponentId: 'ring_gear' });
      L.requests[0].resolve(llmPlan('ring_gear', gearbox, 4));
      assert.ok(await L.until(() => L.player.getState().phase === 'narrating'));
      const h = w.dispatcher.getHistory().length;
      const r = turn(w, 'Actually, just show me where it is.', 'en-IN', {
        teachingActive: L.controller.isActive(), onSupersede: () => L.controller.supersede(),
      });
      assert.equal(r.status, 'executed');
      assert.equal(L.player.getState().status, 'cancelled');
      await sleep(300);
      const after = w.dispatcher.getHistory().slice(h);
      assert.ok(after.some((x) => x.source === 'voice' && (x.command as { type: string }).type === 'component.focus'));
      assert.ok(!after.some((x) => x.source === 'ai' && (x.command as { type: string }).type === 'component.focus'), 'no stale plan step ran');
    } finally { L.close(); }
  });

  it('a late LLM reply for a superseded question is never played', async () => {
    const w = selected('sun_gear');
    const L = lifecycle(w);
    try {
      const first = L.controller.ask({ question: 'Explain the sun gear', questionType: 'explain', targetComponentId: 'sun_gear' });
      const second = L.controller.ask({ question: 'Explain the ring gear', questionType: 'explain', targetComponentId: 'ring_gear' });
      assert.ok(L.requests[0].signal.aborted, 'the superseded request was aborted');
      L.requests[1].resolve(llmPlan('ring_gear'));
      assert.equal(await second, 'started');
      L.requests[0].resolve(llmPlan('sun_gear')); // arrives late anyway
      assert.equal(await first, 'stale');
      assert.equal(L.player.getState().plan?.targetComponentId, 'ring_gear');
      assert.deepEqual(L.started, ['llm:ring_gear']);
    } finally { L.close(); }
  });

  it('a reply that arrives after Stop does not restart anything', async () => {
    const w = selected('sun_gear');
    const L = lifecycle(w);
    try {
      const p = L.controller.ask({ question: 'Explain this', questionType: 'explain', targetComponentId: 'sun_gear' });
      L.controller.cancel();
      L.requests[0].resolve(llmPlan('sun_gear'));
      assert.equal(await p, 'stale');
      assert.equal(L.player.isActive(), false);
      assert.deepEqual(L.started, []);
    } finally { L.close(); }
  });

  it('a model switch while the reply is pending discards it; nothing touches the bridge', async () => {
    const w = selected('sun_gear');
    const L = lifecycle(w);
    try {
      const p = L.controller.ask({ question: 'Explain this', questionType: 'explain', targetComponentId: 'sun_gear' });
      w.dispatcher.dispatch({ type: 'workspace.switchModel', modelId: bridge.id }, 'ui');
      L.controller.modelChanged(bridge.id);
      const h = w.dispatcher.getHistory().length;
      L.requests[0].resolve(llmPlan('sun_gear'));
      assert.equal(await p, 'stale');
      await sleep(100);
      assert.deepEqual(aiSince(w, h), []);
    } finally { L.close(); }
  });

  it('a model switch while a plan is playing cancels it before any further step', async () => {
    const w = selected('sun_gear');
    const L = lifecycle(w, 150);
    try {
      void L.controller.ask({ question: 'Explain this', questionType: 'explain', targetComponentId: 'sun_gear' });
      L.requests[0].resolve(llmPlan('sun_gear', gearbox, 4));
      assert.ok(await L.until(() => L.player.getState().phase === 'narrating'));
      w.dispatcher.dispatch({ type: 'workspace.switchModel', modelId: bridge.id }, 'ui');
      const h = w.dispatcher.getHistory().length;
      assert.ok(await L.until(() => L.player.getState().status === 'cancelled'));
      await sleep(200);
      assert.deepEqual(aiSince(w, h), []);
    } finally { L.close(); }
  });

  it('rapid requests: only the last one plays, exactly once', async () => {
    const w = selected('sun_gear');
    const L = lifecycle(w);
    try {
      const ids = ['sun_gear', 'ring_gear', 'planet_carrier'];
      const results = ids.map((id) => L.controller.ask({ question: `Explain ${id}`, questionType: 'explain', targetComponentId: id }));
      [2, 0, 1].forEach((i) => L.requests[i].resolve(llmPlan(ids[i]))); // out of order
      assert.deepEqual(await Promise.all(results), ['stale', 'stale', 'started']);
      assert.deepEqual(L.started, ['llm:planet_carrier']);
    } finally { L.close(); }
  });
});

/* ===================== 4. Failure handling: always an answer ===================== */

describe('V5 failure handling (the user always gets an answer or a clear message)', () => {
  for (const [label, err] of [
    ['quota exhausted', new TeachingServiceError('LLM_QUOTA_EXCEEDED', 'quota')],
    ['not configured', new TeachingServiceError('LLM_NOT_CONFIGURED', 'x')],
    ['backend unavailable', new TeachingServiceError('BACKEND_UNAVAILABLE', 'x')],
    ['timeout', new TeachingServiceError('TIMEOUT', 'x')],
  ] as const) {
    it(`${label}: explains the selected part from the model data, with a notice`, async () => {
      const w = selected('sun_gear');
      const L = lifecycle(w);
      try {
        const p = L.controller.ask({ question: 'Explain this part', questionType: 'explain', targetComponentId: 'sun_gear' });
        L.requests[0].reject(err);
        assert.equal(await p, 'fallback');
        const plan = L.player.getState().plan!;
        assert.equal(plan.source, 'modelData');
        assert.equal(plan.targetComponentId, 'sun_gear');
        // one short notice naming the cause (quota / not configured / offline / timeout), no raw error text
        assert.equal(L.controller.getState().notice, FALLBACK_NOTICES[fallbackCause(err.code)]['en-IN']);
        assert.ok(await L.until(() => L.n.played.length > 0), 'it is spoken');
      } finally { L.close(); }
    });
  }

  it('an AI plan that fails validation falls back instead of playing unsafe content', async () => {
    const w = selected('sun_gear');
    const L = lifecycle(w);
    try {
      const p = L.controller.ask({ question: 'Explain this part', questionType: 'explain', targetComponentId: 'sun_gear' });
      L.requests[0].resolve({ ...llmPlan('sun_gear'), modelId: 'warren_truss_bridge' });
      assert.equal(await p, 'fallback');
      assert.match(L.controller.getState().notice!, /could not be used safely/);
      assert.equal(L.player.getState().plan!.source, 'modelData');
    } finally { L.close(); }
  });

  it('the request sent to the teacher carries the question type and only this model\'s facts', async () => {
    const w = selected('sun_gear');
    const L = lifecycle(w);
    try {
      void L.controller.ask({ question: 'Why is it needed?', questionType: 'purpose', targetComponentId: 'sun_gear' });
      const body = L.requests[0].body;
      assert.equal(body.questionType, 'purpose');
      assert.equal(body.facts.modelId, 'planetary_gearbox');
      assert.equal(body.facts.modelDescription, gearbox.description);
      assert.ok(body.facts.components.every((c) => gearbox.getAllComponentIds().includes(c.id)));
    } finally { L.close(); }
  });
});

/* ===================== 5. Narrator: late TTS never plays ===================== */

describe('V5 narration: late TTS audio is never played', () => {
  it('a clip stopped before its audio arrives never creates audio; queued clips are not even requested', async () => {
    const g = globalThis as unknown as { fetch: typeof fetch; Audio?: unknown };
    const realFetch = g.fetch;
    const realAudio = g.Audio;
    let fetches = 0;
    let audios = 0;
    let release!: () => void;
    g.fetch = (async () => {
      fetches++;
      await new Promise<void>((r) => (release = r));
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
    }) as typeof fetch;
    g.Audio = class { constructor() { audios++; } play() { return Promise.resolve(); } pause() {} };
    try {
      const narrator = createTimbreNarrator(() => 'en-IN', () => {});
      const a = narrator.prepare('old step', 'en-IN');
      const b = narrator.prepare('prefetched next step', 'en-IN');
      a.play();
      await sleep(10);
      a.stop();
      b.stop();
      release();
      await sleep(50);
      assert.equal(await a.done, 'stopped');
      assert.equal(audios, 0, 'no Audio created for a stopped clip');
      assert.equal(fetches, 1, 'the queued (prefetched) clip was never requested');
    } finally {
      g.fetch = realFetch;
      g.Audio = realAudio;
    }
  });
});

/* ===================== 6. Grounded model-data explanations ===================== */

describe('V5 grounded explanation from model data', () => {
  it('uses the selected part\'s own facts and relationships', () => {
    const w = selected('sun_gear');
    const raw = buildComponentBrief(gearbox, w.snapshot(false), 'sun_gear', 'explain');
    const v = validateTeachingPlan(raw, w.snapshot(false), w.dispatcher.getContext());
    assert.ok(v.ok, JSON.stringify(v));
    const plan = (v as { plan: { steps: { narration: string; claim: string; actions: { type: string; componentIds?: string[] }[] }[] } }).plan;
    const text = plan.steps.map((s) => s.narration).join(' ');
    const meta = gearbox.getComponentMetadata('sun_gear')!;
    assert.ok(text.includes(meta.role), 'role');
    assert.ok(text.includes('is driven by Primary Drive Shaft'), 'relationship from the model');
    assert.ok(text.includes('drives Planet Gear A, Planet Gear B and Planet Gear C'));
    assert.ok(text.includes(meta.engineeringNotes[0]), 'engineering note');
    const hl = plan.steps.flatMap((s) => s.actions).find((a) => a.type === 'component.highlight')!;
    assert.deepEqual(hl.componentIds!.sort(), ['central_shaft', 'planet_gear_1', 'planet_gear_2', 'planet_gear_3']);
    assert.equal(plan.steps[plan.steps.length - 1].claim, 'notSimulated');
    assert.match(text, /does not calculate forces, torque, friction or wear/);
  });

  it('failure questions are qualified as not simulated and name only linked parts', () => {
    const w = selected('planet_carrier');
    const raw = buildComponentBrief(gearbox, w.snapshot(false), 'planet_carrier', 'failure') as { steps: { narration: string }[] };
    const last = raw.steps[raw.steps.length - 1].narration;
    assert.match(raw.steps[0].narration, /^Without the Planet Carrier/, 'the consequence comes first, not a definition');
    assert.match(last, /does not simulate the failure/);
    assert.ok(!/Sun Gear|Ring Gear|Drive Shaft/.test(last), 'no unrelated part claimed');
  });

  it('every part of both models gets a valid, model-only brief (no invented links, no animation claim on the bridge)', () => {
    for (const model of [gearbox, bridge]) {
      const w = makeWorkspace(model);
      const names = new Set(model.getAllComponentIds().map((id) => model.getComponentMetadata(id)?.name ?? id));
      for (const id of [...model.getAllComponentIds(), null]) {
        const raw = buildComponentBrief(model, w.snapshot(false), id, 'explain');
        const v = validateTeachingPlan(raw, w.snapshot(false), w.dispatcher.getContext());
        assert.ok(v.ok, `${model.id}/${id}: ${JSON.stringify(v)}`);
        const ids = (v as { plan: { steps: { actions: { componentIds?: string[]; componentId?: string }[] }[] } }).plan.steps
          .flatMap((s) => s.actions).flatMap((a) => a.componentIds ?? (a.componentId ? [a.componentId] : []));
        assert.ok(ids.every((x) => model.getAllComponentIds().includes(x)));
      }
      assert.ok(names.size > 0);
    }
    const w = makeWorkspace(bridge);
    const text = (buildComponentBrief(bridge, w.snapshot(false), 'bridge_deck') as { steps: { narration: string }[] }).steps.map((s) => s.narration).join(' ');
    assert.ok(!/animation/.test(text));
    assert.match(text, /does not calculate forces or stresses/);
  });
});
