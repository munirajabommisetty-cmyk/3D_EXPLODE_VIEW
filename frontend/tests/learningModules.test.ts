/**
 * New learning modules (28 Oct 2026): Human Eye Explorer, Reinforced Concrete Structural System
 * Explorer, Steam Engine Explorer; catalogue, shared exploded view, navigation and voice.
 * The eye asset loader is MOCKED with synthetic meshes named like the real file; one test reads the
 * real GLB's JSON header (data only). No network, no live services.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as THREE from 'three';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import { WARREN_TRUSS_MODEL_ID } from '../src/models/civil/warrenTrussBridgeModel';
import { applyEyeExplode, buildOpticNerve, humanEyeModel, prepareEye, setEyeAssetLoader } from '../src/models/biology/eyeModel';
import { EYE_DESCRIBED_ONLY, EYE_MODEL_ID, EYE_STRUCTURES, OPTIC_NERVE_ID, eyeStructureForNode } from '../src/models/biology/eyeStructures';
import { buildRcFrame, LOAD_PATH_NOTE, RC_CONCRETE_IDS, RC_FRAME_MODEL_ID, RC_REINFORCEMENT_IDS, rcFrameModel } from '../src/models/civil/rcFrameModel';
import {
  buildSteamEngine, crossheadX, ENGINE, pistonX, sideAngle, STEAM_ENGINE_COMPONENT_IDS, STEAM_ENGINE_EXPLODE, STEAM_ENGINE_MODEL_ID,
  steamEngineModel, valveX, VALVE_MID,
} from '../src/models/mechanical/steamEngineModel';
import { getGuidedLessonForModel } from '../src/data/guidedLessons';
import { getDomainCounts } from '../src/utils/dashboardUtils';
import { handleVoiceTurn, type VoiceTurnResult } from '../src/services/voice/voiceSession';
import { buildComponentBrief } from '../src/services/teaching/componentBrief';
import { validateTeachingPlan } from '../src/services/teaching/teachingPlan';
import { componentLabels } from '../src/services/scene/explodePresentation';
import { ComponentRaycaster } from '../src/components/scene/ComponentRaycaster';
import { WorkspaceTopBar } from '../src/components/workspace/WorkspaceTopBar';
import { makeWorkspace } from './sceneContext.test';

const CATALOGUE = modelRegistry.getCatalogueModels();
const TELUGU = /[ఀ-౿]/;

/* ---------- synthetic eye: one small mesh per real node name, at the real centroids (metres) ---------- */
const EYE_NODES: Record<string, [number, number, number, number]> = {
  // [x, y, z, size] — centroids measured from VH_M_Eye_L.glb
  bulbar_conjunctiva: [0.0385, 0.8095, 0.0919, 0.016], palpebral_conjunctiva_of_upper_eyelid: [0.0385, 0.8134, 0.093, 0.016],
  palpebral_conjunctiva_of_lower_eyelid: [0.0386, 0.8054, 0.0928, 0.016], ora_serrata_of_retina: [0.0381, 0.8097, 0.0898, 0.015],
  corneo_scleral_junction: [0.0387, 0.8096, 0.0923, 0.012], pupil: [0.0385, 0.8093, 0.0924, 0.003],
  cornea: [0.0387, 0.8096, 0.094, 0.012], ciliary_body: [0.0385, 0.8094, 0.0904, 0.015], ciliary_muscle: [0.0384, 0.8094, 0.0905, 0.015],
  trabecular_meshwork: [0.0387, 0.8094, 0.0915, 0.011], aqueous_humor: [0.0384, 0.8094, 0.0924, 0.01], schlemms_canal: [0.0386, 0.8094, 0.0916, 0.011],
  optic_choroid: [0.0389, 0.8092, 0.0807, 0.022], iris: [0.0385, 0.8093, 0.0918, 0.011], lens: [0.0386, 0.8093, 0.0907, 0.008],
  vitreous_humor: [0.0389, 0.8094, 0.084, 0.021], suspensory_ligament_of_lens: [0.0386, 0.8094, 0.0904, 0.015],
  ciliary_processes: [0.0384, 0.8094, 0.0905, 0.013], retina: [0.0387, 0.8093, 0.0814, 0.022], fovea: [0.039, 0.8093, 0.0718, 0.002],
  macula_lutea: [0.039, 0.8093, 0.0719, 0.004], optic_disc: [0.0395, 0.8065, 0.0723, 0.002], sclera: [0.0387, 0.8092, 0.0832, 0.024],
};
function syntheticEye(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'VH_M_eye_L';
  for (const [n, [x, y, z, s]] of Object.entries(EYE_NODES)) {
    const g = new THREE.BoxGeometry(s, s, Math.max(0.001, s * 0.8));
    g.translate(x, y, z);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
    m.name = `VH_M_${n}_L`;
    root.add(m);
  }
  return root;
}
before(() => setEyeAssetLoader(async () => syntheticEye()));
after(() => setEyeAssetLoader(null));

