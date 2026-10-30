/**
 * Milestone B — voice latency: call counts, reply-speech reuse, stale results and timing marks.
 * All external services are MOCKED; durations here are from a fake clock, not real measurements.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelRegistry } from '../src/models/registry';
import { previewTurn } from '../src/services/voice/voiceSession';
import { transcribeForMode } from '../src/services/voice/voiceLanguage';
import { TtsCache } from '../src/services/voice/ttsCache';
import { VoiceTimingLog, type TurnSummary } from '../src/services/voice/voiceTiming';
import { requestTeachingPlan, TeachingServiceError } from '../src/services/teaching/teachingClient';
import { makeWorkspace } from './sceneContext.test';

const ALL = modelRegistry.getAllModels();

describe('Milestone B: external calls per voice turn', () => {
  it('known commands and questions are resolved locally (no interpretation call needed)', () => {
    const w = makeWorkspace();
    w.dispatcher.dispatch({ type: 'component.select', componentId: 'sun_gear' }, 'ui');
    for (const t of ['zoom in', 'reset the camera', 'explode', 'reassemble', 'జూమ్ ఇన్', 'ఇది ఎందుకు అవసరం', 'దీనిని విడదీసి చూపించు',
      'ज़ूम इन करो', 'জুম ইন করো', 'ఈ Sun Gear ఎందుకు అవసరం?']) {
      const o = previewTurn({ transcript: t, dispatcher: w.dispatcher, model: w.ws.model, allModels: ALL });
      assert.notEqual(o.kind, 'noMatch', `${t}: the dock calls the interpreter only for noMatch`);
    }
  });

  it('one STT call when the first transcript is understood (auto) and always one when pinned (manual)', async () => {
    const w = makeWorkspace();
    const understood = (t: string) => previewTurn({ transcript: t, dispatcher: w.dispatcher, model: w.ws.model, allModels: ALL }).kind !== 'noMatch';
    for (const mode of ['auto', 'manual'] as const) {
      let calls = 0;
      await transcribeForMode(new Blob(), mode, 'en-IN', async () => { calls++; return 'zoom in'; }, understood);
      assert.equal(calls, 1, mode);
    }
  });
});

describe('Milestone B: reply speech is synthesized once', () => {
  const blob = () => new Blob([new Uint8Array([1, 2])], { type: 'audio/wav' });

  it('the same reply twice -> one synthesis; concurrent identical requests share one call', async () => {
    const cache = new TtsCache();
    let calls = 0;
    const synth = async () => { calls++; return blob(); };
    const [a, b] = await Promise.all([cache.get('Zooming in.', 'en-IN', synth), cache.get('Zooming in.', 'en-IN', synth)]);
    assert.equal(a, b);
    await cache.get('Zooming in.', 'en-IN', synth);
    assert.equal(calls, 1);
  });

  it('the key is the exact text and language: another reply or language is synthesized separately', async () => {
    const cache = new TtsCache();
    let calls = 0;
    const synth = async () => { calls++; return blob(); };
    await cache.get('జూమ్ ఇన్ చేస్తున్నాను.', 'te-IN', synth);
    await cache.get('Zooming in.', 'en-IN', synth);
    await cache.get('Zooming in.', 'hi-IN', synth);
    assert.equal(calls, 3);
  });

  it('long texts (explanations) are never cached; failures are not cached', async () => {
    const cache = new TtsCache(40, 160);
    let calls = 0;
    const long = 'x'.repeat(161);
    await cache.get(long, 'en-IN', async () => { calls++; return blob(); });
    await cache.get(long, 'en-IN', async () => { calls++; return blob(); });
    assert.equal(calls, 2);
    await assert.rejects(cache.get('ok', 'en-IN', async () => { throw new Error('429'); }));
    await cache.get('ok', 'en-IN', async () => { calls++; return blob(); });
    assert.equal(calls, 3, 'retried after a failure');
  });

  it('the cache is bounded (least recently used reply is dropped)', async () => {
    const cache = new TtsCache(2);
    const synth = async () => blob();
    await cache.get('a', 'en-IN', synth);
    await cache.get('b', 'en-IN', synth);
    await cache.get('a', 'en-IN', synth); // a is now most recent
    await cache.get('c', 'en-IN', synth);
    assert.deepEqual([cache.has('a', 'en-IN'), cache.has('b', 'en-IN'), cache.has('c', 'en-IN')], [true, false, true]);
  });
});

describe('Milestone B: timing marks (fake clock)', () => {
  it('summarises a turn from the end of recording, with call counts and no text', () => {
    let t = 0;
    const logged: TurnSummary[] = [];
    const log = new VoiceTimingLog({ clock: () => t, log: (s) => logged.push(s) });
    log.begin(7);
    log.mark('recordStart'); t = 3000;
    log.mark('recordEnd'); log.mark('sttStart'); log.count('stt'); t = 3800;
    log.mark('transcript'); log.note('understood', 'te-IN'); t = 3810;
    log.mark('parsed'); log.mark('captionShown'); log.count('tts'); t = 4400;
    log.mark('firstAudio');
    assert.equal(logged.length, 1, 'logged when the first audio plays');
    assert.deepEqual(logged[0], {
      turn: 7, language: 'te-IN', notes: ['understood'], calls: { stt: 1, interpret: 0, teach: 0, tts: 1 },
      recordEndToTranscript: 800, recordEndToCaption: 810, recordEndToFirstAudio: 1400, sttMs: 800,
      interpretMs: undefined, teachMs: undefined,
    });
  });

  it('marks from an older turn are ignored; a new turn closes the previous one', () => {
    let t = 0;
    const logged: TurnSummary[] = [];
    const log = new VoiceTimingLog({ clock: () => t, log: (s) => logged.push(s) });
    log.begin(1);
    log.mark('recordEnd', 1);
    log.begin(2);
    t = 50;
    log.mark('transcript', 1); // stale
    log.count('stt', 1); // stale
    assert.equal(logged.length, 1);
    assert.equal(log.peek()!.calls.stt, 0);
    assert.equal(log.peek()!.recordEndToTranscript, undefined);
  });
});

describe('Milestone B: cancellation and timeouts', () => {
  it('a cancelled teaching request reports CANCELLED, so it is never played', async () => {
    const hang: typeof fetch = ((_u: string, init?: RequestInit) => new Promise((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    const ac = new AbortController();
    const p = requestTeachingPlan({ question: 'q', language: 'te-IN', targetComponentId: null, questionType: 'explain', facts: {} as never, history: [] }, ac.signal, hang);
    ac.abort();
    await assert.rejects(p, (e: TeachingServiceError) => e.code === 'CANCELLED');
  });
});
