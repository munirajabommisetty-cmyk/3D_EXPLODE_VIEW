/**
 * POST /api/tutor/evaluate: the AI teacher judges one spoken quiz answer. Any failure rejects, and
 * the tutor then uses its offline key-word check (tutorSession.keywordEvaluate).
 */
import type { EvaluateRequest, Evaluation } from './tutorSession';

export class TutorServiceError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function evaluateAnswer(req: EvaluateRequest, signal?: AbortSignal, fetchImpl: FetchLike = fetch): Promise<Omit<Evaluation, 'source'>> {
  let resp: Response;
  try {
    resp = await fetchImpl('/api/tutor/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
  } catch (err) {
    throw new TutorServiceError((err as Error).name === 'AbortError' ? 'CANCELLED' : 'BACKEND_UNAVAILABLE', 'The answer checker could not be reached.');
  }
  const body = await resp.json().catch(() => null) as Record<string, unknown> | null;
  if (!resp.ok || !body) {
    const e = (body?.error ?? {}) as { code?: string; message?: string };
    throw new TutorServiceError(e.code ?? `HTTP_${resp.status}`, e.message ?? 'The answer could not be checked.');
  }
  if (typeof body.correct !== 'boolean' || typeof body.feedback !== 'string' || !body.feedback.trim()) {
    throw new TutorServiceError('EVAL_INVALID', 'The answer could not be checked.');
  }
  return {
    correct: body.correct,
    feedback: body.feedback.trim().slice(0, 350),
    misconception: typeof body.misconception === 'string' && body.misconception.trim() ? body.misconception.trim().slice(0, 160) : null,
  };
}
