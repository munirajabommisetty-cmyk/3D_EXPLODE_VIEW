/**
 * Conversation language handling (voice-first milestone).
 *
 * Gnani Prisma must be told the language before it transcribes. Measured live (27 Oct 2026):
 * Telugu/Hindi speech sent as en-IN comes back as romanised phonetics ("idi asal educ avasar"),
 * and English speech sent as te-IN/hi-IN comes back transliterated ("షో మీ ద బ్యాక్"). So when the
 * user switches language without touching the selector, the first transcript is often not
 * understood. Then the SAME recording is transcribed in the other conversation languages and the
 * version that is understood wins; its language becomes the reply language and the new preference.
 * Extra Prisma calls happen only when the first transcript was not understood.
 *
 * Stage 1 (language reliability): switching is only allowed WITHIN the retry group (en/te/hi) and
 * only on unambiguous evidence. A transcript's script is a hint, not proof of the spoken language,
 * so when the evidence is missing or conflicting the selected language is kept:
 *  - Bengali and the other beta languages are never retried in other languages and never switched
 *    away from (the unclear turn goes to the normal "not understood" / clarification path).
 *  - A retry result is accepted only if its script matches its language (Telugu script for te-IN,
 *    Devanagari for hi-IN, Latin for en-IN) and it is the ONLY language that was understood; if
 *    several languages "understand" the same recording, nothing is switched.
 */

import { scriptLanguage } from './voiceSession';

/** Languages with full command, reply and teaching support (others stay beta). */
export const CONVERSATION_LANGUAGES = ['te-IN', 'hi-IN', 'en-IN'] as const;

/** True for the languages the cross-language retry may move between (en/te/hi). */
export function isRetryLanguage(language: string): boolean {
  return (CONVERSATION_LANGUAGES as readonly string[]).includes(language);
}

/**
 * Whether a transcript is written in the script that `language` produces: Telugu script for
 * te-IN, Devanagari for hi-IN, Latin letters (and no Indic script) for en-IN. Other languages
 * return false (no switching evidence).
 */
export function scriptMatches(text: string, language: string): boolean {
  const script = scriptLanguage(text);
  if (language === 'te-IN') return script === 'te-IN';
  if (language === 'hi-IN') return script === 'hi-IN';
  if (language === 'en-IN') return script === null && /[a-z]/i.test(text) && !/[\u0900-\u0DFF]/.test(text);
  return false;
}

/**
 * The language to answer in after the LLM interpretation fallback. The LLM's language guess is
 * only followed within the retry group and only when the transcript's script agrees with it;
 * otherwise (beta languages, romanised speech, conflicting signals) the current language is kept.
 */
export function interpretedLanguage(llmLanguage: string | null, transcript: string, current: string): string {
  if (!isRetryLanguage(current) || !llmLanguage || !isRetryLanguage(llmLanguage)) return current;
  return scriptMatches(transcript, llmLanguage) ? llmLanguage : current;
}

/**
 * The language a transcript was spoken in, given the selected UI language. Only within en/te/hi:
 * Telugu script means Telugu, Devanagari means Hindi, and Latin text while Telugu/Hindi is
 * selected means English. Bengali and the other beta languages (incl. Marathi, which shares
 * Devanagari with Hindi) always keep the selection: a script never moves those conversations.
 */
export function turnLanguage(text: string, uiLanguage: string): string {
  if (!isRetryLanguage(uiLanguage)) return uiLanguage;
  // Milestone A: Bengali script is unambiguous evidence (typed text). Prisma in en/te/hi never
  // writes Bengali script, so audio turns are unaffected.
  if (/[\u0980-\u09FF]/.test(text) && !/[\u0C00-\u0C7F\u0900-\u097F]/.test(text)) return 'bn-IN';
  const script = scriptLanguage(text);
  if (script === 'te-IN') return 'te-IN';
  if (script === 'hi-IN') return 'hi-IN';
  if (/[a-z]/i.test(text) && (uiLanguage === 'te-IN' || uiLanguage === 'hi-IN')) return 'en-IN';
  return uiLanguage;
}

export type TranscribeFn = (wav: Blob, language: string, signal?: AbortSignal) => Promise<string>;

export interface UnderstoodTranscript {
  text: string;
  language: string;
  /** True when other languages were tried because the first transcript was not understood. */
  retried: boolean;
}

/** Why a retry did not switch language (for logging / tests). */
export type RetryOutcome = 'understood' | 'switched' | 'none' | 'ambiguous' | 'notRetried';

export async function transcribeWithLanguageRetry(
  wav: Blob,
  uiLanguage: string,
  transcribeFn: TranscribeFn,
  understood: (text: string) => boolean,
  signal?: AbortSignal
): Promise<UnderstoodTranscript> {
  return (await transcribeWithLanguageRetryDetailed(wav, uiLanguage, transcribeFn, understood, signal)).result;
}

/** Same as transcribeWithLanguageRetry, plus why the language was (not) switched. */
export async function transcribeWithLanguageRetryDetailed(
  wav: Blob,
  uiLanguage: string,
  transcribeFn: TranscribeFn,
  understood: (text: string) => boolean,
  signal?: AbortSignal
): Promise<{ result: UnderstoodTranscript; outcome: RetryOutcome }> {
  const first = await transcribeFn(wav, uiLanguage, signal); // errors (incl. cancel) propagate
  const keep = (retried: boolean) => ({ text: first, language: turnLanguage(first, uiLanguage), retried });
  if (!first.trim() || understood(first)) return { result: keep(false), outcome: 'understood' };
  // Bengali and other beta languages: no extra Prisma calls, no switching away from the selection
  if (!isRetryLanguage(uiLanguage)) return { result: keep(false), outcome: 'notRetried' };
  const others = CONVERSATION_LANGUAGES.filter((l) => l !== uiLanguage);
  const results = await Promise.all(
    others.map((language) => transcribeFn(wav, language, signal).then((text) => ({ language, text }), () => ({ language, text: '' })))
  );
  if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
  // Evidence for a switch: understood AND written in that language's own script
  const hits = results.filter((r) => r.text.trim() && scriptMatches(r.text, r.language) && understood(r.text));
  if (hits.length === 1) return { result: { text: hits[0].text, language: hits[0].language, retried: true }, outcome: 'switched' };
  return { result: keep(true), outcome: hits.length === 0 ? 'none' : 'ambiguous' };
}

/* ------------------------------ Milestone A: auto-detect / manual override ------------------------------ */

export type LanguageMode = 'auto' | 'manual';

/** The language of the first Prisma call in auto mode: the conversation language when auto-detect
 *  can move between it and the others (en/te/hi), else English. */
export function autoStartLanguage(conversation: string): string {
  return isRetryLanguage(conversation) ? conversation : 'en-IN';
}

/**
 * Transcribes one recording for the dock's language mode.
 *  - manual: exactly one Prisma call in the pinned language; the language never changes.
 *  - auto: Stage 1 detection starting from the conversation language (a second and third call
 *    only when the first transcript is not understood).
 */
export async function transcribeForMode(
  wav: Blob,
  mode: LanguageMode,
  conversation: string,
  transcribeFn: TranscribeFn,
  understood: (text: string) => boolean,
  signal?: AbortSignal
): Promise<{ result: UnderstoodTranscript; outcome: RetryOutcome | 'pinned' }> {
  if (mode === 'manual') {
    const text = await transcribeFn(wav, conversation, signal);
    return { result: { text, language: conversation, retried: false }, outcome: 'pinned' };
  }
  return transcribeWithLanguageRetryDetailed(wav, autoStartLanguage(conversation), transcribeFn, understood, signal);
}
