import * as THREE from 'three';
import type { MechanicalComponentId } from '../../types/assembly';

export interface PlanetaryGearboxController {
  group: THREE.Group;
  update: (delta: number, isRotating: boolean) => void;
  setExplodedFactor?: (factor: number) => void;
  dispose: () => void;
}

/**
 * Toothed outline (trapezoid teeth) as a closed path: rRoot = tooth root, rTip = tooth tip. For an
 * internal gear rTip < rRoot (teeth point inwards).
 */
function toothedOutline(path: THREE.Path, toothCount: number, rRoot: number, rTip: number, phase = 0): void {
  const p = (Math.PI * 2) / toothCount;
  const pt = (r: number, a: number) => [Math.cos(a) * r, Math.sin(a) * r] as const;
  for (let i = 0; i < toothCount; i++) {
    const c = phase + i * p;
    const pts = [pt(rRoot, c - 0.27 * p), pt(rTip, c - 0.13 * p), pt(rTip, c + 0.13 * p), pt(rRoot, c + 0.27 * p)];
    pts.forEach(([x, y], k) => (i === 0 && k === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
  }
  path.closePath();
}

/** Extrudes a flat gear shape into a body of the given height, centred on y = 0 (axis along y). */
function gearBody(shape: THREE.Shape, height: number): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 48 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -height / 2, 0);
  return geo;
}

/**
 * Creates a spur gear: one body with a true toothed outline and an axle bore, plus a raised hub.
 * Drawn as a clean technical outline in the x-ray look.
 */
function createSpurGear({
  radius,
  height,
  toothCount,
  toothDepth,
  material,
  componentId,
}: {
  radius: number;
  height: number;
  toothCount: number;
  toothDepth: number;
  toothWidth: number;
  material: THREE.Material;
  componentId: MechanicalComponentId;
}): THREE.Group {
  const gearGroup = new THREE.Group();
  gearGroup.name = componentId;
  gearGroup.userData = { componentId };

  // 1. Gear body: toothed rim with the axle bore cut through
  const shape = new THREE.Shape();
  toothedOutline(shape, toothCount, radius, radius + toothDepth * 0.9);
  const bore = new THREE.Path();
  bore.absarc(0, 0, radius * 0.28, 0, Math.PI * 2, true);
  shape.holes.push(bore);
  const body = new THREE.Mesh(gearBody(shape, height * 0.96), material);
  body.name = `${componentId}_hub`;
  body.userData = { componentId };
  gearGroup.add(body);

  // 2. Raised hub around the bore
  const hubGeo = new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, height * 1.15, 32, 1, true);
  const hub = new THREE.Mesh(hubGeo, material);
  hub.name = `${componentId}_boss`;
  hub.userData = { componentId };
  gearGroup.add(hub);

  return gearGroup;
}

/**
 * Creates the outer Ring Gear (Annulus): one body whose inner edge carries the internal teeth.
 */
function createRingGear({
  innerRadius,
  outerRadius,
  height,
  toothCount,
  material,
  componentId,
}: {
  innerRadius: number;
  outerRadius: number;
  height: number;
  toothCount: number;
  material: THREE.Material;
  componentId: MechanicalComponentId;
}): THREE.Group {
  const ringGroup = new THREE.Group();
  ringGroup.name = componentId;
  ringGroup.userData = { componentId };

  // Annulus: round outside, internal teeth pointing towards the centre
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);
  const teeth = new THREE.Path();
  toothedOutline(teeth, toothCount, innerRadius + 0.12, innerRadius - 0.03);
  shape.holes.push(teeth);
  const body = new THREE.Mesh(gearBody(shape, height), material);
  body.name = `${componentId}_outer_wall`;
  body.userData = { componentId };
  ringGroup.add(body);

  // Flange rings on top and bottom for a machined casing look
  const flangeGeo = new THREE.TorusGeometry(outerRadius, 0.06, 8, 64);
  for (const [name, y] of [['top', height / 2], ['bottom', -height / 2]] as const) {
    const flange = new THREE.Mesh(flangeGeo, material);
    flange.rotation.x = Math.PI / 2;
    flange.position.y = y;
    flange.name = `${componentId}_${name}_flange`;
    flange.userData = { componentId };
    ringGroup.add(flange);
  }

  // Radial mounting brackets on outer rim for realistic engineering housing
  const bracketGeo = new THREE.BoxGeometry(0.18, height * 0.7, 0.3);
  for (let b = 0; b < 4; b++) {
    const bAngle = (b / 4) * Math.PI * 2 + Math.PI / 4;
    const bracket = new THREE.Mesh(bracketGeo, material);
    bracket.position.set(Math.sin(bAngle) * (outerRadius + 0.1), 0, Math.cos(bAngle) * (outerRadius + 0.1));
    bracket.rotation.y = bAngle;
    bracket.name = `${componentId}_bracket_${b}`;
    bracket.userData = { componentId };
    ringGroup.add(bracket);
  }

  return ringGroup;
}

