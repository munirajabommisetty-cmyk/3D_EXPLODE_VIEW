import React, { useState } from 'react';
import { WorkspaceLayout } from './components/workspace/WorkspaceLayout';
import { useCamera } from './hooks/useCamera';
import type { ModuleStatus } from './types/app';
import type { GestureRecognitionResult } from './types/gestures';
import type { HandLandmarkResult } from './types/landmarks';
import { HomeDashboard } from './components/dashboard/HomeDashboard';
import { PLANETARY_GEARBOX_MODEL_ID } from './models/mechanical/planetaryGearboxModel';
import './App.css';

export type AppView = 'dashboard' | 'workspace';

export interface AppProps {
  /** Initial view to render (defaults to 'dashboard') */
  initialView?: AppView;
  /** Initial active model ID (defaults to 'planetary_gearbox') */
  initialModelId?: string;
}

const MODULES: ModuleStatus[] = [
  {
    id: 'frontend-foundation',
    name: 'Frontend Core (React + TypeScript + Vite)',
    phase: 'Phase 1 - Task 1.1',
    status: 'active',
    description: 'Vite build pipeline, typed architecture, and dark technical design system.',
  },
  {
    id: 'scene-viewport',
    name: '3D Mechanical Viewport (Three.js)',
    phase: 'Phase 1 - Task 1.2',
    status: 'active',
    description: 'WebGL renderer, PBR studio lighting, ground grid, and mouse OrbitControls.',
  },
  {
    id: 'mechanical-assembly',
    name: 'Planetary Gearbox Assembly',
    phase: 'Phase 1 - Task 1.3',
    status: 'active',
    description: 'Procedural mechanical assembly with sun gear, 3 planet gears, outer ring, and carrier plate.',
  },
  {
    id: 'camera-controls',
    name: 'Camera Controls & View Presets',
    phase: 'Phase 1 - Task 1.4',
    status: 'active',
    description: 'Modular OrbitControls with smooth damping, preset viewpoints (Isometric, Top, Front), and keyboard shortcuts.',
  },
  {
    id: 'camera-service',
    name: 'Camera Service & User Permission',
    phase: 'Phase 2 - Task 2.1',
    status: 'active',
    description: 'User-initiated webcam access, mirrored PiP preview, track lifecycle cleanup, and error handling.',
  },
  {
    id: 'hand-landmarks',
    name: 'MediaPipe Hand Landmarker',
    phase: 'Phase 2 - Task 2.2',
    status: 'active',
    description: 'Pretrained 21 3D hand landmark detection and real-time visual skeleton overlay.',
  },
  {
    id: 'gesture-controller',
    name: 'Geometric Gesture Recognition',
    phase: 'Phase 2 - Task 2.3',
    status: 'active',
    description: 'Scale-invariant geometric recognition of OPEN_PALM, POINTING, PINCH, and NONE with temporal hysteresis.',
  },
  {
    id: 'landmark-smoothing',
    name: 'Landmark Jitter Filter (One Euro)',
    phase: 'Phase 3 - Task 3.1',
    status: 'active',
    description: 'Adaptive One Euro Filter attenuating high-frequency hand tremors while preserving responsive tracking.',
  },
  {
    id: 'gesture-orbit',
    name: 'Open-Palm Orbit Navigation',
    phase: 'Phase 4 - Task 4.1',
    status: 'active',
    description: 'Continuous 3D orbit navigation mapping hand movement deltas to camera yaw and elevation with deadband and damping.',
  },
  {
    id: 'pinch-zoom',
    name: 'Pinch-to-Zoom Controller',
    phase: 'Phase 4 - Task 4.2',
    status: 'active',
    description: 'Dynamic thumb-to-index pinch distance delta mapping to camera zoom-in/out with deadband and clamp boundaries.',
  },
  {
    id: 'laser-cursor',
    name: 'Virtual Laser Pointer / Cursor',
    phase: 'Phase 4 - Task 4.3',
    status: 'active',
    description: 'Real-time index fingertip screen projection with cyan laser dot, pulsating halo, and unified circular dwell timer.',
  },
  {
    id: 'component-selection',
    name: 'Component Selection & Information HUD',
    phase: 'Phase 5 - Tasks 5.1-5.3',
    status: 'active',
    description: 'Screen-space raycasting, 1.2s dwell confirmation, emissive component highlighting, and technical specification HUD panel.',
  },
];

export const App: React.FC<AppProps> = ({
  initialView = 'dashboard',
  initialModelId = PLANETARY_GEARBOX_MODEL_ID,
}) => {
  const [currentView, setCurrentView] = useState<AppView>(initialView);
  const [activeModelId, setActiveModelId] = useState<string>(initialModelId);
  const [renderFps, setRenderFps] = useState<number>(60);
  const [showRoadmap, setShowRoadmap] = useState<boolean>(false);
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [activeGesture, setActiveGesture] = useState<GestureRecognitionResult | null>(null);
  const [detectedHands, setDetectedHands] = useState<HandLandmarkResult[]>([]);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);

  // Initialize camera service hook at the app root level
  const camera = useCamera();

  const handleLaunchModel = (modelId: string) => {
    setActiveModelId(modelId);
    setSelectedComponentId(null);
    setCurrentView('workspace');
  };

  const handleNavigateHome = () => {
    if (camera.status === 'active') {
      camera.stopCamera();
    }
    setCurrentView('dashboard');
  };

  if (currentView === 'dashboard') {
    return (
      <HomeDashboard
        onLaunchModel={handleLaunchModel}
      />
    );
  }

  return (
    <WorkspaceLayout
      activeModelId={activeModelId}
      onNavigateHome={handleNavigateHome}
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
      modules={MODULES}
    />
  );
};

export default App;

