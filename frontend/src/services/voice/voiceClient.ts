/**
 * Voice backend client (Task V2). Talks only to our backend (/api/voice/*, proxied by Vite);
 * the Gnani key never reaches the browser. Every call can be cancelled with an AbortSignal.
 */

export interface VoiceLanguage {
  code: string;
  name: string;
  native: string;
  status: 'supported' | 'beta';
}

export interface VoiceHealth {
  keyConfigured: boolean;
  languages: VoiceLanguage[];
  /** Task V4: whether the server's teaching LLM is configured (never the key). */
  teaching?: { configured: boolean; model: string | null };
}

export type VoiceErrorCode =
  | 'BACKEND_UNAVAILABLE' | 'TIMEOUT' | 'CANCELLED'
  | 'KEY_MISSING' | 'GNANI_FORBIDDEN' | 'GNANI_AUTH' | 'GNANI_RATE_LIMIT' | 'GNANI_UNAVAILABLE'
  | 'GNANI_TIMEOUT' | 'GNANI_GATEWAY_TIMEOUT' | 'GNANI_UNREACHABLE' | 'GNANI_ERROR' | 'GNANI_BAD_REQUEST'
  | 'UNSUPPORTED_LANGUAGE' | 'UNSUPPORTED_AUDIO' | 'AUDIO_TOO_LARGE' | 'AUDIO_TOO_LONG' | 'AUDIO_TOO_SHORT'
  | 'EMPTY_TEXT' | 'TEXT_TOO_LONG' | 'UNKNOWN';

