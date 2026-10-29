/**
 * Stage 3 — Bengali voice replies and teaching explanations. Everything is MOCKED: no Gnani or
 * Gemini calls (teacher replies, TTS fetches and transcription are simulated). Bengali command
 * transcripts are the exact Prisma bn-IN output from the Stage 2 evaluation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelRegistry } from '../src/models/registry';
import { getSceneSnapshot } from '../src/services/scene/sceneSnapshot';
import { handleVoiceTurn, type VoiceTurnResult } from '../src/services/voice/voiceSession';
import { transcribeWithLanguageRetryDetailed } from '../src/services/voice/voiceLanguage';
import { REPLY_KEYS, REPLY_TABLES, reply, replyLanguage } from '../src/services/voice/voiceReplies';
import { synthesize } from '../src/services/voice/voiceClient';
import { TeachingPlanPlayer, type NarrationClip, type Narrator } from '../src/services/teaching/planPlayer';
import { ENGLISH_FALLBACK_NOTE, FALLBACK_NOTICE, TeachingController, teachLanguage } from '../src/services/teaching/teachingController';
import { createTimbreNarrator } from '../src/services/teaching/teachingSession';
import type { TeachRequestBody } from '../src/services/teaching/teachingClient';
import { makeWorkspace } from './sceneContext.test';

const ALL = modelRegistry.getAllModels();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type WS = ReturnType<typeof makeWorkspace>;

// Exact Prisma bn-IN transcripts (Stage 2 evaluation, 27 Oct 2026)
const BN = {
  zoomIn: 'জুম ইন করো',
  zoomOut: 'জুম আউট করো',
  rotate: 'মডেলটা ঘোরাও',
  reset: 'ক্যামেরা রিসেট করো',
  explode: 'অংশগুলো আলাদা করো',
  reassemble: 'মডেলটা আবার জুড়ে দাও',
  selectGear: 'গিয়ারটা সিলেক্ট করো',
  explainThis: 'এই অংশটা বুঝিয়ে বলো',
};

const BENGALI = /[ঀ-৿]/;
const turn = (w: WS, transcript: string, language = 'bn-IN'): VoiceTurnResult =>
  handleVoiceTurn({ transcript, language, dispatcher: w.dispatcher, model: w.ws.model, allModels: ALL, teachingAvailable: true });
const placeholders = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort();

/* ===================== 1–4. Replies ===================== */

describe('Stage 3 Bengali replies: table', () => {
  it('Bengali is a reply language; every key is defined, in Bengali, with the same placeholders as English', () => {
    assert.equal(replyLanguage('bn-IN'), 'bn-IN');
    const bn = REPLY_TABLES['bn-IN'] as Record<string, string>;
    const en = REPLY_TABLES['en-IN'] as Record<string, string>;
    for (const k of REPLY_KEYS) {
      assert.ok(bn[k], `bn-IN defines ${k}`);
      assert.ok(BENGALI.test(bn[k]), `${k} is Bengali`);
      assert.deepEqual(placeholders(bn[k]), placeholders(en[k]), `${k}: same placeholders`);
    }
  });

  it('names, numbers and model names are inserted unchanged', () => {
    assert.equal(reply('select', 'bn-IN', { part: 'Sun Gear' }), 'Sun Gear সিলেক্ট করলাম।');
    assert.match(reply('animSpeed', 'bn-IN', { speed: 1.5 }), /1\.5/);
    assert.equal(reply('unknownPartOtherModel', 'bn-IN', { part: 'Piston', other: 'Engine', model: 'Planetary Gearbox' }),
      'Piston Engine-এর অংশ, এই Planetary Gearbox-এর নয়।');
    assert.equal(reply('related', 'bn-IN', { part: 'Sun Gear', list: ['Planet Gear A', 'Primary Drive Shaft'] }),
      'Sun Gear-এর সঙ্গে যুক্ত অংশগুলো হাইলাইট করছি: Planet Gear A, Primary Drive Shaft।');
    assert.equal(reply('ambiguous', 'bn-IN', { options: ['Planet Gear A', 'Planet Gear B'] }), 'কোনটার কথা বলছেন: Planet Gear A বা Planet Gear B?');
    assert.equal(reply('view', 'bn-IN', { view: 'front' }), 'সামনের ভিউ দেখাচ্ছি।');
  });

  it('suggested phrases in noMatch are verified Bengali commands only', () => {
    const quoted = [...reply('noMatch', 'bn-IN').matchAll(/“([^”]+)”/g)].map((m) => m[1]);
    assert.deepEqual(quoted, [BN.zoomIn, BN.explainThis]);
    for (const q of quoted) assert.notEqual(turn(makeWorkspace(), q).outcome.kind, 'noMatch', q);
  });
});

