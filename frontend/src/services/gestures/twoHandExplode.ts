/**
 * Two-hand explode / reassemble gesture (Milestone C).
 *
 * Gesture: both hands visible, each hand pinched (index fingertip at the thumb tip) -> spread the
 * fingers away from the thumbs on BOTH hands -> the model separates. Bring the fingers back to
 * the thumbs on both hands -> it reassembles.
 *
 * Measurement (MediaPipe hand landmarks): per hand, the thumb-tip (4) to index-tip (8) and
 * thumb-tip to middle-tip (12) distances divided by the palm size (calculateHandScale), so the
 * gesture works near and far from the camera. Each hand's value is smoothed (exponential moving
 * average). Hysteresis: a hand is CLOSED below `closedMax`, OPEN above `openMin`, and in between it
 * is neither (no flicker at a single threshold). A transition needs several consecutive frames.
 *
 * States (one explicit state, no loose booleans):
 *   ASSEMBLED     model assembled; waiting for a two-hand pinch
 *   PINCH_ARMED   both hands pinched for `armFrames` frames: ready, nothing moves yet
 *   EXPLODING     explode requested; parts are animating apart
 *   EXPLODED      parts separated (also entered when explode came from voice / keyboard)
 *   REASSEMBLING  restore requested; parts are animating back
 *   TRACKING_LOST fewer than two hands for longer than `lostAfterMs`; the model is left as it is
 *
 * Safety rules:
 *   - One hand, or a brief loss of a hand, never triggers anything: counters stop and restart.
 *   - Losing tracking never moves the model; an animation already started finishes (no
 *     half-exploded state). When both hands return, the state follows the model again and a new
 *     pinch is needed before anything happens.
 *   - The model's explode state stays owned by the workspace (the shared dispatcher): this machine
 *     only REQUESTS explode / restore and follows what the model reports.
 *   - While two hands are visible (`engaged`), the one-hand camera gestures (orbit, pinch-zoom,
 *     pointing) are suspended, so the explode gesture can never orbit, zoom or select.
 */

import type { NormalizedLandmark } from '../../types/landmarks';
import { calculateHandScale, distance3D } from './gestureRules';

export type TwoHandState = 'ASSEMBLED' | 'PINCH_ARMED' | 'EXPLODING' | 'EXPLODED' | 'REASSEMBLING' | 'TRACKING_LOST';
export type TwoHandAction = 'explode' | 'restore' | null;

export interface TwoHandConfig {
  /** Normalised thumb-index distance at or below which a hand counts as pinched. */
  closedMax: number;
  /** Normalised thumb-index AND thumb-middle distance at or above which a hand counts as open. */
  openMin: number;
  /** Consecutive frames with both hands pinched to arm (and to reassemble). */
  armFrames: number;
  /** Consecutive frames with both hands open to explode. */
  openFrames: number;
  /** Smoothing weight of the newest frame (0..1). */
  smoothing: number;
  /** Fewer than two hands for longer than this -> TRACKING_LOST. Shorter gaps are ignored. */
  lostAfterMs: number;
  /** Explode/restore not reflected by the model after this long -> follow the model again. */
  confirmTimeoutMs: number;
  /** Hands below this tracking score are ignored. */
  minScore: number;
}

export const DEFAULT_TWO_HAND_CONFIG: TwoHandConfig = {
  closedMax: 0.35,
  openMin: 0.85,
  armFrames: 6,
  openFrames: 4,
  smoothing: 0.5,
  lostAfterMs: 1200,
  confirmTimeoutMs: 1500,
  minScore: 0.5,
};

export interface TwoHandInput {
  hands: readonly { landmarks: NormalizedLandmark[]; score?: number }[];
  timeMs: number;
  /** The workspace's explode target (> 0 = exploded or exploding). */
  modelExploded: boolean;
  /** True while the parts are still moving toward the target. */
  animating: boolean;
  /** False when the loaded model has no exploded view: the gesture does nothing. */
  canExplode: boolean;
}

export interface TwoHandOutput {
  state: TwoHandState;
  action: TwoHandAction;
  /** Two hands visible (or briefly lost): camera hand-gestures must stand down. */
  engaged: boolean;
  /** Smoothed openness per hand (left-most first), or null without two hands. */
  openness: [number, number] | null;
}

/** Normalised finger opening of one hand: thumb-index and thumb-middle distance / palm size. */
export function handOpenness(landmarks: NormalizedLandmark[] | null | undefined): { index: number; middle: number } | null {
  if (!landmarks || landmarks.length < 21) return null;
  const scale = calculateHandScale(landmarks);
  if (!scale) return null;
  return {
    index: distance3D(landmarks[4], landmarks[8]) / scale,
    middle: distance3D(landmarks[4], landmarks[12]) / scale,
  };
}

type Pose = 'closed' | 'open' | 'between';

export class TwoHandExplodeMachine {
  private readonly cfg: TwoHandConfig;
  private state: TwoHandState = 'ASSEMBLED';
  private smoothed: [{ index: number; middle: number }, { index: number; middle: number }] | null = null;
  private closedCount = 0;
  private openCount = 0;
  private lastTwoHandsAt = -Infinity;
  private requestedAt = 0;

  constructor(config: Partial<TwoHandConfig> = {}) {
    this.cfg = { ...DEFAULT_TWO_HAND_CONFIG, ...config };
  }

