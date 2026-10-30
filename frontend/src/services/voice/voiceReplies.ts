/**
 * Short voice replies and captions (Task V2) for English, Telugu and Hindi; Bengali added in Stage 3.
 * Technical part names stay in English inside Telugu/Hindi sentences (as engineering is taught).
 * Beta languages use the English replies until localised replies are written and tested.
 *
 * These are command confirmations only. The AI teaching explanations are a later phase (V4):
 * questions are recognised and the part is identified from model metadata, nothing more.
 */

import type { RejectionCode } from '../commands/sceneCommands';
import type { VoiceIntent } from './phraseParser';

export type ReplyLanguage = 'en-IN' | 'te-IN' | 'hi-IN' | 'bn-IN';
/** Languages with a complete reply table (Bengali: Stage 3). Others reply in English. */
export const FULLY_SUPPORTED_LANGUAGES: readonly ReplyLanguage[] = ['en-IN', 'te-IN', 'hi-IN', 'bn-IN'];

type ReplyKey =
  | VoiceIntent | 'zoomIn' | 'zoomOut' | 'autoOrbitOff'
  | 'deferred' | 'expired' | 'needsSelection' | 'ambiguous' | 'unknownPart' | 'unknownPartOtherModel'
  | 'unknownPartGeneric' | 'noMatch' | 'cannot'
  | 'identify' | 'notTaughtYet' | 'questionNoPart' | 'noRelationships' | 'nothingToPutBack'
  | 'teachPreparing' | 'teachPreparingModel'
  | 'emptyTranscript' | 'noBottomView' | 'unsupportedRequest' | 'interpreting' | 'teachPaused' | 'teachResumed' | 'teachStopped' | 'teachFallback' | 'languageUnclear'
  | 'UNSUPPORTED_ANIMATION' | 'UNSUPPORTED_EXPLODED_VIEW' | 'LESSON_NOT_ACTIVE' | 'NO_LESSON'
  | 'VIEWER_NOT_READY' | 'UNKNOWN_COMPONENT' | 'INVALID_ARGUMENT'
  // Voice-conversation milestone: small talk, declined (negated) commands, open questions, service errors
  | 'chatHello' | 'chatHelloName' | 'chatWell' | 'chatThanks' | 'chatBye' | 'chatOffer'
  | 'declined' | 'teachThinking' | 'serviceBusy' | 'serviceSlow';

type Phrases = Record<ReplyKey, string>;

