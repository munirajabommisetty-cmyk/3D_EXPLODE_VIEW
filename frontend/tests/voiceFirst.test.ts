/**
 * Voice-first milestone — navigation, conversation flow, interruption policy, language handling
 * and the LLM intent fallback mapping. The LLM and Prisma are SIMULATED here (fakes); the
 * dispatcher, viewer executor, camera, geometry, parser, validation and player are real.
 * Transcripts marked "Prisma" are real Gnani Prisma output (27 Oct 2026).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import { WARREN_TRUSS_MODEL_ID } from '../src/models/civil/warrenTrussBridgeModel';
import { getSceneSnapshot } from '../src/services/scene/sceneSnapshot';
import { handleVoiceTurn, previewTurn, scriptLanguage, lexiconFor, type VoiceTurnResult } from '../src/services/voice/voiceSession';
import { turnLanguage, transcribeWithLanguageRetry } from '../src/services/voice/voiceLanguage';
import { canonicalPhrase, INTERPRET_INTENTS, requestInterpretation, type Interpretation } from '../src/services/voice/interpretClient';
import { TeachingPlanPlayer, type NarrationClip, type Narrator } from '../src/services/teaching/planPlayer';
import { TeachingController } from '../src/services/teaching/teachingController';
import type { TeachRequestBody } from '../src/services/teaching/teachingClient';
import { makeWorkspace } from './sceneContext.test';

const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
const bridge = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID)!;
const ALL = modelRegistry.getAllModels();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type WS = ReturnType<typeof makeWorkspace>;

function turn(w: WS, transcript: string, language = 'en-IN', extra: Record<string, unknown> = {}): VoiceTurnResult {
  const r = handleVoiceTurn({
    transcript, language, dispatcher: w.dispatcher, model: w.ws.model, allModels: ALL,
    lastDiscussed: w.memory.last, teachingAvailable: true, ...extra,
  });
  if (r.discussedComponentId) w.memory.last = { modelId: w.ws.model.id, componentId: r.discussedComponentId };
  return r;
}
const selected = (id: string, model = gearbox) => {
  const w = makeWorkspace(model);
  w.dispatcher.dispatch({ type: 'component.select', componentId: id }, 'ui');
  return w;
};
const cmds = (r: VoiceTurnResult) => (r.outcome.kind === 'commands' ? r.outcome.commands : null);

/* ============================== 1. Voice navigation ============================== */

