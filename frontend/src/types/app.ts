/**
 * Core application state and module interfaces for Gesture-Controlled 3D Machine Explorer
 */

export type AppPhase =
  | 'PHASE_1_FOUNDATION'
  | 'PHASE_1_VIEWPORT'
  | 'PHASE_2_TRACKING'
  | 'PHASE_3_GESTURES'
  | 'PHASE_4_INTERACTION'
  | 'PHASE_5_INSPECTOR';

export interface ModuleStatus {
  id: string;
  name: string;
  phase: string;
  status: 'active' | 'ready_next' | 'pending';
  description: string;
}