  public getState(): TwoHandState {
    return this.state;
  }

  public reset(): void {
    this.state = 'ASSEMBLED';
    this.smoothed = null;
    this.closedCount = 0;
    this.openCount = 0;
    this.lastTwoHandsAt = -Infinity;
  }

  private pose(h: { index: number; middle: number }): Pose {
    if (h.index <= this.cfg.closedMax) return 'closed';
    if (h.index >= this.cfg.openMin && h.middle >= this.cfg.openMin) return 'open';
    return 'between';
  }

  /** Follows explode / restore that came from elsewhere (voice, keyboard, model switch). */
  private followModel(input: TwoHandInput): void {
    const { modelExploded, animating, timeMs } = input;
    switch (this.state) {
      case 'ASSEMBLED':
      case 'PINCH_ARMED':
        if (modelExploded) this.state = 'EXPLODED';
        break;
      case 'EXPLODED':
        if (!modelExploded) this.state = 'ASSEMBLED';
        break;
      case 'EXPLODING':
        if (modelExploded && !animating) this.state = 'EXPLODED';
        else if (!modelExploded && timeMs - this.requestedAt > this.cfg.confirmTimeoutMs) this.state = 'ASSEMBLED'; // rejected
        break;
      case 'REASSEMBLING':
        if (!modelExploded && !animating) this.state = 'ASSEMBLED';
        else if (modelExploded && timeMs - this.requestedAt > this.cfg.confirmTimeoutMs) this.state = 'EXPLODED';
        break;
      default:
        break;
    }
  }

  public update(input: TwoHandInput): TwoHandOutput {
    const valid = input.hands.filter((h) => (h.score ?? 1) >= this.cfg.minScore && h.landmarks?.length >= 21);
    if (!input.canExplode) {
      this.reset();
      return { state: this.state, action: null, engaged: false, openness: null };
    }

    // --- fewer than two hands: never act; after a while, mark tracking as lost ---
    if (valid.length < 2) {
      this.closedCount = 0;
      this.openCount = 0;
      const gap = input.timeMs - this.lastTwoHandsAt;
      if (this.state !== 'TRACKING_LOST') {
        this.followModel(input); // animations already requested still complete
        if (gap > this.cfg.lostAfterMs && this.state !== 'EXPLODING' && this.state !== 'REASSEMBLING') {
          this.state = this.lastTwoHandsAt === -Infinity ? this.state : 'TRACKING_LOST';
          this.smoothed = null;
        }
      }
      return { state: this.state, action: null, engaged: gap <= this.cfg.lostAfterMs, openness: null };
    }

    // --- two hands: order them left to right (stable across frames), measure and smooth ---
    this.lastTwoHandsAt = input.timeMs;
    const pair = [...valid].sort((a, b) => a.landmarks[0].x - b.landmarks[0].x).slice(0, 2);
    const raw = pair.map((h) => handOpenness(h.landmarks));
    if (!raw[0] || !raw[1]) return { state: this.state, action: null, engaged: true, openness: null };
    const a = this.cfg.smoothing;
    this.smoothed = this.smoothed
      ? [0, 1].map((i) => ({
        index: a * raw[i]!.index + (1 - a) * this.smoothed![i].index,
        middle: a * raw[i]!.middle + (1 - a) * this.smoothed![i].middle,
      })) as [{ index: number; middle: number }, { index: number; middle: number }]
      : [raw[0], raw[1]];
    const poses = this.smoothed.map((h) => this.pose(h));
    const bothClosed = poses[0] === 'closed' && poses[1] === 'closed';
    const bothOpen = poses[0] === 'open' && poses[1] === 'open';
    this.closedCount = bothClosed ? this.closedCount + 1 : 0;
    this.openCount = bothOpen ? this.openCount + 1 : 0;

    // Back from a tracking loss: follow the model; a fresh pinch is needed before acting
    if (this.state === 'TRACKING_LOST') {
      this.state = input.modelExploded ? 'EXPLODED' : 'ASSEMBLED';
      this.closedCount = bothClosed ? 1 : 0;
      this.openCount = 0;
    }
    this.followModel(input);

    let action: TwoHandAction = null;
    switch (this.state) {
      case 'ASSEMBLED':
        if (this.closedCount >= this.cfg.armFrames) this.state = 'PINCH_ARMED';
        break;
      case 'PINCH_ARMED':
        if (this.openCount >= this.cfg.openFrames) action = 'explode';
        break;
      case 'EXPLODING':
      case 'EXPLODED':
        if (this.closedCount >= this.cfg.armFrames) action = 'restore';
        break;
      case 'REASSEMBLING':
        // Re-opening during reassembly explodes again (the animation reverses smoothly)
        if (this.openCount >= this.cfg.openFrames) action = 'explode';
        break;
      default:
        break;
    }
    if (action === 'explode') {
      this.state = 'EXPLODING';
      this.requestedAt = input.timeMs;
      this.openCount = 0;
    } else if (action === 'restore') {
      this.state = 'REASSEMBLING';
      this.requestedAt = input.timeMs;
      this.closedCount = 0;
    }
    return {
      state: this.state, action, engaged: true,
      openness: [Number(this.smoothed[0].index.toFixed(3)), Number(this.smoothed[1].index.toFixed(3))],
    };
  }
}
