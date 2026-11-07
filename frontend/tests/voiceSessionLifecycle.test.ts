/**
 * Real-time conversational voice pass (6 Nov 2026). Offline: synthetic microphone levels, simulated
 * Prisma / Timbre / LLM. No microphone, no network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { END_SILENCE_MS, MAX_RECORDING_MS, NO_SPEECH_MS, SpeechEndDetector } from '../src/services/voice/recorder';

const FRAME = (2048 / 48000) * 1000; // ~42.7 ms, the recorder's frame at 48 kHz
type Pattern = (t: number) => number;
const steady = (base: number) => () => base;

/** Runs the detector over a level pattern; returns why and when it stopped. */
function run(levels: Pattern, maxMs = 30000) {
  const d = new SpeechEndDetector();
  let t = 0;
  while (t < maxMs) {
    const r = d.push(levels(t), FRAME);
    t += FRAME;
    if (r) return { reason: r, at: t, speech: d.speechStarted };
  }
  return { reason: null, at: t, speech: d.speechStarted };
}

describe('Microphone: end of the question is detected (one turn per press)', () => {
  it('quiet room: stops about 1.1 s after the student stops talking', () => {
    const r = run((t) => (t > 300 && t < 2300 ? 0.08 : steady(0.003)()));
    assert.equal(r.reason, 'silence');
    assert.ok(r.at > 2300 + END_SILENCE_MS - 100 && r.at < 2300 + END_SILENCE_MS + 200, String(r.at));
  });

  it('speaking the instant the mic opens is still heard (was: 8 s wait, question discarded)', () => {
    const loud = run((t) => (t < 2000 ? 0.08 : 0.003));
    assert.deepEqual([loud.reason, loud.speech], ['silence', true]);
    assert.ok(loud.at < 2000 + END_SILENCE_MS + 200);
    const soft = run((t) => (t < 2500 ? 0.03 : 0.003));
    assert.deepEqual([soft.reason, soft.speech], ['silence', true]);
  });

  it('a fluctuating background (TV / traffic) no longer keeps the mic open until 25 s', () => {
    const r = run((t) => (t > 300 && t < 2300 ? 0.1 : Math.floor(t / 300) % 2 ? 0.045 : 0.012));
    assert.equal(r.reason, 'silence');
    assert.ok(r.at < 2300 + END_SILENCE_MS + 1500, `stopped at ${Math.round(r.at)} ms`);
  });

  it('steady fan noise: speech is found and the end is detected', () => {
    const r = run((t) => (t > 300 && t < 2300 ? 0.1 : 0.02));
    assert.equal(r.reason, 'silence');
    assert.ok(r.at < 2300 + END_SILENCE_MS + 300);
  });

  it('natural short pauses and a one-second thinking pause do not cut the question', () => {
    const words = run((t) => (t > 300 && t < 4300 ? (Math.floor(t / 700) % 2 && t % 700 < 400 ? 0.004 : 0.08) : 0.003));
    assert.ok(words.at > 4300, `cut at ${Math.round(words.at)} ms`);
    const think = run((t) => ((t > 300 && t < 1500) || (t > 2500 && t < 3500) ? 0.08 : 0.003));
    assert.ok(think.at > 3500, `cut at ${Math.round(think.at)} ms during a 1 s pause`);
  });

  it('nobody speaks: gives up after the no-speech timeout (no request is sent)', () => {
    const r = run(steady(0.004));
    assert.equal(r.reason, 'nospeech');
    assert.ok(r.at > NO_SPEECH_MS && r.at < NO_SPEECH_MS + 200);
  });

  // Root cause of "I didn't catch that" when answering the tutor (6 Nov 2026): the tail of the tutor's
  // voice / the mic start-up pop counted as speech and the turn ended before the learner answered.
  it('answering right after the tutor speaks: a start-up transient does not end the turn early', () => {
    const r = run((t) => (t < 200 ? 0.06 : t > 1400 && t < 2300 ? 0.08 : 0.003));
    assert.equal(r.reason, 'silence');
    assert.ok(r.at > 2300, `stopped at ${Math.round(r.at)} ms, before the answer (1.4-2.3 s) was recorded`);
    const late = run((t) => (t < 250 ? 0.05 : t > 2000 && t < 2700 ? 0.08 : 0.003));
    assert.ok(late.at > 2700, `a 2 s reaction time is still recorded (stopped at ${Math.round(late.at)} ms)`);
  });

  it('a very short "Yes." ends the turn and is kept (not discarded as no speech)', () => {
    const r = run((t) => (t > 700 && t < 900 ? 0.08 : 0.003));
    assert.equal(r.reason, 'silence');
    assert.ok(r.at < 900 + 1600, `ended at ${Math.round(r.at)} ms`);
  });

  it('a mouse click or keyboard tap alone is not speech', () => {
    const r = run((t) => (t > 600 && t < 650 ? 0.2 : 0.003));
    assert.equal(r.reason, 'nospeech');
  });

  it('never records longer than the cap', () => {
    const r = run((t) => (Math.floor(t / FRAME) % 5 === 4 ? 0.01 : 0.3), MAX_RECORDING_MS + 5000);
    assert.equal(r.reason, 'max');
  });
});

/* ============================== automatic language, speech pauses, non-repeated answers ============================== */

import { transcribeAuto, AUTO_STT_FALLBACK_CODES } from '../src/services/voice/voiceClient';
import { createChunkedClip, createLiveClip, resetNarrationGapClock, TIMBRE_EDGE_SILENCE_MS, type AudioLike, type NarrationGap } from '../src/services/teaching/chunkedNarration';
import { buildComponentBrief } from '../src/services/teaching/componentBrief';
import { TEACHING_LANGUAGES } from '../src/services/teaching/teachingController';
import { validQuiz } from '../src/services/teaching/teachingPlan';
import {
  TutorSession, buildFallbackQuiz, classifyTutorReply, keywordEvaluate, tutorPhrase, type EvaluateRequest,
} from '../src/services/teaching/tutorSession';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import { makeWorkspace } from './sceneContext.test';

const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;

