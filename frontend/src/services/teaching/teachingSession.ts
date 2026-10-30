/**
 * Teaching session (Task V4): connects a question to a played plan.
 *
 * question (already resolved by V3) -> fact pack -> /api/teach (LLM on the server)
 *   -> validateTeachingPlan (live scene) -> TeachingPlanPlayer (V1 dispatcher, source 'ai')
 *   -> Gnani Timbre narration per step, captions shown in sync.
 *
 * Stale protection: every request has a token; a reply that arrives after a newer question,
 * a Cancel, or a model switch is discarded and never played.
 */

import { useCallback, useEffect, useState } from 'react';
import type { EngineeringModelDefinition } from '../../types/models';
import type { SceneCommandDispatcher } from '../commands/sceneCommandDispatcher';
import { getSceneSnapshot } from '../scene/sceneSnapshot';
import type { TeachingRequestInfo } from '../voice/voiceSession';
import { synthesize, type VoiceServiceError } from '../voice/voiceClient';
import { streamTeachingPlan } from './teachingClient';
import { createChunkedClip, createLiveClip, type AudioLike, type ChunkedClipDeps } from './chunkedNarration';
import { sharedLlmAvailability } from './llmAvailability';
import { voiceTiming } from '../voice/voiceTiming';
import type { TeachingPlan } from './teachingPlan';
import { TeachingPlanPlayer, type NarrationClip, type Narrator, type PlayerState } from './planPlayer';
import { TeachingController, teachLanguage, type AskResult, type TeachingControllerState } from './teachingController';

export { TEACHING_LANGUAGES } from './teachingController';

/**
 * Gnani Timbre narrator. prepare() starts fetching the first sentence's audio at once (so the next
 * step's audio is ready when needed). Each narration is spoken sentence by sentence
 * (chunkedNarration.ts): the first sentence plays while the rest is still being synthesized.
 * done resolves when the last chunk really ended. If speech fails, the caption stays up for a
 * reading-time fallback (paused with the plan) so the lesson continues.
 */
export function createTimbreNarrator(getLanguage: () => string, onSpeechError: (msg: string) => void): Narrator {
  // TTS requests run one at a time (prefetching in parallel triggered Gnani rate limits, 429),
  // with one retry after a short wait if Gnani still says "too many requests".
  let queue: Promise<unknown> = Promise.resolve();
  const synthesizeOnce = async (text: string, language: string, signal: AbortSignal): Promise<Blob> => {
    voiceTiming.count('tts');
    try {
      return await synthesize(text, language, signal);
    } catch (err) {
      if ((err as VoiceServiceError).code !== 'GNANI_RATE_LIMIT' || signal.aborted) throw err;
      await new Promise((r) => setTimeout(r, 1500));
      return synthesize(text, language, signal);
    }
  };
  const clipDeps = (lang: string): ChunkedClipDeps => ({
        // one synthesis at a time across all clips (the next step's first sentence queues behind)
        synth: (chunk, signal) => {
          const p = queue.then(() => {
            if (signal.aborted) return Promise.reject(new Error('stopped'));
            voiceTiming.mark('ttsStart');
            return synthesizeOnce(chunk, lang, signal);
          });
          queue = p.catch(() => undefined);
          return p;
        },
        makeAudio: (blob) => {
          const url = URL.createObjectURL(blob);
          const el = new Audio(url);
          const audio: AudioLike = {
            play: () => el.play(),
            pause: () => el.pause(),
            get ended() { return el.ended; },
            get onended() { return null; },
            set onended(f: (() => void) | null) { el.onended = f ? () => f() : null; },
            get onerror() { return null; },
            set onerror(f: (() => void) | null) { el.onerror = f ? () => f() : null; },
          };
          return {
            audio,
            release: () => {
              el.onended = null;
              el.onerror = null;
              el.pause();
              el.removeAttribute('src');
              URL.revokeObjectURL(url);
            },
          };
        },
        onError: onSpeechError,
        onFirstAudioReady: () => voiceTiming.mark('ttsFirstAudioReady'),
        onFirstAudioPlayed: () => voiceTiming.mark('firstAudio'),
  });
  return {
    // The plan's language (fixed when it was requested) wins over a later dock language change
    prepare: (text: string, language?: string): NarrationClip => createChunkedClip(text, clipDeps(teachLanguage(language ?? getLanguage()))),
    // Streamed answers: sentences are pushed while the AI teacher is still writing
    prepareLive: (language?: string) => createLiveClip(clipDeps(teachLanguage(language ?? getLanguage()))),
  };
}

