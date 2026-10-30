/**
 * Fact pack (Task V4): the only model knowledge sent to the teaching LLM.
 *
 * Built from the loaded model's own data (metadata, specifications, notes, V3-validated
 * relationships, declared animations) and the V3 scene snapshot. Kept small: full detail only
 * for the question's part and its direct neighbours (or every part for whole-model questions);
 * other parts get id, name, role and relationships. No geometry, no Three.js objects, no keys.
 */

import type { EngineeringModelDefinition } from '../../types/models';
import { getComponentRelationships } from '../scene/componentRelationships';
import type { SceneSnapshot } from '../scene/sceneSnapshot';
import { TEACHABLE_ACTIONS } from './teachingPlan';

export interface FactPack {
  modelId: string;
  modelName: string;
  domain: string;
  /** Task V5: the model's own description (system-level role of each part). */
  modelDescription: string;
  components: {
    id: string;
    name: string;
    role: string;
    description: string;
    notes: string[];
    relationships: { type: string; target: string; description: string }[];
  }[];
  animations: { id: string; label: string; description: string }[];
  allowedActions: string[];
  supportsExplodedView: boolean;
  limits: string[];
  scene: {
    selectedComponentId: string | null;
    pointedComponentId: string | null;
    isolatedComponentId: string | null;
    highlightedComponentIds: string[];
    explodedFactor: number;
    animationPlaying: boolean | null;
    cameraView: string | null;
  };
}

const clip = (s: string | undefined, n: number) => (s ?? '').slice(0, n);

/** What the app can and cannot show, stated explicitly so the LLM never overclaims. */
export function modelLimits(model: EngineeringModelDefinition): string[] {
  if (model.domain === 'medical') {
    // Anatomy learning module: normal anatomy only, never medical advice
    return [
      'Only the relationships listed here are recorded for this model; any other link is unknown.',
      'This is a static 3D model of normal human anatomy from a reference atlas; nothing is simulated. Structures marked simplified are educational shapes, not atlas meshes.',
      'Explain normal anatomy and general function in simple words. Body functions depend on structures working together (for vision: the eye collects light, the brain produces the image): never say one structure does a complex function alone.',
      'Never diagnose, discuss symptoms, injuries, diseases or treatment; for health questions, say to ask a doctor.',
    ];
  }
  const limits = [
    'Only the relationships listed here are recorded for this model; any other link is unknown.',
    'Failures cannot be simulated in this app; failure answers are engineering reasoning only.',
  ];
  if ((model.animations ?? []).length > 0) {
    limits.push('The animation is a kinematic visual demonstration of rotation at fixed speed ratios; it does not simulate forces, torque, friction, wear or load.');
  } else {
    limits.push('This model has no animation.');
  }
  if (model.domain === 'civil') {
    limits.push('No structural analysis, stress calculation or finite-element simulation is implemented; force types in the data are qualitative annotations.');
  }
  return limits;
}

export function buildFactPack(
  model: EngineeringModelDefinition,
  snapshot: SceneSnapshot,
  targetComponentId: string | null
): FactPack {
  const ids = model.getAllComponentIds();
  const detailed = new Set<string>(
    targetComponentId
      ? [targetComponentId, ...getComponentRelationships(model, targetComponentId).map((r) => r.targetComponentId)]
      : ids
  );

  const components = ids.map((id) => {
    const meta = model.getComponentMetadata(id);
    const relationships = getComponentRelationships(model, id).slice(0, 20).map((r) => ({
      type: r.relationshipType,
      target: r.targetComponentId,
      description: clip(r.description, 300),
    }));
    const full = detailed.has(id);
    const notes: string[] = [];
    if (full && meta) {
      notes.push(...meta.engineeringNotes.slice(0, 3));
      const civil = meta as { nominalForceType?: string; educationalNotes?: string[] };
      if (civil.nominalForceType) notes.push(`Force type (qualitative annotation): ${civil.nominalForceType}`);
      notes.push(...(civil.educationalNotes ?? []).slice(0, 2));
      notes.push(...meta.specifications.slice(0, 3).map((s) => `${s.label}: ${s.value}`));
    }
    return {
      id,
      name: clip(meta?.name ?? id, 120),
      role: clip(meta?.role, 200),
      description: full ? clip(meta?.description, 600) : '',
      notes: notes.slice(0, 8).map((n) => clip(n, 300)),
      relationships,
    };
  });

  const pointer = snapshot.pointer.status === 'known' ? snapshot.pointer.value.componentId : null;
  return {
    modelId: model.id,
    modelName: model.name,
    domain: model.domain,
    modelDescription: clip(model.description, 800),
    components,
    animations: (model.animations ?? []).map((a) => ({ id: a.id, label: a.label, description: clip(a.description, 400) })),
    allowedActions: snapshot.availableActions.filter((a) => TEACHABLE_ACTIONS.includes(a)),
    supportsExplodedView: snapshot.exploded.supported,
    limits: modelLimits(model),
    scene: {
      selectedComponentId: snapshot.selectedComponentId,
      pointedComponentId: pointer,
      isolatedComponentId: snapshot.isolatedComponentId.status === 'known' ? snapshot.isolatedComponentId.value : null,
      highlightedComponentIds: snapshot.highlightedComponentIds.status === 'known' ? [...snapshot.highlightedComponentIds.value] : [],
      explodedFactor: snapshot.exploded.factor,
      animationPlaying: snapshot.animation.state.status === 'known' ? snapshot.animation.state.value.playing : null,
      cameraView: snapshot.camera.status === 'known' ? snapshot.camera.value.view : null,
    },
  };
}