describe('Automatic language: one Prisma request decides the language', () => {
  it('sends language "auto" with the part names as hints, and reads the detected language', async () => {
    let sent: FormData | null = null;
    const fake = async (_url: string, init?: RequestInit) => {
      sent = init!.body as FormData;
      return new Response(JSON.stringify({ transcript: 'sun gear ఎలా పనిచేస్తుంది', language: 'te-IN', detectedLanguage: 'te-IN' }), { status: 200 });
    };
    const r = await transcribeAuto(new Blob(['x']), ['Sun Gear', 'Planet Gear A'], undefined, fake as never);
    assert.deepEqual(r, { text: 'sun gear ఎలా పనిచేస్తుంది', language: 'te-IN' });
    assert.equal(sent!.get('language'), 'auto');
    assert.equal(sent!.get('keyterms'), 'Sun Gear,Planet Gear A');
  });

  it('no detected language comes back as null (the app then judges the script itself)', async () => {
    const fake = async () => new Response(JSON.stringify({ transcript: '', language: null }), { status: 200 });
    assert.deepEqual(await transcribeAuto(new Blob(['x']), [], undefined, fake as never), { text: '', language: null });
    assert.ok(AUTO_STT_FALLBACK_CODES.includes('GNANI_BAD_REQUEST'), 'a refused v3 request falls back to the old method');
  });

  it('the teacher can answer in every language Prisma detects (not silently English)', () => {
    for (const l of ['en-IN', 'te-IN', 'hi-IN', 'bn-IN', 'ta-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'gu-IN', 'pa-IN']) assert.ok(TEACHING_LANGUAGES.includes(l), l);
  });
});

describe('Natural speech: pauses between meaningful segments, nothing overlaps', () => {
  it('the sentence pause comes from Timbre\'s own edge silence (~330 ms); the player adds none', () => {
    assert.ok(TIMBRE_EDGE_SILENCE_MS.lead + TIMBRE_EDGE_SILENCE_MS.tail >= 300);
  });

  it('segments play strictly in order with a pause between them (not after the last)', async () => {
    const events: string[] = [];
    let playing = 0;
    let maxPlaying = 0;
    const clip = createChunkedClip('First idea is here. Second idea follows now. Third idea ends it.', {
      synth: async (t) => new Blob([t]),
      makeAudio: (blob) => {
        const audio = {
          ended: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, pause() {},
          async play() {
            playing += 1;
            maxPlaying = Math.max(maxPlaying, playing);
            events.push(`play:${(await blob.text()).slice(0, 5)}`);
            setTimeout(() => { playing -= 1; audio.ended = true; audio.onended?.(); }, 2);
          },
        };
        return { audio: audio as AudioLike, release: () => {} };
      },
      pauseMs: (c) => { events.push(`pause:${c.slice(0, 5)}`); return 5; },
      tickMs: 2,
    });
    clip.play();
    assert.equal(await clip.done, 'ended');
    assert.equal(maxPlaying, 1, 'never two segments at once');
    const plays = events.filter((e) => e.startsWith('play')).length;
    const pauses = events.filter((e) => e.startsWith('pause')).length;
    assert.ok(plays >= 2);
    assert.equal(pauses, plays - 1, 'a pause between segments, none after the last');
    assert.ok(events.indexOf('pause:First') < events.indexOf('play:Secon'));
  });

  it('stop() during a pause: no further segment plays', async () => {
    const played: string[] = [];
    const clip = createChunkedClip('One sentence here. Another sentence there.', {
      synth: async (t) => new Blob([t]),
      makeAudio: (blob) => {
        const audio = {
          ended: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, pause() {},
          async play() { played.push(await blob.text()); setTimeout(() => audio.onended?.(), 1); },
        };
        return { audio: audio as AudioLike, release: () => {} };
      },
      pauseMs: () => 200, tickMs: 5,
    });
    clip.play();
    await new Promise((r) => setTimeout(r, 40));
    clip.stop();
    assert.equal(await clip.done, 'stopped');
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(played.length, 1, 'the old explanation does not continue after an interruption');
  });
});

describe('Different questions get different answers (even without the AI teacher)', () => {
  it('purpose, how-it-works and explain plans differ for the same part', () => {
    const w = makeWorkspace(gearbox);
    const brief = (q: string) => buildComponentBrief(gearbox, w.snapshot(false), 'sun_gear', q) as { title: string; steps: { narration: string }[] };
    const purpose = brief('purpose');
    const how = brief('howWorks');
    const explain = brief('explain');
    assert.notEqual(purpose.steps[0].narration, how.steps[0].narration);
    assert.notEqual(how.steps[0].narration, explain.steps[0].narration);
    assert.notEqual(purpose.title, how.title);
    assert.ok(/needed/i.test(purpose.title) && /works/i.test(how.title));
  });
});

/* ============================== tutor: check understanding, two questions, feedback ============================== */

const QUIZ = [
  { question: 'Why does the sun gear mesh with three planet gears?', answer: 'To share the load between several gear teeth so no single tooth is overloaded.' },
  { question: 'What would happen to the output if the carrier were removed?', answer: 'The planet gears motion would not be collected, so the output would not turn.' },
];
const plan = (target: string | null = 'sun_gear', quiz = QUIZ) => ({ modelId: gearbox.id, title: 'How the Sun Gear works', targetComponentId: target, quiz });

function tutorWith(verdicts: boolean[] | 'fail') {
  const asked: EvaluateRequest[] = [];
  const t = new TutorSession({
    evaluate: async (req) => {
      asked.push(req);
      if (verdicts === 'fail') throw new Error('checker unavailable');
      const correct = verdicts.shift() ?? true;
      return { correct, feedback: correct ? 'Yes, exactly.' : 'Not quite: think about the load.', misconception: correct ? null : 'thinks it adds speed' };
    },
  });
  return { t, asked };
}

describe('Tutor workflow', () => {
  it('reply classification (English, Telugu, Hindi)', () => {
    assert.equal(classifyTutorReply('Yes, that makes sense', 'checking'), 'yes');
    assert.equal(classifyTutorReply('అవును, అర్థమైంది', 'checking'), 'yes');
    assert.equal(classifyTutorReply('हाँ समझ गया', 'checking'), 'yes');
    assert.equal(classifyTutorReply('No, can you explain again?', 'checking'), 'clarify');
    assert.equal(classifyTutorReply('అర్థం కాలేదు', 'checking'), 'clarify');
    assert.equal(classifyTutorReply('not clear', 'checking'), 'clarify');
    assert.equal(classifyTutorReply('skip the quiz', 'checking'), 'skip');
    assert.equal(classifyTutorReply('no thanks', 'checking'), 'skip');
    assert.equal(classifyTutorReply('What is a planet carrier?', 'checking'), 'question');
    assert.equal(classifyTutorReply('to share the load', 'quiz'), 'answer');
    assert.equal(classifyTutorReply('wait, why do we need gears?', 'quiz'), 'question');
    assert.equal(classifyTutorReply('later', 'quiz'), 'skip');
  });

  it('explain → check → yes → two questions (both correct) → summary', async () => {
    const { t, asked } = tutorWith([true, true]);
    const check = t.explanationFinished(plan(), [], 'en-IN');
    assert.deepEqual(check, { kind: 'say', text: tutorPhrase('check', 'en-IN') });
    assert.ok(/Does that make sense/.test((check as { text: string }).text));
    const q1 = await t.handle('yes', 'en-IN');
    assert.ok(q1.kind === 'say' && q1.text.includes('Question 1 of 2') && q1.text.includes(QUIZ[0].question));
    const a1 = await t.handle('so the load is shared between teeth', 'en-IN');
    assert.ok(a1.kind === 'say' && a1.text.startsWith('Yes, exactly.') && a1.text.includes('Question 2 of 2'));
    assert.equal(asked[0].expectedAnswer, QUIZ[0].answer);
    const a2 = await t.handle('the output would stop', 'en-IN');
    assert.equal(t.getView().stage, 'done');
    assert.ok(a2.kind === 'say' && a2.text.includes('You answered both questions correctly'));
    assert.equal(t.getView().results.length, 2);
    assert.equal(asked.length, 2, 'exactly two questions were asked');
  });

  it('a wrong answer is corrected and the student gets one more try', async () => {
    const { t, asked } = tutorWith([false, false, true]);
    t.explanationFinished(plan(), [], 'en-IN');
    await t.handle('yes', 'en-IN');
    const wrong = await t.handle('it makes the gearbox faster', 'en-IN');
    assert.ok(wrong.kind === 'say' && wrong.text.includes('think about the load'), 'feedback explains the misconception');
    assert.equal(t.getView().stage, 'quiz');
    assert.equal(t.getView().attempt, 2);
    assert.equal(t.getView().questionIndex, 0, 'same question again');
    await t.handle('still faster', 'en-IN'); // wrong twice: moves on
    assert.equal(t.getView().questionIndex, 1);
    assert.equal(asked[1].attempt, 2);
    const end = await t.handle('the output stops', 'en-IN');
    assert.ok(end.kind === 'say' && end.text.includes('Worth another look') && end.text.includes(QUIZ[0].question));
  });

  it('skip, ask something else, or give a scene command: the quiz is never forced', async () => {
    const a = tutorWith([]);
    a.t.explanationFinished(plan(), [], 'en-IN');
    assert.equal((await a.t.handle('skip', 'en-IN')).kind, 'say');
    assert.equal(a.t.getView().stage, 'idle');

    const b = tutorWith([]);
    b.t.explanationFinished(plan(), [], 'en-IN');
    assert.deepEqual(await b.t.handle('How does the ring gear move?', 'en-IN'), { kind: 'pass' });
    assert.equal(b.t.isOpen(), false);

    const c = tutorWith([]);
    c.t.explanationFinished(plan(), [], 'en-IN');
    await c.t.handle('yes', 'en-IN');
    assert.deepEqual(await c.t.handle('zoom in', 'en-IN', { sceneCommand: true }), { kind: 'pass' });
    assert.equal(c.t.getView().stage, 'quiz', 'the quiz waits while the scene command runs');
    assert.deepEqual(await c.t.handle('wait, what is torque?', 'en-IN'), { kind: 'pass' });
    assert.equal(c.t.getView().stage, 'idle');
  });

  it('one check per topic; "explain again" re-explains and checks again', async () => {
    const { t } = tutorWith([]);
    assert.ok(t.explanationFinished(plan(), [], 'en-IN'));
    const clarify = await t.handle('no, explain again', 'en-IN');
    assert.equal(clarify.kind, 'clarify');
    assert.equal((clarify as { targetComponentId: string | null }).targetComponentId, 'sun_gear');
    assert.ok(t.explanationFinished(plan(), [], 'en-IN'), 'after the clearer explanation, it checks again');
    await t.handle('skip', 'en-IN');
    assert.equal(t.explanationFinished(plan(), [], 'en-IN'), null, 'a follow-up on the same topic does not start another quiz');
    assert.ok(t.explanationFinished(plan('ring_gear'), [], 'en-IN'), 'a new topic gets its own check');
  });

  it('without the AI checker, answers are checked by key words (and the tutor says so)', async () => {
    const { t } = tutorWith('fail');
    t.explanationFinished(plan(), [], 'en-IN');
    await t.handle('yes', 'en-IN');
    const r = await t.handle('it shares the load between gear teeth', 'en-IN');
    assert.ok(r.kind === 'say');
    assert.equal(t.getView().checkedBy, 'keywords');
    assert.equal(t.getView().questionIndex, 1, 'key words matched: counted as correct');
    const wrong = keywordEvaluate({ question: 'q', expectedAnswer: QUIZ[1].answer, studentAnswer: 'blue', language: 'en-IN', topic: 't', attempt: 1 });
    assert.equal(wrong.correct, false);
    assert.ok(wrong.feedback.includes('try again'));
  });

  it('words spoken while an answer is being checked are held, not sent off as a new request', async () => {
    let release!: () => void;
    const t = new TutorSession({ evaluate: () => new Promise((res) => { release = () => res({ correct: true, feedback: 'ok', misconception: null }); }) });
    t.explanationFinished(plan(), [], 'en-IN');
    await t.handle('yes', 'en-IN');
    const first = t.handle('the load is shared', 'en-IN');
    const second = await t.handle('they share the load with the planet gears', 'en-IN');
    assert.deepEqual(second, { kind: 'say', text: tutorPhrase('stillChecking', 'en-IN') });
    assert.equal(t.getView().stage, 'evaluating');
    release();
    await first;
    assert.equal(t.getView().questionIndex, 1);
  });

  it('a stale answer check is dropped after the session is reset (e.g. model switched)', async () => {
    let release!: () => void;
    const t = new TutorSession({ evaluate: () => new Promise((res) => { release = () => res({ correct: true, feedback: 'ok', misconception: null }); }) });
    t.explanationFinished(plan(), [], 'en-IN');
    await t.handle('yes', 'en-IN');
    const pending = t.handle('an answer', 'en-IN');
    assert.equal(t.getView().stage, 'evaluating');
    t.reset();
    release();
    assert.deepEqual(await pending, { kind: 'stale' });
    assert.equal(t.getView().stage, 'idle');
  });

  it('quiz in the student language; fallback questions use real part names', () => {
    const te = buildFallbackQuiz(gearbox, 'sun_gear', 'te-IN');
    assert.equal(te.length, 2);
    assert.ok(te[0].question.includes('Sun Gear') && /[ఀ-౿]/.test(te[0].question), 'Telugu question, English part name');
    assert.ok(te[1].answer.includes('Planet Gear'), 'answer key from the recorded relationships');
    const whole = buildFallbackQuiz(gearbox, null, 'en-IN');
    assert.ok(whole[0].question.includes(gearbox.name));
    assert.equal(validQuiz(QUIZ).length, 2);
    assert.equal(validQuiz([QUIZ[0]]).length, 0, 'exactly two or none');
    assert.ok(/[ఀ-౿]/.test(tutorPhrase('check', 'te-IN')) && /[ऀ-ॿ]/.test(tutorPhrase('check', 'hi-IN')));
  });
});

describe('Spoken replies to "Does that make sense?" (the phrases from the bug report)', () => {
  const cases: [string, string][] = [
    ['Yes.', 'yes'], ['Yes, I understand.', 'yes'], ['Quiz me.', 'yes'], ['Ask me two questions.', 'yes'],
    ["Let's continue.", 'yes'], ['Yes, I understood. Quiz me.', 'yes'], ['Okay', 'yes'],
    ['Explain again.', 'clarify'], ["I didn't understand.", 'clarify'], ['Can you explain that again?', 'clarify'],
    ["I didn't understand the relationship between these parts.", 'clarify'],
    ['Skip.', 'skip'], ['Skip the quiz.', 'skip'], ['No thanks', 'skip'],
    ['What is the purpose of this component?', 'question'], ['Yes, but why does it need three planets?', 'question'],
    ['hmm', 'unclear'],
    // Telugu, Hindi and Telugu-English mixed (as Prisma codemix writes them: English words stay Latin)
    ['అవును, నాకు అర్థమైంది.', 'yes'], ['నాకు అర్థం కాలేదు, explain again.', 'clarify'], ['ఇంకోసారి explain చేయండి.', 'clarify'],
    ['quiz అడగండి', 'yes'], ['ఇది ఎందుకు అవసరం?', 'question'],
    ['हाँ, समझ आ गया', 'yes'], ['मुझे समझ नहीं आया', 'clarify'], ['रहने दो', 'skip'],
  ];
  for (const [text, intent] of cases) {
    it(`"${text}" → ${intent}`, () => assert.equal(classifyTutorReply(text, 'checking'), intent));
  }

  it('naming a different part is a new question even if it sounds like a reply', () => {
    assert.equal(classifyTutorReply('okay what about the ring gear', 'checking', { newTopic: true }), 'question');
  });

  it('"Yes, quiz me" starts Question 1; a specific "I did not understand…" is passed to the teacher', async () => {
    const { t } = tutorWith([]);
    t.explanationFinished(plan(), [], 'en-IN');
    const q1 = await t.handle('Yes, quiz me', 'en-IN');
    assert.ok(q1.kind === 'say' && q1.text.includes('Question 1 of 2'));

    const b = tutorWith([]);
    b.t.explanationFinished(plan(), [], 'en-IN');
    const c = await b.t.handle("I didn't understand the relationship between these parts", 'en-IN');
    assert.equal(c.kind, 'clarify');
    assert.equal((c as { question: string | null }).question, "I didn't understand the relationship between these parts");
    assert.equal(b.t.getView().stage, 'idle', 'no quiz started');

    const d = tutorWith([]);
    d.t.explanationFinished(plan(), [], 'te-IN');
    const e = await d.t.handle('ఇంకోసారి explain చేయండి', 'te-IN');
    assert.ok(e.kind === 'clarify' && e.question === null, 'a plain "explain again" re-explains the whole idea');
    assert.ok(/[\u0C00-\u0C7F]/.test((e as { text: string }).text), 'acknowledged in Telugu');
  });

  it('an unclear sound keeps the check open (the learner can just answer again)', async () => {
    const { t } = tutorWith([]);
    t.explanationFinished(plan(), [], 'hi-IN');
    const r = await t.handle('hmm', 'hi-IN');
    assert.ok(r.kind === 'say' && /[\u0900-\u097F]/.test(r.text));
    assert.equal(t.getView().stage, 'checking');
    const q = await t.handle('हाँ', 'hi-IN');
    assert.ok(q.kind === 'say' && q.text.includes('सवाल 1/2'));
  });
});

/* ============================== diagnostics (metadata only; observation never changes decisions) ============================== */

import { RecordingStatsCollector, SpeechEndDetector as Detector } from '../src/services/voice/recorder';

describe('Recording diagnostics', () => {
  const pattern = (t: number) => (t > 700 && t < 2200 ? 0.08 : 0.003);

  it('observing the detector does not change when it stops', () => {
    const plain = run(pattern);
    const d = new Detector();
    const stats = new RecordingStatsCollector(48000, 1);
    let t = 0;
    let reason: string | null = null;
    while (!reason && t < 30000) {
      reason = d.push(pattern(t), FRAME);
      stats.push(null, pattern(t), FRAME, d.lastFrameVoiced);
      t += FRAME;
    }
    assert.equal(reason, plain.reason);
    assert.equal(Math.round(t), Math.round(plain.at), 'same stop time with and without diagnostics');
    const r = stats.result(reason!, d);
    assert.equal(r.inputSampleRate, 48000);
    assert.equal(r.endReason, 'silence');
    assert.ok(r.vadOnsetMs! >= 700 + 240 && r.vadOnsetMs! < 1100, `onset ${r.vadOnsetMs}`);
    assert.ok(Math.abs(r.vadFirstVoicedMs! - 700) < 60 && Math.abs(r.vadLastVoicedMs! - 2200) < 60);
    assert.ok(r.vadVoicedMs > 1300 && r.avgRms > 0);
  });

  it('silence: no onset, no voiced frames', () => {
    const d = new Detector();
    const stats = new RecordingStatsCollector(16000, 1);
    for (let i = 0; i < 50; i++) { d.push(0.003, FRAME); stats.push(new Float32Array([0.003, -0.002]), 0.003, FRAME, d.lastFrameVoiced); }
    const r = stats.result('nospeech', d);
    assert.deepEqual([r.vadOnsetMs, r.vadFirstVoicedMs, r.vadLastVoicedMs, r.vadVoicedMs], [null, null, null, 0]);
    assert.equal(r.peak, 0.003);
  });

  it('the metadata travels as one form field next to the audio (no audio or words in it)', async () => {
    let sent: FormData | null = null;
    const fake = async (_u: string, init?: RequestInit) => { sent = init!.body as FormData; return new Response(JSON.stringify({ transcript: 'x', language: 'en-IN' })); };
    await transcribeAuto(new Blob(['x']), [], undefined, fake as never, { durationMs: 1500, endReason: 'silence', vadOnsetMs: 540 });
    assert.deepEqual(JSON.parse(String(sent!.get('diag'))), { durationMs: 1500, endReason: 'silence', vadOnsetMs: 540 });
    await transcribeAuto(new Blob(['x']), [], undefined, fake as never);
    assert.equal(sent!.get('diag'), null, 'no field when there is nothing to send');
  });
});

/* ============================== muted microphone (exact digital silence) ============================== */

import { startRecording, SILENT_INPUT_MS, isDigitalSilence } from '../src/services/voice/recorder';

/** Browser audio stand-ins: getUserMedia + an AudioContext whose processor we drive frame by frame. */
interface FakeTrack {
  label?: string; muted?: boolean; enabled?: boolean; readyState?: string; stopped?: boolean;
  onended?: (() => void) | null; onmute?: (() => void) | null; onunmute?: (() => void) | null;
}
async function fakeMic(
  run: (feed: (sample: number) => void, track: FakeTrack) => void | Promise<void>, stopAfter?: boolean,
  opts: {
    track?: FakeTrack; ctxState?: string; resumed?: { called: boolean };
    noTrack?: boolean; deny?: string; onMuted?: (muted: boolean) => void;
  } = {}
) {
  const g = globalThis as Record<string, unknown>;
  const saved = { nav: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), win: g.window };
  let proc: { onaudioprocess: ((e: unknown) => void) | null } | null = null;
  class Ctx {
    sampleRate = 48000;
    state = opts.ctxState ?? 'running';
    resume() { if (opts.resumed) opts.resumed.called = true; this.state = 'running'; return Promise.resolve(); }
    destination = {};
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { proc = { onaudioprocess: null, connect() {}, disconnect() {} } as never; return proc; }
    close() { return Promise.resolve(); }
  }
  const track: FakeTrack & { getSettings: () => object; stop: () => void } = {
    label: 'Test Mic', muted: false, enabled: true, readyState: 'live', stopped: false, onended: null, onmute: null, onunmute: null,
    ...opts.track,
    getSettings: () => ({ channelCount: 1, deviceId: 'device-secret-id-123' }),
    stop() { track.stopped = true; track.readyState = 'ended'; },
  };
  const stream = { getAudioTracks: () => (opts.noTrack ? [] : [track]), getTracks: () => [track] };
  const getUserMedia = async () => {
    if (opts.deny) throw Object.assign(new Error('denied'), { name: opts.deny });
    return stream;
  };
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia } }, configurable: true });
  g.window = { AudioContext: Ctx };
  try {
    const rec = await startRecording(undefined, opts.onMuted);
    let n = 0;
    const feed = (sample: number) => {
      const frame = new Float32Array(2048);
      for (let i = 0; i < frame.length; i++) frame[i] = sample * (i % 2 ? 1 : -1);
      n++;
      proc!.onaudioprocess?.({ inputBuffer: { getChannelData: () => frame } });
    };
    await run(feed, track);
    if (stopAfter) rec.stop();
    else rec.cancel(); // no-op if it already finished
    const result = await rec.done;
    return { result, frames: n, track };
  } finally {
    if (saved.nav) Object.defineProperty(globalThis, 'navigator', saved.nav);
    g.window = saved.win;
  }
}

