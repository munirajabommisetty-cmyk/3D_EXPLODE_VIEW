/**
 * Milestone A — automatic language detection and Telugu (te/hi/bn) teaching.
 * Everything external is MOCKED: Prisma transcription, the AI teacher and Timbre speech.
 * Transcripts marked "Prisma" are real Gnani output recorded earlier; the others are typed
 * examples from the milestone brief (how Prisma writes them has not been checked).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import { WARREN_TRUSS_MODEL_ID } from '../src/models/civil/warrenTrussBridgeModel';
import { getSceneSnapshot } from '../src/services/scene/sceneSnapshot';
import { handleVoiceTurn, lexiconFor, type VoiceTurnResult } from '../src/services/voice/voiceSession';
import { autoStartLanguage, transcribeForMode, turnLanguage } from '../src/services/voice/voiceLanguage';
import { REPLY_KEYS, REPLY_TABLES, reply } from '../src/services/voice/voiceReplies';
import { buildComponentBrief } from '../src/services/teaching/componentBrief';
import { recordedSpeed } from '../src/services/teaching/localizedBrief';
import { validateTeachingPlan } from '../src/services/teaching/teachingPlan';
import { TeachingPlanPlayer, type NarrationClip, type Narrator } from '../src/services/teaching/planPlayer';
import { ENGLISH_FALLBACK_NOTE, TeachingController } from '../src/services/teaching/teachingController';
import { LlmAvailability } from '../src/services/teaching/llmAvailability';
import { createTimbreNarrator } from '../src/services/teaching/teachingSession';
import type { TeachRequestBody } from '../src/services/teaching/teachingClient';
import { makeWorkspace } from './sceneContext.test';

const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
const bridge = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID)!;
const ALL = modelRegistry.getAllModels();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type WS = ReturnType<typeof makeWorkspace>;

const TELUGU = /[ఀ-౿]/;
const DEVANAGARI = /[ऀ-ॿ]/;
const BENGALI = /[ঀ-৿]/;

const turn = (w: WS, transcript: string, language: string): VoiceTurnResult =>
  handleVoiceTurn({ transcript, language, dispatcher: w.dispatcher, model: w.ws.model, allModels: ALL, teachingAvailable: true });
const selected = (id: string, model = gearbox) => {
  const w = makeWorkspace(model);
  w.dispatcher.dispatch({ type: 'component.select', componentId: id }, 'ui');
  return w;
};
const understoodBy = (w: WS) => (t: string) => turn(w, t, 'en-IN').outcome.kind !== 'noMatch';

function mockPrisma(byLanguage: Record<string, string>) {
  const calls: string[] = [];
  return { calls, fn: async (_w: Blob, l: string) => { calls.push(l); return byLanguage[l] ?? ''; } };
}

/* ===================== 7.1 Language ===================== */

