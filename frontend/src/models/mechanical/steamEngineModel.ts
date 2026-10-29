/**
 * Steam Engine Explorer — a steam LOCOMOTIVE (0-6-0, two outside cylinders), drawn by default as a
 * white technical wireframe like an engineering x-ray illustration. Procedural educational model:
 * proportions are representative, not taken from a specific historical locomotive.
 *
 * Kinematics (one driving-axle angle θ drives everything; the two sides are "quartered", the left
 * side 90° ahead of the right, so the engine can always start):
 *   crank pin (driving wheel)  P = (r cos φ, r sin φ)                    φ = θ (right), θ + 90° (left)
 *   crosshead                  x_c(φ) = r cos φ − sqrt(l² − r² sin² φ)    (exact slider-crank, rod length l)
 *   piston, piston rod rigidly follow the crosshead along the cylinder axis
 *   connecting rod             from the crosshead pin to the driving crank pin (angle atan2)
 *   coupling rods              translate with the crank pins (all wheels turn together)
 *   slide valve                offset slider-crank: the return crank (radius e, set 90° + advance ahead
 *                              of the crank) drives the eccentric rod (length L) to a valve-rod joint
 *                              at the height h of the steam chest
 * The valve gear is a simplified single-eccentric gear (no Walschaerts expansion link or reversing).
 * The animation shows motion only: no steam pressure, heat or forces are simulated, and the
 * locomotive stays in place on the track while its wheels turn.
 */

import * as THREE from 'three';
import type { Scene } from 'three';
import type { AssemblyTreeNode, EngineeringModelDefinition, ModelRuntimeInstance } from '../../types/models';
import type { MechanicalComponentMetadata } from '../../types/engineering';
import { buildRelationshipIndex, type RelationshipEdge } from '../../services/scene/relationshipTable';

export const STEAM_ENGINE_MODEL_ID = 'steam_engine';

/* ------------------------------ geometry constants (scene units) ------------------------------ */

export const ENGINE = {
  crankRadius: 0.3, // r: stroke = 0.6
  rodLength: 2.0, // l: connecting rod (crosshead pin to driving crank pin)
  pistonRodLength: 1.1, // crosshead pin to piston centre
  wheelRadius: 0.62,
  axleX: [-1.45, 0, 1.45] as readonly number[], // leading, driving (middle), trailing axle
  wheelZ: 0.72, // wheel centre plane (track gauge / 2)
  couplingZ: 0.87, // coupling-rod plane
  rodZ: 0.98, // cylinder axis, piston, crosshead and connecting-rod plane
  valveGearZ: 1.12, // return crank and eccentric rod plane
  cylinderX: -3.1, // cylinder centre
  bore: 0.44,
  eccentricRadius: 0.12, // e: valve travel ≈ 2e
  eccentricRodLength: 2.35, // L
  valveHeight: 0.42, // h: valve rod / steam chest height above the cylinder axis
  valveRodLength: 0.75,
  valveAdvance: (15 * Math.PI) / 180, // angle of advance (lead) beyond 90°
  boilerY: 1.3,
  revPerSecond: 0.5, // at animation speed 1
} as const;

/** Side angle: the left side is quartered 90° ahead of the right. */
export const sideAngle = (theta: number, side: 1 | -1) => (side === 1 ? theta : theta + Math.PI / 2);

/** Exact slider-crank position along the axis (slider on the −x side of the shaft), slider at height h. */
export function sliderPosition(theta: number, r: number, l: number, h = 0): number {
  const s = h - r * Math.sin(theta);
  return r * Math.cos(theta) - Math.sqrt(l * l - s * s);
}

export function crossheadX(phi: number): number {
  return sliderPosition(phi, ENGINE.crankRadius, ENGINE.rodLength);
}
export function pistonX(phi: number): number {
  return crossheadX(phi) - ENGINE.pistonRodLength;
}
/** Return crank set 90° + advance ahead of the crank. */
export function eccentricAngle(phi: number): number {
  return phi + Math.PI / 2 + ENGINE.valveAdvance;
}
export function valveJointX(phi: number): number {
  return sliderPosition(eccentricAngle(phi), ENGINE.eccentricRadius, ENGINE.eccentricRodLength, ENGINE.valveHeight);
}
export function valveX(phi: number): number {
  return valveJointX(phi) - ENGINE.valveRodLength;
}

/** Mid-travel position of the slide valve (the steam chest is centred on it). */
export const VALVE_MID = (() => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 720; i++) {
    const v = valveX((i * Math.PI) / 360);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return (lo + hi) / 2;
})();

/* ------------------------------ metadata ------------------------------ */

type Part = { id: string; name: string; role: string; description: string; notes: string[]; group: string };