describe('Muted microphone', () => {
  const frameMs = (2048 / 48000) * 1000;

  it('exact zeros end the recording with micSilent and nothing is uploaded', async () => {
    const { result } = await fakeMic((feed) => { for (let i = 0; i < 200; i++) feed(0); });
    assert.equal(result.reason, 'micSilent');
    assert.equal(result.wav, null, 'no audio goes to Prisma');
    assert.ok(result.stats!.durationMs >= SILENT_INPUT_MS && result.stats!.durationMs < SILENT_INPUT_MS + 2 * frameMs);
  });

  it('pressing stop on a muted microphone is also micSilent (not "say it again")', async () => {
    const { result } = await fakeMic((feed) => { for (let i = 0; i < 20; i++) feed(0); }, true);
    assert.equal(result.reason, 'micSilent');
    assert.equal(result.wav, null);
  });

  it('a quiet but live room is never mistaken for a muted microphone', async () => {
    const { result } = await fakeMic((feed) => { for (let i = 0; i < 60; i++) feed(0.0004); }, true);
    assert.notEqual(result.reason, 'micSilent');
    assert.ok(!isDigitalSilence(0.0004) && isDigitalSilence(0));
  });

  it('speech after a quiet start records normally and ends on silence', async () => {
    const { result } = await fakeMic((feed) => {
      for (let i = 0; i < 10; i++) feed(0.002);
      for (let i = 0; i < 40; i++) feed(0.08);
      for (let i = 0; i < 80; i++) feed(0.002);
    });
    assert.equal(result.reason, 'silence');
    assert.ok(result.wav instanceof Blob && result.wav.size > 44);
  });
});