type WS = ReturnType<typeof makeWorkspace>;
const turn = (w: WS, t: string, language = 'en-IN'): VoiceTurnResult =>
  handleVoiceTurn({ transcript: t, language, dispatcher: w.dispatcher, model: w.ws.model, allModels: CATALOGUE, teachingAvailable: true });
async function eyeWorkspace() {
  const w = makeWorkspace(humanEyeModel);
  await w.lifecycle.getActiveRuntime()!.ready;
  return w;
}

/** Centre of each component's meshes in world space. */
function centres(root: THREE.Object3D): Map<string, THREE.Vector3> {
  root.updateMatrixWorld(true);
  const boxes = new Map<string, THREE.Box3>();
  root.traverse((o) => {
    const id = o.userData?.componentId as string | undefined;
    if (!id || !(o as THREE.Mesh).isMesh) return;
    const b = boxes.get(id) ?? new THREE.Box3();
    b.expandByObject(o);
    boxes.set(id, b);
  });
  return new Map([...boxes].map(([id, b]) => [id, b.getCenter(new THREE.Vector3())]));
}
function pose(root: THREE.Object3D): string {
  const out: string[] = [];
  root.traverse((o) => out.push(`${o.name}:${o.position.toArray().map((v) => v.toFixed(9))}:${o.quaternion.toArray().map((v) => v.toFixed(9))}`));
  return out.join('|');
}

/* ===================== Catalogue ===================== */
describe('Catalogue after the milestone', () => {
  it('shows the eye, the reinforced concrete frame, the steam engine and the gearbox — no brain, no bridge', () => {
    const ids = CATALOGUE.map((m) => m.id).sort();
    assert.deepEqual(ids, [EYE_MODEL_ID, PLANETARY_GEARBOX_MODEL_ID, RC_FRAME_MODEL_ID, STEAM_ENGINE_MODEL_ID].sort());
    assert.ok(!modelRegistry.getModel('human_brain'), 'the brain module is removed');
    assert.equal(modelRegistry.getModel(WARREN_TRUSS_MODEL_ID)?.inCatalogue, false, 'bridge retired (kept only as a test fixture)');
    assert.equal(new Set(CATALOGUE.map((m) => m.name)).size, CATALOGUE.length, 'no duplicates');
    assert.deepEqual(getDomainCounts(CATALOGUE), { all: 4, mechanical: 2, civil: 1, medical: 1 });
  });

  it('every catalogue module has metadata for every component, a lesson, camera framing and an exploded view', () => {
    for (const m of CATALOGUE) {
      for (const id of m.getAllComponentIds()) assert.ok(m.getComponentMetadata(id)?.description, `${m.id}/${id}`);
      const lesson = getGuidedLessonForModel(m.id);
      assert.ok(lesson, m.id);
      for (const s of lesson!.steps) assert.ok(m.getAllComponentIds().includes(s.componentId), `${m.id} lesson -> ${s.componentId}`);
      assert.ok(m.cameraConfig.initialPosition && m.cameraConfig.maxDistance, m.id);
    }
  });

  it('switching between modules goes through the dispatcher and loads each model', async () => {
    const w = makeWorkspace();
    for (const id of [STEAM_ENGINE_MODEL_ID, RC_FRAME_MODEL_ID, EYE_MODEL_ID, PLANETARY_GEARBOX_MODEL_ID]) {
      const r = w.dispatcher.dispatch({ type: 'workspace.switchModel', modelId: id }, 'ui');
      assert.equal(r.status, 'executed', id);
      assert.equal(w.lifecycle.getActiveModel()?.id, id);
    }
  });
});