export const STEAM_ENGINE_PARTS: readonly Part[] = [
  // Boiler and body
  { id: 'firebox', name: 'Firebox', group: 'Boiler (heat input)', role: 'Where the fuel burns to heat the water',
    description: 'A box at the back of the boiler, surrounded by water. Coal (or wood or oil) burns here; the hot gases then pass forward through tubes inside the boiler. This is the heat input of the locomotive.', notes: [] },
  { id: 'boiler', name: 'Boiler', group: 'Boiler (heat input)', role: 'Turns water into high-pressure steam',
    description: 'The long barrel full of water. Hot gases from the firebox flow through fire tubes inside it and boil the water; the steam collects at the top under pressure.', notes: ['The tubes inside the barrel are not drawn in this model.'] },
  { id: 'steam_dome', name: 'Steam dome', group: 'Boiler (heat input)', role: 'Collects dry steam at the highest point',
    description: 'A dome on top of the boiler. Steam is taken from here, as high as possible above the water, so little water is carried into the cylinders. The regulator (throttle) valve sits inside it.', notes: [] },
  { id: 'smokebox', name: 'Smokebox', group: 'Boiler (heat input)', role: 'Front chamber where smoke and exhaust steam meet',
    description: 'The chamber at the front of the boiler. Smoke from the fire tubes arrives here and leaves up the chimney, pulled by the exhaust steam from the blast pipe.', notes: [] },
  { id: 'chimney', name: 'Chimney', group: 'Boiler (heat input)', role: 'Lets smoke and used steam out',
    description: 'The chimney on the smokebox. Each puff of exhaust steam up the chimney draws air through the fire: this "draught" keeps the fire burning hot.', notes: [] },
  { id: 'cab', name: 'Cab', group: 'Body and frame', role: 'Where the crew drives the locomotive and fires the boiler',
    description: 'The driver and fireman work here: the regulator, reverser and brake are controlled from the cab, and fuel is fed into the firebox.', notes: ['Cab controls are not modelled.'] },
  { id: 'frame', name: 'Main frame', group: 'Body and frame', role: 'Strong frame that carries the boiler, cylinders and axles',
    description: 'Two strong steel plates joined by buffer beams, with the running board on top. The cylinders are bolted to it and the axles run in bearings (axleboxes) in it.', notes: [] },
  // Steam circuit
  { id: 'steam_pipe', name: 'Steam pipe', group: 'Steam circuit', role: 'Carries steam from the dome to the cylinders',
    description: 'Steam leaves the dome through the regulator, runs forward inside the boiler and comes out at the smokebox sides down to each steam chest.', notes: [] },
  { id: 'steam_chest', name: 'Steam chest', group: 'Steam circuit', role: 'Box that holds live steam above each cylinder',
    description: 'A box on top of each cylinder filled with steam. The slide valve inside it decides which end of the cylinder the steam goes to.', notes: [] },
  { id: 'slide_valve', name: 'Slide valve', group: 'Steam circuit', role: 'Lets steam in to one end of the cylinder and out of the other',
    description: 'A sliding block (D-valve) that uncovers the steam ports in turn: it admits steam to one end of the cylinder while letting used steam leave the other end to the exhaust.', notes: [] },
  { id: 'steam_ports', name: 'Steam ports', group: 'Steam circuit', role: 'Passages between the steam chest and the cylinder ends',
    description: 'Short passages from the valve face to each end of the cylinder. Steam enters and leaves the cylinder through them.', notes: [] },
  { id: 'cylinder', name: 'Cylinders', group: 'Steam circuit', role: 'Closed chambers in which steam pressure pushes the pistons',
    description: 'One cylinder on each side, closed by covers at both ends. They are double-acting: steam pushes each piston first from one side, then from the other.', notes: ['The two sides are set 90° apart ("quartered") so the engine can always start.'] },
  { id: 'blast_pipe', name: 'Blast pipe', group: 'Steam circuit', role: 'Sends used steam up the chimney',
    description: 'Exhaust steam from both cylinders is led into the smokebox and blasted up the chimney. This makes the familiar "chuff" and draws the fire.', notes: [] },
  // Motion
  { id: 'piston', name: 'Pistons', group: 'Motion (moving parts)', role: 'Discs pushed back and forth by steam pressure',
    description: 'A close-fitting disc inside each cylinder. Steam pressure on one face pushes it along: this is where heat energy (as steam pressure) becomes straight-line motion.', notes: ['Stroke = 2 × crank radius.'] },
  { id: 'piston_rod', name: 'Piston rods', group: 'Motion (moving parts)', role: 'Carry the piston’s push and pull out of the cylinder',
    description: 'A straight rod fixed to each piston. It passes through the cylinder cover and moves in a straight line with the piston.', notes: [] },
  { id: 'crosshead', name: 'Crossheads', group: 'Motion (moving parts)', role: 'Sliding blocks that keep the piston rods straight',
    description: 'A block sliding between the slide bars. It joins the straight-moving piston rod to the swinging connecting rod and takes the sideways force.', notes: [] },
  { id: 'crosshead_guides', name: 'Crosshead guides', group: 'Motion (moving parts)', role: 'Straight guides for the crossheads',
    description: 'Straight bars (crosshead guides) that keep each crosshead moving along the cylinder axis.', notes: [] },
  { id: 'connecting_rod', name: 'Connecting rods', group: 'Motion (moving parts)', role: 'Link the straight motion of the crosshead to the turning driving wheel',
    description: 'One end moves straight with the crosshead, the other goes round with the crank pin on the middle (driving) wheel. Together with the crank pin it turns back-and-forth motion into rotation.', notes: [] },
  { id: 'crank', name: 'Crank pins', group: 'Motion (moving parts)', role: 'Pins on the wheels that the rods turn',
    description: 'Pins fixed in the wheels at a distance from the axle (the crank radius). The connecting rod pushes the driving crank pin round a circle; the coupling rods use the pins on every wheel.', notes: [] },
  { id: 'coupling_rods', name: 'Coupling rods', group: 'Motion (moving parts)', role: 'Make all six wheels turn together',
    description: 'Rods joining the crank pins of the three wheels on each side, so every wheel drives and the locomotive grips the rails better.', notes: [] },
  // Wheels
  { id: 'driving_wheels', name: 'Driving wheels', group: 'Wheels (mechanical output)', role: 'Turn on the rails and move the train',
    description: 'Six coupled wheels. Their rotation is the mechanical output of the engine. Their weight also acts like a flywheel, and the balance weights opposite the crank pins balance the rods.', notes: [] },
  { id: 'axles', name: 'Axles', group: 'Wheels (mechanical output)', role: 'Join each pair of wheels and carry the weight',
    description: 'Steel shafts pressed into each pair of wheels. The middle one is the driving axle; it also carries the valve-gear return cranks.', notes: [] },
  // Valve gear
  { id: 'eccentric', name: 'Return cranks', group: 'Valve gear', role: 'Small cranks that drive the valve in step with the wheels',
    description: 'A short arm on each driving crank pin, set about 90° ahead of the crank. As the wheel turns it moves the eccentric rod back and forth, like a small crank.', notes: ['Simplified valve gear: real locomotives usually add an expansion link (e.g. Walschaerts) for reversing.'] },
  { id: 'eccentric_rod', name: 'Eccentric rods and valve rods', group: 'Valve gear', role: 'Transmit the return crank’s motion to the slide valve',
    description: 'Rods that carry the return crank’s back-and-forth motion forward to the slide valve in the steam chest.', notes: [] },
  // Context
  { id: 'track', name: 'Track', group: 'Track', role: 'Rails and sleepers (for context)',
    description: 'The rails the locomotive runs on. Shown for context only.', notes: [] },
];

