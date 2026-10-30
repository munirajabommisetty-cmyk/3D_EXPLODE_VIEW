/**
 * Teaching-model availability (Milestone A/B).
 *
 * When the AI teacher fails for a reason that will not fix itself in seconds (daily quota used up,
 * not configured, key rejected), asking again on every question only adds a slow failing request
 * before the model-data answer. This remembers such failures for a cool-down period, during which
 * the teaching controller and the interpretation fallback skip the LLM and answer at once.
 * Short rate limits get a short pause; network errors and timeouts are not remembered (they may be
 * transient). The app shares one instance; tests create their own.
 */

/** Cool-down per error code (ms). Codes not listed are not remembered. */
export const LLM_COOLDOWN_MS: Record<string, number> = {
  LLM_QUOTA_EXCEEDED: 10 * 60_000,
  LLM_NOT_CONFIGURED: 5 * 60_000,
  LLM_AUTH: 5 * 60_000,
  LLM_MODEL_NOT_FOUND: 5 * 60_000,
  LLM_RATE_LIMIT: 20_000,
};

export class LlmAvailability {
  private until = 0;
  private code: string | null = null;
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** Records a failed LLM call; returns true if it starts (or extends) a cool-down. */
  public report(code: string | undefined): boolean {
    const ms = code ? LLM_COOLDOWN_MS[code] : undefined;
    if (!ms) return false;
    this.until = Math.max(this.until, this.now() + ms);
    this.code = code!;
    return true;
  }

  /** A successful call ends any cool-down. */
  public reportSuccess(): void {
    this.until = 0;
    this.code = null;
  }

  public isAvailable(): boolean {
    return this.now() >= this.until;
  }

  /** Why the LLM is being skipped (error code), or null when it is available. */
  public reason(): string | null {
    return this.isAvailable() ? null : this.code;
  }
}

/** Shared by the teaching session and the voice interpretation fallback in the app. */
export const sharedLlmAvailability = new LlmAvailability();
