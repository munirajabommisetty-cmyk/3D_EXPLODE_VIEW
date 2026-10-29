/**
 * Reinforced Concrete Structural System Explorer — one storey, one bay of a reinforced concrete
 * frame: four isolated footings, four columns, four beams, a slab and four beam-column joints,
 * with their reinforcement. Procedural, simplified educational model (units: metres).
 *
 * The reinforcement follows common detailing ideas (40 mm concrete cover; four corner bars and
 * closed ties in each column; top and bottom bars with closed stirrups in each beam, bent into
 * the joints for anchorage; ties continued through the joint; bottom bar meshes in slab and
 * footings; column bars bent into the footing). It is NOT a design to any building code, and no
 * loads, capacities or stresses are calculated. The load-path overlay is an illustration only.
 */

import * as THREE from 'three';
import type { Scene } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AssemblyTreeNode, EngineeringModelDefinition, ModelRuntimeInstance } from '../../types/models';
import type { CivilComponentMetadata } from '../../types/engineering';
import { buildRelationshipIndex, type RelationshipEdge } from '../../services/scene/relationshipTable';

export const RC_FRAME_MODEL_ID = 'rc_frame';

/** Geometry (metres). */
export const RC = {
  spanX: 4.0, spanZ: 3.5, // column centre-to-centre
  col: 0.4, // square column
  colTop: 2.0, // underside of beams
  beamW: 0.3, beamTop: 2.3, // beam web below the slab
  slabT: 0.15,
  footing: { w: 1.2, h: 0.45, bottom: -1.25 },
  cover: 0.04,
  mainBar: 0.008, // 16 mm bars (radius)
  tieBar: 0.004, // 8 mm ties and stirrups (radius)
  slabBar: 0.005, // 10 mm slab / footing bars (radius)
  tieSpacing: 0.15, jointTieSpacing: 0.1, slabBarSpacing: 0.2, footingBarSpacing: 0.15,
} as const;

const X = RC.spanX / 2;
const Z = RC.spanZ / 2;
const COLS: [number, number][] = [[-X, -Z], [X, -Z], [-X, Z], [X, Z]];
const FOOT_TOP = RC.footing.bottom + RC.footing.h;
const SLAB_TOP = RC.beamTop + RC.slabT;

export type RcKind = 'concrete' | 'reinforcement';

type Part = { id: string; name: string; kind: RcKind; role: string; description: string; notes: string[]; color: number };

