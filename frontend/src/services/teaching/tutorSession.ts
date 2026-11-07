/**
 * Voice tutor learning session: explain → check understanding → two-question quiz → summary.
 *
 * A small state machine, independent of React and of the network (answer checking is injected),
 * so the whole conversation can be tested. The VoiceDock asks it first whenever a learning session
 * is open; anything that is not a reply to the tutor ("pass") is handled as a normal request, so
 * the student can always ask something else, give a scene command, or skip.
 *
 *   idle ──explanation finished──▶ checking ("Does that make sense?…")
 *   checking ──yes──▶ quiz Q1 ──answer──▶ (correct, or 2nd attempt) Q2 ──answer──▶ done (summary)
 *   checking ──no / explain again──▶ clarify (the teacher explains again, then checking again)
 *   checking ──skip──▶ idle        checking ──another question──▶ idle (handled normally)
 *   quiz ──wrong (1st attempt)──▶ same question again, with the misconception explained
 *   quiz ──skip / a new question──▶ idle        quiz ──scene command──▶ handled, quiz stays open
 *
 * One check per topic: after it has been offered, follow-up explanations about the same topic do
 * not start another quiz (except right after the student asked for a clearer explanation).
 */

import type { EngineeringModelDefinition } from '../../types/models';
import { getComponentRelationships } from '../scene/componentRelationships';
import type { QuizItem } from './teachingPlan';

export type TutorStage = 'idle' | 'checking' | 'quiz' | 'evaluating' | 'done';
export type TutorReply = 'yes' | 'clarify' | 'skip' | 'question' | 'answer' | 'unclear';

export interface Evaluation {
  correct: boolean;
  feedback: string;
  misconception: string | null;
  /** 'llm' = judged by the AI teacher; 'keywords' = key-word check (AI checker unavailable). */
  source: 'llm' | 'keywords';
}

export interface EvaluateRequest {
  question: string;
  expectedAnswer: string;
  studentAnswer: string;
  language: string;
  topic: string;
  attempt: 1 | 2;
}

export interface TutorResult {
  question: string;
  correct: boolean;
  misconception: string | null;
}

export interface TutorView {
  stage: TutorStage;
  topic: string;
  language: string;
  questionIndex: number;
  question: string | null;
  attempt: 1 | 2;
  feedback: string | null;
  lastCorrect: boolean | null;
  checkedBy: Evaluation['source'] | null;
  results: TutorResult[];
  summary: string | null;
}

export type TutorAction =
  | { kind: 'pass' }
  | { kind: 'say'; text: string }
  /** `question`: the learner's own words when they say WHAT was unclear, else null (explain it all again). */
  | { kind: 'clarify'; text: string; targetComponentId: string | null; question: string | null }
  | { kind: 'stale' };

export interface ExplainedPlan {
  modelId: string;
  title: string;
  targetComponentId: string | null;
  quiz?: QuizItem[];
}

// ------------------------------------------------------------------ phrases (en / te / hi / bn)

type PhraseKey = 'check' | 'quizStart' | 'question' | 'tryAgain' | 'kwCorrect' | 'kwIncorrect' | 'skip'
  | 'summary' | 'summaryAll' | 'summarySome' | 'clarifyAck' | 'stillChecking' | 'checkUnclear';

