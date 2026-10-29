/**
 * Teaching plan schema + validation (Task V4).
 *
 * A teaching plan is DATA produced by the backend LLM endpoint: narrated steps whose actions are
 * V1 SceneCommands. It is validated three times:
 *   1. on the backend against the fact pack (backend/app/teaching.py),
 *   2. here, when it arrives, against the live scene snapshot (validateTeachingPlan),
 *   3. right before each step runs, against the dispatcher's live context (validateStepNow).
 * Invalid steps are rejected and reported; they are never rewritten into different actions.
 */

import type { SceneCommand, SceneCommandContext, SceneCommandType } from '../commands/sceneCommands';
import { validateSceneCommand } from '../commands/sceneCommands';
import type { SceneSnapshot } from '../scene/sceneSnapshot';

export const TEACHING_PLAN_SCHEMA_VERSION = 1;

// Limits shared with backend/app/teaching.py
export const PLAN_LIMITS = {
  steps: 8,
  actionsPerStep: 3,
  narration: 350,
  caption: 120,
  title: 120,
  explanation: 1200,
  followUps: 3,
  followUp: 120,
  holdMs: 4000,
  highlight: 20,
} as const;

/** The subset of V1 commands a plan may use: show and animate only (no hiding, switching, navigating). */
export const TEACHABLE_ACTIONS: readonly SceneCommandType[] = [
  'component.select', 'component.focus', 'component.highlight', 'component.clearHighlight',
  'component.isolate', 'assembly.explode', 'assembly.restore',
  'animation.play', 'animation.pause', 'animation.setSpeed',
  'camera.view', 'camera.reset',
];

export type StepKind = 'demonstrate' | 'explain';
/** visible = the scene shows it; metadata = stated in the model data; engineering = general
 *  explanation built on the data; notSimulated = physical behaviour the app cannot show or verify. */
export type ClaimType = 'visible' | 'metadata' | 'engineering' | 'notSimulated';

export interface TeachingStep {
  index: number;
  kind: StepKind;
  claim: ClaimType;
  narration: string;
  caption: string;
  targetComponentId: string | null;
  actions: SceneCommand[];
  /** 'narration' = continue when the narration ends; 'user' = wait for Continue. */
  waitFor: 'narration' | 'user';
  /** Extra viewing time after the narration (e.g. to watch the animation), 0-4000 ms. */
  holdMs: number;
}

export interface RejectedStep {
  index: number;
  code: string;
  reason: string;
}

export interface TeachingPlan {
  schemaVersion: typeof TEACHING_PLAN_SCHEMA_VERSION;
  planId: string;
  modelId: string;
  targetComponentId: string | null;
  title: string;
  explanation: string;
  cannotAnswer: string | null;
  steps: TeachingStep[];
  rejectedSteps: RejectedStep[];
  followUpSuggestions: string[];
  /** Task V5: narration language (Timbre voice) for this plan; default = the dock language. */
  language?: string;
  /** Task V5: 'llm' = AI teacher; 'modelData' = grounded explanation built from model data only. */
  source?: 'llm' | 'modelData';
}

export type PlanValidation =
  | { ok: true; plan: TeachingPlan }
  | { ok: false; code: string; reason: string };

const UNSAFE_TEXT = new RegExp(
  [
    'https?://', 'www\\.', '<\\s*/?\\s*(script|iframe|img|a)\\b', '```', 'javascript:', '\\beval\\s*\\(', '\\bexec\\s*\\(',
    '\\brequire\\s*\\(', '\\bimport\\s+[\\w{]', '=>', '\\bfunction\\s*\\(', '\\bnew\\s+THREE\\b', '\\bTHREE\\.',
    '\\brm\\s+-rf\\b', '\\bsudo\\b', '\\$\\(',
  ].join('|'),
  'i'
);

class PlanError extends Error {
  public readonly code: string;
  constructor(code: string, reason: string) {
    super(reason);
    this.code = code;
  }
}