describe('Voice navigation through the shared dispatcher', () => {
  const cases: [string, string, unknown][] = [
    ['en-IN', 'Zoom in', [{ type: 'camera.zoom', direction: 'in' }]],
    ['en-IN', 'Zoom out a little', [{ type: 'camera.zoom', direction: 'out' }]],
    ['en-IN', 'Turn left', [{ type: 'camera.orbit', yawDeg: 30, pitchDeg: 0 }]],
    ['en-IN', 'Turn right', [{ type: 'camera.orbit', yawDeg: -30, pitchDeg: 0 }]],
    ['en-IN', 'Show the front', [{ type: 'camera.view', view: 'front' }]],
    ['en-IN', 'Show the back', [{ type: 'camera.view', view: 'back' }]],
    ['en-IN', 'Show me the back of the gearbox', [{ type: 'camera.view', view: 'back' }]],
    ['en-IN', 'Show the top', [{ type: 'camera.view', view: 'top' }]],
    ['en-IN', 'Move left', [{ type: 'camera.pan', direction: 'left' }]],
    ['en-IN', 'Move right', [{ type: 'camera.pan', direction: 'right' }]],
    ['en-IN', 'Reset the view', [{ type: 'camera.reset' }]],
    ['te-IN', 'కెమెరాని ఎడమవైపు తిప్పు', [{ type: 'camera.orbit', yawDeg: 30, pitchDeg: 0 }]],
    ['hi-IN', 'थोड़ा ज़ूम इन करो।', [{ type: 'camera.zoom', direction: 'in' }]],
    ['hi-IN', 'मुझे पीछे का दृश्य दिखाओ।', [{ type: 'camera.view', view: 'back' }]],
    ['te-IN', 'షో మీ ద బ్యాక్', [{ type: 'camera.view', view: 'back' }]], // Prisma (English heard as Telugu)
    ['hi-IN', 'शो मी दी बैक', [{ type: 'camera.view', view: 'back' }]], // Prisma (English heard as Hindi)
  ];
  for (const [lang, t, expected] of cases) {
    it(`${lang}: "${t}"`, () => assert.deepEqual(cmds(turn(selected('sun_gear'), t, lang)), expected));
  }

  it('"Zoom in on this gear" / "Focus on this part" / "ఈ గేర్‌ని దగ్గరగా చూపించు" focus the selected part', () => {
    for (const [t, lang] of [['Zoom in on this gear', 'en-IN'], ['Focus on this part', 'en-IN'], ['ఈ గేర్‌ని దగ్గరగా చూపించు', 'te-IN']]) {
      assert.deepEqual(cmds(turn(selected('sun_gear'), t, lang)), [
        { type: 'component.select', componentId: 'sun_gear' }, { type: 'component.focus', componentId: 'sun_gear' },
      ], t);
    }
  });

  it('bottom view: a clear reply (camera kept above the grid), nothing dispatched — also on the bridge', () => {
    for (const [model, t] of [[gearbox, 'Show the bottom'], [bridge, 'Show the bottom'], [gearbox, 'show me the view from below'], [gearbox, 'नीचे से दिखाओ']] as const) {
      const w = makeWorkspace(model);
      const before = w.dispatcher.getHistory().length;
      const r = turn(w, t);
      assert.deepEqual(r.outcome, { kind: 'unavailable', intent: 'view', reason: 'noBottomView' }, t);
      assert.match(r.caption, /no bottom view/);
      assert.equal(w.dispatcher.getHistory().length, before);
    }
    assert.equal(turn(makeWorkspace(bridge), 'select the bottom chords').outcome.kind, 'commands', 'the bridge part is still reachable by name');
  });

  it('views land where intended and a new command supersedes a transition in progress', () => {
    const w = makeWorkspace();
    turn(w, 'Show the back');
    w.tick(1000);
    assert.equal((w.snapshot(false).camera as { value: { view: string } }).value.view, 'back');
    turn(w, 'Show the front');
    w.tick(100); // mid-transition
    turn(w, 'Show the top'); // supersedes it
    w.tick(1000);
    assert.equal((w.snapshot(false).camera as { value: { view: string } }).value.view, 'top');
  });

  it('turning rotates around the model; moving pans the target', () => {
    const w = makeWorkspace();
    turn(w, 'reset the view'); w.tick(1000);
    const t0 = w.controller.getGoalPose().target.clone();
    turn(w, 'Turn left'); w.tick(1000);
    assert.ok(w.controller.getGoalPose().target.distanceTo(t0) < 1e-6, 'rotation keeps the target');
    turn(w, 'Move left'); w.tick(1000);
    assert.ok(w.controller.getGoalPose().target.distanceTo(t0) > 0.1, 'panning moves the target');
  });

  it('voice and gesture/mouse use the same dispatcher and validation', () => {
    const w = makeWorkspace();
    turn(w, 'zoom in');
    w.dispatcher.dispatch({ type: 'component.select', componentId: 'ring_gear' }, 'gesture');
    w.dispatcher.dispatch({ type: 'component.select', componentId: 'piston' }, 'mouse');
    const h = w.dispatcher.getHistory().slice(-3).map((r) => `${r.source}:${r.status}`);
    assert.deepEqual(h, ['voice:executed', 'gesture:executed', 'mouse:rejected']);
  });
});

/* ===================== 2. Conversation flow and interruptions ===================== */

function fakeNarrator() {
  const spoken: { text: string; language?: string }[] = [];
  const clips: { stopped: boolean; paused: boolean }[] = [];
  const narrator: Narrator = {
    prepare(text: string, language?: string): NarrationClip {
      const rec = { stopped: false, paused: false };
      clips.push(rec);
      let resolve!: (v: 'ended' | 'failed' | 'stopped') => void;
      const done = new Promise<'ended' | 'failed' | 'stopped'>((r) => (resolve = r));
      let timer: ReturnType<typeof setInterval> | null = null;
      return {
        done,
        play() {
          spoken.push({ text, language });
          let left = 120;
          timer = setInterval(() => { if (rec.paused || rec.stopped) return; left -= 5; if (left <= 0) { clearInterval(timer!); resolve('ended'); } }, 5);
          timer.unref?.();
        },
        pause() { rec.paused = true; }, resume() { rec.paused = false; },
        stop() { rec.stopped = true; if (timer) clearInterval(timer); resolve('stopped'); },
      };
    },
  };
  return { narrator, spoken, clips };
}

