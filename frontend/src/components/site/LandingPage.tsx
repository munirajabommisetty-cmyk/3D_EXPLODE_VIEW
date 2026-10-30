/**
 * Home page: what GestureLab is, the real learning modules, how the tutor, gestures and exploded
 * views help, and one clear way to start. Only real modules and real features are shown.
 */

import React from 'react';
import { Icon } from '../ui/Icon';
import { modelRegistry } from '../../models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../../models/mechanical/planetaryGearboxModel';
import { SiteFooter, SiteHeader } from './SiteHeader';
import { ModuleCard } from './ModuleCard';
import { CadHeroStage } from './CadHeroStage';

const FEATURES = [
  {
    icon: 'mic' as const,
    title: 'Ask the voice tutor',
    text: 'Ask about any part in English, Telugu, Hindi or Bengali. The tutor answers aloud while it shows the part.',
  },
  {
    icon: 'hand' as const,
    title: 'Explore with your hands',
    text: 'Turn on your webcam to orbit, zoom and point with gestures; bring both hands apart to separate the parts. Mouse and keyboard always work.',
  },
  {
    icon: 'explode' as const,
    title: 'See inside with exploded views',
    text: 'Models look like the real thing. Explode one and every part separates into a colour-coded, see-through view with labels.',
  },
];

export const LandingPage: React.FC = () => {
  const models = modelRegistry.getCatalogueModels();
  const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID) ?? models[0];

  return (
    <div className="gl-page">
      <SiteHeader current="landing" />
      <main id="main" tabIndex={-1}>
        <section className="gl-hero">
          <div className="gl-container gl-hero-grid">
            <div>
              <p className="gl-eyebrow">Interactive 3D engineering learning</p>
              <h1>Understand how things work by <em>taking them apart</em>.</h1>
              <p className="gl-hero-lead">
                Explore real machines, structures and anatomy in 3D. Select any part, separate the assembly, and ask the
                voice tutor why it is there and how it works.
              </p>
              <div className="gl-hero-actions">
                <a className="gl-btn gl-btn-primary gl-btn-lg" href="#/models">Explore the models</a>
                {gearbox && <a className="gl-btn gl-btn-secondary gl-btn-lg" href={`#/explore/${gearbox.id}`}>Open the gearbox</a>}
              </div>
              <p className="gl-hero-note">Free and open: no account or sign-in needed.</p>
            </div>
            {gearbox && <CadHeroStage model={gearbox} />}
          </div>
        </section>

        <section className="gl-section" aria-labelledby="modules-title">
          <div className="gl-container">
            <p className="gl-eyebrow">Learning modules</p>
            <h2 className="gl-section-title" id="modules-title">Start with a real system</h2>
            <p className="gl-section-lead">Each module is a 3D model you can rotate, take apart and question, part by part.</p>
            <div className="gl-grid-4">
              {models.map((m) => <ModuleCard key={m.id} model={m} />)}
            </div>
          </div>
        </section>

        <section className="gl-section" aria-labelledby="how-title">
          <div className="gl-container">
            <p className="gl-eyebrow">How it helps</p>
            <h2 className="gl-section-title" id="how-title">Difficult ideas become visible</h2>
            <p className="gl-section-lead">
              Seeing a part move, separate and connect to its neighbours makes its purpose clear. The tutor explains it
              in plain words, in your language.
            </p>
            <div className="gl-grid-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="gl-feature">
                  <span className="gl-feature-icon" aria-hidden="true"><Icon name={f.icon} size={20} /></span>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
};

export default LandingPage;
