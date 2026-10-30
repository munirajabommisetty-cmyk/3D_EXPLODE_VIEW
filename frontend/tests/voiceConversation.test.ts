/**
 * Voice latency, Telugu understanding and natural conversation (milestone 29 Oct 2026).
 *
 * LLM, Gnani Prisma and Gnani Timbre are SIMULATED (fakes, no network). The parser, reference
 * resolver, dispatcher, plan validation, plan player, chunked narration queue and stream reader
 * are the real code. Timings here are mocked-pipeline orderings, never live latency numbers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import { RC_FRAME_MODEL_ID } from '../src/models/civil/rcFrameModel';
import { STEAM_ENGINE_MODEL_ID } from '../src/models/mechanical/steamEngineModel';
import { getSceneSnapshot } from '../src/services/scene/sceneSnapshot';
import { handleVoiceTurn, type VoiceTurnResult } from '../src/services/voice/voiceSession';
import { detectSmallTalk } from '../src/services/voice/phraseParser';
import { splitSpeech, speakableText } from '../src/services/voice/speechChunks';
import { createChunkedClip, type AudioLike } from '../src/services/teaching/chunkedNarration';
import { TeachingPlanPlayer, type NarrationClip, type Narrator } from '../src/services/teaching/planPlayer';
import { PARTIAL_ANSWER_NOTICE, TeachingController } from '../src/services/teaching/teachingController';
import { streamTeachingPlan, TeachingServiceError, type TeachRequestBody, type TeachStreamEvent } from '../src/services/teaching/teachingClient';
import { synthesize, TRANSIENT_VOICE_ERRORS, VoiceServiceError } from '../src/services/voice/voiceClient';
import { VoiceTimingLog, type TurnSummary } from '../src/services/voice/voiceTiming';
import { makeWorkspace } from './sceneContext.test';

const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
const rc = modelRegistry.getModel(RC_FRAME_MODEL_ID)!;
const steam = modelRegistry.getModel(STEAM_ENGINE_MODEL_ID)!;
const ALL = modelRegistry.getCatalogueModels();
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
const ws = (model = rc, select?: string) => {
  const w = makeWorkspace(model);
  if (select) w.dispatcher.dispatch({ type: 'component.select', componentId: select }, 'ui');
  return w;
};
const kindOf = (r: VoiceTurnResult) => r.outcome.kind;
const teachOf = (r: VoiceTurnResult) => r.teach;
const selectedId = (w: WS) => getSceneSnapshot(w.dispatcher, w.ws.model).selectedComponentId;

/* ============================== intent routing ============================== */

