/**
 * Reply speech cache (Milestone B).
 *
 * Short voice replies repeat word for word ("జూమ్ ఇన్ చేస్తున్నాను.", "Zooming in."), so their
 * audio is kept in memory and reused instead of asking Gnani Timbre again. The key is the exact
 * text plus the language: the same text always has the same audio, so a cached clip can never
 * answer a different question. Long texts (explanations) are not cached. Concurrent requests for
 * the same reply share one synthesis call. Failures and cancellations are never cached.
 */

export class TtsCache {
  private readonly clips = new Map<string, Blob>();
  private readonly pending = new Map<string, Promise<Blob>>();
  private readonly maxEntries: number;
  private readonly maxChars: number;

  constructor(maxEntries = 40, maxChars = 160) {
    this.maxEntries = maxEntries;
    this.maxChars = maxChars;
  }

  public cacheable(text: string): boolean {
    return text.length > 0 && text.length <= this.maxChars;
  }

  public has(text: string, language: string): boolean {
    return this.clips.has(key(text, language));
  }

  /** Returns cached audio, joins an identical request in flight, or synthesizes once. */
  public get(text: string, language: string, synth: () => Promise<Blob>): Promise<Blob> {
    if (!this.cacheable(text)) return synth();
    const k = key(text, language);
    const hit = this.clips.get(k);
    if (hit) {
      // refresh LRU position
      this.clips.delete(k);
      this.clips.set(k, hit);
      return Promise.resolve(hit);
    }
    const inFlight = this.pending.get(k);
    if (inFlight) return inFlight;
    const p = synth().then(
      (blob) => {
        this.pending.delete(k);
        this.clips.set(k, blob);
        while (this.clips.size > this.maxEntries) this.clips.delete(this.clips.keys().next().value!);
        return blob;
      },
      (err) => {
        this.pending.delete(k);
        throw err;
      }
    );
    this.pending.set(k, p);
    return p;
  }

  public clear(): void {
    this.clips.clear();
    this.pending.clear();
  }
}

const key = (text: string, language: string) => `${language}\u0000${text}`;

export const replySpeechCache = new TtsCache();
