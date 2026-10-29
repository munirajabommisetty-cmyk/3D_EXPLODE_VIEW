/**
 * Virtual workspace for the exploded view (Milestone C, UI pass).
 *
 * While the model is exploded the scene becomes a light, airy "virtual lab": a soft pastel sky
 * dome instead of the dark studio, a glowing holographic platform ring under the parts, a few
 * slowly drifting light particles, and every part drawn as a light, translucent hologram
 * (pastel body + crisp edge lines in a deeper tone of the same hue, so it stays readable on the
 * light background). Nothing about the geometry or the part positions changes: only materials
 * and decoration. On reassembly the original materials are put back exactly.
 *
 * Highlights: ComponentRaycaster clones the CURRENT material for hover / selection, so the
 * owner must clear highlights before a material swap and re-apply them after (see swap hooks).
 */

import * as THREE from 'three';

/** Very light, distinct pastel per part (body) and a deeper tone of the same hue (edges, label dot). */
export const VIRTUAL_PALETTE: readonly { body: number; edge: number }[] = [
  { body: 0xa9d8ff, edge: 0x2f7fd8 }, // ice blue
  { body: 0xa8f0d8, edge: 0x1f9f78 }, // mint
  { body: 0xcfc2ff, edge: 0x6a52d6 }, // lavender
  { body: 0xffd0b0, edge: 0xd2702e }, // peach
  { body: 0xffbfd2, edge: 0xc84a78 }, // rose
  { body: 0xfff0a8, edge: 0xb08a00 }, // lemon
  { body: 0xb6ecff, edge: 0x1c8fb8 }, // sky
  { body: 0xd8f5b0, edge: 0x5f9a1c }, // lime
];

export function paletteFor(index: number) {
  return VIRTUAL_PALETTE[((index % VIRTUAL_PALETTE.length) + VIRTUAL_PALETTE.length) % VIRTUAL_PALETTE.length];
}

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

interface Swapped {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
  edges: THREE.LineSegments | null;
  edgeMat: THREE.LineBasicMaterial;
}