describe('Intent routing: meaning decides, a part name alone does not select', () => {
  it('explicit scene commands still work', () => {
    const w = ws();
    const sel = turn(w, 'Select the slab.');
    assert.equal(sel.status, 'executed');
    assert.equal(selectedId(w), 'slab');
    const show = turn(w, 'Show me the slab.');
    assert.equal(show.status, 'executed');
    assert.ok(show.outcome.kind === 'commands' && show.outcome.intent === 'focus', 'existing "show me" = focus semantics');
    assert.equal(turn(w, 'zoom in').status, 'executed');
  });

  it('educational questions about a part teach and never select it', () => {
    const cases: [string, string, string][] = [
      ['Explain the slab.', 'explain', 'slab'],
      ['why the slab is used here', 'purpose', 'slab'],
      ['Why is the slab used here?', 'purpose', 'slab'],
      ['can i get any real world examples of the slab', 'example', 'slab'],
      ['Can you give me real-world examples of a slab?', 'example', 'slab'],
      ['Why do buildings need columns?', 'purpose', 'columns'],
    ];
    for (const [text, qt, part] of cases) {
      const w = ws();
      const r = turn(w, text);
      assert.equal(r.status, 'teach', `${text}: ${JSON.stringify(r.outcome)}`);
      assert.deepEqual([teachOf(r)!.questionType, teachOf(r)!.targetComponentId], [qt, part], text);
      assert.equal(teachOf(r)!.question, text.trim(), 'the learner\'s exact words go to the teacher');
      assert.equal(r.records.length, 0, `${text}: nothing dispatched`);
      assert.equal(selectedId(w), null, `${text}: "${part}" was not selected`);
    }
  });

  it('a part name inside a longer sentence without a command verb is a question, not a selection', () => {
    const w = ws();
    const r = turn(w, 'the slab in a real house is usually how thick');
    assert.equal(r.status, 'teach');
    assert.equal(selectedId(w), null);
    assert.equal(turn(ws(), 'the slab please').status, 'executed', 'a bare part name still selects it');
  });

  it('follow-ups use the conversation context; with no context they continue the conversation', () => {
    const w = ws();
    turn(w, 'Explain the slab.');
    const more = turn(w, 'Tell me more about it.');
    assert.equal(more.status, 'teach');
    assert.deepEqual([teachOf(more)!.questionType, teachOf(more)!.targetComponentId], ['explain', 'slab']);
    const why = turn(w, 'Why is it used here?');
    assert.equal(teachOf(why)!.targetComponentId, 'slab', '"it" = the slab just discussed');
    const fresh = turn(ws(), 'Tell me more');
    assert.equal(fresh.status, 'teach', 'the teacher has the history');
    assert.equal(teachOf(fresh)!.targetComponentId, null);
  });

  it('a genuinely ambiguous reference asks a short clarification (no guess)', () => {
    const r = turn(ws(), 'Why is it used here?');
    assert.equal(r.status, 'needsInput');
    const te = turn(ws(), 'ఇది ఎలా పని చేస్తుంది?', 'te-IN');
    assert.equal(te.status, 'needsInput');
    assert.match(te.caption, /[ఀ-౿]/, 'clarification in Telugu');
  });

  it('greetings and small talk get a short natural reply in the user\'s language, no action', () => {
    const w = ws();
    const hi = turn(w, 'hey hi my name is raja how are you');
    assert.equal(hi.status, 'answered');
    assert.equal(kindOf(hi), 'smallTalk');
    assert.match(hi.caption, /Hi Raja/);
    assert.match(hi.caption, /doing well/);
    assert.match(hi.caption, /explain/);
    assert.equal(hi.records.length, 0);
    assert.equal(turn(w, 'Thank you.').caption, "You're welcome!");
    assert.equal(turn(w, 'My name is Raja.').status, 'answered');
    const te = turn(w, 'హాయ్, నా పేరు రాజా. ఎలా ఉన్నారు?', 'te-IN');
    assert.equal(kindOf(te), 'smallTalk');
    assert.match(te.caption, /రాజా/);
    assert.match(te.caption, /బాగున్నాను/);
    assert.equal(turn(w, 'ধন্যবাদ', 'bn-IN').caption, 'স্বাগতম!');
    assert.equal(turn(w, 'धन्यवाद', 'hi-IN').caption, 'आपका स्वागत है!');
  });

  it('a greeting in front of a real request runs the request', () => {
    const w = ws();
    const r = turn(w, 'Hi, zoom in please');
    assert.equal(r.status, 'executed');
    assert.ok(r.outcome.kind === 'commands' && r.outcome.intent === 'zoom');
    assert.deepEqual(detectSmallTalk('hello how does the slab work').acts, ['greeting']);
  });

  it('negated commands are never executed', () => {
    for (const [text, lang] of [["Don't zoom in.", 'en-IN'], ['do not explode the model', 'en-IN'], ['please dont rotate left', 'en-IN'],
      ['జూమ్ ఇన్ చేయొద్దు', 'te-IN'], ['ज़ूम इन मत करो', 'hi-IN']] as const) {
      const w = ws();
      const before = getSceneSnapshot(w.dispatcher, w.ws.model);
      const r = turn(w, text, lang);
      assert.equal(kindOf(r), 'declined', text);
      assert.equal(r.records.length, 0, `${text}: nothing dispatched`);
      assert.equal(getSceneSnapshot(w.dispatcher, w.ws.model).exploded.factor, before.exploded.factor);
    }
  });

  it('unsupported requests do not crash and do not act', () => {
    const r = turn(ws(), 'book me a bus ticket for tomorrow');
    assert.equal(r.status, 'rejected');
    assert.equal(r.records.length, 0);
  });
});

/* ============================== Telugu and mixed language ============================== */