function text(value: unknown, max: number, field: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw new PlanError('PLAN_INVALID', `${field} must be text.`);
  const t = value.trim();
  if (!t && !allowEmpty) throw new PlanError('PLAN_INVALID', `${field} is empty.`);
  if (t.length > max) throw new PlanError('PLAN_INVALID', `${field} is longer than ${max} characters.`);
  if (UNSAFE_TEXT.test(t)) throw new PlanError('PLAN_UNSAFE', `${field} contains code, markup or a link.`);
  return t;
}

/**
 * Checks one action against the snapshot's model and capabilities, then V1's own validator.
 * Returns the clean command or throws; never substitutes a different action.
 */
function action(raw: unknown, snapshot: SceneSnapshot, ctx: SceneCommandContext): SceneCommand {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new PlanError('ACTION_INVALID', 'Action must be an object.');
  const type = (raw as { type?: unknown }).type;
  if (!TEACHABLE_ACTIONS.includes(type as SceneCommandType)) {
    throw new PlanError('ACTION_UNSUPPORTED', `Action "${String(type)}" is not allowed in teaching plans.`);
  }
  if (!snapshot.availableActions.includes(type as SceneCommandType)) {
    throw new PlanError('ACTION_UNAVAILABLE', `Action "${String(type)}" is not available for this model right now.`);
  }
  const result = validateSceneCommand(raw, ctx);
  if (!result.ok) throw new PlanError(result.code, result.reason);
  return result.command;
}

