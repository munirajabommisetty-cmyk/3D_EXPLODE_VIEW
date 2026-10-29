/**
 * Relationship tables (Task V3): a small helper for declaring each model's component
 * relationships once, as directed edges with the evidence they are based on. The inverse
 * edge (e.g. driven_by for drives) is generated, so both components see the link.
 */

import type { ComponentRelationship } from '../../types/engineering';

/** Relationship types used by the current models, with their inverses. Domains use their own subset. */
export const INVERSE_RELATIONSHIP: Record<string, string> = {
  drives: 'driven_by',
  driven_by: 'drives',
  mates_with: 'mates_with',
  supports: 'supported_by',
  supported_by: 'supports',
  connected_to: 'connected_to',
  fastened_to: 'fastened_to',
  transfers_force_to: 'receives_force_from',
  receives_force_from: 'transfers_force_to',
};

export interface RelationshipEdge {
  from: string;
  type: keyof typeof INVERSE_RELATIONSHIP;
  to: string;
  /** Plain description shown in the inspector (and later available to the AI teacher). */
  description: string;
  /** Where the relationship comes from in the model (metadata text, animation, geometry). */
  evidence: string;
}

/** Expands directed edges into per-component relationship lists (both directions). */
export function buildRelationshipIndex(edges: readonly RelationshipEdge[]): Map<string, ComponentRelationship[]> {
  const index = new Map<string, ComponentRelationship[]>();
  const add = (id: string, rel: ComponentRelationship) => {
    const list = index.get(id) ?? [];
    list.push(rel);
    index.set(id, list);
  };
  for (const e of edges) {
    add(e.from, { targetComponentId: e.to, relationshipType: e.type, description: e.description });
    add(e.to, { targetComponentId: e.from, relationshipType: INVERSE_RELATIONSHIP[e.type], description: e.description });
  }
  return index;
}