export class VirtualWorkspace {
  private readonly scene: THREE.Scene;
  private readonly dome: THREE.Mesh;
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly platform: THREE.Group;
  private readonly platformMats: THREE.Material[] = [];
  private readonly particles: THREE.Points;
  private readonly particleMat: THREE.PointsMaterial;
  private readonly edgeCache = new Map<string, THREE.EdgesGeometry>();
  private readonly holoMats = new Map<string, { body: THREE.MeshStandardMaterial; edge: THREE.LineBasicMaterial }>();
  private swapped: Swapped[] = [];
  private readonly outlineMat = new THREE.LineBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.32 });
  /** Meshes still waiting for their edge lines (built a few per frame, so exploding never stalls). */
  private edgeQueue: Swapped[] = [];
  private colors = new Map<string, { body: number; edge: number }>();
  private mix = 0;
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Pastel sky dome (behind everything; fades in with `mix`)
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uOpacity: { value: 0 },
        // X-ray blueprint backdrop: deep navy, slightly lighter at the horizon (UI pass 28 Oct 2026)
        uTop: { value: new THREE.Color(0x02040a) },
        uMid: { value: new THREE.Color(0x0a1426) },
        uBottom: { value: new THREE.Color(0x03060d) },
      },
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uOpacity; uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom; varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 c = h > 0.0 ? mix(uMid, uTop, smoothstep(0.0, 0.8, h)) : mix(uMid, uBottom, smoothstep(0.0, -0.6, h));
          gl_FragColor = vec4(c, uOpacity);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(45, 32, 16), this.domeMat);
    this.dome.renderOrder = -10;
    this.dome.visible = false;
    this.dome.raycast = () => {};
    scene.add(this.dome);

    // Holographic platform: soft glow disc + thin concentric rings
    this.platform = new THREE.Group();
    const glowTex = radialTexture();
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(4.2, 64),
      new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0 })
    );
    glow.rotation.x = -Math.PI / 2;
    this.platform.add(glow);
    this.platformMats.push(glow.material as THREE.Material);
    for (const [r, w] of [[2.6, 0.025], [3.3, 0.018], [4.0, 0.012]] as const) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r, r + w, 96),
        new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.002;
      this.platform.add(ring);
      this.platformMats.push(ring.material as THREE.Material);
    }
    this.platform.visible = false;
    this.platform.traverse((o) => { o.raycast = () => {}; });
    scene.add(this.platform);

    // Drifting particles (cheap: one Points object)
    const count = 160;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 6;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = -2 + Math.random() * 7;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.particleMat = new THREE.PointsMaterial({ color: 0x8fbfff, size: 0.05, transparent: true, opacity: 0, depthWrite: false });
    this.particles = new THREE.Points(pg, this.particleMat);
    this.particles.visible = false;
    this.particles.raycast = () => {};
    // Milestone (exploded-view review): particles distracted from the model; they are no longer shown
  }

  /** Colour per component (stable order of the model's component ids). */
  public setComponents(ids: readonly string[]): void {
    this.colors = new Map(ids.map((id, i) => [id, paletteFor(i)]));
  }

  /** Label accent colour for a part (CSS), or null. */
  public accentFor(componentId: string): string | null {
    const c = this.colors.get(componentId);
    return c ? css(c.edge) : null;
  }

  /** Places the platform just under the assembly's lowest point. */
  public placeUnder(root: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this.platform.position.set(c.x, box.min.y - 0.35, c.z);
    const s = Math.max(0.6, Math.max(size.x, size.z) / 5);
    this.platform.scale.setScalar(s);
    this.particles.position.set(c.x, 0, c.z);
  }

  /** 0 = dark studio, 1 = virtual lab. */
  public setMix(mix: number): void {
    this.mix = mix;
    const on = mix > 0.001;
    this.dome.visible = on;
    this.platform.visible = on;
    this.particles.visible = false;
    this.domeMat.uniforms.uOpacity.value = mix;
    this.platformMats.forEach((m, i) => { (m as THREE.MeshBasicMaterial).opacity = (i === 0 ? 0.6 : 0.35) * mix; });
    this.particleMat.opacity = 0.7 * mix;
  }

  public update(dtSeconds: number): void {
    this.buildSomeEdges(40);
    if (this.mix <= 0.001) return;
    this.time += dtSeconds;
    this.platform.rotation.y += dtSeconds * 0.08;
    this.particles.rotation.y += dtSeconds * 0.03;
    this.particles.position.y = Math.sin(this.time * 0.4) * 0.15;
  }

  public isHolographic(): boolean {
    return this.swapped.length > 0;
  }

  /** Draws every part as a light hologram (pastel translucent body + edge lines). */
  /**
   * `edges: false` skips outline extraction (organic anatomy meshes would give noisy outlines and
   * cost hundreds of thousands of triangles); `contextIds` parts are drawn very faintly.
   */
  public applyHolographic(root: THREE.Object3D, opts: { edges?: boolean; contextIds?: readonly string[]; keepMaterials?: boolean } = {}): void {
    if (this.swapped.length) return;
    const withEdges = opts.edges !== false;
    if (opts.keepMaterials) {
      // Default: keep each model's own high-contrast colours; only add thin dark outlines so part
      // boundaries stay visible on the light background
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || mesh.userData.virtualEdge) return;
        const entry: Swapped = { mesh, original: mesh.material, edges: null, edgeMat: this.outlineMat };
        this.swapped.push(entry);
        if (withEdges) this.edgeQueue.push(entry);
      });
      return;
    }
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const id = componentOf(mesh);
      const context = Boolean(id && opts.contextIds?.includes(id));
      const color = (id && this.colors.get(id)) || VIRTUAL_PALETTE[0];
      const key = `${color.body}${context ? ':ctx' : ''}`;
      let mats = this.holoMats.get(key);
      if (!mats) {
        mats = {
          body: new THREE.MeshStandardMaterial({
            color: context ? 0xb8c2d6 : color.body, emissive: color.body, emissiveIntensity: context ? 0.1 : 0.35,
            roughness: 0.35, metalness: 0.05,
            transparent: true, opacity: context ? 0.12 : 0.78, depthWrite: !context,
          }),
          edge: new THREE.LineBasicMaterial({ color: color.edge, transparent: true, opacity: 0.85 }),
        };
        this.holoMats.set(key, mats);
      }
      const entry: Swapped = { mesh, original: mesh.material, edges: null, edgeMat: mats.edge };
      this.swapped.push(entry);
      if (withEdges && !context) this.edgeQueue.push(entry);
      mesh.material = mats.body;
    });
  }

  /** Adds edge lines to up to `max` queued meshes (edge extraction is the costly part). */
  private buildSomeEdges(max: number): void {
    for (let n = 0; n < max && this.edgeQueue.length; n++) {
      const entry = this.edgeQueue.shift()!;
      const g = entry.mesh.geometry as THREE.BufferGeometry | undefined;
      if (!g) continue;
      let eg = this.edgeCache.get(g.uuid);
      if (!eg) {
        eg = new THREE.EdgesGeometry(g, 28);
        this.edgeCache.set(g.uuid, eg);
      }
      const edges = new THREE.LineSegments(eg, entry.edgeMat);
      edges.raycast = () => {};
      edges.userData.virtualEdge = true;
      entry.mesh.add(edges);
      entry.edges = edges;
    }
  }

  /** Puts every original material back exactly and removes the edge lines. */
  public restoreMaterials(): void {
    for (const s of this.swapped) {
      s.mesh.material = s.original;
      if (s.edges) s.mesh.remove(s.edges);
    }
    this.swapped = [];
    this.edgeQueue = [];
  }

  /** Model switch: forget swapped meshes (their model is gone) and cached edges. */
  public resetForModel(): void {
    this.restoreMaterials();
    this.edgeCache.forEach((g) => g.dispose());
    this.edgeCache.clear();
  }

  public dispose(): void {
    this.resetForModel();
    this.holoMats.forEach((m) => { m.body.dispose(); m.edge.dispose(); });
    this.holoMats.clear();
    for (const o of [this.dome, this.platform, this.particles]) this.scene.remove(o);
    this.dome.geometry.dispose();
    this.domeMat.dispose();
    this.platform.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
    this.particles.geometry.dispose();
    this.particleMat.dispose();
    this.outlineMat.dispose();
  }
}

/** The component id of a mesh (its own or the nearest ancestor's). */
function componentOf(obj: THREE.Object3D | null): string | null {
  for (let o = obj; o; o = o.parent) if (o.userData?.componentId) return o.userData.componentId as string;
  return null;
}

/** Soft radial glow for the platform (generated, no image file). */
function radialTexture(): THREE.Texture {
  const size = 256;
  if (typeof document === 'undefined') return new THREE.Texture();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(34, 211, 238, 0.28)');
  grad.addColorStop(0.45, 'rgba(56, 189, 248, 0.10)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