const EN: Phrases = {
  zoom: 'Zooming.', zoomIn: 'Zooming in.', zoomOut: 'Zooming out.',
  pan: 'Moving the view {dir}.', orbit: 'Rotating {dir}.', view: 'Showing the {view} view.', reset: 'Back to the original view.',
  select: 'Selected {part}.', focus: 'Showing {part}.', isolate: 'Showing only {part}.',
  hide: 'Hid {part}.', show: 'Showing {part} again.', showAll: 'Showing all parts.',
  explode: 'Separating the assembly.', assemble: 'Putting the assembly back together.',
  animPlay: 'Animation playing.', animPause: 'Animation paused.', animSpeed: 'Animation speed {speed}×.',
  autoOrbit: 'Auto-rotation on.', autoOrbitOff: 'Auto-rotation off.',
  lessonStart: 'Starting the guided lesson.', lessonNext: 'Next step.', lessonPrev: 'Previous step.', lessonExit: 'Lesson closed.',
  home: 'Going to the home page.',
  deferred: 'Your hand or mouse is moving the view. I will do it when you stop.',
  expired: 'Your hand kept moving, so I skipped that.',
  needsSelection: 'Which part do you mean? Point at it, select it, or say its name.',
  related: 'Highlighting the parts connected to {part}: {list}.',
  clearHighlight: 'Highlight cleared.',
  putBack: 'Put back as it was.',
  ask: 'Found {part}.',
  identify: 'That is the {part}: {role}.',
  notTaughtYet: 'That is the {part}. Explaining it is not available yet.',
  questionNoPart: 'Explanations are not available yet.',
  teachPreparing: 'Preparing an explanation of {part}…',
  emptyTranscript: "I didn't catch that. Could you say it again?",
  noBottomView: 'The camera stays above the ground grid, so there is no bottom view. Try the top or front view.',
  interpreting: 'Let me make sure I understood…',
  unsupportedRequest: "I can't do that in this viewer. You can ask me to explain a part, or to zoom, turn or show a view.",
  teachPaused: 'Paused. Say “continue” when you are ready.',
  teachResumed: 'Continuing.',
  teachStopped: 'Stopped the explanation.',
  teachFallback: 'The AI teacher is not available right now, so here is what the model data says.',
  // Milestone A: auto-detect found the recording understandable in two languages
  languageUnclear: 'I could not tell which language that was. Please say it again, or pick your language in the menu.',
  teachPreparingModel: 'Preparing an explanation of the {model}…',
  noRelationships: 'No connections are recorded for {part} in this model.',
  nothingToPutBack: 'Nothing is separated, hidden or highlighted right now.',
  ambiguous: 'Which one do you mean: {options}?',
  unknownPart: '{part} is not part of the {model}.',
  unknownPartOtherModel: '{part} belongs to the {other}, not the {model}.',
  unknownPartGeneric: 'I could not find that part in the {model}.',
  noMatch: "Sorry, I didn't understand. Try “zoom in” or “select the sun gear”.",
  cannot: "Sorry, I can't do that here.",
  UNSUPPORTED_ANIMATION: 'The {model} has no animation to play.',
  UNSUPPORTED_EXPLODED_VIEW: 'The {model} has no exploded view.',
  LESSON_NOT_ACTIVE: 'No lesson is running. Say “start lesson” first.',
  NO_LESSON: 'There is no guided lesson for the {model} yet.',
  VIEWER_NOT_READY: 'The 3D view is still loading.',
  UNKNOWN_COMPONENT: 'That part is not in the {model}.',
  INVALID_ARGUMENT: "That isn't available here.",
  chatHello: 'Hi!',
  chatHelloName: 'Hi {name}, nice to meet you!',
  chatWell: "I'm doing well, thanks for asking.",
  chatThanks: "You're welcome!",
  chatBye: 'Bye! Come back any time.',
  chatOffer: 'I can help you explore the {model} or explain any of its parts.',
  declined: "Okay, I won't do that.",
  teachThinking: 'Thinking about your question…',
  serviceBusy: 'The speech service is busy right now. Please try again in a moment.',
  serviceSlow: 'That took too long. Please ask again.',
};

