/**
 * Component reference resolver (Task V3) — deterministic, no LLM.
 *
 * Decides WHICH component a request refers to; it never executes anything. The resulting
 * commands still go through the V1 dispatcher, which validates them again.
 *
 * Priority:
 *   1. an explicit part name / alias in the request
 *   2. the component pointed at right now (mouse hover or hand laser pointer)
 *   3. the selected component
 *   4. the last component discussed in this conversation (same model only)
 *   5. otherwise: ask the user — never guess
 * Every implicit candidate must belong to the loaded model, so references left over from a
 * previous model are ignored instead of producing an invalid action.
 */

import type { SceneSnapshot } from './sceneSnapshot';

export type ReferenceSource = 'explicit' | 'pointed' | 'selected' | 'lastDiscussed';

export type ReferenceResolution =
  | { kind: 'resolved'; componentId: string; via: ReferenceSource }
  | { kind: 'ambiguous'; options: string[] }
  | { kind: 'needsClarification' };

export interface ReferenceRequest {
  /** Components of the loaded model named explicitly in the request (from the part lexicon). */
  explicitIds: readonly string[];
  /** True when the request uses "this / that / it" (or a part verb with no part name). */
  contextual: boolean;
}

/** The scene facts the resolver needs; a full SceneSnapshot satisfies it. */
export type ResolverScene = Pick<SceneSnapshot, 'components' | 'pointer' | 'selectedComponentId' | 'lastDiscussedComponentId'>;

export function resolveComponentReference(req: ReferenceRequest, scene: ResolverScene): ReferenceResolution {
  const valid = new Set(scene.components.map((c) => c.id));
  const explicit = [...new Set(req.explicitIds)].filter((id) => valid.has(id));
  if (explicit.length === 1) return { kind: 'resolved', componentId: explicit[0], via: 'explicit' };
  if (explicit.length > 1) return { kind: 'ambiguous', options: explicit };
  if (!req.contextual) return { kind: 'needsClarification' };

  const pointed = scene.pointer.status === 'known' ? scene.pointer.value.componentId : null;
  if (pointed && valid.has(pointed)) return { kind: 'resolved', componentId: pointed, via: 'pointed' };

  if (scene.selectedComponentId && valid.has(scene.selectedComponentId)) {
    return { kind: 'resolved', componentId: scene.selectedComponentId, via: 'selected' };
  }

  const last = scene.lastDiscussedComponentId.status === 'known' ? scene.lastDiscussedComponentId.value : null;
  if (last && valid.has(last)) return { kind: 'resolved', componentId: last, via: 'lastDiscussed' };

  return { kind: 'needsClarification' };
}