describe('Telugu and mixed-language questions reach the teacher with the transcript intact', () => {
  const teach = (model: typeof rc, text: string, lang = 'te-IN', select?: string) => {
    const w = ws(model, select);
    const r = turn(w, text, lang);
    assert.equal(r.status, 'teach', `${text}: ${JSON.stringify(r.outcome)} / ${r.caption}`);
    assert.equal(teachOf(r)!.question, text.trim(), 'transcript preserved exactly');
    assert.equal(r.records.filter((x) => x.command.type === 'component.select').length, 0, `${text}: not a selection`);
    return teachOf(r)!;
  };

  it('the questions that were rejected in testing are now taught', () => {
    // "Look, why do we use columns" — was "Sorry, I didn't understand"
    const cols = teach(rc, 'చూడు కాలమ్స్ ఎందుకు యూస్ చేస్తాము');
    assert.equal(cols.questionType, 'purpose');
    teach(rc, 'కాలమ్స్ ఎందుకు యూస్ చేస్తాము?');
    // Misrecognised "primary drive shaft" (Prisma: "డ్రిఫ్ ... షాఫ్")
    const shaft = teach(gearbox, 'ప్రైమరీ డ్రిఫ్ డ్రైవ్ షాఫ్ ఎందుకు యూస్ చేస్తాము');
    assert.equal(shaft.questionType, 'purpose');
  });

  it('natural Telugu with English technical terms resolves the part and the question type', () => {
    const cases: [typeof rc, string, string, string | null, string?][] = [
      [rc, 'ఈ column ఎందుకు అవసరం?', 'purpose', 'columns'],
      [rc, 'ఈ slab పని ఏమిటి?', 'purpose', 'slab'],
      [rc, 'ఈ slab ఎందుకు ఉపయోగిస్తారు?', 'purpose', 'slab'],
      [rc, 'ఇది ఎలా పని చేస్తుంది?', 'howWorks', 'beams', 'beams'],
      [rc, 'ఒక real-world example చెప్పు.', 'example', 'slab', 'slab'],
      [rc, 'ఇది మరియు beam మధ్య తేడా ఏమిటి?', 'explain', 'beams', 'slab'],
      [gearbox, 'Primary Drive Shaft ఎందుకు ఉపయోగిస్తాము?', 'purpose', 'central_shaft'],
      [gearbox, 'Sun Gear పని ఏమిటి?', 'purpose', 'sun_gear'],
    ];
    for (const [model, text, qt, part, select] of cases) {
      const t = teach(model, text, 'te-IN', select);
      assert.deepEqual([t.questionType, t.targetComponentId], [qt, part], text);
    }
  });

  it('"explain it more simply" continues the topic', () => {
    const w = ws(rc);
    turn(w, 'ఈ slab పని ఏమిటి?', 'te-IN');
    const r = turn(w, 'ఇంకా సింపుల్‌గా చెప్పు.', 'te-IN');
    assert.equal(r.status, 'teach');
    assert.equal(teachOf(r)!.targetComponentId, 'slab');
  });

  it('"show the connected parts" stays a validated scene command', () => {
    const w = ws(gearbox, 'sun_gear');
    const r = turn(w, 'దీనికి connected parts చూపించు.', 'te-IN');
    assert.equal(r.status, 'executed');
    assert.ok(r.outcome.kind === 'commands' && r.outcome.intent === 'related');
  });

  it('code-switched questions', () => {
    assert.deepEqual([teach(rc, 'Why do we use columns ఇక్కడ?', 'en-IN').targetComponentId], ['columns']);
    const slab = teach(rc, 'ఈ slab load ని ఎలా distribute చేస్తుంది?');
    assert.deepEqual([slab.questionType, slab.targetComponentId], ['howWorks', 'slab']);
    const te = teach(rc, 'Explain this component తెలుగులో.', 'en-IN', 'columns');
    assert.deepEqual([te.targetComponentId, te.language], ['columns', 'te-IN'], 'answer language follows the request');
    const rod = teach(steam, 'Connecting rod ఎలా work చేస్తుంది?');
    assert.deepEqual([rod.questionType, rod.targetComponentId], ['howWorks', 'connecting_rod']);
  });

  it('regressions: English, Hindi and Bengali commands and questions', () => {
    assert.equal(turn(ws(), 'zoom in').status, 'executed');
    assert.equal(turn(ws(), 'ज़ूम इन करो', 'hi-IN').status, 'executed');
    assert.equal(turn(ws(), 'জুম ইন করো', 'bn-IN').status, 'executed');
    assert.equal(turn(ws(gearbox), 'सन गियर क्यों जरूरी है', 'hi-IN').status, 'teach');
    assert.equal(turn(ws(gearbox), 'সান গিয়ার কেন দরকার', 'bn-IN').status, 'teach');
  });
});

/* ============================== speech chunking ============================== */

