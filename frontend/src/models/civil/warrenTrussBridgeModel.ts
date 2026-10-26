/**
 * Warren Truss Bridge Model Definition
 * Phase 9 - Task 9.8: Civil Engineering Warren Truss Bridge Model
 *
 * Implements the standardized EngineeringModelDefinition contract for the procedural
 * 3D Warren Truss Bridge, including hierarchical CAD assembly tree, Civil component metadata,
 * structural roles, material annotations, and educational engineering notes.
 */

import type { Scene } from 'three';
import {
  buildWarrenTrussBridge,
  WARREN_TRUSS_COMPONENT_IDS,
  type WarrenTrussComponentId,
} from './WarrenTrussBridge';
import type {
  EngineeringModelDefinition,
  AssemblyTreeNode,
  ModelRuntimeInstance,
} from '../../types/models';
import type { CivilComponentMetadata } from '../../types/engineering';

export const WARREN_TRUSS_MODEL_ID = 'warren_truss_bridge';

/**
 * All addressable component IDs for the Warren truss bridge
 */
export const WARREN_TRUSS_BRIDGE_COMPONENT_IDS: readonly WarrenTrussComponentId[] =
  WARREN_TRUSS_COMPONENT_IDS;

/**
 * Hierarchical CAD assembly tree for the Warren Truss Bridge
 */
export function getWarrenTrussAssemblyTree(): AssemblyTreeNode {
  return {
    id: 'warren_truss_root',
    name: 'Warren Truss Bridge Assembly',
    type: 'assembly',
    defaultExpanded: true,
    children: [
      {
        id: 'sub_superstructure',
        name: 'Superstructure Truss System',
        type: 'subassembly',
        defaultExpanded: true,
        children: [
          {
            id: 'node_top_chords',
            name: 'Upper Compression Chords',
            type: 'component',
            componentId: 'top_chords',
            defaultVisible: true,
          },
          {
            id: 'node_bottom_chords',
            name: 'Lower Tension Chords',
            type: 'component',
            componentId: 'bottom_chords',
            defaultVisible: true,
          },
          {
            id: 'node_diagonal_members',
            name: 'Alternating Diagonal Web Members',
            type: 'component',
            componentId: 'diagonal_members',
            defaultVisible: true,
          },
          {
            id: 'node_vertical_struts',
            name: 'Vertical Panel Hangers',
            type: 'component',
            componentId: 'vertical_struts',
            defaultVisible: true,
          },
        ],
      },
      {
        id: 'sub_bracing_joints',
        name: 'Connections & Portal Frames',
        type: 'subassembly',
        defaultExpanded: true,
        children: [
          {
            id: 'node_gusset_plates',
            name: 'Structural Gusset Plates',
            type: 'component',
            componentId: 'gusset_plates',
            defaultVisible: true,
          },
          {
            id: 'node_end_portals',
            name: 'End Portal Frames & Sway Bracing',
            type: 'component',
            componentId: 'end_portals',
            defaultVisible: true,
          },
        ],
      },
      {
        id: 'sub_deck_substructure',
        name: 'Deck & Substructure System',
        type: 'subassembly',
        defaultExpanded: true,
        children: [
          {
            id: 'node_bridge_deck',
            name: 'Concrete Roadway Deck & Stringers',
            type: 'component',
            componentId: 'bridge_deck',
            defaultVisible: true,
          },
          {
            id: 'node_support_piers',
            name: 'Substructure Abutments & Bearings',
            type: 'component',
            componentId: 'support_piers',
            defaultVisible: true,
          },
        ],
      },
    ],
  };
}

/**
 * Civil engineering metadata repository for Warren Truss Bridge components
 */