const PHRASES: Record<'en-IN' | 'te-IN' | 'hi-IN' | 'bn-IN', Record<PhraseKey, string>> = {
  'en-IN': {
    check: 'Does that make sense? Would you like me to clarify any part? Say yes for a quick two-question check, or ask me anything.',
    quizStart: 'Great, two quick questions.',
    question: 'Question {n} of 2: {q}',
    tryAgain: 'Would you like to try again?',
    kwCorrect: "That's right. The key idea: {answer}",
    kwIncorrect: 'Not quite. The key idea is: {answer}',
    skip: "No problem, we'll skip the quiz. What would you like to explore next?",
    summary: 'Well done. You worked through {topic}. {review} Would you like to explore another component or topic?',
    summaryAll: 'You answered both questions correctly.',
    summarySome: 'Worth another look: {q}',
    clarifyAck: 'Sure, let me explain that more simply.',
    stillChecking: "One moment, I'm still checking your last answer.",
    checkUnclear: "Sorry, I didn't get that. Say yes for two quick questions, explain again, or skip.",
  },
  'te-IN': {
    check: "అర్థమైందా? ఏ భాగమైనా మళ్లీ వివరించమంటారా? రెండు చిన్న ప్రశ్నల quiz కోసం 'అవును' అనండి, లేదా ఏదైనా అడగండి.",
    quizStart: 'బాగుంది, రెండు చిన్న ప్రశ్నలు.',
    question: 'ప్రశ్న {n}/2: {q}',
    tryAgain: 'మళ్లీ ప్రయత్నిస్తారా?',
    kwCorrect: 'సరైనది. ముఖ్యమైన విషయం: {answer}',
    kwIncorrect: 'పూర్తిగా సరైనది కాదు. ముఖ్యమైన విషయం: {answer}',
    skip: 'సరే, quiz వదిలేద్దాం. తరువాత ఏమి చూద్దాం?',
    summary: 'బాగా చేశారు. మీరు {topic} గురించి నేర్చుకున్నారు. {review} ఇంకో భాగం లేదా topic చూద్దామా?',
    summaryAll: 'రెండు ప్రశ్నలకూ సరైన సమాధానం ఇచ్చారు.',
    summarySome: 'ఇది మళ్లీ చూడండి: {q}',
    clarifyAck: 'సరే, ఇంకా సులభంగా వివరిస్తాను.',
    stillChecking: 'ఒక్క క్షణం, మీ సమాధానాన్ని ఇంకా చూస్తున్నాను.',
    checkUnclear: "క్షమించండి, సరిగ్గా అర్థం కాలేదు. రెండు ప్రశ్నల కోసం 'అవును', మళ్లీ వివరించాలంటే 'ఇంకోసారి', వద్దనుకుంటే 'skip' అనండి.",
  },
  'hi-IN': {
    check: "क्या यह समझ में आया? क्या मैं किसी हिस्से को फिर से समझाऊँ? दो छोटे सवालों के quiz के लिए 'हाँ' कहिए, या कुछ भी पूछिए।",
    quizStart: 'बढ़िया, दो छोटे सवाल।',
    question: 'सवाल {n}/2: {q}',
    tryAgain: 'क्या आप फिर से कोशिश करेंगे?',
    kwCorrect: 'सही है। मुख्य बात: {answer}',
    kwIncorrect: 'पूरी तरह सही नहीं। मुख्य बात यह है: {answer}',
    skip: 'ठीक है, quiz छोड़ देते हैं। आगे क्या देखना चाहेंगे?',
    summary: 'बहुत अच्छे। आपने {topic} के बारे में सीखा। {review} क्या कोई और हिस्सा या topic देखें?',
    summaryAll: 'आपने दोनों सवालों के सही जवाब दिए।',
    summarySome: 'इसे फिर से देखिए: {q}',
    clarifyAck: 'चलिए, इसे और आसान तरीके से समझते हैं।',
    stillChecking: 'एक पल, मैं अभी आपका पिछला जवाब देख रहा हूँ।',
    checkUnclear: "माफ़ कीजिए, समझ नहीं पाया। दो सवालों के लिए 'हाँ', फिर से समझाने के लिए 'फिर से', या 'skip' कहिए।",
  },
  'bn-IN': {
    check: "বোঝা গেল? কোনো অংশ আবার বুঝিয়ে বলব? দুটি ছোট প্রশ্নের quiz-এর জন্য 'হ্যাঁ' বলুন, অথবা যেকোনো কিছু জিজ্ঞেস করুন।",
    quizStart: 'দারুণ, দুটি ছোট প্রশ্ন।',
    question: 'প্রশ্ন {n}/2: {q}',
    tryAgain: 'আবার চেষ্টা করবেন?',
    kwCorrect: 'ঠিক বলেছেন। মূল কথা: {answer}',
    kwIncorrect: 'পুরোপুরি ঠিক নয়। মূল কথা হল: {answer}',
    skip: 'ঠিক আছে, quiz বাদ দিই। এরপর কী দেখবেন?',
    summary: 'দারুণ। আপনি {topic} সম্পর্কে শিখলেন। {review} অন্য কোনো অংশ বা topic দেখবেন?',
    summaryAll: 'আপনি দুটো প্রশ্নেরই সঠিক উত্তর দিয়েছেন।',
    summarySome: 'এটা আবার দেখে নিন: {q}',
    clarifyAck: 'ঠিক আছে, আরও সহজ করে বুঝিয়ে বলছি।',
    stillChecking: 'এক মুহূর্ত, আপনার আগের উত্তরটা এখনও দেখছি।',
    checkUnclear: "দুঃখিত, বুঝতে পারিনি। দুটি প্রশ্নের জন্য 'হ্যাঁ', আবার বোঝাতে 'আবার', অথবা 'skip' বলুন।",
  },
};