export const STEAM_ENGINE_COMPONENT_IDS: readonly string[] = STEAM_ENGINE_PARTS.map((p) => p.id);

export const STEAM_ENGINE_RELATIONSHIP_EDGES: readonly RelationshipEdge[] = [
  { from: 'firebox', type: 'connected_to', to: 'boiler', description: 'Hot gases from the firebox pass through the boiler tubes and boil the water.', evidence: 'Model geometry.' },
  { from: 'boiler', type: 'connected_to', to: 'steam_dome', description: 'Steam collects in the dome on top of the boiler.', evidence: 'Model geometry.' },
  { from: 'steam_dome', type: 'connected_to', to: 'steam_pipe', description: 'Steam leaves the dome through the steam pipe.', evidence: 'Model geometry.' },
  { from: 'steam_pipe', type: 'connected_to', to: 'steam_chest', description: 'The steam pipe feeds each steam chest.', evidence: 'Model geometry.' },
  { from: 'slide_valve', type: 'connected_to', to: 'steam_ports', description: 'The slide valve opens the ports to each cylinder end in turn.', evidence: 'Valve kinematics.' },
  { from: 'steam_ports', type: 'connected_to', to: 'cylinder', description: 'The ports lead steam into and out of the cylinder ends.', evidence: 'Model geometry.' },
  { from: 'slide_valve', type: 'connected_to', to: 'blast_pipe', description: 'Used steam leaves through the valve cavity to the blast pipe.', evidence: 'Model geometry.' },
  { from: 'blast_pipe', type: 'connected_to', to: 'chimney', description: 'The blast pipe sends the exhaust steam up the chimney.', evidence: 'Model geometry.' },
  { from: 'smokebox', type: 'supports', to: 'chimney', description: 'The chimney stands on the smokebox.', evidence: 'Model geometry.' },
  { from: 'piston', type: 'drives', to: 'piston_rod', description: 'Steam pressure on the piston pushes the piston rod.', evidence: 'Rigid link in the kinematic model.' },
  { from: 'piston_rod', type: 'drives', to: 'crosshead', description: 'The piston rod moves the crosshead along its slide bars.', evidence: 'Rigid link in the kinematic model.' },
  { from: 'crosshead_guides', type: 'supports', to: 'crosshead', description: 'The slide bars keep the crosshead moving in a straight line.', evidence: 'Model geometry.' },
  { from: 'crosshead', type: 'drives', to: 'connecting_rod', description: 'The crosshead pushes and pulls the connecting rod.', evidence: 'Slider-crank kinematics.' },
  { from: 'connecting_rod', type: 'drives', to: 'crank', description: 'The connecting rod turns the driving crank pin around the axle.', evidence: 'Slider-crank kinematics.' },
  { from: 'crank', type: 'drives', to: 'driving_wheels', description: 'The crank pins are fixed in the wheels and turn them.', evidence: 'Rigid in the wheel.' },
  { from: 'coupling_rods', type: 'drives', to: 'driving_wheels', description: 'The coupling rods make all the wheels turn together.', evidence: 'Parallel-rod kinematics.' },
  { from: 'driving_wheels', type: 'drives', to: 'axles', description: 'Each pair of wheels turns with its axle.', evidence: 'Rigid on the axle.' },
  { from: 'crank', type: 'drives', to: 'eccentric', description: 'The return crank turns with the driving crank pin.', evidence: 'Rigid on the crank pin.' },
  { from: 'eccentric', type: 'drives', to: 'eccentric_rod', description: 'The return crank moves the eccentric rod back and forth.', evidence: 'Valve kinematics.' },
  { from: 'eccentric_rod', type: 'drives', to: 'slide_valve', description: 'The valve rod moves the slide valve.', evidence: 'Valve kinematics.' },
  { from: 'frame', type: 'supports', to: 'cylinder', description: 'The frame carries the cylinders.', evidence: 'Model geometry.' },
  { from: 'frame', type: 'supports', to: 'boiler', description: 'The frame carries the boiler.', evidence: 'Model geometry.' },
  { from: 'frame', type: 'supports', to: 'axles', description: 'The axles run in bearings in the frame.', evidence: 'Model geometry.' },
];
const RELATIONSHIPS = buildRelationshipIndex(STEAM_ENGINE_RELATIONSHIP_EDGES);

