/**
 * Planetary Gearbox Model Definition
 * Phase 9 - Task 9.2: Modular Model Registry & Planetary Gearbox Refactor
 *
 * Adapts the existing procedural Three.js Planetary Gearbox assembly into the
 * standardized EngineeringModelDefinition contract, preserving all existing geometry,
 * PBR materials, animations, and component specifications.
 */

import type { Scene } from 'three';
import { buildPlanetaryGearbox } from '../../components/scene/PlanetaryGearbox';
import {
  getComponentMetadata,
  EXTENDED_GEARBOX_METADATA,
} from '../../data/machineMetadata';
import type {
  EngineeringModelDefinition,
  AssemblyTreeNode,
  ModelRuntimeInstance,
} from '../../types/models';
import type { MechanicalComponentMetadata } from '../../types/engineering';
import type { MechanicalComponentId } from '../../types/assembly';
import { PLANETARY_GEARBOX_RELATIONSHIPS } from './planetaryGearboxRelationships';

export const PLANETARY_GEARBOX_MODEL_ID = 'planetary_gearbox';

/**
 * All addressable component IDs for the planetary gearbox
 */
export const PLANETARY_GEARBOX_COMPONENT_IDS: readonly MechanicalComponentId[] = [
  'sun_gear',
  'planet_gear_1',
  'planet_gear_2',
  'planet_gear_3',
  'ring_gear',
  'planet_carrier',
  'central_shaft',
] as const;

/**
 * Hierarchical CAD assembly tree for the planetary gearbox
 */
export function getPlanetaryGearboxAssemblyTree(): AssemblyTreeNode {
  return {
    id: 'planetary_gearbox_root',
    name: 'Planetary Gearbox Assembly',
    type: 'assembly',
    defaultExpanded: true,
    children: [
      {
        id: 'stage_epicyclic',
        name: 'Epicyclic Planetary Stage',
        type: 'subassembly',
        defaultExpanded: true,
        children: [
          {
            id: 'node_sun_gear',
            name: 'Sun Gear',
            type: 'component',
            componentId: 'sun_gear',
            defaultVisible: true,
          },
          {
            id: 'sub_planets_cluster',
            name: 'Planet Gears Cluster',
            type: 'subassembly',
            defaultExpanded: true,
            children: [
              {
                id: 'node_planet_gear_1',
                name: 'Planet Gear A',
                type: 'component',
                componentId: 'planet_gear_1',
                defaultVisible: true,
              },
              {
                id: 'node_planet_gear_2',
                name: 'Planet Gear B',
                type: 'component',
                componentId: 'planet_gear_2',
                defaultVisible: true,
              },
              {
                id: 'node_planet_gear_3',
                name: 'Planet Gear C',
                type: 'component',
                componentId: 'planet_gear_3',
                defaultVisible: true,
              },
            ],
          },
          {
            id: 'node_planet_carrier',
            name: 'Planet Carrier Plate',
            type: 'component',
            componentId: 'planet_carrier',
            defaultVisible: true,
          },
        ],
      },
      {
        id: 'node_ring_gear',
        name: 'Outer Annulus (Ring Gear)',
        type: 'component',
        componentId: 'ring_gear',
        defaultVisible: true,
      },
      {
        id: 'node_central_shaft',
        name: 'Primary Drive Shaft',
        type: 'component',
        componentId: 'central_shaft',
        defaultVisible: true,
      },
    ],
  };
}

/**
 * Looks up mechanical engineering metadata for any gearbox component ID
 */
export function getPlanetaryGearboxComponentMetadata(
  componentId: string
): MechanicalComponentMetadata | null {
  const existing = getComponentMetadata(componentId);
  if (!existing) {
    return null;
  }

  const relationships = PLANETARY_GEARBOX_RELATIONSHIPS.get(componentId);
  return {
    ...existing,
    domain: 'mechanical',
    ...(relationships ? { relationships: [...relationships] } : {}),
  };
}

/**
 * Standardized EngineeringModelDefinition for the Epicyclic Planetary Gearbox
 */
export const planetaryGearboxModel: EngineeringModelDefinition = {
  id: PLANETARY_GEARBOX_MODEL_ID,
  name: 'Epicyclic Planetary Gearbox',
  domain: 'mechanical',
  category: 'Transmission & Kinematics',
  description:
    'High-torque coaxial reduction gearbox featuring central sun gear, three epicyclic planet gears, planet carrier, and outer ring gear. Used in robotics, automotive, and aerospace transmissions.',
  thumbnailUrl: '/assets/models/planetary_gearbox.webp',
  difficulty: 'Intermediate',
  tags: [
    'Gearbox',
    'Epicyclic Transmission',
    'Torque Multiplication',
    'Kinematics',
    'Mechanical Engineering',
  ],
  componentCount: PLANETARY_GEARBOX_COMPONENT_IDS.length,
  cameraConfig: {
    initialPosition: [0, 5.6, 6.6],
    target: [0, 0, 0],
    minDistance: 2.0,
    maxDistance: 25.0,
    fov: 45,
    defaultPreset: 'isometric',
  },

  animations: [
    {
      id: 'gear_train_rotation',
      label: 'Epicyclic gear train in motion',
      description:
        'Sun gear (input) drives the planet gears, which roll inside the fixed ring gear and turn the planet carrier (output) at a reduced speed.',
    },
  ],

  getAssemblyTree: getPlanetaryGearboxAssemblyTree,

  getComponentMetadata: getPlanetaryGearboxComponentMetadata,

  getAllComponentIds: () => [...PLANETARY_GEARBOX_COMPONENT_IDS],

  buildScene: (scene: Scene): ModelRuntimeInstance => {
    const controller = buildPlanetaryGearbox();
    scene.add(controller.group);

    return {
      rootGroup: controller.group,
      updateAnimation: (deltaSeconds: number) => {
        controller.update(deltaSeconds, true);
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

export { EXTENDED_GEARBOX_METADATA };
