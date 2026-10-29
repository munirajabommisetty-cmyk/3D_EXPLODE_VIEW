/**
 * Human Eye Explorer — model definition (anatomy learning module).
 *
 * Uses the platform like every other model: registry entry, component ids on meshes, the shared
 * scene-command dispatcher, explode/reassemble, guided tour, voice tutor and labels.
 *
 *  - Asset: HuBMAP VH_M_Eye_L.glb (see eyeStructures.ts), loaded only when the module opens.
 *  - Optic nerve: simplified tube added at the real optic disc (the file has no optic nerve).
 *  - Cutaway: a real section — a clipping plane through the eye's centre along its optical axis,
 *    with double-sided materials so the inside of each layer is visible.
 *  - Exploded anatomy: every structure keeps its true position across the eye and moves only
 *    along the eye's own front-to-back (optical) axis, in the order light passes through it
 *    (cornea first, sclera and optic nerve last), with gaps proportional to the eye's size.
 *    Factor 0 restores the exact original positions.
 */

import * as THREE from 'three';
import type { Object3D, Scene } from 'three';
import type { AssemblyTreeNode, EngineeringModelDefinition, ModelRuntimeInstance } from '../../types/models';
import type { MedicalComponentMetadata } from '../../types/engineering';
import { buildRelationshipIndex, type RelationshipEdge } from '../../services/scene/relationshipTable';
import {
  EYE_ASSET_URL, EYE_ATTRIBUTION, EYE_COMPONENT_IDS, EYE_MODEL_ID, EYE_STRUCTURES, OPTIC_NERVE_ID, eyeStructureForNode,
} from './eyeStructures';

/* ------------------------------ relationships (standard anatomy) ------------------------------ */

export const EYE_RELATIONSHIP_EDGES: readonly RelationshipEdge[] = [
  { from: 'cornea', type: 'connected_to', to: 'sclera', description: 'The cornea joins the sclera at the corneoscleral junction (limbus).', evidence: 'Atlas mesh corneo_scleral_junction.' },
  { from: 'iris', type: 'connected_to', to: 'ciliary_body', description: 'The iris attaches at its outer edge to the ciliary body.', evidence: 'Standard anatomy; adjacent atlas meshes.' },
  { from: 'ciliary_body', type: 'supports', to: 'suspensory_ligament', description: 'The suspensory ligament fibres arise from the ciliary body.', evidence: 'Standard anatomy.' },
  { from: 'suspensory_ligament', type: 'supports', to: 'lens', description: 'The suspensory ligament holds the lens in place.', evidence: 'Atlas mesh suspensory_ligament_of_lens.' },
  { from: 'ciliary_body', type: 'connected_to', to: 'aqueous_humor', description: 'The ciliary processes produce the aqueous humour.', evidence: 'Atlas mesh ciliary_processes.' },
  { from: 'aqueous_humor', type: 'connected_to', to: 'drainage_angle', description: 'Aqueous humour drains through the trabecular meshwork into Schlemm’s canal.', evidence: 'Atlas meshes trabecular_meshwork, schlemms_canal.' },
  { from: 'choroid', type: 'supports', to: 'retina', description: 'The choroid supplies blood to the outer layers of the retina.', evidence: 'Standard anatomy; adjacent atlas layers.' },
  { from: 'sclera', type: 'supports', to: 'choroid', description: 'The sclera surrounds and protects the choroid and the inner layers.', evidence: 'Standard anatomy; nested atlas layers.' },
  { from: 'retina', type: 'connected_to', to: 'macula', description: 'The macula (with the fovea) is the central part of the retina.', evidence: 'Atlas meshes macula_lutea, fovea.' },
  { from: 'retina', type: 'connected_to', to: 'optic_disc', description: 'Nerve fibres from all over the retina gather at the optic disc.', evidence: 'Atlas mesh optic_disc.' },
  { from: 'optic_disc', type: 'connected_to', to: OPTIC_NERVE_ID, description: 'At the optic disc the fibres leave the eye as the optic nerve.', evidence: 'Standard anatomy (optic nerve shape is simplified).' },
];
const RELATIONSHIPS = buildRelationshipIndex(EYE_RELATIONSHIP_EDGES);

const META = new Map<string, MedicalComponentMetadata>();
for (const s of EYE_STRUCTURES) {
  META.set(s.id, {
    id: s.id, name: s.name, domain: 'medical', role: s.role, description: s.description, region: s.region,
    materialName: '', specifications: [], engineeringNotes: s.engineeringNotes, networkNote: s.networkNote,
    atlasStructures: s.atlasMeshes, representation: s.representation, relationships: RELATIONSHIPS.get(s.id) ?? [],
  });
}

const leaf = (id: string): AssemblyTreeNode => ({ id: `node_${id}`, name: META.get(id)!.name, type: 'component', componentId: id, defaultVisible: true });