describe('Sentence-aware speech chunks', () => {
  it('splits at sentence ends, keeps the first chunk short, never breaks a word, keeps Telugu intact', () => {
    const text = 'Columns అనేవి slab, beams నుంచి వచ్చే loads ను foundation వరకు తీసుకెళ్తాయి. ఒక table కాళ్లు బరువును support చేసినట్టు. అయితే load transfer అనేది అన్ని భాగాలు కలిసి పనిచేయడం ద్వారా జరుగుతుంది!';
    const chunks = splitSpeech(text, { maxChars: 120 });
    assert.ok(chunks.length >= 2);
    assert.equal(chunks.join(' '), text, 'nothing lost, nothing repeated, words intact');
    for (const c of chunks) assert.ok(c.length <= 120);
    assert.ok(chunks[0].endsWith('.'), 'first chunk is a complete sentence');
    for (const c of chunks) assert.equal(c.normalize('NFC'), c);
  });

  it('long sentences break at clauses, then at spaces; short sentences are merged', () => {
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    for (const c of splitSpeech(long, { maxChars: 60 })) assert.ok(c.length <= 60 && !c.startsWith(' '));
    assert.deepEqual(splitSpeech('Yes. It is. The slab carries the floor load to the beams.', { minChars: 30, firstMinChars: 8 }), ['Yes. It is.', 'The slab carries the floor load to the beams.']);
  });

  it('markdown and formatting are never spoken', () => {
    assert.equal(speakableText('## Slab\n- **Carries** the `load`.\n1. Then _beams_.'), 'Slab Carries the load. Then beams.');
    assert.deepEqual(splitSpeech('   '), []);
  });
});

/* ============================== chunked narration queue ============================== */

function fakeAudio(log: string[], label: string, ms = 15, failPlay = false) {
  let ended = false;
  const a: AudioLike & { endNow: () => void } = {
    get ended() { return ended; },
    onended: null,
    onerror: null,
    play: () => {
      if (failPlay) return Promise.reject(new Error('blocked'));
      log.push(`play:${label}`);
      setTimeout(() => a.endNow(), ms);
      return Promise.resolve();
    },
    pause: () => log.push(`pause:${label}`),
    endNow: () => {
      if (ended) return;
      ended = true;
      log.push(`end:${label}`);
      a.onended?.();
    },
  };
  return a;
}

describe('Chunked narration: first sentence audible while the rest is still synthesized', () => {
  it('plays chunk 1 before chunk 2 is synthesized, keeps order, releases every clip', async () => {
    const log: string[] = [];
    const gates: ((b: Blob) => void)[] = [];
    let released = 0;
    const clip = createChunkedClip('First sentence is here. Second sentence follows now. Third one ends it.', {
      synth: (t) => new Promise<Blob>((res) => { log.push(`synth:${t.split(' ')[0]}`); gates.push(res); }),
      makeAudio: (b) => ({ audio: fakeAudio(log, (b as unknown as { label: string }).label), release: () => released++ }),
      chunking: { minChars: 10 },
    });
    assert.equal(clip.chunks.length, 3);
    clip.play();
    await sleep(5);
    gates[0]({ label: 'one' } as unknown as Blob);
    await sleep(5);
    assert.ok(log.includes('play:one'), 'chunk 1 plays');
    assert.equal(log.filter((l) => l.startsWith('synth')).length, 2, 'chunk 2 is being synthesized while chunk 1 plays');
    gates[1]({ label: 'two' } as unknown as Blob);
    await sleep(30);
    gates[2]({ label: 'three' } as unknown as Blob);
    assert.equal(await clip.done, 'ended');
    assert.deepEqual(log.filter((l) => l.startsWith('play')), ['play:one', 'play:two', 'play:three']);
    assert.ok(log.indexOf('end:one') < log.indexOf('play:two') && log.indexOf('end:two') < log.indexOf('play:three'), 'never two at once');
    assert.equal(released, 3);
  });

  it('a failed chunk becomes a short reading pause; the rest still plays', async () => {
    const log: string[] = [];
    const errors: string[] = [];
    let n = 0;
    const clip = createChunkedClip('One is first. Two will fail here. Three still plays.', {
      synth: async () => { n++; if (n === 2) throw new Error('Gnani speech synthesis timed out on Gnani\'s side (504).'); return { label: `c${n}` } as unknown as Blob; },
      makeAudio: (b) => ({ audio: fakeAudio(log, (b as unknown as { label: string }).label, 5), release: () => {} }),
      onError: (m) => errors.push(m), readingMs: () => 20, tickMs: 5, chunking: { minChars: 10 },
    });
    clip.play();
    assert.equal(await clip.done, 'failed');
    assert.deepEqual(log.filter((l) => l.startsWith('play')), ['play:c1', 'play:c3']);
    assert.match(errors[0], /504/);
  });

  it('stop() ends at once: no further chunk plays, pending synthesis is aborted', async () => {
    const log: string[] = [];
    const signals: AbortSignal[] = [];
    const clip = createChunkedClip('Alpha sentence one. Beta sentence two.', {
      synth: (t, signal) => { signals.push(signal); return Promise.resolve({ label: t.slice(0, 4) } as unknown as Blob); },
      makeAudio: (b) => ({ audio: fakeAudio(log, (b as unknown as { label: string }).label, 1000), release: () => log.push('release') }),
    });
    clip.play();
    await sleep(10);
    clip.stop();
    assert.equal(await clip.done, 'stopped');
    await sleep(20);
    assert.deepEqual(log.filter((l) => l.startsWith('play')), ['play:Alph']);
    assert.ok(signals[0].aborted && log.includes('release'));
  });
});

