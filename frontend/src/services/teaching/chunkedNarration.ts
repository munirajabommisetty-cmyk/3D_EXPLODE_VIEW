/**
 * Chunked narration clip (voice latency milestone).
 *
 * One narration is spoken as a queue of sentence chunks (speechChunks.ts): chunk 1 is synthesized
 * first and plays as soon as its audio is ready, while chunk 2 is being synthesized, and so on.
 * Independently synthesized WAV files are never concatenated: each chunk is its own audio element,
 * played strictly one after another, so order is preserved and nothing overlaps.
 *
 *  - stop(): aborts pending synthesis, stops the playing chunk, releases every object URL; no
 *    chunk can start afterwards (a newer question can never be mixed with an older answer).
 *  - A chunk whose synthesis fails is replaced by a short reading-time pause (the caption stays on
 *    screen) and the next chunk continues: one failed request does not lose the whole answer.
 *  - pause()/resume() hold the queue (the plan player pauses on manual takeover).
 *
 * Live clips (createLiveClip) receive their text while the AI teacher is still writing it: each
 * pushed sentence is synthesized at once and plays as soon as the previous one has ended; close()
 * says no more text will come. Playback never waits for close(): close() only decides when the clip
 * is finished.
 */

import type { NarrationClip } from './planPlayer';
import { splitSpeech, type SpeechChunkOptions } from '../voice/speechChunks';

/** The part of HTMLAudioElement the queue uses (tests provide a fake). */
export interface AudioLike {
  play(): Promise<void>;
  pause(): void;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  readonly ended: boolean;
}

export interface ChunkedClipDeps {
  synth: (text: string, signal: AbortSignal) => Promise<Blob>;
  /** Creates an audio element for a blob; `release` frees it (URL.revokeObjectURL). */
  makeAudio: (blob: Blob) => { audio: AudioLike; release: () => void };
  /** A chunk could not be synthesized or played (shown as a note; the lesson continues). */
  onError?: (message: string) => void;
  /** Timing hooks: first chunk audio ready / first chunk audible. */
  onFirstAudioReady?: () => void;
  onFirstAudioPlayed?: () => void;
  /** Reading time for a chunk without audio (ms). */
  readingMs?: (text: string) => number;
  /** Polling interval for the reading-time fallback. */
  tickMs?: number;
  chunking?: SpeechChunkOptions;
}

/** A narration clip whose text arrives sentence by sentence. */
export interface LiveNarrationClip extends NarrationClip {
  readonly chunks: readonly string[];
  /** Adds text (split into speech chunks); ignored after close() or stop(). */
  push(text: string): void;
  /** No more text: the clip ends after the last pushed chunk has played. */
  close(): void;
}

export function createChunkedClip(text: string, deps: ChunkedClipDeps): LiveNarrationClip {
  const clip = createLiveClip(deps);
  clip.push(text);
  clip.close();
  return clip;
}

export function createLiveClip(deps: ChunkedClipDeps): LiveNarrationClip {
  const chunks: string[] = [];
  let closed = false;
  let wake: (() => void) | null = null;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const controller = new AbortController();
  const readingMs = deps.readingMs ?? ((t: string) => Math.min(9000, Math.max(1800, t.length * 65)));
  const tick = deps.tickMs ?? 100;

  // Synthesis runs one chunk at a time (Gnani rate limits parallel calls), always ahead of playback.
  const blobs = new Map<number, Promise<Blob>>();
  let chain: Promise<unknown> = Promise.resolve();
  const request = (i: number): Promise<Blob> => {
    const known = blobs.get(i);
    if (known) return known;
    const p = chain.then(() => (controller.signal.aborted ? Promise.reject(new Error('stopped')) : deps.synth(chunks[i], controller.signal)));
    chain = p.catch(() => undefined);
    blobs.set(i, p);
    return p;
  };

  let started = false;
  let paused = false;
  let stopped = false;
  let current: { audio: AudioLike; release: () => void } | null = null;
  let readyReported = false;
  let playedReported = false;
  let resolveDone!: (v: 'ended' | 'failed' | 'stopped') => void;
  const done = new Promise<'ended' | 'failed' | 'stopped'>((r) => (resolveDone = r));
  let anyFailed = false;
  let finished = false;
  const finish = (v: 'ended' | 'failed' | 'stopped') => {
    if (finished) return;
    finished = true;
    current?.release();
    current = null;
    resolveDone(v);
  };

  const waitUnpaused = () => new Promise<void>((resolve) => {
    const check = () => (stopped || !paused ? resolve() : setTimeout(check, tick));
    check();
  });

  /** Reading-time pause for a chunk without audio (honours pause/stop). */
  const readingPause = (chunk: string) => new Promise<void>((resolve) => {
    let left = readingMs(chunk);
    const timer = setInterval(() => {
      if (stopped) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (paused) return;
      left -= tick;
      if (left <= 0) {
        clearInterval(timer);
        resolve();
      }
    }, tick);
  });

  const playChunk = (blob: Blob) => new Promise<boolean>((resolve) => {
    const made = deps.makeAudio(blob);
    current = made;
    let settled = false;
    const end = (ok: boolean) => {
      if (settled) return;
      settled = true;
      made.release();
      if (current === made) current = null;
      resolve(ok);
    };
    made.audio.onended = () => end(true);
    made.audio.onerror = () => end(false);
    if (paused) return; // resume() starts it
    made.audio.play().then(
      () => {
        if (!playedReported) {
          playedReported = true;
          deps.onFirstAudioPlayed?.();
        }
      },
      () => {
        deps.onError?.('The browser blocked narration audio.');
        end(false);
      }
    );
  });

  const run = async () => {
    for (let i = 0; ; i++) {
      if (i >= chunks.length) {
        if (closed) break;
        // the next sentence is still being written: wait for it (or for close / stop)
        await new Promise<void>((res) => { wake = res; });
        if (stopped) return finish('stopped');
        if (i >= chunks.length) break;
      }
      if (i + 1 < chunks.length) void request(i + 1).catch(() => undefined); // synthesize ahead
      let blob: Blob | null = null;
      try {
        blob = await request(i);
      } catch (err) {
        if (stopped) return finish('stopped');
        anyFailed = true;
        deps.onError?.(`Narration unavailable: ${(err as Error).message}`);
      }
      if (stopped) return finish('stopped');
      await waitUnpaused();
      if (stopped) return finish('stopped');
      if (blob) {
        if (!readyReported) {
          readyReported = true;
          deps.onFirstAudioReady?.();
        }
        const ok = await playChunk(blob);
        if (stopped) return finish('stopped');
        if (!ok) {
          anyFailed = true;
          await readingPause(chunks[i]);
        }
      } else {
        await readingPause(chunks[i]);
      }
      if (stopped) return finish('stopped');
    }
    finish(anyFailed ? 'failed' : 'ended');
  };

  return {
    chunks,
    done,
    push(text: string) {
      if (closed || stopped) return;
      for (const c of splitSpeech(text, deps.chunking)) {
        chunks.push(c);
        void request(chunks.length - 1).catch(() => undefined); // synthesize at once (serially)
      }
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    play() {
      if (started || stopped) return;
      started = true;
      if (closed && !chunks.length) {
        finish('ended');
        return;
      }
      void run();
    },
    pause() {
      paused = true;
      current?.audio.pause();
    },
    resume() {
      paused = false;
      if (current && !current.audio.ended) void current.audio.play().catch(() => deps.onError?.('The browser blocked narration audio.'));
    },
    stop() {
      stopped = true;
      closed = true;
      controller.abort();
      current?.audio.pause();
      notify();
      finish('stopped');
    },
  };
}
