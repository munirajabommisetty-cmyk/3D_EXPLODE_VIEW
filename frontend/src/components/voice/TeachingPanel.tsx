/**
 * Teaching panel (Task V4), shown inside the VoiceDock: question, plan title, synchronised step
 * caption + narration, claim type, progress, Pause / Resume / Continue / Stop, skipped-step notice,
 * errors and follow-up suggestions. The session logic lives in services/teaching/teachingSession.ts.
 */

import React from 'react';
import type { TeachingSession } from '../../services/teaching/teachingSession';
import { Icon } from '../ui/Icon';
import { shownComponentIds } from '../../services/teaching/tutorSuggestions';

/** Panel labels in the explanation's language (Milestone A); English for any other language. */
const LABELS: Record<string, Record<string, string>> = {
  'en-IN': {
    shown: 'Shown in the 3D model', separated: 'Parts separated',
    question: 'Question', preparing: 'Preparing an explanation…', step: 'Step', done: 'Done', ask: 'You could ask',
    pause: 'Pause', resume: 'Resume', cont: 'Continue', stop: 'Stop explanation',
    visible: 'Shown in the 3D model', metadata: 'From the model data', engineering: 'Engineering explanation', notSimulated: 'Not simulated in this app',
  },
  'te-IN': {
    shown: '3D model లో చూపిస్తున్నది', separated: 'భాగాలు విడదీసి',
    question: 'ప్రశ్న', preparing: 'వివరణ సిద్ధం చేస్తున్నాను…', step: 'దశ', done: 'పూర్తైంది', ask: 'మీరు అడగవచ్చు',
    pause: 'ఆపు', resume: 'కొనసాగించు', cont: 'కొనసాగించు', stop: 'వివరణ ఆపు',
    visible: '3D model లో చూపించినది', metadata: 'Model data నుంచి', engineering: 'Engineering వివరణ', notSimulated: 'ఈ app లో simulate కాదు',
  },
  'hi-IN': {
    shown: '3D model में दिखाया जा रहा है', separated: 'पुर्ज़े अलग किए गए',
    question: 'प्रश्न', preparing: 'समझाने की तैयारी हो रही है…', step: 'चरण', done: 'पूरा हुआ', ask: 'आप पूछ सकते हैं',
    pause: 'रोकें', resume: 'जारी रखें', cont: 'जारी रखें', stop: 'समझाना बंद करें',
    visible: '3D model में दिखाया गया', metadata: 'Model data से', engineering: 'Engineering व्याख्या', notSimulated: 'इस app में simulate नहीं',
  },
  'bn-IN': {
    shown: '3D model-এ দেখানো হচ্ছে', separated: 'অংশগুলো আলাদা',
    question: 'প্রশ্ন', preparing: 'ব্যাখ্যা তৈরি করছি…', step: 'ধাপ', done: 'শেষ', ask: 'আপনি জিজ্ঞেস করতে পারেন',
    pause: 'থামান', resume: 'আবার শুরু', cont: 'চালিয়ে যান', stop: 'ব্যাখ্যা বন্ধ করুন',
    visible: '3D model-এ দেখানো', metadata: 'Model data থেকে', engineering: 'Engineering ব্যাখ্যা', notSimulated: 'এই app-এ simulate হয় না',
  },
};

export interface TeachingPanelProps {
  session: TeachingSession;
  language?: string;
  /** Part names from the loaded model (for "Shown in the 3D model"); ids without a name are not shown. */
  nameOf?: (componentId: string) => string | undefined;
  /** Asks a follow-up through the same path as speaking it. Without it, follow-ups are plain text. */
  onAsk?: (text: string) => void;
  /** Follow-up buttons are disabled while the tutor is busy (no duplicate requests). */
  askDisabled?: boolean;
}

