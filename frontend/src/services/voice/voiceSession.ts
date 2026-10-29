/**
 * Voice turn handling (Task V2): transcript -> phrase parser -> V1 SceneCommandDispatcher -> reply.
 *
 * Voice never executes anything itself: every parsed command is sent through the existing
 * dispatcher (source 'voice'), so V1 validation, model checks and hand/mouse arbitration apply.
 * Kept free of React so it can be tested end to end.
 */

import type { EngineeringModelDefinition } from '../../types/models';
import type { CommandRecord, SceneCommandDispatcher } from '../commands/sceneCommandDispatcher';
import type { SceneCommand } from '../commands/sceneCommands';
import { buildPartLexicon, normalise, type LexiconEntry } from './partLexicon';
import { COMMON_FOREIGN_PARTS, parseVoiceCommand, type ForeignPart, type ParseOutcome, type VoiceIntent } from './phraseParser';
import { reply, type ReplyVars } from './voiceReplies';
import { getSceneSnapshot } from '../scene/sceneSnapshot';

/** answered = a question answered from model metadata; unavailable = understood but not possible
 *  here (no recorded relationships, nothing to put back, or a teaching answer that V4 will add). */
export type VoiceTurnStatus = 'executed' | 'deferred' | 'rejected' | 'needsInput' | 'answered' | 'unavailable' | 'teach' | 'control';

/** A teaching question for the backend teaching endpoint (Task V4). The part is already resolved
 *  by the V3 resolver; null = a question about the whole model. */
export interface TeachingRequestInfo {
  question: string;
  questionType: string;
  targetComponentId: string | null;
  /** Task V5: language the user asked for ("explain it in Telugu"); else the current one. */
  language?: string;
  /** Milestone A: "in English and Telugu" -> narration in `language`, captions and summary in English. */
  bilingual?: boolean;
}

export interface VoiceTurnResult {
  status: VoiceTurnStatus;
  /** Caption shown on screen (and spoken when `speak` is true). */
  caption: string;
  /** Spoken by default for problems; confirmations only when "speak all replies" is on. */
  speak: boolean;
  outcome: ParseOutcome;
  records: CommandRecord[];
  /** Component this turn was about, for "it/that" in the next turn (Task V3). */
  discussedComponentId?: string;
  /** Set when status is 'teach': the caller requests a teaching plan. */
  teach?: TeachingRequestInfo;
  /** Set when status is 'control': pause / resume / stop the explanation that is playing (Task V5). */
  control?: 'pause' | 'resume' | 'stop';
}

const lexiconCache = new Map<string, LexiconEntry[]>();

export function lexiconFor(model: EngineeringModelDefinition): LexiconEntry[] {
  let lex = lexiconCache.get(model.id);
  if (!lex) {
    lex = buildPartLexicon(model);
    lexiconCache.set(model.id, lex);
  }
  return lex;
}

/** Parts that are NOT in the current model: other registered models' parts + common machine parts. */
export function foreignPartsFor(model: EngineeringModelDefinition, allModels: EngineeringModelDefinition[]): ForeignPart[] {
  const own = new Set(lexiconFor(model).flatMap((e) => e.phrases));
  // Words of the model's own name ("steam engine", "eye") mean the model itself, never a foreign part
  const name = normalise(model.name);
  for (const w of name.split(' ')) { own.add(w); own.add(w.replace(/s$/, '')); }
  own.add(name);
  const out: ForeignPart[] = [];
  for (const other of allModels) {
    if (other.id === model.id) continue;
    for (const entry of lexiconFor(other)) {
      for (const phrase of entry.phrases) {
        if (!own.has(phrase)) out.push({ phrase, modelName: other.name });
      }
    }
  }
  for (const phrase of COMMON_FOREIGN_PARTS) if (!own.has(phrase)) out.push({ phrase });
  return out;
}

function partName(lexicon: LexiconEntry[], id: string | undefined): string {
  return lexicon.find((e) => e.componentId === id)?.displayName ?? id ?? '';
}

function replyKeyForCommands(intent: VoiceIntent, cmds: SceneCommand[]): { key: Parameters<typeof reply>[0]; vars: ReplyVars } {
  const last = cmds[cmds.length - 1];
  switch (last.type) {
    case 'camera.zoom':
      return { key: last.direction === 'in' ? 'zoomIn' : 'zoomOut', vars: {} };
    case 'camera.pan':
      return { key: 'pan', vars: { dir: last.direction } };
    case 'camera.orbit': {
      const dir = last.yawDeg > 0 ? 'left' : last.yawDeg < 0 ? 'right' : (last.pitchDeg ?? 0) > 0 ? 'up' : 'down';
      return { key: 'orbit', vars: { dir } };
    }
    case 'camera.view':
      return { key: 'view', vars: { view: last.view } };
    case 'camera.autoOrbit':
      return { key: last.enabled ? 'autoOrbit' : 'autoOrbitOff', vars: {} };
    case 'animation.setSpeed':
      return { key: 'animSpeed', vars: { speed: last.speed } };
    default:
      return { key: intent, vars: {} };
  }
}

