/**
 * Browser voice recorder (Task V2): microphone -> 16 kHz mono WAV for Gnani Prisma.
 *
 * - Automatic end-of-speech: the first ~250 ms measure background noise; recording stops
 *   ~900 ms after speech falls back to that floor (works with fans, traffic, workshop noise).
 * - Hard cap of 25 s (Prisma's documented ideal is ≤ 30 s).
 * - cancel() stops immediately and discards the audio.
 * The pure pieces (WAV encoding, end-of-speech state machine) are exported for unit tests.
 */

export const TARGET_SAMPLE_RATE = 16000;
export const MAX_RECORDING_MS = 25000;
export const END_SILENCE_MS = 900;
export const NO_SPEECH_MS = 8000;

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

/**
 * End-of-speech detector. Feed it each frame's RMS level and duration; it returns a reason
 * when recording should stop, otherwise null. Adapts to the background noise level.
 */
export class SpeechEndDetector {
  private calib: number[] = [];
  private floor = 0.004;
  private loudFrames = 0;
  private silentMs = 0;
  private elapsedMs = 0;
  public speechStarted = false;

  public push(level: number, frameMs: number): SpeechEndReason | null {
    this.elapsedMs += frameMs;
    if (this.calib.length < 6) {
      this.calib.push(level);
      const sorted = [...this.calib].sort((a, b) => a - b);
      this.floor = Math.max(0.003, sorted[Math.floor(sorted.length / 2)]);
    }
    const speechTh = Math.max(this.floor * 3, 0.015);
    const silenceTh = Math.max(this.floor * 1.8, 0.008);
    if (!this.speechStarted) {
      this.loudFrames = level > speechTh ? this.loudFrames + 1 : 0;
      if (this.loudFrames >= 3) this.speechStarted = true;
      else if (this.calib.length >= 6) this.floor = 0.95 * this.floor + 0.05 * Math.min(level, this.floor * 2);
      if (!this.speechStarted && this.elapsedMs > NO_SPEECH_MS) return 'nospeech';
    } else {
      this.silentMs = level < silenceTh ? this.silentMs + frameMs : 0;
      if (this.silentMs >= END_SILENCE_MS) return 'silence';
    }
    if (this.elapsedMs >= MAX_RECORDING_MS) return 'max';
    return null;
  }
}

export interface RecordingResult {
  wav: Blob | null;
  reason: SpeechEndReason | 'manual' | 'cancelled';
}

export interface ActiveRecording {
  /** Stop now and keep what was said. */
  stop: () => void;
  /** Stop now and discard everything. */
  cancel: () => void;
  /** Resolves when recording ends (any reason). */
  done: Promise<RecordingResult>;
}

/** Starts recording. Throws MicError on permission/device problems. */
export async function startRecording(onLevel?: (level: number) => void): Promise<ActiveRecording> {
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
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  const frameMs = (2048 / ctx.sampleRate) * 1000;
  const chunks: Float32Array[] = [];
  const detector = new SpeechEndDetector();
  let finished = false;
  let resolveDone!: (r: RecordingResult) => void;
  const done = new Promise<RecordingResult>((r) => (resolveDone = r));

  const finish = (reason: RecordingResult['reason']) => {
    if (finished) return;
    finished = true;
    proc.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    const keep = reason !== 'cancelled' && reason !== 'nospeech' && chunks.length > 0;
    const wav = keep ? new Blob([encodeWav(chunks, ctx.sampleRate)], { type: 'audio/wav' }) : null;
    void ctx.close();
    resolveDone({ wav, reason });
  };

  proc.onaudioprocess = (e) => {
    if (finished) return;
    const frame = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(frame);
    const level = rms(frame);
    onLevel?.(level);
    const end = detector.push(level, frameMs);
    if (end) finish(end);
  };
  source.connect(proc);
  proc.connect(ctx.destination);

  return {
    stop: () => finish(detector.speechStarted || chunks.length > 8 ? 'manual' : 'nospeech'),
    cancel: () => finish('cancelled'),
    done,
  };
}