export const RC_PARTS: readonly Part[] = [
  { id: 'footings', name: 'Footings', kind: 'concrete', color: 0x8f969e, role: 'Spread the column loads over a larger area of soil',
    description: 'Concrete pads under the columns. Soil can only take a limited pressure, so the footing spreads each column’s load over a wider area of ground.', notes: ['Isolated (pad) footings, one per column.'] },
  { id: 'columns', name: 'Columns', kind: 'concrete', color: 0xc4c8cd, role: 'Carry the loads from the beams down to the footings',
    description: 'Vertical members that collect the loads from the beams and carry them down, mainly in compression, to the footings.', notes: [] },
  { id: 'beams', name: 'Beams', kind: 'concrete', color: 0xd8d2c4, role: 'Carry the slab’s load sideways to the columns',
    description: 'Horizontal members spanning between the columns. They support the slab and bend under its load, carrying it to the columns.', notes: ['Shown below the slab; in a real building the beam and slab are usually cast together.'] },
  { id: 'slab', name: 'Slab', kind: 'concrete', color: 0xe6e5e1, role: 'Floor or roof plate that carries the loads placed on it',
    description: 'A thin concrete plate forming the floor or roof. It carries people, furniture and its own weight, and passes these loads to the beams around it.', notes: [] },
  { id: 'beam_column_joints', name: 'Beam-column joints', kind: 'concrete', color: 0xb3a3cf, role: 'Where beams and columns meet and transfer forces to each other',
    description: 'The concrete zone where a beam meets a column. Forces from the beams pass through it into the column, so it must be well confined by ties and the bars must be properly anchored in it.', notes: ['Highlighted in a different tone so the joint zone is easy to find.'] },
  { id: 'column_longitudinal_bars', name: 'Column longitudinal bars', kind: 'reinforcement', color: 0xc8502c, role: 'Vertical steel bars that help the column carry load and resist bending',
    description: 'Four vertical bars in the corners of each column, inside the concrete cover. They are bent into the footing at the bottom and into the joint at the top for anchorage.', notes: ['Concrete cover (about 40 mm here) protects the steel from rust and fire.'] },
  { id: 'column_ties', name: 'Column ties', kind: 'reinforcement', color: 0x2f62b0, role: 'Closed loops that hold the column bars in place and confine the concrete',
    description: 'Closed rectangular loops around the column bars at regular spacing. They keep the bars from buckling outwards and confine the concrete inside.', notes: [] },
  { id: 'beam_longitudinal_bars', name: 'Beam longitudinal bars', kind: 'reinforcement', color: 0xd9822b, role: 'Steel bars that resist tension in the beam',
    description: 'Bars along the length of each beam, at the top and the bottom. Concrete is weak in tension, so steel bars are placed where the beam is stretched by bending. Their ends are bent into the joints for anchorage.', notes: ['The bars of the two beam directions sit at slightly different heights so they can cross in the joint.'] },
  { id: 'beam_stirrups', name: 'Beam stirrups', kind: 'reinforcement', color: 0x3d78c9, role: 'Closed loops that resist shear in the beam and hold the bars',
    description: 'Closed loops around the beam bars along the span. They resist shear (the sliding effect near the supports) and hold the longitudinal bars in position.', notes: [] },
  { id: 'joint_reinforcement', name: 'Joint ties', kind: 'reinforcement', color: 0x7b4fc9, role: 'Ties continued through the joint to confine it',
    description: 'Column ties continued through the beam-column joint at closer spacing. They confine the joint concrete so it can transfer forces between beams and columns.', notes: [] },
  { id: 'slab_reinforcement', name: 'Slab reinforcement', kind: 'reinforcement', color: 0x2e9a63, role: 'Bar mesh near the bottom of the slab',
    description: 'A mesh of bars in both directions near the bottom of the slab, where the slab is stretched as it bends under load.', notes: ['Only the bottom mesh is shown.'] },
  { id: 'footing_reinforcement', name: 'Footing reinforcement', kind: 'reinforcement', color: 0x1f8a8a, role: 'Bar mesh near the bottom of each footing',
    description: 'A mesh of bars in both directions near the bottom of each footing, where the footing bends as the soil pushes up on it.', notes: [] },
];

export const RC_COMPONENT_IDS: readonly string[] = RC_PARTS.map((p) => p.id);
export const RC_CONCRETE_IDS: readonly string[] = RC_PARTS.filter((p) => p.kind === 'concrete').map((p) => p.id);
export const RC_REINFORCEMENT_IDS: readonly string[] = RC_PARTS.filter((p) => p.kind === 'reinforcement').map((p) => p.id);