describe('Stage 3 Bengali replies: acknowledgements follow the dispatcher', () => {
  const cases: [keyof typeof BN, string][] = [
    ['zoomIn', 'জুম ইন করছি।'], ['zoomOut', 'জুম আউট করছি।'], ['reset', 'আগের ভিউতে ফিরে গেলাম।'],
    ['explode', 'অংশগুলো আলাদা করছি।'], ['reassemble', 'অংশগুলো আবার জুড়ে দিচ্ছি।'],
  ];
  for (const [key, caption] of cases) {
    it(`"${BN[key]}" executed -> "${caption}"`, () => {
      const r = turn(makeWorkspace(), BN[key]);
      assert.equal(r.status, 'executed', JSON.stringify(r.outcome));
      assert.ok(r.records.length > 0 && r.records.every((x) => x.status === 'executed'));
      assert.equal(r.caption, caption);
    });
  }

  it('rotate gets a Bengali orbit acknowledgement', () => {
    const r = turn(makeWorkspace(), BN.rotate);
    assert.equal(r.status, 'executed');
    assert.ok(BENGALI.test(r.caption) && r.caption.endsWith('ঘোরাচ্ছি।'), r.caption);
  });

  it('a command the dispatcher rejects gets a Bengali error, never a success message', () => {
    const w = makeWorkspace();
    w.dispatcher.registerContextProvider('zz-no-explode', () => ({ supportsExplodedView: false }));
    const r = turn(w, BN.explode);
    assert.equal(r.status, 'rejected');
    assert.equal(r.records[0].code, 'UNSUPPORTED_EXPLODED_VIEW');
    assert.ok(BENGALI.test(r.caption) && r.caption.includes('এক্সপ্লোডেড ভিউ নেই'), r.caption);
    assert.ok(!r.caption.includes('আলাদা করছি'), 'no success claim');
  });
});

describe('Stage 3 Bengali replies: clarifications and errors', () => {
  it('"select the gear" (not unique) asks which part in Bengali and selects nothing', () => {
    const w = makeWorkspace();
    const before = w.dispatcher.getHistory().length;
    const r = turn(w, BN.selectGear);
    assert.equal(r.records.length, 0);
    assert.equal(w.dispatcher.getHistory().length, before, 'no arbitrary gear selected');
    assert.ok(BENGALI.test(r.caption) && r.caption.includes('কোন অংশের কথা বলছেন?'), r.caption);
    assert.equal(r.speak, true);
  });

  it('"explain this part" with nothing selected asks which part in Bengali', () => {
    const r = turn(makeWorkspace(), BN.explainThis);
    assert.equal(r.status, 'needsInput');
    assert.equal(r.caption, reply('needsSelection', 'bn-IN'));
    assert.equal(r.teach, undefined);
  });

  it('an unknown Bengali phrase gets the Bengali "did not understand" reply and executes nothing', () => {
    const w = makeWorkspace();
    const r = turn(w, 'আজ আবহাওয়া কেমন');
    assert.equal(r.records.length, 0);
    assert.equal(r.caption, reply('noMatch', 'bn-IN'));
  });

  it('an empty transcript asks to repeat in Bengali', () => {
    const r = turn(makeWorkspace(), '  ');
    assert.equal(r.status, 'needsInput');
    assert.equal(r.caption, 'ঠিক শুনতে পেলাম না। আর একবার বলবেন?');
  });
});

