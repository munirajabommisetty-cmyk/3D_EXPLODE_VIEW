/**
 * Audio-first streaming and application-aware teaching (milestone 29 Oct 2026, round 2).
 *
 * The LLM stream, Gnani Timbre and audio playback are SIMULATED (fakes, no network). The parser,
 * dispatcher, plan validation, player, live narration queue and fallback briefs are the real code.
 * Orderings below are mocked-pipeline results, never live latency.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelRegistry } from '../src/models/registry';
import { RC_FRAME_MODEL_ID } from '../src/models/civil/rcFrameModel';
import { getSceneSnapshot } from '../src/services/scene/sceneSnapshot';
import { handleVoiceTurn, type VoiceTurnResult } from '../src/services/voice/voiceSession';
import { splitSpeech } from '../src/services/voice/speechChunks';
import { createLiveClip, type AudioLike } from '../src/services/teaching/chunkedNarration';
import { TeachingPlanPlayer, type Narrator } from '../src/services/teaching/planPlayer';
import { FALLBACK_NOTICES, TeachingController } from '../src/services/teaching/teachingController';
import { TeachingServiceError, type TeachRequestBody, type TeachStreamEvent } from '../src/services/teaching/teachingClient';
import { getComponentRelationships } from '../src/services/scene/componentRelationships';
import { VoiceTimingLog, type TurnSummary } from '../src/services/voice/voiceTiming';
import { makeWorkspace } from './sceneContext.test';

const rc = modelRegistry.getModel(RC_FRAME_MODEL_ID)!;
const ALL = modelRegistry.getCatalogueModels();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type WS = ReturnType<typeof makeWorkspace>;

function turn(w: WS, transcript: string, language = 'en-IN'): VoiceTurnResult {
  const r = handleVoiceTurn({ transcript, language, dispatcher: w.dispatcher, model: w.ws.model, allModels: ALL, lastDiscussed: w.memory.last, teachingAvailable: true });
  if (r.discussedComponentId) w.memory.last = { modelId: w.ws.model.id, componentId: r.discussedComponentId };
  return r;
}
const ws = (select?: string) => {
  const w = makeWorkspace(rc);
  if (select) w.dispatcher.dispatch({ type: 'component.select', componentId: select }, 'ui');
  return w;
};

/* ------------------------------ fakes ------------------------------ */

function fakeAudio(log: string[], label: string, ms = 12): AudioLike {
  let ended = false;
  const a: AudioLike = {
    get ended() { return ended; },
    onended: null,
    onerror: null,
    play: () => {
      log.push(`PLAY:${label}`);
      setTimeout(() => { ended = true; log.push(`END:${label}`); a.onended?.(); }, ms);
      return Promise.resolve();
    },
    pause: () => {},
  };
  return a;
}

const label = (t: string) => t.split(' ').slice(0, 2).join(' ');

/** Real live narration queue with a fake Timbre (ttsMs per sentence) and fake audio. */
function liveNarrator(log: string[], opts: { ttsMs?: number; failText?: RegExp } = {}): Narrator {
  const deps = {
    synth: async (t: string, signal: AbortSignal) => {
      log.push(`TTS_START:${label(t)}`);
      await sleep(opts.ttsMs ?? 8);
      if (signal.aborted) throw new Error('stopped');
      if (opts.failText?.test(t)) throw new Error('Gnani speech synthesis timed out on Gnani\'s side (504).');
      log.push(`TTS_READY:${label(t)}`);
      return { label: label(t) } as unknown as Blob;
    },
    makeAudio: (b: Blob) => ({ audio: fakeAudio(log, (b as unknown as { label: string }).label), release: () => {} }),
    readingMs: () => 15, tickMs: 5,
  };
  return {
    prepare: (text) => { const c = createLiveClip(deps); c.push(text); c.close(); return c; },
    prepareLive: () => createLiveClip(deps),
  };
}