const CIVIL_BRIDGE_METADATA: Record<WarrenTrussComponentId, CivilComponentMetadata> = {
  top_chords: {
    id: 'top_chords',
    name: 'Upper Compression Chords',
    domain: 'civil',
    role: 'Primary Upper Longitudinal Compression Chord',
    materialName: 'Structural Steel ASTM A709 Grade 50',
    description:
      'Continuous upper longitudinal steel chord members forming the top boundary of each truss girder. Carries primarily compressive axial loads under downward gravitational live and dead loading.',
    structuralRole: 'top_chord',
    nominalForceType: 'compression',
    designLoadAnnotation: 'AASHTO Strength I Axial Compression Limit State',
    materialGrade: 'ASTM A709 Gr. 50 (Fy = 345 MPa)',
    spanLength: '16.0 m (4 Interior Bays @ 4.0 m)',
    slendernessAnnotation: 'KL/r <= 120 (AASHTO Compression Member Limit)',
    specifications: [
      { label: 'Cross Section', value: 'HSS 350x350x16 Hollow Structural Section' },
      { label: 'Axial Area', value: '20,800 mm²' },
      { label: 'Radius of Gyration', value: 'rx = ry = 138 mm' },
      { label: 'Effective Length Factor (K)', value: '0.85 (Braced Node)' },
    ],
    engineeringNotes: [
      'Euler buckling capacity governs member sizing: Pcr = pi^2 * E * I / (K * L)^2.',
      'Top chords are continuously braced against lateral-torsional sway by upper transverse struts and X-bracing.',
    ],
    educationalNotes: [
      'In simple-span gravity loading, the top chord is in direct compression.',
      'Educational Concept: Member sizing is governed by compression stability and local plate buckling rather than yield rupture. Live FEA calculations are not simulated.',
    ],
  },
  bottom_chords: {
    id: 'bottom_chords',
    name: 'Lower Tension Chords',
    domain: 'civil',
    role: 'Primary Lower Longitudinal Tension Chord',
    materialName: 'Structural Steel ASTM A709 Grade 50',
    description:
      'Continuous lower longitudinal steel chord members carrying the primary tension resultant of the global truss bending moment, while supporting transverse floor beams.',
    structuralRole: 'bottom_chord',
    nominalForceType: 'tension',
    designLoadAnnotation: 'AASHTO Strength I Tension Limit State (Yield & Net Section Rupture)',
    materialGrade: 'ASTM A709 Gr. 50 (Fy = 345 MPa, Fu = 450 MPa)',
    spanLength: '24.0 m (6 Bays @ 4.0 m)',
    slendernessAnnotation: 'L/r <= 200 (AASHTO Tension Member Recommendation)',
    specifications: [
      { label: 'Cross Section', value: 'Built-Up Steel Box (400x350x18 mm)' },
      { label: 'Gross Section Area (Ag)', value: '25,200 mm²' },
      { label: 'AASHTO Category', value: 'Fracture Critical Member (FCM)' },
      { label: 'Splice Type', value: 'High-Strength Bolted Splice with 22mm A325 Bolts' },
    ],
    engineeringNotes: [
      'Bottom chords resist global positive moment tensile force: T = M_max / d_truss.',
      'Member governed by gross section yielding (Phi * Fy * Ag) and net section fracture (Phi * Fu * Ae).',
    ],
    educationalNotes: [
      'Under downward gravity loading, the bottom chord is in uniform tension.',
      'Educational Concept: Unlike compression members, tension members do not buckle but require strict fracture-critical inspection. Live FEA calculations are not simulated.',
    ],
  },
  diagonal_members: {
    id: 'diagonal_members',
    name: 'Alternating Diagonal Web Members',
    domain: 'civil',
    role: 'Truss Web Shear Diagonal',
    materialName: 'Structural Steel ASTM A709 Grade 50',
    description:
      'Equilateral web diagonals configured at 60-degree angles connecting top and bottom chords in the classic Warren truss triangulated pattern.',
    structuralRole: 'diagonal_member',
    nominalForceType: 'combined',
    designLoadAnnotation: 'AASHTO Transverse Shear Transfer with Stress Reversals',
    materialGrade: 'ASTM A709 Gr. 50',
    spanLength: '4.62 m (Diagonals along 60° Inclination)',
    slendernessAnnotation: 'KL/r <= 120 (Governed by Compression Cycle)',
    specifications: [
      { label: 'Truss Geometry', value: 'Equilateral Warren Pattern (60° Angle)' },
      { label: 'Cross Section', value: 'Wide Flange W310x107' },
      { label: 'Shear Mechanism', value: 'Triangulated Axial Push-Pull' },
      { label: 'Web Bay Count', value: '4 Intermediate Diagonal Bays' },
    ],
    engineeringNotes: [
      'Carries global vertical shear through axial component: V = P * sin(60°).',
      'Diagonals experience alternating tension or compression depending on truck live-load position.',
    ],
    educationalNotes: [
      'The defining characteristic of the Warren truss is alternating diagonals that share shear duty.',
      'Educational Concept: Near span center, moving loads cause stress reversals where a member switches between tension and compression. Live FEA calculations are not simulated.',
    ],
  },
  vertical_struts: {
    id: 'vertical_struts',
    name: 'Vertical Panel Hangers',
    domain: 'civil',
    role: 'Deck Suspension Floor Beam Hanger',
    materialName: 'Structural Steel ASTM A709 Grade 50',
    description:
      'Vertical web members positioned at intermediate panel points to reduce the unsupported floor-beam span and hang the deck from the top chord joints.',
    structuralRole: 'vertical_strut',
    nominalForceType: 'tension',
    designLoadAnnotation: 'Local Floor Beam Reaction Suspended to Top Panel Joints',
    materialGrade: 'ASTM A709 Gr. 50',
    spanLength: '4.0 m Vertical Height',
    slendernessAnnotation: 'L/r <= 240 (Tension Hanger Standard)',
    specifications: [
      { label: 'Member Role', value: 'Subdivided Truss Floor Beam Hanger' },
      { label: 'Cross Section', value: 'Wide Flange W250x67' },
      { label: 'Total Hanger Count', value: '10 Hanger Posts (5 Per Truss Plane)' },
      { label: 'Joint Fasteners', value: 'Double-Shear Gusset Bolting' },
    ],
    engineeringNotes: [
      'Hangers transfer floor beam deck reactions directly into top chord panel points.',
      'Shortens bottom chord panel length from 8m to 4m, drastically reducing stringer weight.',
    ],
    educationalNotes: [
      'Verticals in a Warren truss are primarily tension hangers, not compression columns.',
      'Educational Concept: Adding verticals converts a basic Warren truss into a subdivided Warren truss, reducing deck bending spans. Live FEA calculations are not simulated.',
    ],
  },
  gusset_plates: {
    id: 'gusset_plates',
    name: 'Structural Gusset Plates',
    domain: 'civil',
    role: 'Panel Node Joint Connector',
    materialName: 'High-Strength Steel Plate ASTM A572 Grade 50',
    description:
      'Heavy structural steel connection plates fastened with high-strength structural bolts at chord-web node intersections.',
    structuralRole: 'gusset_plate',
    nominalForceType: 'combined',
    designLoadAnnotation: 'Whitmore Section Yielding & Block Shear Rupture',
    materialGrade: 'ASTM A572 Gr. 50 Plate (22 mm Thickness)',
    spanLength: '0.65 m x 0.65 m Joint Envelope',
    slendernessAnnotation: 'Edge Stiffening Angles Provided against Free-Edge Buckling',
    specifications: [
      { label: 'Plate Thickness', value: '22 mm Structural Plate' },
      { label: 'Fastener Type', value: 'ASTM F3125 Grade A325 Heavy Hex Bolts' },
      { label: 'Node Count', value: '22 Gusseted Joint Nodes' },
      { label: 'Inspection Protocol', value: 'AASHTO LRFD Critical Node Evaluation' },
    ],
    engineeringNotes: [
      'Resolves concurrent member axial forces to establish static equilibrium at each panel node.',
      'Design checks: Whitmore effective section, block shear tear-out, and bolt bearing/shear.',
    ],
    educationalNotes: [
      'Gusset plates are among the most critical components in truss bridges (highlighted by the 2007 I-35W collapse).',
      'Educational Concept: Whitmore section theory models 30° load spreading through the plate. Live FEA calculations are not simulated.',
    ],
  },
  end_portals: {
    id: 'end_portals',
    name: 'End Portal Frames & Sway Bracing',
    domain: 'civil',
    role: 'Lateral Sway Stability & Portal Entrance Frame',
    materialName: 'Structural Steel ASTM A709 Grade 50',
    description:
      'Rigid inclined end posts and overhead transverse sway frames at both bridge portals. Delivers lateral stability and vertical clearance for vehicular traffic.',
    structuralRole: 'vertical_strut',
    nominalForceType: 'combined',
    designLoadAnnotation: 'AASHTO Transverse Wind & Seismic Lateral Load Transfer',
    materialGrade: 'ASTM A709 Gr. 50',
    spanLength: '5.0 m Portal Width / 4.5 m Vertical Clearance',
    slendernessAnnotation: 'Rigid Knee-Braced Frame with Rigid Moment Corners',
    specifications: [
      { label: 'Frame Configuration', value: 'Rigid Knee-Braced Portal Frame' },
      { label: 'Inclination Angle', value: '45° End Post Angle' },
      { label: 'Roadway Clearance', value: '4.5 m Clear Headway' },
      { label: 'Wind Transfer', value: 'Channels Upper Lateral Shear to Abutments' },
    ],
    engineeringNotes: [
      'Acts as a rigid portal frame transferring top lateral wind reactions down to bearing seats.',
      'End posts carry the highest compressive axial load in the entire bridge superstructure.',
    ],
    educationalNotes: [
      'Portal frames prevent the two parallel trusses from tipping over like dominoes under wind.',
      'Educational Concept: Provides aerodynamic stability while maintaining open vehicle headway. Live FEA calculations are not simulated.',
    ],
  },
  bridge_deck: {
    id: 'bridge_deck',
    name: 'Concrete Roadway Deck & Stringers',
    domain: 'civil',
    role: 'Vehicular Roadway Surface & Distribution System',
    materialName: 'Reinforced Concrete (f\'c = 35 MPa) on Steel Stringers',
    description:
      'Reinforced concrete roadway slab with stay-in-place forms, concrete safety barriers, and continuous longitudinal steel stringers supported by transverse floor beams.',
    structuralRole: 'deck',
    nominalForceType: 'bending',
    designLoadAnnotation: 'AASHTO HL-93 Design Truck & Tandem Wheel Axle Loads',
    materialGrade: 'Cast-in-Place Concrete f\'c = 35 MPa, Epoxy Rebar Gr. 60',
    spanLength: '24.0 m Overall Length / 4.7 m Usable Roadway Width',
    slendernessAnnotation: '280 mm Slab Thickness (Span-to-Depth Ratio ~ 1:14)',
    specifications: [
      { label: 'Roadway Width', value: '4.7 m (Two 2.35m Traffic Lanes)' },
      { label: 'Slab Thickness', value: '280 mm Reinforced Concrete' },
      { label: 'Stringer System', value: '4 Longitudinal W-Shape Steel Stringers' },
      { label: 'Wearing Surface', value: '50 mm High-Performance Asphalt Overlay' },
    ],
    engineeringNotes: [
      'Designed for transverse two-way flexure under concentrated wheel footprint loads.',
      'Composite shear studs bond concrete deck slab to steel stringers to enhance stiffness.',
    ],
    educationalNotes: [
      'The bridge deck directly receives vehicular traffic and distributes wheel loads through stringers to floor beams.',
      'Educational Concept: Load transfer path: Wheel -> Deck Slab -> Stringers -> Floor Beams -> Truss Nodes. Live FEA calculations are not simulated.',
    ],
  },
  support_piers: {
    id: 'support_piers',
    name: 'Substructure Abutments & Bearings',
    domain: 'civil',
    role: 'Geotechnical Substructure & Thermal Expansion Seats',
    materialName: 'Mass Reinforced Concrete with Neoprene Bearings',
    description:
      'Reinforced concrete bridge seat abutments/piers equipped with steel-reinforced elastomeric bearing pads to support reactions and accommodate thermal expansion.',
    structuralRole: 'pier',
    nominalForceType: 'compression',
    designLoadAnnotation: 'Total Superstructure Dead Load + Live Load Braking Reactions',
    materialGrade: 'Mass Concrete f\'c = 30 MPa with ASTM D4014 Neoprene Bearings',
    spanLength: '6.6 m Abutment Width / 2.8 m Height',
    slendernessAnnotation: 'Gravity Mass Abutment with Drilled Shaft Foundations',
    specifications: [
      { label: 'Bearing Type', value: 'Steel-Reinforced Elastomeric Pads (Durometer 60)' },
      { label: 'Bearing Configuration', value: 'Fixed Shoe (East) / Expansion Roller (West)' },
      { label: 'Thermal Movement Capacity', value: '+/- 35 mm Longitudinal Stroke' },
      { label: 'Bearing Design Capacity', value: '2500 kN Nominal Service Load' },
    ],
    engineeringNotes: [
      'Supports bridge dead weight (~190 tonnes) plus dynamic HL-93 vehicular live loads.',
      'Fixed-expansion bearing pair accommodates cyclic thermal expansion (delta_L = alpha * L * delta_T).',
    ],
    educationalNotes: [
      'Bridges must be free to expand in summer and contract in winter without cracking.',
      'Educational Concept: One pier is pinned while the opposite pier allows longitudinal sliding on elastomeric bearings. Live FEA calculations are not simulated.',
    ],
  },
};

