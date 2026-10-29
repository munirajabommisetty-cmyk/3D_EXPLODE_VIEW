/**
 * Teaching request lifecycle (Task V5) — framework-free so races can be tested.
 *
 * One request at a time, identified by a token:
 *   ask()       -> new token; aborts the previous network request; cancels the playing plan;
 *                  requests a plan; plays it only if the token is still current AND the model
 *                  is unchanged when the reply arrives (late replies are dropped, never played).
 *   supersede() -> a new non-teaching request (e.g. "show me where it is") replaces the
 *                  explanation: token bump + abort + cancel (with the player's restoration).
 *   cancel()    -> same, for an explicit stop.
 *   modelChanged() -> token bump + abort + forget the old model's conversation.
 *
 * If the AI teacher cannot answer (provider/quota/network error or a plan that fails
 * validation) the user still gets a grounded explanation built from the model data
 * (componentBrief.ts), played through the same validation and player, with a clear notice.
 *
 * Streaming (voice latency milestone, deps.requestPlanStream): the plan arrives step by step. The
 * FIRST valid step starts the player at once (its narration is synthesized and spoken while the
 * model is still writing); later steps are appended in order; the final plan only completes the
 * details. If the stream fails after some steps were played, those steps are kept and a short
 * notice says the rest is missing (no second AI request); if it fails before any step, the
 * model-data fallback answers. Every event is checked against the request token, so an older
 * answer can never add steps to a newer one.
 */

import type { SceneCommandDispatcher } from '../commands/sceneCommandDispatcher';
import { getSceneSnapshot } from '../scene/sceneSnapshot';
import type { EngineeringModelDefinition } from '../../types/models';
import type { TeachingRequestInfo } from '../voice/voiceSession';
import { buildComponentBrief } from './componentBrief';
import { buildFactPack } from './factPack';
import type { TeachHistoryTurn, TeachRequestBody, TeachStreamEvent } from './teachingClient';
import { TEACH_ERROR_MESSAGES, TeachingServiceError } from './teachingClient';
import type { TeachingPlanPlayer } from './planPlayer';
import { TEACHING_PLAN_SCHEMA_VERSION, validateTeachingPlan, type TeachingPlan, type TeachingStep } from './teachingPlan';
import { LlmAvailability } from './llmAvailability';

/** Teaching narration languages (fully verified set); others get English plans and speech. */
// Bengali added in Stage 3. Milestone A: the model-data fallback is built in te/hi/bn too.
export const TEACHING_LANGUAGES = ['en-IN', 'te-IN', 'hi-IN', 'bn-IN'];
export const teachLanguage = (lang: string) => (TEACHING_LANGUAGES.includes(lang) ? lang : 'en-IN');

export const FALLBACK_NOTICE = 'The AI teacher is not available right now, so this explanation comes from the model data.';
export const ENGLISH_FALLBACK_NOTE = 'It is in English, because the model data is in English.';

/** One calm sentence in the learner's language when the answer comes from the model data
 *  (no backend error text: the learner only needs to know the source of the answer). */
export const LOCALIZED_FALLBACK_NOTICE: Record<string, string> = {
  'te-IN': 'AI టీచర్ ప్రస్తుతం అందుబాటులో లేదు, అందుకే ఈ వివరణ model data నుంచి ఇస్తున్నాను.',
  'hi-IN': 'AI टीचर अभी उपलब्ध नहीं है, इसलिए यह जानकारी model data से दे रही हूँ।',
  'bn-IN': 'AI টিচার এখন পাওয়া যাচ্ছে না, তাই এই ব্যাখ্যা model data থেকে দিচ্ছি।',
};