/* ===================== Human Eye Explorer ===================== */
describe('Human Eye Explorer', () => {
  it('every catalogued mesh exists in the downloaded file; the optic nerve is NOT in the file (so it is marked simplified)', () => {
    const buf = readFileSync(join(process.cwd(), 'public', 'assets', 'models', 'eye', 'VH_M_Eye_L.glb'));
    assert.equal(buf.toString('ascii', 0, 4), 'glTF');
    const doc = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12))) as { nodes: { name?: string }[] };
    const names = new Set(doc.nodes.map((n) => n.name));
    for (const s of EYE_STRUCTURES) for (const m of s.atlasMeshes) assert.ok(names.has(`VH_M_${m}_L`), `${s.id}: VH_M_${m}_L`);
    assert.ok(![...names].some((n) => /optic_nerve|rectus|oblique/.test(n ?? '')), 'no optic nerve or extraocular muscle meshes');
    const nerve = EYE_STRUCTURES.find((s) => s.id === OPTIC_NERVE_ID)!;
    assert.equal(nerve.representation, 'simplified');
    assert.match(nerve.name, /simplified/);
    assert.ok(EYE_DESCRIBED_ONLY.includes('extraocular muscles'));
  });

  it('loads (mocked), tags every mesh, and adds the simplified optic nerve at the optic disc', async () => {
    const w = await eyeWorkspace();
    const root = w.lifecycle.getActiveRuntime()!.rootGroup;
    const c = centres(root);
    for (const s of EYE_STRUCTURES) assert.ok(c.has(s.id), s.id);
    const nerve = root.getObjectByName('app_simplified_optic_nerve') as THREE.Mesh;
    assert.ok(nerve?.userData.simplified);
    assert.equal(eyeStructureForNode('VH_M_lens_L'), 'lens');
    assert.equal(eyeStructureForNode('VH_M_unknown_L'), null);
  });

  it('a loading failure is reported clearly', async () => {
    setEyeAssetLoader(async () => { throw new Error('404'); });
    try {
      const rt = humanEyeModel.buildScene(new THREE.Scene());
      await assert.rejects(rt.ready!, /eye model could not be loaded \(404\).*VH_M_Eye_L\.glb/);
      rt.dispose();
    } finally { setEyeAssetLoader(async () => syntheticEye()); }
  });

  it('exploded: structures line up along the optical axis in the order light meets them, clearly apart', () => {
    const holder = new THREE.Group();
    const p = prepareEye(syntheticEye(), holder);
    applyEyeExplode(p, 1);
    const c = centres(holder);
    const order = [...EYE_STRUCTURES].sort((a, b) => a.lightOrder - b.lightOrder).map((s) => s.id);
    for (let i = 1; i < order.length; i++) {
      assert.ok(c.get(order[i - 1])!.z > c.get(order[i])!.z, `${order[i - 1]} in front of ${order[i]}`);
    }
    const ids = [...c.keys()];
    for (const a of ids) for (const b of ids) if (a < b) assert.ok(c.get(a)!.distanceTo(c.get(b)!) > 0.05, `${a} vs ${b} too close`);
    const lateral = (id: string) => Math.hypot(c.get(id)!.x, c.get(id)!.y);
    assert.ok(lateral('lens') < 0.2, 'parts only move along the axis');
  });

  it('reassembly restores the exact original transforms', () => {
    const holder = new THREE.Group();
    const p = prepareEye(syntheticEye(), holder);
    const before = pose(holder);
    for (const f of [0.4, 1, 0.2, 0]) applyEyeExplode(p, f);
    assert.equal(pose(holder), before);
  });

  it('cutaway is a real clipping plane on the eye materials, and can be turned off again', async () => {
    const w = await eyeWorkspace();
    const rt = w.lifecycle.getActiveRuntime()!;
    rt.setCutaway!(true);
    const mats = new Set<THREE.Material>();
    rt.rootGroup.traverse((o) => { if ((o as THREE.Mesh).isMesh) mats.add((o as THREE.Mesh).material as THREE.Material); });
    assert.ok([...mats].every((m) => (m.clippingPlanes?.length ?? 0) === 1));
    rt.setCutaway!(false);
    assert.ok([...mats].every((m) => (m.clippingPlanes?.length ?? 0) === 0));
  });

  it('labels: canonical names of modelled structures only; the optic nerve says it is simplified', () => {
    const labels = componentLabels(humanEyeModel.getAllComponentIds(), (id) => humanEyeModel.getComponentMetadata(id)?.name);
    assert.equal(labels.length, EYE_STRUCTURES.length);
    assert.ok(!labels.some((l) => /muscle|rectus|blood vessel|rod|cone/i.test(l.name)), 'nothing that is not modelled');
    assert.ok(labels.find((l) => l.id === OPTIC_NERVE_ID)!.name.includes('simplified'));
  });

  const questions: [string, string, string, string | null][] = [
    ['What does the cornea do?', 'en-IN', 'purpose', 'cornea'],
    ['Why do we need the lens?', 'en-IN', 'purpose', 'lens'],
    ['How does light reach the retina?', 'en-IN', 'howWorks', 'retina'],
    ['What does the optic nerve do?', 'en-IN', 'purpose', OPTIC_NERVE_ID],
    ['Explain how we see an object.', 'en-IN', 'explain', null],
    ['Explain the optic nerve in simple Telugu.', 'en-IN', 'explain', OPTIC_NERVE_ID],
    ['ఈ Lens పని ఏమిటి?', 'te-IN', 'purpose', 'lens'],
    ['మనకు ఒక వస్తువు ఎలా కనిపిస్తుంది?', 'te-IN', 'howWorks', null],
  ];
  for (const [t, lang, q, part] of questions) {
    it(`voice: "${t}" -> ${q} about ${part ?? 'the whole eye'}`, async () => {
      const w = await eyeWorkspace();
      const r = turn(w, t, lang);
      assert.equal(r.status, 'teach', JSON.stringify(r.outcome));
      assert.deepEqual([r.teach!.questionType, r.teach!.targetComponentId], [q, part]);
    });
  }

  it('"What is the difference between the iris and the pupil?" is about both (whole-eye answer, nothing selected)', async () => {
    const w = await eyeWorkspace();
    const n = w.dispatcher.getHistory().length;
    const r = turn(w, 'What is the difference between the iris and the pupil?');
    assert.equal(r.status, 'teach');
    assert.equal(w.dispatcher.getHistory().length, n);
  });

  it('follow-up "Why is it important?" uses the selected structure', async () => {
    const w = await eyeWorkspace();
    w.dispatcher.dispatch({ type: 'component.select', componentId: 'retina' }, 'ui');
    assert.equal(turn(w, 'Why is it important?').teach!.targetComponentId, 'retina');
  });

  it('model-data answers: the optic nerve carries signals, the brain makes vision (English and Telugu)', async () => {
    const w = await eyeWorkspace();
    const en = (buildComponentBrief(humanEyeModel, w.snapshot(false), OPTIC_NERVE_ID, 'explain') as { steps: { narration: string }[] }).steps.map((s) => s.narration).join(' ');
    assert.match(en, /towards the brain/);
    assert.match(en, /simplified/);
    assert.match(en, /The cable does not make the picture/);
    const te = buildComponentBrief(humanEyeModel, w.snapshot(false), OPTIC_NERVE_ID, 'explain', 'te-IN') as { steps: { narration: string }[] };
    assert.ok(te.steps.every((s) => TELUGU.test(s.narration)));
    assert.ok(te.steps.map((s) => s.narration).join(' ').includes('మెదడు'));
    for (const id of humanEyeModel.getAllComponentIds()) {
      for (const lang of ['en-IN', 'te-IN', 'hi-IN', 'bn-IN']) {
        assert.ok(validateTeachingPlan(buildComponentBrief(humanEyeModel, w.snapshot(false), id, 'explain', lang), w.snapshot(false), w.dispatcher.getContext()).ok, `${id}/${lang}`);
      }
    }
  });

  it('the simplified optic nerve starts at the given optic disc and points backwards', () => {
    const disc = new THREE.Vector3(0.04, 0.8, 0.072);
    const m = buildOpticNerve(disc, 0.024);
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox!;
    assert.ok(b.max.z <= disc.z + 0.003 && b.min.z < disc.z - 0.015, 'extends behind the eye');
  });
});