export interface TeachingSession {
  state: PlayerState;
  pending: boolean;
  error: string | null;
  notice: string | null;
  question: string | null;
  plan: TeachingPlan | null;
  ask: (info: TeachingRequestInfo) => Promise<AskResult>;
  /** Plays an already-produced plan through the same validation (dev hook / tests). */
  playRaw: (raw: unknown, question?: string) => boolean;
  /** A new non-teaching request replaces the explanation (cancel + restore). */
  supersede: (reason?: string) => void;
  abortRequest: () => void;
  isActive: () => boolean;
  player: TeachingPlanPlayer;
}

/** Mutable holder for values read by long-lived callbacks (player, narrator, controller). */
class Latest<T> {
  private value: T;
  constructor(value: T) {
    this.value = value;
  }
  public get(): T {
    return this.value;
  }
  public set(value: T): void {
    this.value = value;
  }
}

export function useTeachingSession(opts: {
  dispatcher: SceneCommandDispatcher;
  model: EngineeringModelDefinition | undefined;
  language: string;
  onPlanStarted?: (plan: TeachingPlan) => void;
}): TeachingSession {
  const { dispatcher, model, language } = opts;
  const [latest] = useState(() => new Latest({ model, language, onPlanStarted: opts.onPlanStarted }));
  useEffect(() => {
    latest.set({ model, language, onPlanStarted: opts.onPlanStarted });
  });
  const [speechNote, setSpeechNote] = useState<string | null>(null);
  const [player] = useState(
    () => new TeachingPlanPlayer({
      dispatcher,
      getSnapshot: () => getSceneSnapshot(dispatcher, latest.get().model ?? null),
      narrator: createTimbreNarrator(() => latest.get().language, setSpeechNote),
    })
  );
  const [controller] = useState(
    () => new TeachingController({
      dispatcher,
      player,
      getModel: () => latest.get().model,
      getLanguage: () => latest.get().language,
      requestPlan: () => Promise.reject(new Error('unused: streaming is used')),
      // Voice latency milestone: the plan arrives step by step and step 1 is spoken while the
      // model is still writing the rest
      requestPlanStream: (body, signal, onEvent) => {
        voiceTiming.count('teach');
        voiceTiming.mark('teachStart');
        const done = () => voiceTiming.mark('teachEnd');
        const p = streamTeachingPlan(body, signal, (e) => {
          if (e.type === 'token') voiceTiming.mark('firstToken');
          if (e.type === 'narration' || e.type === 'step') voiceTiming.mark('firstStep');
          onEvent(e);
        }, undefined, { onFallback: () => voiceTiming.note('streamUnavailable') });
        p.then(done, done);
        return p;
      },
      availability: sharedLlmAvailability,
      onPlanStarted: (plan) => {
        setSpeechNote(null);
        latest.get().onPlanStarted?.(plan);
      },
    })
  );
  const [state, setState] = useState<PlayerState>(player.getState());
  const [ctl, setCtl] = useState<TeachingControllerState>(controller.getState());

  useEffect(() => player.subscribe(setState), [player]);
  // audioPlaybackCompletedAt: the explanation has finished (or was stopped)
  useEffect(() => player.subscribe((s) => {
    if (s.status === 'finished' || s.status === 'cancelled' || s.status === 'failed') voiceTiming.mark('responseDone');
  }), [player]);
  useEffect(() => controller.subscribe(setCtl), [controller]);
  // Manual-takeover watch; leaving the workspace stops the plan and its speech
  useEffect(() => {
    const detach = player.attach();
    return () => {
      detach();
      controller.cancel('Explanation stopped.');
    };
  }, [player, controller]);

  // A model switch invalidates pending work and forgets the old model's conversation
  useEffect(() => {
    controller.modelChanged(model?.id ?? null);
  }, [controller, model?.id]);

  const ask = useCallback((info: TeachingRequestInfo) => controller.ask(info), [controller]);
  const playRaw = useCallback((raw: unknown, q?: string) => controller.playRaw(raw, q), [controller]);
  const supersede = useCallback((reason?: string) => controller.supersede(reason), [controller]);
  const isActive = useCallback(() => controller.isActive(), [controller]);

  return {
    state,
    pending: ctl.pending,
    error: ctl.error ?? speechNote,
    notice: ctl.notice,
    question: ctl.question,
    plan: state.plan,
    ask,
    playRaw,
    supersede,
    abortRequest: supersede,
    isActive,
    player,
  };
}