export function getEyeAssemblyTree(): AssemblyTreeNode {
  return {
    id: 'human_eye_root', name: 'Human Eye (left)', type: 'assembly', defaultExpanded: true,
    children: [
      { id: 'grp_front', name: 'Front of the eye', type: 'subassembly', defaultExpanded: true,
        children: ['conjunctiva', 'cornea', 'aqueous_humor', 'drainage_angle', 'iris', 'pupil'].map(leaf) },
      { id: 'grp_focus', name: 'Focusing', type: 'subassembly', defaultExpanded: true,
        children: ['lens', 'suspensory_ligament', 'ciliary_body'].map(leaf) },
      { id: 'grp_back', name: 'Back of the eye', type: 'subassembly', defaultExpanded: true,
        children: ['vitreous_body', 'retina', 'macula', 'optic_disc', 'choroid', 'sclera'].map(leaf) },
      { id: 'grp_nerve', name: 'To the brain', type: 'subassembly', defaultExpanded: true, children: [leaf(OPTIC_NERVE_ID)] },
    ],
  };
}

/* ------------------------------ loading ------------------------------ */

export type EyeAssetLoader = (url: string) => Promise<Object3D>;
const gltfLoader: EyeAssetLoader = async (url) => {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  return (await new GLTFLoader().loadAsync(url)).scene;
};
let assetLoader: EyeAssetLoader = gltfLoader;
/** Tests replace the loader; null restores the GLTF loader. */
export function setEyeAssetLoader(loader: EyeAssetLoader | null): void {
  assetLoader = loader ?? gltfLoader;
}

export const EYE_SCENE_SIZE = 2.0;
/** Gap between structures in the exploded layout, as a fraction of the eye's diameter. */
export const EYE_EXPLODE_GAP = 0.14;

/** Clear media are see-through so the inside of the eye can be read; everything else is opaque. */
// The conjunctiva is a thin transparent membrane in life; drawn faint so the cornea and iris show.
const SEE_THROUGH: Record<string, number> = { conjunctiva: 0.07, cornea: 0.12, aqueous_humor: 0.05, vitreous_body: 0.1, lens: 0.45 };

export interface PreparedEye {
  meshes: THREE.Mesh[];
  /** Exploded offset per mesh at factor 1 (asset space, metres), along the optical axis only. */
  offsets: Map<THREE.Mesh, THREE.Vector3>;
  materials: Map<string, THREE.MeshStandardMaterial>;
  diameter: number;
}

/** Simplified optic nerve: a tube from the real optic disc, backwards and towards the midline. */
export function buildOpticNerve(disc: THREE.Vector3, diameter: number): THREE.Mesh {
  const start = disc.clone();
  const end = start.clone().add(new THREE.Vector3(-0.25, 0, -1).normalize().multiplyScalar(diameter * 1.1));
  const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, diameter * 0.04, 0)); // gentle natural curve
  const curve = new THREE.CatmullRomCurve3([start, mid, end]);
  const geo = new THREE.TubeGeometry(curve, 32, diameter * 0.075, 16, false);
  const mesh = new THREE.Mesh(geo);
  mesh.name = 'app_simplified_optic_nerve';
  return mesh;
}

export function prepareEye(asset: Object3D, holder: THREE.Group): PreparedEye {
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const material = (id: string) => {
    let m = materials.get(id);
    if (!m) {
      const s = EYE_STRUCTURES.find((x) => x.id === id)!;
      const opacity = SEE_THROUGH[id];
      m = new THREE.MeshStandardMaterial({
        color: s.color, roughness: id === 'cornea' || id === 'lens' ? 0.15 : 0.55, metalness: 0, side: THREE.DoubleSide,
        ...(opacity !== undefined ? { transparent: true, opacity, depthWrite: false } : {}),
      });
      materials.set(id, m);
    }
    return m;
  };

  asset.updateMatrixWorld(true);
  const all = new THREE.Box3().setFromObject(asset);
  const diameter = all.getSize(new THREE.Vector3()).x || 0.024;

  const meshes: THREE.Mesh[] = [];
  asset.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const id = eyeStructureForNode(mesh.name);
    if (!id) return;
    mesh.userData.componentId = id;
    mesh.userData.atlasNode = mesh.name;
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m?.dispose?.());
    mesh.material = material(id);
    if (SEE_THROUGH[id] !== undefined) mesh.renderOrder = 2;
    meshes.push(mesh);
  });

  // Simplified optic nerve at the real optic disc (asset space)
  const disc = meshes.find((m) => m.userData.componentId === 'optic_disc');
  if (disc) {
    const c = new THREE.Box3().setFromObject(disc).getCenter(new THREE.Vector3());
    const nerve = buildOpticNerve(c, diameter);
    nerve.userData.componentId = OPTIC_NERVE_ID;
    nerve.userData.simplified = true;
    nerve.material = material(OPTIC_NERVE_ID);
    asset.add(nerve);
    nerve.updateMatrixWorld(true);
    meshes.push(nerve);
  }

  // Exploded layout along the optical axis (z), in the order light meets each structure
  const boxes = new Map<string, THREE.Box3>();
  for (const m of meshes) {
    const id = m.userData.componentId as string;
    const b = boxes.get(id) ?? new THREE.Box3();
    b.expandByObject(m);
    boxes.set(id, b);
  }
  const order = [...EYE_STRUCTURES].filter((s) => boxes.has(s.id)).sort((a, b) => a.lightOrder - b.lightOrder);
  const gap = diameter * EYE_EXPLODE_GAP;
  const shift = new Map<string, number>();
  let cursor = all.max.z + diameter * 0.35; // the cornea moves forward first
  for (const s of order) {
    const b = boxes.get(s.id)!;
    const depth = b.max.z - b.min.z;
    // Big nested shells (vitreous, retina, choroid, sclera) are staggered by about half their depth
    const used = depth > diameter * 0.5 ? depth * 0.5 : depth;
    shift.set(s.id, cursor - b.max.z);
    cursor -= used + gap;
  }
  // Keep the exploded row centred on the eye
  const shifts = [...shift.values()];
  const mean = shifts.reduce((a, v) => a + v, 0) / (shifts.length || 1);
  const offsets = new Map<THREE.Mesh, THREE.Vector3>();
  for (const m of meshes) {
    offsets.set(m, new THREE.Vector3(0, 0, shift.get(m.userData.componentId)! - mean));
    m.userData.basePosition = m.position.clone();
  }

  const center = all.getCenter(new THREE.Vector3());
  const scale = EYE_SCENE_SIZE / diameter;
  holder.add(asset);
  holder.scale.setScalar(scale);
  holder.position.copy(center).multiplyScalar(-scale);
  return { meshes, offsets, materials, diameter };
}

