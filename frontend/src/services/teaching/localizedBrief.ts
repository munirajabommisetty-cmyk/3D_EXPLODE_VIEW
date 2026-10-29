/**
 * Model-data explanation in Telugu, Hindi or Bengali (Milestone A).
 *
 * Used instead of the English brief when the AI teacher cannot answer (quota used up, provider or
 * network error, unsafe plan), so a learner who asked in their language is answered in it.
 * Every sentence is built from this model's data:
 *   - the part's name and metadata role label (kept in English, like other technical terms),
 *   - its validated relationships (verbs translated by fixed templates below),
 *   - its nominal speed from the metadata (number and unit copied exactly),
 *   - a curated note from data/teachingNotes.ts (plain-language role, analogy, uses), which only
 *     restates the model data.
 * English engineering notes and descriptions are not translated (that would need a translator);
 * they are left out rather than read in English with a Telugu voice.
 * Structure: direct answer -> how it connects -> numbers -> everyday example -> where it is used ->
 * what is not simulated; short questions get fewer steps.
 */

import type { EngineeringModelDefinition } from '../../types/models';
import { teachingNote } from '../../data/teachingNotes';
import { getComponentRelationships } from '../scene/componentRelationships';
import type { SceneSnapshot } from '../scene/sceneSnapshot';
import { PLAN_LIMITS } from './teachingPlan';

export type BriefLanguage = 'te-IN' | 'hi-IN' | 'bn-IN';
export const LOCALIZED_BRIEF_LANGUAGES: readonly string[] = ['te-IN', 'hi-IN', 'bn-IN'];

type Verb = (list: string) => string;

interface Phrases {
  and: string;
  verbs: Record<string, Verb>;
  otherVerb: Verb;
  sentence: (name: string, clause: string) => string;
  intro: (name: string, role: string) => string;
  modelIntro: (model: string, count: number) => string;
  observe: (name: string) => string;
  speed: (name: string, rpm: string) => string;
  noLinks: (name: string) => string;
  failure: (name: string, linked: string) => string;
  failureNoLinks: string;
  /** What-if answer, first sentence: the job that would no longer be done (role from the model data). */
  whatIf: (name: string, role: string) => string;
  /** Which recorded neighbours would be affected. */
  whatIfLinked: (name: string, linked: string) => string;
  /** Real-world caution (structures) / machine stops working (mechanical). */
  whatIfCaution: { civil: string; mechanical: string };
  notSimAnimated: string;
  notSimStatic: string;
  /** Anatomy models: normal anatomy only, not medical advice. */
  anatomyLimit: string;
  /** Anatomy "what if it is damaged" questions: no medical speculation. */
  anatomySafety: string;
  capAbout: string;
  cap: { links: string; numbers: string; example: string; uses: string; notSim: string; work: string };
  title: (name: string) => string;
  followUps: (name: string) => string[];
  modelFollowUp: string;
  end: string;
}