const TE: Phrases = {
  zoom: 'జూమ్ చేస్తున్నాను.', zoomIn: 'దగ్గరగా చూపిస్తున్నాను.', zoomOut: 'దూరంగా చూపిస్తున్నాను.',
  pan: 'వ్యూని {dir} జరుపుతున్నాను.', orbit: '{dir} తిప్పుతున్నాను.', view: '{view} వ్యూ చూపిస్తున్నాను.', reset: 'మొదటి వ్యూకి వచ్చాం.',
  select: '{part} ఎంచుకున్నాను.', focus: '{part} చూపిస్తున్నాను.', isolate: '{part} మాత్రమే చూపిస్తున్నాను.',
  hide: '{part} దాచాను.', show: '{part} మళ్లీ చూపిస్తున్నాను.', showAll: 'అన్ని భాగాలు చూపిస్తున్నాను.',
  explode: 'భాగాలను విడదీస్తున్నాను.', assemble: 'భాగాలను మళ్లీ కలుపుతున్నాను.',
  animPlay: 'యానిమేషన్ మొదలైంది.', animPause: 'యానిమేషన్ ఆపాను.', animSpeed: 'యానిమేషన్ వేగం {speed} రెట్లు.',
  autoOrbit: 'ఆటో రొటేషన్ ఆన్.', autoOrbitOff: 'ఆటో రొటేషన్ ఆఫ్.',
  lessonStart: 'పాఠం మొదలుపెడుతున్నాను.', lessonNext: 'తర్వాతి దశ.', lessonPrev: 'ముందటి దశ.', lessonExit: 'పాఠం ముగించాను.',
  home: 'హోమ్ పేజీకి వెళ్తున్నాను.',
  deferred: 'మీ చేయి లేదా మౌస్ వ్యూని కదుపుతోంది. మీరు ఆపగానే చేస్తాను.',
  expired: 'మీ చేయి కదులుతూనే ఉంది, అందుకే అది వదిలేశాను.',
  needsSelection: 'ఏ భాగం అంటున్నారు? దాన్ని చూపించండి, ఎంచుకోండి లేదా పేరు చెప్పండి.',
  related: '{part} కి కనెక్ట్ అయిన భాగాలు హైలైట్ చేశాను: {list}.',
  clearHighlight: 'హైలైట్ తీసేశాను.',
  putBack: 'మళ్లీ యథాస్థితికి తెచ్చాను.',
  ask: '{part} గుర్తించాను.',
  identify: 'ఇది {part}: {role}.',
  notTaughtYet: 'ఇది {part}. దీని వివరణ ఇంకా అందుబాటులో లేదు.',
  questionNoPart: 'వివరణలు ఇంకా అందుబాటులో లేవు.',
  teachPreparing: '{part} వివరణ సిద్ధం చేస్తున్నాను…',
  emptyTranscript: 'నాకు సరిగ్గా వినిపించలేదు. ఇంకోసారి చెప్పగలరా?',
  noBottomView: 'కెమెరా గ్రౌండ్ గ్రిడ్ పైనే ఉంటుంది, కాబట్టి కింది వ్యూ లేదు. టాప్ లేదా ఫ్రంట్ వ్యూ చూడండి.',
  interpreting: 'మీరు అడిగింది సరిగ్గా అర్థం చేసుకుంటున్నాను…',
  unsupportedRequest: 'ఈ వ్యూయర్‌లో అది చేయలేను. ఒక భాగాన్ని వివరించమని, లేదా జూమ్, తిప్పడం, వ్యూ చూపించమని అడగండి.',
  teachPaused: 'ఆపాను. సిద్ధమైనప్పుడు “కొనసాగించు” అనండి.',
  teachResumed: 'కొనసాగిస్తున్నాను.',
  teachStopped: 'వివరణ ఆపేశాను.',
  teachFallback: 'AI టీచర్ ఇప్పుడు అందుబాటులో లేదు, కాబట్టి మోడల్ డేటాలో ఉన్నది చెబుతున్నాను.',
  languageUnclear: 'మీరు ఏ భాషలో మాట్లాడారో స్పష్టంగా తెలియలేదు. దయచేసి మళ్లీ చెప్పండి, లేదా menu లో మీ భాషను ఎంచుకోండి.',
  teachPreparingModel: '{model} వివరణ సిద్ధం చేస్తున్నాను…',
  noRelationships: 'ఈ మోడల్‌లో {part} కి ఏ కనెక్షన్లు నమోదు కాలేదు.',
  nothingToPutBack: 'ఇప్పుడు వేరు చేసినది, దాచినది లేదా హైలైట్ చేసినది ఏదీ లేదు.',
  ambiguous: 'ఏది అంటున్నారు: {options}?',
  unknownPart: '{part} ఈ {model} లో లేదు.',
  unknownPartOtherModel: '{part} {other} లో ఉంది, ఈ {model} లో లేదు.',
  unknownPartGeneric: 'ఆ భాగం ఈ {model} లో కనిపించలేదు.',
  noMatch: 'క్షమించండి, అర్థం కాలేదు. “జూమ్ ఇన్” లేదా “సన్ గేర్ సెలెక్ట్ చేయి” అని ప్రయత్నించండి.',
  cannot: 'క్షమించండి, ఇక్కడ అది చేయలేను.',
  UNSUPPORTED_ANIMATION: 'ఈ {model} కి యానిమేషన్ లేదు.',
  UNSUPPORTED_EXPLODED_VIEW: 'ఈ {model} కి ఎక్స్‌ప్లోడెడ్ వ్యూ లేదు.',
  LESSON_NOT_ACTIVE: 'ఏ పాఠం నడవడం లేదు. ముందు “పాఠం మొదలుపెట్టు” అనండి.',
  NO_LESSON: 'ఈ {model} కి ఇంకా పాఠం లేదు.',
  VIEWER_NOT_READY: '3D వ్యూ ఇంకా లోడ్ అవుతోంది.',
  UNKNOWN_COMPONENT: 'ఆ భాగం ఈ {model} లో లేదు.',
  INVALID_ARGUMENT: 'అది ఇక్కడ అందుబాటులో లేదు.',
  chatHello: 'హాయ్!',
  chatHelloName: 'హాయ్ {name}, మిమ్మల్ని కలవడం సంతోషం!',
  chatWell: 'నేను బాగున్నాను, అడిగినందుకు ధన్యవాదాలు.',
  chatThanks: 'పర్వాలేదు, సంతోషం!',
  chatBye: 'బై! ఎప్పుడైనా మళ్ళీ రండి.',
  chatOffer: '{model} ని చూడటానికి లేదా దానిలోని ఏ భాగాన్నైనా వివరించడానికి నేను సహాయం చేస్తాను.',
  declined: 'సరే, అది చేయను.',
  teachThinking: 'మీ ప్రశ్న గురించి ఆలోచిస్తున్నాను…',
  serviceBusy: 'speech service ఇప్పుడు బిజీగా ఉంది. కొద్దిసేపట్లో మళ్ళీ ప్రయత్నించండి.',
  serviceSlow: 'దీనికి చాలా సమయం పట్టింది. దయచేసి మళ్ళీ అడగండి.',
};