export const TeachingPanel: React.FC<TeachingPanelProps> = ({ session, language, nameOf, onAsk, askDisabled }) => {
  const { state, pending, error, notice, question, player } = session;
  const plan = state.plan;
  const L = LABELS[plan?.language ?? language ?? 'en-IN'] ?? LABELS['en-IN'];
  const active = player.isActive();
  if (!pending && !plan && !error && !notice) return null;
  const step = plan && state.stepPosition >= 0 ? plan.steps[state.stepPosition] : null;
  // What the current step shows in 3D, by part name (only parts of the loaded model)
  const stepActions = step?.actions ?? [];
  const shownNames = nameOf
    ? shownComponentIds(stepActions).map((id) => nameOf(id)).filter((n): n is string => Boolean(n))
    : [];
  const separated = stepActions.some((a) => a.type === 'assembly.explode');
  const progress = plan ? `${Math.max(0, state.stepPosition) + 1} / ${plan.steps.length}` : '';
  // Real step progress from the plan: done / current / upcoming (no invented percentages)
  const doneCount = !plan ? 0 : state.status === 'finished' ? plan.steps.length : Math.max(0, state.stepPosition);

  return (
    <div className="teach-panel" aria-label="Explanation">
      {question && <div className="teach-question"><span className="bubble-role">{L.question}</span>{question}</div>}
      {pending && <div className="teach-status" aria-live="polite"><Icon name="loader" size={14} className="spin" />{L.preparing}</div>}
      {plan && (
        <>
          <div className="teach-head">
            <strong className="teach-title">{plan.title}</strong>
            {(active || state.status === 'finished') && <span className="teach-progress">{state.status === 'finished' ? L.done : `${L.step} ${progress}`}</span>}
          </div>
          {plan.steps.length > 1 && (active || state.status === 'finished') && (
            <ol className="teach-steps" aria-label={`${L.step} ${progress}`}>
              {plan.steps.map((st, i) => (
                <li
                  key={i}
                  className={i < doneCount ? 'is-done' : i === state.stepPosition && active ? 'is-current' : ''}
                  title={st.caption}
                />
              ))}
            </ol>
          )}
          {notice && <div className="teach-limit">{notice}</div>}
          {plan.cannotAnswer && <div className="teach-limit">{plan.cannotAnswer}</div>}
          {step && active && (
            <div className="teach-step" aria-live="polite">
              <div className="teach-caption">{state.caption}</div>
              <div className="teach-narration">{state.narration}</div>
              <span className={`teach-claim claim-${step.claim}`}>{L[step.claim]}</span>
              {(shownNames.length > 0 || separated) && (
                <div className="teach-shown" aria-label={L.shown}>
                  <span className="teach-shown-label">{L.shown}</span>
                  {separated && <span className="teach-part-chip is-view">{L.separated}</span>}
                  {shownNames.map((n) => <span key={n} className="teach-part-chip">{n}</span>)}
                </div>
              )}
            </div>
          )}
          {state.status === 'finished' && <div className="teach-narration">{plan.explanation}</div>}
          {state.message && <div className="teach-message">{state.message}</div>}
          {(plan.rejectedSteps.length > 0 || state.runtimeRejected.length > 0) && (
            <div className="teach-rejected">
              {plan.rejectedSteps.length + state.runtimeRejected.length} step(s) skipped because they could not be shown safely on this model.
            </div>
          )}
          <div className="teach-controls">
            {state.status === 'running' && <button type="button" onClick={() => player.pause()}><Icon name="pause" size={13} />{L.pause}</button>}
            {state.status === 'paused' && <button type="button" onClick={() => player.resume()}><Icon name="play" size={13} />{L.resume}</button>}
            {state.status === 'waitingForUser' && <button type="button" onClick={() => player.continue()}><Icon name="play" size={13} />{L.cont}</button>}
            {active && <button type="button" className="teach-stop" onClick={() => player.cancel()}><Icon name="stop" size={13} />{L.stop}</button>}
          </div>
          {state.status === 'finished' && plan.followUpSuggestions.length > 0 && (
            <div className="teach-followups">
              <span>{L.ask}</span>
              {plan.followUpSuggestions.map((f) => (onAsk
                ? <button type="button" key={f} className="teach-followup-btn" onClick={() => onAsk(f)} disabled={askDisabled}>{f}</button>
                : <div key={f}>“{f}”</div>))}
            </div>
          )}
        </>
      )}
      {error && <div className="teach-error" role="alert"><Icon name="alert" size={14} />{error}</div>}
    </div>
  );
};
