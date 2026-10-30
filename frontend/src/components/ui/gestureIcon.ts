import type { IconName } from './Icon';

/** Icon for a recognised hand gesture (GestureRecognitionResult.gesture). */
export const gestureIcon = (gesture: string): IconName =>
  gesture === 'OPEN_PALM' ? 'hand' : gesture === 'PINCH' ? 'pinch' : gesture === 'POINTING' ? 'pointer' : 'target';