/** The stream broke after part of the answer was spoken (the spoken part is kept). */
export const PARTIAL_ANSWER_NOTICE: Record<string, string> = {
  'en-IN': 'The rest of this explanation could not be generated right now. Ask again to hear more.',
  'te-IN': 'ఈ వివరణలో మిగతా భాగం ఇప్పుడు రాలేదు. ఇంకా వినాలంటే మళ్ళీ అడగండి.',
  'hi-IN': 'इस व्याख्या का बाकी हिस्सा अभी नहीं बन पाया। और सुनने के लिए फिर से पूछिए।',
  'bn-IN': 'এই ব্যাখ্যার বাকি অংশ এখন তৈরি করা গেল না। আরও শুনতে আবার জিজ্ঞেস করুন।',
};

/** Why the AI teacher did not answer (each has its own short notice; never a raw error dump). */
export type FallbackCause = 'quota' | 'timeout' | 'offline' | 'notConfigured' | 'unusable';

export function fallbackCause(code: string | null | undefined): FallbackCause {
  switch (code) {
    case 'LLM_QUOTA_EXCEEDED': case 'LLM_RATE_LIMIT': return 'quota';
    case 'LLM_TIMEOUT': case 'TIMEOUT': return 'timeout';
    case 'LLM_NOT_CONFIGURED': case 'LLM_AUTH': case 'LLM_MODEL_NOT_FOUND': return 'notConfigured';
    case 'LLM_MALFORMED': case 'PLAN_INVALID': case 'PLAN_UNSAFE': case 'PLAN_TOO_LONG': case 'UNKNOWN_COMPONENT': case 'INVALID_PLAN': return 'unusable';
    default: return 'offline';
  }
}

/** One short sentence per cause and language, then the model-data answer follows. */
export const FALLBACK_NOTICES: Record<FallbackCause, Record<string, string>> = {
  quota: {
    'en-IN': 'The AI teacher has reached its usage limit for now, so this answer comes from the model data.',
    'te-IN': 'AI టీచర్ ఉపయోగ పరిమితి ఇప్పటికి పూర్తైంది, అందుకే ఈ సమాధానం model data నుంచి ఇస్తున్నాను.',
    'hi-IN': 'AI टीचर की उपयोग सीमा अभी पूरी हो गई है, इसलिए यह जवाब model data से दे रही हूँ।',
    'bn-IN': 'AI টিচারের ব্যবহারের সীমা এখন শেষ, তাই এই উত্তর model data থেকে দিচ্ছি।',
  },
  timeout: {
    'en-IN': 'The AI teacher took too long, so this answer comes from the model data.',
    'te-IN': 'AI టీచర్ సమాధానం ఇవ్వడానికి చాలా సమయం తీసుకుంది, అందుకే model data నుంచి చెబుతున్నాను.',
    'hi-IN': 'AI टीचर ने जवाब देने में बहुत देर लगाई, इसलिए यह जवाब model data से दे रही हूँ।',
    'bn-IN': 'AI টিচার উত্তর দিতে বেশি সময় নিল, তাই model data থেকে বলছি।',
  },
  offline: {
    'en-IN': FALLBACK_NOTICE,
    'te-IN': 'AI టీచర్ ప్రస్తుతం అందుబాటులో లేదు, అందుకే ఈ వివరణ model data నుంచి ఇస్తున్నాను.',
    'hi-IN': 'AI टीचर अभी उपलब्ध नहीं है, इसलिए यह जानकारी model data से दे रही हूँ।',
    'bn-IN': 'AI টিচার এখন পাওয়া যাচ্ছে না, তাই এই ব্যাখ্যা model data থেকে দিচ্ছি।',
  },
  notConfigured: {
    'en-IN': 'The AI teacher is not set up on the server, so this answer comes from the model data.',
    'te-IN': 'Server లో AI టీచర్ సెట్ చేయలేదు, అందుకే ఈ సమాధానం model data నుంచి.',
    'hi-IN': 'Server पर AI टीचर सेट नहीं है, इसलिए यह जवाब model data से है।',
    'bn-IN': 'Server-এ AI টিচার সেট করা নেই, তাই এই উত্তর model data থেকে।',
  },
  unusable: {
    'en-IN': 'The AI answer could not be used safely, so this answer comes from the model data.',
    'te-IN': 'AI సమాధానాన్ని సురక్షితంగా ఉపయోగించలేకపోయాను, అందుకే model data నుంచి చెబుతున్నాను.',
    'hi-IN': 'AI का जवाब सुरक्षित रूप से इस्तेमाल नहीं हो सका, इसलिए यह जवाब model data से है।',
    'bn-IN': 'AI-এর উত্তর নিরাপদে ব্যবহার করা গেল না, তাই model data থেকে বলছি।',
  },
};

