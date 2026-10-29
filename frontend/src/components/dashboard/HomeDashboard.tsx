/**
 * Model catalogue: every learning module with a realistic live 3D preview, its domain, a short
 * description, what can be explored in it (from the model's own declared capabilities), and one
 * clear action. Domain tabs and search filter the list; empty results are said plainly.
 */

import React, { useId, useState } from 'react';
import type { EngineeringModelDefinition } from '../../types/models';
import { modelRegistry } from '../../models/registry';
import { filterModels, getDomainCounts, type DomainFilterType } from '../../utils/dashboardUtils';
import { DOMAIN_LABEL, exploreHighlights } from '../site/moduleInfo';
import { ModelPreviewCanvas } from './ModelPreviewCanvas';
import './HomeDashboard.css';

export interface HomeDashboardProps {
  /** Optional custom model list (defaults to the catalogue models of the registry) */
  models?: EngineeringModelDefinition[];
  /** Opens a model in the 3D explorer */
  onLaunchModel: (modelId: string) => void;
  /** Initial domain filter ('all' | 'mechanical' | 'civil' | 'medical') */
  initialDomain?: DomainFilterType;
  /** Initial search query */
  initialSearchQuery?: string;
  /** Optional container class name */
  className?: string;
  /** Shown under the site header (kept for callers; the page always uses the site header now) */
  embedded?: boolean;
}

const TABS: { id: DomainFilterType; label: string }[] = [
  { id: 'all', label: 'All models' },
  { id: 'mechanical', label: 'Mechanical' },
  { id: 'civil', label: 'Civil' },
  { id: 'medical', label: 'Anatomy' },
];

const LEVEL: Record<string, string> = { Beginner: 'Beginner', Intermediate: 'Intermediate', Advanced: 'Advanced' };

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  models: propModels,
  onLaunchModel,
  initialDomain = 'all',
  initialSearchQuery = '',
  className = '',
}) => {
  const [domain, setDomain] = useState<DomainFilterType>(initialDomain);
  const [query, setQuery] = useState<string>(initialSearchQuery);
  const searchId = useId();
  const models = propModels ?? modelRegistry.getCatalogueModels();
  const counts = getDomainCounts(models);
  const shown = filterModels(models, domain, query);
  const count = (id: DomainFilterType) => (id === 'all' ? counts.all : counts[id as 'mechanical' | 'civil' | 'medical'] ?? 0);

  return (
    <div className={`catalogue ${className}`} role="region" aria-label="Model catalogue">
      <div className="catalogue-head">
        <div>
          <h1 className="catalogue-title">Model catalogue</h1>
          <p className="catalogue-lead">Choose a model to explore in 3D. Select parts, separate the assembly and ask the voice tutor about anything you see.</p>
        </div>
      </div>

      <div className="catalogue-toolbar" role="search" aria-label="Find a model">
        <div className="catalogue-tabs" role="tablist" aria-label="Filter by domain">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={domain === t.id}
              className={`catalogue-tab ${domain === t.id ? 'active' : ''}`}
              data-domain={t.id}
              onClick={() => setDomain(t.id)}
            >
              {t.label}
              <span className="catalogue-count">{count(t.id)}</span>
            </button>
          ))}
        </div>
        <div className="catalogue-search">
          <label htmlFor={searchId} className="visually-hidden">Search models</label>
          <span aria-hidden="true" className="catalogue-search-icon">⌕</span>
          <input
            id={searchId}
            type="search"
            placeholder="Search by name, part or topic"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {models.length === 0 ? (
        <div className="catalogue-empty">
          <h2>No models in the catalogue</h2>
          <p>No learning models are registered yet.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="catalogue-empty">
          <h2>No matching models</h2>
          <p>{query ? `Nothing matches “${query}”${domain !== 'all' ? ` in ${TABS.find((t) => t.id === domain)?.label}` : ''}.` : `There are no ${TABS.find((t) => t.id === domain)?.label} models yet.`}</p>
          <button type="button" className="catalogue-btn secondary" onClick={() => { setDomain('all'); setQuery(''); }}>Show all models</button>
        </div>
      ) : (
        <ul className="catalogue-grid" aria-label={`${shown.length} of ${models.length} models`}>
          {shown.map((m) => (
            <li key={m.id} className="catalogue-card">
              <button type="button" className="catalogue-preview" onClick={() => onLaunchModel(m.id)} aria-label={`Open ${m.name}`} tabIndex={-1}>
                <ModelPreviewCanvas model={m} ariaLabel={`3D preview of the ${m.name}`} />
              </button>
              <div className="catalogue-card-body">
                <div className="catalogue-card-meta">
                  <span className="catalogue-domain" data-domain={m.domain}>{DOMAIN_LABEL[m.domain] ?? m.domain}</span>
                  <span className="catalogue-level">{LEVEL[m.difficulty] ?? m.difficulty}</span>
                </div>
                <h2 className="catalogue-card-title">{m.name}</h2>
                <p className="catalogue-card-text">{m.description}</p>
                <ul className="catalogue-highlights" aria-label="What you can explore">
                  {exploreHighlights(m).map((h) => <li key={h}>{h}</li>)}
                </ul>
                <button type="button" className="catalogue-btn" onClick={() => onLaunchModel(m.id)}>
                  Open in 3D <span aria-hidden="true">→</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default HomeDashboard;