export interface VoiceTurnInput {
  transcript: string;
  language: string;
  dispatcher: SceneCommandDispatcher;
  model: EngineeringModelDefinition;
  allModels: EngineeringModelDefinition[];
  speakConfirmations?: boolean;
  /** Conversation memory kept by the caller (Task V3); ignored if it belongs to another model. */
  lastDiscussed?: { modelId: string; componentId: string } | null;
  /** Task V4: true when the teaching path is enabled; explanation questions then become 'teach'. */
  teachingAvailable?: boolean;
  /** Task V5: an explanation is playing/paused (enables "wait / continue / stop"). */
  teachingActive?: boolean;
  /**
   * Task V5: called once, before anything runs, when this turn is a NEW request (a scene command,
   * an answer or a teaching question) — the caller cancels the explanation it supersedes.
   * Not called for clarifications, unrecognised speech, or explanation controls.
   */
  onSupersede?: () => void;
  /** Original words for a teaching question when `transcript` is a canonical phrase (LLM fallback). */
  questionText?: string;
}

/**
 * Parse only (no dispatch, no side effects): would this transcript be understood? Used to pick
 * between transcripts of the same recording in different languages.
 */
export function previewTurn(input: Pick<VoiceTurnInput, 'transcript' | 'dispatcher' | 'model' | 'allModels' | 'lastDiscussed' | 'teachingActive'>): ParseOutcome {
  const scene = getSceneSnapshot(input.dispatcher, input.model, { lastDiscussed: input.lastDiscussed ?? null });
  return parseVoiceCommand(input.transcript, {
    lexicon: lexiconFor(input.model),
    foreignParts: foreignPartsFor(input.model, input.allModels),
    selectedComponentId: scene.selectedComponentId,
    lessonActive: scene.lesson.active,
    scene,
    teachingActive: input.teachingActive,
  });
}

/** Script of a transcript -> the language it was most likely spoken in (null = Latin/unknown). */
export function scriptLanguage(text: string): 'te-IN' | 'hi-IN' | null {
  const te = (text.match(/[ఀ-౿]/g) ?? []).length;
  const hi = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  if (te === 0 && hi === 0) return null;
  return te >= hi ? 'te-IN' : 'hi-IN';
}

