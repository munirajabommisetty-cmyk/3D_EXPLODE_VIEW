/**
 * Voice-turn timing (Milestone B): lightweight latency marks for one voice turn, measured with
 * performance.now(). No audio, transcript text or keys are recorded: only stage names, durations,
 * the turn language and how many external calls the turn made.
 *
 * Stages (all optional): recordStart, recordEnd, sttStart, transcript, parsed, interpretStart,
 * interpretEnd, captionShown, teachStart, firstStep (first complete speakable step of a streamed
 * answer), ttsStart, ttsFirstAudioReady, firstAudio, teachEnd, responseDone.
 * A turn without a streamed answer is closed by its first audio; a streamed answer keeps the turn
 * open until the answer finished (teachEnd), so its late stages are measured too.
 * A turn's summary is logged (console.debug in development) when the next turn begins or when it
 * produces its first audio, and kept in a short in-memory list (window.__voiceTimings in dev).
 */

export type TimingMark =
  | 'recordStart' | 'recordEnd' | 'sttStart' | 'transcript' | 'parsed' | 'interpretStart' | 'interpretEnd'
  | 'captionShown' | 'teachStart' | 'firstToken' | 'firstStep' | 'teachEnd' | 'ttsStart' | 'ttsFirstAudioReady' | 'firstAudio' | 'responseDone';

export type CallKind = 'stt' | 'interpret' | 'teach' | 'tts';

export interface TurnTiming {
  turn: number;
  marks: Partial<Record<TimingMark, number>>;
  calls: Record<CallKind, number>;
  language?: string;
  /** e.g. 'understood' | 'switched' | 'ambiguous' | 'pinned' | 'teach' | 'fallback' */
  notes: string[];
}

export interface TurnSummary {
  turn: number;
  language?: string;
  notes: string[];
  calls: Record<CallKind, number>;
  /** Milliseconds from the end of recording (or the first mark) to each stage. */
  recordEndToTranscript?: number;
  recordEndToCaption?: number;
  recordEndToFirstAudio?: number;
  sttMs?: number;
  interpretMs?: number;
  teachMs?: number;
  /** Streamed answers: teaching request -> first complete step / first audio ready / first audio heard. */
  teachToFirstStep?: number;
  teachToFirstAudioReady?: number;
  teachToFirstAudio?: number;
  /** Streamed answers: ms from llmStartedAt (= 0) to each stage, under the names used in reports. */
  timeline?: {
    llmStartedAt: 0;
    firstTokenAt?: number;
    firstSpeakableChunkAt?: number;
    firstTtsStartedAt?: number;
    firstAudioReadyAt?: number;
    firstAudioPlaybackStartedAt?: number;
    llmCompletedAt?: number;
    audioPlaybackCompletedAt?: number;
    /** The key check: audio was heard before the answer was fully written. */
    audioBeforeLlmCompleted?: boolean;
  };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class VoiceTimingLog {
  private current: TurnTiming | null = null;
  private readonly history: TurnSummary[] = [];
  private readonly clock: () => number;
  private readonly log: (s: TurnSummary) => void;

  constructor(opts: { clock?: () => number; log?: (s: TurnSummary) => void } = {}) {
    this.clock = opts.clock ?? now;
    this.log = opts.log ?? (() => {});
  }

  /** Starts timing a new turn (finishing the previous one). */
  public begin(turn: number): void {
    this.finish();
    this.current = { turn, marks: {}, calls: { stt: 0, interpret: 0, teach: 0, tts: 0 }, notes: [] };
  }

  /** Records a stage once per turn (later calls for the same stage are ignored). */
  public mark(name: TimingMark, turn?: number): void {
    const c = this.current;
    if (!c || (turn !== undefined && turn !== c.turn) || c.marks[name] !== undefined) return;
    c.marks[name] = this.clock();
    const teaching = c.marks.teachStart !== undefined;
    if ((name === 'firstAudio' && !teaching) || name === 'responseDone') this.finish();
  }

  public count(kind: CallKind, turn?: number): void {
    const c = this.current;
    if (!c || (turn !== undefined && turn !== c.turn)) return;
    c.calls[kind] += 1;
  }

  public note(text: string, language?: string): void {
    if (!this.current) return;
    this.current.notes.push(text);
    if (language) this.current.language = language;
  }

  /** Summary of the turn in progress (null if none). */
  public peek(): TurnSummary | null {
    return this.current ? summarise(this.current) : null;
  }

  public recent(): readonly TurnSummary[] {
    return this.history;
  }

  private finish(): void {
    const c = this.current;
    if (!c) return;
    this.current = null;
    const s = summarise(c);
    this.history.push(s);
    if (this.history.length > 20) this.history.shift();
    try {
      this.log(s);
    } catch {
      // logging never breaks a turn
    }
  }
}

const diff = (a?: number, b?: number) => (a !== undefined && b !== undefined ? Math.round(b - a) : undefined);

export function summarise(t: TurnTiming): TurnSummary {
  const m = t.marks;
  const origin = m.recordEnd ?? m.sttStart ?? m.parsed;
  return {
    turn: t.turn, language: t.language, notes: [...t.notes], calls: { ...t.calls },
    recordEndToTranscript: diff(origin, m.transcript),
    recordEndToCaption: diff(origin, m.captionShown),
    recordEndToFirstAudio: diff(origin, m.firstAudio),
    sttMs: diff(m.sttStart, m.transcript),
    interpretMs: diff(m.interpretStart, m.interpretEnd),
    teachMs: diff(m.teachStart, m.teachEnd),
    ...(m.firstStep !== undefined ? {
      teachToFirstStep: diff(m.teachStart, m.firstStep),
      teachToFirstAudioReady: diff(m.teachStart, m.ttsFirstAudioReady),
      teachToFirstAudio: diff(m.teachStart, m.firstAudio),
      timeline: {
        llmStartedAt: 0 as const,
        firstTokenAt: diff(m.teachStart, m.firstToken),
        firstSpeakableChunkAt: diff(m.teachStart, m.firstStep),
        firstTtsStartedAt: diff(m.teachStart, m.ttsStart),
        firstAudioReadyAt: diff(m.teachStart, m.ttsFirstAudioReady),
        firstAudioPlaybackStartedAt: diff(m.teachStart, m.firstAudio),
        llmCompletedAt: diff(m.teachStart, m.teachEnd),
        audioPlaybackCompletedAt: diff(m.teachStart, m.responseDone),
        ...(m.firstAudio !== undefined && m.teachEnd !== undefined ? { audioBeforeLlmCompleted: m.firstAudio < m.teachEnd } : {}),
      },
    } : {}),
  };
}

/** The app's shared log (development builds print each turn's summary). */
export const voiceTiming = new VoiceTimingLog({
  log: (s) => {
    if (import.meta.env?.DEV) {
      console.debug('[voice-timing]', s);
      (globalThis as unknown as { __voiceTimings?: readonly TurnSummary[] }).__voiceTimings = voiceTiming.recent();
    }
  },
});
