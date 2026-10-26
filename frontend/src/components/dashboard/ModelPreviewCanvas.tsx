/**
 * ModelPreviewCanvas Component
 *
 * Renders an actual, live Three.js 3D geometry preview of a registered engineering model
 * directly inside catalogue cards and featured spotlights.
 * Safely disposes WebGL resources on unmount to prevent leaks.
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
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

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || typeof window === 'undefined' || !hasWebGL) return;

    let animationFrameId: number;
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let modelInstance: { rootGroup: THREE.Group; dispose: () => void } | null = null;

    try {
      scene = new THREE.Scene();

      // Studio Lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
      scene.add(ambientLight);

      const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
      mainLight.position.set(5, 10, 7);
      scene.add(mainLight);

      const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.45);
      fillLight.position.set(-5, -2, -5);
      scene.add(fillLight);

      // Build model runtime scene
      modelInstance = model.buildScene(scene);
      scene.add(modelInstance.rootGroup);

      // Center geometry at origin
      const box = new THREE.Box3().setFromObject(modelInstance.rootGroup);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      modelInstance.rootGroup.position.sub(center);

      // Camera Setup
      const width = container.clientWidth || 300;
      const height = container.clientHeight || 200;
      const fov = model.cameraConfig?.fov || 42;
      const camera = new THREE.PerspectiveCamera(fov, width / height, 0.1, 100);

      // Position camera at a balanced perspective angle
      const distance = maxDim * 1.55;
      camera.position.set(distance * 0.72, distance * 0.52, distance * 0.92);
      camera.lookAt(0, 0, 0);

      // WebGL Renderer with transparency
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);

      // Animation Loop
      const animate = () => {
        if (autoRotate && modelInstance) {
          modelInstance.rootGroup.rotation.y += 0.005;
        }
        if (renderer && scene) {
          renderer.render(scene, camera);
        }
        animationFrameId = requestAnimationFrame(animate);
      };

      animate();

      // Responsive Resize Handling
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const newWidth = entry.contentRect.width;
          const newHeight = entry.contentRect.height;
          if (newWidth > 0 && newHeight > 0 && renderer) {
            camera.aspect = newWidth / newHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(newWidth, newHeight, false);
          }
        }
      });
      resizeObserver.observe(container);

      return () => {
        cancelAnimationFrame(animationFrameId);
        resizeObserver.disconnect();
        if (modelInstance) {
          modelInstance.dispose();
        }
        if (renderer) {
          renderer.dispose();
        }
        if (scene) {
          scene.clear();
        }
      };
    } catch {
      return () => {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
      };
    }
  }, [model, autoRotate, hasWebGL]);

  return (
    <div
      ref={containerRef}
      className={`model-preview-container ${className}`}
      aria-label={ariaLabel || `3D model preview of ${model.name}`}
    >
      {hasWebGL ? (
        <canvas ref={canvasRef} className="model-preview-canvas" />
      ) : (
        /* Honest fallback when WebGL context cannot be created */
        <div className="preview-fallback-box">
          <span className="fallback-icon" aria-hidden="true">
            {model.domain === 'civil' ? '🌉' : '⚙️'}
          </span>
          <span className="fallback-text">3D Geometry Preview</span>
        </div>
      )}
      <div className="preview-ambient-glow" aria-hidden="true" />
    </div>
  );
};

export default ModelPreviewCanvas;
