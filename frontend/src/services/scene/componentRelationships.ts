/**
 * Component relationship queries (Task V3). Reads the relationships each model declares in its
 * component metadata (see models/*Relationships.ts) — never invents links. Every returned ID is
 * checked against the model's own component list.
 */

import { validateComponentRelationships, type ComponentRelationship } from '../../types/engineering';
import type { EngineeringModelDefinition } from '../../types/models';
import { INVERSE_RELATIONSHIP } from './relationshipTable';

/** Direct relationships of a component in this model ([] if unknown component or none recorded). */
export function getComponentRelationships(model: EngineeringModelDefinition, componentId: string): ComponentRelationship[] {
  const valid = new Set(model.getAllComponentIds());
  if (!valid.has(componentId)) return [];
  const rels = model.getComponentMetadata(componentId)?.relationships ?? [];
  return rels.filter((r) => valid.has(r.targetComponentId) && r.targetComponentId !== componentId);
}

/** IDs of directly related components (optionally only some relationship types), without duplicates. */
export function getRelatedComponentIds(
  model: EngineeringModelDefinition,
  componentId: string,
  types?: readonly string[]
): string[] {
  const out: string[] = [];
  for (const r of getComponentRelationships(model, componentId)) {
    if (types && !types.includes(r.relationshipType)) continue;
    if (!out.includes(r.targetComponentId)) out.push(r.targetComponentId);
  }
  return out;
}

/** Components reachable within `depth` relationship hops (breadth-first), excluding the start. */
export function getNeighbourhood(model: EngineeringModelDefinition, componentId: string, depth = 1): string[] {
  const seen = new Set([componentId]);
  let frontier = [componentId];
  const out: string[] = [];
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of getRelatedComponentIds(model, id)) {
        if (seen.has(n)) continue;
        seen.add(n);
        out.push(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return out;
}

export interface ModelRelationshipReport {
  isValid: boolean;
  errors: string[];
  /** Components with no recorded relationships (documented gaps, not errors). */
  componentsWithoutRelationships: string[];
}

/** Checks every relationship of a model: valid targets, no self links, and matching inverse edges. */
export function validateModelRelationships(model: EngineeringModelDefinition): ModelRelationshipReport {
  const ids = model.getAllComponentIds();
  const errors: string[] = [];
  const without: string[] = [];
  for (const id of ids) {
    const meta = model.getComponentMetadata(id);
    if (!meta) continue;
    const rels = meta.relationships ?? [];
    if (rels.length === 0) without.push(id);
    errors.push(...validateComponentRelationships(meta, ids).errors);
    for (const r of rels) {
      const inverse = INVERSE_RELATIONSHIP[r.relationshipType];
      if (!inverse) {
        errors.push(`Component "${id}" uses unknown relationship type "${r.relationshipType}".`);
        continue;
      }
      const back = model.getComponentMetadata(r.targetComponentId)?.relationships ?? [];
      if (!back.some((b) => b.targetComponentId === id && b.relationshipType === inverse)) {
        errors.push(`"${id}" ${r.relationshipType} "${r.targetComponentId}" has no matching "${inverse}" entry.`);
      }
    }
  }
  return { isValid: errors.length === 0, errors, componentsWithoutRelationships: without };
}