export type AskResult = 'started' | 'fallback' | 'stale' | 'failed';

export interface TeachingControllerState {
  pending: boolean;
  question: string | null;
  /** Problem to show (provider error, invalid plan, …). */
  error: string | null;
  /** Neutral information (e.g. "explaining from the model data"). */
  notice: string | null;
}

export interface TeachingControllerDeps {
  dispatcher: SceneCommandDispatcher;
  player: TeachingPlanPlayer;
  getModel: () => EngineeringModelDefinition | null | undefined;
  getLanguage: () => string;
  requestPlan: (body: TeachRequestBody, signal: AbortSignal) => Promise<unknown>;
  /** Streamed plans (preferred when set): events arrive while the model is still writing. */
  requestPlanStream?: (body: TeachRequestBody, signal: AbortSignal, onEvent: (e: TeachStreamEvent) => void) => Promise<void>;
  /** Called when a plan starts (e.g. to remember its part for "it" in follow-ups). */
  onPlanStarted?: (plan: TeachingPlan) => void;
  /** Milestone A/B: remembers quota / configuration failures so later questions skip the AI call
   *  and answer from the model data at once (the app shares one; default = private to this controller). */
  availability?: LlmAvailability;
}

export class TeachingController {
  private readonly deps: TeachingControllerDeps;
  private token = 0;
  private abort: AbortController | null = null;
  private history: { modelId: string; turns: TeachHistoryTurn[] } = { modelId: '', turns: [] };
  private state: TeachingControllerState = { pending: false, question: null, error: null, notice: null };
  private readonly listeners = new Set<(s: TeachingControllerState) => void>();
  private readonly availability: LlmAvailability;

  constructor(deps: TeachingControllerDeps) {
    this.deps = deps;
    this.availability = deps.availability ?? new LlmAvailability();
  }

  public getState(): TeachingControllerState {
    return this.state;
  }

  public subscribe(l: (s: TeachingControllerState) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** True while a plan is requested or playing (explanation controls apply). */
  public isActive(): boolean {
    return this.state.pending || this.deps.player.isActive();
  }

  public getHistory(): readonly TeachHistoryTurn[] {
    return this.history.turns;
  }

  private set(patch: Partial<TeachingControllerState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) {
      try {
        l(this.state);
      } catch {
        // listener errors never break the lifecycle
      }
    }
  }

  /** Invalidates the current request: later replies for it are ignored. */
  private invalidate(): number {
    this.token += 1;
    this.abort?.abort();
    this.abort = null;
    return this.token;
  }