/* ============================== streamed plans ============================== */

const step = (i: number, target = 'sun_gear', narration = `${target} step ${i}.`) => ({
  index: i, kind: 'demonstrate', claim: 'metadata', narration, caption: `c${i}`, targetComponentId: target,
  actions: [{ type: 'component.focus', componentId: target }], waitFor: 'narration', holdMs: 0,
});
const fullPlan = (n: number, target = 'sun_gear') => ({
  schemaVersion: 1, planId: 'abcdef0123456789abcdef0123456789', modelId: 'planetary_gearbox', targetComponentId: target,
  title: 'Sun gear', explanation: 'The sun gear is the input.', cannotAnswer: null,
  steps: Array.from({ length: n }, (_, i) => step(i, target)), rejectedSteps: [], followUpSuggestions: [],
});

function streamingSetup(narrator?: Narrator) {
  const w = makeWorkspace(gearbox);
  const loop = setInterval(() => w.tick(16), 4);
  loop.unref?.();
  const spoken: string[] = [];
  const clips: { stopped: boolean }[] = [];
  const defaultNarrator: Narrator = {
    prepare(text: string): NarrationClip {
      const rec = { stopped: false };
      clips.push(rec);
      let resolve!: (v: 'ended' | 'failed' | 'stopped') => void;
      const done = new Promise<'ended' | 'failed' | 'stopped'>((r) => (resolve = r));
      return {
        done,
        play() { spoken.push(text); setTimeout(() => resolve('ended'), 30); },
        pause() {}, resume() {},
        stop() { rec.stopped = true; resolve('stopped'); },
      };
    },
  };
  const player = new TeachingPlanPlayer({ dispatcher: w.dispatcher, getSnapshot: () => getSceneSnapshot(w.dispatcher, w.ws.model), narrator: narrator ?? defaultNarrator, pollMs: 4, settleTimeoutMs: 400 });
  const streams: { body: TeachRequestBody; emit: (e: TeachStreamEvent) => void; end: () => void; fail: (e: Error) => void }[] = [];
  let planCalls = 0;
  const controller = new TeachingController({
    dispatcher: w.dispatcher, player, getModel: () => w.ws.model, getLanguage: () => 'en-IN',
    requestPlan: () => { planCalls++; return Promise.reject(new Error('not used')); },
    requestPlanStream: (body, signal, onEvent) => new Promise<void>((resolve, reject) => {
      streams.push({ body, emit: onEvent, end: resolve, fail: reject });
      signal.addEventListener('abort', () => reject(new TeachingServiceError('CANCELLED', 'Cancelled.')));
    }),
  });
  const until = async (cond: () => boolean, ms = 3000) => {
    const t0 = Date.now();
    while (!cond() && Date.now() - t0 < ms) await sleep(4);
    return cond();
  };
  const close = () => { controller.cancel(); clearInterval(loop); };
  return { w, player, controller, streams, spoken, clips, until, close, planCalls: () => planCalls };
}

const ask = { question: 'Why is the sun gear used?', questionType: 'purpose', targetComponentId: 'sun_gear', language: 'en-IN' };

