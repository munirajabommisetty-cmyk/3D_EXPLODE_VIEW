/**
 * Curated teaching notes for the Human Eye, Reinforced Concrete Frame and Steam Engine explorers
 * (English and Telugu). Rules as in teachingNotes.ts: restate the model's own facts, comparisons
 * say where they stop being true, technical terms stay in English. Telugu wording is written for
 * clarity but has not been reviewed by a native speaker. Hindi and Bengali use the generic
 * templates for these modules.
 */

import type { TeachingNote, NoteLanguage } from './teachingNotes';

type Notes = Partial<Record<NoteLanguage, TeachingNote>>;

export const MODULE_TEACHING_NOTES: Record<string, Record<string, Notes>> = {
  human_eye: {
    '*': {
      'en-IN': {
        analogy: 'The eye works a bit like a camera: the cornea and lens focus light, the iris sets how much light enters, and the retina is like the sensor. Unlike a camera, the picture is only "seen" when the brain interprets the signals sent along the optic nerve.',
      },
      'te-IN': {
        simple: 'మనకు ఒక వస్తువు కనిపించాలంటే, ఆ వస్తువు నుంచి వచ్చే కాంతి Cornea ద్వారా లోపలికి వస్తుంది, Pupil గుండా వెళ్తుంది, Lens దాన్ని focus చేస్తుంది, Retina మీద ఒక చిత్రం ఏర్పడుతుంది. Retina ఆ కాంతిని nerve signals గా మార్చి Optic nerve ద్వారా మెదడుకు పంపుతుంది; మెదడే ఆ signals ని అర్థం చేసుకుని మనకు చూపు కలిగిస్తుంది.',
        analogy: 'కన్ను ఒక కెమెరా లాంటిది: Cornea మరియు Lens కాంతిని focus చేస్తాయి, Iris ఎంత కాంతి లోపలికి వెళ్ళాలో నియంత్రిస్తుంది, Retina కెమెరా sensor లాంటిది. కానీ కెమెరా లాగా కాకుండా, మెదడు signals ని అర్థం చేసుకున్నప్పుడే మనకు చిత్రం కనిపిస్తుంది.',
      },
    },
    cornea: {
      'en-IN': { analogy: 'Like the front lens of a camera, the curved cornea bends incoming light so it starts to come to a focus. Unlike glass, it is living tissue that stays clear because it has no blood vessels.' },
      'te-IN': {
        simple: 'Cornea కంటి ముందు భాగంలో ఉండే పారదర్శకమైన (transparent) వంపు పొర. కాంతి మొదట దీని ద్వారానే లోపలికి వస్తుంది, మరియు కంటి focusing లో ఎక్కువ భాగం ఇదే చేస్తుంది.',
        analogy: 'ఇది కెమెరా ముందు ఉండే lens లాంటిది: వంపు వల్ల కాంతిని వంచి focus చేయడం మొదలుపెడుతుంది. కానీ గాజు లాగా కాకుండా, ఇది జీవకణాలతో ఉన్న పొర; దీనిలో రక్తనాళాలు ఉండవు కాబట్టి ఇది స్పష్టంగా ఉంటుంది.',
      },
    },
    lens: {
      'en-IN': { analogy: 'The lens works like the focus ring of a camera: it changes shape so that near and far objects both form a sharp image on the retina.' },
      'te-IN': {
        simple: 'Lens అనేది Iris వెనుక ఉండే పారదర్శకమైన, వంగే గుణం ఉన్న భాగం. దాని ఆకారం మారడం వల్ల దగ్గర మరియు దూరంలో ఉన్న వస్తువుల చిత్రం Retina మీద స్పష్టంగా పడుతుంది.',
        analogy: 'ఇది కెమెరాలో focus ని సరిచేసే ring లాంటిది. దగ్గర వస్తువు చూడాలంటే Ciliary muscle సహాయంతో Lens మరింత గుండ్రంగా మారుతుంది.',
      },
    },
    retina: {
      'en-IN': { analogy: 'The retina is a bit like a camera’s sensor: its cells turn light into electrical signals. But it does not "see" by itself — the brain interprets the signals.' },
      'te-IN': {
        simple: 'Retina కంటి వెనుక భాగంలో లోపల ఉండే కాంతిని గ్రహించే పొర. దీనిలోని Rods మరియు Cones కాంతిని electrical signals గా మారుస్తాయి.',
        analogy: 'ఇది కెమెరా sensor లాంటిది. కానీ Retina ఒక్కటే చూపు ఇవ్వదు; signals ని మెదడు అర్థం చేసుకున్నప్పుడే మనకు కనిపిస్తుంది.',
      },
    },
    optic_nerve: {
      'en-IN': { analogy: 'The optic nerve is like a data cable carrying the retina’s signals to the brain. The cable does not make the picture — the brain does.' },
      'te-IN': {
        simple: 'Optic nerve అనేది Retina నుంచి వచ్చే signals ని మెదడుకు తీసుకెళ్ళే నరాల కట్ట (nerve fibres bundle). ఇది Optic disc దగ్గర కంటి నుంచి బయటకు వెళ్తుంది. ఈ model లో దీని ఆకారం సులభతరం చేయబడిన (simplified) educational shape.',
        analogy: 'ఇది కెమెరా నుంచి కంప్యూటర్ కి data తీసుకెళ్ళే cable లాంటిది. Cable చిత్రాన్ని తయారు చేయదు; మెదడే చిత్రాన్ని అర్థం చేసుకుంటుంది.',
      },
    },
    iris: {
      'en-IN': { analogy: 'The iris works like a camera’s aperture: it opens wider in dim light and closes down in bright light. The pupil is the opening it controls.' },
      'te-IN': {
        simple: 'Iris కంటిలో రంగు ఉన్న భాగం. దీనిలోని కండరాలు Pupil పరిమాణాన్ని మార్చి, ఎంత కాంతి లోపలికి వెళ్ళాలో నియంత్రిస్తాయి.',
        analogy: 'ఇది కెమెరా aperture లాంటిది: తక్కువ కాంతిలో Pupil పెద్దదవుతుంది, ఎక్కువ కాంతిలో చిన్నదవుతుంది. Iris ఒక కండరాల పొర, Pupil అంటే దాని మధ్యలో ఉన్న రంధ్రం.',
      },
    },
    pupil: {
      'te-IN': {
        simple: 'Pupil అనేది ఒక భాగం కాదు, Iris మధ్యలో ఉన్న రంధ్రం (opening). కాంతి దీని గుండా Lens వైపు వెళ్తుంది; లోపలికి వెళ్ళిన కాంతి గ్రహించబడటం వల్ల ఇది నల్లగా కనిపిస్తుంది.',
      },
    },
  },

  rc_frame: {
    '*': {
      'en-IN': {
        analogy: 'Think of the frame like a table: the slab is the table top, the beams are its frame, the columns are its legs and the footings stop the legs sinking into the floor. A real building also needs the steel inside the concrete, which a table does not show.',
      },
      'te-IN': {
        simple: 'Load path అంటే బరువు ఎటు ప్రయాణిస్తుందో: Slab మీద ఉన్న బరువు Beams కి, Beams నుంచి Beam-column joints ద్వారా Columns కి, Columns నుంచి Footings కి, చివరగా నేలకి చేరుతుంది. ఇది సులభంగా అర్థం కావడానికి చూపిన illustration మాత్రమే, structural analysis కాదు.',
        analogy: 'ఈ frame ని ఒక టేబుల్ లాగా ఊహించుకోండి: Slab టేబుల్ పైభాగం, Beams దాని frame, Columns కాళ్ళు, Footings కాళ్ళు నేలలోకి దిగకుండా ఆపుతాయి. కానీ నిజమైన building లో concrete లోపల steel reinforcement కూడా అవసరం.',
      },
    },
    columns: {
      'en-IN': { analogy: 'Columns are like the legs of a table: everything above rests on them, and they carry it straight down to the footings.' },
      'te-IN': {
        simple: 'Column అనేది నిలువుగా ఉండే member. ఇది Beams నుంచి వచ్చే బరువును సేకరించి, ఎక్కువగా compression (నొక్కుదల) లో, Footing కి కిందికి పంపుతుంది.',
        analogy: 'ఇది టేబుల్ కాలు లాంటిది: పైన ఉన్నదంతా దాని మీదే ఆధారపడి ఉంటుంది.',
      },
    },
    beam_longitudinal_bars: {
      'en-IN': { analogy: 'Concrete is like a biscuit — strong when squeezed but it snaps when stretched or bent. Steel bars are placed where the concrete is stretched, so the two together work like a strong sandwich.' },
      'te-IN': {
        simple: 'Concrete నొక్కుదల (compression) లో బలంగా ఉంటుంది కానీ సాగదీసినప్పుడు (tension) బలహీనంగా ఉంటుంది. అందుకే Beam వంగినప్పుడు సాగే చోట steel reinforcement bars పెడతారు.',
        analogy: 'Concrete ఒక బిస్కెట్ లాంటిది: నొక్కితే తట్టుకుంటుంది, కానీ వంచితే విరిగిపోతుంది. Steel bars సాగే భాగాన్ని తట్టుకుంటాయి, కాబట్టి రెండూ కలిసి బలంగా పనిచేస్తాయి.',
      },
    },
    beam_stirrups: {
      'te-IN': {
        simple: 'Stirrups అనేవి Beam లోని bars చుట్టూ ఉండే మూసి ఉన్న loops. ఇవి supports దగ్గర వచ్చే shear (జారుడు ప్రభావం) ని తట్టుకుంటాయి మరియు bars ని సరైన స్థానంలో ఉంచుతాయి.',
      },
    },
    footings: {
      'te-IN': {
        simple: 'Footing అనేది Column కింద ఉండే concrete pad. నేల పరిమిత ఒత్తిడిని మాత్రమే తట్టుకోగలదు, కాబట్టి Footing Column బరువును ఎక్కువ విస్తీర్ణంలో పంచుతుంది.',
        analogy: 'మంచులో కూరుకుపోకుండా వేసుకునే వెడల్పైన snowshoes లాంటిది.',
      },
    },
    beam_column_joints: {
      'te-IN': {
        simple: 'Beam-column joint అంటే Beam మరియు Column కలిసే concrete భాగం. Beams నుంచి వచ్చే forces ఇక్కడి నుంచే Column లోకి వెళ్తాయి, కాబట్టి ఇక్కడ ties తో బాగా బిగించాలి మరియు bars ని సరిగ్గా anchor చేయాలి.',
      },
    },
  },

  steam_engine: {
    '*': {
      'en-IN': {
        analogy: 'Pedalling a bicycle is a good comparison: your legs push up and down, and the pedal crank turns that into rotation of the wheel. In the locomotive, steam pressure pushes the pistons back and forth, and the connecting rods and crank pins turn that into rotation of the driving wheels.',
      },
      'te-IN': {
        simple: 'Steam locomotive లో Firebox లో మండే ఇంధనం (heat input) Boiler లోని నీటిని steam గా మారుస్తుంది; ఆ steam ఒత్తిడి చివరకు Driving wheels ని తిప్పుతుంది — ఇది mechanical output. Steam dome నుంచి Steam pipe ద్వారా ఆ steam Cylinder లోకి వచ్చి Piston ని ముందుకు, వెనక్కి నెడుతుంది. Piston rod, Crosshead, Connecting rod ద్వారా ఆ కదలిక Crank pin ని తిప్పుతుంది; Coupling rods ఆరు Driving wheels నీ కలిపి తిప్పుతాయి — ఇది mechanical output. Return crank మరియు Slide valve steam ని సరైన సమయంలో సరైన వైపుకి పంపుతాయి; వాడిన steam Blast pipe ద్వారా Chimney నుంచి బయటకు వెళ్తుంది.',
        analogy: 'సైకిల్ తొక్కడం దీనికి మంచి ఉదాహరణ: కాళ్ళు pedal ని నెడతాయి, Crank ఆ నెట్టుడును చక్రం తిరగడంగా మారుస్తుంది. Engine లో steam ఒత్తిడి Piston ని నెడుతుంది, Connecting rod మరియు Crank pin దాన్ని Driving wheels తిరగడంగా మారుస్తాయి. ఈ animation కదలికను మాత్రమే చూపిస్తుంది; వేడి లేదా ఒత్తిడిని simulate చేయదు.',
      },
    },
    piston: {
      'en-IN': { analogy: 'Like a syringe plunger pushed by air, the piston is pushed along the cylinder by steam pressure — first from one side, then from the other.' },
      'te-IN': {
        simple: 'Piston అనేది Cylinder లోపల గట్టిగా సరిపోయే disc. Steam ఒత్తిడి దాని ఒక వైపు నెట్టినప్పుడు అది Cylinder వెంట కదులుతుంది; ఈ engine double-acting కాబట్టి steam రెండు వైపులా మార్చి మార్చి పనిచేస్తుంది. ఇక్కడే heat energy (steam ఒత్తిడి రూపంలో) సరళ రేఖ కదలికగా (straight-line motion) మారుతుంది.',
        analogy: 'గాలి నెట్టే syringe plunger లాంటిది: steam ఒత్తిడి Piston ని ఒకసారి ఒక వైపు నుంచి, తర్వాత మరో వైపు నుంచి నెడుతుంది.',
      },
    },
    connecting_rod: {
      'en-IN': { analogy: 'Like your leg on a bicycle pedal: one end moves with the push, the other end goes round in a circle with the crank.' },
      'te-IN': {
        simple: 'Connecting rod యొక్క ఒక చివర Crosshead తో సరళ రేఖలో కదులుతుంది, మరో చివర Crank pin తో గుండ్రంగా తిరుగుతుంది. Crank తో కలిసి ఇది ముందుకు-వెనక్కి (reciprocating) కదలికను rotational motion గా మారుస్తుంది.',
        analogy: 'సైకిల్ pedal మీద కాలు లాంటిది: ఒక చివర నెడుతుంది, మరో చివర Crank తో వృత్తాకారంలో తిరుగుతుంది.',
      },
    },
    axles: {
      'te-IN': {
        simple: 'Axle ప్రతి జత చక్రాలను కలిపే బలమైన steel shaft. మధ్యలో ఉండేది Driving axle; Locomotive బరువును ఇవి Frame నుంచి చక్రాలకు చేరుస్తాయి.',
      },
    },
    driving_wheels: {
      'en-IN': { analogy: 'Like the wheels of a bicycle turned by the pedals, the driving wheels are turned by the rods, and their heavy weight keeps them rolling smoothly between the pushes, like a flywheel.' },
      'te-IN': {
        simple: 'Driving wheels రైలు పట్టాల మీద తిరుగుతూ రైలును కదిలిస్తాయి — ఇదే engine యొక్క mechanical output. Coupling rods వల్ల ఆరు చక్రాలు కలిసి తిరుగుతాయి; వాటి బరువు flywheel లాగా కదలికను సమంగా ఉంచుతుంది.',
        analogy: 'Pedals తిప్పినప్పుడు సైకిల్ చక్రం తిరిగినట్లు, Rods నెట్టినప్పుడు Driving wheels తిరుగుతాయి.',
      },
    },
    firebox: {
      'en-IN': { analogy: 'Like the stove under a pressure cooker, the firebox is where the heat comes from.' },
      'te-IN': {
        simple: 'Firebox లో బొగ్గు (లేదా కట్టెలు, నూనె) మండుతుంది. ఆ వేడి వాయువులు Boiler లోని tubes ద్వారా వెళ్లి నీటిని మరిగిస్తాయి — ఇది locomotive యొక్క heat input.',
      },
    },
  },
};
