/**
 * Voice phrase parser (Task V2) — deterministic, no LLM.
 *
 * Turns a transcript into SceneCommands for the existing V1 dispatcher. Fully supported for
 * English, Telugu and Hindi, including code-mixed speech (English command/part words inside
 * Telugu or Hindi sentences, in either script). Other languages fall back to the English
 * keywords (beta) until their vocabulary is added and tested.
 *
 * The parser only proposes commands; the V1 dispatcher still validates every one of them.
 *
 * Voice-conversation milestone: meaning decides the intent, not the mere presence of a part name.
 *  - Questions ("why", "ఎందుకు", "क्यों", "real-world examples", "tell me more") are never turned
 *    into a selection; a question that names no known part is still a question (kind 'question'
 *    with `open`), answered by the teacher with the learner's own words, not "not understood".
 *  - Greetings, introductions, thanks and goodbyes are small talk (kind 'smallTalk'), answered with
 *    a short reply; a greeting in front of a real request ("hi, zoom in") just runs the request.
 *  - A negated command ("don't zoom in", "జూమ్ చేయొద్దు", "ज़ूम मत करो") is never executed.
 *  - A part name plus other words without any command verb is a question about the part.
 * Parts are matched against the loaded model's lexicon; a part from another model (or a common
 * machine part such as "piston") produces an `unknownPart` outcome instead of a guess.
 */

import type { SceneCommand } from '../commands/sceneCommands';
import { resolveComponentReference, type ReferenceSource, type ResolverScene } from '../scene/referenceResolver';
import type { SceneSnapshot } from '../scene/sceneSnapshot';
import { normalise, type LexiconEntry } from './partLexicon';

export type VoiceIntent =
  | 'zoom' | 'pan' | 'orbit' | 'view' | 'reset'
  | 'select' | 'focus' | 'isolate' | 'hide' | 'show' | 'showAll'
  | 'explode' | 'assemble'
  | 'animPlay' | 'animPause' | 'animSpeed' | 'autoOrbit'
  | 'lessonStart' | 'lessonNext' | 'lessonPrev' | 'lessonExit'
  | 'home'
  // Task V3
  | 'related' | 'clearHighlight' | 'putBack' | 'ask';

/** Questions about a component (Task V3). Only 'identify' is answered (from model metadata);
 *  the others are recognised and resolved for the V4 teacher but not answered yet. */
export type QuestionType = 'identify' | 'explain' | 'howWorks' | 'purpose' | 'failure' | 'example';

/** Small-talk acts recognised without any AI call. */
export type SmallTalkAct = 'greeting' | 'introduction' | 'howAreYou' | 'thanks' | 'goodbye';

export type ParseOutcome =
  | { kind: 'commands'; intent: VoiceIntent; commands: SceneCommand[]; partId?: string; via?: ReferenceSource }
  /** A part is needed but none is named, pointed at, selected or recently discussed: ask the user. */
  | { kind: 'needsSelection'; intent: VoiceIntent }
  | { kind: 'ambiguous'; intent: VoiceIntent; options: string[] }
  | { kind: 'unknownPart'; intent: VoiceIntent; spoken: string; belongsTo?: string }
  /** partId set = about one part; unset = about the whole model (Task V4), e.g. "how does this gearbox work".
   *  mentionedIds = several parts named together ("from the deck to the piers"). */
  | {
    kind: 'question'; question: QuestionType; partId?: string; via?: ReferenceSource; mentionedIds?: string[];
    /** Task V5: "explain it in Telugu" -> the language the user asked for (changes the preference). */
    language?: string;
    /** "explain in English and Telugu": narration in `language`, on-screen text in English. */
    bilingual?: boolean;
    /** A question that names no part of this model ("why do buildings need columns"): the teacher
     *  answers it from the learner's words and connects it to the model. */
    open?: boolean;
    /** A follow-up ("tell me more", "explain it more simply") about the conversation so far. */
    followUp?: boolean;
  }
  /** Greeting / introduction / thanks / goodbye: a short friendly reply, no scene action. */
  | { kind: 'smallTalk'; acts: SmallTalkAct[]; name?: string }
  /** "don't zoom in": understood, deliberately NOT executed. */
  | { kind: 'declined'; intent: VoiceIntent }
  /** Task V5: control of an explanation that is playing ("wait", "continue", "stop"). */
  | { kind: 'teachControl'; action: 'pause' | 'resume' | 'stop' }
  /** Understood, but the loaded model cannot do it (e.g. no relationships recorded for the part). */
  | { kind: 'unavailable'; intent: VoiceIntent; reason: 'noRelationships' | 'nothingToPutBack' | 'noBottomView'; partId?: string }
  | { kind: 'noMatch' };

export interface ForeignPart {
  phrase: string;
  /** Model the part belongs to, if it is a registered model (else undefined = not in any model). */
  modelName?: string;
}

export interface ParseContext {
  lexicon: LexiconEntry[];
  /** Parts of OTHER registered models + common machine parts, for clear "not in this model" replies. */
  foreignParts: ForeignPart[];
  selectedComponentId: string | null;
  lessonActive: boolean;
  /** Live scene snapshot (Task V3): pointing, conversation memory, relationships, isolation... */
  scene?: SceneSnapshot;
  /** Task V5: an explanation is playing or paused, so "wait / continue / stop" control it. */
  teachingActive?: boolean;
}

/** Common machine parts that are not in any current model (English + Telugu + Hindi spellings). */
export const COMMON_FOREIGN_PARTS: string[] = [
  'piston', 'pistons', 'crankshaft', 'crank shaft', 'connecting rod', 'cylinder', 'valve', 'valves',
  'camshaft', 'cam shaft', 'spark plug', 'flywheel', 'fly wheel', 'engine', 'wheel', 'brake', 'clutch',
  'pulley', 'belt', 'propeller', 'turbine', 'nozzle',
  'పిస్టన్', 'క్రాంక్ షాఫ్ట్', 'క్రాంక్‌షాఫ్ట్', 'సిలిండర్', 'వాల్వ్', 'ఇంజన్', 'ఇంజిన్', 'ఫ్లైవీల్', 'కనెక్టింగ్ రాడ్',
  'पिस्टन', 'क्रैंकशाफ्ट', 'क्रैंक शाफ्ट', 'सिलेंडर', 'वाल्व', 'इंजन', 'फ्लाईव्हील', 'कनेक्टिंग रॉड',
].map(normalise);

/* ------------------------------ vocabulary ------------------------------ */
// Latin words match as whole words; Indic words match as prefixes/substrings (they take suffixes).

