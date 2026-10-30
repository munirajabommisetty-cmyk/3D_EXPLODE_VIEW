/** A learning-module card: name, domain, short description, what can be explored, open action. */

import React from 'react';
import type { EngineeringModelDefinition } from '../../types/models';
import { DOMAIN_LABEL, exploreHighlights } from './moduleInfo';

export const ModuleCard: React.FC<{ model: EngineeringModelDefinition; action?: string }> = ({ model, action = 'Open model' }) => (
  <article className="gl-card gl-module-card">
    <span className="gl-tag" data-domain={model.domain}>{DOMAIN_LABEL[model.domain] ?? model.domain}</span>
    <h3>{model.name}</h3>
    <p>{model.description.length > 170 ? `${model.description.slice(0, 167).trimEnd()}…` : model.description}</p>
    <div className="gl-module-meta">{exploreHighlights(model).join(' · ')}</div>
    <a className="gl-btn gl-btn-secondary" href={`#/explore/${model.id}`} aria-label={`${action}: ${model.name}`}>{action}</a>
  </article>
);