const PHRASES: Record<BriefLanguage, Phrases> = {
  'te-IN': {
    and: 'మరియు',
    verbs: {
      drives: (l) => `${l} ని తిప్పుతుంది`,
      driven_by: (l) => `${l} ద్వారా తిరుగుతుంది`,
      mates_with: (l) => `${l} తో mesh అవుతుంది`,
      supports: (l) => `${l} కి ఆధారంగా (support) ఉంటుంది`,
      supported_by: (l) => `${l} మీద ఆధారపడి ఉంటుంది`,
      connected_to: (l) => `${l} తో కలిసి ఉంటుంది`,
      fastened_to: (l) => `${l} కి బిగించబడి ఉంటుంది`,
      transfers_force_to: (l) => `${l} కి load ని పంపుతుంది`,
      receives_force_from: (l) => `${l} నుంచి load ని తీసుకుంటుంది`,
    },
    otherVerb: (l) => `${l} తో సంబంధం కలిగి ఉంటుంది`,
    sentence: (n, c) => `${n} ${c}.`,
    intro: (n, r) => `${n} ఈ model లో ఒక భాగం. Model data లో దీని పాత్ర: ${r}.`,
    modelIntro: (m, k) => `${m} లో ${k} భాగాలు ఉన్నాయి.`,
    observe: (n) => `3D model లో ${n} ని గమనించండి.`,
    speed: (n, rpm) => `Model data ప్రకారం ${n} వేగం ${rpm}.`,
    noLinks: (n) => `ఈ model లో ${n} కి ఇతర భాగాలతో connections నమోదు కాలేదు.`,
    failure: (n, l) => `ఇక్కడ failure ని simulate చేయలేము. నమోదైన connections ప్రకారం, ${n} లో సమస్య వస్తే ${l} మీద ప్రభావం పడుతుంది.`,
    failureNoLinks: 'ఇక్కడ failure ని simulate చేయలేము, మరియు ఈ భాగానికి connections నమోదు కాలేదు.',
    whatIf: (n, r) => `${n} లేకపోతే, దాని పని జరగదు. ఈ model లో దాని పని: ${r}.`,
    whatIfLinked: (n, l) => `${n} తో నేరుగా కలిసి పనిచేసే ${l} మీద ప్రభావం పడుతుంది; ఆ పనిని వేరే సరిగ్గా design చేసిన భాగం చేయాల్సి ఉంటుంది.`,
    whatIfCaution: {
      civil: 'నిజమైన building లో engineer పరిశీలన లేకుండా ఏ structural భాగాన్నైనా తీసేయడం ప్రమాదకరం.',
      mechanical: 'నిజమైన యంత్రంలో ఈ భాగం లేకపోతే అది design చేసినట్లు పనిచేయదు.',
    },
    notSimAnimated: 'ఈ animation కదలికను మాత్రమే చూపిస్తుంది. Forces, torque, friction లేదా wear ని ఇది లెక్కించదు.',
    notSimStatic: 'ఈ model నిర్మాణాన్ని మాత్రమే చూపిస్తుంది. Forces లేదా stresses ని ఇది లెక్కించదు.',
    anatomyLimit: 'ఇది నేర్చుకోవడం కోసం సాధారణ మానవ శరీర నిర్మాణాన్ని (anatomy) చూపించే model. ఇది శరీరం ఎలా పనిచేస్తుందో simulate చేయదు, మరియు ఇది వైద్య సలహా కాదు.',
    anatomySafety: 'ఈ app సాధారణ anatomy ని మాత్రమే వివరిస్తుంది. గాయాలు, లక్షణాలు లేదా చికిత్స గురించి ఇది చెప్పదు; ఆరోగ్య సందేహాలకు దయచేసి డాక్టర్ ని సంప్రదించండి.',
    capAbout: 'ఈ model గురించి',
    cap: { links: 'ఇతర భాగాలతో సంబంధం', numbers: 'Model data', example: 'ఉదాహరణ', uses: 'ఎక్కడ ఉపయోగిస్తారు', notSim: 'ఈ app లో simulate కానివి', work: 'భాగాలు కలిసి ఎలా పని చేస్తాయి' },
    title: (n) => `${n} (model data నుంచి)`,
    followUps: (n) => [`${n} ఎలా పని చేస్తుంది?`, `${n} కి కనెక్ట్ అయిన భాగాలు చూపించు`],
    modelFollowUp: 'ఏదైనా భాగాన్ని select చేసి, దాన్ని వివరించమని అడగండి.',
    end: '.',
  },
  'hi-IN': {
    and: 'और',
    verbs: {
      drives: (l) => `${l} को घुमाता है`,
      driven_by: (l) => `${l} से घूमता है`,
      mates_with: (l) => `${l} के साथ mesh होता है`,
      supports: (l) => `${l} को सहारा (support) देता है`,
      supported_by: (l) => `${l} पर टिका होता है`,
      connected_to: (l) => `${l} से जुड़ा है`,
      fastened_to: (l) => `${l} से कसा हुआ है`,
      transfers_force_to: (l) => `${l} तक load पहुँचाता है`,
      receives_force_from: (l) => `${l} से load लेता है`,
    },
    otherVerb: (l) => `${l} से संबंधित है`,
    sentence: (n, c) => `${n} ${c}।`,
    intro: (n, r) => `${n} इस model का एक हिस्सा है। Model data में इसकी भूमिका: ${r}।`,
    modelIntro: (m, k) => `${m} में ${k} हिस्से हैं।`,
    observe: (n) => `3D model में ${n} को देखिए।`,
    speed: (n, rpm) => `Model data के अनुसार ${n} की गति ${rpm} है।`,
    noLinks: (n) => `इस model में ${n} के किसी दूसरे हिस्से से connections दर्ज नहीं हैं।`,
    failure: (n, l) => `यहाँ failure को simulate नहीं किया जा सकता। दर्ज connections के अनुसार, ${n} में खराबी आने पर ${l} पर असर पड़ेगा।`,
    failureNoLinks: 'यहाँ failure को simulate नहीं किया जा सकता, और इस हिस्से के connections दर्ज नहीं हैं।',
    whatIf: (n, r) => `अगर ${n} न हो, तो उसका काम नहीं होगा। इस model में उसका काम है: ${r}।`,
    whatIfLinked: (n, l) => `${n} से सीधे जुड़े ${l} पर असर पड़ेगा; यह काम किसी दूसरे, ठीक से design किए गए हिस्से को करना पड़ेगा।`,
    whatIfCaution: {
      civil: 'असली building में किसी structural हिस्से को engineer की जाँच के बिना हटाना खतरनाक हो सकता है।',
      mechanical: 'असली मशीन में इस हिस्से के बिना वह design के अनुसार काम नहीं करेगी।',
    },
    notSimAnimated: 'यह animation केवल गति दिखाता है। यह forces, torque, friction या wear की गणना नहीं करता।',
    notSimStatic: 'यह model केवल संरचना दिखाता है। यह forces या stresses की गणना नहीं करता।',
    anatomyLimit: 'यह सीखने के लिए सामान्य मानव शरीर-रचना (anatomy) का model है। यह शरीर के काम को simulate नहीं करता, और यह चिकित्सा सलाह नहीं है।',
    anatomySafety: 'यह app केवल सामान्य anatomy समझाता है। चोट, लक्षण या इलाज के बारे में यह नहीं बता सकता; स्वास्थ्य से जुड़े सवालों के लिए कृपया डॉक्टर से पूछिए।',
    capAbout: 'इस model के बारे में',
    cap: { links: 'दूसरे हिस्सों से संबंध', numbers: 'Model data', example: 'उदाहरण', uses: 'कहाँ इस्तेमाल होता है', notSim: 'इस app में simulate नहीं', work: 'हिस्से मिलकर कैसे काम करते हैं' },
    title: (n) => `${n} (model data से)`,
    followUps: (n) => [`${n} कैसे काम करता है?`, `${n} से जुड़े हिस्से दिखाओ`],
    modelFollowUp: 'कोई हिस्सा select करके उसे समझाने को कहिए।',
    end: '।',
  },
  'bn-IN': {
    and: 'ও',
    verbs: {
      drives: (l) => `${l}-কে ঘোরায়`,
      driven_by: (l) => `${l}-এর মাধ্যমে ঘোরে`,
      mates_with: (l) => `${l}-এর সঙ্গে mesh করে`,
      supports: (l) => `${l}-কে ধরে রাখে (support)`,
      supported_by: (l) => `${l}-এর উপর ভর দিয়ে থাকে`,
      connected_to: (l) => `${l}-এর সঙ্গে যুক্ত`,
      fastened_to: (l) => `${l}-এর সঙ্গে আটকানো`,
      transfers_force_to: (l) => `${l}-এ load পাঠায়`,
      receives_force_from: (l) => `${l} থেকে load পায়`,
    },
    otherVerb: (l) => `${l}-এর সঙ্গে সম্পর্কিত`,
    sentence: (n, c) => `${n} ${c}।`,
    intro: (n, r) => `${n} এই model-এর একটি অংশ। Model data অনুযায়ী এর ভূমিকা: ${r}।`,
    modelIntro: (m, k) => `${m}-এ ${k}টি অংশ আছে।`,
    observe: (n) => `3D model-এ ${n} লক্ষ করুন।`,
    speed: (n, rpm) => `Model data অনুযায়ী ${n}-এর গতি ${rpm}।`,
    noLinks: (n) => `এই model-এ ${n}-এর অন্য অংশের সঙ্গে কোনো connection রেকর্ড করা নেই।`,
    failure: (n, l) => `এখানে failure simulate করা যায় না। রেকর্ড করা connections অনুযায়ী, ${n}-এ সমস্যা হলে ${l}-এর উপর প্রভাব পড়বে।`,
    failureNoLinks: 'এখানে failure simulate করা যায় না, আর এই অংশের কোনো connection রেকর্ড করা নেই।',
    whatIf: (n, r) => `${n} না থাকলে তার কাজটা হবে না। এই model-এ তার কাজ: ${r}।`,
    whatIfLinked: (n, l) => `${n}-এর সঙ্গে সরাসরি যুক্ত ${l}-এর উপর প্রভাব পড়বে; সেই কাজ অন্য কোনো ঠিকভাবে design করা অংশকে করতে হবে।`,
    whatIfCaution: {
      civil: 'আসল building-এ engineer-এর পরীক্ষা ছাড়া কোনো structural অংশ সরানো বিপজ্জনক হতে পারে।',
      mechanical: 'আসল যন্ত্রে এই অংশ ছাড়া সেটা design অনুযায়ী কাজ করবে না।',
    },
    notSimAnimated: 'এই animation শুধু গতি দেখায়। এটি forces, torque, friction বা wear হিসাব করে না।',
    notSimStatic: 'এই model শুধু কাঠামো দেখায়। এটি forces বা stresses হিসাব করে না।',
    anatomyLimit: 'এটি শেখার জন্য স্বাভাবিক মানবদেহের গঠন (anatomy) দেখানো একটি model। এটি শরীরের কাজ simulate করে না, আর এটি চিকিৎসা পরামর্শ নয়।',
    anatomySafety: 'এই app শুধু স্বাভাবিক anatomy ব্যাখ্যা করে। আঘাত, উপসর্গ বা চিকিৎসা নিয়ে এটি বলতে পারে না; স্বাস্থ্য নিয়ে প্রশ্ন থাকলে দয়া করে ডাক্তারকে জিজ্ঞেস করুন।',
    capAbout: 'এই model সম্পর্কে',
    cap: { links: 'অন্য অংশের সঙ্গে সম্পর্ক', numbers: 'Model data', example: 'উদাহরণ', uses: 'কোথায় ব্যবহার হয়', notSim: 'এই app-এ simulate হয় না', work: 'অংশগুলো একসঙ্গে কীভাবে কাজ করে' },
    title: (n) => `${n} (model data থেকে)`,
    followUps: (n) => [`${n} কীভাবে কাজ করে?`],
    modelFollowUp: 'কোনো অংশ select করে সেটা বুঝিয়ে বলতে বলুন।',
    end: '।',
  },
};

