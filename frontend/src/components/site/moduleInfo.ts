/** What each learning module offers (from the model's declared capabilities). */

import type { EngineeringModelDefinition } from '../../types/models';
import { getGuidedLessonForModel } from '../../data/guidedLessons';

export const DOMAIN_LABEL: Record<string, string> = { mechanical: 'Mechanical', civil: 'Civil', medical: 'Anatomy' };

/** What the learner can actually do with this model (from the model's declared capabilities). */
export function exploreHighlights(model: EngineeringModelDefinition): string[] {
  const out = [`${model.componentCount} parts to inspect`];
  out.push('Exploded view');
  if (model.cutaway) out.push(`${model.cutaway.label} view`);
  if ((model.animations ?? []).length) out.push('Animated motion');
  if (getGuidedLessonForModel(model.id)) out.push('Guided lesson');
  return out;
}