/** Validates a plan that just arrived from the backend against the current scene. */
export function validateTeachingPlan(raw: unknown, snapshot: SceneSnapshot, ctx: SceneCommandContext): PlanValidation {
  try {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new PlanError('PLAN_INVALID', 'Plan must be an object.');
    const p = raw as Record<string, unknown>;
    if (p.schemaVersion !== TEACHING_PLAN_SCHEMA_VERSION) throw new PlanError('PLAN_INVALID', 'Unknown plan schema version.');
    if (typeof p.planId !== 'string' || !/^[a-f0-9]{8,64}$/.test(p.planId)) throw new PlanError('PLAN_INVALID', 'Plan id is missing.');
    if (!snapshot.model || p.modelId !== snapshot.model.id) {
      throw new PlanError('STALE_MODEL', 'This explanation was prepared for a different model.');
    }
    const ids = new Set(snapshot.components.map((c) => c.id));
    const target = p.targetComponentId ?? null;
    if (target !== null && (typeof target !== 'string' || !ids.has(target))) {
      throw new PlanError('UNKNOWN_COMPONENT', `Plan target "${String(target)}" is not in this model.`);
    }
    if (!Array.isArray(p.steps) || p.steps.length === 0) throw new PlanError('PLAN_INVALID', 'Plan has no steps.');
    if (p.steps.length > PLAN_LIMITS.steps) throw new PlanError('PLAN_TOO_LONG', `Plan has more than ${PLAN_LIMITS.steps} steps.`);
    const followRaw = p.followUpSuggestions ?? [];
    if (!Array.isArray(followRaw)) throw new PlanError('PLAN_INVALID', 'followUpSuggestions must be a list.');

    const plan: TeachingPlan = {
      schemaVersion: TEACHING_PLAN_SCHEMA_VERSION,
      planId: p.planId,
      modelId: snapshot.model.id,
      targetComponentId: target as string | null,
      title: text(p.title, PLAN_LIMITS.title, 'title'),
      explanation: text(p.explanation, PLAN_LIMITS.explanation, 'explanation'),
      cannotAnswer: p.cannotAnswer == null ? null : text(p.cannotAnswer, 300, 'cannotAnswer', true) || null,
      steps: [],
      rejectedSteps: Array.isArray(p.rejectedSteps)
        ? (p.rejectedSteps as RejectedStep[]).filter((r) => r && typeof r.index === 'number').map((r) => ({
          index: r.index, code: String(r.code ?? 'REJECTED').slice(0, 40), reason: String(r.reason ?? '').slice(0, 200),
        }))
        : [],
      followUpSuggestions: followRaw.slice(0, PLAN_LIMITS.followUps).map((f) => text(f, PLAN_LIMITS.followUp, 'followUp')),
      ...(typeof p.language === 'string' && /^[a-z]{2}-IN$/.test(p.language) ? { language: p.language } : {}),
      ...(p.source === 'llm' || p.source === 'modelData' ? { source: p.source } : {}),
    };

    (p.steps as unknown[]).forEach((rawStep, position) => {
      const s = (typeof rawStep === 'object' && rawStep !== null ? rawStep : {}) as Record<string, unknown>;
      const index = typeof s.index === 'number' ? s.index : position;
      try {
        if (typeof rawStep !== 'object' || rawStep === null) throw new PlanError('PLAN_INVALID', 'Step must be an object.');
        if (s.kind !== 'demonstrate' && s.kind !== 'explain') throw new PlanError('PLAN_INVALID', 'Unknown step kind.');
        if (!['visible', 'metadata', 'engineering', 'notSimulated'].includes(s.claim as string)) {
          throw new PlanError('PLAN_INVALID', 'Unknown claim type.');
        }
        const acts = s.actions ?? [];
        if (!Array.isArray(acts) || acts.length > PLAN_LIMITS.actionsPerStep) {
          throw new PlanError('PLAN_INVALID', `A step may have at most ${PLAN_LIMITS.actionsPerStep} actions.`);
        }
        const stepTarget = s.targetComponentId ?? null;
        if (stepTarget !== null && (typeof stepTarget !== 'string' || !ids.has(stepTarget))) {
          throw new PlanError('UNKNOWN_COMPONENT', `Step target "${String(stepTarget)}" is not in this model.`);
        }
        const hold = s.holdMs ?? 0;
        if (typeof hold !== 'number' || !Number.isInteger(hold) || hold < 0 || hold > PLAN_LIMITS.holdMs) {
          throw new PlanError('PLAN_INVALID', `holdMs must be 0-${PLAN_LIMITS.holdMs}.`);
        }
        plan.steps.push({
          index,
          kind: s.kind,
          claim: s.claim as ClaimType,
          narration: text(s.narration, PLAN_LIMITS.narration, 'narration'),
          caption: text(s.caption, PLAN_LIMITS.caption, 'caption'),
          targetComponentId: stepTarget as string | null,
          actions: acts.map((a) => action(a, snapshot, ctx)),
          waitFor: s.waitFor === 'user' ? 'user' : 'narration',
          holdMs: hold,
        });
      } catch (err) {
        if (!(err instanceof PlanError)) throw err;
        plan.rejectedSteps.push({ index, code: err.code, reason: err.message });
      }
    });

    if (plan.steps.length === 0) throw new PlanError('PLAN_INVALID', 'No step of the plan can run on this model.');
    return { ok: true, plan };
  } catch (err) {
    if (err instanceof PlanError) return { ok: false, code: err.code, reason: err.message };
    throw err;
  }
}

/**
 * Re-validates one step against the live scene immediately before it runs (the user may have
 * switched models or changed the scene since the plan was created).
 */
export function validateStepNow(
  step: TeachingStep,
  planModelId: string,
  ctx: SceneCommandContext
): { ok: true; commands: SceneCommand[] } | { ok: false; code: string; reason: string } {
  if (ctx.modelId !== planModelId) return { ok: false, code: 'STALE_MODEL', reason: 'The loaded model changed.' };
  const commands: SceneCommand[] = [];
  for (const command of step.actions) {
    if (!TEACHABLE_ACTIONS.includes(command.type)) {
      return { ok: false, code: 'ACTION_UNSUPPORTED', reason: `Action "${command.type}" is not allowed.` };
    }
    const result = validateSceneCommand(command, ctx);
    if (!result.ok) return { ok: false, code: result.code, reason: result.reason };
    commands.push(result.command);
  }
  return { ok: true, commands };
}
