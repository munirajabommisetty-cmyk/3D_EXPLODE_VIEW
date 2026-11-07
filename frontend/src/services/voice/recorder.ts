/**
 * Browser voice recorder (Task V2): microphone -> 16 kHz mono WAV for Gnani Prisma.
 *
 * - Automatic end-of-speech (SpeechEndDetector): recording stops ~1.1 s after the speaker stops,
 *   judged against both the background noise and the speaker's own level.
 * - Hard cap of 25 s (Prisma's documented ideal is ≤ 30 s).
 * - cancel() stops immediately and discards the audio.
 * The pure pieces (WAV encoding, end-of-speech state machine) are exported for unit tests.
 */

export const TARGET_SAMPLE_RATE = 16000;
export const MAX_RECORDING_MS = 25000;
export const END_SILENCE_MS = 1100;
export const NO_SPEECH_MS = 8000;
/** A real microphone always picks up some noise; samples that stay exactly 0 this long mean the
 *  input is muted (Windows / hardware mute key) or disconnected. Seen live: every sample 0.0.
 *  3 s, not less: some devices (Bluetooth headsets switching profile) deliver zeros for 1-2 s
 *  while starting, which must not be reported as a muted microphone. */
export const SILENT_INPUT_MS = 3000;
/** No audio frames at all this long after starting: the browser's audio engine is not running. */
export const AUDIO_START_TIMEOUT_MS = 2500;
/** How long a recording waits while the system keeps the track muted (Chrome sets track.muted when
 *  Windows / the mic key mutes the device; seen live: muted from the first to the last frame). The
 *  learner is told at once and can unmute; recording then continues. Only after this long is it
 *  reported as a failure. */
export const TRACK_MUTED_WAIT_MS = 15000;

/** Manual stop with no speech detected: below this peak nothing audible was said (room noise
 *  only), so it is not worth a Prisma call. Same level the backend diagnostics call "loud". */
export const AUDIBLE_PEAK = 0.015;

/** What a manual stop means. Speech the detector heard is always kept (short replies included);
 *  a recording that is all zeros is a muted microphone; otherwise it is kept only if something
 *  audible was picked up (a quiet word the adaptive detector did not count). */
export function manualStopReason(
  speechStarted: boolean, voicedMs: number, frames: number, peak: number
): 'manual' | 'nospeech' | 'micSilent' {
  if (isDigitalSilence(peak)) return 'micSilent';
  if (speechStarted || voicedMs >= SHORT_REPLY_MS) return 'manual';
  return frames > 8 && peak >= AUDIBLE_PEAK ? 'manual' : 'nospeech';
}

/** True when the input carried no signal at all (exact digital silence, not a quiet room). */
export function isDigitalSilence(peak: number): boolean {
  return peak === 0;
}

export type MicErrorCode = 'MIC_DENIED' | 'MIC_NOT_FOUND' | 'MIC_BUSY' | 'MIC_UNSUPPORTED' | 'MIC_ERROR';