describe('Milestone A: the language of a question decides the answer language', () => {
  const cases: [string, string, string, string][] = [
    // [transcript, expected language, expected question, expected part]
    ['ఈ Sun Gear ఎందుకు అవసరం?', 'te-IN', 'purpose', 'sun_gear'], // Telugu + English engineering term
    ['ఈ సన్ గేర్ ఎందుకు అవసరం', 'te-IN', 'purpose', 'sun_gear'], // the same, as Prisma writes loanwords
    ['Sun Gear పని ఏంటి?', 'te-IN', 'purpose', 'sun_gear'],
    ['రింగ్ గేర్ ఏం చేస్తుంది', 'te-IN', 'purpose', 'ring_gear'], // was misread as "gear A"
    ['ప్లానెట్ క్యారియర్ ని వివరించు', 'te-IN', 'explain', 'planet_carrier'],
    ['Why do we need the Sun Gear?', 'en-IN', 'purpose', 'sun_gear'],
    ['यह Sun Gear क्यों जरूरी है?', 'hi-IN', 'purpose', 'sun_gear'],
    ['এই Sun Gear কেন দরকার?', 'bn-IN', 'purpose', 'sun_gear'], // was a "select" command before
  ];
  for (const [text, lang, q, part] of cases) {
    it(`"${text}" -> ${lang} ${q} about ${part}`, () => {
      // From English (the default start language): the script decides, English words inside do not
      const detected = turnLanguage(text, 'en-IN');
      assert.equal(detected, lang);
      const w = makeWorkspace();
      const before = w.dispatcher.getHistory().length;
      const r = turn(w, text, detected);
      assert.equal(r.status, 'teach', JSON.stringify(r.outcome));
      assert.deepEqual([r.teach!.questionType, r.teach!.targetComponentId], [q, part]);
      assert.equal(w.dispatcher.getHistory().length, before, 'a question changes nothing in the scene');
      const shown = lexiconFor(gearbox).find((e) => e.componentId === part)!.displayName;
      assert.equal(r.caption, reply('teachPreparing', lang, { part: shown }), 'acknowledged in the same language');
    });
  }

  it('Telugu with English terms is Telugu, never English, from any starting language', () => {
    for (const ui of ['en-IN', 'hi-IN', 'te-IN']) assert.equal(turnLanguage('Planet Gears ఎలా rotate అవుతాయి?', ui), 'te-IN', ui);
  });

  it('"explain in English and Telugu" asks for a bilingual answer; "in Telugu" for Telugu', () => {
    const w = selected('sun_gear');
    const both = turn(w, 'ఈ part ని English and Telugu రెండింటిలో explain చెయ్యి.', 'te-IN');
    assert.deepEqual([both.teach!.language, both.teach!.bilingual], ['te-IN', true]);
    const te = turn(selected('sun_gear'), 'Explain this in Telugu with a real-world example.', 'en-IN');
    assert.deepEqual([te.teach!.language, te.teach!.bilingual], ['te-IN', undefined]);
  });
});

describe('Milestone A: auto-detect and manual override (mocked Prisma)', () => {
  // Prisma output for the same Telugu recording in each language (27 Oct 2026)
  const TELUGU_SPEECH = { 'en-IN': 'idi asal educ avasar', 'hi-IN': 'इधर असल एंड को अवसर', 'te-IN': 'ఇది అసలు ఎందుకు అవసరం' };

  it('auto: a request in the conversation language costs ONE Prisma call', async () => {
    const w = selected('sun_gear');
    const prisma = mockPrisma(TELUGU_SPEECH);
    const r = await transcribeForMode(new Blob(), 'auto', 'te-IN', prisma.fn, understoodBy(w));
    assert.deepEqual([prisma.calls, r.outcome, r.result.language], [['te-IN'], 'understood', 'te-IN']);
  });

  it('auto: Telugu speech while the conversation is English is detected (Stage 1 rules) without a menu', async () => {
    const w = selected('sun_gear');
    const prisma = mockPrisma(TELUGU_SPEECH);
    const r = await transcribeForMode(new Blob(), 'auto', 'en-IN', prisma.fn, understoodBy(w));
    assert.deepEqual([r.outcome, r.result.language, r.result.text], ['switched', 'te-IN', TELUGU_SPEECH['te-IN']]);
    assert.deepEqual(prisma.calls.sort(), ['en-IN', 'hi-IN', 'te-IN'], 'at most three calls, only because the first was not understood');
  });

  it('auto from a beta language (e.g. Bengali was pinned before) starts in English', () => {
    assert.equal(autoStartLanguage('bn-IN'), 'en-IN');
    assert.equal(autoStartLanguage('ta-IN'), 'en-IN');
    assert.equal(autoStartLanguage('te-IN'), 'te-IN');
  });

  it('auto: two languages understanding the same recording is "ambiguous" (the dock asks, in the current language)', async () => {
    const w = makeWorkspace();
    const prisma = mockPrisma({ 'hi-IN': 'कुछ अस्पष्ट', 'te-IN': 'షో మీ ద బ్యాక్', 'en-IN': 'show me the back' });
    const r = await transcribeForMode(new Blob(), 'auto', 'hi-IN', prisma.fn, understoodBy(w));
    assert.equal(r.outcome, 'ambiguous');
    assert.equal(r.result.language, 'hi-IN');
    for (const l of ['en-IN', 'te-IN', 'hi-IN', 'bn-IN']) assert.ok(reply('languageUnclear', l).length > 10, l);
    assert.ok(TELUGU.test(reply('languageUnclear', 'te-IN')));
  });

  it('auto: nothing understood in any language keeps the conversation language (no silent switch)', async () => {
    const w = makeWorkspace();
    const prisma = mockPrisma({ 'te-IN': 'అస్పష్టం', 'hi-IN': 'zoom in', 'en-IN': 'hmm' });
    const r = await transcribeForMode(new Blob(), 'auto', 'te-IN', prisma.fn, understoodBy(w));
    assert.deepEqual([r.outcome, r.result.language], ['none', 'te-IN']);
  });

  it('manual override: one Prisma call in the pinned language, never switched', async () => {
    const w = selected('sun_gear');
    for (const pinned of ['te-IN', 'en-IN', 'bn-IN']) {
      const prisma = mockPrisma(TELUGU_SPEECH);
      const r = await transcribeForMode(new Blob(), 'manual', pinned, prisma.fn, understoodBy(w));
      assert.deepEqual([prisma.calls, r.outcome, r.result.language], [[pinned], 'pinned', pinned]);
    }
  });

  it('every reply table has the new key (all four languages complete)', () => {
    for (const l of ['en-IN', 'te-IN', 'hi-IN', 'bn-IN'] as const) {
      for (const k of REPLY_KEYS) assert.ok((REPLY_TABLES[l] as Record<string, string>)[k], `${l}.${k}`);
    }
  });
});