/**
 * Creates the Planet Carrier supporting the 3 planet gear axes.
 */
function createPlanetCarrier({
  orbitRadius,
  pinRadius,
  height,
  material,
  pinMaterial,
  componentId,
}: {
  orbitRadius: number;
  pinRadius: number;
  height: number;
  material: THREE.Material;
  pinMaterial: THREE.Material;
  componentId: MechanicalComponentId;
}): {
  carrierGroup: THREE.Group;
  pinPositions: THREE.Vector3[];
} {
  const carrierGroup = new THREE.Group();
  carrierGroup.name = componentId;
  carrierGroup.userData = { componentId };

  const pinPositions: THREE.Vector3[] = [];

  // Lower Carrier Spider Plate (Y-shaped / 3-arm triangular hub)
  const plateThickness = 0.1;
  const plateElevation = -(height / 2 + plateThickness / 2 + 0.05);

  const hubPlateGeo = new THREE.CylinderGeometry(0.55, 0.55, plateThickness, 24);
  const centerHubPlate = new THREE.Mesh(hubPlateGeo, material);
  centerHubPlate.position.y = plateElevation;
  centerHubPlate.name = `${componentId}_base_hub`;
  centerHubPlate.userData = { componentId };
  carrierGroup.add(centerHubPlate);

  // 3 Carrier Radial Arms extending to each planet axis
  const armLength = orbitRadius;
  const armGeo = new THREE.BoxGeometry(0.24, plateThickness, armLength);

  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const posX = Math.sin(angle) * orbitRadius;
    const posZ = Math.cos(angle) * orbitRadius;
    pinPositions.push(new THREE.Vector3(posX, 0, posZ));

    // Radial arm from center to planet pin
    const arm = new THREE.Mesh(armGeo, material);
    arm.position.set(Math.sin(angle) * (orbitRadius * 0.5), plateElevation, Math.cos(angle) * (orbitRadius * 0.5));
    arm.rotation.y = angle;
    arm.name = `${componentId}_arm_${i}`;
    arm.userData = { componentId };
    carrierGroup.add(arm);

    // Planet Mount Boss / Ear
    const bossGeo = new THREE.CylinderGeometry(pinRadius * 2.2, pinRadius * 2.2, plateThickness * 1.2, 16);
    const boss = new THREE.Mesh(bossGeo, material);
    boss.position.set(posX, plateElevation, posZ);
    boss.name = `${componentId}_boss_${i}`;
    boss.userData = { componentId };
    carrierGroup.add(boss);

    // Steel Shaft Pin passing through planet gear
    const pinGeo = new THREE.CylinderGeometry(pinRadius, pinRadius, height * 1.5, 20);
    const pin = new THREE.Mesh(pinGeo, pinMaterial);
    pin.position.set(posX, 0, posZ);
    pin.name = `${componentId}_pin_${i}`;
    pin.userData = { componentId };
    carrierGroup.add(pin);

    // Top Retainer Nut/Cap on pin
    const capGeo = new THREE.CylinderGeometry(pinRadius * 1.4, pinRadius * 1.4, 0.06, 12);
    const cap = new THREE.Mesh(capGeo, pinMaterial);
    cap.position.set(posX, height / 2 + 0.08, posZ);
    cap.name = `${componentId}_cap_${i}`;
    cap.userData = { componentId };
    carrierGroup.add(cap);
  }

  // Output Shaft extension below carrier
  const outputShaftGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.8, 24);
  const outputShaft = new THREE.Mesh(outputShaftGeo, pinMaterial);
  outputShaft.position.y = plateElevation - 0.4;
  outputShaft.name = `${componentId}_output_shaft`;
  outputShaft.userData = { componentId };
  carrierGroup.add(outputShaft);

  return { carrierGroup, pinPositions };
}