export class VoiceServiceError extends Error {
  public readonly code: VoiceErrorCode;
  constructor(code: VoiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Longer than the backend's own Gnani timeout (20 s), so the server reports a timeout first. */
export const CLIENT_TIMEOUT_MS = 25000;

/** Gnani / network failures that are temporary: worth a calm "please try again". */
export const TRANSIENT_VOICE_ERRORS: readonly VoiceErrorCode[] = [
  'TIMEOUT', 'GNANI_TIMEOUT', 'GNANI_GATEWAY_TIMEOUT', 'GNANI_UNAVAILABLE', 'GNANI_RATE_LIMIT', 'GNANI_ERROR', 'GNANI_UNREACHABLE',
];

/** User-facing explanation for each error code (English UI text). */
export const VOICE_ERROR_MESSAGES: Partial<Record<VoiceErrorCode, string>> = {
  BACKEND_UNAVAILABLE: 'Voice server is not running. Start it from backend/ with: python -m uvicorn app.main:app --port 8000',
  TIMEOUT: 'The voice service took too long. Please try again.',
  KEY_MISSING: 'Voice is not configured: GNANI_API_KEY is missing on the server.',
  GNANI_FORBIDDEN: 'Gnani refused the request — check the API key or remaining credits.',
  GNANI_AUTH: 'Gnani rejected the API key.',
  GNANI_RATE_LIMIT: 'Too many requests to Gnani. Please wait a moment.',
  GNANI_UNAVAILABLE: 'Gnani speech service is temporarily unavailable.',
  GNANI_TIMEOUT: 'Gnani took too long to respond.',
  GNANI_GATEWAY_TIMEOUT: 'Gnani timed out on its side (504). Please try again.',
  GNANI_UNREACHABLE: 'The server could not reach Gnani. Check the internet connection.',
  AUDIO_TOO_SHORT: 'That was too short — please speak a little longer.',
  AUDIO_TOO_LONG: 'Please keep commands under 30 seconds.',
};

type FetchLike = typeof fetch;

async function call(path: string, init: RequestInit, signal?: AbortSignal, fetchImpl: FetchLike = fetch): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), CLIENT_TIMEOUT_MS);
  const onAbort = () => controller.abort(new DOMException('cancelled', 'AbortError'));
  signal?.addEventListener('abort', onAbort);
  try {
    return await fetchImpl(path, { ...init, signal: controller.signal });
  } catch {
    if (signal?.aborted) throw new VoiceServiceError('CANCELLED', 'Cancelled.');
    if (controller.signal.aborted) throw new VoiceServiceError('TIMEOUT', VOICE_ERROR_MESSAGES.TIMEOUT!);
    throw new VoiceServiceError('BACKEND_UNAVAILABLE', VOICE_ERROR_MESSAGES.BACKEND_UNAVAILABLE!);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Turns a non-OK response into a VoiceServiceError (handles the proxy's HTML/empty 5xx when the backend is down). */
async function toError(resp: Response): Promise<VoiceServiceError> {
  let code: VoiceErrorCode = 'UNKNOWN';
  let message = `Voice request failed (${resp.status}).`;
  try {
    const body = await resp.json();
    if (body?.error?.code) {
      code = body.error.code as VoiceErrorCode;
      message = body.error.message ?? message;
    }
  } catch {
    if (resp.status === 502 || resp.status === 503 || resp.status === 504 || resp.status === 500) code = 'BACKEND_UNAVAILABLE';
  }
  return new VoiceServiceError(code, VOICE_ERROR_MESSAGES[code] ?? message);
}

/** Diagnostics for a recording that was not sent to Prisma (metadata only; the backend writes it
 *  only when VOICE_DIAG=1). Fire and forget: it can never affect the conversation. */
export function sendRecordingDiag(diag: Record<string, number | string | null>, fetchImpl: FetchLike = fetch): void {
  try {
    const form = new FormData();
    form.append('diag', JSON.stringify(diag));
    void fetchImpl('/api/voice/diag', { method: 'POST', body: form }).catch(() => undefined);
  } catch {
    // diagnostics only
  }
}

export async function getVoiceHealth(signal?: AbortSignal, fetchImpl?: FetchLike): Promise<VoiceHealth> {
  const resp = await call('/api/voice/health', { method: 'GET' }, signal, fetchImpl);
  if (!resp.ok) throw await toError(resp);
  try {
    return (await resp.json()) as VoiceHealth;
  } catch {
    throw new VoiceServiceError('BACKEND_UNAVAILABLE', VOICE_ERROR_MESSAGES.BACKEND_UNAVAILABLE!);
  }
}

export async function transcribe(wav: Blob, language: string, signal?: AbortSignal, fetchImpl?: FetchLike): Promise<string> {
  const form = new FormData();
  form.append('audio', wav, 'speech.wav');
  form.append('language', language);
  const resp = await call('/api/voice/transcribe', { method: 'POST', body: form }, signal, fetchImpl);
  if (!resp.ok) throw await toError(resp);
  const body = await resp.json();
  return String(body.transcript ?? '');
}

export interface AutoTranscript {
  text: string;
  /** Language Prisma detected (a supported code), or null when it could not judge (silence, only names). */
  language: string | null;
}

/** Errors on which the app falls back to the previous per-language transcription. */
export const AUTO_STT_FALLBACK_CODES = ['GNANI_BAD_REQUEST', 'UNSUPPORTED_LANGUAGE', 'INVALID_REQUEST'];

/**
 * One Prisma request with automatic language detection (Prisma v3.0 "indic-auto" on the backend).
 * `keyterms`: part names of the loaded model, to help Prisma with technical words.
 */
export async function transcribeAuto(
  wav: Blob, keyterms: string[], signal?: AbortSignal, fetchImpl?: FetchLike, diag?: Record<string, number | string | null>
): Promise<AutoTranscript> {
  const form = new FormData();
  form.append('audio', wav, 'speech.wav');
  form.append('language', 'auto');
  if (keyterms.length) form.append('keyterms', keyterms.slice(0, 60).join(','));
  // Diagnostics: recording metadata (numbers only); the backend logs it only when VOICE_DIAG=1
  if (diag) form.append('diag', JSON.stringify(diag));
  const resp = await call('/api/voice/transcribe', { method: 'POST', body: form }, signal, fetchImpl);
  if (!resp.ok) throw await toError(resp);
  const body = await resp.json();
  return { text: String(body.transcript ?? ''), language: typeof body.language === 'string' ? body.language : null };
}

export async function synthesize(text: string, language: string, signal?: AbortSignal, fetchImpl?: FetchLike): Promise<Blob> {
  const resp = await call(
    '/api/voice/speak',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, language }) },
    signal,
    fetchImpl
  );
  if (!resp.ok) throw await toError(resp);
  return await resp.blob();
}