describe('Milestone A: questions never trigger scene actions; actions still work', () => {
  it('"Planet Gears ఎలా rotate అవుతాయి?" is a question about the planet gears, not a camera orbit', () => {
    const w = makeWorkspace();
    const before = w.dispatcher.getHistory().length;
    const r = turn(w, 'Planet Gears ఎలా rotate అవుతాయి?', 'te-IN');
    assert.equal(r.status, 'teach');
    assert.equal(r.teach!.questionType, 'howWorks');
    assert.equal(w.dispatcher.getHistory().length, before);
  });

  it('"దీనిని విడదీసి చూపించు" explodes the model through the dispatcher', () => {
    const w = selected('sun_gear');
    const r = turn(w, 'దీనిని విడదీసి చూపించు.', 'te-IN');
    assert.equal(r.status, 'executed');
    assert.deepEqual(r.records.map((x) => x.command.type), ['assembly.explode']);
    assert.ok(TELUGU.test(r.caption), r.caption);
  });

  it('"Why is this needed?" / "ఈ భాగం ఎలా పని చేస్తుంది?" with nothing selected ask which part, in the question\'s language', () => {
    for (const [t, lang, script] of [['Why is this needed?', 'en-IN', /[a-z]/i], ['ఈ భాగం ఎలా పని చేస్తుంది?', 'te-IN', TELUGU]] as const) {
      const w = makeWorkspace();
      const r = turn(w, t, lang);
      assert.equal(r.status, 'needsInput');
      assert.equal(r.records.length, 0, 'no arbitrary part selected');
      assert.ok(script.test(r.caption));
    }
  });

  it('"ఈ component real life లో ఎక్కడ ఉపయోగిస్తారు?" is a purpose question about the selected part', () => {
    const r = turn(selected('planet_carrier'), 'ఈ component real life లో ఎక్కడ ఉపయోగిస్తారు?', 'te-IN');
    assert.deepEqual([r.teach!.questionType, r.teach!.targetComponentId], ['purpose', 'planet_carrier']);
  });

  it('Telugu commands still execute with Telugu acknowledgements (Prisma transcripts)', () => {
    const r = turn(makeWorkspace(), 'జూమ్ ఇన్', 'te-IN');
    assert.equal(r.status, 'executed');
    assert.equal(r.caption, reply('zoomIn', 'te-IN'));
  });
});

