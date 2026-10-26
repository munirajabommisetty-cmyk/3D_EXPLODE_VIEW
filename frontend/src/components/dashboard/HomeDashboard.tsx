/**
 * Interactive 3D Learning Platform — Home Dashboard & Model Catalogue
 *
 * Renders a visual-first educational discovery platform featuring real 3D model geometry previews,
 * clear learning tracks (Mechanical, Civil, Medical), interactive exploded-view showcases,
 * and seamless entry into the 3D learning workspace.
 */

import React, { useState, useId } from 'react';
import type { EngineeringModelDefinition } from '../../types/models';
import { modelRegistry } from '../../models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../../models/mechanical/planetaryGearboxModel';
import {
  filterModels,
  getDomainCounts,
  type DomainFilterType,
} from '../../utils/dashboardUtils';
import { ModelPreviewCanvas } from './ModelPreviewCanvas';
import './HomeDashboard.css';

export interface HomeDashboardProps {
  /** Optional custom model list to display (defaults to modelRegistry.getAllModels()) */
  models?: EngineeringModelDefinition[];
  /** Callback triggered when a user launches a model into the 3D workspace */
  onLaunchModel: (modelId: string) => void;
  /** Optional initial domain filter ('all' | 'mechanical' | 'civil' | 'medical') */
  initialDomain?: DomainFilterType;
  /** Optional initial search query */
  initialSearchQuery?: string;
  /** Optional container class name */
  className?: string;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  models: propModels,
  onLaunchModel,
  initialDomain = 'all',
  initialSearchQuery = '',
  className = '',
}) => {
  const [selectedDomain, setSelectedDomain] = useState<DomainFilterType>(initialDomain);
  const [searchQuery, setSearchQuery] = useState<string>(initialSearchQuery);
  const searchInputId = useId();

  // Resolve models from props or registry
  const models = propModels ?? modelRegistry.getAllModels();

  // Compute live domain counts
  const counts = getDomainCounts(models);

  // Filter models based on active domain and search query
  const filteredModels = filterModels(models, selectedDomain, searchQuery);

  // Domain-aware featured spotlight model
  const featuredModel =
    selectedDomain === 'all'
      ? models.find((m) => m.id === PLANETARY_GEARBOX_MODEL_ID) ?? models[0]
      : models.find((m) => m.domain === selectedDomain);

  const handleClearFilters = () => {
    setSelectedDomain('all');
    setSearchQuery('');
  };

  return (
    <div
      className={`engineering-dashboard ${className}`}
      role="region"
      aria-label="Engineering Explorer Dashboard"
    >
      {/* 1. Navigation & Brand Bar */}
      <header className="dashboard-header" role="banner">
        <div className="header-brand-container">
          <div className="brand-logo">
            <span className="brand-icon" aria-hidden="true">
              ⚙️
            </span>
            <div className="brand-text-group">
              <span className="brand-tagline-small">GestureLab CAD</span>
              <h1 className="brand-app-title">Engineering Explorer</h1>
            </div>
          </div>
          <p className="brand-description">
            Interactive 3D spatial exploration and technical learning platform for
            mechanical and civil engineering students. Discover complex physical systems,
            inspect individual parts, and separate assemblies in exploded 3D views.
          </p>
        </div>

        {/* Global Controls: Search & Domain Filters Bar */}
        <div className="dashboard-filter-bar" role="search" aria-label="Model discovery filters">
          {/* Domain Filter Buttons */}
          <nav
            className="domain-filter-group"
            role="tablist"
            aria-label="Filter models by engineering domain"
          >
            <button
              type="button"
              role="tab"
              aria-selected={selectedDomain === 'all'}
              className={`domain-tab-btn ${selectedDomain === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedDomain('all')}
            >
              All Domains
              <span className="count-pill">{counts.all}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={selectedDomain === 'mechanical'}
              className={`domain-tab-btn mechanical ${selectedDomain === 'mechanical' ? 'active' : ''}`}
              onClick={() => setSelectedDomain('mechanical')}
            >
              <span className="tab-icon" aria-hidden="true">
                ⚙️
              </span>
              Mechanical
              <span className="count-pill">{counts.mechanical}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={selectedDomain === 'civil'}
              className={`domain-tab-btn civil ${selectedDomain === 'civil' ? 'active' : ''}`}
              onClick={() => setSelectedDomain('civil')}
            >
              <span className="tab-icon" aria-hidden="true">
                🌉
              </span>
              Civil
              <span className="count-pill">{counts.civil}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={selectedDomain === 'medical'}
              className={`domain-tab-btn medical ${selectedDomain === 'medical' ? 'active' : ''}`}
              onClick={() => setSelectedDomain('medical')}
            >
              <span className="tab-icon" aria-hidden="true">
                🩺
              </span>
              Medical
              <span className="count-pill">{counts.medical}</span>
            </button>
          </nav>

          {/* Search Input Bar */}
          <div className="search-input-wrapper">
            <label htmlFor={searchInputId} className="visually-hidden">
              Search engineering models
            </label>
            <span className="search-leading-icon" aria-hidden="true">
              🔍
            </span>
            <input
              id={searchInputId}
              type="search"
              className="search-input"
              placeholder="Search by name, description, category, or tag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search engineering models"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
                title="Clear search query"
                aria-label="Clear search input"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 2. Main Visual Learning Content Area */}
      <main className="dashboard-content">
        {/* Learning Pillars Overview Banner */}
        <section className="learning-pillars-banner" aria-label="Key learning methods">
          <div className="pillar-item">
            <span className="pillar-icon" aria-hidden="true">
              🧩
            </span>
            <div className="pillar-text">
              <strong className="pillar-title">3D Component Inspection</strong>
              <span className="pillar-desc">
                Select parts to reveal their physical function, materials, and engineering roles.
              </span>
            </div>
          </div>
          <div className="pillar-divider" aria-hidden="true" />
          <div className="pillar-item">
            <span className="pillar-icon" aria-hidden="true">
              💥
            </span>
            <div className="pillar-text">
              <strong className="pillar-title">Exploded-View Disassembly</strong>
              <span className="pillar-desc">
                Separate nested mechanisms along kinematic axes to inspect internal structures.
              </span>
            </div>
          </div>
          <div className="pillar-divider" aria-hidden="true" />
          <div className="pillar-item">
            <span className="pillar-icon" aria-hidden="true">
              🖐
            </span>
            <div className="pillar-text">
              <strong className="pillar-title">Gesture &amp; Orbit Navigation</strong>
              <span className="pillar-desc">
                Rotate, pan, and laser-point using natural webcam hand tracking or mouse.
              </span>
            </div>
          </div>
        </section>

        {/* Featured Model 3D Spotlight Showcase */}
        {featuredModel && (!searchQuery || filteredModels.some((m) => m.id === featuredModel.id)) && (
          <section
            className="featured-spotlight-section"
            aria-labelledby="featured-spotlight-title"
          >
            <div className="featured-card">
              {/* Actual 3D Geometry Preview Visual Pane */}
              <div className="featured-visual-pane">
                <ModelPreviewCanvas
                  model={featuredModel}
                  autoRotate
                  className="featured-canvas-preview"
                  ariaLabel={`Live 3D preview of ${featuredModel.name}`}
                />
                <div className="visual-badge-overlay">
                  <span className="featured-star-pill">⭐ Featured Spotlight</span>
                  <span className={`domain-pill ${featuredModel.domain}`}>
                    {featuredModel.domain === 'mechanical'
                      ? '⚙️ Mechanical'
                      : featuredModel.domain === 'civil'
                      ? '🌉 Civil'
                      : '🩺 Medical'}
                  </span>
                </div>
              </div>

              {/* Informative Showcase Details */}
              <div className="featured-info-pane">
                <div className="featured-meta-header">
                  <span className="featured-category">{featuredModel.category}</span>
                  <span className="featured-difficulty-badge">
                    {featuredModel.difficulty}
                  </span>
                </div>

                <h2 id="featured-spotlight-title" className="featured-title">
                  {featuredModel.name}
                </h2>

                <p className="featured-description">{featuredModel.description}</p>

                {/* Key Learning Objectives */}
                <div className="learning-highlights-box">
                  <div className="learning-highlight-title">What You&apos;ll Learn</div>
                  <ul className="learning-bullets">
                    {featuredModel.domain === 'mechanical' ? (
                      <>
                        <li>Epicyclic gear ratio reduction and planetary carrier kinematics.</li>
                        <li>Coaxial torque transmission between sun gear, planets, and outer ring.</li>
                        <li>Step-by-step guided assembly and reversible exploded separation.</li>
                      </>
                    ) : (
                      <>
                        <li>Triangular Warren truss load redistribution across chords and diagonals.</li>
                        <li>Tension vs. compression member identification under live bridge deck load.</li>
                        <li>Structural gusset plate connections and multi-axis assembly separation.</li>
                      </>
                    )}
                  </ul>
                </div>

                <div className="featured-specs-summary">
                  <div className="spec-item">
                    <span className="spec-label">Discipline</span>
                    <span className="spec-value">
                      {featuredModel.domain === 'mechanical'
                        ? 'Mechanical Engineering'
                        : featuredModel.domain === 'civil'
                        ? 'Civil Engineering'
                        : 'Medical / Biomechanical'}
                    </span>
                  </div>
                  <div className="spec-item">
                    <span className="spec-label">Assembly Scale</span>
                    <span className="spec-value">
                      {featuredModel.componentCount} Components
                    </span>
                  </div>
                  <div className="spec-item">
                    <span className="spec-label">Interactive Modes</span>
                    <span className="spec-value">Kinematics, Exploded &amp; Tour</span>
                  </div>
                </div>

                <div className="featured-tags-row">
                  {featuredModel.tags.slice(0, 4).map((tag, idx) => (
                    <span key={`featured-tag-${idx}`} className="model-tag">
                      #{tag}
                    </span>
                  ))}
                </div>

                <div className="featured-action-row">
                  <button
                    type="button"
                    className="launch-workspace-cta-btn"
                    onClick={() => onLaunchModel(featuredModel.id)}
                    title={`Launch ${featuredModel.name} in CAD Workspace`}
                    aria-label={`Launch ${featuredModel.name} in 3D CAD Workspace`}
                  >
                    <span className="btn-icon" aria-hidden="true">
                      🚀
                    </span>
                    <span>Launch 3D Workspace</span>
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 3. Model Catalogue Section */}
        <section className="catalogue-section" aria-labelledby="catalogue-section-title">
          <div className="catalogue-section-header">
            <div className="section-title-group">
              <h2 id="catalogue-section-title" className="section-title">
                Engineering Model Catalogue
              </h2>
              <span className="section-count-badge">
                Showing {filteredModels.length} of {models.length} model
                {models.length === 1 ? '' : 's'}
              </span>
            </div>

            {(selectedDomain !== 'all' || searchQuery) && (
              <button
                type="button"
                className="reset-filters-btn"
                onClick={handleClearFilters}
                title="Reset all filters and search"
              >
                Reset Filters ✕
              </button>
            )}
          </div>

          {/* Model Cards Grid */}
          {filteredModels.length > 0 ? (
            <div className="model-cards-grid" role="list" aria-label="Model catalogue cards">
              {filteredModels.map((model) => (
                <article
                  key={model.id}
                  className="model-card"
                  role="listitem"
                  aria-label={`Engineering model card: ${model.name}`}
                >
                  {/* Real 3D Preview Thumbnail */}
                  <div className="card-visual-header">
                    <ModelPreviewCanvas
                      model={model}
                      autoRotate
                      className="card-preview-canvas"
                      ariaLabel={`3D preview of ${model.name}`}
                    />
                    <div className="card-top-badges">
                      <span className={`domain-pill ${model.domain}`}>
                        {model.domain === 'mechanical' ? '⚙️ Mechanical' : '🌉 Civil'}
                      </span>
                      <span className="card-difficulty" title={`Difficulty: ${model.difficulty}`}>
                        {model.difficulty}
                      </span>
                    </div>
                  </div>

                  <div className="card-content">
                    <span className="card-category">{model.category}</span>
                    <h3 className="card-title" title={model.name}>
                      {model.name}
                    </h3>
                    <p className="card-description">{model.description}</p>

                    {/* What learner explores */}
                    <div className="card-learning-points">
                      <span className="explore-label">Explore:</span>
                      <span className="explore-text">
                        {model.domain === 'mechanical'
                          ? 'Sun/planet gear meshing, coaxial reduction & carrier kinematics'
                          : 'Load distribution, tension/compression chords & bridge truss physics'}
                      </span>
                    </div>
                  </div>

                  <div className="card-meta-row">
                    <span className="card-component-count">
                      <span className="meta-icon" aria-hidden="true">
                        🧩
                      </span>
                      {model.componentCount} Components
                    </span>
                  </div>

                  {model.tags && model.tags.length > 0 && (
                    <div className="card-tags-list">
                      {model.tags.slice(0, 3).map((tag, idx) => (
                        <span key={`card-tag-${idx}`} className="card-tag">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="card-footer">
                    <button
                      type="button"
                      className="card-launch-btn"
                      onClick={() => onLaunchModel(model.id)}
                      title={`Open ${model.name} in CAD Workspace`}
                      aria-label={`Open ${model.name} in CAD Workspace`}
                    >
                      <span>Open in Workspace</span>
                      <span className="arrow-icon" aria-hidden="true">
                        →
                      </span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            /* 4. Honest & Reassuring Empty States */
            <div className="catalogue-empty-state" role="status">
              {selectedDomain === 'civil' && counts.civil === 0 ? (
                /* Honest Civil Engineering Empty State */
                <div className="empty-message-box civil-empty">
                  <span className="empty-state-icon" aria-hidden="true">
                    🌉
                  </span>
                  <h3 className="empty-state-title">No Civil Models Registered Yet</h3>
                  <p className="empty-state-text">
                    Civil engineering structural models (including the Warren Truss
                    Bridge and structural beam assemblies) will be introduced in an upcoming release.
                  </p>
                  <button
                    type="button"
                    className="empty-action-btn"
                    onClick={() => setSelectedDomain('all')}
                  >
                    View Available Mechanical Models
                  </button>
                </div>
              ) : selectedDomain === 'medical' && counts.medical === 0 ? (
                /* Honest Medical & Biomechanical Empty State */
                <div className="empty-message-box medical-empty">
                  <span className="empty-state-icon" aria-hidden="true">
                    🩺
                  </span>
                  <h3 className="empty-state-title">No Medical Models Registered Yet</h3>
                  <p className="empty-state-text">
                    Medical and biomechanical models (including prosthetic joints and musculoskeletal
                    kinematics) are currently in curriculum development for an upcoming release.
                  </p>
                  <button
                    type="button"
                    className="empty-action-btn"
                    onClick={() => setSelectedDomain('all')}
                  >
                    View Available Engineering Models
                  </button>
                </div>
              ) : searchQuery ? (
                /* No Search Results State */
                <div className="empty-message-box search-empty">
                  <span className="empty-state-icon" aria-hidden="true">
                    🔍
                  </span>
                  <h3 className="empty-state-title">No Matching Models Found</h3>
                  <p className="empty-state-text">
                    No engineering models matched your search query &quot;{searchQuery}&quot;
                    {selectedDomain !== 'all' ? ` in the ${selectedDomain} domain` : ''}.
                  </p>
                  <button
                    type="button"
                    className="empty-action-btn"
                    onClick={handleClearFilters}
                  >
                    Clear Search &amp; Filters
                  </button>
                </div>
              ) : (
                /* General Empty Registry State */
                <div className="empty-message-box general-empty">
                  <span className="empty-state-icon" aria-hidden="true">
                    🗃️
                  </span>
                  <h3 className="empty-state-title">No Models in Catalogue</h3>
                  <p className="empty-state-text">
                    The engineering model registry currently contains zero registered models.
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {/* 5. Dashboard Footer */}
      <footer className="dashboard-footer" role="contentinfo">
        <div className="footer-left">
          <span className="footer-brand">GestureLab CAD</span>
          <span className="footer-sep">•</span>
          <span className="footer-desc">Interactive 3D Learning Platform</span>
        </div>
        <div className="footer-right">
          <span className="footer-meta">
            {models.length} Registered Model{models.length === 1 ? '' : 's'}
          </span>
        </div>
      </footer>
    </div>
  );
};

export default HomeDashboard;