/** English captions for bilingual answers ("explain in English and Telugu"). */
const EN_CAP = {
  links: (n: string) => `How the ${n} connects`, numbers: 'From the model data', example: 'An everyday comparison',
  uses: 'Where it is used', notSim: 'What this app does not simulate', work: 'How the parts work together',
};

/** Joins names as "A", "A మరియు B", "A, B మరియు C". */
function joinNames(names: string[], and: string): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`;
}

/** Keeps whole sentences (., ?, ! or the danda ।) within a limit. */
export function fitSentences(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const sentences = t.match(/[^.!?।]+[.!?।]+/g) ?? [t];
  let out = '';
  for (const s of sentences) {
    if ((out + s).trim().length > max) break;
    out += s;
  }
  return out.trim() || t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

/** "1,200 RPM (Input)" -> "1,200 RPM": the number and unit exactly as recorded, without the English note. */
export function recordedSpeed(nominalRpm: string | undefined): string | null {
  const m = nominalRpm?.match(/^\s*([\d.,]+\s*RPM)/i);
  return m ? m[1] : null;
}

const hexId = () => Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

interface StepIn { kind?: string; claim: string; caption: string; narration: string; actions?: unknown[]; target?: string | null }

/**
 * Grounded plan in `language` for one component (or the whole model when componentId is null).
 * With `bilingual`, captions, title and summary are English while the spoken narration stays in
 * `language` (each voice speaks only its own language).
 */
export function buildLocalizedBrief(
  model: EngineeringModelDefinition,
  snapshot: SceneSnapshot,
  componentId: string | null,
  questionType: string,
  language: BriefLanguage,
  opts: { bilingual?: boolean } = {}
): Record<string, unknown> {
  const p = PHRASES[language];
  const can = (a: string) => snapshot.availableActions.includes(a as never);
  const nameOf = (id: string) => model.getComponentMetadata(id)?.name ?? id;
  const animated = (model.animations ?? []).length > 0;
  const modelNote = teachingNote(model.id, null, language);
  const steps: Record<string, unknown>[] = [];
  const push = (s: StepIn, enCaption: string) => steps.push({
    index: steps.length,
    kind: s.kind ?? 'explain',
    claim: s.claim,
    caption: fitSentences(opts.bilingual ? enCaption : s.caption, PLAN_LIMITS.caption),
    narration: fitSentences(s.narration, PLAN_LIMITS.narration),
    targetComponentId: s.target ?? null,
    actions: s.actions ?? [],
    waitFor: 'narration',
    holdMs: 0,
  });
  const anatomy = model.domain === 'medical';
  const notSimulated = () => push(anatomy
    ? { claim: 'notSimulated', target: componentId, caption: p.capAbout, narration: p.anatomyLimit }
    : { claim: 'notSimulated', target: componentId, caption: p.cap.notSim, narration: animated ? p.notSimAnimated : p.notSimStatic },
  anatomy ? 'About this model' : EN_CAP.notSim);

  if (componentId) {
    const meta = model.getComponentMetadata(componentId) as (ReturnType<EngineeringModelDefinition['getComponentMetadata']> & { nominalRpm?: string }) | null;
    const name = meta?.name ?? componentId;
    const note = teachingNote(model.id, componentId, language);
    const brief = questionType === 'purpose';

    // What-if / absence questions: the consequence first (grounded in the recorded role and
    // relationships), a real-world caution, and what is not simulated. No definition-only answer.
    if (questionType === 'failure' && !anatomy) {
      const rels = getComponentRelationships(model, componentId);
      const linkedIds = [...new Set(rels.map((r) => r.targetComponentId))];
      const linkedNames = joinNames(linkedIds.map(nameOf), p.and);
      push({
        kind: 'demonstrate', claim: 'engineering', target: componentId, caption: name,
        narration: p.whatIf(name, meta?.role ?? '—'),
        actions: can('component.focus') ? [{ type: 'component.focus', componentId }] : [],
      }, name);
      if (linkedIds.length) {
        push({
          kind: 'demonstrate', claim: 'engineering', target: componentId, caption: p.cap.links, narration: p.whatIfLinked(name, linkedNames),
          actions: can('component.highlight') ? [{ type: 'component.highlight', componentIds: linkedIds.slice(0, PLAN_LIMITS.highlight) }] : [],
        }, EN_CAP.links(name));
      }
      push({
        claim: 'notSimulated', target: componentId, caption: p.cap.notSim,
        narration: `${model.domain === 'civil' ? p.whatIfCaution.civil : p.whatIfCaution.mechanical} ${linkedIds.length ? p.failure(name, linkedNames) : p.failureNoLinks}`,
      }, EN_CAP.notSim);
      return {
        schemaVersion: 1, planId: hexId(), modelId: model.id, targetComponentId: componentId,
        title: opts.bilingual ? `Without the ${name} (from the model data)` : p.title(name),
        explanation: fitSentences(opts.bilingual ? `Without the ${name}: ${meta?.role ?? ''}` : p.whatIf(name, meta?.role ?? '—'), PLAN_LIMITS.explanation),
        cannotAnswer: null, steps, rejectedSteps: [],
        followUpSuggestions: p.followUps(name),
        language, source: 'modelData',
      };
    }

    // 1. Direct answer: what it is and does, then where to look
    push({
      kind: 'demonstrate', claim: 'metadata', target: componentId, caption: name,
      narration: `${note?.simple ?? p.intro(name, meta?.role ?? '—')} ${p.observe(name)}`,
      actions: can('component.focus') ? [{ type: 'component.focus', componentId }] : [],
    }, name);

    // 2. How it works with nearby parts (from the validated relationships)
    const rels = getComponentRelationships(model, componentId);
    const linked = [...new Set(rels.map((r) => nameOf(r.targetComponentId)))];
    if (!brief || !note?.simple) {
      if (rels.length > 0) {
        const byType = new Map<string, string[]>();
        for (const r of rels) {
          const names = byType.get(r.relationshipType) ?? [];
          if (!names.includes(nameOf(r.targetComponentId))) names.push(nameOf(r.targetComponentId));
          byType.set(r.relationshipType, names);
        }
        const sentences = [...byType.entries()].map(([type, names]) => p.sentence(name, (p.verbs[type] ?? p.otherVerb)(joinNames(names, p.and))));
        const related = [...new Set(rels.map((r) => r.targetComponentId))];
        push({
          kind: 'demonstrate', claim: 'metadata', target: componentId, caption: p.cap.links, narration: sentences.join(' '),
          actions: can('component.highlight') ? [{ type: 'component.highlight', componentIds: related.slice(0, PLAN_LIMITS.highlight) }] : [],
        }, EN_CAP.links(name));
      } else {
        push({ claim: 'metadata', target: componentId, caption: p.cap.links, narration: p.noLinks(name) }, EN_CAP.links(name));
      }
    }

    // 3. Numbers exactly as recorded (only for deeper questions)
    const rpm = recordedSpeed(meta?.nominalRpm);
    if (rpm && !brief && questionType !== 'failure') {
      push({ claim: 'metadata', target: componentId, caption: p.cap.numbers, narration: p.speed(name, rpm) }, EN_CAP.numbers);
    }

    // 4. An everyday example (curated, says where it differs)
    if (note?.analogy && questionType !== 'failure') {
      push({ claim: 'engineering', target: componentId, caption: p.cap.example, narration: note.analogy }, EN_CAP.example);
    }

    // 5. Where it is used (purpose questions; from the model description)
    const uses = note?.uses ?? modelNote?.uses;
    if (uses && brief) push({ claim: 'metadata', target: componentId, caption: p.cap.uses, narration: uses }, EN_CAP.uses);

    // 6. Limits: failure reasoning or what is not simulated
    if (questionType === 'failure' && anatomy) {
      push({ claim: 'notSimulated', target: componentId, caption: p.capAbout, narration: p.anatomySafety }, 'About this model');
    } else if (questionType === 'failure') {
      push({
        claim: 'notSimulated', target: componentId, caption: p.cap.notSim,
        narration: linked.length ? p.failure(name, joinNames(linked, p.and)) : p.failureNoLinks,
      }, EN_CAP.notSim);
    } else {
      notSimulated();
    }

    return {
      schemaVersion: 1, planId: hexId(), modelId: model.id, targetComponentId: componentId,
      title: opts.bilingual ? `${name} (from the model data)` : p.title(name),
      explanation: fitSentences(opts.bilingual
        ? `${name}: ${meta?.role ?? ''}. ${meta?.description ?? ''}`
        : note?.simple ?? p.intro(name, meta?.role ?? '—'), PLAN_LIMITS.explanation),
      cannotAnswer: null, steps, rejectedSteps: [],
      followUpSuggestions: p.followUps(name),
      language, source: 'modelData',
    };
  }

  // Whole model
  const ids = model.getAllComponentIds();
  push({ claim: 'metadata', caption: model.name, narration: modelNote?.simple ?? p.modelIntro(model.name, ids.length) }, model.name);
  const facts: string[] = [];
  for (const id of ids) {
    const byType = new Map<string, string[]>();
    for (const r of getComponentRelationships(model, id)) {
      if (!['drives', 'supports', 'transfers_force_to'].includes(r.relationshipType)) continue;
      const names = byType.get(r.relationshipType) ?? [];
      if (!names.includes(nameOf(r.targetComponentId))) names.push(nameOf(r.targetComponentId));
      byType.set(r.relationshipType, names);
    }
    for (const [type, names] of byType) facts.push(p.sentence(nameOf(id), p.verbs[type](joinNames(names, p.and))));
  }
  if (facts.length > 0) {
    push({ claim: 'metadata', caption: p.cap.work, narration: facts.slice(0, 4).join(' ') }, EN_CAP.work);
  }
  if (modelNote?.analogy) push({ claim: 'engineering', caption: p.cap.example, narration: modelNote.analogy }, EN_CAP.example);
  if (modelNote?.uses && questionType === 'purpose') push({ claim: 'metadata', caption: p.cap.uses, narration: modelNote.uses }, EN_CAP.uses);
  notSimulated();
  return {
    schemaVersion: 1, planId: hexId(), modelId: model.id, targetComponentId: null,
    title: opts.bilingual ? `${model.name} (from the model data)` : p.title(model.name),
    explanation: fitSentences(opts.bilingual ? model.description : modelNote?.simple ?? p.modelIntro(model.name, ids.length), PLAN_LIMITS.explanation),
    cannotAnswer: null, steps, rejectedSteps: [],
    followUpSuggestions: [p.modelFollowUp],
    language, source: 'modelData',
  };
}
