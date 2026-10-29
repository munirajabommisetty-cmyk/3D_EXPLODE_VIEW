/**
 * Guided Learning Curricula & Educational Lessons
 * Phase 9 - Task 9.9: Exploded View & Guided Learning
 *
 * Provides structured, step-by-step educational tours for registered engineering models.
 * Validated against active component IDs and metadata without external APIs.
 */

import { PLANETARY_GEARBOX_MODEL_ID } from '../models/mechanical/planetaryGearboxModel';
import { WARREN_TRUSS_MODEL_ID } from '../models/civil/warrenTrussBridgeModel';
import { EYE_MODEL_ID } from '../models/biology/eyeStructures';
import { RC_FRAME_MODEL_ID } from '../models/civil/rcFrameModel';
import { STEAM_ENGINE_MODEL_ID } from '../models/mechanical/steamEngineModel';

export interface GuidedLessonStep {
  /** 1-based step index */
  stepIndex: number;
  /** Addressable component ID matching 3D mesh `userData.componentId` */
  componentId: string;
  /** Primary title for the step */
  title: string;
  /** Subtitle detailing engineering role */
  subtitle: string;
  /** Comprehensive technical description */
  description: string;
  /** Bulleted educational takeaways */
  educationalNotes: string[];
  /** Suggested exploded view factor for optimal viewing (0.0 to 1.0) */
  suggestedExplodedFactor?: number;
  /** Anatomy: show this step in the model's "inside" view (outer cortex hidden). */
  revealInside?: boolean;
}

export interface GuidedLesson {
  modelId: string;
  title: string;
  discipline: 'mechanical' | 'civil' | 'medical';
  description: string;
  steps: GuidedLessonStep[];
  /** Focus the camera on each step's structure (and apply revealInside) through the dispatcher. */
  frameEachStep?: boolean;
}

export const PLANETARY_GEARBOX_LESSON: GuidedLesson = {
  modelId: PLANETARY_GEARBOX_MODEL_ID,
  title: 'Epicyclic Planetary Gearbox Architecture & Kinematics',
  discipline: 'mechanical',
  description:
    'Explore the coaxial mechanical advantage, torque multiplication, and epicyclic gear interactions in an epicyclic reduction gearbox.',
  steps: [
    {
      stepIndex: 1,
      componentId: 'sun_gear',
      title: 'Central Sun Gear',
      subtitle: 'Primary High-Speed Input Pinion',
      description:
        'The central sun gear meshes externally with all three planetary gears. It serves as the primary high-speed mechanical input from the central drive shaft.',
      educationalNotes: [
        'The 16-tooth sun gear rotates at the highest rotational speed in the transmission.',
        'Its teeth exert radial and tangential forces simultaneously on all three planet gears to distribute input torque evenly.',
      ],
      suggestedExplodedFactor: 0.35,
    },
    {
      stepIndex: 2,
      componentId: 'planet_gear_1',
      title: 'Epicyclic Planet Gears',
      subtitle: 'Triple Load-Sharing Planetary Cluster',
      description:
        'Three identical planet gears are mounted at 120-degree intervals. They orbit the central sun gear while simultaneously rolling inside the stationary ring gear.',
      educationalNotes: [
        'Load sharing: Distributing input torque across 3 mesh interfaces reduces tooth bending stress by approximately 67%.',
        'Planet gears rotate on needle bearing pins mounted to the planet carrier plate.',
      ],
      suggestedExplodedFactor: 0.55,
    },
    {
      stepIndex: 3,
      componentId: 'planet_carrier',
      title: 'Planet Carrier Plate',
      subtitle: 'Low-Speed, High-Torque Output Assembly',
      description:
        'The planet carrier supports the three planet gear pin journals. In reduction drive mode, the carrier rotates at reduced angular velocity to deliver multiplied output torque.',
      educationalNotes: [
        'Carrier angular velocity ratio: ω_carrier = ω_sun × (R_sun / (R_sun + R_ring)) ≈ 0.286 (a 3.5:1 reduction ratio).',
        'Cast structural iron construction withstands heavy torsional shear.',
      ],
      suggestedExplodedFactor: 0.65,
    },
    {
      stepIndex: 4,
      componentId: 'ring_gear',
      title: 'Outer Ring Gear (Annulus)',
      subtitle: 'Stationary Reaction Housing',
      description:
        'The outer ring gear features internal involute teeth and is fixed to the transmission casing. It provides the mechanical ground reaction force that compels the planets to orbit.',
      educationalNotes: [
        'Because the ring gear is stationary, all reactionary torque is transferred directly into the chassis or machine mounting brackets.',
        'Internal tooth engagement provides high contact ratio and quiet acoustic operation.',
      ],
      suggestedExplodedFactor: 0.75,
    },
    {
      stepIndex: 5,
      componentId: 'central_shaft',
      title: 'Primary Drive Shaft',
      subtitle: 'Coaxial Input Power Transmission',
      description:
        'Precision-ground hardened alloy steel shaft coupled directly to the sun gear bore, delivering mechanical power along the central coaxial centerline.',
      educationalNotes: [
        'Coaxial design allows input and output shafts to be collinear, minimizing gearbox envelope size.',
        'Equipped with retaining collars and keyway geometry for positive torque transmission.',
      ],
      suggestedExplodedFactor: 0.5,
    },
  ],
};