/* ===================== 7.2 Telugu (and Hindi / Bengali) teaching ===================== */

const narrations = (raw: unknown) => (raw as { steps: { narration: string; caption: string; claim: string }[] }).steps;

describe('Milestone A: model-data explanations in Telugu, Hindi and Bengali', () => {
  it('Telugu "why is the Sun Gear needed": Telugu narration, English name, analogy, recorded links', () => {
    const w = selected('sun_gear');
    const raw = buildComponentBrief(gearbox, w.snapshot(false), 'sun_gear', 'purpose', 'te-IN');
    const v = validateTeachingPlan(raw, w.snapshot(false), w.dispatcher.getContext());
    assert.ok(v.ok, JSON.stringify(v));
    const steps = narrations(raw);
    assert.ok(steps.every((s) => TELUGU.test(s.narration)), 'every step is spoken in Telugu');
    const text = steps.map((s) => s.narration).join(' ');
    assert.ok(text.includes('Sun Gear') && text.includes('Planet Gears'), 'technical names kept in English');
    assert.ok(steps.some((s) => s.claim === 'engineering' && /సౌర కుటుంబం/.test(s.narration)), 'an everyday example');
    assert.ok(/తేడా/.test(text), 'the example says where it differs');
    assert.ok(/robotics, automotive మరియు aerospace/i.test(text), 'uses come from the model description');
    assert.equal(steps[steps.length - 1].claim, 'notSimulated');
    assert.equal((raw as { language: string }).language, 'te-IN');
  });

  it('Telugu deeper question: relationships from the model and the recorded speed, exactly', () => {
    const w = selected('sun_gear');
    const text = narrations(buildComponentBrief(gearbox, w.snapshot(false), 'sun_gear', 'explain', 'te-IN')).map((s) => s.narration).join(' ');
    assert.ok(text.includes('Primary Drive Shaft ద్వారా తిరుగుతుంది'), 'driven by the shaft (recorded)');
    assert.ok(text.includes('Planet Gear A, Planet Gear B మరియు Planet Gear C ని తిప్పుతుంది'), 'drives the planets (recorded)');
    assert.ok(text.includes('1,200 RPM'), 'number and unit copied from the metadata');
    assert.equal(recordedSpeed(gearbox.getComponentMetadata('sun_gear')!.nominalRpm as string), '1,200 RPM');
  });

  it('no invented numbers: every number spoken appears in this part\'s metadata', () => {
    for (const lang of ['te-IN', 'hi-IN', 'bn-IN']) {
      for (const id of gearbox.getAllComponentIds()) {
        const meta = JSON.stringify(gearbox.getComponentMetadata(id));
        const text = narrations(buildComponentBrief(gearbox, makeWorkspace().snapshot(false), id, 'explain', lang)).map((s) => s.narration).join(' ');
        for (const n of text.match(/\d[\d,.]*/g) ?? []) {
          if (n === '3') continue; // "3D model"
          assert.ok(meta.includes(n.replace(/[.,]$/, '')), `${lang}/${id}: "${n}" not in the metadata`);
        }
      }
    }
  });

  it('failure questions name only recorded links and say failures are not simulated (Telugu)', () => {
    const raw = buildComponentBrief(gearbox, makeWorkspace().snapshot(false), 'planet_carrier', 'failure', 'te-IN');
    const last = narrations(raw).at(-1)!.narration;
    assert.match(last, /simulate చేయలేము/);
    assert.ok(!/Sun Gear|Ring Gear|Drive Shaft/.test(last), 'no unrelated part claimed');
  });

  it('every part of both models gets a valid brief in te / hi / bn, in that script, within the limits', () => {
    for (const [lang, script] of [['te-IN', TELUGU], ['hi-IN', DEVANAGARI], ['bn-IN', BENGALI]] as const) {
      for (const model of [gearbox, bridge]) {
        const w = makeWorkspace(model);
        for (const id of [...model.getAllComponentIds(), null]) {
          for (const q of ['explain', 'purpose', 'howWorks', 'failure']) {
            const raw = buildComponentBrief(model, w.snapshot(false), id, q, lang);
            const v = validateTeachingPlan(raw, w.snapshot(false), w.dispatcher.getContext());
            assert.ok(v.ok, `${lang}/${model.id}/${id}/${q}: ${JSON.stringify(v)}`);
            for (const s of narrations(raw)) assert.ok(script.test(s.narration), `${lang}/${model.id}/${id}: ${s.narration}`);
          }
        }
      }
    }
  });

  it('bilingual answer: Telugu narration (Telugu voice), English captions and summary', () => {
    const raw = buildComponentBrief(gearbox, selected('sun_gear').snapshot(false), 'sun_gear', 'explain', 'te-IN', { bilingual: true }) as {
      language: string; explanation: string; steps: { narration: string; caption: string }[];
    };
    assert.equal(raw.language, 'te-IN');
    assert.ok(raw.steps.every((s) => TELUGU.test(s.narration) && !TELUGU.test(s.caption)));
    assert.ok(!TELUGU.test(raw.explanation));
  });

  it('English briefs keep their wording and gain the curated everyday example', () => {
    const steps = narrations(buildComponentBrief(gearbox, selected('sun_gear').snapshot(false), 'sun_gear', 'explain'));
    assert.ok(steps.some((s) => s.claim === 'engineering' && /solar system/.test(s.narration)));
    assert.ok(steps.map((s) => s.narration).join(' ').includes('is driven by Primary Drive Shaft'));
  });
});