function setup(narrator: Narrator) {
  const w = makeWorkspace(rc);
  const loop = setInterval(() => w.tick(16), 4);
  loop.unref?.();
  const player = new TeachingPlanPlayer({ dispatcher: w.dispatcher, getSnapshot: () => getSceneSnapshot(w.dispatcher, w.ws.model), narrator, pollMs: 4, settleTimeoutMs: 300 });
  const streams: { body: TeachRequestBody; emit: (e: TeachStreamEvent) => void; end: () => void; fail: (e: Error) => void }[] = [];
  const controller = new TeachingController({
    dispatcher: w.dispatcher, player, getModel: () => w.ws.model, getLanguage: () => 'en-IN',
    requestPlan: () => Promise.reject(new Error('not used')),
    requestPlanStream: (body, signal, onEvent) => new Promise<void>((resolve, reject) => {
      streams.push({ body, emit: onEvent, end: resolve, fail: reject });
      signal.addEventListener('abort', () => reject(new TeachingServiceError('CANCELLED', 'Cancelled.')));
    }),
  });
  const until = async (cond: () => boolean, ms = 3000) => {
    const t0 = Date.now();
    while (!cond() && Date.now() - t0 < ms) await sleep(3);
    return cond();
  };
  return { w, player, controller, streams, until, close: () => { controller.cancel(); clearInterval(loop); } };
}

const partial = (i: number, target = 'slab') => ({
  index: i, kind: 'demonstrate', claim: 'engineering', targetComponentId: target,
  actions: [{ type: 'component.focus', componentId: target }], caption: `c${i}`, narration: '', waitFor: 'narration', holdMs: 0,
});
const full = (i: number, narration: string, target = 'slab') => ({ ...partial(i, target), narration });
const plan = (steps: ReturnType<typeof full>[]) => ({
  schemaVersion: 1, planId: '0123456789abcdef0123456789abcdef', modelId: rc.id, targetComponentId: 'slab',
  title: 'Without the slab', explanation: 'The floor would have nothing to carry its load.', cannotAnswer: null,
  steps, rejectedSteps: [], followUpSuggestions: [],
});
const ask = { question: 'What happens if there is no slab?', questionType: 'failure', targetComponentId: 'slab', language: 'en-IN' };

/* ============================== audio-first streaming ============================== */

