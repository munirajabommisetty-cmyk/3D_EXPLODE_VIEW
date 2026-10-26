/**
 * Procedural 3D Warren Truss Bridge Geometry Builder
 * Phase 9 - Task 9.8: Civil Engineering Warren Truss Bridge Model
 *
 * Constructs a fully procedural, realistic 3-dimensional Warren through-truss bridge
 * using Three.js standard geometries and PBR materials.
 *
 * Bridge Specs:
 * - Span: 24.0 m (-12m to +12m along X)
 * - Width: 5.0 m (-2.5m to +2.5m along Z)
 * - Truss Height: 4.5 m (Y = 0.5m to Y = 5.0m)
 * - 6 Panels / Bays of 4.0m each
 *
 * Component IDs (8 addressable parts):
 * - top_chords
 * - bottom_chords
 * - diagonal_members
 * - vertical_struts
 * - gusset_plates
 * - end_portals
 * - bridge_deck
 * - support_piers
 */

import * as THREE from 'three';

export interface WarrenTrussBridgeController {
  group: THREE.Group;
  update: (delta: number) => void;
  setExplodedFactor?: (factor: number) => void;
  dispose: () => void;
}

export const WARREN_TRUSS_COMPONENT_IDS = [
  'top_chords',
  'bottom_chords',
  'diagonal_members',
  'vertical_struts',
  'gusset_plates',
  'end_portals',
  'bridge_deck',
  'support_piers',
] as const;

export type WarrenTrussComponentId = (typeof WARREN_TRUSS_COMPONENT_IDS)[number];