const W = {
  // Bengali (Stage 2): only words from Prisma-verified transcripts ("জুম ইন করো", "জুম আউট করো", …)
  zoom: ['zoom', 'జూమ్', 'जूम', 'জুম'],
  in: ['in', 'closer', 'nearer', 'ఇన్', 'దగ్గరగా', 'దగ్గరికి', 'इन', 'पास', 'करीब', 'नजदीक'],
  out: ['out', 'farther', 'further', 'away', 'అవుట్', 'దూరంగా', 'దూరం', 'आउट', 'दूर', 'আউট'],
  bigger: ['bigger', 'larger', 'enlarge', 'magnify', 'పెద్దగా', 'పెద్దది', 'बड़ा'],
  smaller: ['smaller', 'shrink', 'చిన్నగా', 'చిన్నది', 'छोटा'],
  move: ['move', 'pan', 'shift', 'slide', 'మూవ్', 'జరుపు', 'జరపండి', 'జరిపి', 'కదుపు', 'కదపండి', 'మూవ్', 'मूव', 'खिसकाओ', 'खिसकाइए', 'सरकाओ', 'हटाओ', 'ले जाओ', 'पैन'],
  rotate: ['rotate', 'turn', 'spin', 'orbit', 'రొటేట్', 'తిప్పు', 'తిప్పండి', 'తిప్పి', 'రొటేట్', 'रोटेट', 'घुमाओ', 'घुमाइए', 'घुमा', 'मोड़ो', 'ঘোরাও'],
  left: ['left', 'లెఫ్ట్', 'ఎడమ', 'लेफ्ट', 'बाएं', 'बायें', 'बाईं', 'बाएँ', 'बाई'],
  right: ['right', 'రైట్', 'కుడి', 'राइट', 'दाएं', 'दायें', 'दाईं', 'दाएँ', 'दाई'],
  up: ['up', 'upward', 'upwards', 'అప్', 'పైకి', 'పైన', 'अप', 'ऊपर'],
  down: ['down', 'downward', 'downwards', 'డౌన్', 'కిందకి', 'కిందికి', 'కింద', 'डाउन', 'नीचे'],
  side: ['side', 'view', 'వైపు', 'సైడ్', 'వ్యూ', 'తరఫు', 'तरफ', 'साइड', 'व्यू', 'ओर'],
  back: ['back', 'behind', 'rear', 'backside', 'బ్యాక్', 'వెనుక', 'వెనక', 'बैक', 'पीछे', 'पिछला हिस्सा'],
  front: ['front', 'ఫ్రంట్', 'ముందు', 'ముందర', 'फ्रंट', 'सामने', 'आगे'],
  top: ['top', 'above', 'overhead', 'టాప్', 'పై నుంచి', 'పైనుంచి', 'పైనుండి', 'टॉप', 'ऊपर से'],
  isometric: ['isometric', '3d view', 'three d', 'ఐసోమెట్రిక్', 'आइसोमेट्रिक'],
  reset: ['reset', 'রিসেট', 'original view', 'default view', 'normal view', 'restore the view', 'restore view', 'home view',
    'రీసెట్', 'మొదటి లాగా', 'మొదటిలాగా', 'అసలు వ్యూ', 'रीसेट', 'पहले जैसा', 'पहले जैसे', 'ओरिजिनल व्यू'],
  select: ['select', 'choose', 'pick', 'highlight', 'సెలెక్ట్', 'ఎంచుకో', 'ఎంచుకోండి', 'ఎంచుకొను', 'सेलेक्ट', 'चुनो', 'चुनिए', 'चुनें', 'हाइलाइट', 'সিলেক্ট'],
  focus: ['focus', 'zoom to', 'zoom into', 'zoom on', 'go to', 'show me', 'ఫోకస్', 'చూపించు', 'చూపించండి', 'చూపు', 'फोकस', 'दिखाओ', 'दिखाइए', 'दिखाएं'],
  isolate: ['isolate', 'separate', 'only', 'alone', 'detach', 'ఐసోలేట్', 'వేరు', 'వేరుగా', 'మాత్రమే', 'విడిగా', 'आइसोलेट', 'अलग', 'सिर्फ', 'केवल', 'अकेला'],
  hide: ['hide', 'remove', 'దాచు', 'దాచండి', 'హైడ్', 'తీసేయి', 'తీసేయండి', 'छुपाओ', 'छिपाओ', 'छुपा', 'हाइड', 'हटा दो'],
  unhide: ['unhide', 'show again', 'bring back', 'మళ్లీ చూపించు', 'అన్‌హైడ్', 'वापस दिखाओ', 'फिर से दिखाओ', 'अनहाइड'],
  all: ['all', 'everything', 'whole', 'entire', 'అన్నీ', 'అన్ని', 'మొత్తం', 'పూర్తి', 'सब', 'सारा', 'सारे', 'पूरा', 'पूरी'],
  show: ['show', 'display', 'చూపించు', 'చూపించండి', 'చూపు', 'दिखाओ', 'दिखाइए'],
  // "অংশগুলো আলাদা করো" = separate the parts (explode). "আলাদা" alone is NOT mapped: for one part it
  // would mean isolate, which is not verified yet.
  explode: ['explode', 'exploded', 'take apart', 'disassemble', 'pull apart', 'open up', 'separate the parts', 'separate all',
    'অংশগুলো আলাদা',
    'ఎక్స్‌ప్లోడ్', 'ఎక్స్ప్లోడ్', 'విడదీయి', 'విడదీయండి', 'విడదీసి', 'విడగొట్టు', 'విప్పు', 'విప్పండి',
    'एक्सप्लोड', 'खोलो', 'खोलिए', 'अलग अलग', 'पुर्जे अलग'],
  assemble: ['assemble', 'reassemble', 'back together', 'together', 'combine', 'restore the assembly', 'restore assembly', 'close it',
    'জুড়ে দাও',
    'అసెంబుల్', 'కలుపు', 'కలపండి', 'కలిపి', 'జోడించు', 'జోడించండి', 'మళ్లీ కలుపు',
    'असेंबल', 'जोड़ो', 'जोड़ दो', 'जोड़िए', 'जोड़ो', 'जोड़', 'वापस जोड़ो', 'मिलाओ'],
  animation: ['animation', 'motion', 'movement', 'gears', 'mechanism', 'యానిమేషన్', 'కదలిక', 'एनिमेशन', 'गति', 'हलचल'],
  pause: ['pause', 'freeze', 'stop', 'halt', 'పాజ్', 'ఆపు', 'ఆపండి', 'ఆపేయ్', 'ఆగు', 'पॉज', 'रोको', 'रोकिए', 'रोक दो', 'बंद करो', 'रुको'],
  play: ['play', 'resume', 'start', 'run', 'animate', 'continue', 'ప్లే', 'నడిపించు', 'మొదలుపెట్టు', 'స్టార్ట్', 'కొనసాగించు', 'प्ले', 'चलाओ', 'चलाइए', 'शुरू', 'स्टार्ट'],
  slower: ['slow', 'slower', 'slowly', 'స్లో', 'నెమ్మదిగా', 'మెల్లగా', 'स्लो', 'धीरे', 'धीमा'],
  faster: ['fast', 'faster', 'quick', 'quicker', 'speed up', 'ఫాస్ట్', 'వేగంగా', 'త్వరగా', 'फास्ट', 'तेज', 'जल्दी'],
  normalSpeed: ['normal speed', 'regular speed', 'నార్మల్ స్పీడ్', 'సాధారణ వేగం', 'नॉर्मल स्पीड', 'सामान्य गति'],
  auto: ['auto rotate', 'auto rotation', 'auto orbit', 'autorotate', 'ఆటో రొటేట్', 'ఆటో', 'ऑटो रोटेट', 'ऑटो'],
  on: ['on', 'enable', 'start', 'ఆన్', 'ఆన్ చేయి', 'ऑन', 'चालू'],
  lesson: ['lesson', 'tour', 'guided', 'tutorial', 'teach me', 'పాఠం', 'లెసన్', 'టూర్', 'పాఠము', 'पाठ', 'लेसन', 'टूर', 'सबक'],
  next: ['next', 'next step', 'continue', 'తర్వాత', 'తరువాత', 'నెక్స్ట్', 'ముందుకు', 'अगला', 'आगे बढ़ो', 'नेक्स्ट'],
  previous: ['previous', 'go back', 'last step', 'back step', 'ముందటి', 'వెనక్కి', 'వెనుకకు', 'ప్రీవియస్', 'पिछला', 'पीछे जाओ', 'प्रीवियस'],
  exit: ['exit', 'end', 'quit', 'close', 'stop', 'ఆపు', 'ముగించు', 'ఎగ్జిట్', 'బయటకు', 'बंद', 'खत्म', 'एग्जिट', 'समाप्त'],
  home: ['go home', 'home page', 'homepage', 'main menu', 'catalogue', 'catalog', 'dashboard', 'హోమ్', 'హోం', 'होम', 'मुख्य पेज'],
  thisRef: ['this', 'that', 'it', 'its', 'selected', 'this part', 'this one', 'that one',
    'ఇది', 'దీన్ని', 'దీనిని', 'దాన్ని', 'ఈ పార్ట్', 'ఇదే', 'ఈ భాగం', 'యిది', 'దీని', 'దాని', 'అది',
    'यह', 'इसे', 'इस', 'ये', 'इसको', 'उसे', 'उस', 'वो', 'वह'],
  // Task V3: related parts, highlight, "put it back", questions
  related: ['connected', 'related', 'attached', 'linked', 'neighbour', 'neighbor', 'neighbours', 'neighbors',
    'meshes with', 'mesh with', 'touching', 'కనెక్ట్', 'అనుసంధాన', 'జతచేయబడిన', 'కలిసి ఉన్న', 'సంబంధిత',
    'जुड़े', 'जुड़ा', 'जुड़ी', 'कनेक्टेड', 'संबंधित', 'लगे हुए'],
  clear: ['clear', 'remove', 'stop', 'turn off', 'off', 'తీసేయి', 'తీసేయండి', 'ఆపు', 'हटाओ', 'हटा दो', 'बंद'],
  highlightWord: ['highlight', 'highlighting', 'highlights', 'glow', 'హైలైట్', 'हाइलाइट'],
  putBack: ['put it back', 'put back', 'put them back', 'undo that', 'వెనక్కి పెట్టు', 'మళ్లీ పెట్టు', 'యథాస్థానంలో',
    'वापस रखो', 'वापस लगाओ', 'वापस करो'],
  together: ['together', 'assemble', 'కలుపు', 'కలిపి', 'जोड़'],
  qFailure: ['stops working', 'stop working', 'stopped working', 'fails', 'failed', 'failure', 'breaks', 'broken',
    // What-if / absence / removal ("what happens if there is no slab", "स्लैब नहीं तो क्या होता है",
    // "స్లాబ్ లేకపోతే ఏమవుతుంది", "what would fail without these columns")
    'if there is no', 'if there are no', 'if there was no', 'if there were no', 'without', 'if we remove', 'if i remove',
    'if you remove', 'if it is removed', 'were removed', 'is removed', 'would fail', 'what would happen',
    'नहीं तो', 'न हो तो', 'ना हो तो', 'नहीं हो तो', 'नहीं होगा तो', 'न रहे तो', 'न होता तो', 'नहीं होता तो',
    'हटा दें तो', 'हटा दे तो', 'हटा दिया जाए', 'हटा दिया तो', 'हटाने पर', 'हटा दें', 'के बिना', 'बिना',
    'లేకపోతే', 'లేకుంటే', 'లేకుండా', 'లేనట్లయితే', 'తీసేస్తే', 'తొలగిస్తే', 'తీసివేస్తే',
    'না থাকলে', 'ছাড়া', 'সরিয়ে দিলে', 'বাদ দিলে',
    'what happens if', 'what if', 'what would happen', 'would happen if', 'were missing', 'is missing', 'without it', 'పనిచేయకపోతే', 'పని చేయకపోతే', 'పాడైతే', 'విరిగితే', 'ఆగిపోతే',
    'खराब हो', 'टूट', 'काम करना बंद', 'बंद हो जाए', 'काम न करे'],
  qHow: ['how does', 'how do', 'how is', 'how it works', 'what happens when', 'what happens at', 'what happens in', 'show me how', 'interacts', 'interact with',
    'ఎలా', 'कैसे', 'কীভাবে', 'কিভাবে'],
  qPurpose: ['why', 'purpose', 'what does', 'what is it for', 'what is the use', 'used for', 'needed', 'what is it used',
    'role', 'job', 'ఎందుకు', 'ఉపయోగం', 'పని ఏమిటి', 'పని ఏంటి', 'ఏం చేస్తుంది', 'ఏమి చేస్తుంది', 'పాత్ర', 'అవసరం',
    'क्यों', 'उपयोग', 'काम क्या', 'किस काम', 'क्या करता', 'क्या करती', 'भूमिका', 'जरूरत',
    // Milestone A: "where is it used (in real life)" -> purpose (answered with the model's own applications)
    'where is it used', 'where are they used', 'real life', 'ఉపయోగిస్తారు', 'వాడతారు', 'వాడుతారు', 'कहाँ इस्तेमाल', 'कहां इस्तेमाल',
    // Bengali question words (Milestone A; not yet checked against Prisma output)
    'কেন', 'দরকার'],
  // Task V5: English verbs as Prisma writes them inside Telugu / Hindi speech ("ఎక్స్ప్లెయిన్ చెయ్యి", "एक्सप्लेन करो")
  qExplain: ['explain', 'tell me about', 'describe', 'বুঝিয়ে বলো', 'వివరించు', 'వివరించండి', 'వివరించగలరా', 'గురించి', 'చెప్పు', 'చెప్పండి',
    // "difference between these gears" (answered from the recorded relationships)
    'difference', 'compare', 'తేడా', 'अंतर', 'फर्क',
    'ఎక్స్ప్లెయిన్', 'ఎక్స్ప్లేన్', 'ఎక్స్ప్లైన్', 'ఎక్స్ప్లెయిన', 'డిస్క్రైబ్',
    'समझाओ', 'समझाइए', 'समझा दो', 'के बारे में', 'बताओ', 'बताइए', 'एक्सप्लेन', 'एक्स्प्लेन', 'डिस्क्राइब'],
  // Task V4: whole-model teaching topics and model nouns ("this gearbox" = the model, not a part)
  teachTopic: ['power flow', 'power flows', 'flow of power', 'power transmission', 'transmits power', 'load path',
    'load transfer', 'load transfers', 'forces travel', 'force travels', 'forces flow', 'how forces', 'how the load',
    'how power', 'శక్తి ఎలా', 'బలం ఎలా', 'లోడ్ ఎలా', 'शक्ति कैसे', 'बल कैसे', 'लोड कैसे', 'पावर कैसे',
    // New modules: whole-system topics (eye, steam engine, reinforced concrete)
    'how we see', 'how do we see', 'see an object', 'how vision works', 'కనిపిస్తుంది', 'कैसे दिखाई',
    'working cycle', 'complete cycle', 'rotational motion', 'rotary motion',
    'steel reinforcement', 'reinforcement bars', 'rebar', 'why reinforce'],
  modelNoun: ['gearbox', 'gear box', 'bridge', 'truss', 'model', 'machine', 'mechanism', 'structure', 'transmission',
    // Anatomy and new modules: "the eye", "the engine", "the building" are the whole model
    'eye', 'eyes', 'కన్ను', 'కంటి', 'आँख', 'চোখ', 'engine', 'steam engine', 'locomotive', 'train', 'building',
    'గేర్‌బాక్స్', 'గేర్ బాక్స్', 'గేర్బాక్స్', 'వంతెన', 'బ్రిడ్జ్', 'మోడల్', 'యంత్రం',
    'गियरबॉक्स', 'गियर बॉक्स', 'पुल', 'ब्रिज', 'मॉडल', 'मशीन', 'ढांचा'],
  // Task V5: single-word Indic demonstratives must match as whole words ("ఈ" is also the start of other words)
  thisWord: ['ఈ', 'ఆ', 'यह', 'ये', 'वह', 'वो', 'এই'],
  bottomView: ['bottom view', 'bottom side', 'from the bottom', 'from below', 'from underneath', 'underside', 'view from under',
    'కింది వైపు', 'కింద నుంచి', 'కింది నుండి', 'అడుగు భాగం', 'नीचे से', 'नीचे का दृश्य', 'नीचे की तरफ से', 'तले का'],
  determiner: ['this', 'that', 'the', 'entire', 'whole', 'overall', 'ఈ', 'ఆ', 'మొత్తం', 'यह', 'इस', 'पूरे', 'पूरा'],
  ctlPause: ['pause', 'wait', 'hold on', 'one minute', 'one second', 'ఆగు', 'ఆగండి', 'ఒక్క నిమిషం', 'ఒక్క క్షణం',
    'रुको', 'रुकिए', 'एक मिनट', 'ठहरो'],
  ctlResume: ['continue', 'resume', 'go on', 'carry on', 'keep going', 'కొనసాగించు', 'కొనసాగించండి', 'కానివ్వు',
    'जारी रखो', 'आगे बढ़ो', 'चालू रखो'],
  ctlStop: ['stop', 'stop explaining', 'cancel', 'enough', 'that is enough', 'ఆపు', 'ఆపండి', 'చాలు', 'బస్',
    'बस', 'बंद करो', 'रोको', 'रहने दो'],
  langTe: ['in telugu', 'తెలుగులో', 'తెలుగు లో', 'तेलुगु में'],
  langHi: ['in hindi', 'హిందీలో', 'హిందీ లో', 'हिंदी में', 'हिन्दी में'],
  langEn: ['in english', 'ఇంగ్లీష్‌లో', 'ఇంగ్లీషులో', 'ఇంగ్లీష్ లో', 'अंग्रेजी में', 'इंग्लिश में'],
  // Both languages requested ("English and Telugu రెండింటిలో")
  langBoth: ['english and telugu', 'telugu and english', 'రెండింటిలో', 'రెండు భాషల్లో', 'both languages',
    'english and hindi', 'hindi and english', 'दोनों भाषाओं'],
  qIdentify: ['what is', "what's", 'whats', 'which part', 'what part', 'identify', 'ఏమిటి', 'ఏంటి', 'ఏ భాగం', 'क्या है', 'कौन सा', 'कौनसा'],
  // Voice-conversation milestone
  qExample: ['example', 'examples', 'real world', 'in real life', 'for instance', 'where do we see', 'where can i see',
    'ఉదాహరణ', 'ఎగ్జాంపుల్', 'ఎక్జాంపుల్', 'రియల్ వరల్డ్', 'उदाहरण', 'मिसाल', 'एग्जांपल', 'रियल लाइफ', 'উদাহরণ'],
  // Follow-ups about the current topic ("it" is implied)
  followUp: ['tell me more', 'more about it', 'more about this', 'more detail', 'in detail', 'more simply', 'simpler',
    'in simple words', 'explain it simply', 'go deeper',
    'ఇంకా చెప్పు', 'ఇంకా చెప్పండి', 'ఇంకా వివర', 'సింపుల్', 'సరళంగా', 'మరింత వివర',
    'और बताओ', 'और बताइए', 'आसान भाषा', 'आसान शब्दों', 'सरल', 'বিস্তারিত', 'আরও বলো', 'সহজ করে'],
  // "here" = in this model ("why is the slab used here", "Why do we use columns ఇక్కడ?")
  greet: ['hi', 'hello', 'hey', 'hii', 'good morning', 'good afternoon', 'good evening', 'namaste', 'namaskar',
    'హాయ్', 'హలో', 'నమస్తే', 'నమస్కారం', 'నమస్కారాలు', 'हाय', 'हेलो', 'हैलो', 'नमस्ते', 'नमस्कार', 'হাই', 'হ্যালো', 'নমস্কার'],
  howAreYou: ['how are you', 'how are you doing', 'how r you', 'how is it going', 'how s it going',
    'ఎలా ఉన్నారు', 'ఎలా ఉన్నావు', 'ఎలా ఉన్నావ్', 'బాగున్నారా', 'బాగున్నావా', 'कैसे हो', 'कैसे हैं', 'कैसी हो', 'কেমন আছ', 'কেমন আছেন'],
  thanks: ['thank you', 'thanks', 'thank u', 'thankyou', 'ధన్యవాదాలు', 'ధన్యవాదం', 'థాంక్స్', 'థాంక్యూ', 'థాంక్ యూ',
    'धन्यवाद', 'शुक्रिया', 'थैंक्स', 'थैंक यू', 'ধন্যবাদ', 'থ্যাংক'],
  goodbye: ['bye', 'goodbye', 'good bye', 'see you', 'బై', 'బాయ్', 'बाय', 'अलविदा', 'বিদায়'],
  // Imperative "do it" verbs: a command, even when the action word itself was misrecognised
  doVerb: ['చేయి', 'చేయండి', 'చెయ్యి', 'చెయ్యండి', 'చేయ్', 'చెయ్', 'करो', 'करें', 'कीजिए', 'करिए', 'कर दो', 'করো', 'করুন'],
  // Negated commands: never executed
  negate: ['don t', 'dont', 'do not', 'never', 'no need to', 'please don t',
    'వద్దు', 'చేయొద్దు', 'చేయకు', 'చెయ్యకు', 'చేయకండి', 'చెయ్యొద్దు', 'मत', 'नहीं करना', 'ना करो', 'করো না', 'কোরো না'],
};