function plan(target: string | null, steps = 3) {
  return {
    schemaVersion: 1, planId: `${target ?? 'model'}`.padEnd(32, 'a').replace(/[^a-f0-9]/g, 'b').slice(0, 32),
    modelId: 'planetary_gearbox', targetComponentId: target, title: `About ${target}`, explanation: 'x', cannotAnswer: null,
    steps: Array.from({ length: steps }, (_, i) => ({
      index: i, kind: 'demonstrate', claim: 'metadata', narration: `${target} ${i}.`, caption: `c${i}`, targetComponentId: target,
      actions: target ? [{ type: 'component.focus', componentId: target }] : [], waitFor: 'narration', holdMs: 0,
    })),
    rejectedSteps: [], followUpSuggestions: [],
  };
}

/** The dock's wiring without React: turn -> supersede/ask/control, simulated teacher replies. */
function conversation(w: WS) {
  const loop = setInterval(() => w.tick(16), 4);
  loop.unref?.();
  const n = fakeNarrator();
  const player = new TeachingPlanPlayer({ dispatcher: w.dispatcher, getSnapshot: () => getSceneSnapshot(w.dispatcher, w.ws.model), narrator: n.narrator, pollMs: 4, settleTimeoutMs: 1500 });
  const detach = player.attach();
  const requests: { body: TeachRequestBody; resolve: (v: unknown) => void }[] = [];
  let uiLanguage = 'en-IN';
  const controller = new TeachingController({
    dispatcher: w.dispatcher, player, getModel: () => w.ws.model, getLanguage: () => uiLanguage,
    requestPlan: (body) => new Promise((resolve) => requests.push({ body, resolve })),
    onPlanStarted: (p) => { if (p.targetComponentId) w.memory.last = { modelId: p.modelId, componentId: p.targetComponentId }; },
  });
  const say = (text: string) => {
    const lang = turnLanguage(text, uiLanguage);
    uiLanguage = lang;
    const r = turn(w, text, lang, { teachingActive: controller.isActive(), onSupersede: () => controller.supersede() });
    if (r.status === 'teach' && r.teach) void controller.ask({ ...r.teach, language: r.teach.language ?? lang });
    if (r.status === 'control') {
      if (r.control === 'resume') player.resume(); else if (r.control === 'pause') player.pause(); else controller.supersede();
    }
    return r;
  };
  const answer = async (i: number, target: string | null) => {
    requests[i].resolve(plan(target));
    const t0 = Date.now();
    while (!(player.getState().plan?.targetComponentId === target && player.getState().phase === 'narrating') && Date.now() - t0 < 3000) await sleep(5);
  };
  const close = () => { controller.cancel(); detach(); clearInterval(loop); };
  return { player, controller, requests, n, say, answer, close, language: () => uiLanguage };
}