describe('Audio-first: the first sentence is heard while the AI teacher is still writing', () => {
  it('LLM emits sentence 1 then WAITS: TTS starts and playback begins before the LLM completes; the rest follows in order', async () => {
    const log: string[] = [];
    const s = setup(liveNarrator(log));
    const result = s.controller.ask(ask);
    await s.until(() => s.streams.length === 1);
    const llm = s.streams[0];
    llm.emit({ type: 'token' });
    llm.emit({ type: 'stepStart', index: 0, step: partial(0) });
    llm.emit({ type: 'narration', index: 0, text: 'Without the slab, the floor load has nothing to rest on.' });
    // The mocked LLM deliberately does NOT finish: playback must not wait for it
    assert.ok(await s.until(() => log.some((l) => l.startsWith('PLAY:'))), 'first audio played while generation is still open');
    assert.equal(s.controller.getState().pending, false, 'not stuck in "thinking"');
    log.push('LLM_STILL_GENERATING');
    llm.emit({ type: 'narration', index: 0, text: 'The beams would no longer receive that load.' });
    llm.emit({ type: 'step', step: full(0, 'Without the slab, the floor load has nothing to rest on. The beams would no longer receive that load.') });
    llm.emit({ type: 'stepStart', index: 1, step: partial(1, 'beams') });
    llm.emit({ type: 'narration', index: 1, text: 'In a real building, never remove a slab without an engineer.' });
    llm.emit({ type: 'step', step: full(1, 'In a real building, never remove a slab without an engineer.', 'beams') });
    log.push('LLM_COMPLETED');
    llm.emit({ type: 'done', plan: plan([full(0, 'Without the slab, the floor load has nothing to rest on. The beams would no longer receive that load.'), full(1, 'In a real building, never remove a slab without an engineer.', 'beams')]) });
    llm.end();
    assert.equal(await result, 'started');
    assert.ok(await s.until(() => s.player.getState().status === 'finished'));
    const firstTts = log.findIndex((l) => l.startsWith('TTS_START:'));
    const firstPlay = log.findIndex((l) => l.startsWith('PLAY:'));
    const completed = log.indexOf('LLM_COMPLETED');
    assert.ok(firstTts < completed, 'TTS started before LLM completion');
    assert.ok(firstPlay < log.indexOf('LLM_STILL_GENERATING') && firstPlay < completed, 'playback began before LLM completion');
    assert.deepEqual(log.filter((l) => l.startsWith('PLAY:')), ['PLAY:Without the', 'PLAY:The beams', 'PLAY:In a'], 'in order, no duplicates');
    for (let i = 0; i < log.length; i++) if (log[i].startsWith('PLAY:')) assert.ok(log.slice(0, i).filter((l) => l.startsWith('PLAY:')).length === log.slice(0, i).filter((l) => l.startsWith('END:')).length, 'never two at once');
    assert.equal(s.player.getState().plan?.steps[0].narration.endsWith('receive that load.'), true, 'written answer complete');
    s.close();
  });

  it('a new question stops the old answer\'s audio; its late sentences are never played or mixed in', async () => {
    const log: string[] = [];
    const s = setup(liveNarrator(log, { ttsMs: 30 }));
    void s.controller.ask(ask);
    await s.until(() => s.streams.length === 1);
    s.streams[0].emit({ type: 'stepStart', index: 0, step: partial(0) });
    s.streams[0].emit({ type: 'narration', index: 0, text: 'Old answer first sentence is long enough.' });
    await s.until(() => log.some((l) => l.startsWith('TTS_START:Old answer')));
    const b = s.controller.ask({ ...ask, question: 'Why are columns needed?', questionType: 'purpose', targetComponentId: 'columns' });
    s.streams[0].emit({ type: 'narration', index: 0, text: 'Old answer second sentence arrives late.' });
    await s.until(() => s.streams.length === 2);
    s.streams[1].emit({ type: 'stepStart', index: 0, step: partial(0, 'columns') });
    s.streams[1].emit({ type: 'narration', index: 0, text: 'Columns carry the loads down to the footings.' });
    s.streams[1].emit({ type: 'step', step: full(0, 'Columns carry the loads down to the footings.', 'columns') });
    s.streams[1].emit({ type: 'done', plan: { ...plan([full(0, 'Columns carry the loads down to the footings.', 'columns')]), targetComponentId: 'columns' } });
    s.streams[1].end();
    assert.equal(await b, 'started');
    assert.ok(await s.until(() => s.player.getState().status === 'finished'));
    const played = log.filter((l) => l.startsWith('PLAY:'));
    assert.ok(!played.some((l) => l.includes('Old answer')), `old audio never played after the new question: ${played}`);
    assert.deepEqual(played, ['PLAY:Columns carry']);
    s.close();
  });

  it('a failed TTS sentence does not leave the tutor stuck; the next sentence still plays', async () => {
    const log: string[] = [];
    const s = setup(liveNarrator(log, { failText: /^Second/ }));
    void s.controller.ask(ask);
    await s.until(() => s.streams.length === 1);
    s.streams[0].emit({ type: 'stepStart', index: 0, step: partial(0) });
    for (const t of ['First sentence plays normally here.', 'Second sentence fails in Timbre.', 'Third sentence still plays fine.']) s.streams[0].emit({ type: 'narration', index: 0, text: t });
    s.streams[0].emit({ type: 'step', step: full(0, 'First sentence plays normally here. Second sentence fails in Timbre. Third sentence still plays fine.') });
    s.streams[0].emit({ type: 'done', plan: plan([full(0, 'First sentence plays normally here. Second sentence fails in Timbre. Third sentence still plays fine.')]) });
    s.streams[0].end();
    assert.ok(await s.until(() => s.player.getState().status === 'finished'), 'finished, not stuck');
    assert.equal(log.filter((l) => l === 'TTS_START:First sentence').length, 1, 'each sentence synthesized once (no duplicate audio)');
    assert.deepEqual(log.filter((l) => l.startsWith('PLAY:')), ['PLAY:First sentence', 'PLAY:Third sentence']);
    s.close();
  });

  it('the stream breaking mid-step keeps what was said, ends cleanly, and the next turn works', async () => {
    const log: string[] = [];
    const s = setup(liveNarrator(log));
    const a = s.controller.ask(ask);
    await s.until(() => s.streams.length === 1);
    s.streams[0].emit({ type: 'stepStart', index: 0, step: partial(0) });
    s.streams[0].emit({ type: 'narration', index: 0, text: 'Without the slab, the floor has no plate.' });
    s.streams[0].emit({ type: 'error', code: 'LLM_TIMEOUT', message: 'The teaching model stopped responding.' });
    s.streams[0].end();
    assert.equal(await a, 'started');
    assert.ok(await s.until(() => s.player.getState().status === 'finished'), 'the open live step was closed');
    assert.ok(log.includes('PLAY:Without the'));
    const b = s.controller.ask({ ...ask, question: 'And the beams?', targetComponentId: 'beams' });
    await s.until(() => s.streams.length === 2);
    s.streams[1].emit({ type: 'step', step: full(0, 'Beams carry the slab load to the columns.', 'beams') });
    s.streams[1].emit({ type: 'done', plan: { ...plan([full(0, 'Beams carry the slab load to the columns.', 'beams')]), targetComponentId: 'beams' } });
    s.streams[1].end();
    assert.equal(await b, 'started');
    s.close();
  });

  it('the timeline records the key check: first audio playback < LLM completion (mocked clock)', () => {
    let t = 0;
    const logged: TurnSummary[] = [];
    const log = new VoiceTimingLog({ clock: () => t, log: (x) => logged.push(x) });
    log.begin(9);
    log.mark('teachStart'); t = 420; log.mark('firstToken'); t = 900; log.mark('firstStep'); log.mark('ttsStart');
    t = 1500; log.mark('ttsFirstAudioReady'); t = 1520; log.mark('firstAudio'); t = 3800; log.mark('teachEnd'); t = 7000; log.mark('responseDone');
    assert.deepEqual(logged[0].timeline, {
      llmStartedAt: 0, firstTokenAt: 420, firstSpeakableChunkAt: 900, firstTtsStartedAt: 900, firstAudioReadyAt: 1500,
      firstAudioPlaybackStartedAt: 1520, llmCompletedAt: 3800, audioPlaybackCompletedAt: 7000, audioBeforeLlmCompleted: true,
    });
  });

  it('Hindi, Telugu and English sentence chunking keeps every character', () => {
    for (const text of [
      'अगर Slab न हो, तो फ़र्श का भार उठाने वाला हिस्सा नहीं रहेगा। Beams तक भार पहुँचाने का रास्ता भी नहीं बचेगा।',
      'స్లాబ్ లేకపోతే నేల మీద బరువును మోసే భాగం ఉండదు. Beams కి బరువు చేరదు.',
      'Without the slab, the floor load has nothing to rest on. The beams would carry nothing from it!',
      'a short answer without any punctuation at all',
    ]) {
      const chunks = splitSpeech(text, { minChars: 20 });
      assert.equal(chunks.join(' '), text);
      assert.ok(chunks.every((c) => c.trim() === c && c.length > 0));
    }
  });
});