export const RC_RELATIONSHIP_EDGES: readonly RelationshipEdge[] = [
  { from: 'slab', type: 'transfers_force_to', to: 'beams', description: 'The slab passes its load to the beams around it.', evidence: 'Load-path illustration (not an analysis).' },
  { from: 'beams', type: 'transfers_force_to', to: 'beam_column_joints', description: 'The beams pass their load into the beam-column joints.', evidence: 'Load-path illustration.' },
  { from: 'beam_column_joints', type: 'transfers_force_to', to: 'columns', description: 'The joints pass the load down into the columns.', evidence: 'Load-path illustration.' },
  { from: 'columns', type: 'transfers_force_to', to: 'footings', description: 'The columns carry the load down to the footings, which spread it into the soil.', evidence: 'Load-path illustration.' },
  { from: 'column_ties', type: 'supports', to: 'column_longitudinal_bars', description: 'Ties hold the column bars in place and stop them buckling.', evidence: 'Model reinforcement layout.' },
  { from: 'beam_stirrups', type: 'supports', to: 'beam_longitudinal_bars', description: 'Stirrups hold the beam bars in position.', evidence: 'Model reinforcement layout.' },
  { from: 'joint_reinforcement', type: 'supports', to: 'beam_column_joints', description: 'Joint ties confine the joint concrete.', evidence: 'Model reinforcement layout.' },
  { from: 'beam_longitudinal_bars', type: 'fastened_to', to: 'beam_column_joints', description: 'Beam bars are anchored by bending them into the joints.', evidence: 'Model reinforcement layout.' },
  { from: 'column_longitudinal_bars', type: 'fastened_to', to: 'footings', description: 'Column bars are anchored by bending them into the footings.', evidence: 'Model reinforcement layout.' },
  { from: 'column_longitudinal_bars', type: 'connected_to', to: 'columns', description: 'The column bars are embedded in the column concrete.', evidence: 'Model reinforcement layout.' },
  { from: 'beam_longitudinal_bars', type: 'connected_to', to: 'beams', description: 'The beam bars are embedded in the beam concrete.', evidence: 'Model reinforcement layout.' },
  { from: 'slab_reinforcement', type: 'connected_to', to: 'slab', description: 'The slab mesh is embedded near the bottom of the slab.', evidence: 'Model reinforcement layout.' },
  { from: 'footing_reinforcement', type: 'connected_to', to: 'footings', description: 'The footing mesh is embedded near the bottom of the footing.', evidence: 'Model reinforcement layout.' },
];
const RELATIONSHIPS = buildRelationshipIndex(RC_RELATIONSHIP_EDGES);

const META = new Map<string, CivilComponentMetadata>(RC_PARTS.map((p) => [p.id, {
  id: p.id, name: p.name, domain: 'civil', role: p.role, description: p.description,
  materialName: p.kind === 'concrete' ? 'Reinforced concrete (schematic)' : 'Steel reinforcing bar (schematic)',
  specifications: [], engineeringNotes: p.notes, educationalNotes: p.notes, relationships: RELATIONSHIPS.get(p.id) ?? [],
}]));

export function getRcFrameAssemblyTree(): AssemblyTreeNode {
  // Tree names also feed the voice lexicon: "foundation" names the footings
  const TREE_NAME: Record<string, string> = { footings: 'Footings (foundation)' };
  const leaf = (id: string): AssemblyTreeNode => ({ id: `node_${id}`, name: TREE_NAME[id] ?? META.get(id)!.name, type: 'component', componentId: id, defaultVisible: true });
  return {
    id: 'rc_frame_root', name: 'Reinforced concrete frame (one bay)', type: 'assembly', defaultExpanded: true,
    children: [
      { id: 'grp_concrete', name: 'Concrete members', type: 'subassembly', defaultExpanded: true, children: RC_CONCRETE_IDS.map(leaf) },
      { id: 'grp_steel', name: 'Reinforcement', type: 'subassembly', defaultExpanded: true, children: RC_REINFORCEMENT_IDS.map(leaf) },
    ],
  };
}

/** Exploded layout: the steel cage comes forward (+z) out of the concrete; both groups layer vertically. */
const STEEL_OUT = 4.4;
export const RC_EXPLODE: Record<string, [number, number, number]> = {
  footings: [0, -0.9, 0],
  columns: [0, 0, 0],
  beam_column_joints: [0, 0.55, 0],
  beams: [0, 1.0, 0],
  slab: [0, 2.0, 0],
  footing_reinforcement: [0, -0.9, STEEL_OUT],
  column_longitudinal_bars: [0, 0, STEEL_OUT],
  column_ties: [0, 0, STEEL_OUT + 0.9],
  joint_reinforcement: [0, 0.55, STEEL_OUT + 0.9],
  beam_longitudinal_bars: [0, 1.0, STEEL_OUT],
  beam_stirrups: [0, 1.0, STEEL_OUT + 0.9],
  slab_reinforcement: [0, 2.0, STEEL_OUT],
};