const HI: Phrases = {
  zoom: 'ज़ूम कर रही हूँ।', zoomIn: 'पास से दिखा रही हूँ।', zoomOut: 'दूर से दिखा रही हूँ।',
  pan: 'व्यू को {dir} खिसका रही हूँ।', orbit: '{dir} घुमा रही हूँ।', view: '{view} व्यू दिखा रही हूँ।', reset: 'पहले वाला व्यू।',
  select: '{part} चुना।', focus: '{part} दिखा रही हूँ।', isolate: 'सिर्फ़ {part} दिखा रही हूँ।',
  hide: '{part} छुपा दिया।', show: '{part} फिर से दिखा रही हूँ।', showAll: 'सारे पुर्ज़े दिखा रही हूँ।',
  explode: 'पुर्ज़े अलग कर रही हूँ।', assemble: 'पुर्ज़े वापस जोड़ रही हूँ।',
  animPlay: 'एनिमेशन चल रहा है।', animPause: 'एनिमेशन रोका।', animSpeed: 'एनिमेशन की गति {speed} गुना।',
  autoOrbit: 'ऑटो रोटेशन चालू।', autoOrbitOff: 'ऑटो रोटेशन बंद।',
  lessonStart: 'पाठ शुरू कर रही हूँ।', lessonNext: 'अगला चरण।', lessonPrev: 'पिछला चरण।', lessonExit: 'पाठ बंद किया।',
  home: 'होम पेज पर जा रही हूँ।',
  deferred: 'आपका हाथ या माउस व्यू घुमा रहा है। आप रुकेंगे तो कर दूँगी।',
  expired: 'आपका हाथ चलता रहा, इसलिए वह छोड़ दिया।',
  needsSelection: 'आप कौन सा पुर्ज़ा कह रहे हैं? उस पर इशारा करें, उसे चुनें या उसका नाम बोलें।',
  related: '{part} से जुड़े पुर्ज़े हाइलाइट किए: {list}।',
  clearHighlight: 'हाइलाइट हटा दिया।',
  putBack: 'वापस पहले जैसा कर दिया।',
  ask: '{part} पहचाना।',
  identify: 'यह {part} है: {role}।',
  notTaughtYet: 'यह {part} है। इसकी व्याख्या अभी उपलब्ध नहीं है।',
  questionNoPart: 'व्याख्याएँ अभी उपलब्ध नहीं हैं।',
  teachPreparing: '{part} की व्याख्या तैयार कर रही हूँ…',
  emptyTranscript: 'मुझे ठीक से सुनाई नहीं दिया। क्या आप फिर से बोल सकते हैं?',
  noBottomView: 'कैमरा ज़मीन की ग्रिड के ऊपर ही रहता है, इसलिए नीचे का व्यू नहीं है। टॉप या फ्रंट व्यू देखिए।',
  interpreting: 'आपकी बात ठीक से समझ रही हूँ…',
  unsupportedRequest: 'यह इस व्यूअर में नहीं हो सकता। किसी पुर्ज़े को समझाने, या ज़ूम, घुमाने या व्यू दिखाने को कहिए।',
  teachPaused: 'रोक दिया। तैयार हों तो “जारी रखो” बोलिए।',
  teachResumed: 'जारी रख रही हूँ।',
  teachStopped: 'व्याख्या रोक दी।',
  teachFallback: 'AI टीचर अभी उपलब्ध नहीं है, इसलिए मॉडल डेटा के आधार पर बता रही हूँ।',
  languageUnclear: 'समझ नहीं आया कि आपने कौन सी भाषा बोली। कृपया फिर से बोलिए, या menu में अपनी भाषा चुनिए।',
  teachPreparingModel: '{model} की व्याख्या तैयार कर रही हूँ…',
  noRelationships: 'इस मॉडल में {part} के कोई कनेक्शन दर्ज नहीं हैं।',
  nothingToPutBack: 'अभी कुछ भी अलग, छुपा या हाइलाइट नहीं है।',
  ambiguous: 'आप कौन सा कह रहे हैं: {options}?',
  unknownPart: '{part} इस {model} में नहीं है।',
  unknownPartOtherModel: '{part} {other} का हिस्सा है, इस {model} का नहीं।',
  unknownPartGeneric: 'वह पुर्ज़ा इस {model} में नहीं मिला।',
  noMatch: 'माफ़ कीजिए, समझ नहीं आया। “ज़ूम इन” या “सन गियर सेलेक्ट करो” बोलकर देखिए।',
  cannot: 'माफ़ कीजिए, यहाँ यह नहीं हो सकता।',
  UNSUPPORTED_ANIMATION: 'इस {model} में कोई एनिमेशन नहीं है।',
  UNSUPPORTED_EXPLODED_VIEW: 'इस {model} का एक्सप्लोडेड व्यू नहीं है।',
  LESSON_NOT_ACTIVE: 'कोई पाठ नहीं चल रहा। पहले “पाठ शुरू करो” बोलिए।',
  NO_LESSON: 'इस {model} का अभी कोई पाठ नहीं है।',
  VIEWER_NOT_READY: '3D व्यू अभी लोड हो रहा है।',
  UNKNOWN_COMPONENT: 'वह पुर्ज़ा इस {model} में नहीं है।',
  INVALID_ARGUMENT: 'यह यहाँ उपलब्ध नहीं है।',
  chatHello: 'नमस्ते!',
  chatHelloName: 'नमस्ते {name}, आपसे मिलकर अच्छा लगा!',
  chatWell: 'मैं ठीक हूँ, पूछने के लिए धन्यवाद।',
  chatThanks: 'आपका स्वागत है!',
  chatBye: 'बाय! कभी भी फिर आइए।',
  chatOffer: 'मैं {model} को देखने या उसके किसी भी पुर्ज़े को समझाने में मदद कर सकती हूँ।',
  declined: 'ठीक है, मैं ऐसा नहीं करूँगी।',
  teachThinking: 'आपके सवाल पर सोच रही हूँ…',
  serviceBusy: 'स्पीच सर्विस अभी व्यस्त है। थोड़ी देर में फिर कोशिश कीजिए।',
  serviceSlow: 'इसमें बहुत समय लग गया। कृपया फिर से पूछिए।',
};

