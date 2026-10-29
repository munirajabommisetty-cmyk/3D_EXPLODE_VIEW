/**
 * Grounded explanation from model data only (Task V5).
 *
 * Used when the AI teacher cannot answer (not configured, quota used up, provider or network
 * error, or an AI plan that failed validation), so a valid request always gets a spoken,
 * captioned answer. Every sentence comes from the loaded model: the component's name, role,
 * description and engineering notes, and its V3-validated relationships. Nothing is invented;
 * failures and forces are explicitly marked as not simulated.
 *
 * The result is an ordinary teaching plan: it goes through validateTeachingPlan and the same
 * player (scene actions validated again before each step).
 *
 * Milestone A: for Telugu, Hindi and Bengali the brief is built in that language
 * (localizedBrief.ts); English keeps the original wording plus a curated everyday example.
 */

import type { EngineeringModelDefinition } from '../../types/models';
import { getComponentRelationships } from '../scene/componentRelationships';
import type { SceneSnapshot } from '../scene/sceneSnapshot';
import { PLAN_LIMITS } from './teachingPlan';
import { teachingNote } from '../../data/teachingNotes';
import { buildLocalizedBrief, LOCALIZED_BRIEF_LANGUAGES, type BriefLanguage } from './localizedBrief';

const VERB: Record<string, string> = {
  drives: 'drives',
  driven_by: 'is driven by',
  mates_with: 'meshes with',
  supports: 'supports',
  supported_by: 'is supported by',
  connected_to: 'is connected to',
  fastened_to: 'is fastened to',
  transfers_force_to: 'passes load to',
  receives_force_from: 'receives load from',
};