/* ------------------------------ geometry helpers ------------------------------ */

function polylineTube(points: THREE.Vector3[], radius: number, closed = false): THREE.BufferGeometry {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const pts = closed ? [...points, points[0]] : points;
  for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
  return new THREE.TubeGeometry(path as unknown as THREE.Curve<THREE.Vector3>, Math.max(8, (pts.length - 1) * 4), radius, 6, false);
}

/** Closed rectangular hoop in a horizontal (y) plane or a vertical plane normal to x or z. */
function hoop(center: THREE.Vector3, a: number, b: number, plane: 'y' | 'x' | 'z', radius: number): THREE.BufferGeometry {
  const c = center;
  const corners = plane === 'y'
    ? [[-a, 0, -b], [a, 0, -b], [a, 0, b], [-a, 0, b]]
    : plane === 'x'
      ? [[0, -a, -b], [0, a, -b], [0, a, b], [0, -a, b]]
      : [[-b, -a, 0], [-b, a, 0], [b, a, 0], [b, -a, 0]];
  return polylineTube(corners.map(([x, y, z]) => new THREE.Vector3(c.x + x, c.y + y, c.z + z)), radius, true);
}

const merge = (geos: THREE.BufferGeometry[]) => {
  const g = mergeGeometries(geos.map((x) => x.toNonIndexed()), false);
  geos.forEach((x) => x.dispose());
  return g!;
};

/* ------------------------------ scene ------------------------------ */

export interface RcFrameController {
  group: THREE.Group;
  parts: Map<string, THREE.Group>;
  loadPath: THREE.Group;
  setExplodedFactor: (f: number) => void;
  setCutaway: (on: boolean) => void;
  setLoadPath: (on: boolean) => void;
  dispose: () => void;
}

/** Plane through the front frame's centre line (z = +Z): the cutaway keeps everything behind it. */
export const RC_CUT_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, -1), Z);

let concreteTex: THREE.Texture | null | undefined;
/** Fine speckle like cast concrete, drawn once in a canvas (null where there is no DOM, e.g. tests). */
function concreteTexture(): THREE.Texture | null {
  if (concreteTex !== undefined) return concreteTex;
  if (typeof document === 'undefined') return (concreteTex = null);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  if (!g) return (concreteTex = null);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    const v = 200 + Math.floor(rnd() * 55);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return (concreteTex = tex);
}

