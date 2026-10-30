/**
 * Home-page hero: the real planetary gearbox, separated along its axis like an exploded CAD
 * assembly, in realistic metal on a dark engineering grid, with transform-gizmo rings around it.
 * The side panels list the model's actual parts (from the model data), so nothing is invented.
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { EngineeringModelDefinition } from '../../types/models';
import { createStudioEnvironment } from '../scene/studioEnvironment';

const supportsWebGL = () => {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
};

export const CadHeroStage: React.FC<{ model: EngineeringModelDefinition }> = ({ model }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [webgl] = useState(() => (typeof window === 'undefined' ? false : supportsWebGL()));
  const parts = model.getAllComponentIds().map((id) => model.getComponentMetadata(id)?.name ?? id);
  const firstId = model.getAllComponentIds()[0];
  const first = firstId ? model.getComponentMetadata(firstId) : null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !webgl) return undefined;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.className = 'gl-cad-canvas';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const env = createStudioEnvironment(renderer);
    scene.environment = env;
    scene.add(new THREE.HemisphereLight(0xdbe8ff, 0x1a1f29, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 7, 5);
    scene.add(key);

    // Engineering grid floor
    const grid = new THREE.GridHelper(24, 36, 0x3b4658, 0x262e3b);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.75;
    scene.add(grid);

    const runtime = model.buildScene(scene);
    const root = runtime.rootGroup;
    runtime.setExplodedFactor?.(0.85);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) / 2 || 1;
    grid.position.y = box.min.y - radius * 0.15;
    grid.scale.setScalar(radius / 4);

    // Transform gizmo: three thin rings and axis arrows around the assembly
    const gizmo = new THREE.Group();
    const ring = (color: number, rot: [number, number, number], scale: number) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(radius * scale, radius * 0.008, 8, 128), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
      m.rotation.set(...rot);
      gizmo.add(m);
    };
    ring(0xef4444, [0, Math.PI / 2, 0], 0.92);
    ring(0x84cc16, [Math.PI / 2, 0, 0], 1.02);
    ring(0x38bdf8, [0, 0, 0], 1.12);
    const arrow = (dir: THREE.Vector3, color: number) => {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.05, radius * 0.14, 16), new THREE.MeshBasicMaterial({ color }));
      cone.position.copy(dir.clone().multiplyScalar(radius * 1.3));
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      gizmo.add(cone);
    };
    arrow(new THREE.Vector3(0, 1, 0), 0x84cc16);
    arrow(new THREE.Vector3(0, -1, 0), 0x84cc16);
    arrow(new THREE.Vector3(1, 0, 0), 0x38bdf8);
    gizmo.position.copy(center);
    scene.add(gizmo);

    const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 200);
    const dist = radius * 2.85;
    camera.position.set(center.x + dist * 0.75, center.y + dist * 0.55, center.z + dist * 0.85);
    camera.lookAt(center);

    const resize = () => {
      const w = host.clientWidth || 600;
      const h = host.clientHeight || 450;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let t = 0;
    const tick = () => {
      t += 1 / 60;
      if (!reduced) {
        root.rotation.y = Math.sin(t * 0.25) * 0.5;
        gizmo.rotation.y = Math.sin(t * 0.25) * 0.5;
        runtime.updateAnimation?.(1 / 60, t);
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      runtime.dispose();
      gizmo.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      env.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [model, webgl]);

  return (
    <div className="gl-cad-stage" role="img" aria-label={`${model.name}, shown as an exploded 3D assembly`}>
      <div ref={hostRef} className="gl-cad-viewport" />
      <aside className="gl-cad-panel gl-cad-outliner" aria-hidden="true">
        <span className="gl-cad-panel-title">Assembly</span>
        {parts.slice(0, 7).map((p) => <span key={p} className="gl-cad-row"><i />{p}</span>)}
      </aside>
      {first && (
        <aside className="gl-cad-panel gl-cad-props" aria-hidden="true">
          <span className="gl-cad-panel-title">Selected part</span>
          <strong>{first.name}</strong>
          <span>{first.role}</span>
        </aside>
      )}
      {!webgl && <div className="gl-cad-fallback">3D preview needs WebGL</div>}
    </div>
  );
};

export default CadHeroStage;
