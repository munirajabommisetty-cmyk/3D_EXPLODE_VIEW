/**
 * VoiceDock (Phase 11, Task V2) — push-to-talk voice control for the 3D workspace.
 *
 * mic -> 16 kHz WAV -> /api/voice/transcribe (Gnani Prisma) -> phrase parser
 *     -> V1 SceneCommandDispatcher (source 'voice') -> caption (+ Gnani Timbre speech)
 *
 * Every turn has an id; Cancel bumps it, so late transcripts or replies from a cancelled turn
 * are ignored and never executed. Captions are always shown.
 *
 * Task V4: explanation questions (why / how / what if / explain) become teaching requests when the
 * server's teaching model is configured; the TeachingPanel plays the validated plan.
 *
 * Milestone A — language: "Auto-detect" (default) needs no language choice. Gnani Prisma has no
 * automatic language detection (verified in its STT v3 docs: language_code is required, the
 * response has no language field), so the first transcription uses the conversation language
 * (the last detected English / Telugu / Hindi one) and only if that transcript is not understood
 * is the same recording tried in the other two (Stage 1 rules: one understood, script-matching
 * result switches the language). Picking a language in the menu pins it (manual override: one
 * Prisma call, no switching), which is also how Bengali and the beta languages are used.
 * The detected language is used for captions, spoken replies, teaching and narration.
 *
 * Milestone B — latency: stage timings (voiceTiming), reply audio cache (ttsCache), and no LLM
 * call while the teaching model is known to be unavailable (llmAvailability).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineeringModelDefinition } from '../../types/models';
import type { SceneCommandDispatcher } from '../../services/commands/sceneCommandDispatcher';
import { captureProblemMessage } from '../../services/voice/captureMessages';
import { MicError, startRecording, type ActiveRecording, type RecordingStats } from '../../services/voice/recorder';
import {
  AUTO_STT_FALLBACK_CODES, getVoiceHealth, sendRecordingDiag, synthesize, transcribe, transcribeAuto, TRANSIENT_VOICE_ERRORS, VoiceServiceError,
  VOICE_ERROR_MESSAGES, type VoiceLanguage,
} from '../../services/voice/voiceClient';
import {
  confirmationCaption, handleVoiceTurn, lexiconFor, previewTurn, type VoiceTurnResult, type VoiceTurnStatus,
} from '../../services/voice/voiceSession';
import {
  autoTurnLanguage, interpretedLanguage, transcribeForMode, turnLanguage, type LanguageMode,
} from '../../services/voice/voiceLanguage';
import { canonicalPhrase, InterpretError, requestInterpretation } from '../../services/voice/interpretClient';
import { sharedLlmAvailability } from '../../services/teaching/llmAvailability';
import { voiceTiming } from '../../services/voice/voiceTiming';
import { replySpeechCache } from '../../services/voice/ttsCache';
import { getSceneSnapshot } from '../../services/scene/sceneSnapshot';
import { reply, replyLanguage } from '../../services/voice/voiceReplies';
import type { ParseOutcome } from '../../services/voice/phraseParser';
import { TeachingPanel } from './TeachingPanel';
import { useTeachingSession } from '../../services/teaching/teachingSession';
import { Icon, type IconName } from '../ui/Icon';
import { suggestedQuestions } from '../../services/teaching/tutorSuggestions';
import { buildFallbackQuiz, classifyTutorReply, isBareReply, TutorSession, type TutorAction, type TutorView } from '../../services/teaching/tutorSession';
import { evaluateAnswer } from '../../services/teaching/tutorClient';
import { TutorCard } from './TutorCard';
import './VoiceDock.css';

export interface VoiceDockProps {
  dispatcher: SceneCommandDispatcher;
  model: EngineeringModelDefinition | undefined;
  allModels: EngineeringModelDefinition[];
  /** Lets other panels (e.g. the inspector) ask the tutor something, as if it had been said. */
  askRef?: React.MutableRefObject<((text: string) => void) | null>;
  /** The selected part (mouse, assembly tree or point-and-hold gesture): the suggested questions use it. */
  selectedComponentId?: string | null;
}

/** Example requests shown when the dock is idle (in the conversation language). */
const EXAMPLES: Record<string, string[]> = {
  'en-IN': ['Explain this part', 'Why is it needed?', 'Show me the back', 'Zoom in'],
  'te-IN': ['ఈ పార్ట్ ని ఎక్స్ప్లెయిన్ చెయ్యి', 'ఇది ఎందుకు అవసరం?', 'వెనుక వైపు చూపించు', 'జూమ్ ఇన్'],
  'hi-IN': ['इसे एक्सप्लेन करो', 'इसकी जरूरत क्यों है?', 'पीछे से दिखाओ', 'ज़ूम इन करो'],
  // Bengali: only Prisma-verified commands (Stage 2)
  'bn-IN': ['এই অংশটা বুঝিয়ে বলো', 'জুম ইন করো', 'মডেলটা ঘোরাও', 'অংশগুলো আলাদা করো'],
};

type Phase = 'idle' | 'listening' | 'transcribing' | 'speaking';
type Chip = VoiceTurnStatus | 'error' | 'cancelled' | 'tutor' | null;