/* ===================== Quota exhaustion -> Telugu answer, no repeated failing calls ===================== */

function fakeNarrator() {
  const spoken: { text: string; language?: string }[] = [];
  const narrator: Narrator = {
    prepare(text: string, language?: string): NarrationClip {
      let resolve!: (v: 'ended' | 'failed' | 'stopped') => void;
      const done = new Promise<'ended' | 'failed' | 'stopped'>((r) => (resolve = r));
      let timer: ReturnType<typeof setTimeout> | null = null;
      return {
        done,
        play() { spoken.push({ text, language }); timer = setTimeout(() => resolve('ended'), 30); timer.unref?.(); },
        pause() {}, resume() {},
        stop() { if (timer) clearTimeout(timer); resolve('stopped'); },
      };
    },
  };
  return { narrator, spoken };
}

function teacher(w: WS, availability = new LlmAvailability(), language = 'te-IN') {
  const loop = setInterval(() => w.tick(16), 4);
  loop.unref?.();
  const n = fakeNarrator();
  const player = new TeachingPlanPlayer({ dispatcher: w.dispatcher, getSnapshot: () => getSceneSnapshot(w.dispatcher, w.ws.model), narrator: n.narrator, pollMs: 4, settleTimeoutMs: 1500 });
  const detach = player.attach();
  const requests: { body: TeachRequestBody; signal: AbortSignal; resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  const controller = new TeachingController({
    dispatcher: w.dispatcher, player, getModel: () => w.ws.model, getLanguage: () => language, availability,
    requestPlan: (body, signal) => new Promise((resolve, reject) => requests.push({ body, signal, resolve, reject })),
  });
  const until = async (cond: () => boolean, ms = 3000) => {
    const t0 = Date.now();
    while (!cond() && Date.now() - t0 < ms) await sleep(5);
    return cond();
  };
  return { controller, player, requests, n, until, close: () => { controller.cancel(); detach(); clearInterval(loop); } };
}

const quota = () => Object.assign(new Error('quota'), { code: 'LLM_QUOTA_EXCEEDED' });

describe('Milestone A: quota exhaustion', () => {
  it('quota error -> Telugu model-data answer, Telugu notice (no backend error text), Telugu voice', async () => {
    const w = selected('sun_gear');
    const t = teacher(w);
    try {
      const r = turn(w, 'ఈ Sun Gear ఎందుకు అవసరం? తెలుగులో ఉదాహరణతో వివరించు.', 'te-IN');
      const p = t.controller.ask(r.teach!);
      assert.equal(t.requests[0].body.language, 'te-IN');
      t.requests[0].reject(quota());
      assert.equal(await p, 'fallback');
      const notice = t.controller.getState().notice!;
      assert.equal(notice, (await import('../src/services/teaching/teachingController')).FALLBACK_NOTICES.quota['te-IN'], 'quota: its own short notice');
      assert.ok(!/quota|English/i.test(notice) && !notice.includes(ENGLISH_FALLBACK_NOTE));
      assert.equal(t.player.getState().plan!.language, 'te-IN');
      assert.ok(await t.until(() => t.n.spoken.length > 0));
      assert.equal(t.n.spoken[0].language, 'te-IN');
      assert.ok(TELUGU.test(t.n.spoken[0].text));
    } finally { t.close(); }
  });

  it('after a quota error the next questions do not call the teacher again (answered at once)', async () => {
    const w = selected('sun_gear');
    const t = teacher(w);
    try {
      const p1 = t.controller.ask({ question: 'ఇది ఎందుకు అవసరం', questionType: 'purpose', targetComponentId: 'sun_gear' });
      t.requests[0].reject(quota());
      assert.equal(await p1, 'fallback');
      const p2 = await t.controller.ask({ question: 'ఇది ఎలా పని చేస్తుంది', questionType: 'howWorks', targetComponentId: 'sun_gear' });
      assert.equal(p2, 'fallback');
      assert.equal(t.requests.length, 1, 'only the first question reached the teacher');
      assert.equal(t.player.getState().plan!.language, 'te-IN');
    } finally { t.close(); }
  });

  it('cool-down ends: the teacher is asked again after the quota window; a success clears it', () => {
    let now = 0;
    const a = new LlmAvailability(() => now);
    assert.equal(a.report('LLM_QUOTA_EXCEEDED'), true);
    assert.equal(a.isAvailable(), false);
    now += 10 * 60_000;
    assert.equal(a.isAvailable(), true);
    a.report('LLM_RATE_LIMIT');
    assert.equal(a.isAvailable(), false);
    a.reportSuccess();
    assert.equal(a.isAvailable(), true);
  });

  it('transient errors (network, timeout) are not remembered: the next question tries the teacher again', async () => {
    const w = selected('sun_gear');
    const t = teacher(w);
    try {
      const p1 = t.controller.ask({ question: 'q', questionType: 'purpose', targetComponentId: 'sun_gear' });
      t.requests[0].reject(Object.assign(new Error('x'), { code: 'BACKEND_UNAVAILABLE' }));
      assert.equal(await p1, 'fallback');
      void t.controller.ask({ question: 'q2', questionType: 'purpose', targetComponentId: 'sun_gear' });
      assert.equal(t.requests.length, 2);
    } finally { t.close(); }
  });
});

describe('Milestone A: Telugu speech configuration (mocked fetch, no Gnani call)', () => {
  it('Telugu narration is requested as te-IN; an English step is requested as en-IN', async () => {
    const g = globalThis as unknown as { fetch: typeof fetch; Audio?: unknown };
    const realFetch = g.fetch;
    const realAudio = g.Audio;
    const langs: string[] = [];
    g.fetch = (async (_u: string, init?: RequestInit) => {
      langs.push(JSON.parse(String(init?.body)).language);
      return new Response(new Uint8Array([1]), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
    }) as unknown as typeof fetch;
    g.Audio = class { play() { return Promise.resolve(); } pause() {} };
    try {
      const narrator = createTimbreNarrator(() => 'te-IN', () => {});
      const a = narrator.prepare('Sun Gear ఈ gearbox మధ్యలో ఉండే input gear.', 'te-IN');
      const b = narrator.prepare('The Sun Gear is the input.', 'en-IN');
      await sleep(30);
      a.stop();
      b.stop();
      assert.deepEqual(langs, ['te-IN', 'en-IN']);
    } finally {
      g.fetch = realFetch;
      g.Audio = realAudio;
    }
  });
});