export function handleVoiceTurn(input: VoiceTurnInput): VoiceTurnResult {
  const { transcript, language, dispatcher, model } = input;
  const lexicon = lexiconFor(model);
  const scene = getSceneSnapshot(dispatcher, model, { lastDiscussed: input.lastDiscussed ?? null });
  const outcome = parseVoiceCommand(transcript, {
    lexicon,
    foreignParts: foreignPartsFor(model, input.allModels),
    selectedComponentId: scene.selectedComponentId,
    lessonActive: scene.lesson.active,
    scene,
    teachingActive: input.teachingActive,
  });
  const modelName = model.name;
  const say = (key: Parameters<typeof reply>[0], vars: ReplyVars = {}) => reply(key, language, { model: modelName, ...vars });

  if (!transcript.trim()) {
    return { status: 'needsInput', caption: say('emptyTranscript'), speak: true, outcome, records: [] };
  }
  // Camera-only commands ("zoom in", "show the back") do not end an explanation: they run, and
  // the player's takeover rule pauses it, so "continue" resumes it and a paused plan cannot undo
  // the camera move by itself. Any other new request replaces the explanation.
  const cameraOnly = outcome.kind === 'commands' && outcome.commands.every((c) => c.type.startsWith('camera.'));
  const supersedes = (outcome.kind === 'commands' && !cameraOnly) || outcome.kind === 'question' ||
    (outcome.kind === 'unavailable' && outcome.reason !== 'noBottomView');
  if (supersedes) input.onSupersede?.();

  switch (outcome.kind) {
    case 'teachControl':
      return {
        status: 'control', control: outcome.action, outcome, records: [], speak: false,
        caption: say(outcome.action === 'pause' ? 'teachPaused' : outcome.action === 'resume' ? 'teachResumed' : 'teachStopped'),
      };
    case 'noMatch':
      return { status: 'rejected', caption: say('noMatch'), speak: true, outcome, records: [] };
    case 'smallTalk': {
      // Deterministic, friendly and short; no AI call, no scene action, an explanation keeps playing
      const lines: string[] = [];
      if (outcome.name) lines.push(say('chatHelloName', { name: outcome.name }));
      else if (outcome.acts.includes('greeting') || outcome.acts.includes('howAreYou')) lines.push(say('chatHello'));
      if (outcome.acts.includes('howAreYou')) lines.push(say('chatWell'));
      if (outcome.acts.includes('thanks')) lines.push(say('chatThanks'));
      if (outcome.acts.includes('goodbye')) lines.push(say('chatBye'));
      else if (!outcome.acts.includes('thanks') || lines.length > 1) lines.push(say('chatOffer'));
      return { status: 'answered', caption: lines.join(' '), speak: true, outcome, records: [] };
    }
    case 'declined':
      return { status: 'answered', caption: say('declined'), speak: true, outcome, records: [] };
    case 'needsSelection':
      return { status: 'needsInput', caption: say('needsSelection'), speak: true, outcome, records: [] };
    case 'ambiguous':
      return {
        status: 'needsInput',
        caption: say('ambiguous', { options: outcome.options.map((id) => partName(lexicon, id)) }),
        speak: true, outcome, records: [],
      };
    case 'question': {
      // Task V4: explanation questions go to the teaching engine; "what is this?" stays local
      if (input.teachingAvailable && outcome.question !== 'identify') {
        return {
          status: 'teach',
          caption: say(outcome.partId ? 'teachPreparing' : outcome.open ? 'teachThinking' : 'teachPreparingModel', { part: partName(lexicon, outcome.partId) }),
          speak: false, outcome, records: [],
          discussedComponentId: outcome.partId,
          teach: {
            // An open question keeps the learner's own words; the teacher resolves its topic
            question: (input.questionText ?? transcript).trim(),
            questionType: outcome.open && outcome.question === 'explain' && !outcome.followUp ? 'general' : outcome.question,
            targetComponentId: outcome.partId ?? null,
            ...(outcome.language ? { language: outcome.language } : {}),
            ...(outcome.bilingual ? { bilingual: true } : {}),
          },
        };
      }
      if (!outcome.partId) {
        return { status: 'unavailable', caption: say('questionNoPart'), speak: true, outcome, records: [] };
      }
      const part = partName(lexicon, outcome.partId);
      if (outcome.question === 'identify') {
        const role = model.getComponentMetadata(outcome.partId)?.role ?? '';
        return {
          status: 'answered', caption: say(role ? 'identify' : 'ask', { part, role }), speak: true,
          outcome, records: [], discussedComponentId: outcome.partId,
        };
      }
      // How/why/what-if: the part is identified for V4, but no explanation is invented here
      return {
        status: 'unavailable', caption: say('notTaughtYet', { part }), speak: true,
        outcome, records: [], discussedComponentId: outcome.partId,
      };
    }
    case 'unavailable':
      return {
        status: 'unavailable',
        caption: say(outcome.reason, { part: partName(lexicon, outcome.partId) }),
        speak: true, outcome, records: [], discussedComponentId: outcome.partId,
      };
    case 'unknownPart': {
      const spoken = outcome.spoken ? displaySpoken(outcome.spoken) : '';
      const caption = !spoken
        ? say('unknownPartGeneric')
        : outcome.belongsTo
          ? say('unknownPartOtherModel', { part: spoken, other: outcome.belongsTo })
          : say('unknownPart', { part: spoken });
      return { status: 'rejected', caption, speak: true, outcome, records: [] };
    }
    case 'commands': {
      const records: CommandRecord[] = [];
      for (const command of outcome.commands) {
        const rec = dispatcher.dispatch(command, 'voice');
        records.push(rec);
        if (rec.status === 'rejected') {
          const key = (rec.code ?? 'cannot') as Parameters<typeof reply>[0];
          return { status: 'rejected', caption: say(key, { part: partName(lexicon, outcome.partId) }), speak: true, outcome, records };
        }
      }
      if (records.some((r) => r.status === 'deferred')) {
        return { status: 'deferred', caption: say('deferred'), speak: true, outcome, records, discussedComponentId: outcome.partId };
      }
      return {
        status: 'executed',
        caption: confirmationCaption(outcome, language, model),
        speak: Boolean(input.speakConfirmations),
        outcome,
        records,
        discussedComponentId: outcome.partId,
      };
    }
  }
}

/** Confirmation text for a command outcome (also used when a deferred command later runs). */
export function confirmationCaption(outcome: ParseOutcome, language: string, model: EngineeringModelDefinition): string {
  if (outcome.kind !== 'commands') return '';
  const lexicon = lexiconFor(model);
  const { key, vars } = replyKeyForCommands(outcome.intent, outcome.commands);
  const highlight = outcome.commands.find((c) => c.type === 'component.highlight');
  const list = highlight?.type === 'component.highlight' ? highlight.componentIds.map((id) => partName(lexicon, id)) : undefined;
  return reply(key, language, { model: model.name, part: partName(lexicon, outcome.partId), list, ...vars });
}

/** Capitalise an English spoken phrase for display ("piston" -> "Piston"); native script unchanged. */
function displaySpoken(phrase: string): string {
  const n = normalise(phrase);
  return /^[a-z]/.test(n) ? n.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : n;
}