export function buildRcFrame(): RcFrameController {
  const group = new THREE.Group();
  group.name = 'rc_frame';
  const parts = new Map<string, THREE.Group>();
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  for (const p of RC_PARTS) {
    const g = new THREE.Group();
    g.name = p.id;
    g.userData.componentId = p.id;
    parts.set(p.id, g);
    group.add(g);
    // Realistic finishes: cast concrete (footings a little darker, as in the ground) and plain steel
    // rebar inside it, as on a real building; the exploded view colour-codes every part
    const concrete = p.id === 'footings' ? 0x8f8c86 : p.id === 'slab' ? 0xa19e97 : 0x99968f;
    materials.set(p.id, new THREE.MeshStandardMaterial({
      color: p.kind === 'concrete' ? concrete : 0x6f5d4f,
      ...(p.kind === 'concrete' ? { map: concreteTexture() } : {}),
      roughness: p.kind === 'concrete' ? 0.92 : 0.55, metalness: p.kind === 'concrete' ? 0 : 0.7,
      side: p.kind === 'concrete' ? THREE.DoubleSide : THREE.FrontSide,
    }));
  }
  const addMesh = (id: string, geo: THREE.BufferGeometry, pos?: THREE.Vector3) => {
    const mesh = new THREE.Mesh(geo, materials.get(id)!);
    if (pos) mesh.position.copy(pos);
    mesh.userData.componentId = id;
    parts.get(id)!.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const { cover, col, beamW, mainBar, tieBar, slabBar } = RC;
  const half = col / 2;
  const jointH = RC.beamTop - RC.colTop;

  // ---- concrete ----
  for (const [x, z] of COLS) {
    addMesh('footings', box(RC.footing.w, RC.footing.h, RC.footing.w), v(x, RC.footing.bottom + RC.footing.h / 2, z));
    addMesh('columns', box(col, RC.colTop - FOOT_TOP, col), v(x, (FOOT_TOP + RC.colTop) / 2, z));
    addMesh('beam_column_joints', box(col, jointH, col), v(x, RC.colTop + jointH / 2, z));
  }
  const clearX = RC.spanX - col;
  const clearZ = RC.spanZ - col;
  for (const z of [-Z, Z]) addMesh('beams', box(clearX, jointH, beamW), v(0, RC.colTop + jointH / 2, z));
  for (const x of [-X, X]) addMesh('beams', box(beamW, jointH, clearZ), v(x, RC.colTop + jointH / 2, 0));
  addMesh('slab', box(RC.spanX + col, RC.slabT, RC.spanZ + col), v(0, RC.beamTop + RC.slabT / 2, 0));

  // ---- column bars (with 90° bends into the footing and into the joint) and ties ----
  const colBars: THREE.BufferGeometry[] = [];
  const ties: THREE.BufferGeometry[] = [];
  const jointTies: THREE.BufferGeometry[] = [];
  const inset = half - cover - tieBar * 2 - mainBar;
  const yBottom = RC.footing.bottom + cover + slabBar * 4 + mainBar;
  const yTop = SLAB_TOP - cover - mainBar * 2;
  for (const [x, z] of COLS) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const bx = x + sx * inset;
      const bz = z + sz * inset;
      const out = 0.3; // anchorage bend length
      colBars.push(polylineTube([
        v(bx + sx * out, yBottom, bz), v(bx, yBottom, bz), v(bx, yTop, bz), v(bx - sx * 0.2, yTop, bz),
      ], mainBar));
    }
    const a = half - cover - tieBar;
    for (let y = FOOT_TOP + 0.05; y < RC.colTop - 0.02; y += RC.tieSpacing) ties.push(hoop(v(x, y, z), a, a, 'y', tieBar));
    for (let y = RC.colTop + 0.05; y < RC.beamTop - 0.02; y += RC.jointTieSpacing) jointTies.push(hoop(v(x, y, z), a, a, 'y', tieBar));
  }
  addMesh('column_longitudinal_bars', merge(colBars));
  addMesh('column_ties', merge(ties));
  addMesh('joint_reinforcement', merge(jointTies));

  // ---- beam bars (top and bottom, bent into the joints) and stirrups ----
  const beamBars: THREE.BufferGeometry[] = [];
  const stirrups: THREE.BufferGeometry[] = [];
  const bw = beamW / 2 - cover - tieBar * 2 - mainBar;
  const yBot = RC.colTop + cover + tieBar * 2 + mainBar;
  const yTopBar = SLAB_TOP - cover - tieBar * 2 - mainBar;
  const ends = (L: number) => L / 2 + half - cover - mainBar * 4; // run through the joint to its far side
  for (const z of [-Z, Z]) {
    const e = ends(RC.spanX);
    for (const dz of [-bw, bw]) {
      beamBars.push(polylineTube([v(-e, yBot + 0.2, z + dz), v(-e, yBot, z + dz), v(e, yBot, z + dz), v(e, yBot + 0.2, z + dz)], mainBar));
      beamBars.push(polylineTube([v(-e, yTopBar - 0.2, z + dz), v(-e, yTopBar, z + dz), v(e, yTopBar, z + dz), v(e, yTopBar - 0.2, z + dz)], mainBar));
    }
    for (let x = -clearX / 2 + 0.05; x < clearX / 2 - 0.02; x += RC.tieSpacing) {
      stirrups.push(hoop(v(x, (yBot + yTopBar) / 2, z), (yTopBar - yBot) / 2 + mainBar + tieBar, bw + mainBar + tieBar, 'x', tieBar));
    }
  }
  const lift = mainBar * 2.5; // the other direction crosses above / below
  for (const x of [-X, X]) {
    const e = ends(RC.spanZ);
    for (const dx of [-bw, bw]) {
      beamBars.push(polylineTube([v(x + dx, yBot + lift + 0.2, -e), v(x + dx, yBot + lift, -e), v(x + dx, yBot + lift, e), v(x + dx, yBot + lift + 0.2, e)], mainBar));
      beamBars.push(polylineTube([v(x + dx, yTopBar - lift - 0.2, -e), v(x + dx, yTopBar - lift, -e), v(x + dx, yTopBar - lift, e), v(x + dx, yTopBar - lift - 0.2, e)], mainBar));
    }
    for (let z = -clearZ / 2 + 0.05; z < clearZ / 2 - 0.02; z += RC.tieSpacing) {
      stirrups.push(hoop(v(x, (yBot + yTopBar) / 2, z), (yTopBar - yBot) / 2 + mainBar + tieBar, bw + mainBar + tieBar, 'z', tieBar));
    }
  }
  addMesh('beam_longitudinal_bars', merge(beamBars));
  addMesh('beam_stirrups', merge(stirrups));

  // ---- slab and footing bottom meshes ----
  const slabBars: THREE.BufferGeometry[] = [];
  const sx = (RC.spanX + col) / 2 - cover;
  const sz = (RC.spanZ + col) / 2 - cover;
  const ys = RC.beamTop + cover;
  for (let z = -sz; z <= sz + 1e-6; z += RC.slabBarSpacing) slabBars.push(polylineTube([v(-sx, ys, z), v(sx, ys, z)], slabBar));
  for (let x = -sx; x <= sx + 1e-6; x += RC.slabBarSpacing) slabBars.push(polylineTube([v(x, ys + slabBar * 2, -sz), v(x, ys + slabBar * 2, sz)], slabBar));
  addMesh('slab_reinforcement', merge(slabBars));
  const footBars: THREE.BufferGeometry[] = [];
  const fh = RC.footing.w / 2 - cover;
  const yf = RC.footing.bottom + cover + slabBar;
  for (const [x, z] of COLS) {
    for (let d = -fh; d <= fh + 1e-6; d += RC.footingBarSpacing) {
      footBars.push(polylineTube([v(x - fh, yf, z + d), v(x + fh, yf, z + d)], slabBar));
      footBars.push(polylineTube([v(x + d, yf + slabBar * 2, z - fh), v(x + d, yf + slabBar * 2, z + fh)], slabBar));
    }
  }
  addMesh('footing_reinforcement', merge(footBars));

  // ---- load-path illustration (not a component, not an analysis) ----
  const loadPath = new THREE.Group();
  loadPath.name = 'load_path_overlay';
  loadPath.visible = false;
  const arrow = (from: THREE.Vector3, to: THREE.Vector3, color = 0xe8590c) => {
    const dir = to.clone().sub(from);
    const len = dir.length();
    const a = new THREE.ArrowHelper(dir.normalize(), from, len, color, Math.min(0.28, len * 0.35), 0.16);
    a.traverse((o) => { o.raycast = () => {}; });
    loadPath.add(a);
  };
  for (const [x, z] of [[-1, 0.9], [1, -0.9], [0, 0], [-1, -0.9], [1, 0.9]]) arrow(v(x, SLAB_TOP + 0.9, z), v(x, SLAB_TOP + 0.05, z)); // loads on the slab
  for (const z of [-Z, Z]) { arrow(v(-0.5, RC.beamTop + 0.02, z * 0.4), v(-0.5, RC.beamTop + 0.02, z * 0.92)); arrow(v(0.5, RC.beamTop + 0.02, z * 0.4), v(0.5, RC.beamTop + 0.02, z * 0.92)); } // slab -> beams
  for (const z of [-Z, Z]) { arrow(v(-0.6, RC.colTop - 0.25, z), v(-X + half + 0.05, RC.colTop - 0.25, z)); arrow(v(0.6, RC.colTop - 0.25, z), v(X - half - 0.05, RC.colTop - 0.25, z)); } // beams -> joints
  for (const [x, z] of COLS) arrow(v(x + 0.38 * Math.sign(x), RC.colTop - 0.3, z), v(x + 0.38 * Math.sign(x), FOOT_TOP + 0.15, z)); // columns -> footings
  for (const [x, z] of COLS) for (const dx of [-0.4, 0.4]) arrow(v(x + dx, RC.footing.bottom - 0.02, z), v(x + dx * 1.3, RC.footing.bottom - 0.55, z), 0x8d6e63); // into the soil
  group.add(loadPath);

  const base = new Map<THREE.Group, THREE.Vector3>([...parts.values()].map((g) => [g, g.position.clone()]));
  let loadPathOn = false;
  let exploded = 0;
  const concrete = new Set(RC_CONCRETE_IDS);
  return {
    group, parts, loadPath,
    setExplodedFactor: (f: number) => {
      const k = Math.max(0, Math.min(1, f));
      for (const [id, g] of parts) {
        const b = base.get(g)!;
        if (k === 0) g.position.copy(b);
        else g.position.copy(b).add(new THREE.Vector3(...(RC_EXPLODE[id] ?? [0, 0, 0])).multiplyScalar(k));
      }
      exploded = k;
      loadPath.visible = loadPathOn && k === 0; // the illustration belongs to the assembled frame
    },
    setCutaway: (on: boolean) => {
      for (const [id, m] of materials) {
        m.clippingPlanes = on && concrete.has(id) ? [RC_CUT_PLANE] : [];
        m.needsUpdate = true;
      }
    },
    setLoadPath: (on: boolean) => { loadPathOn = on; loadPath.visible = on && exploded === 0; },
    dispose: () => {
      group.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}

export const LOAD_PATH_NOTE =
  'Load path (illustration only): loads on the slab go to the beams, then through the joints into the columns, down to the footings and into the ground. This is not a structural analysis or a design calculation.';

export const rcFrameModel: EngineeringModelDefinition = {
  id: RC_FRAME_MODEL_ID,
  name: 'Reinforced Concrete Structural System Explorer',
  domain: 'civil',
  category: 'Building structures',
  description:
    'One bay of a reinforced concrete building frame — footings, columns, beams, slab and beam-column joints — with the steel reinforcement inside them, and an illustrated load path. A simplified educational model: not designed to any building code, and no loads or capacities are calculated.',
  thumbnailUrl: '',
  difficulty: 'Beginner',
  tags: ['Reinforced concrete', 'Load path', 'Beam-column joint', 'Structures'],
  componentCount: RC_COMPONENT_IDS.length,
  cameraConfig: { initialPosition: [6.2, 3.6, 7.6], target: [0, 0.5, 0], minDistance: 2, maxDistance: 30, fov: 45, defaultPreset: 'isometric' },
  getAssemblyTree: getRcFrameAssemblyTree,
  getComponentMetadata: (id) => META.get(id) ?? null,
  getAllComponentIds: () => [...RC_COMPONENT_IDS],
  buildScene: (scene: Scene): ModelRuntimeInstance => {
    const c = buildRcFrame();
    scene.add(c.group);
    return {
      rootGroup: c.group,
      setExplodedFactor: c.setExplodedFactor,
      setCutaway: c.setCutaway,
      setOverlay: (id: string, on: boolean) => { if (id === 'loadPath') c.setLoadPath(on); },
      dispose: () => { scene.remove(c.group); c.dispose(); },
    };
  },
  cutaway: { label: 'Section' },
  insideView: { hideComponentIds: [...RC_CONCRETE_IDS], label: 'Reinforcement' },
  overlays: [{ id: 'loadPath', label: 'Load path', note: LOAD_PATH_NOTE }],
  hologramEdges: true,
};
