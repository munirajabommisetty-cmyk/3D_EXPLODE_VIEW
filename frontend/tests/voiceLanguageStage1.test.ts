/**
 * Stage 1 — language reliability of the cross-language retry. All transcription is MOCKED (no
 * Gnani or Gemini calls). Strings marked "Prisma" are real Gnani Prisma output recorded earlier
 * (26–27 Oct 2026); strings marked "hypothetical" are invented to model a risk the audit found.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import { handleVoiceTurn, previewTurn } from '../src/services/voice/voiceSession';
import {
  interpretedLanguage, isRetryLanguage, scriptMatches, transcribeWithLanguageRetry,
  transcribeWithLanguageRetryDetailed, turnLanguage,
} from '../src/services/voice/voiceLanguage';
import { makeWorkspace } from './sceneContext.test';

const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
const ALL = modelRegistry.getAllModels();
const BETA = ['bn-IN', 'ta-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'gu-IN', 'pa-IN'];

const understoodBy = (w: ReturnType<typeof makeWorkspace>) => (t: string) =>
  previewTurn({ transcript: t, dispatcher: w.dispatcher, model: gearbox, allModels: ALL }).kind !== 'noMatch';

/** Mock Prisma: returns `byLanguage[language]` and records every call. */
function mockPrisma(byLanguage: Record<string, string>) {
  const calls: string[] = [];
  const fn = async (_wav: Blob, language: string) => {
    calls.push(language);
    return byLanguage[language] ?? '';
  };
  return { fn, calls };
}

describe('Stage 1: Bengali and beta languages keep their language', () => {
  it('1. Bengali selected + unclear transcript: no Telugu / Hindi / English retry calls', async () => {
    const w = makeWorkspace();
    // An UNCLEAR Bengali transcript (still not a command after Stage 2). Stage 1 used "জুম ইন করো"
    // here because Bengali was not parsed then; Stage 2 made that a valid command (covered in
    // bengaliCommands.test.ts), so the fixture was swapped to keep this test's intent.
    const unclear = 'আজ আবহাওয়া কেমন';
    const prisma = mockPrisma({ 'bn-IN': unclear, 'en-IN': 'zoom in koro', 'te-IN': 'జూమ్ ఇన్ కరో', 'hi-IN': 'जूम इन करो' });
    const { result, outcome } = await transcribeWithLanguageRetryDetailed(new Blob(), 'bn-IN', prisma.fn, understoodBy(w));
    assert.deepEqual(prisma.calls, ['bn-IN'], 'exactly one Prisma call');
    assert.equal(outcome, 'notRetried');
    assert.deepEqual(result, { text: unclear, language: 'bn-IN', retried: false });
  });

  it('2. Bengali stays selected whatever script or language signal appears', () => {
    assert.equal(turnLanguage('ఇది ఎందుకు అవసరం', 'bn-IN'), 'bn-IN', 'Telugu script does not switch');
    assert.equal(turnLanguage('मुझे पीछे दिखाओ', 'bn-IN'), 'bn-IN', 'Devanagari does not switch');
    assert.equal(turnLanguage('show me the back', 'bn-IN'), 'bn-IN', 'Latin does not switch');
    assert.equal(turnLanguage('জুম ইন করো', 'bn-IN'), 'bn-IN');
    assert.equal(interpretedLanguage('en-IN', 'show me the back', 'bn-IN'), 'bn-IN', 'LLM language guess does not switch Bengali');
    assert.equal(interpretedLanguage('te-IN', 'ఇది ఎందుకు', 'bn-IN'), 'bn-IN');
  });

  it('6. every other beta language keeps its selection and makes one Prisma call only', async () => {
    const w = makeWorkspace();
    for (const lang of BETA) {
      assert.equal(isRetryLanguage(lang), false, lang);
      const prisma = mockPrisma({ [lang]: 'unclear words', 'en-IN': 'zoom in', 'te-IN': 'జూమ్ ఇన్', 'hi-IN': 'ज़ूम इन' });
      const r = await transcribeWithLanguageRetry(new Blob(), lang, prisma.fn, understoodBy(w));
      assert.deepEqual([prisma.calls, r.language], [[lang], lang], lang);
      for (const t of ['ఇది ఎందుకు', 'पीछे दिखाओ', 'zoom in']) assert.equal(turnLanguage(t, lang), lang, `${lang}: "${t}"`);
    }
  });
});

