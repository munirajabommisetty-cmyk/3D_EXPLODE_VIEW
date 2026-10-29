/**
 * Intent interpretation fallback (voice-first milestone).
 *
 * Only for utterances the deterministic parser did not understand. The backend LLM returns ONE
 * intent from a fixed list (+ optional part id from the loaded model + language). The intent is
 * turned into a canonical English phrase that goes through the SAME parser, reference resolver
 * and validated dispatcher as any spoken command — the LLM never produces actions.
 */

export const INTERPRET_INTENTS = [
  'zoom_in', 'zoom_out', 'rotate_left', 'rotate_right', 'rotate_up', 'rotate_down',
  'pan_left', 'pan_right', 'pan_up', 'pan_down',
  'view_front', 'view_back', 'view_top', 'view_left', 'view_right', 'view_isometric', 'view_bottom', 'reset_view',
  'focus_part', 'select_part', 'isolate_part', 'hide_part', 'show_part', 'show_all', 'explode', 'assemble',
  'play_animation', 'pause_animation',
  'explain_part', 'purpose_part', 'how_part', 'failure_part', 'explain_model', 'related_parts',
  'stop_explanation', 'continue_explanation',
  // voice-conversation milestone
  'example_part', 'general_question', 'small_talk',
  'unclear', 'unsupported',
] as const;
export type InterpretIntent = (typeof INTERPRET_INTENTS)[number];

export interface Interpretation {
  intent: InterpretIntent;
  componentId: string | null;
  language: string | null;
}

export interface InterpretRequestBody {
  transcript: string;
  language: string;
  modelId: string;
  modelName: string;
  components: { id: string; name: string }[];
  topicComponentId: string | null;
  teachingActive: boolean;
}

/** Canonical phrase per intent; {part} = "the <part name>" or "this part". null = nothing to run. */
const PHRASES: Record<InterpretIntent, string | null> = {
  zoom_in: 'zoom in', zoom_out: 'zoom out',
  rotate_left: 'rotate left', rotate_right: 'rotate right', rotate_up: 'rotate up', rotate_down: 'rotate down',
  pan_left: 'move left', pan_right: 'move right', pan_up: 'move up', pan_down: 'move down',
  view_front: 'show the front view', view_back: 'show the back view', view_top: 'show the top view',
  view_left: 'show the left side view', view_right: 'show the right side view', view_isometric: 'isometric view',
  view_bottom: 'show the bottom view', reset_view: 'reset the view',
  focus_part: 'focus on {part}', select_part: 'select {part}', isolate_part: 'isolate {part}', hide_part: 'hide {part}',
  show_part: 'show {part} again', show_all: 'show all', explode: 'explode', assemble: 'assemble',
  play_animation: 'play the animation', pause_animation: 'pause the animation',
  explain_part: 'explain {part}', purpose_part: 'why is {part} needed', how_part: 'how does {part} work',
  failure_part: 'what happens if {part} fails', explain_model: 'explain how this model works',
  related_parts: 'show the parts connected to {part}',
  stop_explanation: 'stop', continue_explanation: 'continue',
  example_part: 'give a real world example of {part}',
  // general_question is answered by the teacher with the learner's own words (no canonical phrase)
  general_question: null, small_talk: 'hello',
  unclear: null, unsupported: null,
};

/** The phrase to run through the deterministic parser, or null for unclear / unsupported. */
export function canonicalPhrase(i: Interpretation, partName: (id: string) => string | null): string | null {
  const template = PHRASES[i.intent];
  if (!template) return null;
  const name = i.componentId ? partName(i.componentId) : null;
  return template.replace('{part}', name ? `the ${name}` : 'this part');
}

export class InterpretError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function requestInterpretation(body: InterpretRequestBody, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Interpretation> {
  let resp: Response;
  try {
    resp = await fetchImpl('/api/interpret', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
    });
  } catch {
    throw new InterpretError(signal?.aborted ? 'CANCELLED' : 'BACKEND_UNAVAILABLE', 'Interpretation unavailable.');
  }
  let data: { intent?: string; componentId?: string | null; language?: string | null; error?: { code?: string } } | null = null;
  try {
    data = await resp.json();
  } catch {
    throw new InterpretError('BACKEND_UNAVAILABLE', 'Interpretation unavailable.');
  }
  if (!resp.ok || !data || !INTERPRET_INTENTS.includes(data.intent as InterpretIntent)) {
    throw new InterpretError(data?.error?.code ?? 'UNKNOWN', 'Interpretation unavailable.');
  }
  return {
    intent: data.intent as InterpretIntent,
    componentId: typeof data.componentId === 'string' ? data.componentId : null,
    language: typeof data.language === 'string' ? data.language : null,
  };
}