/* ============================== multilingual voice turns (offline: parser + language decision) ============================== */

import { manualStopReason, AUDIBLE_PEAK } from '../src/services/voice/recorder';
import { autoTurnLanguage } from '../src/services/voice/voiceLanguage';
import { isBareReply } from '../src/services/teaching/tutorSession';
import { handleVoiceTurn as runTurn, previewTurn as peekTurn } from '../src/services/voice/voiceSession';
import { reply as replyText } from '../src/services/voice/voiceReplies';

describe('Manual stop: what is worth sending to Prisma', () => {
  it('detected speech is always sent, including a short reply', () => {
    assert.equal(manualStopReason(true, 400, 30, 0.3), 'manual');
    assert.equal(manualStopReason(false, 160, 12, 0.05), 'manual', 'a short "yes" the detector counted');
  });
  it('a quiet word the detector missed is still sent if it was audible', () => {
    assert.equal(manualStopReason(false, 0, 20, AUDIBLE_PEAK), 'manual');
  });
  it('room noise only (nothing audible) is not sent', () => {
    assert.equal(manualStopReason(false, 0, 40, 0.004), 'nospeech');
    assert.equal(manualStopReason(false, 0, 5, 0.2), 'nospeech', 'a click right after pressing');
  });
  it('a muted microphone is reported as such', () => {
    assert.equal(manualStopReason(false, 0, 40, 0), 'micSilent');
  });
});

