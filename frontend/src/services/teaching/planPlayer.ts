/**
 * Teaching Plan Player (Task V4) — runs one validated plan at a time through the V1
 * SceneCommandDispatcher (source 'ai'). Framework-free so it can be tested end to end.
 *
 * Per step:  re-validate against the live scene -> dispatch its actions -> wait until the camera
 * reports settled (no transition, no deferred command) -> play the narration and wait for its
 * real end -> optional viewing hold -> optional wait for Continue.
 *
 * Streamed plans (voice latency milestone): start(plan, { open: true }) begins with the steps that
 * have arrived; append() adds steps while it plays (the next step's audio is prefetched as soon as
 * it arrives); finishStream() says no more steps will come. Reaching the end of the received steps
 * of an open plan waits for the next one instead of finishing.
 * Live steps (appendLive): a step whose narration is still being written. Its actions run at once
 * and its narration is spoken sentence by sentence as pushNarration() delivers it, so the first
 * sentence is heard while the AI teacher is still writing the rest; completeLive() / abortLive()
 * end it.
 *
 * Policies (documented in ARCHITECTURE.md §11):
 *  - One plan at a time: start() refuses while another plan is active (callers cancel first).
 *  - Manual takeover: any command from another source (mouse/keyboard/gesture/voice/UI) or the
 *    user steering the camera PAUSES the plan; Resume continues from the current step.
 *  - Model switch: CANCELS the plan immediately; nothing is restored (the new model starts clean).
 *  - Invalid step at run time: skipped and reported, nothing dispatched for it.
 *  - Restoration on finish/cancel: every scene category the plan touched (highlight, isolation,
 *    exploded view, animation play state/speed) is put back to how it was before the plan.
 *    Selection is restored on cancel only (after a finished lesson the topic stays selected for
 *    follow-up questions). The camera is never moved back; Reset view does that.
 */

import type { SceneCommandDispatcher } from '../commands/sceneCommandDispatcher';
import type { SceneCommand } from '../commands/sceneCommands';
import type { SceneSnapshot } from '../scene/sceneSnapshot';
import { validateStepNow, type RejectedStep, type TeachingPlan, type TeachingStep } from './teachingPlan';

export type PlayerStatus = 'idle' | 'running' | 'paused' | 'waitingForUser' | 'finished' | 'cancelled' | 'failed';
export type StepPhase = 'actions' | 'narrating' | 'holding' | null;

export interface NarrationClip {
  play(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** Resolves when the narration really ended (or could not be played). */
  done: Promise<'ended' | 'failed' | 'stopped'>;
}

export interface Narrator {
  /** Starts preparing audio for `text` (e.g. fetching TTS) without playing it. */
  prepare(text: string, language?: string): NarrationClip;
  /** A clip whose text is pushed sentence by sentence (streamed answers). Optional. */
  prepareLive?(language?: string): LiveClip;
}

export interface LiveClip extends NarrationClip {
  push(text: string): void;
  close(): void;
}

export interface PlayerState {
  status: PlayerStatus;
  plan: TeachingPlan | null;
  /** Position in plan.steps of the current step (0-based), -1 before the first step. */
  stepPosition: number;
  stepCount: number;
  phase: StepPhase;
  caption: string;
  narration: string;
  /** Why the player paused, was cancelled or failed (for the UI). */
  message: string | null;
  /** Steps skipped while playing because they no longer validated. */
  runtimeRejected: RejectedStep[];
}

export interface PlayerDeps {
  dispatcher: SceneCommandDispatcher;
  getSnapshot: () => SceneSnapshot;
  narrator: Narrator;
  pollMs?: number;
  /** Safety cap for waiting on the camera to settle (a real signal normally ends it sooner). */
  settleTimeoutMs?: number;
}

type Category = 'highlight' | 'isolate' | 'explode' | 'animation' | 'select';

interface Baseline {
  modelId: string;
  selected: string | null;
  isolated: string | null;
  highlighted: string[];
  exploded: number;
  animation: { playing: boolean; speed: number } | null;
}

const CATEGORY_OF: Partial<Record<SceneCommand['type'], Category>> = {
  'component.highlight': 'highlight', 'component.clearHighlight': 'highlight',
  'component.isolate': 'isolate',
  'assembly.explode': 'explode', 'assembly.restore': 'explode',
  'animation.play': 'animation', 'animation.pause': 'animation', 'animation.setSpeed': 'animation',
  'component.select': 'select',
};

const IDLE: PlayerState = {
  status: 'idle', plan: null, stepPosition: -1, stepCount: 0, phase: null, caption: '', narration: '', message: null, runtimeRejected: [],
};

export class TeachingPlanPlayer {
  private state: PlayerState = { ...IDLE };
  private readonly listeners = new Set<(s: PlayerState) => void>();
  private readonly deps: Required<PlayerDeps>;
  private runToken = 0;
  private clip: NarrationClip | null = null;
  private nextClip: { position: number; clip: NarrationClip } | null = null;
  private continueRequested = false;
  private awaitingContinue = false;
  private baseline: Baseline | null = null;
  private touched = new Set<Category>();
  private ownDispatch = false;
  /** Streamed plan still receiving steps (see start(..., { open })). */
  private open = false;
  private live: TeachingPlan | null = null;
  /** Live narration clips still receiving text, by step index. */
  private readonly liveClips = new Map<number, LiveClip>();
  /** Live clips not yet taken by the run loop (a step may be complete before it is reached). */
  private readonly pendingLive = new Map<number, LiveClip>();

