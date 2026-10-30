/**
 * Live scene facts (Task V3) reported by the components that own them, through the existing
 * dispatcher context providers (no duplicated state):
 *   - WorkspaceLayout -> WorkspaceFacts (React state: visibility, explode, lesson step)
 *   - ViewerCanvas / ViewerCommandExecutor -> ViewerFacts (Three.js: pointer, isolation, camera...)
 * `buildSceneSnapshot` (sceneSnapshot.ts) turns them into the typed SceneSnapshot.
 */

import type { CameraViewName } from '../commands/sceneCommands';

/** Where the current pointing comes from. */
export type PointerSource = 'mouse' | 'gesture';

export interface WorkspaceFacts {
  hiddenComponentIds: readonly string[];
  explodedFactor: number;
  lessonStepTitle: string | null;
  lessonStepComponentId: string | null;
}

export interface ViewerFacts {
  /** Component under the mouse cursor or the hand laser pointer right now (null = nothing). */
  hoveredComponentId: string | null;
  hoverSource: PointerSource | null;
  isolatedComponentId: string | null;
  /** Component the camera was last focused on by a command; cleared when the user moves the camera. */
  focusedComponentId: string | null;
  camera: {
    view: CameraViewName | 'custom';
    autoOrbit: boolean;
    transitioning: boolean;
    userSteering: boolean;
  };
  animation: { playing: boolean; speed: number };
  /** Components highlighted together by component.highlight (empty = none). */
  highlightedComponentIds: readonly string[];
  /** Task V4: a camera command is deferred until the user lets go (actions not settled yet). */
  pendingCommand: boolean;
}