export const WARREN_TRUSS_BRIDGE_LESSON: GuidedLesson = {
  modelId: WARREN_TRUSS_MODEL_ID,
  title: 'Warren Through-Truss Bridge Structural Anatomy',
  discipline: 'civil',
  description:
    'Examine the internal load paths, axial equilibrium, triangulation mechanics, and component roles of a 24-meter through-truss steel bridge.',
  steps: [
    {
      stepIndex: 1,
      componentId: 'top_chords',
      title: 'Upper Compression Chords',
      subtitle: 'Longitudinal Compression Flange',
      description:
        'Continuous heavy structural steel members forming the upper boundary of both truss planes. Under gravity loading, the top chord resists the global compression couple.',
      educationalNotes: [
        'Top chords are subjected to heavy axial compression; member design is governed by global and local Euler buckling (P_cr = π²EI / (KL)²).',
        'Transverse sway frames and top X-bracing prevent lateral-torsional buckling.',
      ],
      suggestedExplodedFactor: 0.4,
    },
    {
      stepIndex: 2,
      componentId: 'bottom_chords',
      title: 'Lower Tension Chords',
      subtitle: 'Primary Tensile Resultant & Floor Beam Support',
      description:
        'Continuous lower longitudinal box members carrying the tensile resultant of the global truss bending moment, while supporting transverse floor beams.',
      educationalNotes: [
        'Tensile stress formula: σ = P / A_net. Governed by gross section yield and bolt hole net section rupture.',
        'Designated as a Fracture Critical Member (FCM) requiring rigorous non-destructive inspection.',
      ],
      suggestedExplodedFactor: 0.45,
    },
    {
      stepIndex: 3,
      componentId: 'diagonal_members',
      title: 'Alternating Web Diagonals',
      subtitle: '60° Equilateral Web Shear Triangulation',
      description:
        'Iconic alternating diagonal members configured at 60-degree angles that transfer transverse vertical shear forces through pure axial push-pull actions.',
      educationalNotes: [
        'Triangulation ensures all members carry primary axial loads rather than high bending moments.',
        'Under moving vehicular live loads, web diagonals near midspan experience stress reversals between tension and compression.',
      ],
      suggestedExplodedFactor: 0.6,
    },
    {
      stepIndex: 4,
      componentId: 'vertical_struts',
      title: 'Vertical Panel Hangers',
      subtitle: 'Floor Beam Suspension & Panel Subdivision',
      description:
        'Vertical tension posts that hang the roadway floor beams directly from the upper chord panel nodes, halving the unsupported stringer span length.',
      educationalNotes: [
        'Converts a basic Warren truss into a subdivided Warren truss, reducing floor-beam spacing from 8m to 4m.',
        'Drastically reduces deck slab bending moments and required steel stringer depth.',
      ],
      suggestedExplodedFactor: 0.5,
    },
    {
      stepIndex: 5,
      componentId: 'gusset_plates',
      title: 'Structural Gusset Plates',
      subtitle: 'Multi-Member Panel Node Connections',
      description:
        'Heavy 22mm structural steel joint plates fastened with high-strength structural bolts that resolve concurrent member axial forces into static equilibrium.',
      educationalNotes: [
        'Gusset plate integrity is critical to truss safety; design checks evaluate Whitmore effective width, block shear tear-out, and plate edge buckling.',
        'Highlighted historically as a key failure mode in the 2007 Minneapolis I-35W bridge collapse.',
      ],
      suggestedExplodedFactor: 0.7,
    },
    {
      stepIndex: 6,
      componentId: 'end_portals',
      title: 'End Portal Frames & Sway Bracing',
      subtitle: 'Transverse Wind Resistance & Clearance Headway',
      description:
        'Rigid inclined end posts and overhead sway frames that channel lateral wind forces from top chords down into the abutments while keeping the roadway clear for vehicles.',
      educationalNotes: [
        'Inclined end posts carry the highest compressive axial load in the entire bridge superstructure.',
        'Overhead knee-braced portal frame delivers essential lateral and aerodynamic stability.',
      ],
      suggestedExplodedFactor: 0.55,
    },
    {
      stepIndex: 7,
      componentId: 'bridge_deck',
      title: 'Concrete Roadway Deck & Stringers',
      subtitle: 'Direct Vehicular Load Distribution',
      description:
        'Reinforced concrete roadway slab with stay-in-place forms, concrete safety barriers, and continuous longitudinal steel stringers supported by transverse floor beams.',
      educationalNotes: [
        'Load path: Vehicle Wheel -> Concrete Deck Slab -> Steel Stringers -> Floor Beams -> Truss Nodes.',
        'Engineered for two-way bending under AASHTO HL-93 vehicular design truck axle loading.',
      ],
      suggestedExplodedFactor: 0.35,
    },
    {
      stepIndex: 8,
      componentId: 'support_piers',
      title: 'Substructure Abutments & Bearings',
      subtitle: 'Reaction Transfer & Thermal Expansion Seats',
      description:
        'Mass concrete abutments equipped with steel-reinforced elastomeric bearing pads to transfer total bridge gravity loads into geotechnical foundations.',
      educationalNotes: [
        'Thermal expansion: One pier features an expansion bearing pad (±35mm stroke) while the opposite pier is longitudinally fixed.',
        'Isolates the bridge superstructure from ground thermal strain and braking shock.',
      ],
      suggestedExplodedFactor: 0.6,
    },
  ],
};