describe('Conversation flow (Phase 2) and interruption scenarios', () => {
  it('select -> explain -> why -> correction -> Telugu follow-up -> camera command', async () => {
    const w = selected('sun_gear');
    const c = conversation(w);
    try {
      assert.equal(c.say('Explain this part.').teach!.targetComponentId, 'sun_gear');
      await c.answer(0, 'sun_gear');

      const why = c.say('Why is it needed?');
      assert.deepEqual([why.teach!.targetComponentId, why.teach!.questionType], ['sun_gear', 'purpose']);
      await c.answer(1, 'sun_gear');

      const fix = c.say('No, not that one. Explain the planet carrier.');
      assert.equal(fix.teach!.targetComponentId, 'planet_carrier');
      await c.answer(2, 'planet_carrier');

      const te = c.say('ఇది అసలు ఎందుకు అవసరం?'); // Prisma output, verbatim
      assert.deepEqual([te.teach!.targetComponentId, te.teach!.questionType], ['planet_carrier', 'purpose']);
      assert.equal(c.requests[3].body.language, 'te-IN', 'answer requested in Telugu');
      assert.equal(c.language(), 'te-IN');
      await c.answer(3, 'planet_carrier');
      assert.equal(c.n.spoken[c.n.spoken.length - 1].language, 'te-IN', 'narration language = request language');

      const h = w.dispatcher.getHistory().length;
      const back = c.say('Show me the back.');
      assert.deepEqual(cmds(back), [{ type: 'camera.view', view: 'back' }]);
      assert.equal(c.language(), 'en-IN', 'latest request was English');
      assert.equal(c.player.getState().status, 'paused', 'camera command pauses the explanation');
      await sleep(250);
      assert.ok(!w.dispatcher.getHistory().slice(h).some((r) => r.source === 'ai'), 'no stale plan action after the camera command');
    } finally { c.close(); }
  });

  it('Scenario A: a new target stops the old narration; the old plan issues nothing more', async () => {
    const w = makeWorkspace();
    const c = conversation(w);
    try {
      c.say('Explain the sun gear.');
      await c.answer(0, 'sun_gear');
      const playing = c.n.clips.length - 1;
      c.say('No, explain the planet carrier.');
      assert.ok(c.n.clips[playing].stopped, 'old audio stopped at once');
      const h = w.dispatcher.getHistory().length;
      await c.answer(1, 'planet_carrier');
      assert.ok(!w.dispatcher.getHistory().slice(h).some((r) => JSON.stringify(r.command).includes('sun_gear')));
    } finally { c.close(); }
  });

  it('Scenario B: interrupting in Telugu (and then Hindi) keeps the part and answers in that language', async () => {
    const w = makeWorkspace();
    const c = conversation(w);
    try {
      c.say('Explain the ring gear.');
      await c.answer(0, 'ring_gear');
      const te = c.say('దీని ఉపయోగం ఏమిటి');
      assert.deepEqual([te.teach!.targetComponentId, c.requests[1].body.language], ['ring_gear', 'te-IN']);
      await c.answer(1, 'ring_gear');
      const hi = c.say('इसकी जरूरत क्यों है');
      assert.deepEqual([hi.teach!.targetComponentId, c.requests[2].body.language], ['ring_gear', 'hi-IN']);
    } finally { c.close(); }
  });

  it('Scenario C: "zoom in" during a demonstration runs, pauses the plan, and "continue" resumes it', async () => {
    const w = makeWorkspace();
    const c = conversation(w);
    try {
      c.say('Explain how this gearbox works.');
      await c.answer(0, null);
      const zoom = c.say('Zoom in');
      assert.equal(zoom.status, 'executed');
      assert.equal(c.player.getState().status, 'paused');
      const pos = c.player.getState().stepPosition;
      await sleep(300);
      assert.equal(c.player.getState().stepPosition, pos, 'the plan does not continue (or undo the zoom) on its own');
      assert.equal(c.say('continue').control, 'resume');
      assert.equal(c.player.getState().status, 'running');
    } finally { c.close(); }
  });

  it('Scenario D: "What would happen if it were missing?" stays on the ring gear', async () => {
    const w = makeWorkspace();
    const c = conversation(w);
    try {
      c.say('Explain the ring gear.');
      await c.answer(0, 'ring_gear');
      const r = c.say('What would happen if it were missing?');
      assert.deepEqual([r.teach!.targetComponentId, r.teach!.questionType], ['ring_gear', 'failure']);
    } finally { c.close(); }
  });
});

/* ===================== 3. Language detection and STT language retry ===================== */

