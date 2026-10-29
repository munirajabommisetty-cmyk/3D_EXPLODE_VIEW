/**
 * Exploded-view presentation (Milestone C): smooth animation of the explode factor, the "floating
 * workspace" look, and the part labels shown only while the model is fully exploded.
 *
 * The explode TARGET stays owned by the workspace (set through the shared scene-command
 * dispatcher by voice, keyboard or the two-hand gesture). The viewer animates the DISPLAYED factor
 * toward it with ExplodeAnimator; each model's own setExplodedFactor() moves every part along its
 * engineered direction (e.g. gearbox: shaft and sun gear up the axis, carrier and ring gear down,
 * planet gears outward) and factor 0 puts every part back at its exact assembled transform.
 */

export const EXPLODE_ANIMATION_MS = 750;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Animates a value toward a target with an eased, fixed-duration move; retargeting mid-way
 *  continues smoothly from where it is (an explode can be reversed at any moment). */
export class ExplodeAnimator {
  private from = 0;
  private to = 0;
  private value = 0;
  private startedAt = 0;
  private readonly durationMs: number;

  constructor(durationMs = EXPLODE_ANIMATION_MS) {
    this.durationMs = durationMs;
  }

  public setTarget(target: number, nowMs: number): void {
    const t = Math.max(0, Math.min(1, target));
    if (t === this.to) return;
    this.from = this.value;
    this.to = t;
    this.startedAt = nowMs;
  }

  /** Jumps without animation (model switch). */
  public snap(value: number): void {
    this.from = this.to = this.value = Math.max(0, Math.min(1, value));
  }

  public update(nowMs: number): number {
    if (this.value === this.to) return this.value;
    const p = Math.min(1, Math.max(0, (nowMs - this.startedAt) / this.durationMs));
    this.value = p >= 1 ? this.to : this.from + (this.to - this.from) * easeInOutCubic(p);
    return this.value;
  }

  public getValue(): number {
    return this.value;
  }

  public getTarget(): number {
    return this.to;
  }

  public isAnimating(): boolean {
    return this.value !== this.to;
  }
}

/** Labels: shown only once fully exploded; fade out as soon as reassembly starts. */
export type LabelPhase = 'hidden' | 'shown' | 'fadingOut';

export function labelPhase(target: number, value: number, wasShown: boolean): LabelPhase {
  if (target > 0 && value === target) return 'shown';
  if (wasShown && value > 0) return 'fadingOut';
  return 'hidden';
}

/** Moves `current` toward `goal` at `perSecond` (used for the background / lighting blend). */
export function approach(current: number, goal: number, perSecond: number, dtSeconds: number): number {
  const step = perSecond * dtSeconds;
  return Math.abs(goal - current) <= step ? goal : current + Math.sign(goal - current) * step;
}

/** Linear blend of two 0xRRGGBB colours. */
export function mixColor(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return m(16) | m(8) | m(0);
}

/** The floating-workspace look: assembled = dark studio; exploded = bright engineering lab. */
export const STUDIO_BACKGROUND = 0x0b0f19;
export const LAB_BACKGROUND = 0x050a14; // x-ray blueprint backdrop (VirtualWorkspace dome)

export interface LabelBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Simple screen-space de-overlap: labels are placed at their anchor; when two overlap, the lower
 * one is pushed down until it is clear. Returns the adjusted y per label id.
 */
export function layoutLabels(boxes: readonly LabelBox[], gap = 4): Map<string, number> {
  const placed: LabelBox[] = [];
  const out = new Map<string, number>();
  for (const b of [...boxes].sort((p, q) => p.y - q.y)) {
    let y = b.y;
    for (let guard = 0; guard < boxes.length; guard++) {
      const hit = placed.find((o) => Math.abs(o.x - b.x) < (o.width + b.width) / 2 + gap && Math.abs(o.y - y) < (o.height + b.height) / 2 + gap);
      if (!hit) break;
      y = hit.y + (hit.height + b.height) / 2 + gap;
    }
    placed.push({ ...b, y });
    out.set(b.id, y);
  }
  return out;
}