const META = new Map<string, MechanicalComponentMetadata>(STEAM_ENGINE_PARTS.map((p) => [p.id, {
  id: p.id, name: p.name, domain: 'mechanical', role: p.role, description: p.description, materialName: '',
  specifications: [], engineeringNotes: p.notes, relationships: RELATIONSHIPS.get(p.id) ?? [],
}]));

export function getSteamEngineAssemblyTree(): AssemblyTreeNode {
  const groups = [...new Set(STEAM_ENGINE_PARTS.map((p) => p.group))];
  return {
    id: 'steam_engine_root', name: 'Steam Locomotive', type: 'assembly', defaultExpanded: true,
    children: groups.map((g) => ({
      id: `grp_${g.replace(/\W+/g, '_').toLowerCase()}`, name: g, type: 'subassembly' as const, defaultExpanded: true,
      children: STEAM_ENGINE_PARTS.filter((p) => p.group === g).map((p) => ({
        id: `node_${p.id}`, name: p.name, type: 'component' as const, componentId: p.id, defaultVisible: true,
      })),
    })),
  };
}

/* ------------------------------ exploded layout ------------------------------ */

/**
 * Exploded offsets (scene units). For parts that exist on both sides (cylinders, rods, wheels…) the
 * z value is "outwards": each side moves away from the centre line. The boiler parts lift and
 * spread along the length; the motion fans out sideways in the order steam drives it (cylinder →
 * piston → rods → crank pins → wheels); the frame and track drop.
 */
export const STEAM_ENGINE_EXPLODE: Record<string, [number, number, number]> = {
  chimney: [-0.5, 2.0, 0],
  smokebox: [-1.3, 1.1, 0],
  boiler: [0, 1.15, 0],
  steam_dome: [0, 2.05, 0],
  firebox: [1.0, 0.45, 0],
  cab: [1.9, 1.5, 0],
  steam_pipe: [-0.4, 0.75, 0.45],
  blast_pipe: [-1.2, 0.1, 0],
  frame: [0, -0.8, 0],
  track: [0, -1.3, 0],
  cylinder: [-0.9, 0, 0.75],
  steam_chest: [-0.9, 1.0, 0.75],
  slide_valve: [-0.9, 0.6, 1.25],
  steam_ports: [-0.9, 0.3, 1.0],
  piston: [-1.4, 0, 1.35],
  piston_rod: [-0.8, 0, 1.7],
  crosshead: [-0.3, 0, 1.95],
  crosshead_guides: [-0.3, -0.5, 1.95],
  connecting_rod: [0.35, 0.15, 1.6],
  crank: [0, 0.3, 1.05],
  coupling_rods: [0, -0.35, 1.3],
  driving_wheels: [0, -0.45, 0.6],
  axles: [0, -0.45, 0],
  eccentric: [0.45, 0.6, 1.7],
  eccentric_rod: [0.2, 1.05, 2.05],
};

/* ------------------------------ scene ------------------------------ */

const STEEL = 0x9aa3ad;
const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4, ...extra });

/** Solid-view colours (the default look is the x-ray wireframe). */
const SOLID_COLORS: Record<string, number> = {
  boiler: 0x1f3b2d, smokebox: 0x23262b, chimney: 0x23262b, steam_dome: 0xb08a3e, firebox: 0x1f3b2d, cab: 0x1f3b2d,
  frame: 0x7a1f1f, track: 0x5c5148, driving_wheels: 0x1f3b2d, axles: STEEL, cylinder: 0x2a2d33, steam_chest: 0x2a2d33,
  slide_valve: 0xd4b06a, steam_ports: 0x7d93ad, steam_pipe: 0xb5463c, blast_pipe: 0x6c7a89, piston: 0xc9cdd3,
  piston_rod: 0xd0d5db, crosshead: 0xd9a441, crosshead_guides: 0xb8bec6, connecting_rod: 0xc0c7cf, crank: 0xd0d5db,
  coupling_rods: 0xc0c7cf, eccentric: 0xc77d3a, eccentric_rod: 0xd4b06a,
};

const PAINTED = new Set(['boiler', 'smokebox', 'chimney', 'firebox', 'cab', 'frame', 'driving_wheels', 'cylinder', 'steam_chest']);

export interface SteamEngineController {
  group: THREE.Group;
  /** Advances the driving axle by the elapsed time (frozen while exploded). */
  update: (deltaSeconds: number) => void;
  setCrankAngle: (theta: number) => void;
  getCrankAngle: () => number;
  setExplodedFactor: (f: number) => void;
  setCutaway: (on: boolean) => void;
  reset: () => void;
  /** Component groups (each holds one child group per side, or one centre child). */
  parts: Map<string, THREE.Object3D>;
  /** Side child of a component: side 1 = right (+z), -1 = left, 0 = centre parts. */
  piece: (id: string, side: 1 | -1 | 0) => THREE.Object3D | undefined;
  dispose: () => void;
}

const SIDES = [1, -1] as const;