/** Tutor phrase in the conversation language (English for languages without a table). */
export function tutorPhrase(key: PhraseKey, language: string, vars: Record<string, string | number> = {}): string {
  const table = (PHRASES as Record<string, Record<PhraseKey, string>>)[language] ?? PHRASES['en-IN'];
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), table[key]).replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------------ reply classification

const SKIP = ['skip', 'no quiz', 'not now', 'later', 'no thanks', 'no thank you', 'stop the quiz', 'without quiz', "don't quiz",
  'వద్దు', 'తరువాత', 'తర్వాత', 'quiz వద్దు', 'रहने दो', 'बाद में', 'नहीं चाहिए', 'quiz नहीं', 'বাদ দাও', 'পরে'];
const CLARIFY = ['no', 'not really', 'nope', "don't understand", 'dont understand', "didn't understand", 'didnt understand',
  "didn't get", 'didnt get', "don't get", 'dont get', 'not clear', 'unclear', 'confused', 'confusing', 'lost',
  'explain again', 'explain it again', 'explain that again', 'explain once more', 'once more', 'one more time', 'again',
  'clarify', 'repeat', 'simpler', 'more simply', 'say that again',
  'లేదు', 'అర్థం కాలేదు', 'అర్థంకాలేదు', 'అర్థం అవ్వలేదు', 'మళ్లీ', 'మళ్ళీ', 'ఇంకోసారి', 'ఇంకొకసారి', 'మరోసారి',
  'नहीं', 'नही', 'समझ नहीं', 'समझ में नहीं', 'फिर से', 'दोबारा', 'एक बार और', 'না', 'বুঝিনি', 'বুঝতে পারিনি', 'আবার', 'আরেকবার'];
/** Asking for the quiz itself ("quiz me", "ask me two questions"). */
const QUIZ_WORDS = ['quiz', 'test me', 'ask me', 'questions', 'question me', 'check me',
  'క్విజ్', 'ప్రశ్నలు', 'ప్రశ్న అడగండి', 'सवाल पूछो', 'सवाल पूछिए', 'सवाल', 'প্রশ্ন করো', 'প্রশ্ন'];
const YES = ['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'got it', 'makes sense', 'understood', 'i understand',
  'i understood', 'understand', 'clear', 'ready', 'go ahead', 'start', 'continue', "let's continue", 'lets continue',
  'go on', 'next', 'carry on', 'alright', 'all right', 'fine', 'right',
  'అవును', 'అర్థమైంది', 'అర్థం అయింది', 'సరే', 'హా', 'కొనసాగించు', 'కొనసాగండి', 'ముందుకు',
  'हाँ', 'हां', 'जी', 'समझ गया', 'समझ गई', 'समझ आया', 'समझ आ गया', 'ठीक है', 'आगे बढ़ो', 'चलो',
  'হ্যাঁ', 'বুঝেছি', 'ঠিক আছে', 'চলো'];
/** A new question usually starts like one ("what…", "why…", "ఎందుకు…"). Hindi "क्या" is left out:
 *  it also starts yes/no answers. */
const ASKING = ['what', 'why', 'how', 'when', 'where', 'which', 'who', 'can you', 'could you', 'tell me', 'show',
  'wait', 'actually', 'what is', 'ఏమిటి', 'ఎందుకు', 'ఎలా', 'ఏది', 'ఏం', 'చెప్పు', 'చూపించు', 'क्यों', 'कैसे', 'कौन',
  'बताओ', 'बताइए', 'दिखाओ', 'কী', 'কেন', 'কীভাবে', 'কোন', 'বলো', 'দেখাও'];
