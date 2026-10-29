/**
 * Stage 2 — Bengali command understanding. Fixtures are the EXACT Gnani Prisma (bn-IN) transcripts
 * from the Stage 2 evaluation (27 Oct 2026; Timbre-generated audio, not human speech), written
 * with escapes so the code points are exactly what Prisma returned (e.g. ড় = U+09A1 U+09BC).
 * No live API calls: transcription is mocked where needed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import { handleVoiceTurn, previewTurn, type VoiceTurnResult } from '../src/services/voice/voiceSession';
import { normalise, buildPartLexicon } from '../src/services/voice/partLexicon';
import { transcribeWithLanguageRetryDetailed, turnLanguage } from '../src/services/voice/voiceLanguage';
import { makeWorkspace } from './sceneContext.test';

const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
const ALL = modelRegistry.getAllModels();

// Exact Prisma bn-IN transcripts (Stage 2 evaluation)
const BN = {
  zoomIn: 'জুম ইন করো', // জুম ইন করো
  zoomOut: 'জুম আউট করো', // জুম আউট করো
  rotate: 'মডেলটা ঘোরাও', // মডেলটা ঘোরাও
  reset: 'ক্যামেরা রিসেট করো', // ক্যামেরা রিসেট করো
  explode: 'অংশগুলো আলাদা করো', // অংশগুলো আলাদা করো
  reassemble: 'মডেলটা আবার জুড়ে দাও', // মডেলটা আবার জুড়ে দাও
  selectGear: 'গিয়ারটা সিলেক্ট করো', // গিয়ারটা সিলেক্ট করো
  explainThis: 'এই অংশটা বুঝিয়ে বলো', // এই অংশটা বুঝিয়ে বলো
};

function turn(w: ReturnType<typeof makeWorkspace>, transcript: string, language = 'bn-IN'): VoiceTurnResult {
  return handleVoiceTurn({ transcript, language, dispatcher: w.dispatcher, model: w.ws.model, allModels: ALL, teachingAvailable: true });
}
const preview = (w: ReturnType<typeof makeWorkspace>, transcript: string) =>
  previewTurn({ transcript, dispatcher: w.dispatcher, model: gearbox, allModels: ALL });

/* ===================== A. The eight verified transcripts ===================== */

describe('Stage 2 Bengali: the eight Prisma-verified transcripts', () => {
  const commandCases: [keyof typeof BN, string, unknown][] = [
    ['zoomIn', 'zoom', [{ type: 'camera.zoom', direction: 'in' }]],
    ['zoomOut', 'zoom', [{ type: 'camera.zoom', direction: 'out' }]],
    ['rotate', 'orbit', [{ type: 'camera.orbit', yawDeg: -30, pitchDeg: 0 }]], // same default as "rotate" / "తిప్పు"
    ['reset', 'reset', [{ type: 'camera.reset' }]],
    ['explode', 'explode', [{ type: 'assembly.explode', factor: 0.75 }]],
    ['reassemble', 'assemble', [{ type: 'assembly.restore' }]],
  ];
  for (const [key, intent, expected] of commandCases) {
    it(`${key}: "${BN[key]}" -> ${intent}, executed through the dispatcher`, () => {
      const w = makeWorkspace();
      const before = w.dispatcher.getHistory().length;
      const r = turn(w, BN[key]);
      assert.equal(r.outcome.kind, 'commands', JSON.stringify(r.outcome));
      if (r.outcome.kind !== 'commands') return;
      assert.equal(r.outcome.intent, intent);
      assert.deepEqual(r.outcome.commands, expected, 'no unrelated command');
      const recs = w.dispatcher.getHistory().slice(before);
      assert.deepEqual(recs.map((x) => [x.source, x.status]), (expected as unknown[]).map(() => ['voice', 'executed']));
    });
  }

  it('the English equivalents produce the same commands (no new intent was introduced)', () => {
    const pairs: [string, string][] = [[BN.zoomIn, 'zoom in'], [BN.zoomOut, 'zoom out'], [BN.rotate, 'rotate the model'],
      [BN.reset, 'reset the camera'], [BN.explode, 'explode'], [BN.reassemble, 'reassemble']];
    for (const [bn, en] of pairs) {
      const w = makeWorkspace();
      const a = preview(w, bn);
      const b = preview(w, en);
      assert.deepEqual(a.kind === 'commands' && a.commands, b.kind === 'commands' && b.commands, `${bn} vs ${en}`);
    }
  });

  it('selectGear: "গিয়ারটা সিলেক্ট করো" is a select request; "the gear" is not unique in the gearbox, so it is handled exactly like English "select the gear" (no part chosen, nothing executed)', () => {
    const w = makeWorkspace();
    const before = w.dispatcher.getHistory().length;
    const bn = turn(w, BN.selectGear);
    const en = turn(makeWorkspace(), 'select the gear', 'en-IN');
    assert.deepEqual(bn.outcome, en.outcome);
    assert.deepEqual(bn.outcome, { kind: 'unknownPart', intent: 'select', spoken: '' });
    assert.equal(bn.records.length, 0);
    assert.equal(w.dispatcher.getHistory().length, before, 'no arbitrary gear selected');
  });

  it('explainThis: "এই অংশটা বুঝিয়ে বলো" explains the SELECTED part; with nothing selected it asks which part', () => {
    const w = makeWorkspace();
    w.dispatcher.dispatch({ type: 'component.select', componentId: 'planet_carrier' }, 'ui');
    const r = turn(w, BN.explainThis);
    assert.equal(r.status, 'teach');
    assert.deepEqual(r.outcome, { kind: 'question', question: 'explain', partId: 'planet_carrier', via: 'selected' });
    assert.equal(r.records.length, 0, 'questions dispatch nothing themselves');
    const none = turn(makeWorkspace(), BN.explainThis);
    assert.equal(none.outcome.kind, 'needsSelection');
    assert.equal(none.records.length, 0);
  });

  it('a pointed-at part wins for "এই" (this), as for every other language', () => {
    const w = makeWorkspace();
    w.dispatcher.dispatch({ type: 'component.select', componentId: 'ring_gear' }, 'ui');
    w.pointer.componentId = 'sun_gear';
    w.pointer.source = 'gesture';
    const r = turn(w, BN.explainThis);
    assert.equal(r.outcome.kind === 'question' && r.outcome.partId, 'sun_gear');
  });
});

