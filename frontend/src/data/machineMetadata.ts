/**
 * Machine Component Engineering Metadata
 * Task 5.3: Component Information HUD Panel
 *
 * Provides comprehensive technical specifications, kinematics, materials,
 * and operational guidelines for the planetary gearbox assembly.
 */

import {
  GEARBOX_COMPONENTS,
  type MechanicalComponentId,
  type MechanicalComponentInfo,
} from '../types/assembly';

export interface ComponentSpecification {
  label: string;
  value: string;
}

export interface ExtendedComponentInfo extends MechanicalComponentInfo {
  nominalRpm: string;
  gearRatio: string;
  pitchDiameter: string;
  modulePitch: string;
  lubricationSpec: string;
  serviceIntervalHours: number;
  specifications: ComponentSpecification[];
  engineeringNotes: string[];
}

export const EXTENDED_GEARBOX_METADATA: Record<MechanicalComponentId, ExtendedComponentInfo> = {
  sun_gear: {
    ...GEARBOX_COMPONENTS.sun_gear,
    nominalRpm: '1,200 RPM (Input)',
    gearRatio: '1.000 : 1 (Direct Drive)',
    pitchDiameter: '48.0 mm',
    modulePitch: '3.0 mm (Module)',
    lubricationSpec: 'Synthetic PAO Gear Oil ISO VG 220',
    serviceIntervalHours: 5000,
    specifications: [
      { label: 'Tooth Profile', value: 'Involute 20° Pressure Angle' },
      { label: 'Pitch Diameter', value: '48.0 mm' },
      { label: 'Face Width', value: '25.0 mm' },
      { label: 'Core Hardness', value: '58 - 62 HRC' },
      { label: 'Torque Rating', value: '45.0 N·m' },
    ],
    engineeringNotes: [
      'High-tensile brass hub minimizes frictional heat during rapid acceleration.',
      'Meshes simultaneously with three planet gears distributing radial stress.',
      'Center keyed bore connects directly to the primary drive input shaft.',
    ],
  },
  planet_gear_1: {
    ...GEARBOX_COMPONENTS.planet_gear_1,
    nominalRpm: '400 RPM (Planetary Spin)',
    gearRatio: '3.333 : 1 (Internal Ratio)',
    pitchDiameter: '36.0 mm',
    modulePitch: '3.0 mm (Module)',
    lubricationSpec: 'Synthetic PAO Gear Oil ISO VG 220',
    serviceIntervalHours: 6000,
    specifications: [
      { label: 'Angular Position', value: '0° Radial Standoff' },
      { label: 'Tooth Profile', value: 'Involute 20° Pressure Angle' },
      { label: 'Bearing Type', value: 'Cylindrical Needle Roller' },
      { label: 'Tooth Flank Treatment', value: 'Case Hardened (0.8 mm)' },
      { label: 'Radial Load Share', value: '33.3% of Input Load' },
    ],
    engineeringNotes: [
      'Transfers mechanical power from central sun gear to the outer reaction ring.',
      'Mounted on hardened cantilever carrier pin with precision bronze thrust washers.',
      'Revolving epicyclic motion balances axial forces across the assembly.',
    ],
  },
  planet_gear_2: {
    ...GEARBOX_COMPONENTS.planet_gear_2,
    nominalRpm: '400 RPM (Planetary Spin)',
    gearRatio: '3.333 : 1 (Internal Ratio)',
    pitchDiameter: '36.0 mm',
    modulePitch: '3.0 mm (Module)',
    lubricationSpec: 'Synthetic PAO Gear Oil ISO VG 220',
    serviceIntervalHours: 6000,
    specifications: [
      { label: 'Angular Position', value: '120° Radial Standoff' },
      { label: 'Tooth Profile', value: 'Involute 20° Pressure Angle' },
      { label: 'Bearing Type', value: 'Cylindrical Needle Roller' },
      { label: 'Tooth Flank Treatment', value: 'Case Hardened (0.8 mm)' },
      { label: 'Radial Load Share', value: '33.3% of Input Load' },
    ],
    engineeringNotes: [
      'Second planet gear maintaining uniform triangular load distribution.',
      'Dynamic balance checked up to 3,000 RPM carrier equivalent speed.',
      'Requires periodic backlash inspection (nominal 0.08 - 0.12 mm).',
    ],
  },
  planet_gear_3: {
    ...GEARBOX_COMPONENTS.planet_gear_3,
    nominalRpm: '400 RPM (Planetary Spin)',
    gearRatio: '3.333 : 1 (Internal Ratio)',
    pitchDiameter: '36.0 mm',
    modulePitch: '3.0 mm (Module)',
    lubricationSpec: 'Synthetic PAO Gear Oil ISO VG 220',
    serviceIntervalHours: 6000,
    specifications: [
      { label: 'Angular Position', value: '240° Radial Standoff' },
      { label: 'Tooth Profile', value: 'Involute 20° Pressure Angle' },
      { label: 'Bearing Type', value: 'Cylindrical Needle Roller' },
      { label: 'Tooth Flank Treatment', value: 'Case Hardened (0.8 mm)' },
      { label: 'Radial Load Share', value: '33.3% of Input Load' },
    ],
    engineeringNotes: [
      'Completes symmetric three-point kinematics to eliminate cantilever shaft deflection.',
      'Identical tooth form and mass-matched to planets A and B within ±0.5 grams.',
      'Surface finish ground to Ra 0.4 µm for silent low-vibration engagement.',
    ],
  },
  ring_gear: {
    ...GEARBOX_COMPONENTS.ring_gear,
    nominalRpm: '0 RPM (Stationary Reaction)',
    gearRatio: '3.500 : 1 (Overall Ratio)',
    pitchDiameter: '120.0 mm (Internal)',
    modulePitch: '3.0 mm (Module)',
    lubricationSpec: 'Continuous Oil Sump Splash',
    serviceIntervalHours: 12000,
    specifications: [
      { label: 'Internal Diameter', value: '120.0 mm' },
      { label: 'External Housing Dia', value: '148.0 mm' },
      { label: 'Mounting Style', value: '4x M8 High-Grade Radial Brackets' },
      { label: 'Wall Thickness', value: '14.0 mm Structural Rim' },
      { label: 'Reaction Torque Max', value: '157.5 N·m' },
    ],
    engineeringNotes: [
      'Outer casing provides grounding reaction torque to drive planet carrier reduction.',
      'Internal tooth ring gas-nitrided for extreme scuffing and wear resistance.',
      'External machined flanges dissipate thermodynamic heat generated under load.',
    ],
  },
  planet_carrier: {
    ...GEARBOX_COMPONENTS.planet_carrier,
    nominalRpm: '343 RPM (Reduced Output)',
    gearRatio: '1 : 3.500 (Reduction Output)',
    pitchDiameter: '84.0 mm (Orbit Circle)',
    modulePitch: 'N/A (Structural Frame)',
    lubricationSpec: 'Enclosed Gearbox Oil Bath',
    serviceIntervalHours: 10000,
    specifications: [
      { label: 'Spider Configuration', value: 'Triangular 3-Pin Yoke' },
      { label: 'Carrier Pin Diameter', value: '12.0 mm Precision Ground' },
      { label: 'Plate Thickness', value: '8.0 mm Cast Ductile Iron' },
      { label: 'Output Flange', value: 'Tapered Spline Interface' },
      { label: 'Speed Reduction Factor', value: '3.5x Input Reduction' },
    ],
    engineeringNotes: [
      'Gathers orbital motion from the three planet gears into single unified output shaft.',
      'Engineered from ASTM A536 ductile cast iron for high vibrational damping.',
      'Integrated counterweights optimize dynamic rotating balance.',
    ],
  },
  central_shaft: {
    ...GEARBOX_COMPONENTS.central_shaft,
    nominalRpm: '1,200 RPM (High-Speed Input)',
    gearRatio: '1.000 : 1 (Input Axis)',
    pitchDiameter: '16.0 mm (Axial Diameter)',
    modulePitch: 'N/A (Drive Axle)',
    lubricationSpec: 'Sealed Deep-Groove Bearing Grease',
    serviceIntervalHours: 8000,
    specifications: [
      { label: 'Shaft Diameter', value: '16.0 mm Nominal' },
      { label: 'Overall Length', value: '140.0 mm' },
      { label: 'Runout Tolerance', value: '< 0.005 mm TIR' },
      { label: 'Surface Treatment', value: 'Hard Chromium Plating' },
      { label: 'Bearing Support', value: 'Dual Deep-Groove Ball Bearings' },
    ],
    engineeringNotes: [
      'Transfers high-speed motor rotation to central sun gear via precision keyway.',
      'Induction hardened at bearing journal surfaces to prevent fretting wear.',
      'Maintains rigid concentric alignment of all rotating components.',
    ],
  },
};

/**
 * Validates whether a given string is a recognized gearbox component ID.
 */
export function isValidComponentId(id: string | null | undefined): id is MechanicalComponentId {
  if (!id || typeof id !== 'string') return false;
  return id in EXTENDED_GEARBOX_METADATA;
}

/**
 * Retrieves the complete technical specification for a mechanical component.
 * Safely returns null if the ID is invalid or missing.
 */
export function getComponentMetadata(
  id: string | null | undefined
): ExtendedComponentInfo | null {
  if (!isValidComponentId(id)) return null;
  return EXTENDED_GEARBOX_METADATA[id] ?? null;
}

/**
 * Retrieves all registered mechanical component metadata objects.
 */
export function getAllComponentMetadata(): ExtendedComponentInfo[] {
  return Object.values(EXTENDED_GEARBOX_METADATA);
}

/**
 * All valid mechanical component IDs registered in the system.
 */
export const ALL_MECHANICAL_COMPONENT_IDS: readonly MechanicalComponentId[] = [
  'sun_gear',
  'planet_gear_1',
  'planet_gear_2',
  'planet_gear_3',
  'ring_gear',
  'planet_carrier',
  'central_shaft',
] as const;