/* ============================== what-if routing ============================== */

describe('What-if and absence questions are taught as consequences (never a selection)', () => {
  const cases: [string, string, string, string | null, string?][] = [
    // Hindi
    ['स्लैब नहीं तो क्या होता है?', 'hi-IN', 'failure', 'slab'],
    ['अगर स्लैब नहीं हो तो क्या होगा?', 'hi-IN', 'failure', 'slab'],
    ['इस स्लैब को हटा दें तो क्या होगा?', 'hi-IN', 'failure', 'slab'],
    ['कॉलम क्यों जरूरी है?', 'hi-IN', 'purpose', 'columns'],
    ['अगर कॉलम न हो तो क्या होगा?', 'hi-IN', 'failure', 'columns'],
    // Telugu
    ['స్లాబ్ లేకపోతే ఏమవుతుంది?', 'te-IN', 'failure', 'slab'],
    ['ఈ స్లాబ్ తీసేస్తే ఏమవుతుంది?', 'te-IN', 'failure', 'slab'],
    ['కాలమ్స్ లేకపోతే ఏమవుతుంది?', 'te-IN', 'failure', 'columns'],
    ['ఈ భాగం ఎందుకు అవసరం?', 'te-IN', 'purpose', 'beams', 'beams'],
    // English
    ['What happens if there is no slab?', 'en-IN', 'failure', 'slab'],
    ['What if we remove this component?', 'en-IN', 'failure', 'beams', 'beams'],
    ['Why is this component needed here?', 'en-IN', 'purpose', 'beams', 'beams'],
    ['What would fail without these columns?', 'en-IN', 'failure', 'columns'],
    ['Give me a real-world example of this slab.', 'en-IN', 'example', 'slab'],
  ];
  for (const [text, lang, qt, part, select] of cases) {
    it(`${text} -> ${qt} (${part})`, () => {
      const w = ws(select);
      const before = getSceneSnapshot(w.dispatcher, w.ws.model);
      const r = turn(w, text, lang);
      assert.equal(r.status, 'teach', `${JSON.stringify(r.outcome)} / ${r.caption}`);
      assert.deepEqual([r.teach!.questionType, r.teach!.targetComponentId], [qt, part]);
      assert.equal(r.teach!.question, text, 'the learner\'s words go to the teacher unchanged');
      assert.equal(r.records.length, 0, 'no scene action (no select, no hide)');
      assert.deepEqual(getSceneSnapshot(w.dispatcher, w.ws.model).hiddenComponentIds, before.hiddenComponentIds);
    });
  }

  it('comparisons are taught about both parts', () => {
    for (const [text, lang] of [['बीम और स्लैब में क्या अंतर है?', 'hi-IN'], ['బీమ్ మరియు స్లాబ్ మధ్య తేడా ఏమిటి?', 'te-IN']]) {
      const r = turn(ws(), text, lang);
      assert.equal(r.status, 'teach', text);
      assert.ok(r.outcome.kind === 'question' && (r.outcome.mentionedIds ?? []).includes('slab') && (r.outcome.mentionedIds ?? []).includes('beams'), text);
    }
  });

  it('a follow-up what-if uses the current topic', () => {
    const w = ws();
    turn(w, 'Explain the slab.');
    const r = turn(w, 'What if it is removed?');
    assert.deepEqual([r.teach?.questionType, r.teach?.targetComponentId], ['failure', 'slab']);
    const hi = turn(w, 'अगर यह न हो तो क्या होगा?', 'hi-IN');
    assert.deepEqual([hi.teach?.questionType, hi.teach?.targetComponentId], ['failure', 'slab']);
  });

  it('regressions: commands still run, negations still do not', () => {
    const w = ws();
    assert.equal(turn(w, 'Select the slab.').status, 'executed');
    assert.equal(getSceneSnapshot(w.dispatcher, w.ws.model).selectedComponentId, 'slab');
    assert.equal(turn(w, 'Zoom in.').status, 'executed');
    assert.equal(turn(w, "Don't zoom in.").outcome.kind, 'declined');
    assert.equal(turn(w, 'Hide the slab.').status, 'executed', '"hide" is still a command when it is not a what-if');
  });
});