describe('Conversation language', () => {
  it('detects the spoken language from the transcript script', () => {
    assert.equal(scriptLanguage('ఇది అసలు ఎందుకు అవసరం'), 'te-IN');
    assert.equal(scriptLanguage('मुझे पीछे का दृश्य दिखाओ'), 'hi-IN');
    assert.equal(scriptLanguage('show me the back'), null);
    assert.equal(turnLanguage('ఇది ఎందుకు', 'en-IN'), 'te-IN');
    assert.equal(turnLanguage('show me the back', 'te-IN'), 'en-IN');
    assert.equal(turnLanguage('पीछे दिखाओ', 'mr-IN'), 'mr-IN', 'Marathi shares Devanagari; keep the selection');
    assert.equal(turnLanguage('zoom in', 'ta-IN'), 'ta-IN');
  });

  // What Prisma really returned for the same recording in each language (27 Oct 2026)
  const PRISMA: Record<string, Record<string, string>> = {
    teluguSpeech: { 'en-IN': 'idi asal educ avasar', 'hi-IN': 'इधर असल एंड को अवसर', 'te-IN': 'ఇది అసలు ఎందుకు అవసరం' },
    hindiSpeech: { 'en-IN': 'mujhe pichhe ka drishya dikhao', 'te-IN': 'ముజి కా దృశ్య ది ఖా', 'hi-IN': 'मुझे पीछे का दृश्य दिखाओ।' },
    englishSpeech: { 'en-IN': 'show me the back', 'te-IN': 'షో మీ ద బ్యాక్', 'hi-IN': 'शो मी दी बैक' },
  };
  const understoodBy = (w: WS) => (t: string) => previewTurn({ transcript: t, dispatcher: w.dispatcher, model: gearbox, allModels: ALL }).kind !== 'noMatch';

  it('Telugu spoken while English is selected: re-transcribed and understood as Telugu', async () => {
    const w = selected('planet_carrier');
    const calls: string[] = [];
    const r = await transcribeWithLanguageRetry(new Blob(), 'en-IN', async (_b, l) => { calls.push(l); return PRISMA.teluguSpeech[l]; }, understoodBy(w));
    assert.deepEqual(r, { text: 'ఇది అసలు ఎందుకు అవసరం', language: 'te-IN', retried: true });
    assert.deepEqual(calls.sort(), ['en-IN', 'hi-IN', 'te-IN']);
  });

  it('Hindi spoken while Telugu is selected: understood as Hindi', async () => {
    const w = makeWorkspace();
    const r = await transcribeWithLanguageRetry(new Blob(), 'te-IN', async (_b, l) => PRISMA.hindiSpeech[l], understoodBy(w));
    assert.deepEqual([r.language, r.retried], ['hi-IN', true]);
  });

  it('understood on the first try: one Prisma call only (English heard as Telugu is still understood)', async () => {
    const w = makeWorkspace();
    let calls = 0;
    const r = await transcribeWithLanguageRetry(new Blob(), 'te-IN', async (_b, l) => { calls++; return PRISMA.englishSpeech[l]; }, understoodBy(w));
    assert.deepEqual([calls, r.retried, r.text], [1, false, 'షో మీ ద బ్యాక్']);
  });

  it('nothing understood in any language: keeps the first transcript (then the LLM fallback / "didn\'t understand")', async () => {
    const w = makeWorkspace();
    const r = await transcribeWithLanguageRetry(new Blob(), 'en-IN', async () => 'hmm mm', understoodBy(w));
    assert.deepEqual(r, { text: 'hmm mm', language: 'en-IN', retried: true });
  });

  it('a cancelled turn rejects instead of returning a late transcript', async () => {
    const w = makeWorkspace();
    const c = new AbortController();
    const p = transcribeWithLanguageRetry(new Blob(), 'en-IN', async (_b, l) => { if (l === 'en-IN') c.abort(); return PRISMA.teluguSpeech[l]; }, understoodBy(w), c.signal);
    await assert.rejects(p);
  });
});

/* ===================== 4. LLM intent fallback (mapping only; LLM simulated) ===================== */

