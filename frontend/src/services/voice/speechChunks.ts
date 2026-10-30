/**
 * Speech chunking (voice latency milestone).
 *
 * Gnani Timbre returns one complete WAV per request (no streaming audio in the documented
 * /api/v1/tts/inference API), so long text is spoken as a sequence of sentence-sized requests: the
 * first sentence is synthesized and starts playing while the next ones are still being made.
 *
 * Rules: split only at sentence ends (. ! ? । ॥ and their full-width forms), then at clause marks
 * (, ; :) and finally at spaces, never inside a word, so Telugu/Devanagari/Bengali grapheme
 * clusters (consonant + vowel sign + virama) are never cut. Very short sentences are merged with
 * the next one (no one-word clips); the first chunk is kept short so audio starts sooner.
 * Markdown and formatting symbols are removed: they must never be read aloud.
 */

export interface SpeechChunkOptions {
  /** Hard limit per TTS request (backend MAX_TTS_CHARS is 400). */
  maxChars?: number;
  /** Shorter sentences are merged with the next one. */
  minChars?: number;
  /** The first chunk may be as short as this (it decides time-to-first-audio). */
  firstMinChars?: number;
}

/** Removes markdown / formatting that must not be spoken; keeps the words. */
export function speakableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]+?)\1/g, '$2')
    .replace(/[*#_~>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SENTENCE_END = /(?<=[.!?।॥？！。])\s+/u;
const CLAUSE_END = /(?<=[,;:،、，；])\s+/u;

/** Splits text into speakable chunks (see the rules above). Empty text gives no chunks. */
export function splitSpeech(text: string, opts: SpeechChunkOptions = {}): string[] {
  const max = opts.maxChars ?? 380;
  const min = opts.minChars ?? 40;
  const firstMin = opts.firstMinChars ?? 12;
  const clean = speakableText(text);
  if (!clean) return [];

  // 1. sentences, each at most `max` (long ones broken at clauses, then at word boundaries)
  const pieces: string[] = [];
  for (const sentence of clean.split(SENTENCE_END)) {
    if (sentence.length <= max) {
      if (sentence) pieces.push(sentence);
      continue;
    }
    let part = '';
    for (const clause of sentence.split(CLAUSE_END)) {
      for (const unit of clause.length <= max ? [clause] : byWords(clause, max)) {
        if (part && part.length + 1 + unit.length > max) {
          pieces.push(part);
          part = unit;
        } else {
          part = part ? `${part} ${unit}` : unit;
        }
      }
    }
    if (part) pieces.push(part);
  }

  // 2. merge short pieces (the first chunk only needs `firstMin`, so speech starts early)
  const out: string[] = [];
  let cur = '';
  for (const p of pieces) {
    const need = out.length === 0 ? firstMin : min;
    if (!cur) cur = p;
    else if (cur.length < need && cur.length + 1 + p.length <= max) cur = `${cur} ${p}`;
    else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) {
    // a very short tail joins the previous chunk when it fits
    const last = out[out.length - 1];
    if (last && cur.length < min / 2 && last.length + 1 + cur.length <= max) out[out.length - 1] = `${last} ${cur}`;
    else out.push(cur);
  }
  return out;
}

/** Words never split: a single word longer than `max` is kept whole (it cannot be cut safely). */
function byWords(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    if (cur && cur.length + 1 + word.length > max) {
      out.push(cur);
      cur = word;
    } else {
      cur = cur ? `${cur} ${word}` : word;
    }
  }
  if (cur) out.push(cur);
  return out;
}