/* ===================== Reinforced concrete frame ===================== */
describe('Reinforced Concrete Structural System Explorer', () => {
  it('has the structural members and the reinforcement as separate, distinguishable components', () => {
    const c = buildRcFrame();
    assert.deepEqual([...c.parts.keys()].sort(), [...RC_CONCRETE_IDS, ...RC_REINFORCEMENT_IDS].sort());
    const mat = (id: string) => ((c.parts.get(id)!.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial);
    for (const conc of RC_CONCRETE_IDS) for (const steel of RC_REINFORCEMENT_IDS) {
      assert.notEqual(mat(conc).color.getHex(), mat(steel).color.getHex());
      assert.ok(mat(steel).metalness > mat(conc).metalness, 'steel looks metallic, concrete does not');
    }
    c.dispose();
  });

  it('reinforcement sits inside its concrete with cover (column bars within the columns, slab mesh within the slab)', () => {
    const c = buildRcFrame();
    c.group.updateMatrixWorld(true);
    const box = (id: string) => new THREE.Box3().setFromObject(c.parts.get(id)!);
    const slab = box('slab');
    const mesh = box('slab_reinforcement');
    assert.ok(mesh.min.y > slab.min.y && mesh.max.y < slab.max.y, 'slab mesh inside the slab thickness');
    const cols = box('columns');
    const bars = box('column_longitudinal_bars');
    assert.ok(bars.min.x > cols.min.x - 0.31 && bars.max.x < cols.max.x + 0.31, 'column bars stay in the column line (plus the anchorage bends)');
    c.dispose();
  });

  it('the load path is an illustration with an explicit note, never an analysis, and hides while exploded', () => {
    assert.match(LOAD_PATH_NOTE, /illustration only/);
    assert.match(LOAD_PATH_NOTE, /not a structural analysis or a design calculation/);
    assert.ok(!/kN|MPa|capacity/i.test(LOAD_PATH_NOTE));
    const c = buildRcFrame();
    c.setLoadPath(true);
    assert.equal(c.loadPath.visible, true);
    c.setExplodedFactor(1);
    assert.equal(c.loadPath.visible, false);
    c.setExplodedFactor(0);
    assert.equal(c.loadPath.visible, true, 'comes back after reassembly');
    assert.ok(!rcFrameModel.getAllComponentIds().some((id) => /load/.test(id)), 'the illustration is not a selectable component');
    c.dispose();
  });

  it('exploded: steel cage comes out in front of the concrete; members separate vertically; exact restore', () => {
    const c = buildRcFrame();
    const before = pose(c.group);
    c.setExplodedFactor(1);
    const cen = centres(c.group);
    for (const steel of RC_REINFORCEMENT_IDS) assert.ok(cen.get(steel)!.z > 2.5, `${steel} out in front`);
    for (const conc of RC_CONCRETE_IDS) assert.ok(cen.get(conc)!.z < 1, `${conc} stays behind`);
    assert.ok(cen.get('slab')!.y > cen.get('beams')!.y && cen.get('beams')!.y > cen.get('columns')!.y && cen.get('columns')!.y > cen.get('footings')!.y);
    c.setExplodedFactor(0.3);
    c.setExplodedFactor(0);
    assert.equal(pose(c.group), before);
    c.dispose();
  });

  const qs: [string, string, string, string | null][] = [
    ['Why do buildings need columns?', 'en-IN', 'purpose', 'columns'],
    ['What is the purpose of stirrups?', 'en-IN', 'purpose', 'beam_stirrups'],
    ['How does a slab transfer loads?', 'en-IN', 'howWorks', 'slab'],
    ['What happens at a beam-column joint?', 'en-IN', 'howWorks', 'beam_column_joints'],
    ['Why do foundations need to transfer loads to the ground?', 'en-IN', 'purpose', 'footings'],
    ['Why are reinforcement bars placed inside concrete?', 'en-IN', 'howWorks', null],
    ['Explain the load path in Telugu.', 'en-IN', 'explain', null],
    ['ఈ Column పని ఏమిటి?', 'te-IN', 'purpose', 'columns'],
  ];
  for (const [t, lang, q, part] of qs) {
    it(`voice: "${t}" -> ${q} about ${part ?? 'the whole frame'}`, () => {
      const w = makeWorkspace(rcFrameModel);
      const n = w.dispatcher.getHistory().length;
      const r = turn(w, t, lang);
      assert.equal(r.status, 'teach', JSON.stringify(r.outcome));
      assert.deepEqual([r.teach!.questionType, r.teach!.targetComponentId], [q, part]);
      assert.equal(w.dispatcher.getHistory().length, n, 'a question selects nothing');
    });
  }

  it('Telugu model-data answer about steel reinforcement keeps the technical words', () => {
    const w = makeWorkspace(rcFrameModel);
    const te = buildComponentBrief(rcFrameModel, w.snapshot(false), 'beam_longitudinal_bars', 'purpose', 'te-IN') as { steps: { narration: string }[] };
    const text = te.steps.map((s) => s.narration).join(' ');
    assert.ok(TELUGU.test(text) && /tension/.test(text) && /Concrete/.test(text));
  });
});

/* ===================== Steam engine (locomotive) ===================== */
describe('Steam Engine Explorer (locomotive)', () => {
  /** World centre of one side's piece of a component (right side, or the centre piece). */
  const pieceCentre = (e: ReturnType<typeof buildSteamEngine>, id: string) => {
    e.group.updateMatrixWorld(true);
    const p = e.piece(id, 1) ?? e.piece(id, 0)!;
    return new THREE.Box3().setFromObject(p).getCenter(new THREE.Vector3());
  };

  it('slider-crank motion is coherent: stroke = 2r, piston follows the crosshead, valve keeps to its chest', () => {
    const xs = Array.from({ length: 360 }, (_, i) => pistonX((i * Math.PI) / 180));
    assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 2 * ENGINE.crankRadius) < 1e-9, 'stroke = 2 × crank radius');
    for (const t of [0, 1, 2, 3, 4, 5]) {
      assert.ok(Math.abs(crossheadX(t) - pistonX(t) - ENGINE.pistonRodLength) < 1e-12, 'rigid piston rod');
      // the connecting rod keeps its length between the crosshead pin and the crank pin
      const pin = [ENGINE.crankRadius * Math.cos(t), ENGINE.crankRadius * Math.sin(t)];
      assert.ok(Math.abs(Math.hypot(pin[0] - crossheadX(t), pin[1]) - ENGINE.rodLength) < 1e-9);
      assert.ok(Math.abs(valveX(t) - VALVE_MID) <= ENGINE.eccentricRadius * 1.05, 'valve travel ≈ ± return-crank radius');
    }
    // the piston stays inside its cylinder (cover to cover)
    for (const x of xs) assert.ok(Math.abs(x - ENGINE.cylinderX) < 0.55 - 0.07, 'piston inside the bore');
  });

  it('every moving part follows ONE axle angle; the left side is quartered 90° ahead; rods stay on their pins', () => {
    const e = buildSteamEngine();
    e.setCrankAngle(1.1);
    for (const side of [1, -1] as const) {
      const phi = sideAngle(1.1, side);
      assert.ok(Math.abs(e.piece('piston', side)!.position.x - pistonX(phi)) < 1e-12, `piston ${side}`);
      for (const w of e.piece('driving_wheels', side)!.children) assert.ok(Math.abs(w.rotation.z - phi) < 1e-12, 'all wheels turn together');
      const rod = e.piece('connecting_rod', side)!;
      const tip = new THREE.Vector3(ENGINE.rodLength, 0, 0).applyEuler(rod.rotation).add(rod.position);
      assert.ok(Math.abs(tip.x - ENGINE.crankRadius * Math.cos(phi)) < 1e-9 && Math.abs(tip.y - ENGINE.crankRadius * Math.sin(phi)) < 1e-9, 'rod end on the crank pin');
      const coupling = e.piece('coupling_rods', side)!.position;
      assert.ok(Math.abs(coupling.x - ENGINE.crankRadius * Math.cos(phi)) < 1e-12 && Math.abs(coupling.y - ENGINE.crankRadius * Math.sin(phi)) < 1e-12, 'coupling rod rides the crank pins');
    }
    assert.ok(Math.abs(sideAngle(1.1, -1) - sideAngle(1.1, 1) - Math.PI / 2) < 1e-12);
    e.dispose();
  });

  it('is a locomotive: boiler, smokebox, chimney, dome, firebox, cab, six wheels, two cylinders, on a track', () => {
    for (const id of ['boiler', 'smokebox', 'chimney', 'steam_dome', 'firebox', 'cab', 'driving_wheels', 'coupling_rods', 'cylinder', 'track']) {
      assert.ok(STEAM_ENGINE_COMPONENT_IDS.includes(id), id);
    }
    const e = buildSteamEngine();
    assert.equal(e.piece('driving_wheels', 1)!.children.length + e.piece('driving_wheels', -1)!.children.length, 6);
    assert.ok(e.piece('cylinder', 1) && e.piece('cylinder', -1), 'outside cylinders on both sides');
    assert.deepEqual(steamEngineModel.contextComponentIds, ['track']);
    for (const id of STEAM_ENGINE_COMPONENT_IDS) {
      assert.ok(steamEngineModel.getComponentMetadata(id)?.description, `${id} described`);
      if (id !== 'track') assert.ok(STEAM_ENGINE_EXPLODE[id], `${id} has an exploded position`);
    }
    e.dispose();
  });

  it('animation: plays, pauses (no update while paused), resets to the start, and freezes while exploded', () => {
    const w = makeWorkspace(steamEngineModel);
    const rt = w.lifecycle.getActiveRuntime()!;
    const piston = () => w.lifecycle.getActiveRuntime()!.rootGroup.getObjectByName('piston_right')!.position.x;
    const start = piston();
    rt.updateAnimation!(0.25, 0);
    const moved = piston();
    assert.notEqual(moved, start, 'plays');
    // pause = the viewer stops calling updateAnimation (animation.pause through the dispatcher)
    assert.equal(w.dispatcher.dispatch({ type: 'animation.pause' }, 'voice').status, 'executed');
    assert.equal(w.anim.playing, false);
    rt.resetAnimation!();
    assert.equal(piston(), start, 'reset returns to the initial state');
    rt.setExplodedFactor!(1);
    const exploded = piston();
    rt.updateAnimation!(0.5, 0);
    assert.equal(piston(), exploded, 'mechanism holds still while exploded');
    rt.setExplodedFactor!(0);
    assert.equal(piston(), start, 'reassembled exactly where it was');
  });

  it('explode separates the parts clearly (each side outwards) and restores exact transforms (also after the wheels turned)', () => {
    const e = buildSteamEngine();
    e.setCrankAngle(0.7);
    const before = pose(e.group);
    e.setExplodedFactor(1);
    const ids = ['piston', 'piston_rod', 'crosshead', 'connecting_rod', 'crank', 'coupling_rods', 'driving_wheels', 'cylinder', 'boiler', 'smokebox', 'chimney', 'cab'];
    const c = new Map(ids.map((id) => [id, pieceCentre(e, id)]));
    for (const a of ids) for (const b of ids) if (a < b) assert.ok(c.get(a)!.distanceTo(c.get(b)!) > 0.5, `${a} / ${b}`);
    // the left side mirrors the right: it moves the other way
    const l = new THREE.Box3().setFromObject(e.piece('crosshead', -1)!).getCenter(new THREE.Vector3());
    assert.ok(c.get('crosshead')!.z > 2 && l.z < -2, 'sides move outwards');
    e.setExplodedFactor(0);
    assert.equal(pose(e.group), before);
    e.dispose();
  });

  it('voice: repeated "play the animation" stays one animation (idempotent), questions teach', () => {
    const w = makeWorkspace(steamEngineModel);
    turn(w, 'play the animation');
    turn(w, 'play the animation');
    assert.equal(w.anim.playing, true);
    const qs: [string, string, string, string | null][] = [
      ['How does a steam engine work?', 'en-IN', 'howWorks', null],
      ['What does the connecting rod do?', 'en-IN', 'purpose', 'connecting_rod'],
      ['Why are the coupling rods needed?', 'en-IN', 'purpose', 'coupling_rods'],
      ['Explain the complete working cycle.', 'en-IN', 'explain', null],
      ['ఈ Piston ఎలా పని చేస్తుంది?', 'te-IN', 'howWorks', 'piston'],
    ];
    for (const [t, lang, q, part] of qs) {
      const r = turn(w, t, lang);
      assert.equal(r.status, 'teach', `${t}: ${JSON.stringify(r.outcome)}`);
      assert.deepEqual([r.teach!.questionType, r.teach!.targetComponentId], [q, part], t);
    }
    const both = turn(w, 'How does the piston move the driving wheels?');
    assert.equal(both.status, 'teach');
  });

  it('Telugu explanation separates heat input, piston motion and mechanical output, and says nothing is simulated', () => {
    const w = makeWorkspace(steamEngineModel);
    const te = buildComponentBrief(steamEngineModel, w.snapshot(false), null, 'howWorks', 'te-IN') as { steps: { narration: string }[] };
    const text = te.steps.map((s) => s.narration).join(' ');
    assert.ok(/heat input/.test(text) && /mechanical output/.test(text) && /simulate/.test(text), text);
  });
});