  constructor(deps: PlayerDeps) {
    // Narration starts when the camera has settled, but never later than settleTimeoutMs after the
    // step's actions (voice latency: speech is not held back by a long camera move)
    this.deps = { pollMs: 40, settleTimeoutMs: 1200, ...deps };
  }

  /** Starts watching the dispatcher for manual takeover. Returns the detach function. */
  public attach(): () => void {
    return this.deps.dispatcher.subscribe((rec) => {
      if (this.ownDispatch || rec.source === 'ai') return;
      if (rec.status !== 'executed' && rec.status !== 'deferred') return;
      if (this.state.status === 'running' || this.state.status === 'waitingForUser') {
        this.pause('Paused because you changed the scene. Resume to continue the explanation.');
      }
    });
  }

  public getState(): PlayerState {
    return this.state;
  }

  public subscribe(listener: (s: PlayerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public isActive(): boolean {
    return ['running', 'paused', 'waitingForUser'].includes(this.state.status);
  }

  /** Starts a validated plan. Returns false (and does nothing) if another plan is active or the model changed.
   *  `open`: more steps will follow through append() until finishStream(). */
  public start(plan: TeachingPlan, opts: { open?: boolean } = {}): boolean {
    if (this.isActive()) return false;
    const snap = this.deps.getSnapshot();
    if (!snap.model || snap.model.id !== plan.modelId) {
      this.set({ ...IDLE, status: 'failed', plan, stepCount: plan.steps.length, message: 'This explanation was prepared for a different model.' });
      return false;
    }
    this.baseline = {
      modelId: plan.modelId,
      selected: snap.selectedComponentId,
      isolated: snap.isolatedComponentId.status === 'known' ? snap.isolatedComponentId.value : null,
      highlighted: snap.highlightedComponentIds.status === 'known' ? [...snap.highlightedComponentIds.value] : [],
      exploded: snap.exploded.factor,
      animation: snap.animation.state.status === 'known' ? { ...snap.animation.state.value } : null,
    };
    this.touched = new Set();
    this.continueRequested = false;
    const token = ++this.runToken;
    const live: TeachingPlan = { ...plan, steps: [...plan.steps] };
    this.live = live;
    this.open = Boolean(opts.open);
    this.set({ ...IDLE, status: 'running', plan: { ...live, steps: [...live.steps] }, stepCount: live.steps.length });
    void this.run(live, token);
    return true;
  }

  /** Adds validated steps to the streamed plan that is playing. False if no streamed plan is active. */
  public append(steps: readonly TeachingStep[]): boolean {
    const live = this.live;
    if (!live || !this.open || !this.isActive() || steps.length === 0) return false;
    live.steps.push(...steps);
    this.set({ plan: { ...live, steps: [...live.steps] }, stepCount: live.steps.length });
    // The step after the one being narrated just arrived: start fetching its audio now
    const next = this.state.stepPosition + 1;
    if (this.state.phase === 'narrating' && !this.nextClip && next < live.steps.length && !this.pendingLive.has(live.steps[next].index)) {
      this.nextClip = { position: next, clip: this.deps.narrator.prepare(live.steps[next].narration, live.language) };
    }
    return true;
  }

  /** Adds a step whose narration is still being written (see the header). False if not possible. */
  public appendLive(step: TeachingStep): boolean {
    const live = this.live;
    const prepareLive = this.deps.narrator.prepareLive;
    if (!live || !this.open || !this.isActive() || !prepareLive) return false;
    const clip = prepareLive.call(this.deps.narrator, live.language);
    this.liveClips.set(step.index, clip);
    this.pendingLive.set(step.index, clip);
    return this.append([{ ...step }]);
  }

  /** One more narration sentence of a live step: spoken as soon as possible, shown in the caption. */
  public pushNarration(index: number, text: string): boolean {
    const clip = this.liveClips.get(index);
    const step = this.live?.steps.find((st) => st.index === index);
    if (!clip || !step) return false;
    clip.push(text);
    step.narration = step.narration ? `${step.narration} ${text}` : text;
    if (this.state.plan?.steps[this.state.stepPosition]?.index === index) this.set({ narration: step.narration });
    return true;
  }

  /** The live step is complete: its final text is kept, its narration ends after the last sentence. */
  public completeLive(index: number, final: TeachingStep): void {
    const clip = this.liveClips.get(index);
    const step = this.live?.steps.find((st) => st.index === index);
    if (!clip) return;
    this.liveClips.delete(index);
    if (step) {
      step.caption = final.caption;
      step.narration = final.narration;
      step.waitFor = final.waitFor;
      step.holdMs = final.holdMs;
    }
    clip.close();
  }

  /** The live step failed validation after it started: stop its speech; skip it if not reached yet. */
  public abortLive(index: number): void {
    const clip = this.liveClips.get(index) ?? this.pendingLive.get(index);
    if (!clip) return;
    this.liveClips.delete(index);
    this.pendingLive.delete(index);
    clip.stop();
    const live = this.live;
    if (!live) return;
    const pos = live.steps.findIndex((st) => st.index === index);
    if (pos > this.state.stepPosition) live.steps.splice(pos, 1);
  }

  /** No more steps will be appended; final plan details (title, summary, follow-ups) may be updated. */
  public finishStream(update: Partial<Pick<TeachingPlan, 'title' | 'explanation' | 'followUpSuggestions' | 'cannotAnswer' | 'targetComponentId' | 'planId' | 'rejectedSteps'>> = {}): void {
    if (!this.live) return;
    this.open = false;
    // live narrations end with what they have (no more text will come)
    for (const clip of this.liveClips.values()) clip.close();
    this.liveClips.clear();
    Object.assign(this.live, update);
    if (this.isActive() || this.state.plan?.planId === this.live.planId || update.planId) {
      this.set({ plan: { ...this.live, steps: [...this.live.steps] } });
    }
  }

  /** True while a streamed plan may still receive steps. */
  public isStreaming(): boolean {
    return this.open && this.isActive();
  }

  public pause(message = 'Paused.'): void {
    if (this.state.status !== 'running' && this.state.status !== 'waitingForUser') return;
    this.clip?.pause();
    this.set({ status: 'paused', message });
  }

  public resume(): void {
    if (this.state.status !== 'paused') return;
    this.clip?.resume();
    this.set({ status: this.awaitingContinue ? 'waitingForUser' : 'running', message: null });
  }

  /** Continue past a step that waits for the learner. */
  public continue(): void {
    if (this.state.status === 'waitingForUser') {
      this.continueRequested = true;
      this.awaitingContinue = false;
      this.set({ status: 'running' });
    }
  }

  /** Stops the plan, stops speech, and restores what the plan changed (unless the model changed). */
  public cancel(message = 'Explanation stopped.'): void {
    if (!this.isActive()) return;
    this.stopRun();
    this.restore('cancel');
    this.set({ status: 'cancelled', phase: null, message });
  }

  // ------------------------------------------------------------------------------------------

  private set(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) {
      try {
        l(this.state);
      } catch {
        // listener errors never break playback
      }
    }
  }

  private stopRun(): void {
    this.runToken++;
    this.open = false;
    for (const clip of new Set([...this.liveClips.values(), ...this.pendingLive.values()])) clip.stop();
    this.liveClips.clear();
    this.pendingLive.clear();
    this.awaitingContinue = false;
    this.clip?.stop();
    this.clip = null;
    this.nextClip?.clip.stop();
    this.nextClip = null;
  }

  private alive(token: number): boolean {
    return token === this.runToken;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Per-poll checks shared by every wait: model switch cancels, user steering pauses. */
  private watch(plan: TeachingPlan): void {
    const snap = this.deps.getSnapshot();
    if (!snap.model || snap.model.id !== plan.modelId) {
      this.stopRun();
      this.baseline = null;
      this.set({ status: 'cancelled', phase: null, message: 'The model changed, so the explanation was stopped.' });
      return;
    }
    if (this.state.status === 'running' && snap.camera.status === 'known' && snap.camera.value.userSteering) {
      this.pause('Paused because you moved the view. Resume to continue the explanation.');
    }
  }

  /** Waits until `done()` (checked every poll) while honouring pause; `budgetMs` counts only unpaused time. */
  private async waitUntil(token: number, plan: TeachingPlan, done: () => boolean, budgetMs = Infinity): Promise<boolean> {
    let elapsed = 0;
    while (this.alive(token)) {
      this.watch(plan);
      if (!this.alive(token)) return false;
      const paused = this.state.status === 'paused';
      if (!paused && done()) return true;
      if (!paused && elapsed >= budgetMs) return true;
      await this.sleep(this.deps.pollMs);
      if (!paused) elapsed += this.deps.pollMs;
    }
    return false;
  }

  private dispatch(command: SceneCommand) {
    const cat = CATEGORY_OF[command.type];
    if (cat) this.touched.add(cat);
    this.ownDispatch = true;
    try {
      return this.deps.dispatcher.dispatch(command, 'ai');
    } finally {
      this.ownDispatch = false;
    }
  }

  private clipFor(plan: TeachingPlan, position: number): NarrationClip {
    const index = plan.steps[position].index;
    const live = this.pendingLive.get(index);
    if (live) {
      this.pendingLive.delete(index); // taken once; may still receive text until completeLive
      return live;
    }
    if (this.nextClip?.position === position) {
      const c = this.nextClip.clip;
      this.nextClip = null;
      return c;
    }
    return this.deps.narrator.prepare(plan.steps[position].narration, plan.language);
  }

  private async run(plan: TeachingPlan, token: number): Promise<void> {
    // Task V5: the part being explained is selected, so "it" in a follow-up means that part.
    // (Validated by the dispatcher like any action; restored on cancel per the policy above.)
    if (plan.targetComponentId && this.deps.getSnapshot().selectedComponentId !== plan.targetComponentId) {
      this.dispatch({ type: 'component.select', componentId: plan.targetComponentId });
    }
    for (let pos = 0; ; pos++) {
      if (pos >= plan.steps.length) {
        if (!this.open) break;
        // Streamed plan: the next step is still being written; wait for it (or for the end)
        if (pos > 0) this.set({ phase: null });
        if (!(await this.waitUntil(token, plan, () => pos < plan.steps.length || !this.open))) return;
        if (pos >= plan.steps.length) break;
      }
      // Wait while paused before starting a step
      if (!(await this.waitUntil(token, plan, () => true))) return;
      const step = plan.steps[pos];
      this.set({ stepPosition: pos, phase: 'actions', caption: step.caption, narration: step.narration });

      const check = validateStepNow(step, plan.modelId, this.deps.dispatcher.getContext());
      if (!check.ok) {
        if (check.code === 'STALE_MODEL') {
          this.stopRun();
          this.set({ status: 'cancelled', phase: null, message: 'The model changed, so the explanation was stopped.' });
          return;
        }
        this.set({ runtimeRejected: [...this.state.runtimeRejected, { index: step.index, code: check.code, reason: check.reason }] });
        continue;
      }
      // Start synthesizing this step's narration now, so the audio is being made while the camera moves
      this.clip = this.clipFor(plan, pos);
      for (const command of check.commands) {
        if (!this.alive(token)) return; // cancelled or superseded: no further scene action
        const rec = this.dispatch(command);
        if (rec.status === 'rejected') {
          this.set({ runtimeRejected: [...this.state.runtimeRejected, { index: step.index, code: rec.code ?? 'REJECTED', reason: rec.detail ?? '' }] });
          break;
        }
      }

      // Real completion signal: camera transition finished and no deferred command waiting
      const settled = () => {
        const cam = this.deps.getSnapshot().camera;
        return cam.status !== 'known' || cam.value.settled;
      };
      if (!(await this.waitUntil(token, plan, settled, this.deps.settleTimeoutMs))) return;

      // Narration, synchronised with the step's visuals; prefetch the next step's audio meanwhile
      if (!this.clip) return;
      if (pos + 1 < plan.steps.length && this.nextClip?.position !== pos + 1 && !this.pendingLive.has(plan.steps[pos + 1].index)) {
        this.nextClip = { position: pos + 1, clip: this.deps.narrator.prepare(plan.steps[pos + 1].narration, plan.language) };
      }
      let narrationOver = false;
      void this.clip.done.then(() => (narrationOver = true));
      this.set({ phase: 'narrating' });
      this.clip.play();
      if (this.state.status === 'paused') this.clip.pause();
      if (!(await this.waitUntil(token, plan, () => narrationOver))) return;
      this.clip = null;

      if (step.holdMs > 0) {
        this.set({ phase: 'holding' });
        if (!(await this.waitUntil(token, plan, () => false, step.holdMs))) return;
      }
      if (step.waitFor === 'user' && (pos + 1 < plan.steps.length || this.open)) {
        this.continueRequested = false;
        this.awaitingContinue = true;
        if (this.state.status === 'running') this.set({ status: 'waitingForUser' });
        if (!(await this.waitUntil(token, plan, () => this.continueRequested))) return;
        this.awaitingContinue = false;
      }
    }
    if (!this.alive(token)) return;
    this.restore('finish');
    this.runToken++;
    this.set({ status: 'finished', phase: null, message: null, plan: { ...plan, steps: [...plan.steps] } });
  }

  /** Puts back every category the plan touched (see policy at the top). */
  private restore(reason: 'finish' | 'cancel'): void {
    const base = this.baseline;
    this.baseline = null;
    if (!base) return;
    const snap = this.deps.getSnapshot();
    if (!snap.model || snap.model.id !== base.modelId) return; // new model: nothing of ours to restore
    const t = this.touched;
    if (t.has('highlight')) {
      this.dispatch(base.highlighted.length ? { type: 'component.highlight', componentIds: base.highlighted } : { type: 'component.clearHighlight' });
    }
    if (t.has('isolate')) this.dispatch({ type: 'component.isolate', componentId: base.isolated });
    if (t.has('explode')) this.dispatch(base.exploded > 0 ? { type: 'assembly.explode', factor: base.exploded } : { type: 'assembly.restore' });
    if (t.has('animation') && base.animation) {
      this.dispatch({ type: 'animation.setSpeed', speed: base.animation.speed });
      this.dispatch({ type: base.animation.playing ? 'animation.play' : 'animation.pause' });
    }
    if (reason === 'cancel' && t.has('select')) this.dispatch({ type: 'component.select', componentId: base.selected });
    this.touched.clear();
  }
}