export function applyEyeExplode(prepared: PreparedEye, factor: number): void {
  const f = Math.max(0, Math.min(1, factor));
  for (const m of prepared.meshes) {
    const base = m.userData.basePosition as THREE.Vector3;
    if (f === 0) m.position.copy(base);
    else m.position.copy(base).addScaledVector(prepared.offsets.get(m)!, f);
  }
}

/** Section plane through the eye's centre containing the optical axis (keeps the -x half). */
export const EYE_CUT_PLANE = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);

export function buildEyeScene(scene: Scene): ModelRuntimeInstance {
  const rootGroup = new THREE.Group();
  rootGroup.name = 'human_eye';
  const holder = new THREE.Group();
  rootGroup.add(holder);
  scene.add(rootGroup);
  let prepared: PreparedEye | null = null;
  let pendingFactor = 0;
  let cut = false;
  let disposed = false;

  const applyCut = () => prepared?.materials.forEach((m) => { m.clippingPlanes = cut ? [EYE_CUT_PLANE] : []; m.needsUpdate = true; });

  const ready = assetLoader(EYE_ASSET_URL).then(
    (asset) => {
      if (disposed) throw new Error('The eye model was closed before it finished loading.');
      prepared = prepareEye(asset, holder);
      if (pendingFactor) applyEyeExplode(prepared, pendingFactor);
      applyCut();
    },
    (err: unknown) => {
      throw new Error(`The 3D eye model could not be loaded (${err instanceof Error ? err.message : String(err)}). ` +
        'Check that frontend/public/assets/models/eye/VH_M_Eye_L.glb is present.');
    }
  );
  ready.catch(() => {});

  return {
    rootGroup,
    ready,
    setExplodedFactor: (f: number) => {
      pendingFactor = f;
      if (prepared) applyEyeExplode(prepared, f);
    },
    setCutaway: (on: boolean) => {
      cut = on;
      applyCut();
    },
    dispose: () => {
      disposed = true;
      scene.remove(rootGroup);
      prepared?.materials.forEach((m) => m.dispose());
      rootGroup.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry?.dispose());
    },
  };
}

export const humanEyeModel: EngineeringModelDefinition = {
  id: EYE_MODEL_ID,
  name: 'Human Eye Explorer',
  domain: 'medical',
  category: 'Anatomy of vision',
  description:
    'Explore the human eye: the cornea, iris, pupil and lens that focus light, the retina that turns light into nerve signals, and the optic nerve that carries them towards the brain. Built from the HuBMAP Human Reference Atlas. For learning only, not for medical use.',
  thumbnailUrl: '',
  difficulty: 'Beginner',
  tags: ['Anatomy', 'Biology', 'Vision', 'Human Eye'],
  componentCount: EYE_COMPONENT_IDS.length,
  cameraConfig: { initialPosition: [2.7, 1.0, 4.4], target: [0, 0, 0], minDistance: 1.2, maxDistance: 18, fov: 45, defaultPreset: 'isometric' },
  getAssemblyTree: getEyeAssemblyTree,
  getComponentMetadata: (id: string) => META.get(id) ?? null,
  getAllComponentIds: () => [...EYE_COMPONENT_IDS],
  buildScene: buildEyeScene,
  loadsExternalAsset: true,
  attribution: EYE_ATTRIBUTION,
  hologramEdges: false,
  // assembled: a real-looking eye in natural colours; exploded: colour-coded x-ray with labels
  assembledLook: 'solid',
  cutaway: { label: 'Cutaway' },
  // Look across the optical axis so the exploded layers read as a row (front of the eye to the right)
  explodeViewDirection: [1, 0.3, 0.15],
};