export class MicError extends Error {
  public readonly code: MicErrorCode;
  constructor(code: MicErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function classifyMicError(err: unknown): MicError {
  const name = (err as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return new MicError('MIC_DENIED', 'Microphone permission was denied.');
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new MicError('MIC_NOT_FOUND', 'No microphone was found.');
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return new MicError('MIC_BUSY', 'The microphone is in use by another application.');
  }
  return new MicError('MIC_ERROR', 'The microphone could not be started.');
}

/** Root-mean-square level of a sample frame. */
export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return frame.length ? Math.sqrt(sum / frame.length) : 0;
}

/** Encodes float32 chunks as 16-bit PCM mono WAV, downsampling with block averaging. */
export function encodeWav(chunks: Float32Array[], inRate: number, outRate = TARGET_SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const all = new Float32Array(len);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  const ratio = inRate / outRate;
  const n = Math.max(0, Math.floor(len / ratio));
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (p: number, s: string) => [...s].forEach((ch, i) => v.setUint8(p + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, outRate, true); v.setUint32(28, outRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(len, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += all[j];
    const x = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export type SpeechEndReason = 'silence' | 'max' | 'nospeech';

/** Start-up window: the tail of the tutor's own voice and the microphone's start-up pop. */
export const START_GRACE_MS = 300;
/** Voiced audio needed before it counts as speech (a click or a speaker tail is shorter). */
export const MIN_SPEECH_MS = 240;
/** A very short reply ("Yes.") followed by this much quiet ends the turn and is kept. */
export const SHORT_REPLY_MS = 150;
export const SHORT_REPLY_QUIET_MS = 1300;

/**
 * End-of-speech detector. Feed it each frame's RMS level and duration; it returns a reason when
 * recording should stop, otherwise null.
 *
 *  - Noise floor: follows the quietest recent audio (falls fast, rises ~30 %/s), starting from a
 *    quiet-room value, so speaking the moment the mic opens is heard.
 *  - Speech starts after MIN_SPEECH_MS of voiced audio, not counting the first START_GRACE_MS.
 *    (Root cause of "I didn't catch that" after the tutor's question, 6 Nov 2026: the learner
 *    pressed the mic right after the tutor spoke; ~130 ms of playback tail / start-up pop counted
 *    as speech, then 1.1 s of silence ended the turn before the learner answered, and Prisma
 *    correctly returned an empty transcript.)
 *  - A short reply (SHORT_REPLY_MS voiced, e.g. "Yes.") followed by SHORT_REPLY_QUIET_MS of quiet
 *    ends the turn and is kept, instead of waiting for the no-speech timeout and discarding it.
 *  - Silence is judged against the speaker's own level as well as the floor: a frame counts as
 *    silent below half the running speech level, so a fluctuating background (TV, traffic, fan)
 *    does not keep the microphone open until the 25 s cap.
 *  - END_SILENCE_MS of silence after speech ends the turn; a short thinking pause does not.
 */
export class SpeechEndDetector {
  private floor = 0.004;
  private silentMs = 0;
  private elapsedMs = 0;
  private speechLevel = 0;
  private voicedMs = 0;
  private quietMs = 0;
  public speechStarted = false;
  /** Diagnostics only (read, never used for decisions): when speech was judged to start, and
   *  whether the last frame counted as voiced. */
  public onsetMs: number | null = null;
  public lastFrameVoiced = false;

  public push(level: number, frameMs: number): SpeechEndReason | null {
    this.elapsedMs += frameMs;
    const speechTh = Math.max(this.floor * 3, 0.015);
    const loud = level > speechTh;
    // Noise floor: fast fall, slow rise (a steady fan is learned within a few seconds)
    if (level < this.floor) this.floor = Math.max(0.002, 0.6 * this.floor + 0.4 * level);
    else this.floor = Math.min(level, this.floor * (1 + 0.3 * (frameMs / 1000)));
    const counted = this.elapsedMs > START_GRACE_MS;
    this.lastFrameVoiced = counted && loud;
    // The speaker's level: only frames that are plausibly the speaker (not background bursts)
    if (counted && loud && level > this.speechLevel * 0.5) {
      this.speechLevel = this.speechLevel === 0 ? level : 0.8 * this.speechLevel + 0.2 * level;
    }

    if (!this.speechStarted) {
      if (counted) {
        if (loud) {
          this.voicedMs += frameMs;
          this.quietMs = 0;
          if (this.voicedMs >= MIN_SPEECH_MS) {
            this.speechStarted = true;
            this.onsetMs = this.elapsedMs;
          }
        } else {
          this.quietMs += frameMs;
          if (this.voicedMs >= SHORT_REPLY_MS && this.quietMs >= SHORT_REPLY_QUIET_MS) return 'silence';
          if (this.voicedMs < SHORT_REPLY_MS && this.quietMs >= 700) this.voicedMs = 0; // a click: forget it
        }
      }
      if (!this.speechStarted && this.elapsedMs > NO_SPEECH_MS) return 'nospeech';
    } else {
      const silenceTh = Math.max(this.floor * 2, 0.008, this.speechLevel * 0.5);
      this.silentMs = level < silenceTh ? this.silentMs + frameMs : 0;
      if (this.silentMs >= END_SILENCE_MS) return 'silence';
    }
    if (this.elapsedMs >= MAX_RECORDING_MS) return 'max';
    return null;
  }

  /** Voiced audio heard so far (ms), for the manual stop: keep it when something was said. */
  public get voiced(): number {
    return this.voicedMs;
  }
}

/** Metadata about one recording (numbers only: never audio or words). Diagnostics. */
export interface RecordingStats {
  inputSampleRate: number;
  channelCount: number;
  durationMs: number;
  frames: number;
  endReason: string;
  /** The app's speech detector: when it decided speech started; total time of frames it counted as
   *  voiced; first / last voiced frame. */
  vadOnsetMs: number | null;
  vadVoicedMs: number;
  vadFirstVoicedMs: number | null;
  vadLastVoicedMs: number | null;
  /** Raw input loudness (0..1): mean frame RMS and the largest sample. */
  avgRms: number;
  peak: number;
  /** Fraction of samples that are exactly 0 (1 = the device delivered digital silence). */
  zeroFraction: number;
  /** Capture chain (numbers / short codes only): track state at start and end, audio engine
   *  state, and a short hash of the browser's device id (never the id or the device name). */
  deviceHash?: string;
  trackEnabled?: number;
  trackMutedAtStart?: number;
  trackMutedAtEnd?: number;
  trackReadyState?: string;
  audioContextState?: string;
}

/** What the browser opened (diagnostics). The label is shown to the user, never logged. */
export interface CaptureInfo {
  deviceLabel: string;
  deviceHash: string;
  trackEnabled: boolean;
  trackMutedAtStart: boolean;
  audioContextState: string;
}

/** Short, non-reversible tag for a device id (FNV-1a), so diagnostics can tell devices apart. */
export function deviceTag(deviceId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < deviceId.length; i++) {
    h ^= deviceId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return deviceId ? h.toString(16).padStart(8, '0') : 'none';
}

/** Collects RecordingStats from the frames the recorder already processes (observation only). */
export class RecordingStatsCollector {
  private durationMs = 0;
  private frames = 0;
  private rmsSum = 0;
  private peak = 0;
  private firstVoiced: number | null = null;
  private lastVoiced: number | null = null;
  private voicedMs = 0;
  private samples = 0;
  private zeros = 0;
  private readonly inputSampleRate: number;
  private readonly channelCount: number;

  constructor(inputSampleRate: number, channelCount: number) {
    this.inputSampleRate = inputSampleRate;
    this.channelCount = channelCount;
  }

  get frameCount(): number {
    return this.frames;
  }

  /** One frame: its samples (for the peak), its RMS level, its length and the detector's view of it. */
  push(frame: Float32Array | null, level: number, frameMs: number, voiced: boolean): void {
    this.durationMs += frameMs;
    this.frames += 1;
    this.rmsSum += level;
    if (frame) {
      for (let i = 0; i < frame.length; i++) {
        this.peak = Math.max(this.peak, Math.abs(frame[i]));
        if (frame[i] === 0) this.zeros++;
      }
      this.samples += frame.length;
    }
    if (voiced) {
      this.voicedMs += frameMs;
      if (this.firstVoiced === null) this.firstVoiced = this.durationMs - frameMs;
      this.lastVoiced = this.durationMs;
    }
  }

  result(endReason: string, detector: Pick<SpeechEndDetector, 'onsetMs'>): RecordingStats {
    const r = (n: number) => Math.round(n * 10000) / 10000;
    return {
      inputSampleRate: this.inputSampleRate,
      channelCount: this.channelCount,
      durationMs: Math.round(this.durationMs),
      frames: this.frames,
      endReason,
      vadOnsetMs: detector.onsetMs === null ? null : Math.round(detector.onsetMs),
      vadVoicedMs: Math.round(this.voicedMs),
      vadFirstVoicedMs: this.firstVoiced === null ? null : Math.round(this.firstVoiced),
      vadLastVoicedMs: this.lastVoiced === null ? null : Math.round(this.lastVoiced),
      avgRms: r(this.frames ? this.rmsSum / this.frames : 0),
      peak: r(this.peak),
      zeroFraction: r(this.samples ? this.zeros / this.samples : 0),
    };
  }
}

export interface RecordingResult {
  wav: Blob | null;
  /** micSilent: the device delivered only exact zeros; trackMuted: the browser / system paused the
   *  track; trackEnded: the device went away; audioStalled: the audio engine produced no frames. */
  reason: SpeechEndReason | 'manual' | 'cancelled' | 'micSilent' | 'trackMuted' | 'trackEnded' | 'audioStalled';
  /** Diagnostics: metadata about the recording (never the audio). */
  stats?: RecordingStats;
  /** Which microphone the browser opened, for messages shown to the user. */
  capture?: CaptureInfo;
}

export interface ActiveRecording {
  /** Stop now and keep what was said. */
  stop: () => void;
  /** Stop now and discard everything. */
  cancel: () => void;
  /** Resolves when recording ends (any reason). */
  done: Promise<RecordingResult>;
}

/** Starts recording. Throws MicError on permission/device problems. `onTrackMuted` reports live
 *  when the system mutes / unmutes the microphone track (so the user can fix it mid-turn). */
export async function startRecording(
  onLevel?: (level: number) => void, onTrackMuted?: (muted: boolean) => void
): Promise<ActiveRecording> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new MicError('MIC_UNSUPPORTED', 'This browser cannot record audio.');
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (err) {
    throw classifyMicError(err);
  }
  const track = stream.getAudioTracks()[0];
  if (!track || track.readyState === 'ended') {
    stream.getTracks().forEach((t) => t.stop());
    throw new MicError('MIC_ERROR', 'The microphone opened but delivered no audio track.');
  }
  const settings = track.getSettings?.() ?? {};
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  let ctx: AudioContext;
  try {
    ctx = new AudioCtx();
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    throw new MicError('MIC_ERROR', 'The browser audio engine could not be started.');
  }
  // Created after an await, the context can start suspended: then no audio is processed at all
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  const capture: CaptureInfo = {
    deviceLabel: track.label || 'the microphone',
    deviceHash: deviceTag(String(settings.deviceId ?? '')),
    trackEnabled: track.enabled,
    trackMutedAtStart: track.muted,
    audioContextState: ctx.state,
  };
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  const frameMs = (2048 / ctx.sampleRate) * 1000;
  const chunks: Float32Array[] = [];
  let detector = new SpeechEndDetector();
  const channelCount = settings.channelCount ?? 1;
  const stats = new RecordingStatsCollector(ctx.sampleRate, channelCount);
  let finished = false;
  let inputPeak = 0;
  let elapsedMs = 0;
  // Muted by the system: wait (nothing recorded, no speech detection) instead of failing at once
  let trackMuted = track.muted;
  let mutedMs = 0;
  let resolveDone!: (r: RecordingResult) => void;
  const done = new Promise<RecordingResult>((r) => (resolveDone = r));

  const finish = (reason: RecordingResult['reason']) => {
    if (finished) return;
    finished = true;
    clearTimeout(startWatchdog);
    track.onended = null;
    track.onmute = null;
    track.onunmute = null;
    const trackMutedAtEnd = track.muted;
    const trackReadyState = track.readyState;
    proc.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    const keep = (reason === 'silence' || reason === 'max' || reason === 'manual') && chunks.length > 0;
    const wav = keep ? new Blob([encodeWav(chunks, ctx.sampleRate)], { type: 'audio/wav' }) : null;
    const audioContextState = ctx.state;
    void ctx.close();
    resolveDone({
      wav, reason, capture,
      stats: {
        ...stats.result(reason, detector),
        deviceHash: capture.deviceHash,
        trackEnabled: capture.trackEnabled ? 1 : 0,
        trackMutedAtStart: capture.trackMutedAtStart ? 1 : 0,
        trackMutedAtEnd: trackMutedAtEnd ? 1 : 0,
        trackReadyState,
        audioContextState,
      },
    });
  };

  proc.onaudioprocess = (e) => {
    if (finished) return;
    const frame = new Float32Array(e.inputBuffer.getChannelData(0));
    if (trackMuted) {
      // The system delivers zeros while muted: they are not the learner's silence, so they are
      // neither recorded nor judged by the speech detector
      stats.push(frame, 0, frameMs, false);
      onLevel?.(0);
      mutedMs += frameMs;
      if (mutedMs >= TRACK_MUTED_WAIT_MS) finish('trackMuted');
      return;
    }
    chunks.push(frame);
    const level = rms(frame);
    onLevel?.(level);
    const end = detector.push(level, frameMs);
    stats.push(frame, level, frameMs, detector.lastFrameVoiced); // observation only
    for (let i = 0; i < frame.length; i++) inputPeak = Math.max(inputPeak, Math.abs(frame[i]));
    elapsedMs += frameMs;
    // Only exact zeros for 3 s: nothing to transcribe, so never send it to speech recognition.
    // The browser saying the track is muted is reported as that (a different cause and fix).
    if (elapsedMs >= SILENT_INPUT_MS && isDigitalSilence(inputPeak)) finish('micSilent');
    else if (end) finish(end);
  };
  // The device went away (unplugged, taken by the system) while recording
  track.onended = () => finish('trackEnded');
  track.onmute = () => {
    if (finished) return;
    // Muted after the learner had started speaking (e.g. the mic key): keep what was said
    if (detector.speechStarted) return finish('manual');
    trackMuted = true;
    onTrackMuted?.(true);
  };
  track.onunmute = () => {
    if (finished) return;
    trackMuted = false;
    mutedMs = 0;
    // Start listening afresh from the moment sound is available again
    detector = new SpeechEndDetector();
    chunks.length = 0;
    inputPeak = 0;
    elapsedMs = 0;
    onTrackMuted?.(false);
  };
  if (trackMuted) onTrackMuted?.(true);
  // The audio engine never delivered a frame: say so instead of "Listening..." forever
  const startWatchdog = setTimeout(() => {
    if (!finished && stats.frameCount === 0) finish('audioStalled');
  }, AUDIO_START_TIMEOUT_MS);
  source.connect(proc);
  proc.connect(ctx.destination);

  return {
    stop: () => {
      if (trackMuted) return finish('trackMuted');
      if (stats.frameCount === 0) return finish('audioStalled');
      finish(manualStopReason(detector.speechStarted, detector.voiced, chunks.length, inputPeak));
    },
    cancel: () => finish('cancelled'),
    done,
  };
}
