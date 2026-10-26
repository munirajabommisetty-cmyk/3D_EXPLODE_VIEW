/**
 * Guided Learning Curricula & Educational Lessons
 * Phase 9 - Task 9.9: Exploded View & Guided Learning
 *
 * Provides structured, step-by-step educational tours for registered engineering models.
 * Validated against active component IDs and metadata without external APIs.
 */

import { PLANETARY_GEARBOX_MODEL_ID } from '../models/mechanical/planetaryGearboxModel';
import { WARREN_TRUSS_MODEL_ID } from '../models/civil/warrenTrussBridgeModel';

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
}

export interface GuidedLesson {
  modelId: string;
  title: string;
  discipline: 'mechanical' | 'civil';
  description: string;
  steps: GuidedLessonStep[];
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

const LESSONS_REGISTRY: Record<string, GuidedLesson> = {
  [PLANETARY_GEARBOX_MODEL_ID]: PLANETARY_GEARBOX_LESSON,
  [WARREN_TRUSS_MODEL_ID]: WARREN_TRUSS_BRIDGE_LESSON,
};

/**
 * Retrieves the guided lesson curriculum for any registered model ID
 */
export function getGuidedLessonForModel(modelId: string): GuidedLesson | null {
  const lesson = LESSONS_REGISTRY[modelId];
  return lesson ? { ...lesson } : null;
}