/**
 * Looks up civil engineering metadata for any bridge component ID
 */
export function getWarrenTrussComponentMetadata(
  componentId: string
): CivilComponentMetadata | null {
  const metadata = CIVIL_BRIDGE_METADATA[componentId as WarrenTrussComponentId];
  return metadata ? { ...metadata } : null;
}

/**
 * Standardized EngineeringModelDefinition for the Civil Warren Truss Bridge
 */
export const warrenTrussBridgeModel: EngineeringModelDefinition = {
  id: WARREN_TRUSS_MODEL_ID,
  name: 'Warren Truss Bridge Assembly',
  domain: 'civil',
  category: 'Structural & Bridge Engineering',
  description:
    'Full-scale 24-meter through-truss steel bridge featuring equilateral Warren web diagonals, reinforced concrete roadway deck, floor beam system, overhead sway portal frames, and elastomeric pier abutments.',
  thumbnailUrl: '/assets/models/warren_truss_bridge.webp',
  difficulty: 'Advanced',
  tags: [
    'Truss Bridge',
    'Warren Truss',
    'Civil Engineering',
    'Structural Analysis',
    'AASHTO LRFD',
    'Steel Superstructure',
  ],
  componentCount: WARREN_TRUSS_BRIDGE_COMPONENT_IDS.length,
  cameraConfig: {
    initialPosition: [18, 12, 22],
    target: [0, 1.5, 0],
    minDistance: 3.0,
    maxDistance: 70.0,
    fov: 45,
    defaultPreset: 'isometric',
  },

  getAssemblyTree: getWarrenTrussAssemblyTree,

  getComponentMetadata: getWarrenTrussComponentMetadata,

  getAllComponentIds: () => [...WARREN_TRUSS_BRIDGE_COMPONENT_IDS],

  buildScene: (scene: Scene): ModelRuntimeInstance => {
    const controller = buildWarrenTrussBridge();
    scene.add(controller.group);

    return {
      rootGroup: controller.group,
      updateAnimation: (deltaSeconds: number) => {
        controller.update(deltaSeconds);
      },
      setExplodedFactor: (factor: number) => {
        controller.setExplodedFactor?.(factor);
      },
      dispose: () => {
        scene.remove(controller.group);
        controller.dispose();
      },
    };
  },
};