/* ============================== fallback answers ============================== */

describe('When the AI teacher is unavailable, what-if questions still get a consequence answer', () => {
  const fallback = async (lang: string, question: string, code = 'LLM_QUOTA_EXCEEDED') => {
    const s = setup(liveNarrator([]));
    const p = s.controller.ask({ question, questionType: 'failure', targetComponentId: 'slab', language: lang });
    await s.until(() => s.streams.length === 1);
    s.streams[0].fail(new TeachingServiceError(code, 'x'));
    assert.equal(await p, 'fallback');
    const state = s.player.getState();
    const out = { plan: state.plan!, notice: s.controller.getState().notice, pending: s.controller.getState().pending };
    s.close();
    return out;
  };

  it('Hindi: consequence first, in Hindi, with only recorded links and a real-world caution; short quota notice', async () => {
    const { plan: p, notice, pending } = await fallback('hi-IN', 'स्लैब नहीं तो क्या होता है?');
    assert.equal(pending, false);
    assert.equal(p.language, 'hi-IN');
    assert.match(p.steps[0].narration, /^अगर Slab न हो, तो उसका काम नहीं होगा/);
    assert.doesNotMatch(p.steps[0].narration, /इस model का एक हिस्सा है/, 'not the definition-only answer');
    const text = p.steps.map((st) => st.narration).join(' ');
    assert.match(text, /engineer की जाँच के बिना हटाना खतरनाक/);
    assert.match(text, /simulate नहीं/);
    const linked = getComponentRelationships(rc, 'slab').map((r) => rc.getComponentMetadata(r.targetComponentId)!.name);
    for (const name of rc.getAllComponentIds().map((id) => rc.getComponentMetadata(id)!.name)) {
      if (name !== 'Slab' && p.steps[1]?.narration.includes(name)) assert.ok(linked.includes(name), `${name} is a recorded link of the slab`);
    }
    assert.equal(notice, FALLBACK_NOTICES.quota['hi-IN']);
  });

  it('Telugu and English: consequence first in the question\'s language; the notice names the real cause', async () => {
    const te = await fallback('te-IN', 'స్లాబ్ లేకపోతే ఏమవుతుంది?', 'TIMEOUT');
    assert.match(te.plan.steps[0].narration, /^Slab లేకపోతే, దాని పని జరగదు/);
    assert.equal(te.notice, FALLBACK_NOTICES.timeout['te-IN']);
    const en = await fallback('en-IN', 'What happens if there is no slab?', 'BACKEND_UNAVAILABLE');
    assert.match(en.plan.steps[0].narration, /^Without the Slab, its job would not be done/);
    assert.match(en.plan.steps.map((st) => st.narration).join(' '), /engineer's assessment/);
    assert.equal(en.notice, FALLBACK_NOTICES.offline['en-IN']);
    assert.ok(en.notice!.length < 120, 'a concise status, not an error dump');
  });
});

describe('Mocked timeline (not live): sentence 1 at 150 ms, answer complete at 1200 ms, TTS 60 ms', () => {
  it('first audio plays long before the LLM completes', async () => {
    const log: string[] = [];
    const t0 = Date.now();
    const at: Record<string, number> = {};
    const mark = (k: string) => { at[k] ??= Date.now() - t0; };
    const narrator = liveNarrator(log, { ttsMs: 60 });
    const wrapped: Narrator = {
      prepare: narrator.prepare,
      prepareLive: (l) => {
        const c = narrator.prepareLive!(l);
        return { ...c, push: (t: string) => { mark('firstTtsStartedAt'); c.push(t); }, close: c.close, play: c.play, pause: c.pause, resume: c.resume, stop: c.stop, done: c.done.then((v) => { mark('audioPlaybackCompletedAt'); return v; }) };
      },
    };
    const s = setup(wrapped);
    void s.controller.ask(ask);
    await s.until(() => s.streams.length === 1);
    mark('llmStartedAt');
    const llm = s.streams[0];
    await sleep(150);
    llm.emit({ type: 'stepStart', index: 0, step: partial(0) });
    llm.emit({ type: 'narration', index: 0, text: 'Without the slab, the floor load has nothing to rest on.' });
    mark('firstSpeakableChunkAt');
    const watch = setInterval(() => { if (log.some((l) => l.startsWith('PLAY:'))) mark('firstAudioPlaybackStartedAt'); }, 2);
    await sleep(500);
    llm.emit({ type: 'narration', index: 0, text: 'The beams would then receive no load from it.' });
    llm.emit({ type: 'step', step: full(0, 'Without the slab, the floor load has nothing to rest on. The beams would then receive no load from it.') });
    await sleep(550);
    llm.emit({ type: 'done', plan: plan([full(0, 'Without the slab, the floor load has nothing to rest on. The beams would then receive no load from it.')]) });
    llm.end();
    mark('llmCompletedAt');
    await s.until(() => s.player.getState().status === 'finished');
    clearInterval(watch);
    console.log('[mocked timeline ms]', JSON.stringify(at));
    assert.ok(at.firstAudioPlaybackStartedAt < at.llmCompletedAt, 'firstAudioPlaybackStartedAt < llmCompletedAt');
    assert.ok(at.firstTtsStartedAt < at.llmCompletedAt);
    s.close();
  });
});