describe('Streaming: speech starts before the model has finished the answer', () => {
  it('step 1 is spoken while the stream is still open; later steps follow in order', async () => {
    const s = streamingSetup();
    const result = s.controller.ask(ask);
    await s.until(() => s.streams.length === 1);
    s.streams[0].emit({ type: 'step', step: step(0) });
    assert.ok(await s.until(() => s.spoken.length === 1), 'narration of step 1 started');
    assert.equal(s.controller.getState().pending, false, 'no longer "thinking"');
    assert.equal(s.player.getState().status, 'running', 'stream still open, more steps expected');
    s.streams[0].emit({ type: 'step', step: step(1) });
    s.streams[0].emit({ type: 'step', step: step(2) });
    s.streams[0].emit({ type: 'done', plan: fullPlan(3) });
    s.streams[0].end();
    assert.equal(await result, 'started');
    assert.ok(await s.until(() => s.player.getState().status === 'finished'));
    assert.deepEqual(s.spoken, ['sun_gear step 0.', 'sun_gear step 1.', 'sun_gear step 2.']);
    assert.equal(s.player.getState().plan?.title, 'Sun gear', 'final details applied');
    s.close();
  });

  it('with the real chunked narrator, the first audio PLAYS before the answer is complete', async () => {
    const log: string[] = [];
    const narrator: Narrator = {
      prepare: (text) => createChunkedClip(text, {
        synth: async (t) => { log.push(`tts:${t.slice(0, 12)}`); await sleep(5); return { label: t.slice(0, 12) } as unknown as Blob; },
        makeAudio: (b) => ({ audio: fakeAudio(log, (b as unknown as { label: string }).label, 10), release: () => {} }),
        onFirstAudioPlayed: () => log.push('FIRST_AUDIO'),
      }),
    };
    const s = streamingSetup(narrator);
    void s.controller.ask(ask);
    await s.until(() => s.streams.length === 1);
    s.streams[0].emit({ type: 'step', step: step(0, 'sun_gear', 'The sun gear is the input. It turns the planets.') });
    assert.ok(await s.until(() => log.includes('FIRST_AUDIO')), 'first chunk audible');
    log.push('LLM_DONE');
    s.streams[0].emit({ type: 'done', plan: { ...fullPlan(1), steps: [step(0, 'sun_gear', 'The sun gear is the input. It turns the planets.')] } });
    s.streams[0].end();
    assert.ok(log.indexOf('FIRST_AUDIO') < log.indexOf('LLM_DONE'), 'audio before the complete answer');
    assert.ok(log.indexOf('tts:The sun gear') >= 0);
    s.close();
  });

  it('LLM failure before any step: model-data answer, UI leaves "thinking", no retry storm', async () => {
    const s = streamingSetup();
    const result = s.controller.ask(ask);
    await s.until(() => s.streams.length === 1);
    s.streams[0].fail(new TeachingServiceError('TIMEOUT', 'The explanation took too long. Please try again.'));
    assert.equal(await result, 'fallback');
    assert.equal(s.controller.getState().pending, false);
    assert.equal(s.streams.length, 1);
    assert.equal(s.planCalls(), 0, 'no second AI request');
    s.close();
  });

  it('a simulated 504 after step 1 keeps what was said, adds a short notice, and the next turn works', async () => {
    const s = streamingSetup();
    const first = s.controller.ask(ask);
    await s.until(() => s.streams.length === 1);
    s.streams[0].emit({ type: 'step', step: step(0) });
    s.streams[0].emit({ type: 'error', code: 'LLM_TIMEOUT', message: 'The teaching model\'s gateway timed out (504).' });
    s.streams[0].end();
    assert.equal(await first, 'started');
    assert.equal(s.controller.getState().notice, PARTIAL_ANSWER_NOTICE['en-IN']);
    assert.ok(await s.until(() => s.player.getState().status === 'finished'), 'the partial answer finishes cleanly');
    assert.deepEqual(s.spoken, ['sun_gear step 0.']);
    // next turn
    const second = s.controller.ask({ ...ask, targetComponentId: 'ring_gear', question: 'And the ring gear?' });
    await s.until(() => s.streams.length === 2);
    s.streams[1].emit({ type: 'step', step: step(0, 'ring_gear') });
    s.streams[1].emit({ type: 'done', plan: fullPlan(1, 'ring_gear') });
    s.streams[1].end();
    assert.equal(await second, 'started');
    assert.ok(await s.until(() => s.spoken.includes('ring_gear step 0.')));
    s.close();
  });

  it('a new question cancels the old stream; late steps of the old answer are never played or mixed', async () => {
    const s = streamingSetup();
    const a = s.controller.ask(ask);
    await s.until(() => s.streams.length === 1);
    s.streams[0].emit({ type: 'step', step: step(0) });
    await s.until(() => s.spoken.length === 1);
    const b = s.controller.ask({ ...ask, targetComponentId: 'ring_gear', question: 'What about the ring gear?' });
    assert.equal(await a, 'stale', 'old request aborted');
    assert.ok(s.clips[0].stopped, 'old narration stopped');
    s.streams[0].emit({ type: 'step', step: step(1) }); // arrives late
    await s.until(() => s.streams.length === 2);
    s.streams[1].emit({ type: 'step', step: step(0, 'ring_gear') });
    s.streams[1].emit({ type: 'done', plan: fullPlan(1, 'ring_gear') });
    s.streams[1].end();
    assert.equal(await b, 'started');
    assert.ok(await s.until(() => s.player.getState().status === 'finished'));
    assert.deepEqual(s.spoken, ['sun_gear step 0.', 'ring_gear step 0.'], 'no step of the old answer after the new one');
    s.close();
  });

  it('TTS failure does not discard the written answer', async () => {
    const narrator: Narrator = {
      prepare: (text) => createChunkedClip(text, {
        synth: async () => { throw new Error('Gnani speech synthesis timed out on Gnani\'s side (504).'); },
        makeAudio: () => { throw new Error('never'); }, readingMs: () => 10, tickMs: 5,
      }),
    };
    const s = streamingSetup(narrator);
    void s.controller.ask(ask);
    await s.until(() => s.streams.length === 1);
    s.streams[0].emit({ type: 'step', step: step(0) });
    s.streams[0].emit({ type: 'step', step: step(1) });
    s.streams[0].emit({ type: 'done', plan: fullPlan(2) });
    s.streams[0].end();
    assert.ok(await s.until(() => s.player.getState().status === 'finished'));
    assert.equal(s.player.getState().plan?.steps.length, 2, 'every step (caption + narration text) kept');
    assert.equal(s.player.getState().plan?.explanation, 'The sun gear is the input.');
    s.close();
  });
});