const BN: Phrases = {
  // Stage 3: Bengali replies (polite "আপনি" register, technical terms kept in English as in te/hi).
  // Wording needs native-speaker review; only verified Bengali commands are suggested in examples.
  zoom: 'জুম করছি।', zoomIn: 'জুম ইন করছি।', zoomOut: 'জুম আউট করছি।',
  pan: 'ভিউ {dir} সরাচ্ছি।', orbit: '{dir} ঘোরাচ্ছি।', view: '{view} ভিউ দেখাচ্ছি।', reset: 'আগের ভিউতে ফিরে গেলাম।',
  select: '{part} সিলেক্ট করলাম।', focus: '{part} দেখাচ্ছি।', isolate: 'শুধু {part} দেখাচ্ছি।',
  hide: '{part} লুকিয়ে দিলাম।', show: '{part} আবার দেখাচ্ছি।', showAll: 'সব অংশ দেখাচ্ছি।',
  explode: 'অংশগুলো আলাদা করছি।', assemble: 'অংশগুলো আবার জুড়ে দিচ্ছি।',
  animPlay: 'অ্যানিমেশন চলছে।', animPause: 'অ্যানিমেশন থামালাম।', animSpeed: 'অ্যানিমেশনের গতি {speed} গুণ।',
  autoOrbit: 'অটো-রোটেশন চালু।', autoOrbitOff: 'অটো-রোটেশন বন্ধ।',
  lessonStart: 'গাইডেড পাঠ শুরু করছি।', lessonNext: 'পরের ধাপ।', lessonPrev: 'আগের ধাপ।', lessonExit: 'পাঠ বন্ধ করলাম।',
  home: 'হোম পেজে যাচ্ছি।',
  deferred: 'আপনার হাত বা মাউস ভিউ সরাচ্ছে। থামলেই করে দেব।',
  expired: 'আপনার হাত নড়ছিল, তাই ওটা বাদ দিলাম।',
  needsSelection: 'কোন অংশের কথা বলছেন? অংশটার দিকে দেখান, সিলেক্ট করুন বা নামটা বলুন।',
  related: '{part}-এর সঙ্গে যুক্ত অংশগুলো হাইলাইট করছি: {list}।',
  clearHighlight: 'হাইলাইট সরিয়ে দিলাম।',
  putBack: 'আগের মতো করে দিলাম।',
  ask: '{part} খুঁজে পেয়েছি।',
  identify: 'এটা {part}: {role}।',
  notTaughtYet: 'এটা {part}। এর ব্যাখ্যা এখনও পাওয়া যাচ্ছে না।',
  questionNoPart: 'ব্যাখ্যা এখনও পাওয়া যাচ্ছে না।',
  teachPreparing: '{part}-এর ব্যাখ্যা তৈরি করছি…',
  emptyTranscript: 'ঠিক শুনতে পেলাম না। আর একবার বলবেন?',
  noBottomView: 'ক্যামেরা গ্রাউন্ড গ্রিডের উপরেই থাকে, তাই নিচের ভিউ নেই। উপরের বা সামনের ভিউ দেখুন।',
  interpreting: 'আপনার কথাটা ঠিক বুঝেছি কি না দেখছি…',
  unsupportedRequest: 'এই ভিউয়ারে ওটা করা যায় না। কোনো অংশ বুঝিয়ে বলতে, বা জুম, ঘোরানো বা কোনো ভিউ দেখাতে বলতে পারেন।',
  // Bengali voice controls for explanations are not supported yet, so point to the Resume button
  teachPaused: 'থামালাম। আবার শুরু করতে Resume বোতাম চাপুন।',
  teachResumed: 'আবার শুরু করছি।',
  teachStopped: 'ব্যাখ্যা থামিয়ে দিলাম।',
  teachFallback: 'এই মুহূর্তে AI টিচার পাওয়া যাচ্ছে না, তাই মডেলের ডেটা থেকে বলছি।',
  languageUnclear: 'আপনি কোন ভাষায় বললেন, ঠিক বুঝতে পারলাম না। আবার বলুন, বা menu থেকে আপনার ভাষা বেছে নিন।',
  teachPreparingModel: '{model}-এর ব্যাখ্যা তৈরি করছি…',
  noRelationships: 'এই মডেলে {part}-এর সঙ্গে কোনো সংযোগের তথ্য নেই।',
  nothingToPutBack: 'এখন কিছুই আলাদা, লুকোনো বা হাইলাইট করা নেই।',
  ambiguous: 'কোনটার কথা বলছেন: {options}?',
  unknownPart: '{part} এই {model}-এর অংশ নয়।',
  unknownPartOtherModel: '{part} {other}-এর অংশ, এই {model}-এর নয়।',
  // Asks which part (e.g. "গিয়ারটা সিলেক্ট করো": several gears, none chosen)
  unknownPartGeneric: 'এই {model}-এ ওই অংশটা নির্দিষ্টভাবে খুঁজে পেলাম না। কোন অংশের কথা বলছেন?',
  noMatch: 'দুঃখিত, বুঝতে পারলাম না। “জুম ইন করো” বা “এই অংশটা বুঝিয়ে বলো” বলে দেখুন।',
  cannot: 'দুঃখিত, এখানে ওটা করা যায় না।',
  UNSUPPORTED_ANIMATION: 'এই {model}-এ চালানোর মতো কোনো অ্যানিমেশন নেই।',
  UNSUPPORTED_EXPLODED_VIEW: 'এই {model}-এর এক্সপ্লোডেড ভিউ নেই।',
  LESSON_NOT_ACTIVE: 'কোনো পাঠ চলছে না। আগে পাঠ শুরু করুন।',
  NO_LESSON: 'এই {model}-এর জন্য এখনও কোনো গাইডেড পাঠ নেই।',
  VIEWER_NOT_READY: '3D ভিউ এখনও লোড হচ্ছে।',
  UNKNOWN_COMPONENT: 'ওই অংশটা এই {model}-এ নেই।',
  INVALID_ARGUMENT: 'এটা এখানে করা যায় না।',
  chatHello: 'হাই!',
  chatHelloName: 'হাই {name}, আপনার সঙ্গে আলাপ করে ভালো লাগল!',
  chatWell: 'আমি ভালো আছি, জিজ্ঞেস করার জন্য ধন্যবাদ।',
  chatThanks: 'স্বাগতম!',
  chatBye: 'বিদায়! যখন খুশি আবার আসবেন।',
  chatOffer: 'আমি {model} দেখতে বা এর যেকোনো অংশ বুঝিয়ে দিতে সাহায্য করতে পারি।',
  declined: 'ঠিক আছে, আমি সেটা করব না।',
  teachThinking: 'আপনার প্রশ্নটা নিয়ে ভাবছি…',
  serviceBusy: 'স্পিচ সার্ভিস এখন ব্যস্ত। একটু পরে আবার চেষ্টা করুন।',
  serviceSlow: 'অনেক সময় লেগে গেল। আবার জিজ্ঞেস করুন।',
};