  public async ask(info: TeachingRequestInfo): Promise<AskResult> {
    const model = this.deps.getModel();
    if (!model) return 'failed';
    const token = this.invalidate();
    const controller = new AbortController();
    this.abort = controller;
    if (this.deps.player.isActive()) this.deps.player.cancel('Replaced by your new question.');
    if (this.history.modelId !== model.id) this.history = { modelId: model.id, turns: [] };
    const language = teachLanguage(info.language ?? this.deps.getLanguage());
    this.set({ pending: true, question: info.question, error: null, notice: null });

    // The AI teacher failed recently for a lasting reason (quota used up, not configured): do not
    // send another failing request, answer from the model data straight away.
    if (!this.availability.isAvailable()) return this.fallback(token, model, info, null, this.availability.reason());

    const body: TeachRequestBody = {
      question: info.question,
      language,
      targetComponentId: info.targetComponentId,
      questionType: info.questionType,
      facts: buildFactPack(model, getSceneSnapshot(this.deps.dispatcher, model), info.targetComponentId),
      history: [...this.history.turns],
      ...(info.bilingual ? { bilingual: true } : {}),
    };
    if (this.deps.requestPlanStream) return this.askStreaming(token, model, info, language, body, controller.signal);

    let raw: unknown;
    try {
      raw = await this.deps.requestPlan(body, controller.signal);
    } catch (err) {
      if (!this.current(token, model) || (err as TeachingServiceError).code === 'CANCELLED') return 'stale';
      const code = (err as TeachingServiceError).code ?? 'UNKNOWN';
      this.availability.report(code);
      return this.fallback(token, model, info, TEACH_ERROR_MESSAGES[code] ?? (err as Error).message, code);
    }
    this.availability.reportSuccess();
    // Late reply: a newer request, a cancel or a model switch happened meanwhile
    if (!this.current(token, model)) return 'stale';

    const v = validateTeachingPlan(
      typeof raw === 'object' && raw !== null ? { ...raw, language, source: 'llm' } : raw,
      getSceneSnapshot(this.deps.dispatcher, model),
      this.deps.dispatcher.getContext()
    );
    if (!v.ok) return this.fallback(token, model, info, `The AI explanation could not be used safely (${v.reason})`, 'INVALID_PLAN');
    return this.play(v.plan, info) ? 'started' : 'failed';
  }