/**
 * Human Eye Explorer: follows the path of light, then the signal towards the brain.
 * Normal anatomy for learning only.
 */
export const HUMAN_EYE_LESSON: GuidedLesson = {
  modelId: EYE_MODEL_ID,
  title: 'How we see: follow the light through the eye',
  discipline: 'medical',
  description: 'Follow light from the cornea to the retina, and the signal along the optic nerve towards the brain. Normal anatomy for learning, not medical advice.',
  frameEachStep: true,
  steps: [
    { stepIndex: 1, componentId: 'cornea', title: 'Cornea', subtitle: 'The clear front window',
      description: 'Light first passes through the cornea. Its curved surface bends the light and does most of the focusing.',
      educationalNotes: ['Like the front lens of a camera \u2014 but it is living tissue kept clear because it has no blood vessels.'] },
    { stepIndex: 2, componentId: 'iris', title: 'Iris', subtitle: 'Controls how much light enters',
      description: 'The coloured iris widens or narrows the pupil: smaller in bright light, larger in dim light.',
      educationalNotes: ['Like the aperture of a camera.'] },
    { stepIndex: 3, componentId: 'pupil', title: 'Pupil', subtitle: 'The opening in the iris',
      description: 'The pupil is the hole in the middle of the iris through which light continues into the eye.',
      educationalNotes: ['It looks black because light going in is absorbed inside the eye.'] },
    { stepIndex: 4, componentId: 'lens', title: 'Lens', subtitle: 'Fine-tunes the focus',
      description: 'The flexible lens changes shape so that near and far objects make a sharp image on the retina.',
      educationalNotes: ['The ciliary muscle and the suspensory ligament change its shape.'] },
    { stepIndex: 5, componentId: 'ciliary_body', title: 'Ciliary body', subtitle: 'Focusing muscle and fluid maker',
      description: 'Its muscle adjusts the lens for near or far vision, and its processes make the aqueous humour.',
      educationalNotes: [] },
    { stepIndex: 6, componentId: 'vitreous_body', title: 'Vitreous body', subtitle: 'Clear gel inside the eye',
      description: 'Light crosses this clear gel, which keeps the eyeball round, to reach the retina.',
      educationalNotes: [] },
    { stepIndex: 7, componentId: 'retina', title: 'Retina', subtitle: 'Turns light into signals',
      description: 'Light-sensitive cells in the retina turn the image into electrical signals.',
      educationalNotes: ['The image formed on the retina is upside down; the brain interprets it correctly.'] },
    { stepIndex: 8, componentId: 'macula', title: 'Macula and fovea', subtitle: 'Sharpest vision',
      description: 'The fovea, in the centre of the macula, gives the sharpest detail, for example when reading.',
      educationalNotes: [] },
    { stepIndex: 9, componentId: 'optic_disc', title: 'Optic disc', subtitle: 'Where the nerve leaves (blind spot)',
      description: 'Nerve fibres from the whole retina gather here and leave the eye. There are no light-sensitive cells here.',
      educationalNotes: ['The brain fills in this blind spot, so we do not notice it.'] },
    { stepIndex: 10, componentId: 'optic_nerve', title: 'Optic nerve (simplified shape)', subtitle: 'Carries the signals towards the brain',
      description: 'The optic nerve carries the retina\u2019s signals to the brain, where seeing actually happens.',
      educationalNotes: ['This tube is a simplified educational shape; the atlas file does not include the optic nerve.'] },
  ],
};