const WORDS: Record<ReplyLanguage, Record<string, string>> = {
  'en-IN': { left: 'left', right: 'right', up: 'up', down: 'down', back: 'back', front: 'front', top: 'top', isometric: 'isometric', vleft: 'left side', vright: 'right side', or: ' or ' },
  'te-IN': { left: 'ఎడమకు', right: 'కుడికి', up: 'పైకి', down: 'కిందకి', back: 'వెనుక', front: 'ముందు', top: 'పై', isometric: 'ఐసోమెట్రిక్', vleft: 'ఎడమ వైపు', vright: 'కుడి వైపు', or: ' లేదా ' },
  'hi-IN': { left: 'बाएं', right: 'दाएं', up: 'ऊपर', down: 'नीचे', back: 'पीछे का', front: 'सामने का', top: 'ऊपर का', isometric: 'आइसोमेट्रिक', vleft: 'बाईं तरफ़ का', vright: 'दाईं तरफ़ का', or: ' या ' },
  'bn-IN': { left: 'বাঁদিকে', right: 'ডানদিকে', up: 'উপরে', down: 'নিচে', back: 'পেছনের', front: 'সামনের', top: 'উপরের', isometric: 'আইসোমেট্রিক', vleft: 'বাঁদিকের', vright: 'ডানদিকের', or: ' বা ' },
};