  /** Streamed request: play from the first valid step; see the header. */
  private async askStreaming(
    token: number, model: EngineeringModelDefinition, info: TeachingRequestInfo, language: string,
    body: TeachRequestBody, signal: AbortSignal
  ): Promise<AskResult> {
    const ids = new Set(model.getAllComponentIds());
    const provisional = (steps: unknown[]) => ({
      schemaVersion: TEACHING_PLAN_SCHEMA_VERSION,
      planId: randomPlanId(),
      modelId: model.id,
      targetComponentId: info.targetComponentId && ids.has(info.targetComponentId) ? info.targetComponentId : null,
      title: (info.question.trim() || '…').slice(0, 110),
      explanation: '…',
      cannotAnswer: null,
      steps,
      rejectedSteps: [],
      followUpSuggestions: [],
      language,
      source: 'llm' as const,
    });
    const check = (raw: unknown) => validateTeachingPlan(raw, getSceneSnapshot(this.deps.dispatcher, model), this.deps.dispatcher.getContext());
    const received = new Set<number>();
    /** Steps playing while their narration is still being written. */
    const liveSteps = new Set<number>();
    let started = false;
    let finalRaw: unknown = null;
    let streamError: { code: string; message: string } | null = null;

    const onEvent = (e: TeachStreamEvent) => {
      if (!this.current(token, model)) return; // an older request: never touches the new answer
      if (e.type === 'stepStart') {
        // Audio-first: start the step now and speak its sentences as they are written
        const raw = typeof e.step === 'object' && e.step !== null ? { ...(e.step as object), narration: '…' } : e.step;
        const v = check(provisional([raw]));
        if (!v.ok || received.has(e.index)) return;
        const step = { ...v.plan.steps[0], narration: '' };
        if (!started) {
          started = this.play({ ...v.plan, steps: [] }, info, { open: true });
          if (!started) {
            streamError = { code: 'PLAYER', message: this.deps.player.getState().message ?? 'The explanation could not start.' };
            return;
          }
        }
        if (this.deps.player.appendLive(step)) {
          received.add(step.index);
          liveSteps.add(step.index);
        }
        return;
      }
      if (e.type === 'narration') {
        if (liveSteps.has(e.index)) this.deps.player.pushNarration(e.index, e.text);
        return;
      }
      if (e.type === 'rejected') {
        if (liveSteps.delete(e.index)) this.deps.player.abortLive(e.index);
        return;
      }
      if (e.type === 'step') {
        const v = check(provisional([e.step]));
        const index = typeof (e.step as { index?: unknown })?.index === 'number' ? (e.step as { index: number }).index : -1;
        if (liveSteps.has(index)) {
          liveSteps.delete(index);
          if (v.ok) this.deps.player.completeLive(index, v.plan.steps[0]);
          else this.deps.player.abortLive(index);
          return;
        }
        if (!v.ok) return;
        const step = v.plan.steps[0];
        if (received.has(step.index)) return;
        received.add(step.index);
        if (!started) {
          started = this.play(v.plan, info, { open: true });
          if (!started) streamError = { code: 'PLAYER', message: this.deps.player.getState().message ?? 'The explanation could not start.' };
        } else {
          this.deps.player.append([step]);
        }
      } else if (e.type === 'done') {
        finalRaw = e.plan;
      } else if (e.type === 'error') {
        streamError = { code: e.code, message: e.message };
      }
    };

    try {
      await this.deps.requestPlanStream!(body, signal, onEvent);
    } catch (err) {
      const code = (err as TeachingServiceError).code ?? 'UNKNOWN';
      if (code === 'CANCELLED' || !this.current(token, model)) return 'stale';
      streamError = { code, message: (err as Error).message };
    }
    if (!this.current(token, model)) return 'stale';

    const final = finalRaw && !streamError
      ? check(typeof finalRaw === 'object' ? { ...(finalRaw as object), language, source: 'llm' } : finalRaw)
      : null;
    if (final?.ok) {
      this.availability.reportSuccess();
      if (!started) return this.play(final.plan, info) ? 'started' : 'failed';
      const missing: TeachingStep[] = final.plan.steps.filter((st) => !received.has(st.index));
      if (missing.length) this.deps.player.append(missing);
      const { title, explanation, followUpSuggestions, cannotAnswer, targetComponentId, planId, rejectedSteps } = final.plan;
      this.deps.player.finishStream({ title, explanation, followUpSuggestions, cannotAnswer, targetComponentId, planId, rejectedSteps });
      const last = this.history.turns[this.history.turns.length - 1];
      if (last && last.question === info.question) {
        this.history.turns = [...this.history.turns.slice(0, -1), { ...last, title, targetComponentId }];
      }
      return 'started';
    }

    // Stream ended without a usable final plan
    const problem = streamError ?? { code: 'LLM_MALFORMED', message: TEACH_ERROR_MESSAGES.LLM_MALFORMED };
    if (started) {
      // Keep what was already said; no second AI request. Say briefly that the rest is missing.
      this.deps.player.finishStream();
      if (problem.code !== 'LLM_MALFORMED' || !finalRaw) this.availability.report(problem.code);
      this.set({ notice: PARTIAL_ANSWER_NOTICE[language] ?? PARTIAL_ANSWER_NOTICE['en-IN'] });
      return 'started';
    }
    this.availability.report(problem.code);
    const why = !finalRaw || streamError ? (TEACH_ERROR_MESSAGES[problem.code] ?? problem.message) : 'The AI explanation could not be used safely.';
    return this.fallback(token, model, info, why, !finalRaw || streamError ? problem.code : 'INVALID_PLAN');
  }

  /** A new non-teaching request replaces the explanation (and any pending request). */
  public supersede(reason = 'Replaced by your new request.'): void {
    this.invalidate();
    if (this.deps.player.isActive()) this.deps.player.cancel(reason);
    if (this.state.pending) this.set({ pending: false });
  }

  public cancel(reason = 'Explanation stopped.'): void {
    this.supersede(reason);
  }

  public modelChanged(modelId: string | null): void {
    this.invalidate();
    this.history = { modelId: modelId ?? '', turns: [] };
    this.set({ pending: false, error: null, notice: null });
  }