describe('Stage 1: switching within English / Telugu / Hindi needs unambiguous evidence', () => {
  // Prisma output for the same recording sent with each language code (27 Oct 2026)
  const TELUGU_SPEECH = { 'en-IN': 'idi asal educ avasar', 'hi-IN': 'इधर असल एंड को अवसर', 'te-IN': 'ఇది అసలు ఎందుకు అవసరం' };
  const HINDI_SPEECH = { 'en-IN': 'mujhe pichhe ka drishya dikhao', 'te-IN': 'ముజి కా దృశ్య ది ఖా', 'hi-IN': 'मुझे पीछे का दृश्य दिखाओ।' };

  it('3. English selected + Telugu speech (Prisma): still switches to Telugu', async () => {
    const w = makeWorkspace();
    w.dispatcher.dispatch({ type: 'component.select', componentId: 'planet_carrier' }, 'ui');
    const prisma = mockPrisma(TELUGU_SPEECH);
    const { result, outcome } = await transcribeWithLanguageRetryDetailed(new Blob(), 'en-IN', prisma.fn, understoodBy(w));
    assert.equal(outcome, 'switched');
    assert.deepEqual(result, { text: 'ఇది అసలు ఎందుకు అవసరం', language: 'te-IN', retried: true });
  });

  it('Telugu selected + Hindi speech (Prisma): still switches to Hindi', async () => {
    const w = makeWorkspace();
    const { result, outcome } = await transcribeWithLanguageRetryDetailed(new Blob(), 'te-IN', mockPrisma(HINDI_SPEECH).fn, understoodBy(w));
    assert.deepEqual([outcome, result.language], ['switched', 'hi-IN']);
  });

  it('4a. conflicting evidence (two languages "understand" the recording) keeps the selection', async () => {
    const w = makeWorkspace();
    // Hindi selected; Telugu and English versions both parse (Prisma strings from the English
    // "Show me the back" recording, combined here to model a conflict) -> no switch
    const prisma = mockPrisma({ 'hi-IN': 'कुछ अस्पष्ट', 'te-IN': 'షో మీ ద బ్యాక్', 'en-IN': 'show me the back' });
    const { result, outcome } = await transcribeWithLanguageRetryDetailed(new Blob(), 'hi-IN', prisma.fn, understoodBy(w));
    assert.equal(outcome, 'ambiguous');
    assert.deepEqual(result, { text: 'कुछ अस्पष्ट', language: 'hi-IN', retried: true });
  });

  it('4b. a retry whose script does not match its language is not evidence (hypothetical)', async () => {
    const w = makeWorkspace();
    // Telugu selected; the Hindi retry returns LATIN text that parses -> wrong script for hi-IN
    const prisma = mockPrisma({ 'te-IN': 'అస్పష్టం', 'hi-IN': 'zoom in', 'en-IN': 'hmm' });
    const { result, outcome } = await transcribeWithLanguageRetryDetailed(new Blob(), 'te-IN', prisma.fn, understoodBy(w));
    assert.equal(outcome, 'none');
    assert.equal(result.language, 'te-IN');
  });

  it('LLM fallback language: followed only within en/te/hi and only when the script agrees', () => {
    assert.equal(interpretedLanguage('te-IN', 'ఇది ఎందుకు అవసరం', 'en-IN'), 'te-IN');
    assert.equal(interpretedLanguage('te-IN', 'idi asal educ avasar', 'en-IN'), 'en-IN', 'romanised: no script evidence');
    assert.equal(interpretedLanguage('hi-IN', 'ఇది ఎందుకు', 'te-IN'), 'te-IN', 'Hindi guess vs Telugu script: conflict');
    assert.equal(interpretedLanguage(null, 'anything', 'hi-IN'), 'hi-IN');
    assert.equal(interpretedLanguage('ta-IN', 'anything', 'en-IN'), 'en-IN', 'outside the group');
  });

  it('script evidence helper', () => {
    assert.ok(scriptMatches('ఇది', 'te-IN') && scriptMatches('यह', 'hi-IN') && scriptMatches('show me', 'en-IN'));
    assert.ok(!scriptMatches('show me', 'te-IN') && !scriptMatches('ఇది', 'en-IN') && !scriptMatches('জুম', 'en-IN'));
    assert.ok(!scriptMatches('জুম ইন', 'bn-IN'), 'beta languages never provide switching evidence');
  });
});

describe('Stage 1: no accidental command from a retry', () => {
  it('5a. Bengali: an English-looking retry can no longer produce an executed command', async () => {
    const w = makeWorkspace();
    const before = w.dispatcher.getHistory().length;
    // hypothetical: Bengali speech that Prisma en-IN would render as an English command
    const prisma = mockPrisma({ 'bn-IN': 'ক্যামেরা একটু কাছে আনো', 'en-IN': 'zoom in' });
    const heard = await transcribeWithLanguageRetry(new Blob(), 'bn-IN', prisma.fn, understoodBy(w));
    const r = handleVoiceTurn({ transcript: heard.text, language: heard.language, dispatcher: w.dispatcher, model: gearbox, allModels: ALL, teachingAvailable: true });
    assert.equal(r.outcome.kind, 'noMatch');
    assert.equal(r.records.length, 0);
    assert.equal(w.dispatcher.getHistory().length, before, 'nothing reached the dispatcher');
    assert.deepEqual(prisma.calls, ['bn-IN']);
  });

  it('5b. English/Telugu/Hindi: an ambiguous retry hands back the unclear transcript, not a command', async () => {
    const w = makeWorkspace();
    const before = w.dispatcher.getHistory().length;
    const prisma = mockPrisma({ 'en-IN': 'mmm the uh', 'te-IN': 'జూమ్ ఇన్', 'hi-IN': 'ज़ूम इन' });
    const heard = await transcribeWithLanguageRetry(new Blob(), 'en-IN', prisma.fn, understoodBy(w));
    assert.deepEqual([heard.text, heard.language], ['mmm the uh', 'en-IN']);
    const r = handleVoiceTurn({ transcript: heard.text, language: heard.language, dispatcher: w.dispatcher, model: gearbox, allModels: ALL, teachingAvailable: true });
    assert.equal(r.records.length, 0);
    assert.equal(w.dispatcher.getHistory().length, before);
  });
});