export function buildSteamEngine(): SteamEngineController {
  const E = ENGINE;
  const r = E.crankRadius;
  const group = new THREE.Group();
  group.name = 'steam_engine';
  const parts = new Map<string, THREE.Object3D>();
  const pieces = new Map<string, THREE.Group>(); // `${id}:${side}`
  const materials: THREE.Material[] = [];
  const matFor = new Map<string, THREE.MeshStandardMaterial>();
  const m = (id: string) => {
    let x = matFor.get(id);
    if (!x) {
      // Realistic finishes: glossy painted body, polished brass dome, bright steel motion work
      const finish = PAINTED.has(id) ? { metalness: 0.25, roughness: 0.42 } : id === 'steam_dome' ? { metalness: 0.95, roughness: 0.25 }
        : id === 'track' ? { metalness: 0.2, roughness: 0.85 } : { metalness: 0.95, roughness: 0.3 };
      x = mat(SOLID_COLORS[id] ?? STEEL, { ...finish, ...(id === 'cylinder' || id === 'steam_chest' ? { side: THREE.DoubleSide } : {}) });
      materials.push(x);
      matFor.set(id, x);
    }
    return x;
  };
  const piece = (id: string, side: 1 | -1 | 0) => {
    const key = `${id}:${side}`;
    let g = pieces.get(key);
    if (!g) {
      let pg = parts.get(id) as THREE.Group | undefined;
      if (!pg) {
        pg = new THREE.Group();
        pg.name = id;
        pg.userData.componentId = id;
        parts.set(id, pg);
        group.add(pg);
      }
      g = new THREE.Group();
      g.name = `${id}_${side === 1 ? 'right' : side === -1 ? 'left' : 'centre'}`;
      g.userData.componentId = id;
      g.userData.side = side;
      pieces.set(key, g);
      pg.add(g);
    }
    return g;
  };
  const add = (g: THREE.Group, geo: THREE.BufferGeometry, pos: [number, number, number], rot?: [number, number, number]) => {
    const mesh = new THREE.Mesh(geo, m(g.userData.componentId as string));
    mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    mesh.userData.componentId = g.userData.componentId;
    g.add(mesh);
    return mesh;
  };
  const tube = (g: THREE.Group, pts: [number, number, number][], radius: number, seg = 24) =>
    add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, radius, 10, false), [0, 0, 0]);
  const alongX: [number, number, number] = [0, 0, Math.PI / 2];
  const alongZ: [number, number, number] = [Math.PI / 2, 0, 0];
  const yB = E.boilerY;

  /* ---------- boiler and body (centre pieces) ---------- */
  const boiler = piece('boiler', 0);
  add(boiler, new THREE.CylinderGeometry(0.6, 0.6, 4.0, 32, 4, true), [-0.9, yB, 0], alongX);
  for (const x of [-2.4, -1.4, -0.2, 0.8]) add(boiler, new THREE.TorusGeometry(0.61, 0.018, 6, 40), [x, yB, 0], [0, Math.PI / 2, 0]); // boiler bands
  // fire tubes (drawn faintly inside the barrel)
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    add(boiler, new THREE.CylinderGeometry(0.05, 0.05, 3.9, 8, 1, true), [-0.9, yB - 0.08 + Math.sin(a) * 0.25, Math.cos(a) * 0.25], alongX);
  }

  const smoke = piece('smokebox', 0);
  add(smoke, new THREE.CylinderGeometry(0.64, 0.64, 0.95, 32, 2, true), [-3.37, yB, 0], alongX);
  add(smoke, new THREE.CylinderGeometry(0.6, 0.6, 0.06, 32), [-3.87, yB, 0], alongX); // door
  add(smoke, new THREE.TorusGeometry(0.62, 0.025, 6, 40), [-3.88, yB, 0], [0, Math.PI / 2, 0]);
  add(smoke, new THREE.CylinderGeometry(0.08, 0.08, 0.08, 12), [-3.93, yB, 0], alongX); // handle boss
  add(smoke, new THREE.BoxGeometry(0.8, 0.4, 1.0), [-3.37, 0.82, 0]); // saddle

  const chim = piece('chimney', 0);
  add(chim, new THREE.CylinderGeometry(0.16, 0.2, 0.62, 24, 3, true), [-3.45, 2.17, 0]);
  add(chim, new THREE.TorusGeometry(0.19, 0.04, 8, 28), [-3.45, 2.5, 0], [Math.PI / 2, 0, 0]); // cap lip
  add(chim, new THREE.CylinderGeometry(0.28, 0.24, 0.08, 24, 1, true), [-3.45, 1.89, 0]); // base flare

  const dome = piece('steam_dome', 0);
  add(dome, new THREE.CylinderGeometry(0.25, 0.28, 0.42, 24, 2, true), [-0.6, 1.98, 0]);
  add(dome, new THREE.SphereGeometry(0.25, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), [-0.6, 2.19, 0]);
  add(dome, new THREE.CylinderGeometry(0.06, 0.06, 0.5, 10, 1, true), [-0.6, 1.75, 0]); // regulator stand-pipe

  const fire = piece('firebox', 0);
  add(fire, new THREE.BoxGeometry(1.1, 1.0, 1.14, 3, 3, 3), [1.65, 1.05, 0]);
  add(fire, new THREE.CylinderGeometry(0.57, 0.57, 1.1, 28, 2, true, 0, Math.PI), [1.65, 1.55, 0], [0, 0, Math.PI / 2]);
  add(fire, new THREE.BoxGeometry(0.06, 0.32, 0.42), [2.22, 1.15, 0]); // fire door

  const cab = piece('cab', 0);
  add(cab, new THREE.BoxGeometry(0.05, 1.9, 1.9, 1, 4, 4), [2.22, 1.6, 0]); // front (spectacle) plate
  for (const z of [0.95, -0.95]) {
    add(cab, new THREE.BoxGeometry(1.0, 0.95, 0.04, 4, 2, 1), [2.72, 1.12, z]); // side sheets
    add(cab, new THREE.BoxGeometry(0.06, 0.95, 0.06), [3.2, 2.07, z]); // rear pillars
    add(cab, new THREE.TorusGeometry(0.15, 0.02, 6, 20), [2.19, 2.05, z * 0.5], [0, Math.PI / 2, 0]); // spectacle windows
  }
  add(cab, new THREE.CylinderGeometry(2.4, 2.4, 1.2, 48, 1, true, Math.PI / 2 - 0.42, 0.84), [2.72, 0.2, 0], alongX); // curved roof

  const frame = piece('frame', 0);
  for (const z of [0.5, -0.5]) add(frame, new THREE.BoxGeometry(7.2, 0.62, 0.05, 12, 1, 1), [-0.45, 0.25, z]);
  add(frame, new THREE.BoxGeometry(7.4, 0.04, 2.1, 12, 1, 3), [-0.45, 0.62, 0]); // running board
  for (const x of [-4.05, 3.15]) {
    add(frame, new THREE.BoxGeometry(0.12, 0.4, 2.1), [x, 0.42, 0]); // buffer beams
    for (const z of [0.62, -0.62]) {
      add(frame, new THREE.CylinderGeometry(0.06, 0.06, 0.3, 12), [x + Math.sign(x) * 0.2, 0.42, z], alongX);
      add(frame, new THREE.CylinderGeometry(0.15, 0.15, 0.04, 20), [x + Math.sign(x) * 0.36, 0.42, z], alongX);
    }
  }
  for (const x of E.axleX) for (const z of [0.5, -0.5]) add(frame, new THREE.BoxGeometry(0.3, 0.3, 0.1), [x, 0, z]); // axleboxes

  const track = piece('track', 0);
  for (const z of [E.wheelZ, -E.wheelZ]) add(track, new THREE.BoxGeometry(8.4, 0.1, 0.08), [-0.45, -E.wheelRadius - 0.05, z]);
  for (let x = -4.5; x <= 3.65; x += 0.6) add(track, new THREE.BoxGeometry(0.22, 0.07, 2.0), [x, -E.wheelRadius - 0.135, 0]);

  const blast = piece('blast_pipe', 0);
  add(blast, new THREE.CylinderGeometry(0.06, 0.09, 0.95, 12, 1, true), [-3.45, 1.2, 0]);
  add(blast, new THREE.CylinderGeometry(0.03, 0.06, 0.12, 12, 1, true), [-3.45, 1.73, 0]); // nozzle

  const sPipeC = piece('steam_pipe', 0);
  tube(sPipeC, [[-0.6, 1.55, 0], [-0.9, 1.62, 0], [-2.9, 1.62, 0], [-3.3, 1.5, 0]], 0.05); // inside the boiler

  /* ---------- each side (right first: it carries the label anchors) ---------- */
  const zR = E.rodZ;
  const cx = E.cylinderX;
  for (const s of SIDES) {
    const z = (v: number) => v * s;
    // Steam pipe outside the smokebox down to the steam chest
    tube(piece('steam_pipe', s), [[-3.3, 1.5, z(0.45)], [-3.25, 1.2, z(0.7)], [-3.15, 0.9, z(0.92)], [-3.1, E.valveHeight + 0.2, z(zR)]], 0.055);
    // Exhaust from the chest into the blast pipe
    tube(piece('blast_pipe', s), [[-3.3, E.valveHeight, z(zR - 0.16)], [-3.4, 0.62, z(0.5)], [-3.45, 0.74, z(0.1)]], 0.05);

    // Cylinder with covers and gland; double-sided so the cutaway shows the bore
    const cyl = piece('cylinder', s);
    add(cyl, new THREE.CylinderGeometry(E.bore / 2 + 0.06, E.bore / 2 + 0.06, 1.1, 28, 2, true), [cx, 0, z(zR)], alongX);
    for (const dx of [-0.57, 0.57]) add(cyl, new THREE.CylinderGeometry(E.bore / 2 + 0.1, E.bore / 2 + 0.1, 0.05, 28), [cx + dx, 0, z(zR)], alongX);
    add(cyl, new THREE.CylinderGeometry(0.06, 0.06, 0.12, 14), [cx + 0.65, 0, z(zR)], alongX); // gland
    add(cyl, new THREE.BoxGeometry(0.9, 0.2, 0.32), [cx, -0.02, z(zR - 0.32)]); // bolted to the frame

    const chest = piece('steam_chest', s);
    add(chest, new THREE.BoxGeometry(0.95, 0.26, 0.3, 3, 1, 1), [VALVE_MID, E.valveHeight, z(zR)]);
    const ports = piece('steam_ports', s);
    for (const dx of [-0.45, 0.45]) add(ports, new THREE.BoxGeometry(0.1, 0.2, 0.16), [cx + dx, 0.2, z(zR)]);
    const valve = piece('slide_valve', s);
    add(valve, new THREE.BoxGeometry(0.34, 0.14, 0.2), [0, 0, 0]);

    // Moving parts (local geometry; posed by setPose)
    add(piece('piston', s), new THREE.CylinderGeometry(E.bore / 2 - 0.01, E.bore / 2 - 0.01, 0.14, 28), [0, 0, 0], alongX);
    add(piece('piston_rod', s), new THREE.CylinderGeometry(0.035, 0.035, E.pistonRodLength, 12), [E.pistonRodLength / 2, 0, 0], alongX);
    add(piece('crosshead', s), new THREE.BoxGeometry(0.26, 0.16, 0.16), [0, 0, 0]);
    const guides = piece('crosshead_guides', s);
    for (const y of [0.11, -0.11]) add(guides, new THREE.BoxGeometry(1.0, 0.05, 0.14), [-2.0, y, z(zR)]);
    add(guides, new THREE.BoxGeometry(0.06, 0.36, 0.16), [-1.48, 0, z(zR)]); // motion bracket
    const cRod = piece('connecting_rod', s);
    add(cRod, new THREE.BoxGeometry(E.rodLength, 0.08, 0.05), [E.rodLength / 2, 0, 0]);
    add(cRod, new THREE.CylinderGeometry(0.07, 0.07, 0.07, 16), [0, 0, 0], alongZ);
    add(cRod, new THREE.CylinderGeometry(0.09, 0.09, 0.07, 16), [E.rodLength, 0, 0], alongZ);
    const coup = piece('coupling_rods', s);
    add(coup, new THREE.BoxGeometry(E.axleX[2] - E.axleX[0], 0.07, 0.04), [(E.axleX[0] + E.axleX[2]) / 2, 0, z(E.couplingZ)]);
    for (const x of E.axleX) add(coup, new THREE.CylinderGeometry(0.07, 0.07, 0.05, 14), [x, 0, z(E.couplingZ)], alongZ);
    const pins = piece('crank', s);
    for (const x of E.axleX) add(pins, new THREE.CylinderGeometry(0.04, 0.04, x === 0 ? 0.3 : 0.18, 10), [x, 0, z(x === 0 ? 0.92 : 0.84)], alongZ);
    // Return crank: from the driving crank pin to a point e from the axle, 90° + advance ahead
    const ret = piece('eccentric', s);
    const a0 = Math.PI / 2 + E.valveAdvance;
    const tip = new THREE.Vector2(E.eccentricRadius * Math.cos(a0), E.eccentricRadius * Math.sin(a0));
    const armLen = Math.hypot(tip.x - r, tip.y);
    add(ret, new THREE.BoxGeometry(armLen, 0.06, 0.04), [(r + tip.x) / 2, tip.y / 2, z(E.valveGearZ)], [0, 0, Math.atan2(tip.y, tip.x - r)]);
    add(ret, new THREE.CylinderGeometry(0.045, 0.045, 0.06, 12), [tip.x, tip.y, z(E.valveGearZ)], alongZ);
    const eRod = piece('eccentric_rod', s);
    add(eRod, new THREE.BoxGeometry(E.eccentricRodLength, 0.04, 0.035), [E.eccentricRodLength / 2, 0, 0]);
    const vRod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, E.valveRodLength, 10), m('eccentric_rod'));
    vRod.rotation.set(...alongX);
    vRod.userData.componentId = 'eccentric_rod';
    vRod.name = 'valve_rod';
    eRod.add(vRod);

    // Wheels: tyre, flange, hub, 12 spokes, balance weight, crank boss
    const wheels = piece('driving_wheels', s);
    for (let i = 0; i < E.axleX.length; i++) {
      const w = new THREE.Group();
      w.name = `wheel_${i}`;
      w.userData.componentId = 'driving_wheels';
      w.position.set(E.axleX[i], 0, z(E.wheelZ));
      wheels.add(w);
      add(w, new THREE.CylinderGeometry(E.wheelRadius, E.wheelRadius, 0.1, 40, 1, true), [0, 0, 0], alongZ);
      add(w, new THREE.TorusGeometry(E.wheelRadius - 0.06, 0.03, 6, 40), [0, 0, z(0.03)]);
      add(w, new THREE.TorusGeometry(E.wheelRadius + 0.02, 0.025, 6, 40), [0, 0, z(-0.05)]); // flange
      add(w, new THREE.CylinderGeometry(0.12, 0.12, 0.12, 20), [0, 0, 0], alongZ);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        add(w, new THREE.BoxGeometry(E.wheelRadius - 0.18, 0.04, 0.03), [Math.cos(a) * 0.34, Math.sin(a) * 0.34, z(0.02)], [0, 0, a]);
      }
      add(w, new THREE.CylinderGeometry(0.5, 0.5, 0.05, 24, 1, false, (3 * Math.PI) / 2 - 0.85, 1.7), [0, 0, z(0.04)], alongZ); // balance weight (opposite the pin)
      add(w, new THREE.CylinderGeometry(0.1, 0.1, 0.08, 16), [r, 0, z(0.06)], alongZ); // crank boss
    }
  }
  const axles = piece('axles', 0);
  for (const x of E.axleX) add(axles, new THREE.CylinderGeometry(0.07, 0.07, 2 * E.wheelZ + 0.1, 16, 1, true), [x, 0, 0], alongZ);

  /* ---------- pose ---------- */
  let theta = 0;
  let explode = 0;
  const off = new THREE.Vector3();
  const offset = (id: string, side: number) => {
    const o = STEAM_ENGINE_EXPLODE[id] ?? [0, 0, 0];
    return off.set(o[0], o[1], side === 0 ? o[2] : o[2] * side).multiplyScalar(explode);
  };

  /** Places every moving piece for axle angle θ, plus the exploded offsets. */
  const setPose = () => {
    for (const [key, g] of pieces) {
      const [id] = key.split(':');
      const s = g.userData.side as 1 | -1 | 0;
      const phi = s === 0 ? theta : sideAngle(theta, s);
      g.position.set(0, 0, 0);
      g.rotation.set(0, 0, 0);
      const xc = crossheadX(phi);
      const z = s * zR;
      switch (id) {
        case 'piston': g.position.set(xc - E.pistonRodLength, 0, z); break;
        case 'piston_rod': g.position.set(xc - E.pistonRodLength, 0, z); break;
        case 'crosshead': g.position.set(xc, 0, z); break;
        case 'connecting_rod': g.position.set(xc, 0, z + s * 0.02); g.rotation.set(0, 0, Math.atan2(r * Math.sin(phi), r * Math.cos(phi) - xc)); break;
        case 'coupling_rods': case 'crank': g.position.set(r * Math.cos(phi), r * Math.sin(phi), 0); break;
        case 'eccentric': g.rotation.set(0, 0, phi); break; // about the driving axle (x = 0)
        case 'driving_wheels': g.children.forEach((w) => w.rotation.set(0, 0, phi)); break;
        case 'axles': g.children.forEach((a) => a.rotation.set(Math.PI / 2, theta, 0)); break;
        case 'eccentric_rod': {
          const a = eccentricAngle(phi);
          const ex = E.eccentricRadius * Math.cos(a);
          const ey = E.eccentricRadius * Math.sin(a);
          const jx = valveJointX(phi);
          const ang = Math.atan2(E.valveHeight - ey, jx - ex);
          g.position.set(ex, ey, s * E.valveGearZ);
          g.rotation.set(0, 0, ang);
          // the guided valve rod stays horizontal from the joint forward to the valve (in the rod's frame)
          const vr = g.getObjectByName('valve_rod')!;
          const local = new THREE.Vector3(jx - E.valveRodLength / 2 - ex, E.valveHeight - ey, s * (zR - E.valveGearZ)).applyAxisAngle(new THREE.Vector3(0, 0, 1), -ang);
          vr.position.copy(local);
          vr.rotation.set(0, 0, Math.PI / 2 - ang);
          break;
        }
        case 'slide_valve': g.position.set(valveX(phi), E.valveHeight, z); break;
        default: break;
      }
      g.position.add(offset(id, s));
    }
  };
  setPose();

  // Cutaway: section the cylinders and steam chests along the cylinder axis plane, and the boiler,
  // smokebox and firebox down the centre line (the near half is removed)
  const cutPlanes = new Map<string, THREE.Plane>([
    ['cylinder', new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)],
    ['steam_chest', new THREE.Plane(new THREE.Vector3(0, 1, 0), -E.valveHeight)],
    ['boiler', new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)],
    ['smokebox', new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)],
    ['firebox', new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)],
  ]);
  const setCutaway = (on: boolean) => {
    for (const [id, plane] of cutPlanes) {
      const x = m(id);
      x.clippingPlanes = on ? [plane] : [];
      x.side = on || id === 'cylinder' || id === 'steam_chest' ? THREE.DoubleSide : THREE.FrontSide;
      x.needsUpdate = true;
    }
  };

  return {
    group,
    parts,
    piece: (id, side) => pieces.get(`${id}:${side}`),
    update: (dt: number) => {
      if (explode > 0) return; // safe behaviour: the mechanism holds still while exploded
      theta = (theta + dt * E.revPerSecond * Math.PI * 2) % (Math.PI * 2);
      setPose();
    },
    setCrankAngle: (t: number) => { theta = t; setPose(); },
    getCrankAngle: () => theta,
    setExplodedFactor: (f: number) => { explode = Math.max(0, Math.min(1, f)); setPose(); },
    setCutaway,
    reset: () => { theta = 0; setPose(); },
    dispose: () => {
      group.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
      materials.forEach((x) => x.dispose());
    },
  };
}