  /** Plays an already-produced plan through the same validation (dev hook / tests). */
  public playRaw(raw: unknown, question = '(simulated plan)'): boolean {
    const model = this.deps.getModel();
    if (!model) return false;
    this.invalidate();
    const v = validateTeachingPlan(raw, getSceneSnapshot(this.deps.dispatcher, model), this.deps.dispatcher.getContext());
    if (!v.ok) {
      this.set({ error: v.reason, pending: false });
      return false;
    }
    this.set({ question, error: null, notice: null });
    return this.play(v.plan, { question, questionType: 'explain', targetComponentId: v.plan.targetComponentId });
  }

  private current(token: number, model: EngineeringModelDefinition): boolean {
    return token === this.token && this.deps.getModel()?.id === model.id;
  }

  /**
   * Grounded answer from the model data, in the requested language (Milestone A: te/hi/bn briefs).
   * `why` is null when the AI call was skipped because of a remembered failure.
   * If a localized brief cannot be built safely, the English brief is used and says so.
   */
  private fallback(token: number, model: EngineeringModelDefinition, info: TeachingRequestInfo, why: string | null, code?: string | null): AskResult {
    const snapshot = getSceneSnapshot(this.deps.dispatcher, model);
    const target = info.targetComponentId && snapshot.components.some((c) => c.id === info.targetComponentId) ? info.targetComponentId : null;
    const requested = teachLanguage(info.language ?? this.deps.getLanguage());
    const ctx = this.deps.dispatcher.getContext();
    // The model-data brief knows the classic question types: examples are answered with the part's uses
    const qt = info.questionType === 'example' ? 'purpose' : info.questionType === 'general' ? 'explain' : info.questionType;
    let v = validateTeachingPlan(buildComponentBrief(model, snapshot, target, qt, requested, { bilingual: info.bilingual }), snapshot, ctx);
    let localized = requested !== 'en-IN';
    if (!v.ok && localized) {
      v = validateTeachingPlan(buildComponentBrief(model, snapshot, target, qt), snapshot, ctx);
      localized = false;
    }
    if (!v.ok || !this.current(token, model)) {
      this.set({ pending: false, error: why ?? FALLBACK_NOTICE });
      return 'failed';
    }
    // One short sentence naming the cause (quota / timeout / offline / not configured / unusable
    // answer), never a raw error dump; the details stay in the console / backend timing log
    const cause = fallbackCause(code);
    if (why) console.info('[teach] answering from the model data:', code ?? 'unknown', '-', why);
    const notice = localized
      ? FALLBACK_NOTICES[cause][requested] ?? LOCALIZED_FALLBACK_NOTICE[requested] ?? FALLBACK_NOTICE
      // English answer: the reason (first time only) + the source; an English answer to a
      // Telugu/Hindi/Bengali question says so (only if the localized brief could not be used)
      : `${FALLBACK_NOTICES[cause]['en-IN']}${requested !== 'en-IN' ? ' ' + ENGLISH_FALLBACK_NOTE : ''}`;
    this.set({ notice });
    return this.play(v.plan, info) ? 'fallback' : 'failed';
  }

  private play(plan: TeachingPlan, info: TeachingRequestInfo, opts: { open?: boolean } = {}): boolean {
    if (this.deps.player.isActive()) this.deps.player.cancel('Replaced by your new question.');
    const ok = this.deps.player.start(plan, opts);
    this.set({ pending: false });
    if (ok) {
      this.history.turns = [...this.history.turns, { question: info.question, targetComponentId: plan.targetComponentId, title: plan.title }].slice(-3);
      this.deps.onPlanStarted?.(plan);
    } else {
      this.set({ error: this.deps.player.getState().message ?? 'The explanation could not start.' });
    }
    return ok;
  }
}

function randomPlanId(): string {
  let id = '';
  for (let i = 0; i < 16; i++) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}