describe('LLM intent fallback: every intent maps to a validated deterministic phrase', () => {
  const nameOf = (id: string) => lexiconFor(gearbox).find((e) => e.componentId === id)?.displayName ?? null;
  for (const intent of INTERPRET_INTENTS) {
    it(`${intent}`, () => {
      const i: Interpretation = { intent, componentId: intent.endsWith('_part') || intent === 'related_parts' ? 'ring_gear' : null, language: null };
      const phrase = canonicalPhrase(i, nameOf);
      // general_question has no canonical phrase: the dock sends the learner's own words to the teacher
      if (intent === 'unclear' || intent === 'unsupported' || intent === 'general_question') { assert.equal(phrase, null); return; }
      const w = selected('sun_gear');
      const outcome = previewTurn({ transcript: phrase!, dispatcher: w.dispatcher, model: gearbox, allModels: ALL, teachingActive: intent.endsWith('_explanation') });
      assert.notEqual(outcome.kind, 'noMatch', `"${phrase}" must be understood`);
      if (i.componentId && outcome.kind === 'question') assert.equal(outcome.partId, 'ring_gear', phrase!);
      if (i.componentId && outcome.kind === 'commands') assert.equal(outcome.partId, 'ring_gear', phrase!);
    });
  }

  it('client errors are reported, unknown intents rejected', async () => {
    const respond = (status: number, data: unknown) => (async () => new Response(JSON.stringify(data), { status })) as typeof fetch;
    const body = { transcript: 't', language: 'en-IN', modelId: 'm', modelName: 'M', components: [], topicComponentId: null, teachingActive: false };
    assert.deepEqual(await requestInterpretation(body, undefined, respond(200, { intent: 'zoom_in', componentId: null, language: 'te-IN' })),
      { intent: 'zoom_in', componentId: null, language: 'te-IN' });
    await assert.rejects(requestInterpretation(body, undefined, respond(200, { intent: 'format_disk' })));
    await assert.rejects(requestInterpretation(body, undefined, respond(429, { error: { code: 'LLM_QUOTA_EXCEEDED' } })), (e: { code: string }) => e.code === 'LLM_QUOTA_EXCEEDED');
  });
});

/* ===================== 5. Inspector "Ask the tutor" ===================== */

describe('Inspector "Ask the tutor" requests', () => {
  it('every button phrase, for every part of both models, targets that part with the right question type', () => {
    for (const model of [gearbox, bridge]) {
      for (const id of model.getAllComponentIds()) {
        const name = model.getComponentMetadata(id)!.name;
        const w = makeWorkspace(model);
        for (const [phrase, type] of [[`explain the ${name}`, 'explain'], [`why is the ${name} needed`, 'purpose'],
          [`how does the ${name} work`, 'howWorks'], [`what happens if the ${name} fails`, 'failure']]) {
          const o = previewTurn({ transcript: phrase, dispatcher: w.dispatcher, model, allModels: ALL });
          assert.equal(o.kind, 'question', `${model.id}: "${phrase}" -> ${JSON.stringify(o)}`);
          if (o.kind === 'question') assert.deepEqual([o.partId, o.question], [id, type], phrase);
        }
      }
    }
  });

  it('"explain how this model works" is a whole-model question on both models', () => {
    for (const model of [gearbox, bridge]) {
      const o = previewTurn({ transcript: 'explain how this model works', dispatcher: makeWorkspace(model).dispatcher, model, allModels: ALL });
      assert.deepEqual(o.kind === 'question' && [o.question, o.partId], ['explain', undefined]);
    }
  });
});

describe('Fallback language honesty', () => {
  // Milestone A changed this behaviour on purpose: the model-data answer to a Telugu question is
  // now built in Telugu (it used to be English with an "it is in English" note). The honesty rule
  // still holds: the notice says where the answer comes from and never claims an English text is Telugu.
  it('a Telugu request answered from the model data is answered in Telugu, with a Telugu notice', async () => {
    const { ENGLISH_FALLBACK_NOTE } = await import('../src/services/teaching/teachingController');
    const w = selected('planet_carrier');
    const c = conversation(w);
    try {
      const p = c.controller.ask({ question: 'ఇది ఎందుకు అవసరం', questionType: 'purpose', targetComponentId: 'planet_carrier', language: 'te-IN' });
      c.requests[0].resolve(Promise.reject(Object.assign(new Error('quota'), { code: 'LLM_QUOTA_EXCEEDED' })));
      assert.equal(await p, 'fallback');
      assert.equal(c.controller.getState().notice, (await import('../src/services/teaching/teachingController')).FALLBACK_NOTICES.quota['te-IN'], 'quota: its own short notice');
      assert.ok(!c.controller.getState().notice!.includes(ENGLISH_FALLBACK_NOTE));
      const plan = c.player.getState().plan!;
      assert.equal(plan.language, 'te-IN');
      assert.ok(plan.steps.every((s) => /[ఀ-౿]/.test(s.narration)), 'every narration is Telugu');
    } finally { c.close(); }
  });
});

