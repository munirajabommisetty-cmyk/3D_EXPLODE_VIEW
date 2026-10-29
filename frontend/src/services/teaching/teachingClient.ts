/**
 * Teaching endpoint client (Task V4). Talks only to our backend (/api/teach); the LLM key stays
 * on the server. Cancellable; errors become TeachingServiceError with a stable code.
 */

import type { FactPack } from './factPack';

export interface TeachHistoryTurn {
  question: string;
  targetComponentId: string | null;
  title: string | null;
}

export interface TeachRequestBody {
  question: string;
  language: string;
  targetComponentId: string | null;
  /** Task V5: explain / howWorks / purpose / failure — shapes the explanation framework. */
  questionType?: string;
  facts: FactPack;
  history: TeachHistoryTurn[];
  /** Milestone A: narration in `language`, captions / summary in English. */
  bilingual?: boolean;
}

export class TeachingServiceError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const TEACH_TIMEOUT_MS = 45000;

export const TEACH_ERROR_MESSAGES: Record<string, string> = {
  LLM_NOT_CONFIGURED: 'Explanations are not set up: the server has no teaching model configured (LLM_BASE_URL, LLM_MODEL, LLM_API_KEY).',
  LLM_AUTH: 'The teaching model rejected the server key.',
  LLM_MODEL_NOT_FOUND: 'The configured teaching model is not available to this key.',
  LLM_RATE_LIMIT: 'Too many explanation requests. Please wait a moment.',
  LLM_QUOTA_EXCEEDED: 'The teaching model\'s usage quota is used up for now. Try again later.',
  LLM_TIMEOUT: 'The explanation took too long. Please try again.',
  LLM_UNREACHABLE: 'The server could not reach the teaching model.',
  LLM_UNAVAILABLE: 'The teaching model is temporarily unavailable.',
  LLM_MALFORMED: 'The teaching model gave an unusable answer. Please ask again.',
  PLAN_INVALID: 'The explanation could not be used safely with this model.',
  PLAN_UNSAFE: 'The explanation was rejected because it contained unsafe content.',
  PLAN_TOO_LONG: 'The explanation was too long to play.',
  BACKEND_UNAVAILABLE: 'The voice/teaching server is not running.',
  TIMEOUT: 'The explanation took too long. Please try again.',
};

type FetchLike = typeof fetch;

