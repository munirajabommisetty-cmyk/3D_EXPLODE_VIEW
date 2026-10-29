/**
 * Human Eye Explorer — structure catalogue.
 *
 * Asset: HuBMAP Human Reference Atlas, "VH_M_Eye_L.glb" (CCF v1.2, Visible Human male, left eye),
 * CC BY 4.0. Read on 28 Oct 2026: 23 separately named meshes "VH_M_<structure>_L", metres,
 * anterior (front of the eye) = +z, eyeball about 24 mm across, no node transforms.
 *
 * Every learning structure is made only of the meshes listed in `atlasMeshes`, EXCEPT the optic
 * nerve: the eye file has no optic-nerve mesh (only the optic disc where the nerve leaves the
 * eye), so the module adds a clearly marked SIMPLIFIED educational shape starting at the real
 * optic disc. Extraocular muscles, retinal blood vessels and the rods and cones are not in the file:
 * they are explained in the teaching text only, never drawn or labelled.
 * Normal anatomy and general function only — not medical advice.
 */

import type { MedicalComponentMetadata } from '../../types/engineering';

export const EYE_MODEL_ID = 'human_eye';
export const EYE_ASSET_URL = '/assets/models/eye/VH_M_Eye_L.glb';
export const EYE_ATTRIBUTION =
  '3D eye: HuBMAP Human Reference Atlas (CCF 3D Reference Object Library v1.2, VH_M_Eye_L, Visible Human male), ' +
  'licensed CC BY 4.0. Optic nerve: simplified educational shape added by this app.';

export const EYE_ASSET_FACTS = {
  file: 'VH_M_Eye_L.glb',
  bytes: 9_610_816,
  meshes: 23,
  triangles: 455_294,
  materials: 18,
  axes: 'anterior = +z (cornea at the front), metres, eyeball about 24 mm across',
} as const;

/** Not in the asset: explained in teaching text only (never drawn, labelled or selectable). */
export const EYE_DESCRIBED_ONLY: readonly string[] = [
  'extraocular muscles', 'retinal blood vessels', 'rods and cones (photoreceptor cells)', 'optic chiasm and visual pathway',
];

export const OPTIC_NERVE_ID = 'optic_nerve';

type EyeStructure = Omit<MedicalComponentMetadata, 'domain' | 'specifications' | 'materialName' | 'atlasStructures' | 'region'> & {
  region: 'external' | 'internal';
  /** Mesh names without "VH_M_" and "_L". Empty for the simplified optic nerve. */
  atlasMeshes: string[];
  /** Order in which light meets the structure (front to back); used for the exploded layout. */
  lightOrder: number;
  /** 'atlas' = real asset mesh; 'simplified' = educational shape added by the app. */
  representation: 'atlas' | 'simplified';
  /** Natural (biological) colour for the assembled solid view; the exploded view is colour-coded. */
  color: number;
};