/** One label per known component: canonical name from the model data, no duplicates, no unknown parts. */
export function componentLabels(ids: readonly string[], nameOf: (id: string) => string | null | undefined): { id: string; name: string }[] {
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const id of ids) {
    const name = nameOf(id);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ id, name });
  }
  return out;
}

/* ---------------- Callout labels (x-ray style): two neat columns with leader lines ---------------- */

export interface CalloutAnchor {
  id: string;
  /** Screen position of the part (px). */
  x: number;
  y: number;
  /** Estimated label width (px). */
  width: number;
}

export interface Callout {
  id: string;
  side: 'left' | 'right';
  anchorX: number;
  anchorY: number;
  /** Edge of the label nearest the part (right edge for left labels, left edge for right labels). */
  labelX: number;
  labelY: number;
}

/**
 * Places labels in a left and a right column beside the model (each part goes to the side it is
 * on), ordered top to bottom like the parts, at least `spacing` px apart and inside the viewport.
 * Leader lines run from each part to its label, so labels never cover the model or each other.
 */
export function calloutLayout(
  anchors: readonly CalloutAnchor[],
  viewport: { width: number; height: number },
  opts: { margin?: number; spacing?: number; top?: number; bottom?: number } = {}
): Callout[] {
  if (anchors.length === 0) return [];
  const margin = opts.margin ?? 56;
  const spacing = opts.spacing ?? 28;
  const top = opts.top ?? 64;
  const bottom = viewport.height - (opts.bottom ?? 96);
  const xs = anchors.map((a) => a.x).sort((p, q) => p - q);
  const mid = xs[Math.floor(xs.length / 2)];
  const minX = xs[0];
  const maxX = xs[xs.length - 1];
  const out: Callout[] = [];
  for (const side of ['left', 'right'] as const) {
    // a lone part goes in the left column only
    const col = anchors.filter((a) => (side === 'left' ? a.x < mid || anchors.length === 1 : a.x >= mid && anchors.length > 1))
      .sort((p, q) => p.y - q.y);
    if (!col.length) continue;
    const widest = Math.max(...col.map((a) => a.width));
    const labelX = side === 'left'
      ? Math.max(widest + 12, minX - margin)
      : Math.min(viewport.width - widest - 12, maxX + margin);
    // Row-like parts (spread sideways more than up/down, e.g. the exploded eye): "fan" the labels —
    // the farthest parts take the outermost slots, alternating top and bottom — so leader lines
    // never cross. Otherwise keep the parts' top-to-bottom order.
    const spreadY = Math.max(...col.map((a) => a.y)) - Math.min(...col.map((a) => a.y));
    const spreadX = Math.max(...col.map((a) => a.x)) - Math.min(...col.map((a) => a.x));
    let ordered = col;
    let desired = col.map((a) => a.y);
    if (col.length > 2 && spreadY < spreadX * 0.5) {
      const avgY = col.reduce((t, a) => t + a.y, 0) / col.length;
      const byDistance = [...col].sort((p, q) => Math.abs(q.x - labelX) - Math.abs(p.x - labelX));
      const slots: (CalloutAnchor | undefined)[] = new Array(col.length);
      let lo = 0;
      let hi = col.length - 1;
      byDistance.forEach((a, i) => { if (i % 2 === 0) slots[lo++] = a; else slots[hi--] = a; });
      ordered = slots as CalloutAnchor[];
      desired = ordered.map((_, i) => avgY + (i - (ordered.length - 1) / 2) * spacing);
    }
    // top-down pass keeps order and spacing; then pull the column back inside the viewport
    const ys: number[] = [];
    for (const y of desired) ys.push(Math.max(y, top, ys.length ? ys[ys.length - 1] + spacing : -Infinity));
    const overflow = ys[ys.length - 1] - bottom;
    if (overflow > 0) for (let i = 0; i < ys.length; i++) ys[i] = Math.max(top + i * spacing, ys[i] - overflow);
    ordered.forEach((a, i) => out.push({ id: a.id, side, anchorX: a.x, anchorY: a.y, labelX, labelY: ys[i] }));
  }
  return out;
}