/** Words that carry no request on their own (left over after a part name or a greeting). */
const FILLERS = new Set([
  'the', 'a', 'an', 'please', 'ok', 'okay', 'so', 'now', 'just', 'sir', 'madam', 'and', 'well', 'um', 'uh', 'i', 'am',
  'there', 'here', 'yes', 'yeah', 'hmm', 'buddy', 'friend', 'bro',
  'అండి', 'సార్', 'ఓకే', 'సరే', 'నేను', 'ఇక్కడ', 'ఇప్పుడు', 'జీ', 'जी', 'सर', 'ओके', 'अच्छा', 'मैं', 'यहाँ', 'अब',
  'আমি', 'এখন', 'ঠিক',
].map(normalise));

const INDIC = /[ऀ-෿]/;

function has(text: string, words: readonly string[]): boolean {
  const padded = ` ${text} `;
  return words.some((w) => {
    const n = normalise(w);
    if (!n) return false;
    // Indic words take suffixes (గేర్ని, इसको), so they may END inside a word, but must START at one
    return INDIC.test(n) ? padded.includes(` ${n}`) : padded.includes(` ${n} `);
  });
}

/** Whole-word match (used for very short words that would otherwise match inside others). */
function hasWord(text: string, words: readonly string[]): boolean {
  const tokens = new Set(text.split(' '));
  return words.some((w) => tokens.has(normalise(w)));
}