export async function requestTeachingPlan(body: TeachRequestBody, signal?: AbortSignal, fetchImpl: FetchLike = fetch): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEACH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  let resp: Response;
  try {
    resp = await fetchImpl('/api/teach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    if (signal?.aborted) throw new TeachingServiceError('CANCELLED', 'Cancelled.');
    if (controller.signal.aborted) throw new TeachingServiceError('TIMEOUT', TEACH_ERROR_MESSAGES.TIMEOUT);
    throw new TeachingServiceError('BACKEND_UNAVAILABLE', TEACH_ERROR_MESSAGES.BACKEND_UNAVAILABLE);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  let data: { plan?: unknown; error?: { code?: string; message?: string } } | null = null;
  try {
    data = await resp.json();
  } catch {
    throw new TeachingServiceError('BACKEND_UNAVAILABLE', TEACH_ERROR_MESSAGES.BACKEND_UNAVAILABLE);
  }
  if (!resp.ok || !data?.plan) {
    const code = data?.error?.code ?? 'UNKNOWN';
    throw new TeachingServiceError(code, TEACH_ERROR_MESSAGES[code] ?? data?.error?.message ?? 'The explanation failed.');
  }
  return data.plan;
}

/* ------------------------------ streamed plans (voice latency milestone) ------------------------------ */

/** Events of POST /api/teach/stream (NDJSON, one per line). */
export type TeachStreamEvent =
  /** The model started writing (once). */
  | { type: 'token' }
  /** A step whose narration is being written: actions and caption known, narration "". */
  | { type: 'stepStart'; index: number; step: unknown }
  /** One complete narration sentence of that step (speak it now). */
  | { type: 'narration'; index: number; text: string }
  | { type: 'step'; step: unknown }
  | { type: 'rejected'; index: number; code: string }
  | { type: 'done'; plan: unknown }
  | { type: 'error'; code: string; message: string };

/** Longest silence between two stream events, and the cap for the whole answer. The backend's own
 *  limits are shorter (8 s connect + 20 s idle between LLM chunks, 40 s total), so the server
 *  normally reports a timeout itself and the browser timers only catch a dead connection. */
export const TEACH_STREAM_IDLE_MS = 25000;
export const TEACH_STREAM_TOTAL_MS = 60000;

let streamSeq = 0;

/**
 * Requests a plan from /api/teach/stream and calls `onEvent` for each event as it arrives. Resolves
 * when the stream ends; network problems, timeouts and HTTP errors throw TeachingServiceError
 * (CANCELLED when `signal` aborted). An older backend without the stream endpoint (404) is asked
 * once with /api/teach and its plan is replayed as events.
 * Text is decoded with a streaming TextDecoder, so a Telugu character split across two network
 * chunks is never corrupted.
 */
export async function streamTeachingPlan(
  body: TeachRequestBody,
  signal: AbortSignal | undefined,
  onEvent: (e: TeachStreamEvent) => void,
  fetchImpl: FetchLike = fetch,
  opts: { idleMs?: number; totalMs?: number; requestId?: string; onFallback?: () => void } = {}
): Promise<void> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = () => {
    timedOut = true;
    controller.abort();
  };
  const total = setTimeout(timeout, opts.totalMs ?? TEACH_STREAM_TOTAL_MS);
  let idle = setTimeout(timeout, opts.idleMs ?? TEACH_STREAM_IDLE_MS);
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(timeout, opts.idleMs ?? TEACH_STREAM_IDLE_MS);
  };
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  const fail = (): never => {
    if (signal?.aborted) throw new TeachingServiceError('CANCELLED', 'Cancelled.');
    if (timedOut) throw new TeachingServiceError('TIMEOUT', TEACH_ERROR_MESSAGES.TIMEOUT);
    throw new TeachingServiceError('BACKEND_UNAVAILABLE', TEACH_ERROR_MESSAGES.BACKEND_UNAVAILABLE);
  };
  try {
    let resp: Response;
    try {
      resp = await fetchImpl('/api/teach/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': opts.requestId ?? `t${Date.now().toString(36)}-${++streamSeq}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      return fail();
    }
    if (resp.status === 404) {
      // Backend without the stream endpoint (a server started before it existed): one normal request,
      // replayed as events. Speech then starts only after the WHOLE answer, so say so in the console.
      console.warn('[teach] /api/teach/stream not found: the voice backend is outdated; restart it to stream answers. Using /api/teach (whole answer, slower first audio).');
      opts.onFallback?.();
      const plan = await requestTeachingPlan(body, signal, fetchImpl) as { steps?: unknown[] };
      for (const step of Array.isArray(plan?.steps) ? plan.steps : []) onEvent({ type: 'step', step });
      onEvent({ type: 'done', plan });
      return;
    }
    if (!resp.ok || !resp.body) {
      let data: { error?: { code?: string; message?: string } } | null = null;
      try {
        data = await resp.json();
      } catch {
        throw new TeachingServiceError('BACKEND_UNAVAILABLE', TEACH_ERROR_MESSAGES.BACKEND_UNAVAILABLE);
      }
      const code = data?.error?.code ?? 'UNKNOWN';
      throw new TeachingServiceError(code, TEACH_ERROR_MESSAGES[code] ?? data?.error?.message ?? 'The explanation failed.');
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const emit = (line: string) => {
      if (!line.trim()) return;
      let e: TeachStreamEvent;
      try {
        e = JSON.parse(line) as TeachStreamEvent;
      } catch {
        return; // a damaged line is ignored; the final plan is validated as a whole
      }
      if (e && ['token', 'stepStart', 'narration', 'step', 'rejected', 'done', 'error'].includes(e.type)) onEvent(e);
    };
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        return fail();
      }
      if (chunk.done) break;
      touch();
      buffer += decoder.decode(chunk.value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        emit(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    }
    emit(buffer + decoder.decode());
  } finally {
    clearTimeout(total);
    clearTimeout(idle);
    signal?.removeEventListener('abort', onAbort);
  }
}
