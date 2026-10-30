/**
 * Localised teaching notes (Milestone A) used by the model-data explanation when the AI teacher is
 * unavailable (e.g. its quota is used up), so a Telugu, Hindi or Bengali learner still gets an
 * explanation in their language.
 *
 * Rules for every entry:
 *  - It restates what this model's own data already says (component roles, the recorded
 *    relationships and the gear-train animation in models/mechanical/planetaryGearbox*.ts and
 *    data/machineMetadata.ts). It adds no specification or number: numbers in the spoken answer
 *    come from the metadata at run time.
 *  - An analogy says where it matches AND where it differs from the real part.
 *  - Component names and technical terms stay in English, as learners hear them in class.
 * The Telugu, Hindi and Bengali wording is written for clarity but has NOT been reviewed by a native
 * speaker yet.
 */

import { MODULE_TEACHING_NOTES } from './moduleTeachingNotes';

export type NoteLanguage = 'en-IN' | 'te-IN' | 'hi-IN' | 'bn-IN';

export interface TeachingNote {
  /** Plain-language role of the part (replaces "Its role: <metadata label>" in the local languages). */
  simple?: string;
  /** A familiar comparison, with where it differs. */
  analogy?: string;
  /** Where this kind of machine is used, from the model description. */
  uses?: string;
}

type Notes = Partial<Record<NoteLanguage, TeachingNote>>;

const PLANET: Notes = {
  'en-IN': {
    analogy: 'Think of the Earth: it spins on its own axis and also travels around the Sun. Each Planet Gear spins on its carrier pin and also travels around the Sun Gear. The difference: here the motion comes from gear teeth meshing, not from gravity.',
  },
  'te-IN': {
    simple: 'Planet Gears మూడూ Sun Gear చుట్టూ ఉంటాయి. ఇవి లోపల Sun Gear తో, బయట Ring Gear తో mesh అవుతాయి, మరియు Planet Carrier pins మీద తిరుగుతాయి.',
    analogy: 'భూమిని గుర్తు చేసుకోండి: అది తన చుట్టూ తాను తిరుగుతూనే సూర్యుడి చుట్టూ కూడా తిరుగుతుంది. అలాగే ప్రతి Planet Gear తన carrier pin మీద తిరుగుతూ, Sun Gear చుట్టూ కూడా తిరుగుతుంది. తేడా ఏమిటంటే, ఇక్కడ కదలిక gear teeth mesh అవ్వడం వల్ల వస్తుంది, gravity వల్ల కాదు.',
  },
  'hi-IN': {
    simple: 'तीनों Planet Gears, Sun Gear के चारों ओर होते हैं। ये अंदर Sun Gear से और बाहर Ring Gear से mesh होते हैं, और Planet Carrier के pins पर घूमते हैं।',
    analogy: 'पृथ्वी को याद कीजिए: वह अपनी धुरी पर घूमती है और सूरज के चारों ओर भी चक्कर लगाती है। उसी तरह हर Planet Gear अपने carrier pin पर घूमता है और Sun Gear के चारों ओर भी चलता है। फर्क यह है कि यहाँ गति gear teeth के mesh होने से आती है, gravity से नहीं।',
  },
  'bn-IN': {
    simple: 'তিনটি Planet Gear, Sun Gear-এর চারপাশে থাকে। এগুলো ভিতরে Sun Gear-এর সঙ্গে আর বাইরে Ring Gear-এর সঙ্গে mesh করে, আর Planet Carrier-এর pin-এর উপর ঘোরে।',
    analogy: 'পৃথিবীর কথা ভাবুন: সে নিজের অক্ষে ঘোরে, আবার সূর্যের চারপাশেও ঘোরে। তেমনি প্রতিটি Planet Gear নিজের carrier pin-এ ঘোরে, আবার Sun Gear-এর চারপাশেও ঘোরে। পার্থক্য হল, এখানে গতি আসে gear teeth mesh হওয়ার ফলে, gravity থেকে নয়।',
  },
};

