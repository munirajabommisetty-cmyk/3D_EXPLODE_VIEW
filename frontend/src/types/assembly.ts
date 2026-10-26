/**
 * Mechanical component types and metadata definitions for the 3D Planetary Gearbox assembly
 */

export type MechanicalComponentId =
  | 'sun_gear'
  | 'planet_gear_1'
  | 'planet_gear_2'
  | 'planet_gear_3'
  | 'ring_gear'
  | 'planet_carrier'
  | 'central_shaft';

export interface MechanicalComponentInfo {
  id: MechanicalComponentId;
  name: string;
  role: string;
  teethCount?: number;
  materialName: string;
  description: string;
}

export const GEARBOX_COMPONENTS: Record<MechanicalComponentId, MechanicalComponentInfo> = {
  sun_gear: {
    id: 'sun_gear',
    name: 'Sun Gear',
    role: 'Central Driving Input',
    teethCount: 16,
    materialName: 'High-Tensile Brass Alloy',
    description: 'Central input gear that meshes with all three planet gears to distribute mechanical torque.',
  },
  planet_gear_1: {
    id: 'planet_gear_1',
    name: 'Planet Gear A',
    role: 'Epicyclic Torque Transfer',
    teethCount: 12,
    materialName: 'Carburized Steel (AISI 8620)',
    description: 'Rotates on its own needle bearing axis while orbiting within the stationary ring gear.',
  },
  planet_gear_2: {
    id: 'planet_gear_2',
    name: 'Planet Gear B',
    role: 'Epicyclic Torque Transfer',
    teethCount: 12,
    materialName: 'Carburized Steel (AISI 8620)',
    description: 'Second of three load-sharing planet gears positioned at 120-degree radial offset.',
  },
  planet_gear_3: {
    id: 'planet_gear_3',
    name: 'Planet Gear C',
    role: 'Epicyclic Torque Transfer',
    teethCount: 12,
    materialName: 'Carburized Steel (AISI 8620)',
    description: 'Third load-sharing planet gear completing the balanced 3-point planetary stage.',
  },
  ring_gear: {
    id: 'ring_gear',
    name: 'Annulus (Ring Gear)',
    role: 'Stationary Outer Reaction Ring',
    teethCount: 40,
    materialName: 'Forged Nitrided Steel',
    description: 'Outer ring with internal teeth providing the reaction torque for the planetary reduction.',
  },
  planet_carrier: {
    id: 'planet_carrier',
    name: 'Planet Carrier & Output Plate',
    role: 'Output Torque Collector',
    materialName: 'Ductile Cast Iron (ASTM A536)',
    description: 'Rigid triangular spider plate supporting the three planet gear shafts and transmitting reduced-speed output.',
  },
  central_shaft: {
    id: 'central_shaft',
    name: 'Primary Drive Shaft',
    role: 'Axial Alignment & Power Transfer',
    materialName: 'Hardened Chrome-Moly (AISI 4140)',
    description: 'Central transmission axle maintaining concentric alignment across all rotating stages.',
  },
};