export const EYE_STRUCTURES: readonly EyeStructure[] = [
  { id: 'conjunctiva', name: 'Conjunctiva', region: 'external', lightOrder: 0, representation: 'atlas', color: 0xf6c9cf,
    role: 'Thin clear membrane covering the white of the eye and lining the eyelids',
    description: 'A thin, transparent membrane over the front of the sclera and the inner surface of the eyelids. It helps keep the eye surface moist and protected.',
    engineeringNotes: ['The atlas models the bulbar part (on the eyeball) and the parts lining the upper and lower eyelids.'],
    atlasMeshes: ['bulbar_conjunctiva', 'palpebral_conjunctiva_of_upper_eyelid', 'palpebral_conjunctiva_of_lower_eyelid'] },
  { id: 'cornea', name: 'Cornea', region: 'external', lightOrder: 1, representation: 'atlas', color: 0xdff3ff,
    role: 'Clear front window that does most of the eye’s light focusing',
    description: 'The transparent, curved front surface of the eye. Light enters through it, and its curvature bends (refracts) the light; it provides most of the eye’s focusing power.',
    engineeringNotes: ['The cornea has no blood vessels, which helps it stay clear.', 'The lens fine-tunes the focus that the cornea starts.'],
    atlasMeshes: ['cornea'] },
  { id: 'aqueous_humor', name: 'Aqueous humour', region: 'internal', lightOrder: 2, representation: 'atlas', color: 0xd6eef8,
    role: 'Clear fluid that fills the front of the eye and nourishes the cornea and lens',
    description: 'A watery fluid in the space between the cornea and the lens. It is made by the ciliary body, keeps the front of the eye inflated, and nourishes the cornea and lens.',
    engineeringNotes: ['It drains out through the trabecular meshwork and Schlemm’s canal.'],
    atlasMeshes: ['aqueous_humor'] },
  { id: 'drainage_angle', name: 'Drainage angle (trabecular meshwork and Schlemm’s canal)', region: 'internal', lightOrder: 3, representation: 'atlas', color: 0x9fb6d8,
    role: 'Where aqueous humour drains out of the eye',
    description: 'At the edge of the iris, where the cornea meets the sclera, a sponge-like meshwork and a small circular canal let the aqueous humour drain away, keeping the pressure inside the eye steady.',
    engineeringNotes: ['The atlas models the trabecular meshwork and Schlemm’s canal separately.'],
    atlasMeshes: ['trabecular_meshwork', 'schlemms_canal'] },
  { id: 'iris', name: 'Iris', region: 'external', lightOrder: 4, representation: 'atlas', color: 0x6b4423,
    role: 'Coloured ring of muscle that controls the size of the pupil',
    description: 'The coloured part of the eye. Its muscles widen or narrow the pupil to control how much light enters.',
    engineeringNotes: ['In bright light the pupil becomes smaller; in dim light it becomes larger.'],
    atlasMeshes: ['iris'] },
  { id: 'pupil', name: 'Pupil', region: 'external', lightOrder: 5, representation: 'atlas', color: 0x0b0b0e,
    role: 'The opening in the centre of the iris that lets light in',
    description: 'The pupil is not a tissue but an opening: the hole in the middle of the iris through which light passes towards the lens. It looks black because light going in is absorbed inside the eye.',
    engineeringNotes: ['The atlas shows the pupil opening as its own surface so it can be selected.'],
    atlasMeshes: ['pupil'] },
  { id: 'lens', name: 'Lens', region: 'internal', lightOrder: 6, representation: 'atlas', color: 0xf4e7b8,
    role: 'Clear, flexible lens that fine-tunes focus for near and far objects',
    description: 'A transparent, flexible structure behind the iris. By changing shape it adjusts the focus so that near and far objects form a sharp image on the retina.',
    engineeringNotes: ['The ciliary muscle and the suspensory ligament change the lens shape (accommodation).'],
    atlasMeshes: ['lens'] },
  { id: 'suspensory_ligament', name: 'Suspensory ligament (zonules)', region: 'internal', lightOrder: 7, representation: 'atlas', color: 0xe6e1d6,
    role: 'Fine fibres that hold the lens and transmit the ciliary muscle’s pull',
    description: 'Thin fibres connecting the lens to the ciliary body. They hold the lens in place, and when the ciliary muscle relaxes or contracts they change the tension on the lens.',
    engineeringNotes: [],
    atlasMeshes: ['suspensory_ligament_of_lens'] },
  { id: 'ciliary_body', name: 'Ciliary body', region: 'internal', lightOrder: 8, representation: 'atlas', color: 0x5a2e22,
    role: 'Ring of muscle and tissue that changes the lens shape and makes aqueous humour',
    description: 'A ring behind the iris. Its ciliary muscle changes the shape of the lens for focusing, and its ciliary processes produce the aqueous humour.',
    engineeringNotes: ['The atlas models the ciliary body, the ciliary muscle and the ciliary processes separately.'],
    atlasMeshes: ['ciliary_body', 'ciliary_muscle', 'ciliary_processes'] },
  { id: 'vitreous_body', name: 'Vitreous body', region: 'internal', lightOrder: 9, representation: 'atlas', color: 0xe8f0f4,
    role: 'Clear gel that fills the main chamber of the eye and keeps its shape',
    description: 'A clear, jelly-like substance filling the large space between the lens and the retina. It keeps the eyeball round and lets light pass through to the retina.',
    engineeringNotes: [],
    atlasMeshes: ['vitreous_humor'] },
  { id: 'retina', name: 'Retina', region: 'internal', lightOrder: 10, representation: 'atlas', color: 0xe0785e,
    role: 'Light-sensitive layer that turns light into nerve signals',
    description: 'The inner lining at the back of the eye. Its light-sensitive cells (rods and cones) turn light into electrical signals, which are sent through the optic nerve to the brain.',
    engineeringNotes: ['The ora serrata is the wavy front edge of the retina.', 'The rods and cones are microscopic and are not shown in this model.'],
    networkNote: 'Seeing happens when the brain interprets the signals; the retina and optic nerve carry and pre-process them.',
    atlasMeshes: ['retina', 'ora_serrata_of_retina'] },
  { id: 'macula', name: 'Macula and fovea', region: 'internal', lightOrder: 11, representation: 'atlas', color: 0xc98a2e,
    role: 'Central area of the retina for sharp, detailed and colour vision',
    description: 'A small area near the centre of the retina. Its central pit, the fovea, is packed with cones and gives the sharpest vision, used for reading and recognising faces.',
    engineeringNotes: ['The atlas models the macula lutea and the fovea centralis.'],
    atlasMeshes: ['macula_lutea', 'fovea'] },
  { id: 'optic_disc', name: 'Optic disc', region: 'internal', lightOrder: 12, representation: 'atlas', color: 0xf6e3b4,
    role: 'Where the nerve fibres leave the eye to form the optic nerve (the blind spot)',
    description: 'The spot at the back of the eye where nerve fibres from the retina gather and leave the eye as the optic nerve. It has no light-sensitive cells, so it forms a small blind spot.',
    engineeringNotes: ['The brain fills in the blind spot, so we normally do not notice it.'],
    atlasMeshes: ['optic_disc'] },
  { id: 'choroid', name: 'Choroid', region: 'internal', lightOrder: 13, representation: 'atlas', color: 0x6e1f24,
    role: 'Layer of blood vessels that supplies the outer retina',
    description: 'A layer rich in blood vessels between the retina and the sclera. It supplies oxygen and nutrients to the outer layers of the retina.',
    engineeringNotes: [],
    atlasMeshes: ['optic_choroid'] },
  { id: 'sclera', name: 'Sclera', region: 'external', lightOrder: 14, representation: 'atlas', color: 0xf5f1ea,
    role: 'Tough white outer wall that protects the eye and keeps its shape',
    description: 'The white of the eye: a tough outer layer that protects the eyeball and gives it its shape. At the front it joins the cornea at the corneoscleral junction (the limbus).',
    engineeringNotes: ['The atlas models the corneoscleral junction (limbus) separately; here it is part of the sclera.'],
    atlasMeshes: ['sclera', 'corneo_scleral_junction'] },
  { id: OPTIC_NERVE_ID, name: 'Optic nerve (simplified shape)', region: 'internal', lightOrder: 15, representation: 'simplified', color: 0xf0e2c4,
    role: 'Carries the retina’s signals from the eye towards the brain',
    description: 'A bundle of about a million nerve fibres that leaves the eye at the optic disc and carries the retina’s signals towards the brain, where vision is produced. This shape is a simplified educational model: the eye file does not include the optic nerve.',
    engineeringNotes: ['Shown as a simplified tube starting at the real optic disc.', 'The two optic nerves meet at the optic chiasm on the way to the brain (not shown).'],
    networkNote: 'The optic nerve carries signals; vision itself is produced by the brain.',
    atlasMeshes: [] },
];

export const EYE_COMPONENT_IDS: readonly string[] = EYE_STRUCTURES.map((s) => s.id);

const BY_MESH = new Map<string, string>();
for (const s of EYE_STRUCTURES) for (const m of s.atlasMeshes) BY_MESH.set(m, s.id);

/** "VH_M_<mesh>_L" -> learning structure id, or null for anything not in the catalogue. */
export function eyeStructureForNode(nodeName: string): string | null {
  const m = /^VH_M_(.+)_L$/.exec(nodeName);
  return m ? BY_MESH.get(m[1]) ?? null : null;
}