describe('Language of each auto-detected turn', () => {
  it('Prisma detection is used for English, Telugu and Hindi', () => {
    assert.equal(autoTurnLanguage('en-IN', 'What is this component?', 'te-IN'), 'en-IN');
    assert.equal(autoTurnLanguage('te-IN', 'ఈ భాగం ఏమిటి?', 'en-IN'), 'te-IN');
    assert.equal(autoTurnLanguage('hi-IN', 'यह कौन सा भाग है?', 'te-IN'), 'hi-IN');
  });
  it('English → Telugu → Hindi → English: each turn is decided afresh', () => {
    let lang = 'en-IN';
    const turns: Array<[string | null, string, string]> = [
      ['en-IN', 'What is this component?', 'en-IN'],
      ['te-IN', 'ఈ భాగం ఏమిటి?', 'te-IN'],
      ['hi-IN', 'यह कौन सा भाग है?', 'hi-IN'],
      [null, 'What is this?', 'en-IN'],
    ];
    for (const [detected, text, expected] of turns) {
      lang = autoTurnLanguage(detected, text, lang);
      assert.equal(lang, expected, text);
    }
  });
  it('the script wins when detection contradicts it', () => {
    assert.equal(autoTurnLanguage('en-IN', 'ఈ భాగం ఏమిటి?', 'en-IN'), 'te-IN');
    assert.equal(autoTurnLanguage('en-IN', 'सन गियर क्या है?', 'en-IN'), 'hi-IN');
  });
  it('no detection: script decides; Latin after Telugu is English', () => {
    assert.equal(autoTurnLanguage(null, 'ఇది ఏమిటి?', 'en-IN'), 'te-IN');
    assert.equal(autoTurnLanguage(null, 'zoom in', 'te-IN'), 'en-IN');
  });
  it('another detected Devanagari language is kept (not forced to Hindi)', () => {
    assert.equal(autoTurnLanguage('mr-IN', 'हा भाग काय आहे?', 'en-IN'), 'mr-IN');
  });
});