const TABLES: Record<ReplyLanguage, Phrases> = { 'en-IN': EN, 'te-IN': TE, 'hi-IN': HI, 'bn-IN': BN };

/** Replies are localised for en/te/hi; any other (beta) language uses English. */
export function replyLanguage(language: string): ReplyLanguage {
  return (FULLY_SUPPORTED_LANGUAGES as readonly string[]).includes(language) ? (language as ReplyLanguage) : 'en-IN';
}

export interface ReplyVars {
  part?: string;
  model?: string;
  other?: string;
  options?: string[];
  dir?: string;
  view?: string;
  speed?: number;
  role?: string;
  /** Names listed together (e.g. related parts), joined with commas. */
  list?: string[];
  /** The learner's name (small talk). */
  name?: string;
}

export function reply(key: ReplyKey | RejectionCode, language: string, vars: ReplyVars = {}): string {
  const lang = replyLanguage(language);
  const table = TABLES[lang];
  const words = WORDS[lang];
  const template = (table as Record<string, string>)[key] ?? table.cannot;
  return template
    .replace('{name}', vars.name ?? '')
    .replace('{part}', vars.part ?? '')
    .replace('{model}', vars.model ?? '')
    .replace('{other}', vars.other ?? '')
    .replace('{options}', (vars.options ?? []).join(words.or))
    .replace('{dir}', vars.dir ? words[vars.dir] ?? vars.dir : '')
    .replace('{view}', vars.view ? words[`v${vars.view}`] ?? words[vars.view] ?? vars.view : '')
    .replace('{speed}', vars.speed !== undefined ? String(vars.speed) : '')
    .replace('{role}', vars.role ?? '')
    .replace('{list}', (vars.list ?? []).join(', '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** All keys every fully-supported language must define (used by tests). */
export const REPLY_KEYS = Object.keys(EN) as ReplyKey[];
export const REPLY_TABLES = TABLES;