/** Removes model phrases ("this gearbox", "the entire bridge") so their determiner is not taken
 *  as a reference to a part (Task V5: "what is its role in the entire gearbox" is about a part). */
function withoutModelPhrases(text: string): string {
  let out = ` ${text} `;
  const nouns = W.modelNoun.map(normalise).sort((a, b) => b.length - a.length);
  for (const n of nouns) {
    for (const d of W.determiner.map(normalise)) out = out.split(` ${d} ${n}`).join(' ');
    out = out.split(` ${n}`).join(' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

function containsPhrase(text: string, phrase: string): boolean {
  const padded = ` ${text} `;
  if (!INDIC.test(phrase)) return padded.includes(` ${phrase} `) || padded.includes(` ${phrase}s `); // "planet gears"
  const last = phrase.slice(phrase.lastIndexOf(' ') + 1);
  // A short final token (a letter such as "ఏ" = A) must end at a word boundary: "గేర్ ఏం" is not "gear A"
  return last.length <= 2 ? padded.includes(` ${phrase} `) : padded.includes(` ${phrase}`);
}

/** True when a part phrase is used in the plural ("planet gears", "గేర్లు"): the user means the group. */
function pluralMention(text: string, lexicon: LexiconEntry[], ids: string[]): boolean {
  const padded = ` ${text} `;
  return lexicon.some((e) => ids.includes(e.componentId) && e.phrases.some((p) => (INDIC.test(p)
    ? padded.includes(` ${p}లు`) || padded.includes(` ${p}స్`)
    : !p.endsWith('s') && padded.includes(` ${p}s `))));
}

/** Best-matching parts of the loaded model (longest phrase wins; ties = ambiguity). */
function matchParts(text: string, lexicon: LexiconEntry[]): { ids: string[]; length: number } {
  let best = 0;
  let ids = new Set<string>();
  for (const entry of lexicon) {
    for (const phrase of entry.phrases) {
      if (phrase.length >= best && containsPhrase(text, phrase)) {
        if (phrase.length > best) {
          best = phrase.length;
          ids = new Set();
        }
        ids.add(entry.componentId);
      }
    }
  }
  return { ids: [...ids], length: best };
}

/**
 * Task V4: every part mention in the text, grouped by phrase. "from the deck to the piers" gives
 * two groups (a path); "the planet gear" gives one group of three parts (ambiguous). Phrases inside
 * a longer matched phrase ("gear" in "sun gear") are ignored.
 */
function mentionGroups(text: string, lexicon: LexiconEntry[]): string[][] {
  const byPhrase = new Map<string, Set<string>>();
  for (const entry of lexicon) {
    for (const phrase of entry.phrases) {
      if (containsPhrase(text, phrase)) byPhrase.set(phrase, (byPhrase.get(phrase) ?? new Set()).add(entry.componentId));
    }
  }
  const phrases = [...byPhrase.keys()];
  const kept = phrases.filter((ph) => !phrases.some((o) => o !== ph && o.length > ph.length && o.includes(ph)));
  const groups = new Map<string, string[]>();
  for (const ph of kept) {
    const ids = [...byPhrase.get(ph)!].sort();
    groups.set(ids.join('|'), ids);
  }
  return [...groups.values()];
}

function matchForeign(text: string, foreign: ForeignPart[]): ForeignPart | null {
  let best: ForeignPart | null = null;
  for (const f of foreign) {
    if (containsPhrase(text, f.phrase) && (!best || f.phrase.length > best.phrase.length)) best = f;
  }
  return best;
}

/* ------------------------------ conversation helpers ------------------------------ */

const NAME_PATTERNS: RegExp[] = [
  /(?:^| )my name is ([a-z][a-z]+)/,
  /(?:^| )నా పేరు (\S+)/u,
  /(?:^| )मेरा नाम (\S+)/u,
  /(?:^| )আমার নাম (\S+)/u,
];

/** Removes every phrase of `words` from `text` (same matching rules as has()). */
function strip(text: string, words: readonly string[]): string {
  let out = ` ${text} `;
  for (const w of [...words].map(normalise).filter(Boolean).sort((a, b) => b.length - a.length)) {
    out = INDIC.test(w)
      ? out.replace(new RegExp(` ${escapeRe(w)}\\S*`, 'gu'), ' ')
      : out.split(` ${w} `).join('  ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Words left after removing fillers (and very short particles such as Telugu case endings). */
function meaningfulWords(text: string): string[] {
  return text.split(' ').filter((w) => w && !FILLERS.has(w) && w.length > 2);
}

/** Greeting / introduction / how-are-you / thanks / goodbye, and what is left of the utterance. */
export function detectSmallTalk(text: string): { acts: SmallTalkAct[]; name?: string; rest: string } {
  const acts: SmallTalkAct[] = [];
  let rest = text;
  let name: string | undefined;
  for (const re of NAME_PATTERNS) {
    const m = rest.match(re);
    if (m) {
      name = m[1];
      acts.push('introduction');
      rest = rest.replace(m[0], ' ').replace(/(?:^| )(?:హ|है|অ)(?= |$)/u, ' ');
      break;
    }
  }
  const take = (act: SmallTalkAct, words: readonly string[]) => {
    if (has(rest, words)) {
      acts.push(act);
      rest = strip(rest, words);
    }
  };
  take('howAreYou', W.howAreYou);
  take('greeting', W.greet);
  take('thanks', W.thanks);
  take('goodbye', W.goodbye);
  rest = rest.replace(/\s+/g, ' ').trim();
  return { acts, ...(name ? { name: /^[a-z]/.test(name) ? name[0].toUpperCase() + name.slice(1) : name } : {}), rest };
}

/* ------------------------------ parser ------------------------------ */

const commands = (intent: VoiceIntent, cmds: SceneCommand[], partId?: string): ParseOutcome =>
  ({ kind: 'commands', intent, commands: cmds, partId });

export function parseVoiceCommand(transcript: string, ctx: ParseContext): ParseOutcome {
  const text = normalise(transcript);
  if (!text) return { kind: 'noMatch' };

  // Small talk ("hey hi my name is raja how are you", "thank you"): a friendly reply, no action.
  // A greeting in front of a real request ("hi, zoom in please") runs the request.
  const talk = detectSmallTalk(text);
  if (talk.acts.length) {
    if (meaningfulWords(talk.rest).length === 0) return { kind: 'smallTalk', acts: talk.acts, ...(talk.name ? { name: talk.name } : {}) };
    const inner = parseCore(talk.rest, ctx);
    if (inner.kind !== 'noMatch') return negated(talk.rest, inner);
  }
  return negated(text, parseCore(text, ctx));
}

/** "don't zoom in" / "జూమ్ చేయొద్దు" / "ज़ूम मत करो": a scene command that is negated is never run. */
function negated(text: string, outcome: ParseOutcome): ParseOutcome {
  if (outcome.kind === 'commands' && has(text, W.negate)) return { kind: 'declined', intent: outcome.intent };
  return outcome;
}

function parseCore(text: string, ctx: ParseContext): ParseOutcome {

  // --- Task V5: controlling an explanation that is playing (only then; otherwise these words keep
  // their usual meaning, e.g. "stop" pauses the animation). A part name or question is a new request.
  if (ctx.teachingActive && matchParts(text, ctx.lexicon).ids.length === 0 && !has(text, W.qExplain) &&
      !has(text, W.qHow) && !has(text, W.qPurpose) && !has(text, W.qFailure)) {
    if (has(text, W.ctlResume)) return { kind: 'teachControl', action: 'resume' };
    if (has(text, W.ctlPause)) return { kind: 'teachControl', action: 'pause' };
    if (has(text, W.ctlStop)) return { kind: 'teachControl', action: 'stop' };
  }

  // --- navigation & lessons (no part needed) ---
  if (has(text, W.home)) return commands('home', [{ type: 'workspace.goHome' }]);

  const lessonWord = has(text, W.lesson);
  if (lessonWord && has(text, W.exit) && ctx.lessonActive) return commands('lessonExit', [{ type: 'lesson.exit' }]);
  if (lessonWord) return commands('lessonStart', [{ type: 'lesson.start' }]);
  if (ctx.lessonActive) {
    if (has(text, W.previous)) return commands('lessonPrev', [{ type: 'lesson.previous' }]);
    if (has(text, W.next)) return commands('lessonNext', [{ type: 'lesson.next' }]);
  }

  // --- animation ---
  if (has(text, W.auto)) {
    const off = has(text, W.pause) || has(text, ['off', 'disable', 'ఆఫ్', 'ऑफ']);
    return commands('autoOrbit', [{ type: 'camera.autoOrbit', enabled: !off }]);
  }
  const animWord = has(text, W.animation);
  if (has(text, W.normalSpeed)) return commands('animSpeed', [{ type: 'animation.setSpeed', speed: 1 }]);
  if ((animWord || !has(text, W.zoom)) && has(text, W.slower) && !has(text, W.move)) {
    return commands('animSpeed', [{ type: 'animation.setSpeed', speed: 0.5 }]);
  }
  if ((animWord || !has(text, W.zoom)) && has(text, W.faster) && !has(text, W.move)) {
    return commands('animSpeed', [{ type: 'animation.setSpeed', speed: 2 }]);
  }
  if (animWord && has(text, W.pause)) return commands('animPause', [{ type: 'animation.pause' }]);
  if (animWord && has(text, W.play)) return commands('animPlay', [{ type: 'animation.play' }]);

  // --- "put it back" (Task V3): undo whatever was done, based on the live scene ---
  if (has(text, W.putBack) && !has(text, W.together)) return putBack(ctx);
  if (has(text, W.highlightWord) && has(text, W.clear)) {
    return commands('clearHighlight', [{ type: 'component.clearHighlight' }]);
  }

  // --- whole assembly ---
  if (has(text, W.all) && (has(text, W.show) || has(text, W.unhide))) {
    return commands('showAll', [{ type: 'component.showAll' }]);
  }
  if (has(text, W.assemble)) return commands('assemble', [{ type: 'assembly.restore' }]);

  // --- bottom view: the camera is kept above the ground grid (V1), so say so clearly.
  // Checked before part names: on the bridge "bottom" alone is also the bottom chords' alias.
  if (has(text, W.bottomView) || /(^| )(show|see|view|look at)( me)? the bottom( of the \S+)?$/.test(text)) {
    return { kind: 'unavailable', intent: 'view', reason: 'noBottomView' };
  }

  // --- part-directed commands ---
  const parts = matchParts(text, ctx.lexicon);
  const foreign = matchForeign(text, ctx.foreignParts);
  // "this gearbox" names the model; any other "this / it / ఈ / इसे" refers to a part
  const partText = withoutModelPhrases(text);
  const followUp = has(text, W.followUp);
  const exampleWord = has(text, W.qExample);
  // A follow-up ("tell me more", "explain it more simply") or "give an example" without a part name
  // is about the current topic: "it" is implied
  const implicitTopic = followUp || (exampleWord && matchParts(text, ctx.lexicon).ids.length === 0);
  const refersToThis = has(partText, W.thisRef) || hasWord(partText, W.thisWord) || implicitTopic;
  const foreignWins = Boolean(foreign && foreign.phrase.length > parts.length);
  const teachTopic = has(text, W.teachTopic);
  // "explain" is the broadest request ("Explain this part. Why is it used and how does it work?"),
  // so it wins over how/why; failure questions stay distinct.
  const question: QuestionType | null =
    has(text, W.qFailure) ? 'failure'
      : exampleWord ? 'example'
        : followUp || has(text, W.qExplain) ? 'explain'
          : has(text, W.qHow) || teachTopic ? 'howWorks'
            : has(text, W.qPurpose) ? 'purpose'
              : has(text, W.qIdentify) ? 'identify'
                : null;
  const bilingual = has(text, W.langBoth);
  const language = bilingual
    ? (has(text, ['hindi', 'हिंदी', 'हिन्दी']) ? 'hi-IN' : 'te-IN')
    : has(text, W.langTe) ? 'te-IN' : has(text, W.langHi) ? 'hi-IN' : has(text, W.langEn) ? 'en-IN' : undefined;
  const withLang = <T extends object>(o: T) => (language ? { ...o, language, ...(bilingual ? { bilingual: true } : {}) } : o);
  const resolve = () =>
    resolveComponentReference({ explicitIds: parts.ids, contextual: refersToThis }, resolverScene(ctx));

  // Whole-model questions (Task V4): "how does this gearbox work", "how does power flow",
  // "how do forces travel from the deck to the piers" (several parts = a path, not ambiguity).
  const groups = question ? mentionGroups(text, ctx.lexicon) : [];
  // "how do the planet gears rotate": a plural group name is about that group, not one ambiguous part
  const pluralGroup = groups.length === 1 && groups[0].length > 1 && pluralMention(text, ctx.lexicon, groups[0]);
  const aboutModel = question !== null && question !== 'identify' && !foreignWins &&
    (groups.length > 1 || pluralGroup || (parts.ids.length === 0 && !refersToThis && (has(text, W.modelNoun) || teachTopic)));
  if (aboutModel) {
    return withLang({ kind: 'question', question: question!, ...(groups.length > 1 || pluralGroup ? { mentionedIds: [...new Set(groups.flat())] } : {}) }) as ParseOutcome;
  }

  // A question counts only when it is about a part (named, "this/that/it", or a foreign part);
  // anything else ("what is the weather") falls through and ends as noMatch, as in V2.
  if (question && (parts.ids.length > 0 || refersToThis || foreignWins)) {
    if (foreignWins) return { kind: 'unknownPart', intent: 'ask', spoken: foreign!.phrase, belongsTo: foreign!.modelName };
    const r = resolve();
    if (r.kind === 'ambiguous') return { kind: 'ambiguous', intent: 'ask', options: r.options };
    if (r.kind === 'needsClarification') {
      // "tell me more" with no part in context continues the conversation (the teacher has the history)
      if (implicitTopic && parts.ids.length === 0 && question !== 'identify') {
        return withLang({ kind: 'question', question, open: true, followUp: true }) as ParseOutcome;
      }
      return { kind: 'needsSelection', intent: 'ask' };
    }
    return withLang({ kind: 'question', question, partId: r.componentId, via: r.via, ...(followUp ? { followUp: true } : {}) }) as ParseOutcome;
  }

  // Milestone A: "దీనిని విడదీసి చూపించు" (show it taken apart) explodes the model; it is not "show this part".
  // Explode acts on the whole assembly, so a part reference does not change it.
  if (!question && has(text, W.explode) && !has(text, W.related)) {
    return commands('explode', [{ type: 'assembly.explode', factor: 0.75 }]);
  }

  if (has(text, W.related) && (parts.ids.length > 0 || refersToThis || foreignWins)) {
    if (foreignWins) return { kind: 'unknownPart', intent: 'related', spoken: foreign!.phrase, belongsTo: foreign!.modelName };
    const r = resolve();
    if (r.kind === 'ambiguous') return { kind: 'ambiguous', intent: 'related', options: r.options };
    if (r.kind === 'needsClarification') return { kind: 'needsSelection', intent: 'related' };
    const related = ctx.scene?.components.find((c) => c.id === r.componentId)?.relatedComponentIds ?? [];
    if (related.length === 0) return { kind: 'unavailable', intent: 'related', reason: 'noRelationships', partId: r.componentId };
    return {
      kind: 'commands', intent: 'related', partId: r.componentId, via: r.via,
      commands: [
        { type: 'component.select', componentId: r.componentId },
        { type: 'component.highlight', componentIds: related },
      ],
    };
  }
  const partIntent: VoiceIntent | null =
    has(text, W.unhide) ? 'show'
      : has(text, W.hide) ? 'hide'
        : has(text, W.isolate) && !has(text, W.explode) ? 'isolate'
          // "zoom in on this gear" focuses the part; "zoom out" stays a camera zoom
          : has(text, W.focus) || (has(text, W.zoom) && !has(text, W.out) && (parts.ids.length > 0 || refersToThis)) ? 'focus'
            : has(text, W.select) ? 'select'
              : null;

  if (foreign && foreign.phrase.length > parts.length) {
    return { kind: 'unknownPart', intent: partIntent ?? 'select', spoken: foreign.phrase, belongsTo: foreign.modelName };
  }

  // A part name inside a longer sentence with no command verb ("the slab in a real house, how
  // thick is it usually") is a question about the part, not a request to select it
  if (!partIntent && !question && parts.ids.length > 0 && !has(text, W.zoom) && !has(text, W.rotate) && !has(text, W.move) && !has(text, W.doVerb)) {
    const rest = meaningfulWords(strip(partText, [...ctx.lexicon.filter((e) => parts.ids.includes(e.componentId)).flatMap((e) => e.phrases), ...W.thisRef, ...W.determiner]));
    if (rest.length >= 2) {
      const r = resolve();
      if (r.kind === 'ambiguous') return { kind: 'ambiguous', intent: 'ask', options: r.options };
      if (r.kind === 'resolved') return withLang({ kind: 'question', question: 'explain', partId: r.componentId, via: r.via }) as ParseOutcome;
    }
  }

  if (parts.ids.length > 0 || (partIntent && refersToThis)) {
    if (parts.ids.length > 1 && (partIntent === 'hide' || partIntent === 'show')) {
      return commands(partIntent, [{ type: 'component.visibility', componentIds: parts.ids, visible: partIntent === 'show' }]);
    }
    const intent = partIntent ?? 'select';
    const r = resolve();
    if (r.kind === 'ambiguous') return { kind: 'ambiguous', intent, options: r.options };
    if (r.kind === 'needsClarification') return { kind: 'needsSelection', intent };
    const target = r.componentId;
    const withVia = (o: ParseOutcome): ParseOutcome => (o.kind === 'commands' ? { ...o, via: r.via } : o);

    switch (intent) {
      case 'isolate':
        return withVia(commands(intent, [
          { type: 'component.select', componentId: target },
          { type: 'component.isolate', componentId: target },
          { type: 'component.focus', componentId: target },
        ], target));
      case 'focus':
        return withVia(commands(intent, [
          { type: 'component.select', componentId: target },
          { type: 'component.focus', componentId: target },
        ], target));
      case 'hide':
        return withVia(commands(intent, [{ type: 'component.visibility', componentIds: [target], visible: false }], target));
      case 'show':
        return withVia(commands(intent, [{ type: 'component.visibility', componentIds: [target], visible: true }], target));
      default:
        return withVia(commands('select', [{ type: 'component.select', componentId: target }], target));
    }
  }
  if (partIntent && !refersToThis && (partIntent === 'select' || partIntent === 'isolate' || partIntent === 'hide')) {
    // A part verb with no recognisable part: say so rather than acting on something else
    return { kind: 'unknownPart', intent: partIntent, spoken: '' };
  }

  // Milestone A: a question is never turned into a scene action ("Planet Gears ఎలా rotate అవుతాయి?"
  // asks HOW they rotate; it must not orbit the camera). Voice-conversation milestone: a question
  // that names no known part ("చూడు కాలమ్స్ ఎందుకు యూస్ చేస్తాము", "why do buildings need columns",
  // a misrecognised part name) is still a question: the teacher answers it from the learner's words.
  if (question && question !== 'identify') return withLang({ kind: 'question', question, open: true }) as ParseOutcome;

  // --- camera ---
  const zoomWord = has(text, W.zoom);
  if (zoomWord || has(text, W.bigger) || has(text, W.smaller)) {
    const out = has(text, W.out) || has(text, W.smaller);
    return commands('zoom', [{ type: 'camera.zoom', direction: out ? 'out' : 'in' }]);
  }

  const dir = has(text, W.left) ? 'left' : has(text, W.right) ? 'right' : has(text, W.up) ? 'up' : has(text, W.down) ? 'down' : null;
  if (has(text, W.rotate)) {
    const [yawDeg, pitchDeg] = { left: [30, 0], right: [-30, 0], up: [0, 20], down: [0, -20] }[dir ?? 'right'] as [number, number];
    return commands('orbit', [{ type: 'camera.orbit', yawDeg, pitchDeg }]);
  }
  if (has(text, W.move) && dir) {
    return commands('pan', [{ type: 'camera.pan', direction: dir }]);
  }

  if (has(text, W.reset)) return commands('reset', [{ type: 'camera.reset' }]);
  if (has(text, W.isometric)) return commands('view', [{ type: 'camera.view', view: 'isometric' }]);
  if (has(text, W.back)) return commands('view', [{ type: 'camera.view', view: 'back' }]);
  if (has(text, W.top)) return commands('view', [{ type: 'camera.view', view: 'top' }]);
  if (has(text, W.front)) return commands('view', [{ type: 'camera.view', view: 'front' }]);
  if (dir === 'left' || dir === 'right') {
    // "left side" / "show the right side" -> side view; bare "left"/"right" -> move
    return has(text, W.side)
      ? commands('view', [{ type: 'camera.view', view: dir }])
      : commands('pan', [{ type: 'camera.pan', direction: dir }]);
  }
  if (dir === 'up' || dir === 'down') return commands('pan', [{ type: 'camera.pan', direction: dir }]);

  // --- animation without the word "animation" ---
  if (has(text, W.pause)) return commands('animPause', [{ type: 'animation.pause' }]);
  if (has(text, W.play)) return commands('animPlay', [{ type: 'animation.play' }]);

  return { kind: 'noMatch' };
}

/** Scene facts for the resolver: the live snapshot, or (V2 callers) just the selection. */
function resolverScene(ctx: ParseContext): ResolverScene {
  if (ctx.scene) return ctx.scene;
  return {
    components: [...new Set(ctx.lexicon.map((e) => e.componentId))].map((id) => ({
      id, name: id, role: null, visible: true, relatedComponentIds: [],
    })),
    pointer: { status: 'unavailable', reason: 'No scene snapshot.' },
    selectedComponentId: ctx.selectedComponentId,
    lastDiscussedComponentId: { status: 'unavailable', reason: 'No scene snapshot.' },
  };
}

/** "Put it back": reverses the most specific change visible in the scene. */
function putBack(ctx: ParseContext): ParseOutcome {
  const scene = ctx.scene;
  if (!scene) return commands('assemble', [{ type: 'assembly.restore' }]); // V2 behaviour without a snapshot
  const isolated = scene.isolatedComponentId.status === 'known' ? scene.isolatedComponentId.value : null;
  if (isolated) return commands('putBack', [{ type: 'component.isolate', componentId: null }], isolated);
  if (scene.hiddenComponentIds.length > 0) {
    return commands('putBack', [{ type: 'component.visibility', componentIds: [...scene.hiddenComponentIds], visible: true }]);
  }
  if (scene.exploded.active) return commands('putBack', [{ type: 'assembly.restore' }]);
  const highlighted = scene.highlightedComponentIds.status === 'known' ? scene.highlightedComponentIds.value : [];
  if (highlighted.length > 0) return commands('putBack', [{ type: 'component.clearHighlight' }]);
  return { kind: 'unavailable', intent: 'putBack', reason: 'nothingToPutBack' };
}