describe('Test phrases are answered locally, in the language spoken (no Gemini call)', () => {
  const all = modelRegistry.getAllModels();
  const ask = (t: string, lang: string) => {
    const w = makeWorkspace(gearbox);
    w.dispatcher.dispatch({ type: 'component.select', componentId: 'sun_gear' }, 'ui');
    return {
      kind: peekTurn({ transcript: t, dispatcher: w.dispatcher, model: gearbox, allModels: all }).kind,
      r: runTurn({ transcript: t, language: lang, dispatcher: w.dispatcher, model: gearbox, allModels: all, teachingAvailable: true }),
    };
  };
  it('English: "What is this component?"', () => {
    const { kind, r } = ask('What is this component?', 'en-IN');
    assert.equal(kind, 'question');
    assert.equal(r.status, 'answered');
    assert.match(r.caption, /^That is the Sun Gear/);
  });
  it('Telugu: "ఈ భాగం ఏమిటి?" answered in Telugu', () => {
    const { r } = ask('ఈ భాగం ఏమిటి?', 'te-IN');
    assert.equal(r.status, 'answered');
    assert.match(r.caption, /^ఇది Sun Gear/);
  });
  it('Hindi: "यह कौन सा भाग है?" answered in Hindi', () => {
    const { r } = ask('यह कौन सा भाग है?', 'hi-IN');
    assert.equal(r.status, 'answered');
    assert.match(r.caption, /^यह Sun Gear है/);
  });
  it('the longer "connected to … why" question goes to the explanation, about the sun gear', () => {
    const { r } = ask('Can you explain what this component is connected to and why that connection matters?', 'en-IN');
    assert.equal(r.status, 'teach');
    assert.equal(r.teach!.targetComponentId, 'sun_gear');
  });
});

describe('A lone yes / no', () => {
  it('is recognised in every language, and only when it is the whole utterance', () => {
    for (const t of ['Yes.', 'yes', 'No.', 'Okay', 'అవును.', 'లేదు', 'हाँ.', 'नहीं', 'হ্যাঁ']) assert.ok(isBareReply(t), t);
    for (const t of ['next', 'continue', 'yes, what is this?', 'no, show the ring gear', 'start lesson', '']) assert.ok(!isBareReply(t), t);
  });
  it('the guidance reply exists in English, Telugu and Hindi', () => {
    assert.match(replyText('bareReply', 'en-IN'), /what is this component/);
    assert.match(replyText('bareReply', 'te-IN'), /ఈ భాగం ఏమిటి/);
    assert.match(replyText('bareReply', 'hi-IN'), /यह कौन सा भाग है/);
    for (const l of ['en-IN', 'te-IN', 'hi-IN']) assert.notEqual(replyText('heardNoWords', l), replyText('emptyTranscript', l));
  });
});

/* ============================== capture chain: each failure named by what was measured ============================== */

import { AUDIO_START_TIMEOUT_MS, TRACK_MUTED_WAIT_MS, MicError as RecorderMicError, deviceTag } from '../src/services/voice/recorder';
import { captureProblemMessage } from '../src/services/voice/captureMessages';

describe('Microphone capture chain', () => {
  it('silent device: the stats prove it (every sample 0, track live and unmuted, engine running)', async () => {
    const { result } = await fakeMic((feed) => { for (let i = 0; i < 100; i++) feed(0); });
    assert.equal(result.reason, 'micSilent');
    const st = result.stats!;
    assert.equal(st.zeroFraction, 1);
    assert.equal(st.peak, 0);
    assert.deepEqual([st.trackEnabled, st.trackMutedAtStart, st.trackMutedAtEnd, st.trackReadyState, st.audioContextState], [1, 0, 0, 'live', 'running']);
    assert.equal(result.capture!.deviceLabel, 'Test Mic');
  });

  it('start-up zeros (e.g. a Bluetooth headset switching on) are not reported as muted', async () => {
    const { result } = await fakeMic((feed) => {
      for (let i = 0; i < 55; i++) feed(0); // ~2.3 s of zeros while the device starts
      for (let i = 0; i < 10; i++) feed(0.002); // then room noise
      for (let i = 0; i < 40; i++) feed(0.08); // then speech
      for (let i = 0; i < 80; i++) feed(0.002);
    });
    assert.equal(result.reason, 'silence');
    assert.ok(result.wav);
    assert.ok(result.stats!.zeroFraction > 0 && result.stats!.zeroFraction < 1);
  });

  it('a track muted for the whole wait is reported as trackMuted (after the wait, not at once)', async () => {
    const frameMs = (2048 / 48000) * 1000;
    const states: boolean[] = [];
    const { result } = await fakeMic((feed) => {
      for (let i = 0; i < Math.ceil(TRACK_MUTED_WAIT_MS / frameMs) + 5; i++) feed(0);
    }, false, { track: { muted: true }, onMuted: (m) => states.push(m) });
    assert.equal(result.reason, 'trackMuted');
    assert.equal(result.wav, null, 'nothing is sent to Prisma');
    assert.equal(result.stats!.trackMutedAtStart, 1);
    assert.ok(result.stats!.durationMs >= TRACK_MUTED_WAIT_MS);
    assert.deepEqual(states, [true], 'the dock was told at once');
  });

  it('a muted track that is unmuted continues the same turn and records only real audio', async () => {
    const states: boolean[] = [];
    const { result, track } = await fakeMic((feed, t) => {
      for (let i = 0; i < 120; i++) feed(0); // ~5 s muted: longer than the silent-device window
      t.muted = false;
      t.onunmute?.();
      for (let i = 0; i < 10; i++) feed(0.002);
      for (let i = 0; i < 40; i++) feed(0.08); // speech
      for (let i = 0; i < 80; i++) feed(0.002);
    }, false, { track: { muted: true }, onMuted: (m) => states.push(m) });
    assert.equal(result.reason, 'silence');
    assert.deepEqual(states, [true, false]);
    // The ~5 s of muted zeros are observed (stats) but not uploaded: the upload holds only the
    // audio after unmuting, ending ~1.1 s after the speech
    const frameMs = (2048 / 48000) * 1000;
    const uploadMs = ((result.wav!.size - 44) / 2 / 16000) * 1000;
    assert.ok(result.stats!.durationMs >= 120 * frameMs, 'muted time was observed');
    assert.ok(uploadMs > 50 * frameMs - 1 && uploadMs < 90 * frameMs, `upload ${uploadMs} ms`);
    assert.ok(track.stopped, 'the stream is released when the turn ends');
  });

  it('muted after the learner started speaking: what was said is kept', async () => {
    const { result } = await fakeMic((feed, t) => {
      for (let i = 0; i < 10; i++) feed(0.002);
      for (let i = 0; i < 30; i++) feed(0.08);
      t.muted = true;
      t.onmute?.();
    });
    assert.equal(result.reason, 'manual');
    assert.ok(result.wav && result.wav.size > 44);
  });

  it('pressing stop while muted reports trackMuted', async () => {
    const { result } = await fakeMic((feed) => { for (let i = 0; i < 20; i++) feed(0); }, true, { track: { muted: true } });
    assert.equal(result.reason, 'trackMuted');
  });

  it('a device that goes away mid-recording ends as trackEnded', async () => {
    const { result } = await fakeMic((feed, track) => { feed(0.01); track.readyState = 'ended'; track.onended?.(); });
    assert.equal(result.reason, 'trackEnded');
    assert.equal(result.wav, null);
  });

  it('a suspended audio engine is resumed', async () => {
    const resumed = { called: false };
    const { result } = await fakeMic((feed) => { for (let i = 0; i < 100; i++) feed(0.002); }, true, { ctxState: 'suspended', resumed });
    assert.ok(resumed.called);
    assert.notEqual(result.reason, 'audioStalled');
  });

  it('no frames at all: audioStalled (never "Listening…" forever)', async () => {
    const { result } = await fakeMic(() => new Promise((r) => setTimeout(r, AUDIO_START_TIMEOUT_MS + 150)));
    assert.equal(result.reason, 'audioStalled');
    const stopped = await fakeMic(() => undefined, true);
    assert.equal(stopped.result.reason, 'audioStalled', 'stop before any frame arrived');
  });

  it('the device id is logged only as a short tag', () => {
    const tag = deviceTag('device-secret-id-123');
    assert.match(tag, /^[0-9a-f]{8}$/);
    assert.ok(!tag.includes('secret'));
    assert.equal(deviceTag(''), 'none');
  });

  it('each capture problem has its own message naming the device', () => {
    const silent = captureProblemMessage('micSilent', 'Microphone Array (Realtek(R) Audio)')!;
    assert.match(silent, /Microphone Array \(Realtek\(R\) Audio\)/);
    assert.match(silent, /exactly 0/);
    const msgs = ['micSilent', 'trackMuted', 'trackEnded', 'audioStalled'].map((r) => captureProblemMessage(r, 'X'));
    assert.equal(new Set(msgs).size, 4);
    for (const m of msgs) assert.ok(m!.startsWith('Microphone'), 'cleared by the next good recording');
    assert.equal(captureProblemMessage('silence', 'X'), null);
  });
});

