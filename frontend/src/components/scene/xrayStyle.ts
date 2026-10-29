/**
 * X-ray technical-illustration style (UI pass, 28 Oct 2026).
 *
 * Every part is drawn as a see-through "x-ray": a faint additive fill whose edges and silhouette
 * glow (Fresnel rim), plus crisp outline lines for hard-surface parts. Inner parts stay visible
 * through outer ones, like a cut-away engineering illustration.
 *
 * Assembled, the drawing is monochrome (white technical wireframe on the dark backdrop); as the
 * model explodes, setColorMix() blends every component to its own vivid colour so the separated
 * parts are easy to tell apart (colour mix 1 = the fully colour-coded exploded look).
 *
 * Only materials change: geometry, positions and component ids are untouched. The original
 * materials are put back exactly by restore(). Clipping planes (cutaway / section views) are
 * mirrored from the original materials every frame (syncClipping), so sections keep working.
 * Highlights: ComponentRaycaster clones the current material; the owner clears highlights before
 * apply/restore and re-applies them after.
 */

import * as THREE from 'three';

/** Vivid, well-separated colours for a dark background (one per component, in model order). */
export const XRAY_PALETTE: readonly number[] = [
  0x38bdf8, // sky
  0xf472b6, // pink
  0xa3e635, // lime
  0xfbbf24, // amber
  0xa78bfa, // violet
  0x2dd4bf, // teal
  0xfb7185, // rose
  0x60a5fa, // blue
  0xfacc15, // yellow
  0x34d399, // emerald
  0xf97316, // orange
  0xe879f9, // fuchsia
  0x22d3ee, // cyan
  0xc084fc, // purple
  0x4ade80, // green
  0xfda4af, // light rose
  0x93c5fd, // light blue
  0xfde047, // light yellow
  0x86efac, // mint
  0xf0abfc, // orchid
  0x67e8f9, // light cyan
  0xfdba74, // peach
  0xbef264, // light lime
  0xd8b4fe, // lavender
];

/** Monochrome (assembled) look: cool white lines, very faint fill. */
export const XRAY_MONO = 0xdcecff;

export const xrayColor = (index: number) => XRAY_PALETTE[((index % XRAY_PALETTE.length) + XRAY_PALETTE.length) % XRAY_PALETTE.length];