/* ===================== Shared behaviour ===================== */
describe('Shared: picking, navigation', () => {
  it('a click passes through a hidden part to the visible one behind it', () => {
    const root = new THREE.Group();
    const front = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    front.position.z = 2;
    front.userData.componentId = 'slab';
    const back = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    back.userData.componentId = 'columns';
    root.add(front, back);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    root.updateMatrixWorld(true);
    const rc = new ComponentRaycaster(camera, root, { validComponentIds: new Set(['slab', 'columns']) });
    assert.equal(rc.raycast({ x: 0, y: 0 })?.componentId, 'slab');
    front.visible = false;
    assert.equal(rc.raycast({ x: 0, y: 0 })?.componentId, 'columns');
  });

  const bar = (extra: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(WorkspaceTopBar, {
    modelName: 'Steam Engine Explorer', isLeftDockOpen: false, onToggleLeftDock: () => {}, isRightDockOpen: false, onToggleRightDock: () => {},
    renderFps: 60, cameraStatus: 'off', showDiagnostics: false, onToggleDiagnostics: () => {}, showRoadmap: false, onToggleRoadmap: () => {},
    onNavigateHome: () => {}, onToggleGuidedTour: () => {}, ...extra,
  }));

  it('top bar: only learner actions (all models, part info); no developer tools, FPS or roadmap', () => {
    const html = bar({ onNavigateHome: () => {} });
    assert.ok(html.includes('All models') && html.includes('Part info'));
    for (const gone of ['Guided Tour', 'More', 'Gesture diagnostics', 'Project roadmap', 'FPS']) assert.ok(!html.includes(gone), gone);
  });

});