describe('Stage 3: English, Telugu and Hindi replies unchanged; other beta languages still English', () => {
  it('existing tables are untouched', () => {
    assert.equal(reply('zoomIn', 'en-IN'), 'Zooming in.');
    assert.equal(reply('zoomIn', 'te-IN'), (REPLY_TABLES['te-IN'] as Record<string, string>).zoomIn);
    assert.equal(reply('zoomIn', 'hi-IN'), (REPLY_TABLES['hi-IN'] as Record<string, string>).zoomIn);
    assert.ok(/[ఀ-౿]/.test(reply('zoomIn', 'te-IN')) && /[ऀ-ॿ]/.test(reply('zoomIn', 'hi-IN')));
    for (const l of ['ta-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'gu-IN', 'pa-IN']) {
      assert.equal(replyLanguage(l), 'en-IN', l);
      assert.equal(reply('zoomIn', l), 'Zooming in.', l);
    }
  });

  it('English commands still get English replies', () => {
    const r = turn(makeWorkspace(), 'zoom in', 'en-IN');
    assert.deepEqual([r.status, r.caption], ['executed', 'Zooming in.']);
  });
});

/* ===================== 5–7. Teaching ===================== */

function fakeNarrator() {
  const spoken: { text: string; language?: string }[] = [];
  const narrator: Narrator = {
    prepare(text: string, language?: string): NarrationClip {
      let resolve!: (v: 'ended' | 'failed' | 'stopped') => void;
      const done = new Promise<'ended' | 'failed' | 'stopped'>((r) => (resolve = r));
      let timer: ReturnType<typeof setTimeout> | null = null;
      return {
        done,
        play() { spoken.push({ text, language }); timer = setTimeout(() => resolve('ended'), 60); timer.unref?.(); },
        pause() {}, resume() {},
        stop() { if (timer) clearTimeout(timer); resolve('stopped'); },
      };
    },
  };
  return { narrator, spoken };
}

/** A Bengali plan as the AI teacher would return it (simulated): Bengali narration, English names and numbers. */
function bengaliPlan(target: string) {
  return {
    schemaVersion: 1, planId: 'b'.repeat(32), modelId: 'planetary_gearbox', targetComponentId: target,
    title: 'Sun Gear', explanation: 'x', cannotAnswer: null,
    steps: [{
      index: 0, kind: 'demonstrate', claim: 'metadata', narration: 'Sun Gear তিনটি planet gear-এর সঙ্গে মেশ করে।',
      caption: 'Sun Gear → 3 planet gears', targetComponentId: target,
      actions: [{ type: 'component.focus', componentId: target }], waitFor: 'narration', holdMs: 0,
    }],
    rejectedSteps: [], followUpSuggestions: [],
  };
}

function teacher(w: WS, uiLanguage = 'bn-IN') {
  const loop = setInterval(() => w.tick(16), 4);
  loop.unref?.();
  const n = fakeNarrator();
  const player = new TeachingPlanPlayer({ dispatcher: w.dispatcher, getSnapshot: () => getSceneSnapshot(w.dispatcher, w.ws.model), narrator: n.narrator, pollMs: 4, settleTimeoutMs: 1500 });
  const detach = player.attach();
  const requests: { body: TeachRequestBody; signal: AbortSignal; resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  const controller = new TeachingController({
    dispatcher: w.dispatcher, player, getModel: () => w.ws.model, getLanguage: () => uiLanguage,
    requestPlan: (body, signal) => new Promise((resolve, reject) => requests.push({ body, signal, resolve, reject })),
  });
  const until = async (cond: () => boolean, ms = 3000) => {
    const t0 = Date.now();
    while (!cond() && Date.now() - t0 < ms) await sleep(5);
    return cond();
  };
  const close = () => { controller.cancel(); detach(); clearInterval(loop); };
  return { controller, player, requests, n, until, close };
}

function bengaliExplainRequest(w: WS) {
  w.dispatcher.dispatch({ type: 'component.select', componentId: 'sun_gear' }, 'ui');
  const r = turn(w, BN.explainThis);
  assert.equal(r.status, 'teach');
  assert.equal(r.caption, 'Sun Gear-এর ব্যাখ্যা তৈরি করছি…');
  return r.teach!;
}

describe('Stage 3 Bengali teaching', () => {
  it('Bengali is a teaching language: the request asks for Bengali, and the plan is narrated in Bengali', async () => {
    assert.equal(teachLanguage('bn-IN'), 'bn-IN');
    assert.equal(teachLanguage('ta-IN'), 'en-IN', 'other beta languages unchanged');
    const w = makeWorkspace();
    const t = teacher(w);
    try {
      const info = bengaliExplainRequest(w);
      const p = t.controller.ask({ ...info, language: info.language ?? 'bn-IN' });
      assert.equal(t.requests.length, 1);
      assert.equal(t.requests[0].body.language, 'bn-IN');
      assert.equal(t.requests[0].body.targetComponentId, 'sun_gear');
      assert.ok(JSON.stringify(t.requests[0].body.facts).includes('"Sun Gear"'), 'English component name sent as data');
      t.requests[0].resolve(bengaliPlan('sun_gear'));
      assert.equal(await p, 'started');
      assert.equal(t.player.getState().plan!.language, 'bn-IN');
      assert.ok(await t.until(() => t.n.spoken.length > 0));
      assert.deepEqual(t.n.spoken[0], { text: 'Sun Gear তিনটি planet gear-এর সঙ্গে মেশ করে।', language: 'bn-IN' });
      assert.equal(t.controller.getState().notice, null, 'no fallback notice for a real Bengali answer');
    } finally { t.close(); }
  });

  // Milestone A: the model-data fallback is now built in Bengali (it was English + a note in Stage 3)
  it('fallback (teacher unavailable, mocked quota error): model data answered in Bengali, Bengali voice', async () => {
    const w = makeWorkspace();
    const t = teacher(w);
    try {
      const info = bengaliExplainRequest(w);
      const p = t.controller.ask({ ...info, language: 'bn-IN' });
      t.requests[0].reject(Object.assign(new Error('quota'), { code: 'LLM_QUOTA_EXCEEDED' }));
      assert.equal(await p, 'fallback');
      const notice = t.controller.getState().notice!;
      assert.equal(notice, (await import('../src/services/teaching/teachingController')).FALLBACK_NOTICES.quota['bn-IN'], 'quota: its own short notice');
      assert.ok(!notice.includes(ENGLISH_FALLBACK_NOTE) && !notice.includes(FALLBACK_NOTICE));
      const plan = t.player.getState().plan!;
      assert.equal(plan.language, 'bn-IN');
      assert.ok(plan.steps.every((s) => BENGALI.test(s.narration)), 'every narration is Bengali');
      assert.ok(plan.steps.some((s) => s.narration.includes('Sun Gear')), 'component name kept in English');
      assert.ok(await t.until(() => t.n.spoken.length > 0));
      assert.equal(t.n.spoken[0].language, 'bn-IN');
    } finally { t.close(); }
  });

  it('a Bengali explanation can be cancelled; a late teacher reply is never played', async () => {
    const w = makeWorkspace();
    const t = teacher(w);
    try {
      const info = bengaliExplainRequest(w);
      const p = t.controller.ask({ ...info, language: 'bn-IN' });
      t.controller.cancel();
      assert.equal(t.requests[0].signal.aborted, true);
      t.requests[0].resolve(bengaliPlan('sun_gear'));
      assert.equal(await p, 'stale');
      await sleep(30);
      assert.equal(t.player.getState().plan, null);
      assert.equal(t.n.spoken.length, 0);
      assert.equal(t.controller.isActive(), false);
    } finally { t.close(); }
  });
});

/* ===================== 8. TTS (mocked fetch) ===================== */

describe('Stage 3 Bengali speech: requests use bn-IN (mocked, no Gnani call)', () => {
  it('synthesize sends the Bengali text with language bn-IN', async () => {
    const sent: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(new Uint8Array([1]), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
    }) as unknown as typeof fetch;
    await synthesize(reply('zoomIn', 'bn-IN'), 'bn-IN', undefined, fetchImpl);
    assert.deepEqual(sent, [{ url: '/api/voice/speak', body: { text: 'জুম ইন করছি।', language: 'bn-IN' } }]);
  });

  it('the narrator requests bn-IN speech for a Bengali plan (and English for an English plan)', async () => {
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
      const narrator = createTimbreNarrator(() => 'bn-IN', () => {});
      const a = narrator.prepare('Sun Gear তিনটি planet gear-এর সঙ্গে মেশ করে।', 'bn-IN');
      const b = narrator.prepare('The sun gear meshes with three planet gears.', 'en-IN');
      const c = narrator.prepare('জুম ইন করছি।');
      await sleep(30);
      for (const x of [a, b, c]) x.stop();
      assert.deepEqual(langs, ['bn-IN', 'en-IN', 'bn-IN']);
    } finally {
      g.fetch = realFetch;
      g.Audio = realAudio;
    }
  });
});

/* ===================== 9. Stage 1 / Stage 2 still hold ===================== */

describe('Stage 3: Stage 1 and Stage 2 behaviour intact', () => {
  it('Bengali is still never retried or switched', async () => {
    const calls: string[] = [];
    const understood = (t: string) => turn(makeWorkspace(), t).outcome.kind !== 'noMatch';
    const { result, outcome } = await transcribeWithLanguageRetryDetailed(new Blob(), 'bn-IN',
      async (_b, l) => { calls.push(l); return l === 'bn-IN' ? 'আজ আবহাওয়া কেমন' : 'zoom in'; }, understood);
    assert.deepEqual([calls, outcome, result.language], [['bn-IN'], 'notRetried', 'bn-IN']);
  });

  it('the eight verified commands still map to the same outcomes', () => {
    const kinds = Object.values(BN).map((t) => turn(makeWorkspace(), t).outcome.kind);
    assert.deepEqual(kinds, ['commands', 'commands', 'commands', 'commands', 'commands', 'commands', 'unknownPart', 'needsSelection']);
  });
});