/** Joins names as "A", "A and B", "A, B and C". */
function list(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Shortens to whole sentences within the narration limit. */
function fit(text: string, max: number = PLAN_LIMITS.narration): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const sentences = t.match(/[^.!?]+[.!?]+/g) ?? [t];
  let out = '';
  for (const s of sentences) {
    if ((out + s).trim().length > max) break;
    out += s;
  }
  return (out.trim() || t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…');
}

const hexId = () => Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

const step = (index: number, o: { kind?: string; claim: string; caption: string; narration: string; actions?: unknown[]; target?: string | null }) => ({
  index,
  kind: o.kind ?? 'explain',
  claim: o.claim,
  caption: fit(o.caption, PLAN_LIMITS.caption),
  narration: fit(o.narration),
  targetComponentId: o.target ?? null,
  actions: o.actions ?? [],
  waitFor: 'narration',
  holdMs: 0,
});

/**
 * Builds a grounded plan for one component (or the whole model when componentId is null).
 * questionType tailors the emphasis ('failure' adds what is linked and what is not simulated).
 */
export function buildComponentBrief(
  model: EngineeringModelDefinition,
  snapshot: SceneSnapshot,
  componentId: string | null,
  questionType = 'explain',
  language = 'en-IN',
  opts: { bilingual?: boolean } = {}
): Record<string, unknown> {
  if (LOCALIZED_BRIEF_LANGUAGES.includes(language)) {
    return buildLocalizedBrief(model, snapshot, componentId, questionType, language as BriefLanguage, opts);
  }
  // Anatomy (e.g. the eye): normal anatomy only; never failure/medical speculation
  const anatomy = model.domain === 'medical';
  const anatomyLimit = 'This is a model of normal human anatomy for learning. It does not simulate how the body works, and it is not medical advice.';
  const anatomySafety = 'This app explains normal anatomy only. It cannot answer questions about damage, symptoms or treatment; please ask a doctor about health questions.';
  const can = (a: string) => snapshot.availableActions.includes(a as never);
  const nameOf = (id: string) => model.getComponentMetadata(id)?.name ?? id;
  const animated = (model.animations ?? []).length > 0;
  const steps: ReturnType<typeof step>[] = [];

  if (componentId && questionType === 'failure' && !anatomy) {
    // What-if / absence: the consequence first, grounded in the recorded role and relationships
    const meta = model.getComponentMetadata(componentId);
    const name = meta?.name ?? componentId;
    const rels = getComponentRelationships(model, componentId);
    const linkedIds = [...new Set(rels.map((r) => r.targetComponentId))];
    const linked = list(linkedIds.map(nameOf));
    steps.push(step(0, {
      kind: 'demonstrate', claim: 'engineering', target: componentId, caption: `Without the ${name}`,
      narration: `Without the ${name}, its job would not be done. In this model its job is: ${meta?.role ?? 'not recorded'}.`,
      actions: can('component.focus') ? [{ type: 'component.focus', componentId }] : [],
    }));
    if (linkedIds.length) {
      steps.push(step(1, {
        kind: 'demonstrate', claim: 'engineering', target: componentId, caption: `What depends on the ${name}`,
        narration: `The parts it works with directly, ${linked}, would be affected, and another properly designed part or system would have to do its job.`,
        actions: can('component.highlight') ? [{ type: 'component.highlight', componentIds: linkedIds.slice(0, PLAN_LIMITS.highlight) }] : [],
      }));
    }
    steps.push(step(steps.length, {
      claim: 'notSimulated', target: componentId, caption: 'What this app does not simulate',
      narration: `${model.domain === 'civil'
        ? "In a real building, removing a structural member without an engineer's assessment can be dangerous."
        : 'In a real machine, it would not work as designed without this part.'} This model does not simulate the failure itself.`,
    }));
    return {
      schemaVersion: 1, planId: hexId(), modelId: model.id, targetComponentId: componentId,
      title: `Without the ${name} (from the model data)`,
      explanation: fit(`Without the ${name}, its job would not be done: ${meta?.role ?? ''}.`, PLAN_LIMITS.explanation),
      cannotAnswer: null, steps, rejectedSteps: [],
      followUpSuggestions: [`Why is the ${name} needed?`, `Show me the parts connected to the ${name}.`],
      language: 'en-IN', source: 'modelData',
    };
  }

  if (componentId) {
    const meta = model.getComponentMetadata(componentId);
    const name = meta?.name ?? componentId;
    steps.push(step(0, {
      kind: 'demonstrate', claim: 'metadata', target: componentId, caption: name,
      narration: `This is the ${name}. Its role: ${meta?.role ?? 'not recorded'}. ${meta?.description ?? ''}`,
      actions: can('component.focus') ? [{ type: 'component.focus', componentId }] : [],
    }));

    const rels = getComponentRelationships(model, componentId);
    if (rels.length > 0) {
      const byVerb = new Map<string, string[]>();
      for (const r of rels) {
        const verb = VERB[r.relationshipType] ?? r.relationshipType.replace(/_/g, ' ');
        const names = byVerb.get(verb) ?? [];
        if (!names.includes(nameOf(r.targetComponentId))) names.push(nameOf(r.targetComponentId));
        byVerb.set(verb, names);
      }
      const clauses = [...byVerb.entries()].map(([verb, names]) => `${verb} ${list(names)}`);
      const related = [...new Set(rels.map((r) => r.targetComponentId))];
      steps.push(step(1, {
        kind: 'demonstrate', claim: 'metadata', target: componentId, caption: `How the ${name} connects`,
        narration: `In this model, the ${name} ${list(clauses)}.`,
        actions: can('component.highlight') ? [{ type: 'component.highlight', componentIds: related.slice(0, PLAN_LIMITS.highlight) }] : [],
      }));
    } else {
      steps.push(step(1, {
        claim: 'metadata', target: componentId, caption: 'Connections',
        narration: `No connections to other parts are recorded for the ${name} in this model.`,
      }));
    }

    const notes = meta?.engineeringNotes ?? [];
    if (notes.length > 0) {
      steps.push(step(2, {
        claim: 'metadata', target: componentId, caption: anatomy ? 'Key facts' : 'From the engineering notes',
        narration: notes.slice(0, 2).join(' '),
      }));
    }

    const example = teachingNote(model.id, componentId, 'en-IN')?.analogy;
    if (example && questionType !== 'failure') {
      steps.push(step(steps.length, { claim: 'engineering', target: componentId, caption: 'An everyday comparison', narration: example }));
    }

    const linked = list([...new Set(rels.map((r) => nameOf(r.targetComponentId)))]);
    steps.push(step(steps.length, {
      claim: 'notSimulated', target: componentId, caption: anatomy ? 'About this model' : 'What this app does not simulate',
      narration: anatomy
        ? (questionType === 'failure' ? anatomySafety : anatomyLimit)
        : questionType === 'failure' && linked
        ? `A failure cannot be simulated here. Based on the recorded connections, a problem with the ${name} would affect ${linked}.`
        : animated
          ? 'The animation shows the motion only. It does not calculate forces, torque, friction or wear.'
          : 'This model shows the structure only. It does not calculate forces or stresses.',
    }));

    return {
      schemaVersion: 1, planId: hexId(), modelId: model.id, targetComponentId: componentId,
      title: `${name} (from the model data)`,
      explanation: fit(`${name}: ${meta?.role ?? ''}. ${meta?.description ?? ''}`, PLAN_LIMITS.explanation),
      cannotAnswer: null, steps, rejectedSteps: [],
      followUpSuggestions: [`Why is the ${name} needed?`, `Show me the parts connected to the ${name}.`],
      language: 'en-IN', source: 'modelData',
    };
  }

  // Whole model
  steps.push(step(0, { claim: 'metadata', caption: model.name, narration: `${model.name}. ${model.description}` }));
  const seen = new Set<string>();
  const facts: string[] = [];
  for (const id of model.getAllComponentIds()) {
    for (const r of getComponentRelationships(model, id)) {
      if (!r.description || seen.has(r.description) || !['drives', 'supports', 'transfers_force_to', 'connected_to'].includes(r.relationshipType)) continue;
      seen.add(r.description);
      facts.push(r.description);
    }
  }
  if (facts.length > 0) {
    steps.push(step(1, { claim: 'metadata', caption: 'How the parts work together', narration: facts.slice(0, 4).join(' ') }));
  }
  const modelExample = teachingNote(model.id, null, 'en-IN')?.analogy;
  if (modelExample) steps.push(step(steps.length, { claim: 'engineering', caption: 'An everyday comparison', narration: modelExample }));
  steps.push(step(steps.length, {
    claim: 'notSimulated', caption: anatomy ? 'About this model' : 'What this app does not simulate',
    narration: anatomy
      ? anatomyLimit
      : animated
      ? 'The animation shows the motion only. It does not calculate forces, torque, friction or wear.'
      : 'This model shows the structure only. It does not calculate forces or stresses.',
  }));
  return {
    schemaVersion: 1, planId: hexId(), modelId: model.id, targetComponentId: null,
    title: `${model.name} (from the model data)`,
    explanation: fit(model.description, PLAN_LIMITS.explanation),
    cannotAnswer: null, steps, rejectedSteps: [],
    followUpSuggestions: ['Select a part and ask me to explain it.'],
    language: 'en-IN', source: 'modelData',
  };
}
