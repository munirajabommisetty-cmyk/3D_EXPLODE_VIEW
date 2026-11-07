/**
 * The learning-session card in the voice tutor: understanding check, the current quiz question,
 * feedback on the last answer, and the summary. Buttons do exactly what saying the words does.
 */
import React from 'react';
import type { TutorView } from '../../services/teaching/tutorSession';
import { Icon } from '../ui/Icon';

export interface TutorCardProps {
  view: TutorView;
  onChoice: (choice: 'yes' | 'clarify' | 'skip' | 'close') => void;
  busy?: boolean;
}

export const TutorCard: React.FC<TutorCardProps> = ({ view, onChoice, busy }) => {
  if (view.stage === 'idle') return null;
  const feedback = view.feedback && (
    <div className={`tutor-feedback ${view.lastCorrect ? 'is-correct' : 'is-wrong'}`} role="status">
      <Icon name={view.lastCorrect ? 'check' : 'info'} size={14} />
      <span>{view.feedback}</span>
      {view.checkedBy === 'keywords' && <em className="tutor-source">Checked by key words (the AI checker is unavailable)</em>}
    </div>
  );

  return (
    <section className={`tutor-card stage-${view.stage}`} aria-label="Learning check">
      {view.stage === 'checking' && (
        <>
          <div className="tutor-head"><Icon name="cap" size={14} /> Check your understanding</div>
          <p className="tutor-text">Does that make sense? Would you like me to clarify any part?</p>
          <div className="tutor-actions">
            <button type="button" className="tutor-btn primary" onClick={() => onChoice('yes')} disabled={busy}>Yes, quiz me (2 questions)</button>
            <button type="button" className="tutor-btn" onClick={() => onChoice('clarify')} disabled={busy}>Explain again</button>
            <button type="button" className="tutor-btn" onClick={() => onChoice('skip')} disabled={busy}>Skip</button>
          </div>
        </>
      )}
      {(view.stage === 'quiz' || view.stage === 'evaluating') && (
        <>
          <div className="tutor-head">
            <Icon name="cap" size={14} /> Question {view.questionIndex + 1} of 2
            {view.attempt === 2 && <span className="tutor-attempt">second try</span>}
          </div>
          {feedback}
          <p className="tutor-question">{view.question}</p>
          {view.stage === 'evaluating'
            ? <p className="tutor-hint"><Icon name="loader" size={13} className="spin" /> Checking your answer…</p>
            : <p className="tutor-hint">Answer by voice: tap the mic or press M.</p>}
          <div className="tutor-actions">
            <button type="button" className="tutor-btn" onClick={() => onChoice('skip')} disabled={view.stage === 'evaluating'}>Skip quiz</button>
          </div>
        </>
      )}
      {view.stage === 'done' && (
        <>
          <div className="tutor-head"><Icon name="check" size={14} /> Learning check complete</div>
          {feedback}
          <ul className="tutor-results">
            {view.results.map((r, i) => (
              <li key={i} className={r.correct ? 'is-correct' : 'is-wrong'}>
                <Icon name={r.correct ? 'check' : 'info'} size={12} /> {r.question}
              </li>
            ))}
          </ul>
          {view.summary && <p className="tutor-text">{view.summary}</p>}
          <div className="tutor-actions">
            <button type="button" className="tutor-btn" onClick={() => onChoice('close')}>Close</button>
          </div>
        </>
      )}
    </section>
  );
};

export default TutorCard;