/** Used until /api/voice/health answers (same list as the backend). */
const FALLBACK_LANGUAGES: VoiceLanguage[] = [
  { code: 'en-IN', name: 'English', native: 'English', status: 'supported' },
  { code: 'te-IN', name: 'Telugu', native: 'తెలుగు', status: 'supported' },
  { code: 'hi-IN', name: 'Hindi', native: 'हिन्दी', status: 'supported' },
  { code: 'ta-IN', name: 'Tamil', native: 'தமிழ்', status: 'beta' },
  { code: 'kn-IN', name: 'Kannada', native: 'ಕನ್ನಡ', status: 'beta' },
  { code: 'ml-IN', name: 'Malayalam', native: 'മലയാളം', status: 'beta' },
  { code: 'bn-IN', name: 'Bengali', native: 'বাংলা', status: 'beta' },
  { code: 'mr-IN', name: 'Marathi', native: 'मराठी', status: 'beta' },
  { code: 'gu-IN', name: 'Gujarati', native: 'ગુજરાતી', status: 'beta' },
  { code: 'pa-IN', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', status: 'beta' },
];

const MIC_MESSAGES: Record<string, string> = {
  MIC_DENIED: 'Microphone access is blocked. Allow the microphone in the browser address bar, then try again.',
  MIC_NOT_FOUND: 'No microphone was found. Connect a microphone and try again.',
  MIC_BUSY: 'The microphone is being used by another application.',
  MIC_UNSUPPORTED: 'This browser cannot record audio. Use a recent Chrome or Edge.',
  MIC_ERROR: 'The microphone could not be started.',
};

const MUTED_WHILE_LISTENING = 'Microphone is muted by the system (Windows sound settings or the laptop mic key). Unmute it now and speak: I am still listening.';

const CHIP_LABEL: Record<NonNullable<Chip>, string> = {
  executed: 'Done', deferred: 'Waiting until you stop moving the view', rejected: 'Not done', needsInput: 'Need more info',
  answered: 'Answer', unavailable: 'Not available', teach: 'Explaining', control: 'Explanation',
  error: 'Error', cancelled: 'Cancelled', tutor: 'Tutor',
};
const CHIP_ICON: Record<NonNullable<Chip>, IconName> = {
  executed: 'check', deferred: 'clock', rejected: 'ban', needsInput: 'message',
  answered: 'info', unavailable: 'ban', teach: 'book', control: 'book',
  error: 'alert', cancelled: 'stop', tutor: 'cap',
};

function readStoredLanguage(): string {
  try {
    return localStorage.getItem('voice.language') || 'en-IN';
  } catch {
    return 'en-IN';
  }
}




export const VoiceDock: React.FC<VoiceDockProps> = ({ dispatcher, model, allModels, askRef, selectedComponentId }) => {
  const [languages, setLanguages] = useState<VoiceLanguage[]>(FALLBACK_LANGUAGES);
  // The conversation language: replies, teaching and speech use it. In auto mode it follows the
  // detected language of each request; in manual mode it is the pinned menu choice.
  const [language, setLanguage] = useState<string>(readStoredLanguage);
  // The spoken language is always detected (no language menu); only the dev hook can pin one
  const [languageMode, setLanguageMode] = useState<LanguageMode>('auto');
  const [phase, setPhase] = useState<Phase>('idle');
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState('');
  // Language of the request shown in "You asked" (from Prisma's detection, else the script)
  const [transcriptLang, setTranscriptLang] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [chip, setChip] = useState<Chip>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Task V5: every accepted request gets a spoken reply by default (the toggle can turn confirmations off)
  const [speakAll, setSpeakAll] = useState(true);
  // Compact by default (just the bar); opens by itself when there is something to show
  const [collapsed, setCollapsed] = useState(true);
  const [teachingAvailable, setTeachingAvailable] = useState(false);
  // Conversation memory for "it/that" (Task V3); Task V5: also set to the part an explanation is about
  const lastDiscussedRef = useRef<{ modelId: string; componentId: string } | null>(null);
  // Set when tapping the mic paused a playing explanation (resumed if nothing was said)
  const pausedByMicRef = useRef(false);
  // The part the conversation is about (shown as "Topic"), per model
  const [topic, setTopic] = useState<{ modelId: string; componentId: string } | null>(null);
  const teaching = useTeachingSession({
    dispatcher, model, language,
    onPlanStarted: (plan) => {
      if (plan.targetComponentId) {
        lastDiscussedRef.current = { modelId: plan.modelId, componentId: plan.targetComponentId };
        setTopic(lastDiscussedRef.current);
      }
    },
  });
  const teachingRef = useRef(teaching);
  useEffect(() => {
    teachingRef.current = teaching;
  });

  // Learning session after an explanation: understanding check, two-question quiz, summary
  const [tutor] = useState(() => new TutorSession({ evaluate: (req) => evaluateAnswer(req) }));
  const [tutorView, setTutorView] = useState<TutorView>(() => tutor.getView());
  useEffect(() => tutor.subscribe(setTutorView), [tutor]);
  // A different model starts a fresh learning session
  useEffect(() => {
    tutor.reset();
  }, [model?.id, tutor]);

  const turnRef = useRef(0);
  const recordingRef = useRef<ActiveRecording | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastOutcomeRef = useRef<{ turn: number; outcome: ParseOutcome } | null>(null);
  const latest = useRef({ language, languageMode, model, allModels, speakAll, teachingAvailable });
  useEffect(() => {
    latest.current = { language, languageMode, model, allModels, speakAll, teachingAvailable };
  });
  // Guards against a second recording starting while one is being set up (double tap, M + click)
  const startingRef = useRef(false);

  const languageInfo = languages.find((l) => l.code === language) ?? FALLBACK_LANGUAGES[0];

  // Backend / key status (checked once when the dock opens)
  useEffect(() => {
    const controller = new AbortController();
    getVoiceHealth(controller.signal).then(
      (health) => {
        if (health.languages?.length) setLanguages(health.languages);
        setNotice(health.keyConfigured ? null : VOICE_ERROR_MESSAGES.KEY_MISSING!);
        setTeachingAvailable(Boolean(health.teaching?.configured));
      },
      (err) => {
        if ((err as VoiceServiceError).code === 'CANCELLED') return;
        setNotice(err instanceof VoiceServiceError ? err.message : VOICE_ERROR_MESSAGES.BACKEND_UNAVAILABLE!);
      }
    );
    return () => controller.abort();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('voice.language', language);
      localStorage.setItem('voice.languageMode', languageMode);
    } catch {
      // storage unavailable: language just isn't remembered
    }
  }, [language, languageMode]);

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      URL.revokeObjectURL(audioRef.current.src);
      audioRef.current = null;
    }
  }, []);

  /** Speaks a reply with Gnani Timbre. Failures keep the caption and add a short note. */
  const speak = useCallback(async (text: string, turn: number, language?: string) => {
    // App replies exist in en/te/hi/bn; for other detected languages the reply text is English, so
    // it is spoken by the English voice (never English text read by a Tamil voice, for example)
    const lang = replyLanguage(language ?? latest.current.language);
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    try {
      // Short replies repeat word for word: reuse their audio (exact text + language key). A newer
      // turn never plays it (turn check below), so a shared request is not aborted.
      const cached = replySpeechCache.has(text, lang);
      if (!cached) {
        voiceTiming.mark('ttsStart', turn);
        voiceTiming.count('tts', turn);
      }
      const blob = replySpeechCache.cacheable(text)
        ? await replySpeechCache.get(text, lang, () => synthesize(text, lang))
        : await synthesize(text, lang, signal);
      if (turn !== turnRef.current) return;
      stopPlayback();
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      setPhase('speaking');
      audio.onended = () => {
        if (audioRef.current === audio) stopPlayback();
        if (turn === turnRef.current) setPhase('idle');
      };
      await audio.play().then(
        () => voiceTiming.mark('firstAudio', turn),
        () => {
          if (turn === turnRef.current) setPhase('idle');
        }
      );
    } catch (err) {
      if (turn !== turnRef.current || (err as VoiceServiceError).code === 'CANCELLED') return;
      setNotice(`Spoken reply unavailable: ${(err as Error).message}`);
      setPhase('idle');
    }
  }, [stopPlayback]);

  /** Applies the result of one understood turn: captions, teaching, controls, speech. */
  const applyResult = useCallback((result: VoiceTurnResult, turn: number, lang: string, m: EngineeringModelDefinition) => {
    const session = teachingRef.current;
    lastOutcomeRef.current = { turn, outcome: result.outcome };
    if (result.discussedComponentId) {
      lastDiscussedRef.current = { modelId: m.id, componentId: result.discussedComponentId };
      setTopic(lastDiscussedRef.current);
    }
    setCaption(result.caption);
    setChip(result.status);
    setCollapsed(false); // show the reply
    voiceTiming.mark('captionShown', turn);
    if (result.status === 'teach' && result.teach) {
      // An explicit "in Telugu" wins; otherwise the answer uses the language of this request.
      // In manual mode the explicit request is answered but the pinned language stays.
      const teachLang = result.teach.language ?? lang;
      if (teachLang !== latest.current.language && latest.current.languageMode === 'auto') setLanguage(teachLang);
      voiceTiming.note('teach', teachLang);
      void session.ask({ ...result.teach, language: teachLang });
    }
    if (result.status === 'control') {
      if (result.control === 'pause') session.player.pause(reply('teachPaused', lang));
      else if (result.control === 'resume') {
        if (session.player.getState().status === 'waitingForUser') session.player.continue();
        else session.player.resume();
      } else session.supersede('Explanation stopped.');
    }
    // Clarifications / unrecognised speech are not new requests: a paused explanation stays
    // paused, so the user can answer the question or say "continue".
    // The turn is understood: leave "Understanding…" now (speak() shows "Speaking…" once audio plays)
    setPhase('idle');
    if (result.speak) void speak(result.caption, turn, lang);
  }, [speak]);

  /** Shows and speaks what the tutor says; "explain again" goes back to the teacher with the history. */
  const applyTutorAction = useCallback((action: TutorAction, turn: number, lang: string): boolean => {
    if (action.kind === 'pass') return false;
    if (action.kind === 'stale' || turn !== turnRef.current) return true;
    setCollapsed(false);
    setPhase('idle');
    if (action.kind === 'clarify') {
      // Not spoken: the clearer explanation starts at once (no two voices at the same time)
      setCaption(action.text);
      setChip('teach');
      // The learner's own words when they say what was unclear ("I didn't understand the
      // relationship between these parts"), so that is what gets explained; else the whole idea again
      void teachingRef.current.ask({
        question: action.question ?? 'Explain that again more simply, step by step, with an everyday example.',
        questionType: 'explain', targetComponentId: action.targetComponentId, language: lang,
      });
      return true;
    }
    setCaption(action.text);
    setChip('tutor');
    void speak(action.text, turn, lang);
    return true;
  }, [speak]);

  /**
   * Runs one turn from a transcript (microphone path and dev hook). `spokenLanguage` is the
   * language the audio was understood in; typed text is judged by its script.
   */
  const runTranscript = useCallback(async (text: string, turn: number, spokenLanguage?: string) => {
    const { language: uiLang, languageMode: mode, model: m, allModels: all, speakAll: sayAll } = latest.current;
    // Typed / asked text: auto mode judges the script; a pinned language is kept
    const lang = spokenLanguage ?? (mode === 'auto' ? turnLanguage(text, uiLang) : uiLang);
    // The conversation continues in the language of the latest request
    if (lang !== uiLang) setLanguage(lang);
    setTranscript(text);
    setTranscriptLang(text.trim() ? lang : null);
    if (!m) {
      setCaption(reply('VIEWER_NOT_READY', lang));
      setChip('rejected');
      setPhase('idle');
      return;
    }
    if (!text.trim()) {
      // Task V5: empty transcript -> ask to repeat (never an empty AI request); a paused explanation resumes
      if (pausedByMicRef.current) {
        pausedByMicRef.current = false;
        teachingRef.current.player.resume();
      }
      setCaption(reply('emptyTranscript', lang));
      setChip('needsInput');
      void speak(reply('emptyTranscript', lang), turn, lang);
      return;
    }
    const session = teachingRef.current;
    pausedByMicRef.current = false;
    // An open learning session hears the reply first (yes / explain again / skip / a quiz answer);
    // anything else falls through and is handled as a normal request
    if (tutor.isOpen()) {
      const preview = previewTurn({ transcript: text, dispatcher, model: m, allModels: all, lastDiscussed: lastDiscussedRef.current, teachingActive: session.isActive() });
      const sceneCommand = preview.kind === 'commands' && !['select', 'focus', 'related', 'ask'].includes(preview.intent);
      // Naming a different part ("what does the ring gear do?") is a new question, not a reply
      const newTopic = preview.kind === 'question' && preview.via === 'explicit' && Boolean(preview.partId)
        && preview.partId !== tutor.targetComponentId;
      const action = await tutor.handle(text, lang, { sceneCommand, newTopic });
      if (applyTutorAction(action, turn, lang)) return;
    }
    const turnInput = {
      language: lang, dispatcher, model: m, allModels: all, speakConfirmations: sayAll,
      lastDiscussed: lastDiscussedRef.current,
      // Task V5: explanation questions always go to the teaching session, which answers with the
      // AI teacher or, if that is unavailable, from the model data (never silently nothing)
      teachingAvailable: true,
      teachingActive: session.isActive(),
      onSupersede: () => session.supersede('Replaced by your new request.'),
    };
    const first = previewTurn({ ...turnInput, transcript: text });
    voiceTiming.mark('parsed', turn);
    if (first.kind !== 'noMatch') {
      // Known commands and questions are handled locally: no LLM interpretation call
      applyResult(handleVoiceTurn({ ...turnInput, transcript: text }), turn, lang, m);
      return;
    }
    // A lone "yes" / "అవును" / "हाँ" with no question waiting: it was heard correctly, so say what
    // to do next (locally, in the same language) instead of "not understood" or an LLM call
    if (isBareReply(text) && !session.isActive()) {
      applyResult({ status: 'needsInput', caption: reply('bareReply', lang), speak: true, outcome: { kind: 'noMatch' }, records: [] }, turn, lang, m);
      return;
    }
    // The LLM is known to be unavailable (quota used up / not configured): say "not understood"
    // at once instead of waiting for another failing request
    if (!sharedLlmAvailability.isAvailable()) {
      voiceTiming.note('interpretSkipped');
      applyResult(handleVoiceTurn({ ...turnInput, transcript: text }), turn, lang, m);
      return;
    }

    // Not understood by the deterministic parser: ask the LLM for ONE intent from a fixed list,
    // then run the matching canonical phrase through the same parser and validated dispatcher.
    setPhase('transcribing');
    setCaption(reply('interpreting', lang));
    setChip(null);
    const scene = getSceneSnapshot(dispatcher, m, { lastDiscussed: lastDiscussedRef.current });
    const lexicon = lexiconFor(m);
    voiceTiming.mark('interpretStart', turn);
    voiceTiming.count('interpret', turn);
    try {
      const i = await requestInterpretation({
        transcript: text.slice(0, 300), language: lang, modelId: m.id, modelName: m.name,
        components: lexicon.map((e) => ({ id: e.componentId, name: e.displayName })),
        topicComponentId: scene.selectedComponentId
          ?? (scene.lastDiscussedComponentId.status === 'known' ? scene.lastDiscussedComponentId.value : null),
        teachingActive: session.isActive(),
      });
      voiceTiming.mark('interpretEnd', turn);
      sharedLlmAvailability.reportSuccess();
      if (turn !== turnRef.current || latest.current.model?.id !== m.id) return; // stale: a newer turn or model
      const phrase = canonicalPhrase(i, (id) => lexicon.find((e) => e.componentId === id)?.displayName ?? null);
      // Stage 1: the LLM's language guess only switches within en/te/hi when the script agrees
      // (auto mode only; a pinned language is kept)
      const answerLang = mode === 'auto' ? interpretedLanguage(i.language, text, lang) : lang;
      if (answerLang !== latest.current.language) setLanguage(answerLang);
      if (i.intent === 'general_question') {
        // A learning question the parser could not place: the teacher answers the learner's own words
        session.supersede('Replaced by your new request.');
        const partId = i.componentId && lexicon.some((e) => e.componentId === i.componentId) ? i.componentId : null;
        applyResult({
          status: 'teach', caption: reply('teachThinking', answerLang), speak: false, records: [],
          outcome: { kind: 'question', question: 'explain', open: true, ...(partId ? { partId } : {}) },
          ...(partId ? { discussedComponentId: partId } : {}),
          teach: { question: text.trim(), questionType: 'general', targetComponentId: partId },
        }, turn, answerLang, m);
        return;
      }
      if (!phrase) {
        const key = i.intent === 'unsupported' ? 'unsupportedRequest' : 'noMatch';
        applyResult({ status: 'rejected', caption: reply(key, answerLang, { model: m.name }), speak: true, outcome: { kind: 'noMatch' }, records: [] }, turn, answerLang, m);
        return;
      }
      applyResult(handleVoiceTurn({ ...turnInput, language: answerLang, transcript: phrase, questionText: text }), turn, answerLang, m);
    } catch (err) {
      voiceTiming.mark('interpretEnd', turn);
      sharedLlmAvailability.report((err as InterpretError).code);
      if (turn !== turnRef.current) return;
      // Interpretation unavailable (quota, network…): say clearly that it was not understood
      applyResult(handleVoiceTurn({ ...turnInput, transcript: text }), turn, lang, m);
    }
  }, [dispatcher, speak, applyResult, tutor, applyTutorAction]);

  /** Runs one turn from recorded audio (shared by the microphone path and the dev hook). */
  const runAudio = useCallback(async (wav: Blob, turn: number, stats?: RecordingStats) => {
    setPhase('transcribing');
    setTranscript('');
    setCaption('');
    setChip(null);
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    try {
      const m = latest.current.model;
      const understood = (t: string) => Boolean(m) && (
        previewTurn({
          transcript: t, dispatcher, model: m!, allModels: latest.current.allModels,
          lastDiscussed: lastDiscussedRef.current, teachingActive: teachingRef.current.isActive(),
        }).kind !== 'noMatch'
        // A reply to the tutor ("yes, quiz me", "skip", a quiz answer) is understood as it is:
        // no extra Prisma calls in other languages for it
        || (tutor.isOpen() && !['unclear', 'question'].includes(classifyTutorReply(t, tutor.getView().stage)))
      );
      const { language: current, languageMode: mode } = latest.current;
      const sttCall = (w: Blob, l: string, sg?: AbortSignal) => {
        voiceTiming.count('stt', turn);
        return transcribe(w, l, sg);
      };
      voiceTiming.mark('sttStart', turn);
      let heard: { text: string; language: string };
      let outcome: string;
      if (mode === 'auto') {
        try {
          // One Prisma v3.0 request: it detects the language (English, Telugu, Hindi, code-mixed…)
          voiceTiming.count('stt', turn);
          const keyterms = m ? lexiconFor(m).map((e) => e.displayName) : [];
          const r = await transcribeAuto(wav, keyterms, signal, undefined, stats ? { ...stats } : undefined);
          // No detection (e.g. only part names were said): judge by script, else keep the conversation language
          heard = { text: r.text, language: autoTurnLanguage(r.language, r.text, current) };
          outcome = r.language ? 'detected' : 'undetected';
        } catch (autoErr) {
          if (!AUTO_STT_FALLBACK_CODES.includes((autoErr as VoiceServiceError).code)) throw autoErr;
          // Prisma v3.0 refused the request: the previous method (Prisma v2.5, retried per language)
          const res = await transcribeForMode(wav, 'auto', current, sttCall, understood, signal);
          heard = res.result;
          outcome = res.outcome;
        }
      } else {
        const res = await transcribeForMode(wav, mode, current, sttCall, understood, signal);
        heard = res.result;
        outcome = res.outcome;
      }
      voiceTiming.mark('transcript', turn);
      voiceTiming.note(outcome, heard.language);
      if (turn !== turnRef.current) return; // cancelled while waiting: never execute stale speech
      setNotice(null);
      if (outcome === 'ambiguous') {
        // Two languages understood the same recording: ask, rather than guess (no LLM call)
        const lang = heard.language;
        setTranscript(heard.text);
        setTranscriptLang(null); // two languages fitted: no language claimed
        setCaption(reply('languageUnclear', lang));
        setChip('needsInput');
        setPhase('idle');
        void speak(reply('languageUnclear', lang), turn, lang);
        return;
      }
      if (!heard.text.trim() && stats?.vadOnsetMs != null) {
        // Speech was detected in the recording but Prisma returned no words: say exactly that (not
        // the generic "didn't catch that", which is for recordings with nothing in them)
        if (pausedByMicRef.current) {
          pausedByMicRef.current = false;
          teachingRef.current.player.resume();
        }
        const lang = latest.current.language;
        setCaption(reply('heardNoWords', lang));
        setChip('needsInput');
        setPhase('idle');
        void speak(reply('heardNoWords', lang), turn, lang);
        return;
      }
      await runTranscript(heard.text, turn, heard.language);
    } catch (err) {
      if (turn !== turnRef.current || (err as VoiceServiceError).code === 'CANCELLED' || (err as Error).name === 'AbortError') return;
      const code = (err as VoiceServiceError).code;
      if (TRANSIENT_VOICE_ERRORS.includes(code)) {
        // Gnani / network trouble: a short message in the conversation language; the detail (which
        // service, which status, never a key) goes to the notice line. The next turn works normally.
        const lang = latest.current.language;
        setCaption(reply(code === 'TIMEOUT' || code === 'GNANI_TIMEOUT' ? 'serviceSlow' : 'serviceBusy', lang));
        setNotice((err as Error).message);
        console.warn('[voice] speech recognition failed', { code, turn });
      } else {
        setCaption((err as Error).message);
      }
      setChip('error');
      setPhase('idle');
      if (['BACKEND_UNAVAILABLE', 'KEY_MISSING', 'GNANI_AUTH', 'GNANI_FORBIDDEN', 'GNANI_NO_TRANSCRIPT'].includes((err as VoiceServiceError).code)) {
        setNotice((err as Error).message);
      }
    }
  }, [dispatcher, runTranscript, speak, tutor]);

  // An explanation finished: the tutor asks whether it made sense (once per topic)
  const offeredPlanRef = useRef<string | null>(null);
  useEffect(() => {
    const st = teaching.state;
    const plan = st.plan;
    if (st.status !== 'finished' || !plan || offeredPlanRef.current === plan.planId) return;
    offeredPlanRef.current = plan.planId;
    const m = latest.current.model;
    if (!m || m.id !== plan.modelId) return;
    const lang = plan.language ?? latest.current.language;
    const action = tutor.explanationFinished(
      { modelId: plan.modelId, title: plan.title, targetComponentId: plan.targetComponentId, quiz: plan.quiz },
      buildFallbackQuiz(m, plan.targetComponentId, lang), lang
    );
    if (action) applyTutorAction(action, turnRef.current, lang);
  }, [teaching.state, tutor, applyTutorAction]);

  /** Tutor buttons: the same transitions as saying "yes" / "explain again" / "skip". */
  const onTutorChoice = useCallback((choice: 'yes' | 'clarify' | 'skip' | 'close') => {
    if (choice === 'close') {
      tutor.reset();
      return;
    }
    const turn = ++turnRef.current;
    abortRef.current?.abort();
    stopPlayback();
    const lang = latest.current.language;
    void tutor.choose(choice, lang).then((action) => applyTutorAction(action, turn, lang));
  }, [tutor, applyTutorAction, stopPlayback]);

  // Deferred voice commands report later (executed when the hand stops, or expired)
  useEffect(() => {
    return dispatcher.subscribe((rec) => {
      if (rec.source !== 'voice' || (rec.status !== 'executed' && rec.status !== 'expired')) return;
      const last = lastOutcomeRef.current;
      const { language: lang, model: m } = latest.current;
      if (!last || last.turn !== turnRef.current || !m) return;
      if (rec.status === 'expired') {
        setCaption(reply('expired', lang));
        setChip('rejected');
      } else {
        setCaption((prev) => (prev === reply('deferred', lang) ? confirmationCaption(last.outcome, lang, m) : prev));
        setChip((prev) => (prev === 'deferred' ? 'executed' : prev));
      }
    });
  }, [dispatcher]);

  const cancel = useCallback(() => {
    turnRef.current += 1;
    recordingRef.current?.cancel();
    recordingRef.current = null;
    abortRef.current?.abort();
    stopPlayback();
    pausedByMicRef.current = false;
    teachingRef.current.supersede('Explanation stopped.');
    setPhase('idle');
    setLevel(0);
    setCaption('Stopped.');
    setChip('cancelled');
  }, [stopPlayback]);

  const startListening = useCallback(async () => {
    if (startingRef.current) return; // a recording is already being started
    startingRef.current = true;
    const turn = ++turnRef.current;
    voiceTiming.begin(turn);
    voiceTiming.mark('recordStart', turn);
    recordingRef.current?.cancel(); // never two recordings at once
    recordingRef.current = null;
    abortRef.current?.abort();
    stopPlayback();
    // Never record the narration: speaking to the dock pauses a running explanation at once
    // (the new request then replaces it, controls it, or — if nothing was said — it resumes)
    const playing = teachingRef.current.player.getState().status;
    if (playing === 'running' || playing === 'waitingForUser') {
      teachingRef.current.player.pause('Listening…');
      pausedByMicRef.current = true;
    }
    setTranscript('');
    setCaption('');
    setChip(null);
    // A previous microphone problem is cleared as the new attempt starts (a muted track reports
    // itself again during startRecording)
    setNotice((n) => (n && n.startsWith('Microphone') ? null : n));
    try {
      let rec: ActiveRecording;
      try {
        rec = await startRecording((l) => setLevel(Math.min(1, l * 8)), (muted) => {
          // Live: the system muted the microphone. Still listening; unmuting continues the turn
          if (turn !== turnRef.current) return;
          setNotice(muted ? MUTED_WHILE_LISTENING : null);
        });
      } finally {
        startingRef.current = false;
      }
      if (turn !== turnRef.current) {
        rec.cancel();
        return;
      }
      recordingRef.current = rec;
      setPhase('listening');
      const result = await rec.done;
      voiceTiming.mark('recordEnd', turn);
      recordingRef.current = null;
      setLevel(0);
      if (turn !== turnRef.current) return;
      if (!result.wav) {
        setPhase('idle');
        if (pausedByMicRef.current) {
          pausedByMicRef.current = false;
          teachingRef.current.player.resume(); // nothing said: continue the explanation
        }
        // Not sent to Prisma: its metadata still goes to the diagnostics log (numbers only)
        if (result.stats && result.reason !== 'cancelled') sendRecordingDiag({ ...result.stats });
        const problem = captureProblemMessage(result.reason, result.capture?.deviceLabel ?? 'the microphone');
        if (result.reason === 'nospeech') {
          setCaption("I didn't hear anything. Tap the mic and speak.");
          setChip('rejected');
        } else if (problem) {
          // A capture fault, named by what was measured (never "say it again"); no Prisma call
          setCaption(problem);
          setNotice(problem);
          setChip('error');
        }
        return;
      }
      await runAudio(result.wav, turn, result.stats);
    } catch (err) {
      setPhase('idle');
      setChip('error');
      const code = err instanceof MicError ? err.code : 'MIC_ERROR';
      // A start-up fault names its exact step (no audio track / audio engine), else the standard text
      const message = code === 'MIC_ERROR' && err instanceof MicError ? err.message : MIC_MESSAGES[code];
      setCaption(message);
      setNotice(message);
    }
  }, [runAudio, stopPlayback]);

  const onMic = useCallback(() => {
    if (phase === 'listening') {
      recordingRef.current?.stop();
      return;
    }
    if (phase === 'transcribing') return;
    void startListening(); // also interrupts a spoken reply
  }, [phase, startListening]);

  // Development-only hook for verification without a microphone
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voiceDock?: unknown };
    w.__voiceDock = {
      say: (text: string) => {
        const turn = ++turnRef.current;
        voiceTiming.begin(turn);
        return runTranscript(text, turn);
      },
      // Behaves like a mic turn: a playing explanation pauses at once while the audio is transcribed
      submitAudio: (wav: Blob) => {
        const playing = teachingRef.current.player.getState().status;
        if (playing === 'running' || playing === 'waitingForUser') {
          teachingRef.current.player.pause('Listening…');
          pausedByMicRef.current = true;
        }
        const turn = ++turnRef.current;
        voiceTiming.begin(turn);
        voiceTiming.mark('recordEnd', turn);
        return runAudio(wav, turn);
      },
      setLanguage: (code: string) => {
        if (code === 'auto') setLanguageMode('auto');
        else {
          setLanguageMode('manual');
          setLanguage(code);
        }
      },
      timings: () => voiceTiming.recent(),
      // Task V4: inspect teaching, or play a hand-written plan through the same validation + player
      teaching: () => ({ ...teachingRef.current.state, pending: teachingRef.current.pending, error: teachingRef.current.error }),
      playPlan: (raw: unknown, question?: string) => teachingRef.current.playRaw(raw, question),
      teachingAvailable: () => latest.current.teachingAvailable,
    };
    return () => {
      delete w.__voiceDock;
    };
  }, [runTranscript, runAudio]);

  /**
   * Asks the tutor a typed / clicked question: the same path as speech after transcription (same
   * parser, dispatcher, teacher and Timbre voice), keeping the conversation language. A new
   * question replaces the previous turn: its spoken reply stops and its pending request is
   * abandoned, so two answers never overlap.
   */
  const askText = useCallback((text: string) => {
    if (recordingRef.current || startingRef.current) return; // the microphone turn wins
    setCollapsed(false);
    const turn = ++turnRef.current;
    abortRef.current?.abort();
    stopPlayback();
    voiceTiming.begin(turn);
    void runTranscript(text, turn, latest.current.language);
  }, [runTranscript, stopPlayback]);

  // Other panels can ask the tutor (same path as speech; keeps the current conversation language)
  useEffect(() => {
    if (!askRef) return;
    askRef.current = askText;
    return () => {
      askRef.current = null;
    };
  }, [askRef, askText]);

  // Keyboard: "M" starts / stops listening (not while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (e.ctrlKey || e.metaKey || e.altKey || tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        onMic();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onMic]);

  // Stop everything if the dock unmounts (leaving the workspace)
  useEffect(() => () => {
    turnRef.current += 1;
    recordingRef.current?.cancel();
    abortRef.current?.abort();
    stopPlayback();
  }, [stopPlayback]);

  const busy = phase !== 'idle' || teaching.pending;
  // The part questions are about: the current selection, else the conversation topic
  const selectedName = selectedComponentId && model ? model.getComponentMetadata(selectedComponentId)?.name ?? null : null;
  const topicPartName = topic && model && topic.modelId === model.id ? model.getComponentMetadata(topic.componentId)?.name ?? null : null;
  const suggestions = language === 'en-IN' ? suggestedQuestions(selectedName ?? topicPartName) : null;
  const teachStatus = teaching.state.status;
  const explaining = teachStatus === 'running' || teachStatus === 'paused' || teachStatus === 'waitingForUser';
  const teachDone = !teaching.pending && (teachStatus === 'finished' || teachStatus === 'cancelled' || teachStatus === 'failed');
  // One clear agent state, always with a text/icon label (never colour alone)
  const agentState: { key: string; icon: IconName; text: string } =
    phase === 'listening' ? { key: 'listening', icon: 'mic', text: 'Listening… I stop when you stop' }
      : phase === 'transcribing' ? { key: 'processing', icon: 'loader', text: 'Understanding…' }
        : teaching.pending ? { key: 'processing', icon: 'loader', text: 'Preparing the explanation…' }
          : tutorView.stage === 'evaluating' ? { key: 'processing', icon: 'loader', text: 'Checking your answer…' }
          : teachStatus === 'paused' ? { key: 'interrupted', icon: 'pause', text: 'Explanation paused — say “continue” or ask something else' }
            : teachStatus === 'waitingForUser' ? { key: 'interrupted', icon: 'clock', text: 'Waiting — say “continue” when ready' }
              : teachStatus === 'running' ? { key: 'speaking', icon: 'speaker', text: `Explaining — step ${teaching.state.stepPosition + 1} of ${teaching.state.stepCount}` }
                : phase === 'speaking' ? { key: 'speaking', icon: 'speaker', text: 'Speaking…' }
                : tutorView.stage === 'quiz' ? { key: 'idle', icon: 'mic', text: `Question ${tutorView.questionIndex + 1} of 2 — tap the mic (or press M) and answer` }
                : tutorView.stage === 'checking' ? { key: 'idle', icon: 'mic', text: 'Did that make sense? Tap the mic (or press M) and say yes, explain again, or skip' }
                  : chip === 'error' ? { key: 'error', icon: 'alert', text: 'Something went wrong — see below' }
                    : teachDone && teachStatus === 'finished' ? { key: 'done', icon: 'check', text: 'Explanation complete — ask a follow-up' }
                      : selectedName
                        ? { key: 'idle', icon: 'mic', text: `${selectedName} selected — tap the mic (or press M) and ask about it` }
                        : { key: 'idle', icon: 'mic', text: 'Tap the mic (or press M) and ask' };
  const topicName = topic && model && topic.modelId === model.id
    ? lexiconFor(model).find((e) => e.componentId === topic.componentId)?.displayName ?? null
    : null;
  const examples = EXAMPLES[language] ?? EXAMPLES['en-IN'];

  // UI pass: the orb shows what the tutor is doing (listening waves follow the microphone level;
  // speaking waves while a reply or explanation is spoken; a spinning ring while it thinks)
  const orbMode = phase === 'listening' ? 'listening'
    : phase === 'transcribing' || teaching.pending ? 'thinking'
      : phase === 'speaking' || teachStatus === 'running' ? 'speaking'
        : 'idle';
  // No language menu: Prisma detects the spoken language; this only shows what it heard last
  const languageSelect = (
    <span className="voice-lang-auto" title="Speak in any language: it is detected automatically" aria-label={`Language: detected automatically (now ${languageInfo.name})`}>
      <Icon name="message" size={12} /> {languageInfo.native}
    </span>
  );

  return (
    <section className={`voice-dock state-${agentState.key} orb-${orbMode} ${collapsed ? 'collapsed' : ''}`} aria-label="Voice tutor">
      {/* Conversation panel: opens upward above the bar */}
      {!collapsed && (
        <div className="voice-dock-body">
          <div className="voice-panel-head">
            <span className="voice-title"><Icon name="cap" size={15} /> Voice tutor</span>
            {languageSelect}
          </div>
          {languageInfo.status === 'beta' && (
            <div className="voice-beta">
              {languageInfo.code === 'bn-IN'
                ? 'Bengali (beta): explanations and short replies in Bengali; only some spoken commands are understood.'
                : `${languageInfo.name} (beta): explanations are in ${languageInfo.name}; short replies and commands use English.`}
            </div>
          )}
          {notice && <div className="voice-notice" role="alert">{notice}</div>}
          {topicName && <div className="voice-topic"><span>Topic</span>{topicName}</div>}
          <TutorCard view={tutorView} onChoice={onTutorChoice} busy={busy} />
          {!teaching.pending && !explaining && tutorView.stage === 'idle' && !(teachDone && (teaching.plan?.followUpSuggestions.length ?? 0) > 0) && (
            <div className="voice-examples" aria-label="Things you can ask">
              <span>{transcript || caption ? 'Ask next — say it or click' : 'Try saying (or click)'}</span>
              {(suggestions ?? examples).map((ex) => (
                <button type="button" key={ex} className="voice-suggestion" onClick={() => askText(ex)} disabled={busy}>
                  {ex}
                </button>
              ))}
            </div>
          )}
          {transcript && (
            <div className="voice-transcript voice-bubble-user" key={`t-${transcript}`}><span className="bubble-role">You asked{transcriptLang ? ` · ${FALLBACK_LANGUAGES.find((l) => l.code === transcriptLang)?.name ?? transcriptLang}` : ''}</span>“{transcript}”</div>
          )}
          {/* While an explanation plays, the step panel below is the answer: no stale "Preparing…" bubble */}
          {(caption || chip) && !(chip === 'teach' && explaining) && (
            <div className={`voice-caption voice-bubble-tutor chip-${chip ?? 'none'}`} aria-live="polite" key={`c-${caption}-${chip}`}>
              {/* A finished explanation no longer says "Preparing…": the line shows how it ended */}
              {chip && (
                <span className="voice-chip">
                  <Icon name={chip === 'teach' && teachDone ? 'check' : CHIP_ICON[chip]} size={12} />
                  {chip === 'teach' && teachDone ? 'Explained' : CHIP_LABEL[chip]}
                </span>
              )}
              <span>{chip === 'teach' && teachDone ? (teachStatus === 'finished' ? 'The explanation is complete. Ask a follow-up question.' : 'The explanation was stopped.') : caption}</span>
            </div>
          )}
          <TeachingPanel
            session={teaching}
            language={language}
            nameOf={(id) => model?.getComponentMetadata(id)?.name}
            onAsk={askText}
            askDisabled={busy}
          />
          <label className="voice-toggle">
            <input type="checkbox" checked={speakAll} onChange={(e) => setSpeakAll(e.target.checked)} />
            Speak every reply (otherwise only problems are spoken)
          </label>
        </div>
      )}

      {/* Always-visible bar: orb + state + controls */}
      <div className="voice-dock-row">
        <button
          type="button"
          className={`voice-mic voice-orb phase-${phase}`}
          onClick={onMic}
          disabled={phase === 'transcribing'}
          aria-label={phase === 'listening' ? 'Stop listening' : 'Speak to the tutor'}
          aria-keyshortcuts="M"
          title={phase === 'listening' ? 'Stop listening (M)' : 'Speak to the tutor (M)'}
          style={{ ['--voice-level' as string]: level.toFixed(2) }}
        >
          <span className="orb-ring orb-ring-1" aria-hidden="true" />
          <span className="orb-ring orb-ring-2" aria-hidden="true" />
          {orbMode === 'listening' || orbMode === 'speaking' ? (
            <span className="orb-wave" aria-hidden="true">
              {[0.45, 0.75, 1, 0.8, 0.55].map((k, i) => (
                <i key={i} style={{ ['--k' as string]: k, ['--i' as string]: i }} />
              ))}
            </span>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          )}
        </button>

        <div className="voice-dock-main">
          <div className="voice-status" aria-live="polite">
            <span className="voice-state-icon" aria-hidden="true"><Icon name={agentState.icon} size={14} /></span> {agentState.text}
          </div>

        </div>

        {(busy || explaining) && (
          <button type="button" className="voice-cancel" onClick={cancel} aria-label="Stop listening, speech and explanation" title="Stop">
            <Icon name="stop" size={14} />
          </button>
        )}
        <button type="button" className="voice-collapse" onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand voice panel' : 'Collapse voice panel'} aria-expanded={!collapsed}>
          <Icon name={collapsed ? 'chevronUp' : 'chevronDown'} size={16} />
        </button>
      </div>
    </section>
  );
};

export default VoiceDock;
