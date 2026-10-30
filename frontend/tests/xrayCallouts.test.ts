/**
 * X-ray technical-illustration style and callout labels (UI pass, 28 Oct 2026).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { calloutLayout, type CalloutAnchor } from '../src/services/scene/explodePresentation';
import { XrayStyle, XRAY_MONO, XRAY_PALETTE, makeXrayMaterial } from '../src/components/scene/xrayStyle';
import { buildSteamEngine, STEAM_ENGINE_COMPONENT_IDS } from '../src/models/mechanical/steamEngineModel';

/** Do segments p1-p2 and p3-p4 cross (proper intersection)? */
function crosses(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const o = (p: [number, number], q: [number, number], r: [number, number]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

describe('Callout labels', () => {
  const view = { width: 1400, height: 800 };

  it('two columns beside the parts, ordered, spaced and inside the viewport', () => {
    const anchors: CalloutAnchor[] = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`, x: 500 + (i % 4) * 120, y: 250 + Math.floor(i / 4) * 90 + (i % 3) * 7, width: 120,
    }));
    const out = calloutLayout(anchors, view);
    assert.equal(out.length, anchors.length, 'every part gets a label');
    for (const side of ['left', 'right'] as const) {
      const col = out.filter((c) => c.side === side).sort((p, q) => p.labelY - q.labelY);
      for (let i = 1; i < col.length; i++) assert.ok(col[i].labelY - col[i - 1].labelY >= 28 - 1e-9, 'no overlapping labels');
      for (const c of col) {
        assert.ok(c.labelY >= 64 && c.labelY <= view.height - 96 + 1e-9, 'inside the viewport');
        if (side === 'left') assert.ok(c.labelX <= c.anchorX, 'left labels sit left of their part');
        else assert.ok(c.labelX >= c.anchorX, 'right labels sit right of their part');
      }
    }
  });

  it('a row of parts (exploded eye) fans out so leader lines do not cross', () => {
    const anchors: CalloutAnchor[] = Array.from({ length: 16 }, (_, i) => ({ id: `s${i}`, x: 300 + i * 50, y: 420 + (i % 2 ? 2 : -2), width: 140 }));
    const out = calloutLayout(anchors, view);
    for (const side of ['left', 'right'] as const) {
      const col = out.filter((c) => c.side === side);
      for (const a of col) for (const b of col) {
        if (a.id >= b.id) continue;
        const seg = (c: typeof a): [[number, number], [number, number]] => [[c.anchorX, c.anchorY], [c.labelX, c.labelY]];
        const [p1, p2] = seg(a);
        const [p3, p4] = seg(b);
        assert.ok(!crosses(p1, p2, p3, p4), `${a.id} / ${b.id} leaders cross`);
      }
    }
  });

  it('empty input gives no labels; one part still gets a label', () => {
    assert.deepEqual(calloutLayout([], view), []);
    assert.equal(calloutLayout([{ id: 'only', x: 700, y: 400, width: 80 }], view).length, 1);
  });
});

describe('X-ray style', () => {
  it('colour-codes every component distinctly and restores the original materials exactly', () => {
    const e = buildSteamEngine();
    const before = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    e.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) before.set(o as THREE.Mesh, (o as THREE.Mesh).material); });
    const x = new XrayStyle();
    x.setComponents(STEAM_ENGINE_COMPONENT_IDS);
    x.apply(e.group, { edges: true });
    const colours = new Set(STEAM_ENGINE_COMPONENT_IDS.map((id) => x.colorFor(id)));
    assert.equal(colours.size, Math.min(STEAM_ENGINE_COMPONENT_IDS.length, XRAY_PALETTE.length), 'neighbouring parts never share a colour');
    // assembled = monochrome white drawing; exploded = each part in its own colour
    const fillOf = (id: string) => {
      let m: THREE.MeshStandardMaterial | null = null;
      e.parts.get(id)!.traverse((o) => { if (!m && (o as THREE.Mesh).isMesh) m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; });
      return m! as THREE.MeshStandardMaterial;
    };
    x.setColorMix(0);
    assert.equal(fillOf('piston').emissive.getHex(), fillOf('boiler').emissive.getHex(), 'assembled: one colour (white)');
    assert.equal(fillOf('piston').emissive.getHex(), XRAY_MONO);
    x.setColorMix(1);
    assert.notEqual(fillOf('piston').emissive.getHex(), fillOf('boiler').emissive.getHex(), 'exploded: colour-coded');
    assert.equal(fillOf('piston').emissive.getHex(), x.colorFor('piston'));
    for (const m of before.keys()) assert.ok((m.material as THREE.Material).userData.xray, 'every part is x-rayed');
    x.update(1000);
    let edges = 0;
    e.group.traverse((o) => { if (o.userData.virtualEdge) edges++; });
    assert.ok(edges > 0, 'glowing outlines for hard-surface parts');
    x.restore();
    for (const [m, mat] of before) assert.equal(m.material, mat, 'original material back');
    e.group.traverse((o) => assert.ok(!o.userData.virtualEdge, 'outlines removed'));
    x.dispose();
    e.dispose();
  });

  it('section views keep working: clipping planes are mirrored onto the x-ray materials', () => {
    const e = buildSteamEngine();
    const x = new XrayStyle();
    x.setComponents(STEAM_ENGINE_COMPONENT_IDS);
    x.apply(e.group, { edges: false });
    e.setCutaway(true); // the runtime sets planes on its ORIGINAL materials
    x.syncClipping();
    const cylinder = e.piece('cylinder', 1)!.children[0] as THREE.Mesh;
    assert.equal(((cylinder.material as THREE.Material).clippingPlanes ?? []).length, 1);
    e.setCutaway(false);
    x.syncClipping();
    assert.equal(((cylinder.material as THREE.Material).clippingPlanes ?? []).length, 0);
    x.dispose();
    e.dispose();
  });

  it('x-ray materials are see-through with a rim glow; organic (soft) ones do not wash out additively', () => {
    const hard = makeXrayMaterial(0x38bdf8);
    const soft = makeXrayMaterial(0x38bdf8, { soft: true });
    assert.ok(hard.transparent && hard.opacity < 0.2 && !hard.depthWrite);
    assert.equal(hard.blending, THREE.AdditiveBlending);
    assert.equal(soft.blending, THREE.NormalBlending);
    assert.notEqual(hard.customProgramCacheKey(), soft.customProgramCacheKey());
  });
});