/** See-through fill with a glowing Fresnel rim in the part's colour. */
export function makeXrayMaterial(color: number, opts: { fill?: number; context?: boolean; soft?: boolean } = {}): THREE.MeshStandardMaterial {
  // soft: organic models with many nested shells (the eye) use normal blending and a gentler rim,
  // otherwise the stacked additive layers wash out to white
  const c = new THREE.Color(color);
  const m = new THREE.MeshStandardMaterial({
    color: c.clone().multiplyScalar(0.25),
    emissive: c,
    emissiveIntensity: opts.context ? 0.05 : 0.18,
    roughness: 0.6,
    metalness: 0,
    transparent: true,
    opacity: opts.context ? 0.03 : opts.fill ?? 0.1,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: opts.soft ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const rim = { value: c.clone().multiplyScalar(rimScale(opts)) };
  const rimAlpha = opts.soft ? '0.55' : '0.8';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.xrayRim = rim;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 xrayRim;\nvoid main() {')
      .replace(
        '#include <opaque_fragment>',
        [
          'float xrayFresnel = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);',
          'outgoingLight += xrayRim * xrayFresnel * 1.6;',
          `diffuseColor.a = clamp(diffuseColor.a + xrayFresnel * ${rimAlpha}, 0.0, 1.0);`,
          '#include <opaque_fragment>',
        ].join('\n')
      );
  };
  m.customProgramCacheKey = () => `xray-rim-v1-${rimAlpha}`;
  m.userData.xray = true;
  m.userData.xrayRim = rim;
  m.envMapIntensity = 0; // the studio reflections are for the realistic look, not the x-ray
  return m;
}

const rimScale = (opts: { context?: boolean; soft?: boolean }) => (opts.context ? 0.25 : opts.soft ? 0.75 : 1);

/** Material values for one colour at full colour (the exploded look). */
function fullLook(color: number, context: boolean, soft: boolean, fill: number) {
  const c = new THREE.Color(color);
  return {
    base: c.clone().multiplyScalar(0.25), emissive: c.clone(), emissiveIntensity: context ? 0.05 : 0.18,
    opacity: context ? 0.03 : fill, rim: c.clone().multiplyScalar(rimScale({ context, soft })),
    edge: c.clone(), edgeOpacity: context ? 0.15 : 0.85,
  };
}

/** Monochrome assembled look: thin white lines, almost no fill, a soft rim (no washed-out glow). */
function monoLook(context: boolean, soft: boolean) {
  const c = new THREE.Color(XRAY_MONO);
  return {
    base: c.clone().multiplyScalar(0.12), emissive: c.clone(), emissiveIntensity: context ? 0.02 : soft ? 0.1 : 0.05,
    opacity: context ? 0.02 : soft ? 0.08 : 0.035, rim: c.clone().multiplyScalar(context ? 0.12 : soft ? 0.45 : 0.32),
    edge: c.clone(), edgeOpacity: context ? 0.1 : 0.42,
  };
}

interface Entry {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
  xray: THREE.MeshStandardMaterial;
  edgeMat: THREE.LineBasicMaterial | null;
  edges: THREE.LineSegments | null;
}

export class XrayStyle {
  private entries: Entry[] = [];
  private edgeQueue: Entry[] = [];
  private readonly edgeCache = new Map<string, THREE.EdgesGeometry>();
  private readonly mats = new Map<string, { fill: THREE.MeshStandardMaterial; edge: THREE.LineBasicMaterial }>();
  private colors = new Map<string, number>();
  private readonly looks = new Map<string, { full: ReturnType<typeof fullLook>; mono: ReturnType<typeof monoLook> }>();
  private colorMix = 1;

  /** Colour per component, in the model's component order. */
  public setComponents(ids: readonly string[]): void {
    this.colors = new Map(ids.map((id, i) => [id, xrayColor(i)]));
  }

  public colorFor(componentId: string): number | null {
    return this.colors.get(componentId) ?? null;
  }

  public cssColorFor(componentId: string): string | null {
    const c = this.colorFor(componentId);
    return c === null ? null : `#${c.toString(16).padStart(6, '0')}`;
  }

  public isOn(): boolean {
    return this.entries.length > 0;
  }

  /**
   * Switches every mesh under `root` to the x-ray look. `edges` adds glowing outlines (built a few
   * meshes per frame); `contextIds` are drawn very faintly.
   */
  public apply(root: THREE.Object3D, opts: { edges?: boolean; edgeAngle?: number; contextIds?: readonly string[] } = {}): void {
    if (this.entries.length) return;
    const withEdges = opts.edges !== false;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.virtualEdge) return;
      const id = componentOf(mesh);
      const context = Boolean(id && opts.contextIds?.includes(id));
      const color = (id ? this.colors.get(id) : undefined) ?? XRAY_PALETTE[0];
      const original = mesh.material;
      const origUuid = Array.isArray(original) ? original.map((m) => m.uuid).join(',') : original.uuid;
      const key = `${color}|${context}|${origUuid}`;
      let pair = this.mats.get(key);
      if (!pair) {
        pair = {
          fill: makeXrayMaterial(color, { context, soft: !withEdges }),
          edge: new THREE.LineBasicMaterial({ color, transparent: true, opacity: context ? 0.15 : 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
        };
        this.mats.set(key, pair);
        this.looks.set(key, { full: fullLook(color, context, !withEdges, pair.fill.opacity), mono: monoLook(context, !withEdges) });
        this.paint(key, this.colorMix);
      }
      const entry: Entry = { mesh, original, xray: pair.fill, edgeMat: withEdges && !context ? pair.edge : null, edges: null };
      mesh.material = pair.fill;
      mesh.userData.xrayEdgeAngle = opts.edgeAngle ?? 20;
      this.entries.push(entry);
      if (entry.edgeMat) this.edgeQueue.push(entry);
    });
    this.syncClipping();
  }

  /**
   * 0 = monochrome white wireframe (assembled), 1 = every part in its own colour (exploded).
   * Cheap: only the shared materials change, and only when the value moves.
   */
  public setColorMix(t: number): void {
    const v = Math.max(0, Math.min(1, t));
    if (v === this.colorMix) return;
    this.colorMix = v;
    for (const key of this.mats.keys()) this.paint(key, v);
  }

  public getColorMix(): number {
    return this.colorMix;
  }

  private paint(key: string, t: number): void {
    const pair = this.mats.get(key);
    const look = this.looks.get(key);
    if (!pair || !look) return;
    const { full: f, mono: m } = look;
    const lerp = (a: number, b: number) => a + (b - a) * t;
    pair.fill.color.copy(m.base).lerp(f.base, t);
    pair.fill.emissive.copy(m.emissive).lerp(f.emissive, t);
    pair.fill.emissiveIntensity = lerp(m.emissiveIntensity, f.emissiveIntensity);
    pair.fill.opacity = lerp(m.opacity, f.opacity);
    (pair.fill.userData.xrayRim as { value: THREE.Color }).value.copy(m.rim).lerp(f.rim, t);
    pair.edge.color.copy(m.edge).lerp(f.edge, t);
    pair.edge.opacity = lerp(m.edgeOpacity, f.edgeOpacity);
  }

  /** Builds outline lines for up to `max` queued meshes (outline extraction is the costly part). */
  public update(max = 30): void {
    for (let n = 0; n < max && this.edgeQueue.length; n++) {
      const e = this.edgeQueue.shift()!;
      const g = e.mesh.geometry as THREE.BufferGeometry | undefined;
      if (!g || !e.edgeMat) continue;
      const key = `${g.uuid}:${e.mesh.userData.xrayEdgeAngle}`;
      let eg = this.edgeCache.get(key);
      if (!eg) {
        eg = new THREE.EdgesGeometry(g, e.mesh.userData.xrayEdgeAngle as number);
        this.edgeCache.set(key, eg);
      }
      const lines = new THREE.LineSegments(eg, e.edgeMat);
      lines.raycast = () => {};
      lines.userData.virtualEdge = true;
      e.mesh.add(lines);
      e.edges = lines;
    }
  }

  /** Mirrors clipping planes (cutaway / section views) from the original materials. */
  public syncClipping(): void {
    for (const e of this.entries) {
      const orig = Array.isArray(e.original) ? e.original[0] : e.original;
      const planes = orig?.clippingPlanes ?? null;
      const cur = (e.mesh.material as THREE.Material).clippingPlanes ?? null;
      if (planes !== cur && !(planes?.length === 0 && !cur)) {
        (e.mesh.material as THREE.Material).clippingPlanes = planes;
        (e.mesh.material as THREE.Material).needsUpdate = true;
        if (e.edgeMat) { e.edgeMat.clippingPlanes = planes; e.edgeMat.needsUpdate = true; }
      }
    }
  }

  /** Puts every original material back exactly and removes the outlines. */
  public restore(): void {
    for (const e of this.entries) {
      e.mesh.material = e.original;
      if (e.edges) e.mesh.remove(e.edges);
    }
    this.entries = [];
    this.edgeQueue = [];
  }

  /** Model switch: drop everything that belonged to the old model. */
  public reset(): void {
    this.restore();
    this.edgeCache.forEach((g) => g.dispose());
    this.edgeCache.clear();
    this.mats.forEach((p) => { p.fill.dispose(); p.edge.dispose(); });
    this.mats.clear();
    this.looks.clear();
  }

  public dispose(): void {
    this.reset();
  }
}

function componentOf(obj: THREE.Object3D | null): string | null {
  for (let o = obj; o; o = o.parent) if (o.userData?.componentId) return o.userData.componentId as string;
  return null;
}