export function buildWarrenTrussBridge(): WarrenTrussBridgeController {
  const rootGroup = new THREE.Group();
  rootGroup.name = 'warren_truss_bridge_root';
  rootGroup.userData = { modelId: 'warren_truss_bridge' };

  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: THREE.Material[] = [];

  const trackGeometry = <T extends THREE.BufferGeometry>(geo: T): T => {
    geometriesToDispose.push(geo);
    return geo;
  };

  const trackMaterial = <T extends THREE.Material>(mat: T): T => {
    materialsToDispose.push(mat);
    return mat;
  };

  // PBR Engineering Materials
  const topChordMat = trackMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8, // High-visibility light sky blue (compression indicator)
      metalness: 0.75,
      roughness: 0.3,
      name: 'top_chord_material',
    })
  );

  const bottomChordMat = trackMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x60a5fa, // Structural blue (tension indicator)
      metalness: 0.75,
      roughness: 0.3,
      name: 'bottom_chord_material',
    })
  );

  const diagonalMat = trackMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x818cf8, // Indigo-blue for diagonal web members
      metalness: 0.7,
      roughness: 0.35,
      name: 'diagonal_material',
    })
  );

  const verticalMat = trackMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xa5b4fc, // Soft periwinkle for vertical hangers
      metalness: 0.65,
      roughness: 0.35,
      name: 'vertical_material',
    })
  );

  const gussetMat = trackMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xf59e0b, // Amber/gold for gusset plates & connection joints
      metalness: 0.85,
      roughness: 0.25,
      name: 'gusset_plate_material',
    })
  );

  const portalMat = trackMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x0284c7, // Deep cyan-blue for end portal sway frames
      metalness: 0.8,
      roughness: 0.3,
      name: 'portal_material',
    })
  );

  const deckMat = trackMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x1e293b, // Dark asphalt roadway
      metalness: 0.1,
      roughness: 0.85,
      name: 'deck_material',
    })
  );

  const curbMat = trackMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // Concrete curb & barrier
      metalness: 0.2,
      roughness: 0.7,
      name: 'curb_material',
    })
  );

  const pierMat = trackMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x64748b, // Reinforced concrete piers
      metalness: 0.15,
      roughness: 0.8,
      name: 'pier_material',
    })
  );

  const bearingMat = trackMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x0f172a, // Neoprene / steel elastomeric bearings
      metalness: 0.9,
      roughness: 0.4,
      name: 'bearing_material',
    })
  );

  /**
   * Helper to create a 3D structural member connecting two points in space.
   */
  function createMember(
    start: THREE.Vector3,
    end: THREE.Vector3,
    size: number,
    material: THREE.Material,
    componentId: WarrenTrussComponentId,
    shape: 'box' | 'cylinder' = 'box'
  ): THREE.Mesh {
    const delta = end.clone().sub(start);
    const length = delta.length();
    const midpoint = start.clone().add(end).multiplyScalar(0.5);

    let geometry: THREE.BufferGeometry;
    if (shape === 'cylinder') {
      geometry = trackGeometry(new THREE.CylinderGeometry(size * 0.5, size * 0.5, length, 12));
    } else {
      geometry = trackGeometry(new THREE.BoxGeometry(size, length, size));
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(midpoint);

    // Three.js primitives default to pointing along the positive Y-axis
    const defaultAxis = new THREE.Vector3(0, 1, 0);
    const targetDir = delta.clone().normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultAxis, targetDir);
    mesh.quaternion.copy(quaternion);

    mesh.name = `${componentId}_member`;
    mesh.userData = { componentId };
    return mesh;
  }

  // --- Geometry Constants ---
  const span = 24.0;
  const numBays = 6;
  const bayWidth = span / numBays; // 4.0 m
  const startX = -span / 2; // -12.0 m
  const trussWidth = 5.0; // 5.0 m width between parallel trusses
  const halfTrussWidth = trussWidth / 2; // 2.5 m
  const bottomY = 0.5; // Bottom chord elevation
  const topY = 4.5; // Top chord elevation (4.0m truss height)

  const zCoordinates = [-halfTrussWidth, halfTrussWidth]; // Two parallel trusses

  // 1. TOP CHORDS GROUP
  const topChordsGroup = new THREE.Group();
  topChordsGroup.name = 'top_chords';
  topChordsGroup.userData = { componentId: 'top_chords' };

  for (const z of zCoordinates) {
    // Upper chords span from Bay 1 to Bay 5 (X = -8 to +8)
    for (let i = 1; i < numBays - 1; i++) {
      const p1 = new THREE.Vector3(startX + i * bayWidth, topY, z);
      const p2 = new THREE.Vector3(startX + (i + 1) * bayWidth, topY, z);
      const beam = createMember(p1, p2, 0.32, topChordMat, 'top_chords');
      topChordsGroup.add(beam);
    }
  }

  // Overhead transverse struts & cross-bracing between top chords
  for (let i = 1; i <= numBays - 1; i++) {
    const p1 = new THREE.Vector3(startX + i * bayWidth, topY, -halfTrussWidth);
    const p2 = new THREE.Vector3(startX + i * bayWidth, topY, halfTrussWidth);
    const crossStrut = createMember(p1, p2, 0.22, topChordMat, 'top_chords');
    topChordsGroup.add(crossStrut);

    // Lateral sway cross-bracing between top panels
    if (i < numBays - 1) {
      const p3 = new THREE.Vector3(startX + (i + 1) * bayWidth, topY, halfTrussWidth);
      const p4 = new THREE.Vector3(startX + (i + 1) * bayWidth, topY, -halfTrussWidth);
      const brace1 = createMember(p1, p3, 0.14, topChordMat, 'top_chords');
      const brace2 = createMember(p2, p4, 0.14, topChordMat, 'top_chords');
      topChordsGroup.add(brace1);
      topChordsGroup.add(brace2);
    }
  }
  rootGroup.add(topChordsGroup);

  // 2. BOTTOM CHORDS GROUP
  const bottomChordsGroup = new THREE.Group();
  bottomChordsGroup.name = 'bottom_chords';
  bottomChordsGroup.userData = { componentId: 'bottom_chords' };

  for (const z of zCoordinates) {
    // Lower chords span full length from X = -12 to +12
    for (let i = 0; i < numBays; i++) {
      const p1 = new THREE.Vector3(startX + i * bayWidth, bottomY, z);
      const p2 = new THREE.Vector3(startX + (i + 1) * bayWidth, bottomY, z);
      const beam = createMember(p1, p2, 0.36, bottomChordMat, 'bottom_chords');
      bottomChordsGroup.add(beam);
    }
  }

  // Lower transverse floor beams under the deck
  for (let i = 0; i <= numBays; i++) {
    const p1 = new THREE.Vector3(startX + i * bayWidth, bottomY, -halfTrussWidth);
    const p2 = new THREE.Vector3(startX + i * bayWidth, bottomY, halfTrussWidth);
    const floorBeam = createMember(p1, p2, 0.28, bottomChordMat, 'bottom_chords');
    bottomChordsGroup.add(floorBeam);
  }
  rootGroup.add(bottomChordsGroup);

  // 3. DIAGONAL MEMBERS GROUP (Warren Truss Alternating Diagonals)
  const diagonalsGroup = new THREE.Group();
  diagonalsGroup.name = 'diagonal_members';
  diagonalsGroup.userData = { componentId: 'diagonal_members' };

  for (const z of zCoordinates) {
    // Warren pattern for 6 bays:
    // Bay 0: (startX, bottomY) to (startX + bayWidth, topY) -> End post (handled in end_portals)
    // Bay 1: (startX + bayWidth, topY) down to (startX + 2*bayWidth, bottomY)
    // Bay 2: (startX + 2*bayWidth, bottomY) up to (startX + 3*bayWidth, topY)
    // Bay 3: (startX + 3*bayWidth, topY) down to (startX + 4*bayWidth, bottomY)
    // Bay 4: (startX + 4*bayWidth, bottomY) up to (startX + 5*bayWidth, topY)
    // Bay 5: (startX + 5*bayWidth, topY) down to (startX + 6*bayWidth, bottomY) -> End post
    const diagPoints: Array<[number, number, number, number]> = [
      [1, topY, 2, bottomY],
      [2, bottomY, 3, topY],
      [3, topY, 4, bottomY],
      [4, bottomY, 5, topY],
    ];

    for (const [b1, y1, b2, y2] of diagPoints) {
      const p1 = new THREE.Vector3(startX + b1 * bayWidth, y1, z);
      const p2 = new THREE.Vector3(startX + b2 * bayWidth, y2, z);
      const diag = createMember(p1, p2, 0.25, diagonalMat, 'diagonal_members');
      diagonalsGroup.add(diag);
    }
  }
  rootGroup.add(diagonalsGroup);

  // 4. VERTICAL STRUTS GROUP (Vertical Hangers / Posts)
  const verticalsGroup = new THREE.Group();
  verticalsGroup.name = 'vertical_struts';
  verticalsGroup.userData = { componentId: 'vertical_struts' };

  for (const z of zCoordinates) {
    // Vertical hangers at panel points 1, 2, 3, 4, 5
    for (let i = 1; i <= 5; i++) {
      const p1 = new THREE.Vector3(startX + i * bayWidth, bottomY, z);
      const p2 = new THREE.Vector3(startX + i * bayWidth, topY, z);
      const vert = createMember(p1, p2, 0.2, verticalMat, 'vertical_struts');
      verticalsGroup.add(vert);
    }
  }
  rootGroup.add(verticalsGroup);

  // 5. GUSSET PLATES & JOINTS GROUP
  const gussetsGroup = new THREE.Group();
  gussetsGroup.name = 'gusset_plates';
  gussetsGroup.userData = { componentId: 'gusset_plates' };

  const jointGeo = trackGeometry(new THREE.BoxGeometry(0.65, 0.65, 0.12));

  for (const z of zCoordinates) {
    // Bottom panel joints (i = 0 to 6)
    for (let i = 0; i <= numBays; i++) {
      const jointMesh = new THREE.Mesh(jointGeo, gussetMat);
      jointMesh.position.set(startX + i * bayWidth, bottomY, z);
      jointMesh.name = `gusset_plate_bottom_${i}`;
      jointMesh.userData = { componentId: 'gusset_plates' };
      gussetsGroup.add(jointMesh);
    }

    // Top panel joints (i = 1 to 5)
    for (let i = 1; i < numBays; i++) {
      const jointMesh = new THREE.Mesh(jointGeo, gussetMat);
      jointMesh.position.set(startX + i * bayWidth, topY, z);
      jointMesh.name = `gusset_plate_top_${i}`;
      jointMesh.userData = { componentId: 'gusset_plates' };
      gussetsGroup.add(jointMesh);
    }
  }
  rootGroup.add(gussetsGroup);

  // 6. END PORTALS & FRAMES GROUP
  const portalsGroup = new THREE.Group();
  portalsGroup.name = 'end_portals';
  portalsGroup.userData = { componentId: 'end_portals' };

  for (const z of zCoordinates) {
    // Left inclined end post: (0, bottomY) to (1, topY)
    const pLeft1 = new THREE.Vector3(startX, bottomY, z);
    const pLeft2 = new THREE.Vector3(startX + bayWidth, topY, z);
    const postLeft = createMember(pLeft1, pLeft2, 0.38, portalMat, 'end_portals');
    portalsGroup.add(postLeft);

    // Right inclined end post: (5, topY) to (6, bottomY)
    const pRight1 = new THREE.Vector3(startX + (numBays - 1) * bayWidth, topY, z);
    const pRight2 = new THREE.Vector3(startX + numBays * bayWidth, bottomY, z);
    const postRight = createMember(pRight1, pRight2, 0.38, portalMat, 'end_portals');
    portalsGroup.add(postRight);
  }

  // Overhead portal cross-frame sway bracing at left and right portals
  const portalPoints = [
    startX + bayWidth, // Left portal top
    startX + (numBays - 1) * bayWidth, // Right portal top
  ];

  for (const x of portalPoints) {
    const p1 = new THREE.Vector3(x, topY, -halfTrussWidth);
    const p2 = new THREE.Vector3(x, topY, halfTrussWidth);
    const topBar = createMember(p1, p2, 0.3, portalMat, 'end_portals');
    portalsGroup.add(topBar);

    // Sway strut 0.8m below top chord
    const p3 = new THREE.Vector3(x, topY - 0.8, -halfTrussWidth);
    const p4 = new THREE.Vector3(x, topY - 0.8, halfTrussWidth);
    const lowerBar = createMember(p3, p4, 0.2, portalMat, 'end_portals');
    portalsGroup.add(lowerBar);

    // Knee bracing
    const knee1 = createMember(p1, p4, 0.14, portalMat, 'end_portals');
    const knee2 = createMember(p2, p3, 0.14, portalMat, 'end_portals');
    portalsGroup.add(knee1);
    portalsGroup.add(knee2);
  }
  rootGroup.add(portalsGroup);

  // 7. BRIDGE DECK GROUP
  const deckGroup = new THREE.Group();
  deckGroup.name = 'bridge_deck';
  deckGroup.userData = { componentId: 'bridge_deck' };

  // Roadway slab
  const deckWidth = trussWidth - 0.3; // 4.7 m usable roadway
  const deckThickness = 0.28;
  const deckGeo = trackGeometry(new THREE.BoxGeometry(span, deckThickness, deckWidth));
  const deckMesh = new THREE.Mesh(deckGeo, deckMat);
  deckMesh.position.set(0, bottomY + deckThickness * 0.5 + 0.05, 0);
  deckMesh.name = 'bridge_deck_slab';
  deckMesh.userData = { componentId: 'bridge_deck' };
  deckGroup.add(deckMesh);

  // Curbs and safety parapets on both sides
  const curbHeight = 0.35;
  const curbWidth = 0.3;
  const curbGeo = trackGeometry(new THREE.BoxGeometry(span, curbHeight, curbWidth));

  const curbLeft = new THREE.Mesh(curbGeo, curbMat);
  curbLeft.position.set(0, bottomY + deckThickness + curbHeight * 0.5, -deckWidth * 0.5 + curbWidth * 0.5);
  curbLeft.name = 'bridge_deck_curb_left';
  curbLeft.userData = { componentId: 'bridge_deck' };
  deckGroup.add(curbLeft);

  const curbRight = new THREE.Mesh(curbGeo, curbMat);
  curbRight.position.set(0, bottomY + deckThickness + curbHeight * 0.5, deckWidth * 0.5 - curbWidth * 0.5);
  curbRight.name = 'bridge_deck_curb_right';
  curbRight.userData = { componentId: 'bridge_deck' };
  deckGroup.add(curbRight);

  // Longitudinal steel stringers under the deck slab
  const stringerCount = 4;
  const stringerOffset = (trussWidth - 1.2) / (stringerCount - 1);
  const stringerGeo = trackGeometry(new THREE.BoxGeometry(span, 0.22, 0.16));
  for (let s = 0; s < stringerCount; s++) {
    const stringerZ = -((trussWidth - 1.2) * 0.5) + s * stringerOffset;
    const stringerMesh = new THREE.Mesh(stringerGeo, bottomChordMat);
    stringerMesh.position.set(0, bottomY - 0.05, stringerZ);
    stringerMesh.name = `bridge_deck_stringer_${s}`;
    stringerMesh.userData = { componentId: 'bridge_deck' };
    deckGroup.add(stringerMesh);
  }
  rootGroup.add(deckGroup);

  // 8. SUPPORT PIERS & ABUTMENTS GROUP
  const piersGroup = new THREE.Group();
  piersGroup.name = 'support_piers';
  piersGroup.userData = { componentId: 'support_piers' };

  const pierHeight = 2.8;
  const pierWidth = trussWidth + 1.6; // 6.6 m wide pier cap
  const pierThickness = 1.4; // 1.4 m thick longitudinal
  const pierGeo = trackGeometry(new THREE.BoxGeometry(pierThickness, pierHeight, pierWidth));

  const bearingGeo = trackGeometry(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 16));

  const pierLocations = [startX, startX + span]; // X = -12.0 and X = +12.0

  for (let pIdx = 0; pIdx < pierLocations.length; pIdx++) {
    const px = pierLocations[pIdx];

    // Reinforced concrete pier column
    const pierMesh = new THREE.Mesh(pierGeo, pierMat);
    pierMesh.position.set(px, bottomY - pierHeight * 0.5 - 0.15, 0);
    pierMesh.name = `support_pier_abutment_${pIdx}`;
    pierMesh.userData = { componentId: 'support_piers' };
    piersGroup.add(pierMesh);

    // Elastomeric bearings under each truss shoe
    for (const z of zCoordinates) {
      const bearingMesh = new THREE.Mesh(bearingGeo, bearingMat);
      bearingMesh.position.set(px, bottomY - 0.1, z);
      bearingMesh.name = `support_bearing_${pIdx}_z${z < 0 ? 'neg' : 'pos'}`;
      bearingMesh.userData = { componentId: 'support_piers' };
      piersGroup.add(bearingMesh);
    }
  }
  rootGroup.add(piersGroup);

  // -------------------------------------------------------------
  // Exploded View Transform Management (Task 9.9)
  // -------------------------------------------------------------
  // Capture immutable base transforms for mesh children within lateral/longitudinal groups
  const captureMeshBaseTransforms = (group: THREE.Group) => {
    group.children.forEach((child) => {
      if ((child as THREE.Mesh).isMesh || (child as THREE.Group).isGroup) {
        child.userData.baseX = child.position.x;
        child.userData.baseY = child.position.y;
        child.userData.baseZ = child.position.z;
      }
    });
  };

  captureMeshBaseTransforms(portalsGroup);
  captureMeshBaseTransforms(diagonalsGroup);
  captureMeshBaseTransforms(verticalsGroup);
  captureMeshBaseTransforms(gussetsGroup);

  const setExplodedFactor = (factor: number) => {
    const f = Math.max(0, Math.min(1, factor));

    // 1. Vertical group offsets in model space
    topChordsGroup.position.y = f === 0 ? 0 : f * 3.0; // Lifts upper chords up to reveal joints
    deckGroup.position.y = f === 0 ? 0 : f * 1.2; // Lifts roadway slab to reveal stringers
    bottomChordsGroup.position.y = f === 0 ? 0 : -f * 1.2; // Drops bottom chords & floor beams down
    piersGroup.position.y = f === 0 ? 0 : -f * 2.8; // Drops substructure piers down

    // 2. Longitudinal portal offsets (model X-axis)
    portalsGroup.children.forEach((child) => {
      const baseX = child.userData.baseX ?? child.position.x;
      const signX = baseX >= 0 ? 1 : -1;
      child.position.x = baseX + signX * f * 2.0;
    });

    // 3. Lateral diagonal offsets (model Z-axis)
    diagonalsGroup.children.forEach((child) => {
      const baseZ = child.userData.baseZ ?? child.position.z;
      const signZ = baseZ >= 0 ? 1 : -1;
      child.position.z = baseZ + signZ * f * 0.8;
    });

    // 4. Lateral vertical strut offsets (model Z-axis)
    verticalsGroup.children.forEach((child) => {
      const baseZ = child.userData.baseZ ?? child.position.z;
      const signZ = baseZ >= 0 ? 1 : -1;
      child.position.z = baseZ + signZ * f * 0.4;
    });

    // 5. Lateral gusset plate offsets (model Z-axis) - pulled further out
    gussetsGroup.children.forEach((child) => {
      const baseZ = child.userData.baseZ ?? child.position.z;
      const signZ = baseZ >= 0 ? 1 : -1;
      child.position.z = baseZ + signZ * f * 1.5;
    });
  };

  return {
    group: rootGroup,
    update: (_delta: number) => {
      // Civil structural bridges are static assemblies without motorized rotation
    },
    setExplodedFactor,
    dispose: () => {
      // Restore assembled transforms before cleanup
      setExplodedFactor(0);

      // Remove all children
      while (rootGroup.children.length > 0) {
        rootGroup.remove(rootGroup.children[0]);
      }

      // Dispose tracked geometries
      for (const geo of geometriesToDispose) {
        geo.dispose();
      }
      geometriesToDispose.length = 0;

      // Dispose tracked materials
      for (const mat of materialsToDispose) {
        mat.dispose();
      }
      materialsToDispose.length = 0;
    },
  };
}