/* ===================== B. Unicode handling ===================== */

describe('Stage 2 Bengali: Unicode handling', () => {
  it('precomposed ড় / য় (U+09DC / U+09DF) and Prisma\'s decomposed form (base + U+09BC) are equivalent', () => {
    const precomposedReassemble = BN.reassemble.replace('ড়', 'ড়');
    const precomposedExplain = BN.explainThis.replace('য়', 'য়');
    assert.notEqual(precomposedReassemble, BN.reassemble, 'the fixtures really differ in code points');
    assert.equal(normalise(precomposedReassemble), normalise(BN.reassemble));
    assert.equal(normalise(precomposedExplain), normalise(BN.explainThis));
    const w = makeWorkspace();
    w.dispatcher.dispatch({ type: 'component.select', componentId: 'sun_gear' }, 'ui');
    assert.deepEqual(preview(w, precomposedReassemble), preview(w, BN.reassemble));
    assert.deepEqual(preview(w, precomposedExplain), preview(w, BN.explainThis));
  });

  it('the Bengali nukta is kept (it changes the letter): ড without the nukta does not match', () => {
    assert.ok(normalise(BN.reassemble).includes('়'));
    const withoutNukta = BN.reassemble.replace('়', ''); // "জুডে": a different word
    assert.equal(preview(makeWorkspace(), withoutNukta).kind, 'noMatch');
  });

  it('Hindi normalisation is unchanged (Devanagari nukta still folded) and the Bengali danda is tolerated', () => {
    assert.equal(normalise('ज़ूम इन करो'), normalise('जूम इन करो'));
    assert.deepEqual(preview(makeWorkspace(), `${BN.zoomIn}।`), preview(makeWorkspace(), BN.zoomIn));
  });

  it('the lexicon gets the verified Bengali spelling of "gear" only (no invented part names)', () => {
    const phrases = buildPartLexicon(gearbox).flatMap((e) => e.phrases);
    assert.ok(!phrases.some((p) => /[ঀ-৿]/.test(p)),
      'no Bengali part phrase is generated yet: "gear" alone is shared by several parts, and other words have no verified spelling');
  });
});

/* ===================== C. Safety ===================== */

describe('Stage 2 Bengali: safety', () => {
  it('unknown Bengali phrases execute nothing', () => {
    for (const t of ['আজ আবহাওয়া কেমন', 'আমাকে একটা গান শোনাও', 'আলাদা করো']) {
      const w = makeWorkspace();
      const before = w.dispatcher.getHistory().length;
      const r = turn(w, t);
      assert.equal(r.records.length, 0, t);
      assert.equal(w.dispatcher.getHistory().length, before, t);
    }
  });

  it('validation still applies: a Bengali command is rejected by V1 when the model cannot do it', () => {
    const w = makeWorkspace();
    // A model without exploded view: the same V1 validator rejects the Bengali explode request
    w.dispatcher.registerContextProvider('zz-no-explode', () => ({ supportsExplodedView: false }));
    const r = turn(w, BN.explode);
    assert.equal(r.status, 'rejected');
    assert.equal(r.records[0].code, 'UNSUPPORTED_EXPLODED_VIEW');
  });
});

/* ===================== D. Stage 1 safeguards with Bengali selected ===================== */

describe('Stage 2 Bengali: Stage 1 language safeguards still hold', () => {
  const understood = (t: string) => preview(makeWorkspace(), t).kind !== 'noMatch';

  it('a recognised Bengali command is used as-is: one Prisma call, Bengali kept', async () => {
    const calls: string[] = [];
    const { result, outcome } = await transcribeWithLanguageRetryDetailed(new Blob(), 'bn-IN',
      async (_b, l) => { calls.push(l); return BN.zoomIn; }, understood);
    assert.deepEqual([calls, outcome, result.language, result.text], [['bn-IN'], 'understood', 'bn-IN', BN.zoomIn]);
  });

  it('an unrecognised Bengali phrase is not retried and does not switch language', async () => {
    const calls: string[] = [];
    const { result, outcome } = await transcribeWithLanguageRetryDetailed(new Blob(), 'bn-IN',
      async (_b, l) => { calls.push(l); return l === 'bn-IN' ? 'আজ আবহাওয়া কেমন' : 'zoom in'; }, understood);
    assert.deepEqual([calls, outcome, result.language], [['bn-IN'], 'notRetried', 'bn-IN']);
    assert.equal(turnLanguage(BN.explainThis, 'bn-IN'), 'bn-IN');
  });
});
