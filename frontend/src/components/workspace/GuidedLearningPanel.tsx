/**
 * Guided Learning Panel Component
 * Phase 9 - Task 9.9: Exploded View & Guided Learning
 *
 * Provides an interactive, step-by-step educational tour overlaid in the CAD workspace.
 * Features keyboard navigation (ArrowLeft/ArrowRight/Escape), step indicators, and takeaways.
 */

import React, { useEffect, useCallback } from 'react';
import { Icon } from '../ui/Icon';
import type { GuidedLesson } from '../../data/guidedLessons';
import './GuidedLearningPanel.css';

export interface GuidedLearningPanelProps {
  lesson: GuidedLesson;
  currentStepIndex: number;
  onStepChange: (newStepIndex: number) => void;
  onExit: () => void;
  className?: string;
}

export const GuidedLearningPanel: React.FC<GuidedLearningPanelProps> = ({
  lesson,
  currentStepIndex,
  onStepChange,
  onExit,
  className = '',
}) => {
  const totalSteps = lesson.steps.length;
  const clampedIndex = Math.max(0, Math.min(totalSteps - 1, currentStepIndex));
  const currentStep = lesson.steps[clampedIndex];

  const handleNext = useCallback(() => {
    if (clampedIndex < totalSteps - 1) {
      onStepChange(clampedIndex + 1);
    } else {
      onExit();
    }
  }, [clampedIndex, totalSteps, onStepChange, onExit]);

  const handlePrev = useCallback(() => {
    if (clampedIndex > 0) {
      onStepChange(clampedIndex - 1);
    }
  }, [clampedIndex, onStepChange]);

  // Global keyboard shortcuts while lesson is open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onExit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrev, onExit]);

  if (!currentStep) return null;

  const progressPercent = ((clampedIndex + 1) / totalSteps) * 100;

  return (
    <section
      className={`guided-learning-panel ${className}`}
      aria-label={`Guided Tour: ${lesson.title}`}
      role="region"
    >
      {/* Header */}
      <header className="lesson-header">
        <div className="lesson-top-row">
          <div className="lesson-meta-badge">
            <span className="lesson-discipline-pill">
              {lesson.discipline === 'mechanical' ? 'Mechanical' : 'Civil'}
            </span>
            <span className="lesson-step-pill">
              Step {clampedIndex + 1} of {totalSteps}
            </span>
          </div>

          <button
            type="button"
            className="lesson-close-btn"
            onClick={onExit}
            title="Exit Guided Tour [Esc]"
            aria-label="Exit Guided Tour"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="lesson-title-bar">
          <h3 className="lesson-main-title">{lesson.title}</h3>
        </div>

        {/* Progress Bar */}
        <div
          className="lesson-progress-track"
          role="progressbar"
          aria-valuenow={clampedIndex + 1}
          aria-valuemin={1}
          aria-valuemax={totalSteps}
        >
          <div
            className="lesson-progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </header>

      {/* Body Content */}
      <div className="lesson-body">
        <div className="step-component-heading">
          <h4 className="step-target-name">{currentStep.title}</h4>
          <span className="step-component-id-badge">#{currentStep.componentId}</span>
        </div>

        <div className="step-subtitle">{currentStep.subtitle}</div>
        <p className="step-description">{currentStep.description}</p>

        {/* Key Educational Takeaways */}
        {currentStep.educationalNotes.length > 0 && (
          <div className="step-notes-box">
            <div className="step-notes-title">Educational Concepts</div>
            <ul className="step-notes-list">
              {currentStep.educationalNotes.map((note, idx) => (
                <li key={`step-note-${idx}`} className="step-note-item">
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <footer className="lesson-footer">
        {/* Step dots */}
        <div className="lesson-step-indicators" aria-label="Step Navigation">
          {lesson.steps.map((_, idx) => (
            <button
              key={`dot-${idx}`}
              type="button"
              className={`step-dot ${idx === clampedIndex ? 'active' : ''} ${
                idx < clampedIndex ? 'completed' : ''
              }`}
              onClick={() => onStepChange(idx)}
              title={`Jump to Step ${idx + 1}`}
              aria-label={`Jump to Step ${idx + 1}`}
              aria-current={idx === clampedIndex ? 'step' : undefined}
            />
          ))}
        </div>

        {/* Navigation Buttons */}
        <div className="lesson-nav-actions">
          <button
            type="button"
            className="lesson-nav-btn"
            onClick={handlePrev}
            disabled={clampedIndex === 0}
            aria-label="Previous Lesson Step"
          >
            <Icon name="chevronLeft" size={14} /> Previous
          </button>

          <button
            type="button"
            className="lesson-nav-btn primary"
            onClick={handleNext}
            aria-label={
              clampedIndex === totalSteps - 1 ? 'Finish Guided Tour' : 'Next Lesson Step'
            }
          >
            {clampedIndex === totalSteps - 1 ? <><Icon name="check" size={14} /> Finish Tour</> : <>Next <Icon name="chevronRight" size={14} /></>}
          </button>
        </div>
      </footer>
    </section>
  );
};

export default GuidedLearningPanel;
