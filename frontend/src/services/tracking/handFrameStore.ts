/**
 * Per-frame hand data, outside React (hand-tracking performance pass).
 *
 * The webcam panel publishes every tracked frame here; the 3D viewer reads it through its existing
 * refs in the render loop. React state in the app is only updated when something the UI shows
 * changes (number of hands, gesture name / stability / hand, confidence in 10 % steps), so a camera
 * frame no longer re-renders the whole workspace.
 */

import type { HandLandmarkResult } from '../../types/landmarks';
import type { GestureRecognitionResult } from '../../types/gestures';

export interface HandFrame {
  hands: HandLandmarkResult[];
  gesture: GestureRecognitionResult | null;
}

type Listener = (frame: HandFrame) => void;

export class HandFrameStore {
  private frame: HandFrame = { hands: [], gesture: null };
  private readonly listeners = new Set<Listener>();

  publish(hands: HandLandmarkResult[], gesture: GestureRecognitionResult | null): void {
    this.frame = { hands, gesture };
    for (const l of this.listeners) l(this.frame);
  }

  get(): HandFrame {
    return this.frame;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** The app's single hand-frame channel (one webcam panel, one viewer). */
export const handFrameStore = new HandFrameStore();

/** Changes only when what the UI shows about the hands changes (count and which hands). */
export function coarseHandsKey(hands: readonly HandLandmarkResult[]): string {
  return `${hands.length}:${hands.map((h) => h.handedness).join(',')}`;
}

/** Changes only when the shown gesture state changes (confidence in 10 % steps). */
export function coarseGestureKey(g: GestureRecognitionResult | null | undefined): string {
  if (!g) return 'none';
  return `${g.gesture}|${g.rawGesture}|${g.isStable ? 1 : 0}|${g.handedness ?? '-'}|${Math.round((g.confidence ?? 0) * 10)}`;
}