/**
 * Builds the complete procedural 3D Planetary Gearbox assembly.
 */
export function buildPlanetaryGearbox(): PlanetaryGearboxController {
  const masterGroup = new THREE.Group();
  masterGroup.name = 'planetary_gearbox_assembly';

  // -------------------------------------------------------------
  // Coordinated PBR Materials (Standard & Physical Materials)
  // -------------------------------------------------------------
  // Realistic finishes, as on a real gearbox (the exploded view adds colour-coding on top):
  // 1. Sun gear: case-hardened steel
  const sunMaterial = new THREE.MeshStandardMaterial({ color: 0xc3c7cc, metalness: 1, roughness: 0.28 });
  // 2. Planet gears: ground steel (slightly darker, so the sun gear still reads as a separate part)
  const planetMaterial = new THREE.MeshStandardMaterial({ color: 0xa7acb3, metalness: 1, roughness: 0.34 });
  // 3. Ring gear: cast-iron housing
  const ringMaterial = new THREE.MeshStandardMaterial({ color: 0x5b6169, metalness: 0.75, roughness: 0.52 });
  // 4. Planet carrier: machined aluminium
  const carrierMaterial = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 0.95, roughness: 0.22 });
  // 5. Shaft and pins: polished steel
  const shaftMaterial = new THREE.MeshStandardMaterial({ color: 0xe0e3e7, metalness: 1, roughness: 0.14 });

  // -------------------------------------------------------------
  // Mechanical Geometry Proportions
  // -------------------------------------------------------------
  const sunRadius = 0.72;
  const planetRadius = 0.54;
  const orbitRadius = sunRadius + planetRadius; // 1.26
  const ringInnerRadius = sunRadius + 2 * planetRadius; // 1.80
  const ringOuterRadius = 2.22;
  const gearHeight = 0.50;

  // A. Central Drive Shaft
  const shaftGeo = new THREE.CylinderGeometry(0.18, 0.18, 2.4, 32);
  const centralShaft = new THREE.Mesh(shaftGeo, shaftMaterial);
  centralShaft.position.y = 0.3;
  centralShaft.name = 'central_shaft';
  centralShaft.userData = { componentId: 'central_shaft' };
  masterGroup.add(centralShaft);

  // Shaft collar / retaining ring
  const collarGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.12, 24);
  const collar = new THREE.Mesh(collarGeo, shaftMaterial);
  collar.position.y = gearHeight / 2 + 0.15;
  collar.name = 'central_shaft_collar';
  collar.userData = { componentId: 'central_shaft' };
  masterGroup.add(collar);

  // B. Sun Gear (Center)
  const sunGear = createSpurGear({
    radius: sunRadius,
    height: gearHeight,
    toothCount: 16,
    toothDepth: 0.14,
    toothWidth: 0.10,
    material: sunMaterial,
    componentId: 'sun_gear',
  });
  masterGroup.add(sunGear);

  // C. Planet Carrier with 3 pins
  const { carrierGroup, pinPositions } = createPlanetCarrier({
    orbitRadius,
    pinRadius: 0.09,
    height: gearHeight,
    material: carrierMaterial,
    pinMaterial: shaftMaterial,
    componentId: 'planet_carrier',
  });
  masterGroup.add(carrierGroup);

  // D. Three Planet Gears mounted at the carrier pin positions
  const planetGearIds: MechanicalComponentId[] = ['planet_gear_1', 'planet_gear_2', 'planet_gear_3'];
  const planetMeshes: THREE.Group[] = [];

  for (let i = 0; i < 3; i++) {
    const planetGear = createSpurGear({
      radius: planetRadius,
      height: gearHeight * 0.94,
      toothCount: 12,
      toothDepth: 0.13,
      toothWidth: 0.09,
      material: planetMaterial,
      componentId: planetGearIds[i],
    });
    planetGear.position.copy(pinPositions[i]);
    masterGroup.add(planetGear);
    planetMeshes.push(planetGear);
  }

  // E. Ring Gear (Stationary Outer Annulus)
  const ringGear = createRingGear({
    innerRadius: ringInnerRadius,
    outerRadius: ringOuterRadius,
    height: gearHeight * 1.15,
    toothCount: 36,
    material: ringMaterial,
    componentId: 'ring_gear',
  });
  masterGroup.add(ringGear);

  // -------------------------------------------------------------
  // Exploded View Transform Management (Task 9.9)
  // Offsets are strictly defined in model space relative to the coaxial rotation axis (Y)
  // and radial orbit plane (XZ).
  // -------------------------------------------------------------
  let currentExplodedFactor = 0;
  const baseShaftY = 0.3;
  const baseCollarY = gearHeight / 2 + 0.15;
  const baseSunY = 0.0;
  const baseCarrierY = 0.0;
  const baseRingY = 0.0;
  const basePlanetY = 0.0;

  const setExplodedFactor = (factor: number) => {
    currentExplodedFactor = Math.max(0, Math.min(1, factor));

    // Coaxial separation along model Y-axis
    centralShaft.position.y = baseShaftY + currentExplodedFactor * 2.2;
    collar.position.y = baseCollarY + currentExplodedFactor * 2.2;
    sunGear.position.y = baseSunY + currentExplodedFactor * 1.1;
    carrierGroup.position.y = currentExplodedFactor === 0 ? baseCarrierY : baseCarrierY - currentExplodedFactor * 1.1;
    ringGear.position.y = currentExplodedFactor === 0 ? baseRingY : baseRingY - currentExplodedFactor * 2.2;

    // Radial + axial separation for planet gears based on current carrier angle
    const effectiveOrbitRadius = orbitRadius + currentExplodedFactor * 0.85;
    for (let i = 0; i < 3; i++) {
      const baseAngle = (i / 3) * Math.PI * 2;
      const currentOrbitAngle = baseAngle + carrierGroup.rotation.y;
      planetMeshes[i].position.x = Math.sin(currentOrbitAngle) * effectiveOrbitRadius;
      planetMeshes[i].position.z = Math.cos(currentOrbitAngle) * effectiveOrbitRadius;
      planetMeshes[i].position.y = basePlanetY + currentExplodedFactor * 0.15;
    }
  };

  // -------------------------------------------------------------
  // Kinematic Demonstration Update Function
  // Ratio: Sun (16T), Planet (12T), Ring (36T / 40T equivalent)
  // Composes cleanly with currentExplodedFactor without cumulative drift
  // -------------------------------------------------------------
  let sunAngle = 0;
  const sunSpeed = 0.8; // Radians per second

  const update = (delta: number, isRotating: boolean) => {
    if (!isRotating) return;

    // Advance sun gear angle
    const dSun = delta * sunSpeed;
    sunAngle += dSun;
    sunGear.rotation.y = sunAngle;
    centralShaft.rotation.y = sunAngle;

    // Carrier angular displacement based on fixed ring epicyclic ratio:
    // omega_carrier = omega_sun * (R_sun / (R_sun + R_ring))
    const carrierRatio = sunRadius / (sunRadius + ringInnerRadius); // ~0.2857
    const dCarrier = dSun * carrierRatio;

    // Rotate carrier plate
    carrierGroup.rotation.y += dCarrier;

    // Orbit planet gears around center and rotate about their own axes
    const effectiveOrbitRadius = orbitRadius + currentExplodedFactor * 0.85;
    for (let i = 0; i < 3; i++) {
      const baseAngle = (i / 3) * Math.PI * 2;
      const currentOrbitAngle = baseAngle + carrierGroup.rotation.y;

      // Update world position on orbit path composing with exploded factor
      planetMeshes[i].position.x = Math.sin(currentOrbitAngle) * effectiveOrbitRadius;
      planetMeshes[i].position.z = Math.cos(currentOrbitAngle) * effectiveOrbitRadius;
      planetMeshes[i].position.y = basePlanetY + currentExplodedFactor * 0.15;

      // Spin planet gear on its needle bearing axis:
      // Relative angular velocity = -(omega_sun - omega_carrier) * (R_sun / R_planet)
      const spinSpeed = -((sunSpeed - sunSpeed * carrierRatio) * (sunRadius / planetRadius));
      planetMeshes[i].rotation.y += delta * spinSpeed;
    }
  };

  // -------------------------------------------------------------
  // Full Resource Disposal Function
  // -------------------------------------------------------------
  const dispose = () => {
    masterGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else if (mesh.material) {
          mesh.material.dispose();
        }
      }
    });

    sunMaterial.dispose();
    planetMaterial.dispose();
    ringMaterial.dispose();
    carrierMaterial.dispose();
    shaftMaterial.dispose();
  };

  return {
    group: masterGroup,
    update,
    setExplodedFactor,
    dispose,
  };
}