export const steamEngineModel: EngineeringModelDefinition = {
  id: STEAM_ENGINE_MODEL_ID,
  name: 'Steam Engine Explorer',
  domain: 'mechanical',
  category: 'Heat engines & mechanisms',
  description:
    'A steam locomotive (0-6-0 with two outside cylinders): the firebox heats the boiler, steam from the dome goes to the cylinders, and the pistons, crossheads, connecting and coupling rods turn the six driving wheels while the valve gear works the slide valves. Motion only: no thermodynamics is simulated.',
  thumbnailUrl: '',
  difficulty: 'Beginner',
  tags: ['Steam Engine', 'Steam Locomotive', 'Slider-crank', 'Heat engine', 'Mechanisms'],
  componentCount: STEAM_ENGINE_COMPONENT_IDS.length,
  cameraConfig: { initialPosition: [-7.2, 3.6, 6.4], target: [-0.6, 0.8, 0], minDistance: 2, maxDistance: 30, fov: 45, defaultPreset: 'isometric' },
  animations: [{
    id: 'steam_engine_cycle',
    label: 'Pistons, rods and wheels in motion',
    description: 'The pistons move back and forth; the crossheads and connecting rods turn the driving wheels, the coupling rods turn all six wheels together, and the return cranks move the slide valves in step (exact slider-crank geometry; no steam pressure or forces are simulated).',
  }],
  getAssemblyTree: getSteamEngineAssemblyTree,
  getComponentMetadata: (id) => META.get(id) ?? null,
  getAllComponentIds: () => [...STEAM_ENGINE_COMPONENT_IDS],
  buildScene: (scene: Scene): ModelRuntimeInstance => {
    const c = buildSteamEngine();
    scene.add(c.group);
    return {
      rootGroup: c.group,
      updateAnimation: (dt: number) => c.update(dt),
      setExplodedFactor: (f: number) => c.setExplodedFactor(f),
      setCutaway: (on: boolean) => c.setCutaway(on),
      resetAnimation: () => c.reset(),
      dispose: () => { scene.remove(c.group); c.dispose(); },
    };
  },
  cutaway: { label: 'Cutaway' },
  contextComponentIds: ['track'],
  explodeViewDirection: [-0.45, 0.75, 1],
  explodeFrameScale: 0.78,
  hologramEdges: true,
  // dense wireframe (every facet edge of curved parts), like a technical x-ray illustration
  xrayEdgeAngle: 1,
  animationControls: true,
};