/* ============================== stream reader ============================== */

function ndjsonResponse(lines: object[], splitEvery = 7): Response {
  const bytes = new TextEncoder().encode(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += splitEvery) c.enqueue(bytes.slice(i, i + splitEvery)); // splits Telugu characters
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
}

describe('Stream reader', () => {
  const body = { question: 'q', language: 'te-IN', targetComponentId: null, facts: {} as TeachRequestBody['facts'], history: [] };

  it('decodes events split mid-character without corrupting Telugu', async () => {
    const telugu = 'Sun Gear మధ్యలో ఉంటుంది, ఇది Planet Gears ని తిప్పుతుంది.';
    const got: TeachStreamEvent[] = [];
    let headers: Headers | null = null;
    await streamTeachingPlan(body, undefined, (e) => got.push(e), (async (_u: string, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      return ndjsonResponse([{ type: 'step', step: { narration: telugu } }, { type: 'done', plan: { steps: [] } }]);
    }) as typeof fetch);
    assert.deepEqual(got.map((e) => e.type), ['step', 'done']);
    assert.equal((got[0] as { step: { narration: string } }).step.narration, telugu);
    assert.match(headers!.get('X-Request-Id') ?? '', /^[A-Za-z0-9-]+$/, 'correlation id, no content');
  });

  it('a stalled stream times out cleanly (no hang); cancel reports CANCELLED; an old backend falls back once', async () => {
    const stalled = (async (_u: string, init?: RequestInit) => new Response(new ReadableStream({
      start(c) { init?.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError'))); },
    }), { status: 200 })) as typeof fetch;
    await assert.rejects(streamTeachingPlan(body, undefined, () => {}, stalled, { idleMs: 30 }), (e: TeachingServiceError) => e.code === 'TIMEOUT');
    const ac = new AbortController();
    const p = streamTeachingPlan(body, ac.signal, () => {}, stalled, { idleMs: 5000 });
    setTimeout(() => ac.abort(), 10);
    await assert.rejects(p, (e: TeachingServiceError) => e.code === 'CANCELLED');
    let calls = 0;
    const old = (async (url: string) => {
      calls++;
      return url.endsWith('/stream') ? new Response('Not Found', { status: 404 }) : new Response(JSON.stringify({ plan: { steps: [{ a: 1 }, { b: 2 }] } }), { status: 200 });
    }) as typeof fetch;
    const got: string[] = [];
    await streamTeachingPlan(body, undefined, (e) => got.push(e.type), old);
    assert.deepEqual(got, ['step', 'step', 'done']);
    assert.equal(calls, 2, 'exactly one fallback request');
  });

  it('a server error event is passed on (the controller decides), JSON errors become codes', async () => {
    const got: TeachStreamEvent[] = [];
    await streamTeachingPlan(body, undefined, (e) => got.push(e), (async () => ndjsonResponse([{ type: 'error', code: 'LLM_TIMEOUT', message: 'm' }])) as typeof fetch);
    assert.equal(got[0].type, 'error');
    await assert.rejects(
      streamTeachingPlan(body, undefined, () => {}, (async () => new Response(JSON.stringify({ error: { code: 'LLM_QUOTA_EXCEEDED' } }), { status: 429 })) as typeof fetch),
      (e: TeachingServiceError) => e.code === 'LLM_QUOTA_EXCEEDED'
    );
  });
});

/* ============================== Gnani timeouts ============================== */

describe('Gnani 504 handling in the browser', () => {
  it('the backend\'s gateway-timeout code is recognised as temporary, without any key in the message', async () => {
    const fake = (async () => new Response(JSON.stringify({ error: { code: 'GNANI_GATEWAY_TIMEOUT', message: 'Gnani speech synthesis timed out on Gnani\'s side (504). Please try again.' } }), { status: 504 })) as typeof fetch;
    await assert.rejects(synthesize('hello', 'en-IN', undefined, fake), (e: VoiceServiceError) => {
      assert.equal(e.code, 'GNANI_GATEWAY_TIMEOUT');
      assert.ok(TRANSIENT_VOICE_ERRORS.includes(e.code));
      assert.doesNotMatch(e.message, /key|Bearer|X-API/i);
      return true;
    });
  });
});

/* ============================== timing ============================== */

describe('Latency marks for streamed answers (fake clock)', () => {
  it('measures time to first step, first audio ready and first audio; the turn stays open until the answer ends', () => {
    let t = 0;
    const logged: TurnSummary[] = [];
    const log = new VoiceTimingLog({ clock: () => t, log: (s) => logged.push(s) });
    log.begin(1);
    log.mark('recordEnd'); t = 700; log.mark('transcript'); t = 710; log.mark('teachStart');
    t = 1900; log.mark('firstStep'); t = 2600; log.mark('ttsFirstAudioReady'); t = 2650; log.mark('firstAudio');
    assert.equal(logged.length, 0, 'still streaming: not closed at first audio');
    t = 5200; log.mark('teachEnd');
    assert.equal(logged.length, 0, 'kept open until playback completed');
    t = 6000; log.mark('responseDone');
    assert.equal(logged.length, 1);
    const s = logged[0];
    assert.deepEqual([s.teachToFirstStep, s.teachToFirstAudioReady, s.teachToFirstAudio, s.teachMs], [1190, 1890, 1940, 4490]);
    assert.ok(s.teachToFirstAudio! < s.teachMs!, 'first audio before the answer was complete (mocked clock)');
  });
});

/* ============================== mocked pipeline timing (not live) ============================== */

describe('Mocked pipeline: time to first audio, buffered vs streamed', () => {
  it('with a simulated LLM writing 3 steps over 300 ms and 40 ms TTS, streaming speaks much earlier', async () => {
    const measure = async (streamed: boolean) => {
      let firstAudio = 0;
      const t0 = Date.now();
      const narrator: Narrator = {
        prepare: (text) => createChunkedClip(text, {
          synth: async (t) => { await sleep(40); return { label: t } as unknown as Blob; },
          makeAudio: (b) => ({ audio: fakeAudio([], (b as unknown as { label: string }).label, 5), release: () => {} }),
          onFirstAudioPlayed: () => { firstAudio ||= Date.now() - t0; },
        }),
      };
      const s = streamingSetup(narrator);
      const steps = [0, 1, 2].map((i) => step(i));
      const llm = async (emit: (e: TeachStreamEvent) => void) => {
        for (const st of steps) { await sleep(100); if (streamed) emit({ type: 'step', step: st }); }
        emit({ type: 'done', plan: fullPlan(3) });
      };
      void s.controller.ask(ask);
      await s.until(() => s.streams.length === 1);
      await llm(s.streams[0].emit);
      s.streams[0].end();
      await s.until(() => firstAudio > 0);
      s.close();
      return firstAudio;
    };
    const buffered = await measure(false);
    const streamed = await measure(true);
    console.log(`[mocked timing] first audio: buffered ${buffered} ms, streamed ${streamed} ms (simulated LLM 300 ms, TTS 40 ms)`);
    assert.ok(streamed < buffered - 100, `streamed ${streamed} ms vs buffered ${buffered} ms`);
  });
});