/** A whole utterance that is only yes / no / okay (every supported language). Narrow on purpose:
 *  "next", "continue", "start" are commands and are not included. */
const BARE_REPLIES = new Set(['yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'ok', 'okay', 'sure', 'yes please', 'no thanks',
  'అవును', 'కాదు', 'లేదు', 'సరే', 'హా', 'हाँ', 'हां', 'जी', 'जी हाँ', 'नहीं', 'नही', 'ठीक है', 'হ্যাঁ', 'না', 'ঠিক আছে']);

/** True when the learner said only yes / no (nothing else to act on). */
export function isBareReply(text: string): boolean {
  return BARE_REPLIES.has(norm(text));
}

/** Sounds that carry no intent (a hesitation picked up by the microphone). */
const FILLERS = new Set(['hmm', 'hm', 'mm', 'umm', 'um', 'uh', 'uhh', 'er', 'erm', 'ah', 'oh', 'hmm hmm', 'అ', 'ఆ', 'ఊ', 'हम्म', 'अ']);

const norm = (t: string) => t.toLowerCase().replace(/[.,!¡;:"“”‘’()।॥]/g, ' ').replace(/\s+/g, ' ').trim();
const isLatin = (w: string) => /^[a-z' ]+$/.test(w);
/** Whole-word match for Latin phrases, substring match for Indic scripts. */
function has(text: string, words: string[]): boolean {
  return words.some((w) => (isLatin(w) ? new RegExp(`(^|\\s)${w.replace(/'/g, "'?")}($|\\s|\\?)`).test(text) : text.includes(w)));
}
const startsWithAny = (text: string, words: string[]) => words.some((w) => (isLatin(w) ? text === w || text.startsWith(`${w} `) || text.startsWith(`${w}?`) : text.startsWith(w)));
/** "Yes, but why…?" — a question after a short lead-in still counts as a question. */
const asksSomething = (text: string) => startsWithAny(text, ASKING)
  || /(^|\s)(but|and|so|aur|kani|కానీ|लेकिन|কিন্তু)\s+(what|why|how|which|ఎందుకు|ఎలా|क्यों|कैसे|কেন)(\s|$|\?)/.test(text);

export interface ReplyContext {
  /** The words name a different part than the one just explained: a new question, not a reply. */
  newTopic?: boolean;
}

/**
 * What the learner's words mean in the current tutor stage. Deterministic (no AI call): the
 * replies to "Does that make sense?" are short and predictable in every supported language;
 * anything that is not clearly a reply is a new question and is answered normally.
 */
export function classifyTutorReply(text: string, stage: TutorStage, ctx: ReplyContext = {}): TutorReply {
  const t = norm(text);
  if (!t) return 'unclear';
  if (has(t, SKIP)) return 'skip';
  if (stage === 'checking') {
    if (FILLERS.has(t)) return 'unclear';
    if (has(t, CLARIFY)) return 'clarify';
    if (has(t, QUIZ_WORDS)) return 'yes';
    if (ctx.newTopic || asksSomething(t) || t.endsWith('?')) return 'question';
    if (has(t, YES)) return 'yes';
    return t.split(' ').length <= 2 ? 'unclear' : 'question';
  }
  // During the quiz everything is an answer, except a clearly new question ("wait, why…")
  return startsWithAny(t, ASKING) ? 'question' : 'answer';
}

/** Words that only ask for "again" (no content about WHAT was unclear), in every supported language. */
const REQUEST_WORDS = ['i', 'me', 'my', 'it', 'that', 'this', 'please', 'can', 'could', 'you', 'the', 'a', 'to', 'do', 'did',
  'explain', 'tell', 'say', 'again', 'once', 'more', 'part', 'bit', 'little', 'sorry', 'still',
  'నాకు', 'చేయండి', 'చెయ్యండి', 'చెప్పండి', 'చెప్పు', 'కొంచెం', 'దయచేసి', 'मुझे', 'करो', 'कीजिए', 'बताओ', 'समझाओ',
  'समझाइए', 'थोड़ा', 'आया', 'আমাকে', 'বলো', 'বলুন', 'বুঝিয়ে'];

/** The words say WHAT was unclear (more than "explain again" / "I didn't understand"). */
function specificClarification(text: string): boolean {
  let rest = ` ${norm(text)} `;
  for (const phrase of [...CLARIFY].sort((x, y) => y.length - x.length)) rest = rest.split(isLatin(phrase) ? ` ${phrase} ` : phrase).join(' ');
  const content = rest.trim().split(/\s+/).filter((w) => w && !REQUEST_WORDS.includes(w));
  return content.length >= 3;
}

// ------------------------------------------------------------------ fallback quiz & key-word check

const QUIZ_TEMPLATES: Record<string, { job: string; links: string; why: string; modelDoes: string; modelPart: string }> = {
  'en-IN': {
    job: 'In this model, what is the job of the {name}?',
    links: 'Which parts does the {name} work with directly, and why does that matter?',
    why: 'Why does this machine need the {name}?',
    modelDoes: 'In your own words, what does the {model} do?',
    modelPart: 'Name one part of the {model} and what it does.',
  },
  'te-IN': {
    job: 'ఈ model లో {name} పని ఏమిటి?',
    links: '{name} నేరుగా ఏ భాగాలతో పని చేస్తుంది, అది ఎందుకు ముఖ్యం?',
    why: 'ఈ machine కి {name} ఎందుకు అవసరం?',
    modelDoes: 'మీ మాటల్లో, {model} ఏమి చేస్తుంది?',
    modelPart: '{model} లో ఒక భాగం పేరు, దాని పని చెప్పండి.',
  },
  'hi-IN': {
    job: 'इस model में {name} का काम क्या है?',
    links: '{name} सीधे किन हिस्सों के साथ काम करता है, और यह क्यों ज़रूरी है?',
    why: 'इस machine को {name} की ज़रूरत क्यों है?',
    modelDoes: 'अपने शब्दों में, {model} क्या करता है?',
    modelPart: '{model} का एक हिस्सा और उसका काम बताइए।',
  },
  'bn-IN': {
    job: 'এই model-এ {name}-এর কাজ কী?',
    links: '{name} সরাসরি কোন অংশগুলোর সঙ্গে কাজ করে, আর সেটা কেন গুরুত্বপূর্ণ?',
    why: 'এই machine-এর {name} কেন দরকার?',
    modelDoes: 'নিজের ভাষায় বলুন, {model} কী করে?',
    modelPart: '{model}-এর একটি অংশ আর তার কাজ বলুন।',
  },
};

const firstSentence = (t: string) => (t.match(/^[^.!?।]+[.!?।]?/)?.[0] ?? t).trim();

/** Two questions from the model data, used when the teacher's plan has no quiz (e.g. AI unavailable). */
export function buildFallbackQuiz(model: EngineeringModelDefinition, componentId: string | null, language: string): QuizItem[] {
  const tpl = QUIZ_TEMPLATES[language] ?? QUIZ_TEMPLATES['en-IN'];
  const fill = (s: string, v: Record<string, string>) => Object.entries(v).reduce((a, [k, x]) => a.split(`{${k}}`).join(x), s);
  if (componentId) {
    const meta = model.getComponentMetadata(componentId);
    if (!meta) return [];
    const name = meta.name;
    const linked = [...new Set(getComponentRelationships(model, componentId).map((r) => model.getComponentMetadata(r.targetComponentId)?.name ?? r.targetComponentId))];
    const q2: QuizItem = linked.length
      ? { question: fill(tpl.links, { name }), answer: `${name} works with ${linked.join(', ')}; they depend on it: ${meta.role}.` }
      : { question: fill(tpl.why, { name }), answer: `${meta.role}. ${firstSentence(meta.description ?? '')}`.trim() };
    return [{ question: fill(tpl.job, { name }), answer: meta.role || firstSentence(meta.description ?? '') }, q2]
      .map((q) => ({ question: q.question.slice(0, 200), answer: q.answer.slice(0, 300) }));
  }
  const names = model.getAllComponentIds().map((id) => model.getComponentMetadata(id)?.name ?? id);
  return [
    { question: fill(tpl.modelDoes, { model: model.name }), answer: firstSentence(model.description) },
    { question: fill(tpl.modelPart, { model: model.name }), answer: `Any part with its job, e.g. ${names.slice(0, 6).join(', ')}.` },
  ].map((q) => ({ question: q.question.slice(0, 200), answer: q.answer.slice(0, 300) }));
}

const STOP = new Set(['the', 'and', 'that', 'with', 'this', 'from', 'they', 'them', 'into', 'which', 'would', 'there', 'their',
  'because', 'about', 'when', 'what', 'then', 'than', 'have', 'will', 'does', 'also', 'its', 'it', 'for', 'are', 'was', 'is',
  'any', 'part', 'parts', 'job', 'works', 'work', 'depend', 'model']);
const words = (t: string) => (t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => (/^[a-z0-9]+$/.test(w) ? w.length >= 4 : w.length >= 2) && !STOP.has(w));

/** Offline check (AI checker unavailable): does the answer share the key words of the key idea? */
export function keywordEvaluate(req: EvaluateRequest): Evaluation {
  const key = new Set(words(req.expectedAnswer));
  const said = new Set(words(req.studentAnswer));
  const overlap = [...key].filter((w) => said.has(w)).length;
  const correct = key.size > 0 && (overlap >= 2 || overlap / Math.min(key.size, 5) >= 0.4);
  const phrase = tutorPhrase(correct ? 'kwCorrect' : 'kwIncorrect', req.language, { answer: req.expectedAnswer });
  return {
    correct,
    feedback: correct || req.attempt === 2 ? phrase : `${phrase} ${tutorPhrase('tryAgain', req.language)}`,
    misconception: null,
    source: 'keywords',
  };
}

// ------------------------------------------------------------------ the session

export interface TutorDeps {
  /** Judges one answer (the AI checker); rejects when unavailable → key-word check is used. */
  evaluate: (req: EvaluateRequest) => Promise<Omit<Evaluation, 'source'>>;
}

const IDLE_VIEW: TutorView = {
  stage: 'idle', topic: '', language: 'en-IN', questionIndex: 0, question: null, attempt: 1,
  feedback: null, lastCorrect: null, checkedBy: null, results: [], summary: null,
};

export class TutorSession {
  private view: TutorView = { ...IDLE_VIEW };
  private quiz: QuizItem[] = [];
  private target: string | null = null;
  private topicKey = '';
  private readonly offered = new Set<string>();
  private reclarifying = false;
  private generation = 0;
  private readonly listeners = new Set<(v: TutorView) => void>();

  private readonly deps: TutorDeps;

  constructor(deps: TutorDeps) {
    this.deps = deps;
  }

  getView(): TutorView {
    return this.view;
  }

  subscribe(l: (v: TutorView) => void): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  /** The part the open session is about (null = the whole model). */
  get targetComponentId(): string | null {
    return this.target;
  }

  /** True while a reply could be meant for the tutor (understanding check or quiz). */
  isOpen(): boolean {
    return this.view.stage === 'checking' || this.view.stage === 'quiz' || this.view.stage === 'evaluating';
  }

  private set(patch: Partial<TutorView>): void {
    this.view = { ...this.view, ...patch };
    for (const l of this.listeners) l(this.view);
  }

  /** Ends the session (model switch, student leaves). Pending answer checks become stale. */
  reset(): void {
    this.generation += 1;
    this.reclarifying = false;
    this.quiz = [];
    this.set({ ...IDLE_VIEW });
  }

  /**
   * An explanation finished. Returns the understanding-check prompt, or null when this topic was
   * already checked (one check per topic, unless the student just asked for a clearer explanation).
   */
  explanationFinished(plan: ExplainedPlan, fallbackQuiz: QuizItem[], language: string): TutorAction | null {
    const topicKey = `${plan.modelId}:${plan.targetComponentId ?? '*'}`;
    const again = this.reclarifying && topicKey === this.topicKey;
    this.reclarifying = false;
    if (this.offered.has(topicKey) && !again) return null;
    const quiz = plan.quiz && plan.quiz.length === 2 ? plan.quiz : fallbackQuiz;
    if (quiz.length !== 2) return null;
    this.offered.add(topicKey);
    this.generation += 1;
    this.quiz = quiz;
    this.target = plan.targetComponentId;
    this.topicKey = topicKey;
    const text = tutorPhrase('check', language);
    this.set({ ...IDLE_VIEW, stage: 'checking', topic: plan.title.replace(/\s*\(from the model data\)\s*$/, ''), language, feedback: null });
    return { kind: 'say', text };
  }

  /** The student said something while the session is open. */
  async handle(text: string, language: string, opts: { sceneCommand?: boolean; newTopic?: boolean } = {}): Promise<TutorAction> {
    const stage = this.view.stage;
    if (stage === 'checking') {
      const r = opts.sceneCommand ? 'question' : classifyTutorReply(text, 'checking', { newTopic: opts.newTopic });
      if (r === 'yes') {
        const q = this.quiz[0].question;
        this.set({ stage: 'quiz', questionIndex: 0, attempt: 1, question: q, language, feedback: null });
        return { kind: 'say', text: `${tutorPhrase('quizStart', language)} ${tutorPhrase('question', language, { n: 1, q })}` };
      }
      if (r === 'clarify') {
        this.reclarifying = true;
        this.set({ stage: 'idle' });
        return {
          kind: 'clarify', text: tutorPhrase('clarifyAck', language), targetComponentId: this.target,
          question: specificClarification(text) ? text.trim() : null,
        };
      }
      if (r === 'unclear') {
        // Stay in the check: the learner can simply answer again
        return { kind: 'say', text: tutorPhrase('checkUnclear', language) };
      }
      if (r === 'skip') {
        this.set({ stage: 'idle' });
        return { kind: 'say', text: tutorPhrase('skip', language) };
      }
      this.set({ stage: 'idle' }); // another question first: answer it normally, no quiz forced
      return { kind: 'pass' };
    }
    // An answer is being checked: never let the next words slip through as a new request
    if (stage === 'evaluating') return { kind: 'say', text: tutorPhrase('stillChecking', language) };
    if (stage !== 'quiz') return { kind: 'pass' };

    if (opts.sceneCommand) return { kind: 'pass' }; // "zoom in" during the quiz: do it, keep the quiz
    const r = classifyTutorReply(text, 'quiz');
    if (r === 'skip') {
      this.set({ stage: 'idle', question: null });
      return { kind: 'say', text: tutorPhrase('skip', language) };
    }
    if (r === 'question') {
      this.set({ stage: 'idle', question: null });
      return { kind: 'pass' };
    }

    const item = this.quiz[this.view.questionIndex];
    const attempt = this.view.attempt;
    const gen = this.generation;
    const req: EvaluateRequest = { question: item.question, expectedAnswer: item.answer, studentAnswer: text.trim(), language, topic: this.view.topic, attempt };
    this.set({ stage: 'evaluating' });
    let ev: Evaluation;
    try {
      ev = { ...(await this.deps.evaluate(req)), source: 'llm' };
    } catch {
      ev = keywordEvaluate(req);
    }
    if (gen !== this.generation) return { kind: 'stale' };

    const done = ev.correct || attempt === 2;
    if (!done) {
      // Wrong on the first try: explain the misconception, same question again
      this.set({ stage: 'quiz', attempt: 2, feedback: ev.feedback, lastCorrect: false, checkedBy: ev.source });
      return { kind: 'say', text: ev.feedback };
    }
    const results = [...this.view.results, { question: item.question, correct: ev.correct, misconception: ev.misconception }];
    if (this.view.questionIndex === 0) {
      const q = this.quiz[1].question;
      this.set({ stage: 'quiz', questionIndex: 1, attempt: 1, question: q, feedback: ev.feedback, lastCorrect: ev.correct, checkedBy: ev.source, results });
      return { kind: 'say', text: `${ev.feedback} ${tutorPhrase('question', language, { n: 2, q })}` };
    }
    const missed = results.filter((x) => !x.correct);
    const review = missed.length ? tutorPhrase('summarySome', language, { q: missed[0].question }) : tutorPhrase('summaryAll', language);
    const summary = tutorPhrase('summary', language, { topic: this.view.topic, review });
    this.set({ stage: 'done', question: null, feedback: ev.feedback, lastCorrect: ev.correct, checkedBy: ev.source, results, summary });
    return { kind: 'say', text: `${ev.feedback} ${summary}` };
  }

  /** Buttons in the panel (same transitions as speaking the words). */
  async choose(choice: 'yes' | 'clarify' | 'skip', language: string): Promise<TutorAction> {
    const words = { yes: 'yes', clarify: 'explain again', skip: 'skip' }[choice];
    return this.handle(words, language);
  }
}