/** Reinforced concrete frame: from the slab down to the ground, then the steel inside. */
export const RC_FRAME_LESSON: GuidedLesson = {
  modelId: RC_FRAME_MODEL_ID,
  title: 'How a reinforced concrete frame carries loads',
  discipline: 'civil',
  description: 'Follow the load from the slab to the ground, then look inside the concrete at the steel that makes it work. A simplified educational model, not a design.',
  frameEachStep: true,
  steps: [
    { stepIndex: 1, componentId: 'slab', title: 'Slab', subtitle: 'Carries what is placed on it',
      description: 'The slab carries people, furniture and its own weight and passes the load to the beams around it.',
      educationalNotes: ['Like a table top resting on its frame.'] },
    { stepIndex: 2, componentId: 'beams', title: 'Beams', subtitle: 'Carry the slab load to the columns',
      description: 'Beams span between columns. They bend under the slab\u2019s load and pass it to the columns.',
      educationalNotes: [] },
    { stepIndex: 3, componentId: 'beam_column_joints', title: 'Beam-column joint', subtitle: 'Where forces change direction',
      description: 'Forces from the beams pass through the joint into the column, so the joint must be strong and well tied.',
      educationalNotes: [] },
    { stepIndex: 4, componentId: 'columns', title: 'Columns', subtitle: 'Carry the load down',
      description: 'Columns collect the loads from the beams and carry them down, mostly in compression.',
      educationalNotes: [] },
    { stepIndex: 5, componentId: 'footings', title: 'Footings', subtitle: 'Spread the load into the ground',
      description: 'Footings spread each column\u2019s load over a larger area so the soil can carry it.',
      educationalNotes: ['Like wide snowshoes that stop you sinking into snow.'] },
    { stepIndex: 6, componentId: 'beam_longitudinal_bars', title: 'Beam bars', subtitle: 'Steel where concrete is stretched', revealInside: true,
      description: 'Concrete is strong when squeezed but weak when stretched, so steel bars are placed where the beam is stretched by bending.',
      educationalNotes: ['The concrete cover around the steel protects it from rust and fire.'] },
    { stepIndex: 7, componentId: 'beam_stirrups', title: 'Stirrups', subtitle: 'Resist shear, hold the bars', revealInside: true,
      description: 'Closed loops along the beam resist shear near the supports and keep the bars in position.',
      educationalNotes: [] },
    { stepIndex: 8, componentId: 'joint_reinforcement', title: 'Joint ties', subtitle: 'Confine the joint', revealInside: true,
      description: 'Ties continued through the joint confine its concrete, and the beam bars are bent into the joint for anchorage.',
      educationalNotes: [] },
  ],
};

