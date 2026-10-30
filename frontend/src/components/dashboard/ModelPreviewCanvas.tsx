/**
 * ModelPreviewCanvas Component
 *
 * Renders an actual, live Three.js 3D geometry preview of a registered engineering model
 * directly inside catalogue cards and featured spotlights.
 * Safely disposes WebGL resources on unmount to prevent leaks.
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createStudioEnvironment } from '../scene/studioEnvironment';
import type { EngineeringModelDefinition } from '../../types/models';

export interface ModelPreviewCanvasProps {
  /** Registered engineering model definition to preview */
  model: EngineeringModelDefinition;
  /** Whether the model should slowly auto-rotate (defaults to true) */
  autoRotate?: boolean;
  /** Optional container CSS class */
  className?: string;
  /** Optional title for accessibility */
  ariaLabel?: string;
}

const checkWebGLSupport = (): boolean => {
  if (typeof window === 'undefined') return true;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
};

export const ModelPreviewCanvas: React.FC<ModelPreviewCanvasProps> = ({
  model,
  autoRotate = true,
  className = '',
  ariaLabel,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasWebGL] = useState<boolean>(() => checkWebGLSupport());
  // Start only when the preview is on screen (a model backed by an asset file, e.g. the eye, then
  // downloads it once; nothing heavy loads for cards that are never seen)
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(Boolean(model.loadsExternalAsset));
  const live = hasWebGL;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || typeof window === 'undefined' || !live || !visible) return undefined;

    let animationFrameId = 0;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    // Realistic studio light: reflections for metal, soft key light with a contact shadow
    const env = createStudioEnvironment(renderer);
    scene.environment = env;
    scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x2a2f38, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(4, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);

    const runtime = model.buildScene(scene);
    const root = runtime.rootGroup;
    const camera = new THREE.PerspectiveCamera(model.cameraConfig?.fov || 40, 1, 0.01, 200);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.32 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.receiveShadow = true;
    scene.add(shadow);

    const frame = () => {
      root.updateMatrixWorld(true);
      root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      root.position.sub(center);
      shadow.scale.setScalar(maxDim * 3);
      shadow.position.set(0, -size.y / 2 - maxDim * 0.002, 0);
      key.position.set(maxDim * 1.2, maxDim * 2.2, maxDim * 1.4);
      key.shadow.camera.left = key.shadow.camera.bottom = -maxDim * 1.5;
      key.shadow.camera.right = key.shadow.camera.top = maxDim * 1.5;
      key.shadow.camera.far = maxDim * 6;
      key.shadow.camera.updateProjectionMatrix();
      const distance = maxDim * 1.45;
      camera.near = maxDim / 100;
      camera.far = maxDim * 20;
      camera.position.set(distance * 0.72, distance * 0.48, distance * 0.92);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    };
    frame();
    void (runtime.ready ?? Promise.resolve()).then(() => {
      if (disposed) return;
      root.position.set(0, 0, 0);
      frame();
      setLoading(false);
    }, () => !disposed && setLoading(false));

    const resize = () => {
      const w = container.clientWidth || 300;
      const h = container.clientHeight || 200;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const animate = () => {
      if (autoRotate && !reduced) root.rotation.y += 0.004;
      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      runtime.dispose();
      shadow.geometry.dispose();
      (shadow.material as THREE.Material).dispose();
      env.dispose();
      renderer.dispose();
      scene.clear();
    };
  }, [model, autoRotate, live, visible]);

  return (
    <div
      ref={containerRef}
      className={`model-preview-container ${className}`}
      aria-label={ariaLabel || `3D model preview of ${model.name}`}
    >
      {live ? (
        <>
          <canvas ref={canvasRef} className="model-preview-canvas" />
          {loading && <span className="preview-loading">Loading 3D model…</span>}
        </>
      ) : (
        /* Honest fallback: this browser has no WebGL */
        <div className="preview-fallback-box">
          <span className="fallback-text">3D preview needs WebGL</span>
        </div>
      )}
    </div>
  );
};

export default ModelPreviewCanvas;
