/**
 * Warren truss bridge component relationships (Task V3).
 *
 * Only links stated in this model's metadata (warrenTrussBridgeModel.ts) or visible in its
 * geometry (WarrenTrussBridge.ts) are listed. Civil relationships describe connections and the
 * load path; they are qualitative (no FEA), like the rest of the model's annotations.
 *
 * Deliberately NOT defined (not stated in the model): the joint between the end portal posts
 * and the top chords, and the upper lateral bracing mentioned in the top-chord notes (it is not
 * a separate component).
 */

import { buildRelationshipIndex, type RelationshipEdge } from '../../services/scene/relationshipTable';

export const WARREN_TRUSS_RELATIONSHIP_EDGES: readonly RelationshipEdge[] = [
  {
    from: 'diagonal_members', type: 'connected_to', to: 'top_chords',
    description: 'Diagonals connect the top chord to the bottom chord.',
    evidence: 'diagonal_members description "connecting top and bottom chords".',
  },
  {
    from: 'diagonal_members', type: 'connected_to', to: 'bottom_chords',
    description: 'Diagonals connect the top chord to the bottom chord.',
    evidence: 'diagonal_members description "connecting top and bottom chords".',
  },
  ...(['top_chords', 'bottom_chords', 'diagonal_members'] as const).map((member): RelationshipEdge => ({
    from: 'gusset_plates', type: 'fastened_to', to: member,
    description: 'Gusset plates are bolted to the members meeting at each truss joint.',
    evidence: 'gusset_plates description "fastened with high-strength structural bolts at chord-web node intersections"; geometry places plates at the top and bottom panel points.',
  })),
  {
    from: 'vertical_struts', type: 'fastened_to', to: 'gusset_plates',
    description: 'Vertical hangers are bolted to the gusset plates.',
    evidence: 'vertical_struts specification "Joint Fasteners: Double-Shear Gusset Bolting".',
  },
  {
    from: 'vertical_struts', type: 'transfers_force_to', to: 'top_chords',
    description: 'Hangers carry floor-beam (deck) reactions up into the top chord panel points.',
    evidence: 'vertical_struts note "Hangers transfer floor beam deck reactions directly into top chord panel points".',
  },
  {
    from: 'vertical_struts', type: 'supports', to: 'bridge_deck',
    description: 'Hangers hang the deck from the top chord joints.',
    evidence: 'vertical_struts description "hang the deck from the top chord joints".',
  },
  {
    from: 'bottom_chords', type: 'supports', to: 'bridge_deck',
    description: 'The transverse floor beams (part of the bottom-chord system) carry the deck stringers.',
    evidence: 'bottom_chords description "supporting transverse floor beams"; deck note "Deck Slab -> Stringers -> Floor Beams -> Truss Nodes"; geometry builds the floor beams in the bottom_chords group.',
  },
  {
    from: 'end_portals', type: 'transfers_force_to', to: 'support_piers',
    description: 'End portals carry lateral (wind) loads down to the bearing seats.',
    evidence: 'end_portals note "transferring top lateral wind reactions down to bearing seats"; spec "Channels Upper Lateral Shear to Abutments".',
  },
  {
    from: 'support_piers', type: 'supports', to: 'bottom_chords',
    description: 'Bearings on the abutments carry the truss at the ends of the bottom chords.',
    evidence: 'geometry places the elastomeric bearings under each truss shoe at the bottom-chord ends; support_piers description "support reactions".',
  },
];

export const WARREN_TRUSS_RELATIONSHIPS = buildRelationshipIndex(WARREN_TRUSS_RELATIONSHIP_EDGES);
