/** Site header and footer for the home page and the model catalogue (no accounts: open to everyone). */

import React from 'react';
import type { RouteName } from '../../services/router';
import './site.css';

export const Brand: React.FC = () => (
  <a className="gl-brand" href="#/" aria-label="GestureLab home">
    <span className="gl-brand-mark" aria-hidden="true">G</span>
    GestureLab <small>CAD</small>
  </a>
);

export const SiteHeader: React.FC<{ current?: RouteName }> = ({ current }) => (
  <header className="gl-header">
    <a className="gl-skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
    <div className="gl-container gl-header-inner">
      <Brand />
      <nav className="gl-nav" aria-label="Main">
        <a href="#/" aria-current={current === 'landing' ? 'page' : undefined}>Home</a>
        <a href="#/models" aria-current={current === 'models' ? 'page' : undefined}>Models</a>
      </nav>
      <div className="gl-header-actions">
        <a className="gl-btn gl-btn-primary" href="#/models">Start exploring</a>
      </div>
    </div>
  </header>
);

export const SiteFooter: React.FC = () => (
  <footer className="gl-footer">
    <div className="gl-container">
      <span>GestureLab CAD: interactive 3D engineering learning</span>
      <span>Models are simplified for learning; they are not engineering simulations.</span>
    </div>
  </footer>
);