describe('Microphone start-up, cleanup and consecutive turns', () => {
  it('permission denied is reported as MIC_DENIED', async () => {
    await assert.rejects(fakeMic(() => undefined, false, { deny: 'NotAllowedError' }), (e: unknown) => e instanceof RecorderMicError && e.code === 'MIC_DENIED');
  });
  it('no microphone is MIC_NOT_FOUND; a busy one is MIC_BUSY', async () => {
    await assert.rejects(fakeMic(() => undefined, false, { deny: 'NotFoundError' }), (e: unknown) => (e as RecorderMicError).code === 'MIC_NOT_FOUND');
    await assert.rejects(fakeMic(() => undefined, false, { deny: 'NotReadableError' }), (e: unknown) => (e as RecorderMicError).code === 'MIC_BUSY');
  });
  it('a stream without an audio track is rejected with its own message', async () => {
    await assert.rejects(fakeMic(() => undefined, false, { noTrack: true }), (e: unknown) => /no audio track/.test((e as Error).message));
  });
  it('an already-ended track is rejected (never recorded from)', async () => {
    await assert.rejects(fakeMic(() => undefined, false, { track: { readyState: 'ended' } }), (e: unknown) => (e as RecorderMicError).code === 'MIC_ERROR');
  });
  it('every ending releases the microphone, and the next turn starts cleanly', async () => {
    const speak = (feed: (x: number) => void) => {
      for (let i = 0; i < 10; i++) feed(0.002);
      for (let i = 0; i < 40; i++) feed(0.08);
      for (let i = 0; i < 80; i++) feed(0.002);
    };
    const first = await fakeMic(speak);
    const second = await fakeMic(speak);
    const cancelled = await fakeMic((feed) => feed(0.01));
    assert.deepEqual([first.result.reason, second.result.reason, cancelled.result.reason], ['silence', 'silence', 'cancelled']);
    assert.ok(first.track.stopped && second.track.stopped && cancelled.track.stopped);
    assert.equal(first.result.wav!.size, second.result.wav!.size, 'same audio, same upload');
  });
  it('the upload is a valid 16 kHz mono 16-bit PCM WAV that the backend accepts', async () => {
    const { result } = await fakeMic((feed) => {
      for (let i = 0; i < 10; i++) feed(0.002);
      for (let i = 0; i < 40; i++) feed(0.08);
      for (let i = 0; i < 80; i++) feed(0.002);
    });
    const v = new DataView(await result.wav!.arrayBuffer());
    const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    assert.deepEqual([tag(0), tag(8), tag(12), tag(36)], ['RIFF', 'WAVE', 'fmt ', 'data']);
    assert.deepEqual([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)], [1, 1, 16000, 16]);
    assert.equal(v.getUint32(40, true), result.wav!.size - 44);
    let peak = 0;
    for (let i = 44; i < result.wav!.size; i += 2) peak = Math.max(peak, Math.abs(v.getInt16(i, true)));
    // The fake signal flips sign every sample (the highest frequency), which the 3:1 block average
    // deliberately attenuates to a third; real speech is far below that frequency
    assert.ok(peak > 0.025 * 0x7fff, 'the signal survives encoding');
  });
});

/* ============================== speech continuity and response latency (simulated timing) ============================== */

import { speakableText, splitSpeech } from '../src/services/voice/speechChunks';
import { effectiveHoldMs, MAX_SILENT_HOLD_MS } from '../src/services/teaching/planPlayer';

/** Fake audio whose clips last `playMs`; records start / end times and overlap. */
function timedAudio(playMs: number, log: { starts: number[]; ends: number[]; texts: string[]; maxPlaying: number; playing: number }) {
  return (blob: Blob) => {
    const audio = {
      ended: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, pause() {},
      async play() {
        log.playing += 1;
        log.maxPlaying = Math.max(log.maxPlaying, log.playing);
        log.starts.push(Date.now());
        log.texts.push(await blob.text());
        setTimeout(() => { log.playing -= 1; log.ends.push(Date.now()); audio.ended = true; audio.onended?.(); }, playMs);
      },
    };
    return { audio: audio as AudioLike, release: () => {} };
  };
}
const newLog = () => ({ starts: [] as number[], ends: [] as number[], texts: [] as string[], maxPlaying: 0, playing: 0 });