/** modelId -> componentId (or '*' for the whole model) -> language -> note */
export const TEACHING_NOTES: Record<string, Record<string, Notes>> = {
  planetary_gearbox: {
    '*': {
      'en-IN': {
        analogy: 'Like bicycle gears, this gearbox changes speed: the Sun Gear turns fast and the Planet Carrier turns slower, with more torque. Unlike a bicycle there is no chain: the gears mesh directly, and the input and output share one axis.',
      },
      'te-IN': {
        simple: 'ఈ planetary gearbox మధ్యలో Sun Gear, దాని చుట్టూ మూడు Planet Gears, వాటిని పట్టుకునే Planet Carrier, బయట Ring Gear ఉంటాయి. Drive shaft Sun Gear ని తిప్పుతుంది; Planet Gears స్థిరంగా ఉన్న Ring Gear లోపల దొర్లుతూ Planet Carrier ని తక్కువ వేగంతో తిప్పుతాయి.',
        analogy: 'సైకిల్ gears లాగే ఈ gearbox కూడా వేగాన్ని మారుస్తుంది: Sun Gear వేగంగా తిరుగుతుంది, Planet Carrier నెమ్మదిగా, ఎక్కువ torque తో తిరుగుతుంది. కానీ సైకిల్ లాగా ఇక్కడ chain ఉండదు: gears నేరుగా mesh అవుతాయి, input మరియు output ఒకే అక్షం (axis) మీద ఉంటాయి.',
        uses: 'Model data ప్రకారం ఇలాంటి gearboxes ని robotics, automotive మరియు aerospace transmissions లో ఉపయోగిస్తారు.',
      },
      'hi-IN': {
        simple: 'इस planetary gearbox के बीच में Sun Gear है, उसके चारों ओर तीन Planet Gears, उन्हें थामने वाला Planet Carrier और बाहर Ring Gear है। Drive shaft, Sun Gear को घुमाता है; Planet Gears स्थिर Ring Gear के अंदर लुढ़कते हुए Planet Carrier को कम गति से घुमाते हैं।',
        analogy: 'साइकिल के gears की तरह यह gearbox भी गति बदलता है: Sun Gear तेज़ घूमता है और Planet Carrier धीरे, ज़्यादा torque के साथ। लेकिन साइकिल की तरह यहाँ chain नहीं है: gears सीधे mesh होते हैं, और input और output एक ही axis पर होते हैं।',
        uses: 'Model data के अनुसार ऐसे gearboxes robotics, automotive और aerospace transmissions में इस्तेमाल होते हैं।',
      },
      'bn-IN': {
        simple: 'এই planetary gearbox-এর মাঝখানে Sun Gear, তার চারপাশে তিনটি Planet Gear, সেগুলো ধরে রাখে Planet Carrier, আর বাইরে Ring Gear। Drive shaft, Sun Gear-কে ঘোরায়; Planet Gear-গুলো স্থির Ring Gear-এর ভিতরে গড়িয়ে Planet Carrier-কে কম গতিতে ঘোরায়।',
        analogy: 'সাইকেলের gears-এর মতো এই gearbox-ও গতি বদলায়: Sun Gear দ্রুত ঘোরে, আর Planet Carrier ধীরে, বেশি torque নিয়ে। তবে সাইকেলের মতো এখানে chain নেই: gears সরাসরি mesh করে, আর input ও output একই axis-এ থাকে।',
        uses: 'Model data অনুযায়ী এ ধরনের gearbox robotics, automotive আর aerospace transmissions-এ ব্যবহার হয়।',
      },
    },
    sun_gear: {
      'en-IN': {
        analogy: 'The name comes from the solar system: the Sun Gear sits in the centre and the Planet Gears travel around it, like planets around the Sun. Unlike the real Sun, it pushes the planets with its teeth: it is the input that drives them.',
      },
      'te-IN': {
        simple: 'Sun Gear ఈ gearbox మధ్యలో ఉండే input gear. Drive shaft దీన్ని తిప్పుతుంది, ఇది చుట్టూ ఉన్న మూడు Planet Gears తో mesh అయి వాటిని తిప్పుతుంది.',
        analogy: 'దీని పేరు సౌర కుటుంబం నుంచి వచ్చింది: సూర్యుడి చుట్టూ గ్రహాలు తిరిగినట్లు, మధ్యలో ఉన్న Sun Gear చుట్టూ Planet Gears తిరుగుతాయి. తేడా ఏమిటంటే, ఈ Sun Gear తన teeth తో Planet Gears ని నెడుతుంది; ఇదే వాటిని నడిపించే input.',
        uses: 'Robotics, automotive మరియు aerospace transmissions లో వాడే ఇలాంటి gearboxes లో, మోటార్ నుంచి వచ్చే వేగవంతమైన input ని Sun Gear తీసుకుంటుంది.',
      },
      'hi-IN': {
        simple: 'Sun Gear इस gearbox के बीच का input gear है। Drive shaft इसे घुमाता है, और यह चारों ओर के तीन Planet Gears से mesh होकर उन्हें घुमाता है।',
        analogy: 'इसका नाम सौर मंडल से आया है: जैसे सूरज के चारों ओर ग्रह घूमते हैं, वैसे ही बीच के Sun Gear के चारों ओर Planet Gears चलते हैं। फर्क यह है कि यह Sun Gear अपने teeth से Planet Gears को धकेलता है; यही उन्हें चलाने वाला input है।',
        uses: 'Robotics, automotive और aerospace transmissions में इस्तेमाल होने वाले ऐसे gearboxes में, मोटर से आने वाला तेज़ input Sun Gear लेता है।',
      },
      'bn-IN': {
        simple: 'Sun Gear এই gearbox-এর মাঝখানের input gear। Drive shaft এটাকে ঘোরায়, আর এটা চারপাশের তিনটি Planet Gear-এর সঙ্গে mesh করে সেগুলোকে ঘোরায়।',
        analogy: 'এর নাম এসেছে সৌরজগৎ থেকে: সূর্যের চারপাশে যেমন গ্রহরা ঘোরে, তেমনি মাঝখানের Sun Gear-এর চারপাশে Planet Gear-গুলো ঘোরে। পার্থক্য হল, এই Sun Gear নিজের teeth দিয়ে Planet Gear-গুলোকে ঠেলে; এটাই সেগুলোকে চালানোর input।',
        uses: 'Robotics, automotive আর aerospace transmissions-এ ব্যবহৃত এ ধরনের gearbox-এ মোটর থেকে আসা দ্রুত input নেয় Sun Gear।',
      },
    },
    planet_gear_1: PLANET,
    planet_gear_2: PLANET,
    planet_gear_3: PLANET,
    ring_gear: {
      'en-IN': {
        analogy: 'Think of a circular running track: the Planet Gears roll around on the inside teeth of the Ring Gear. In this model the Ring Gear stays still, and that is what lets the planets push the carrier forward.',
      },
      'te-IN': {
        simple: 'Ring Gear బయట ఉండే పెద్ద gear; దీని teeth లోపలి వైపు ఉంటాయి. ఈ model లో ఇది కదలకుండా స్థిరంగా ఉంటుంది, Planet Gears దీని లోపల దొర్లుతాయి.',
        analogy: 'ఒక గుండ్రని running track ని ఊహించుకోండి: Planet Gears, Ring Gear లోపలి teeth మీద దొర్లుతూ చుట్టూ తిరుగుతాయి. ఈ model లో Ring Gear కదలదు, అందుకే Planet Gears, Planet Carrier ని ముందుకు నెట్టగలుగుతాయి.',
      },
      'hi-IN': {
        simple: 'Ring Gear बाहर का बड़ा gear है; इसके teeth अंदर की ओर होते हैं। इस model में यह स्थिर रहता है, और Planet Gears इसके अंदर लुढ़कते हैं।',
        analogy: 'एक गोल running track की कल्पना कीजिए: Planet Gears, Ring Gear के अंदरूनी teeth पर लुढ़कते हुए चक्कर लगाते हैं। इस model में Ring Gear हिलता नहीं, इसी से Planet Gears, Planet Carrier को आगे धकेल पाते हैं।',
      },
      'bn-IN': {
        simple: 'Ring Gear বাইরের বড় gear; এর teeth ভিতরের দিকে। এই model-এ এটা স্থির থাকে, আর Planet Gear-গুলো এর ভিতরে গড়িয়ে চলে।',
        analogy: 'একটা গোল running track কল্পনা করুন: Planet Gear-গুলো Ring Gear-এর ভিতরের teeth-এর উপর গড়িয়ে চারপাশে ঘোরে। এই model-এ Ring Gear নড়ে না, তাই Planet Gear-গুলো Planet Carrier-কে সামনে ঠেলতে পারে।',
      },
    },
    planet_carrier: {
      'en-IN': {
        analogy: 'Like the frame of a merry-go-round that carries the seats: when the seats (the Planet Gears) travel around, the frame turns with them. That frame is the output of this gearbox.',
      },
      'te-IN': {
        simple: 'Planet Carrier మూడు Planet Gears ని తన pins మీద పట్టుకుంటుంది. Planet Gears చుట్టూ తిరిగినప్పుడు ఇది కూడా తిరుగుతుంది; ఈ gearbox కి ఇదే output.',
        analogy: 'జాతరలో రంగులరాట్నం (merry-go-round) seats ని మోసే frame లాంటిది: seats (Planet Gears) చుట్టూ తిరిగితే frame కూడా వాటితో తిరుగుతుంది. ఆ frame ఈ gearbox output.',
      },
      'hi-IN': {
        simple: 'Planet Carrier तीनों Planet Gears को अपने pins पर थामता है। जब Planet Gears चक्कर लगाते हैं, यह भी घूमता है; यही इस gearbox का output है।',
        analogy: 'मेले के झूले (merry-go-round) के उस frame की तरह जो seats को थामता है: seats (Planet Gears) चक्कर लगाती हैं तो frame भी उनके साथ घूमता है। वही frame इस gearbox का output है।',
      },
      'bn-IN': {
        simple: 'Planet Carrier তিনটি Planet Gear-কে নিজের pin-এ ধরে রাখে। Planet Gear-গুলো চারপাশে ঘুরলে এটাও ঘোরে; এটাই এই gearbox-এর output।',
        analogy: 'মেলার নাগরদোলার (merry-go-round) সেই frame-এর মতো, যা seat-গুলো বয়ে নিয়ে চলে: seat-গুলো (Planet Gear) ঘুরলে frame-ও তাদের সঙ্গে ঘোরে। সেই frame-ই এই gearbox-এর output।',
      },
    },
    central_shaft: {
      'en-IN': {
        analogy: 'Like the shaft of a table-fan motor that turns the blades, this shaft carries the motor\'s rotation into the gearbox and turns the Sun Gear.',
      },
      'te-IN': {
        simple: 'Primary Drive Shaft మోటార్ నుంచి వచ్చే వేగవంతమైన తిరుగుడు ని gearbox లోకి తీసుకువస్తుంది. ఇది keyway ద్వారా Sun Gear ని తిప్పుతుంది.',
        analogy: 'Table fan లో మోటార్ shaft blades ని తిప్పినట్లు, ఈ shaft మోటార్ తిరుగుడు ని gearbox లోకి తెచ్చి Sun Gear ని తిప్పుతుంది.',
      },
      'hi-IN': {
        simple: 'Primary Drive Shaft मोटर से आने वाले तेज़ घुमाव को gearbox में लाता है। यह keyway के ज़रिए Sun Gear को घुमाता है।',
        analogy: 'जैसे table fan में मोटर का shaft पंखुड़ियों (blades) को घुमाता है, वैसे ही यह shaft मोटर का घुमाव gearbox में लाकर Sun Gear को घुमाता है।',
      },
      'bn-IN': {
        simple: 'Primary Drive Shaft মোটর থেকে আসা দ্রুত ঘূর্ণন gearbox-এ নিয়ে আসে। এটা keyway-এর মাধ্যমে Sun Gear-কে ঘোরায়।',
        analogy: 'Table fan-এ মোটরের shaft যেমন blades ঘোরায়, তেমনি এই shaft মোটরের ঘূর্ণন gearbox-এ এনে Sun Gear-কে ঘোরায়।',
      },
    },
  },
};

// New learning modules (eye, reinforced concrete frame, steam engine)
Object.assign(TEACHING_NOTES, MODULE_TEACHING_NOTES);

export function teachingNote(modelId: string, componentId: string | null, language: string): TeachingNote | null {
  return TEACHING_NOTES[modelId]?.[componentId ?? '*']?.[language as NoteLanguage] ?? null;
}
