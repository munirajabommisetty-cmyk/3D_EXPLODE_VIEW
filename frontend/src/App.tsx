import React, { useState } from 'react';
import { WorkspaceLayout } from './components/workspace/WorkspaceLayout';
import { useCamera } from './hooks/useCamera';
import type { GestureRecognitionResult } from './types/gestures';
import type { HandLandmarkResult } from './types/landmarks';
import { HomeDashboard } from './components/dashboard/HomeDashboard';
import { LandingPage } from './components/site/LandingPage';
import { SiteFooter, SiteHeader } from './components/site/SiteHeader';
import { modelRegistry } from './models/registry';
import { navigate, useRoute } from './services/router';
import { PLANETARY_GEARBOX_MODEL_ID } from './models/mechanical/planetaryGearboxModel';
import './App.css';

export type AppView = 'dashboard' | 'workspace';

export interface AppProps {
  /** Initial view to render (defaults to 'dashboard') */
  initialView?: AppView;
  /** Initial active model ID (defaults to 'planetary_gearbox') */
  initialModelId?: string;
}


/** The 3D explorer with its camera, gesture and selection state (one instance per opened model). */
const Explorer: React.FC<{ modelId: string; onNavigateHome: () => void; onSwitchModel: (id: string) => void }> = ({ modelId, onNavigateHome, onSwitchModel }) => {
  const [renderFps, setRenderFps] = useState<number>(60);
  const [showRoadmap, setShowRoadmap] = useState<boolean>(false);
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [activeGesture, setActiveGesture] = useState<GestureRecognitionResult | null>(null);
  const [detectedHands, setDetectedHands] = useState<HandLandmarkResult[]>([]);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  // The webcam belongs to the explorer: leaving it turns the camera off (useCamera cleans up on unmount)
  const camera = useCamera();


  return (
    <WorkspaceLayout
      activeModelId={modelId}
      onNavigateHome={() => {
        if (camera.status === 'active') camera.stopCamera();
        onNavigateHome();
      }}
      onSwitchModel={onSwitchModel}
      renderFps={renderFps}
      onFpsUpdate={setRenderFps}
      camera={camera}
      activeGesture={activeGesture}
      onGestureChange={setActiveGesture}
      detectedHands={detectedHands}
      onHandsDetected={setDetectedHands}
      selectedComponentId={selectedComponentId}
      onSelectComponent={setSelectedComponentId}
      showDiagnostics={showDiagnostics}
      onToggleDiagnostics={() => setShowDiagnostics((prev) => !prev)}
      showRoadmap={showRoadmap}
      onToggleRoadmap={() => setShowRoadmap((prev) => !prev)}
    />
  );
};

/** Model catalogue page: the existing catalogue (filters, search, honest empty states) under the site header. */
const CataloguePage: React.FC = () => (
  <div className="gl-page">
    <SiteHeader current="models" />
    <main id="main" tabIndex={-1}>
      <HomeDashboard embedded onLaunchModel={(id) => navigate(`#/explore/${id}`)} />
    </main>
    <SiteFooter />
  </div>
);

const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="gl-page">
    <SiteHeader />
    <main id="main" tabIndex={-1} className="gl-container" style={{ paddingTop: 'var(--gl-space-8)' }}>{children}</main>
  </div>
);

/** URL-routed application (see services/router.ts). */
const RoutedApp: React.FC = () => {
  const route = useRoute();

  switch (route.name) {
    case 'landing':
      return <LandingPage />;
    case 'models':
      return <CataloguePage />;
    case 'explore': {
      const model = route.param ? modelRegistry.getModel(route.param) : undefined;
      if (!model) {
        return (
          <Centered>
            <div className="gl-empty">
              <h2>This model is not available</h2>
              <p>The link may be out of date. Choose a model from the catalogue.</p>
              <a className="gl-btn gl-btn-primary" href="#/models">Browse models</a>
            </div>
          </Centered>
        );
      }
      return <Explorer key={model.id} modelId={model.id} onNavigateHome={() => navigate('#/models')} onSwitchModel={(id) => navigate(`#/explore/${id}`)} />;
    }
    default:
      return (
        <Centered>
          <div className="gl-empty">
            <h2>Page not found</h2>
            <p>The page you asked for does not exist.</p>
            <a className="gl-btn gl-btn-primary" href="#/">Go to the home page</a>
          </div>
        </Centered>
      );
  }
};

/**
 * With `initialView` (tests, embedded demos) the app shows that view directly, as before; otherwise
 * it follows the URL (landing, catalogue, explorer, account pages).
 */
export const App: React.FC<AppProps> = ({ initialView, initialModelId = PLANETARY_GEARBOX_MODEL_ID }) => {
  if (!initialView) return <RoutedApp />;
  return <FixedViewApp initialView={initialView} initialModelId={initialModelId} />;
};

const FixedViewApp: React.FC<Required<AppProps>> = ({ initialView, initialModelId }) => {
  const [currentView, setCurrentView] = useState<AppView>(initialView);
  const [activeModelId, setActiveModelId] = useState<string>(initialModelId);
  if (currentView === 'dashboard') {
    return <HomeDashboard onLaunchModel={(id) => { setActiveModelId(id); setCurrentView('workspace'); }} />;
  }
  return <Explorer key={activeModelId} modelId={activeModelId} onNavigateHome={() => setCurrentView('dashboard')} onSwitchModel={setActiveModelId} />;
};

export default App;