describe('Speech continuity (simulated audio; not a provider measurement)', () => {
  it('no artificial silence between chunks whose audio is ready', async () => {
    const log = newLog();
    const gaps: NarrationGap[] = [];
    const clip = createChunkedClip('The sun gear is in the centre. It drives the planet gears around it. The ring gear holds them in.', {
      synth: async (t) => new Blob([t]), makeAudio: timedAudio(30, log), tickMs: 2, onGap: (g) => gaps.push(g),
    });
    clip.play();
    assert.equal(await clip.done, 'ended');
    assert.ok(log.texts.length >= 2);
    for (let i = 1; i < log.starts.length; i++) assert.ok(log.starts[i] - log.ends[i - 1] < 25, `gap ${log.starts[i] - log.ends[i - 1]} ms`);
    const inside = gaps.filter((g) => !g.betweenSteps); // the first chunk's gap is from an earlier clip
    assert.ok(inside.length === log.texts.length - 1 && inside.every((g) => !g.waitedForAudio && g.gapMs < 25), JSON.stringify(gaps));
  });

  it('chunks play in order and never overlap, even when later audio is ready first', async () => {
    const log = newLog();
    const delays = [40, 5, 5];
    let n = 0;
    const clip = createChunkedClip('Alpha sentence is the first one. Bravo sentence is the second one. Charlie sentence is the third one.', {
      synth: (t) => new Promise((r) => setTimeout(() => r(new Blob([t])), delays[n++] ?? 5)),
      makeAudio: timedAudio(10, log), tickMs: 2,
    });
    clip.play();
    assert.equal(await clip.done, 'ended');
    assert.equal(log.maxPlaying, 1);
    // "Bravo…" (under 40 characters) is merged with "Charlie…": two requests, in order
    assert.deepEqual(log.texts.map((t) => t.split(' ')[0]), ['Alpha', 'Bravo']);
    assert.match(log.texts[1], /Charlie/);
  });

  it('a gap caused by slow synthesis is reported as waiting for audio (where the time goes)', async () => {
    const log = newLog();
    const gaps: NarrationGap[] = [];
    let n = 0;
    const clip = createChunkedClip('Short first sentence here. A second sentence that is slow to synthesize.', {
      synth: (t) => new Promise((r) => setTimeout(() => r(new Blob([t])), n++ === 0 ? 1 : 80)),
      makeAudio: timedAudio(5, log), tickMs: 2, onGap: (g) => gaps.push(g),
    });
    clip.play();
    await clip.done;
    const inside = gaps.filter((g) => !g.betweenSteps);
    assert.equal(inside.length, 1);
    assert.ok(inside[0].waitedForAudio && inside[0].gapMs > 40, JSON.stringify(inside));
  });

  it('a failed chunk never leaves playback stuck: the next chunk still plays and the clip ends', async () => {
    const log = newLog();
    const errors: string[] = [];
    let n = 0;
    const clip = createChunkedClip('The first part of this answer works fine here. The second part of this answer fails to synthesize. The third part of this answer plays again.', {
      synth: (t) => (n++ === 1 ? Promise.reject(new Error('Gnani 502')) : Promise.resolve(new Blob([t]))),
      makeAudio: timedAudio(3, log), tickMs: 2, readingMs: () => 10, onError: (m) => errors.push(m),
    });
    clip.play();
    assert.equal(await clip.done, 'failed');
    assert.equal(log.texts.length, 2);
    assert.match(log.texts[1], /^The third/);
    assert.equal(errors.length, 1);
  });

  it('stop() while waiting for audio: nothing plays afterwards (no stale speech)', async () => {
    const log = newLog();
    const clip = createLiveClip({ synth: (t) => new Promise((r) => setTimeout(() => r(new Blob([t])), 30)), makeAudio: timedAudio(5, log), tickMs: 2 });
    clip.push('This sentence is still being synthesized.');
    clip.play();
    clip.stop();
    assert.equal(await clip.done, 'stopped');
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(log.texts.length, 0);
  });
});

describe('Speakable text: no punctuation that becomes a long hesitation', () => {
  it('ellipses and spaced dashes become a comma pause; words and hyphenated terms are kept', () => {
    assert.equal(speakableText('First... we need to understand the concept.'), 'First, we need to understand the concept.');
    assert.equal(speakableText('The sun gear — the centre one — drives it.'), 'The sun gear, the centre one, drives it.');
    assert.equal(speakableText('Wait… then it turns.'), 'Wait, then it turns.');
    assert.equal(speakableText('A low-speed, high-torque output.'), 'A low-speed, high-torque output.');
    assert.equal(speakableText('సన్ గేర్... మధ్యలో ఉంటుంది.'), 'సన్ గేర్, మధ్యలో ఉంటుంది.');
  });
  it('chunks stay sentence-sized, not word-sized', () => {
    const chunks = splitSpeech('The sun gear sits in the middle. It is driven by the input shaft. The planet gears roll around it. The carrier collects their motion and turns the output.');
    assert.ok(chunks.length >= 2 && chunks.length <= 4, `${chunks.length} chunks`);
    assert.ok(chunks.every((c) => c.split(' ').length >= 4), chunks.join(' | '));
  });
});

describe('Response pacing in the lesson player', () => {
  it('silent holds only while an animation plays, and short', () => {
    assert.equal(effectiveHoldMs({ holdMs: 3000, actions: [{ type: 'component.focus' }] }), 0);
    assert.equal(effectiveHoldMs({ holdMs: 3000, actions: [{ type: 'animation.play' }] }), MAX_SILENT_HOLD_MS);
    assert.equal(effectiveHoldMs({ holdMs: 800, actions: [{ type: 'animation.play' }] }), 800);
    assert.equal(effectiveHoldMs({ holdMs: 0, actions: [{ type: 'animation.play' }] }), 0);
  });
});

describe('Gap measurement covers one answer only', () => {
  it('after a new question, the wait for the first chunk is not reported as a pause', async () => {
    const log = newLog();
    const gaps: NarrationGap[] = [];
    const deps = { synth: async (t: string) => new Blob([t]), makeAudio: timedAudio(3, log), tickMs: 2, onGap: (g: NarrationGap) => gaps.push(g) };
    resetNarrationGapClock(); // the first question (as ask() does)
    const first = createChunkedClip('The first answer has one sentence here.', deps);
    first.play();
    await first.done;
    await new Promise((r) => setTimeout(r, 30)); // the learner speaks; transcription; the teacher writes
    resetNarrationGapClock();
    const second = createChunkedClip('The second answer starts after a new question.', deps);
    second.play();
    await second.done;
    assert.equal(gaps.length, 0, JSON.stringify(gaps));
  });
});