/** Steam locomotive: from fire to turning wheels. */
export const STEAM_ENGINE_LESSON: GuidedLesson = {
  modelId: STEAM_ENGINE_MODEL_ID,
  title: 'From fire to turning wheels',
  discipline: 'mechanical',
  description: 'Follow the heat from the firebox to the steam in the cylinders and see how the pistons\u2019 back-and-forth motion turns the driving wheels. The animation shows motion only; no thermodynamics is simulated.',
  frameEachStep: true,
  steps: [
    { stepIndex: 1, componentId: 'firebox', title: 'Firebox', subtitle: 'Heat input',
      description: 'Fuel burns in the firebox; the hot gases pass through tubes inside the boiler.',
      educationalNotes: [] },
    { stepIndex: 2, componentId: 'boiler', title: 'Boiler', subtitle: 'Water becomes steam',
      description: 'The water in the boiler barrel boils and the steam collects at the top under pressure, in the steam dome.',
      educationalNotes: [] },
    { stepIndex: 3, componentId: 'steam_pipe', title: 'Steam pipe', subtitle: 'Steam goes to the cylinders',
      description: 'Steam from the dome runs through the steam pipe down to the steam chest above each cylinder.',
      educationalNotes: [] },
    { stepIndex: 4, componentId: 'slide_valve', title: 'Slide valve', subtitle: 'Directs the steam',
      description: 'The slide valve lets steam into one end of the cylinder while the other end exhausts.',
      educationalNotes: ['It is moved by the return crank on the driving wheel, so it always keeps in step with the piston.'] },
    { stepIndex: 5, componentId: 'piston', title: 'Piston', subtitle: 'Pushed by steam pressure',
      description: 'Steam pressure pushes the piston along the cylinder: heat energy becomes straight-line motion.',
      educationalNotes: [] },
    { stepIndex: 6, componentId: 'crosshead', title: 'Crosshead', subtitle: 'Keeps the motion straight',
      description: 'The crosshead slides between its guides so the piston rod moves only in a straight line.',
      educationalNotes: [] },
    { stepIndex: 7, componentId: 'connecting_rod', title: 'Connecting rod', subtitle: 'Links straight and circular motion',
      description: 'One end moves straight with the crosshead, the other goes round with the crank pin on the driving wheel.',
      educationalNotes: ['Like your leg pushing a bicycle pedal round.'] },
    { stepIndex: 8, componentId: 'coupling_rods', title: 'Coupling rods', subtitle: 'All six wheels drive',
      description: 'The coupling rods join the crank pins of all three wheels on each side, so they turn together.',
      educationalNotes: [] },
    { stepIndex: 9, componentId: 'driving_wheels', title: 'Driving wheels', subtitle: 'Mechanical output',
      description: 'The turning wheels move the locomotive along the rails. The two sides are set 90\u00b0 apart so it can always start.',
      educationalNotes: [] },
    { stepIndex: 10, componentId: 'blast_pipe', title: 'Blast pipe and chimney', subtitle: 'Used steam leaves',
      description: 'Exhaust steam is blasted up the chimney; each puff draws air through the fire and keeps it burning hot.',
      educationalNotes: [] },
  ],
};

const LESSONS_REGISTRY: Record<string, GuidedLesson> = {
  [PLANETARY_GEARBOX_MODEL_ID]: PLANETARY_GEARBOX_LESSON,
  [WARREN_TRUSS_MODEL_ID]: WARREN_TRUSS_BRIDGE_LESSON,
  [EYE_MODEL_ID]: HUMAN_EYE_LESSON,
  [RC_FRAME_MODEL_ID]: RC_FRAME_LESSON,
  [STEAM_ENGINE_MODEL_ID]: STEAM_ENGINE_LESSON,
};

/**
 * Retrieves the guided lesson curriculum for any registered model ID
 */
export function getGuidedLessonForModel(modelId: string): GuidedLesson | null {
  const lesson = LESSONS_REGISTRY[modelId];
  return lesson ? { ...lesson } : null;
}
