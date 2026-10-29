/**
 * Planetary gearbox component relationships (Task V3).
 *
 * Only links supported by this model's own data are listed: the component metadata
 * (data/machineMetadata.ts), the declared animation, and the procedural geometry
 * (components/scene/PlanetaryGearbox.ts: planet orbit radius = sun + planet radius, ring inner
 * radius = sun + 2 x planet radius, planets placed on the carrier pins, shaft turns with the sun).
 *
 * Deliberately NOT defined (no evidence in the model): how the ring gear is mounted (there is
 * no housing component), any link between the carrier and the drive shaft, planet-to-planet links.
 */

import { buildRelationshipIndex, type RelationshipEdge } from '../../services/scene/relationshipTable';

const PLANETS = ['planet_gear_1', 'planet_gear_2', 'planet_gear_3'] as const;

export const PLANETARY_GEARBOX_RELATIONSHIP_EDGES: readonly RelationshipEdge[] = [
  {
    from: 'central_shaft', type: 'drives', to: 'sun_gear',
    description: 'The drive shaft turns the sun gear through a keyway.',
    evidence: 'central_shaft note "Transfers high-speed motor rotation to central sun gear via precision keyway"; animation sets shaft angle = sun angle.',
  },
  ...PLANETS.flatMap((planet): RelationshipEdge[] => [
    {
      from: 'sun_gear', type: 'mates_with', to: planet,
      description: 'Sun gear teeth mesh with this planet gear.',
      evidence: 'sun_gear note "Meshes simultaneously with three planet gears"; geometry orbit radius = sun radius + planet radius.',
    },
    {
      from: 'sun_gear', type: 'drives', to: planet,
      description: 'The sun gear (input) drives the planet gear.',
      evidence: 'animation gear_train_rotation: "Sun gear (input) drives the planet gears".',
    },
    {
      from: planet, type: 'mates_with', to: 'ring_gear',
      description: 'The planet gear rolls inside the fixed ring gear.',
      evidence: 'animation: planets "roll inside the fixed ring gear"; planet note "...to the outer reaction ring"; geometry ring inner radius = sun + 2 x planet radius.',
    },
    {
      from: 'planet_carrier', type: 'supports', to: planet,
      description: 'The planet gear turns on one of the carrier pins.',
      evidence: 'planet note "Mounted on hardened cantilever carrier pin"; geometry places planets at the carrier pin positions.',
    },
    {
      from: planet, type: 'drives', to: 'planet_carrier',
      description: 'Orbiting planet gears turn the carrier (the output).',
      evidence: 'animation: planets "turn the planet carrier (output)"; carrier note "Gathers orbital motion from the three planet gears".',
    },
  ]),
];

export const PLANETARY_GEARBOX_RELATIONSHIPS = buildRelationshipIndex(PLANETARY_GEARBOX_RELATIONSHIP_EDGES);
