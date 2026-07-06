import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { BowlParams } from "../types";

const TRACK_FLOOR_OVERLAP = 0.8;
const TRACK_LEAD_IN_RATIO = 0.08;
const TWO_PI = Math.PI * 2;

const materials = {
  base: new THREE.MeshStandardMaterial({
    color: 0x485260,
    metalness: 0.38,
    roughness: 0.42,
  }),
  bowl: new THREE.MeshStandardMaterial({
    color: 0xb8c2cc,
    metalness: 0.72,
    roughness: 0.31,
    side: THREE.DoubleSide,
  }),
  track: new THREE.MeshStandardMaterial({
    color: 0xd8dde2,
    metalness: 0.62,
    roughness: 0.34,
    side: THREE.DoubleSide,
  }),
  guard: new THREE.MeshStandardMaterial({
    color: 0x7f8e9d,
    metalness: 0.45,
    roughness: 0.38,
    side: THREE.DoubleSide,
  }),
  outlet: new THREE.MeshStandardMaterial({
    color: 0x2f7d8c,
    metalness: 0.28,
    roughness: 0.42,
  }),
};

export function createVibratoryBowl(params: BowlParams) {
  const group = new THREE.Group();
  group.name = "参数化振动盘";

  group.add(createBase(params));

  if (params.shape === "round") {
    group.add(createRoundBowlShell(params));
    group.add(createSpiralRamp(params));
    group.add(createSpiralGuard(params));
    group.add(createOutlet(params));
  } else {
    group.add(createRectBowlShell(params));
  }

  group.add(createCenterHub(params));
  return group;
}

export function exportBowlToStl(params: BowlParams) {
  const group = createVibratoryBowl(params);
  group.updateMatrixWorld(true);
  const exporter = new STLExporter();
  return exporter.parse(group, { binary: false }) as string;
}

function createBase(params: BowlParams) {
  const geometry = new THREE.BoxGeometry(params.baseLength, params.baseHeight, params.baseWidth);
  const mesh = new THREE.Mesh(geometry, materials.base.clone());
  mesh.name = "底座";
  mesh.position.y = params.baseHeight / 2;
  return withEdges(mesh, 0x26303a);
}

function createRoundBowlShell(params: BowlParams) {
  const group = new THREE.Group();
  group.name = "圆形盘体";
  const topRadius = params.bowlDiameter / 2;
  const bottomRadius = getRoundProfileRadius(params, 0);
  const innerWallBottomRadius = getRoundProfileRadius(
    params,
    params.bottomThickness / params.bowlHeight,
  );
  const bowlY = params.baseHeight;
  const gap = getOutletGap(params);
  const cutBottomY = getOutletCutBottomY(params);
  const cutTopY = getOutletCutTopY(params, cutBottomY);
  const cutBottomRatio = (cutBottomY - bowlY) / params.bowlHeight;
  const cutTopRatio = (cutTopY - bowlY) / params.bowlHeight;
  const cutOuterRadius = getRoundProfileRadius(params, cutBottomRatio);
  const cutTopOuterRadius = getRoundProfileRadius(params, cutTopRatio);
  const cutInnerRadius = Math.max(1, cutOuterRadius - params.wallThickness);
  const cutTopInnerRadius = Math.max(1, cutTopOuterRadius - params.wallThickness);

  const bottomGeometry = new THREE.CylinderGeometry(bottomRadius, bottomRadius, params.bottomThickness, 160);
  const bottom = new THREE.Mesh(bottomGeometry, materials.bowl.clone());
  bottom.name = "盘底";
  bottom.position.y = bowlY + params.bottomThickness / 2;
  group.add(withEdges(bottom, 0x6b7682));

  const lowerWallGeometry = createFrustumSideGeometry(
    cutOuterRadius,
    bottomRadius,
    bowlY,
    cutBottomY,
    160,
  );
  const lowerWall = new THREE.Mesh(lowerWallGeometry, materials.bowl.clone());
  lowerWall.name = "盘体外壁下段";
  group.add(withEdges(lowerWall, 0x6b7682));

  const outletWindowWallGeometry = createFrustumSideGeometry(
    cutTopOuterRadius,
    cutOuterRadius,
    cutBottomY,
    cutTopY,
    160,
    gap.center,
    gap.size,
  );
  const outletWindowWall = new THREE.Mesh(outletWindowWallGeometry, materials.bowl.clone());
  outletWindowWall.name = "出料窗口外壁";
  group.add(withEdges(outletWindowWall, 0x6b7682));

  const upperWallGeometry = createFrustumSideGeometry(
    topRadius,
    cutTopOuterRadius,
    cutTopY,
    bowlY + params.bowlHeight,
    160,
  );
  const upperWall = new THREE.Mesh(upperWallGeometry, materials.bowl.clone());
  upperWall.name = "盘体外壁上段";
  group.add(withEdges(upperWall, 0x6b7682));

  const lowerInnerWallGeometry = createFrustumSideGeometry(
    cutInnerRadius,
    Math.max(1, innerWallBottomRadius - params.wallThickness),
    bowlY + params.bottomThickness,
    cutBottomY,
    160,
  );
  const lowerInnerWall = new THREE.Mesh(lowerInnerWallGeometry, materials.bowl.clone());
  lowerInnerWall.name = "盘体内壁下段";
  group.add(withEdges(lowerInnerWall, 0x87919c));

  const outletWindowInnerWallGeometry = createFrustumSideGeometry(
    cutTopInnerRadius,
    cutInnerRadius,
    cutBottomY,
    cutTopY,
    160,
    gap.center,
    gap.size,
  );
  const outletWindowInnerWall = new THREE.Mesh(outletWindowInnerWallGeometry, materials.bowl.clone());
  outletWindowInnerWall.name = "出料窗口内壁";
  group.add(withEdges(outletWindowInnerWall, 0x87919c));

  const upperInnerWallGeometry = createFrustumSideGeometry(
    Math.max(1, topRadius - params.wallThickness),
    cutTopInnerRadius,
    cutTopY,
    bowlY + params.bowlHeight,
    160,
  );
  const upperInnerWall = new THREE.Mesh(upperInnerWallGeometry, materials.bowl.clone());
  upperInnerWall.name = "盘体内壁上段";
  group.add(withEdges(upperInnerWall, 0x87919c));

  return group;
}

function createRectBowlShell(params: BowlParams) {
  const group = new THREE.Group();
  group.name = "矩形盘体";
  const yBase = params.baseHeight;
  const wall = params.wallThickness;
  const length = params.bowlLength;
  const width = params.bowlWidth;
  const height = params.bowlHeight;

  const bottom = new THREE.Mesh(
    new THREE.BoxGeometry(length, params.bottomThickness, width),
    materials.bowl.clone(),
  );
  bottom.name = "矩形盘底";
  bottom.position.y = yBase + params.bottomThickness / 2;
  group.add(withEdges(bottom, 0x6b7682));

  const walls = [
    { name: "前挡边", size: [length, height, wall], pos: [0, yBase + height / 2, width / 2 - wall / 2] },
    { name: "后挡边", size: [length, height, wall], pos: [0, yBase + height / 2, -width / 2 + wall / 2] },
    { name: "左挡边", size: [wall, height, width], pos: [-length / 2 + wall / 2, yBase + height / 2, 0] },
    { name: "右挡边", size: [wall, height, width], pos: [length / 2 - wall / 2, yBase + height / 2, 0] },
  ];

  walls.forEach((wallSpec) => {
    const wallMesh = new THREE.Mesh(
      new THREE.BoxGeometry(wallSpec.size[0], wallSpec.size[1], wallSpec.size[2]),
      materials.bowl.clone(),
    );
    wallMesh.name = wallSpec.name;
    wallMesh.position.set(wallSpec.pos[0], wallSpec.pos[1], wallSpec.pos[2]);
    group.add(withEdges(wallMesh, 0x6b7682));
  });

  return group;
}

function createCenterHub(params: BowlParams) {
  const radius = params.shape === "round"
    ? Math.max(24, params.bowlDiameter * 0.08)
    : Math.max(24, Math.min(params.bowlLength, params.bowlWidth) * 0.08);
  const height = Math.max(18, params.bowlHeight * 0.18);
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.82, height, 96),
    materials.base.clone(),
  );
  hub.name = "中心安装台";
  hub.position.y = params.baseHeight + params.bottomThickness + height / 2;
  return withEdges(hub, 0x26303a);
}

function createSpiralRamp(params: BowlParams) {
  const geometry = createSpiralStripGeometry(params, {
    innerOffset: params.wallThickness + params.trackWidth,
    outerOffset: params.wallThickness,
    heightOffset: 0,
  });
  const mesh = new THREE.Mesh(geometry, materials.track.clone());
  mesh.name = "螺旋轨道";
  return withEdges(mesh, 0x87919c);
}

function createSpiralGuard(params: BowlParams) {
  const guardThickness = Math.max(3, params.wallThickness);
  const geometry = createSpiralWallGeometry(params, guardThickness);
  const mesh = new THREE.Mesh(geometry, materials.guard.clone());
  mesh.name = "螺旋挡边";
  return withEdges(mesh, 0x55616d);
}

function createOutlet(params: BowlParams) {
  const layout = getOutletLayout(params);
  const totalRise = getEffectiveTotalRise(params);
  const y = params.baseHeight + params.bottomThickness + params.trackThickness / 2 + totalRise;
  const totalOutletLength = layout.wallExitDistance + params.outletLength;
  const position = layout.radial
    .clone()
    .multiplyScalar(layout.trackCenterRadius)
    .add(layout.tangent.clone().multiplyScalar(totalOutletLength / 2));

  const outlet = new THREE.Mesh(
    new THREE.BoxGeometry(totalOutletLength, params.trackThickness, params.outletWidth),
    materials.outlet.clone(),
  );
  outlet.name = "出料直轨";
  outlet.position.set(position.x, y, position.z);
  outlet.quaternion.copy(getOutletQuaternion(layout.tangent, layout.radial));

  const group = new THREE.Group();
  group.name = "出料口";
  group.add(withEdges(outlet, 0x1f5963));
  return group;
}

function createSpiralStripGeometry(
  params: BowlParams,
  offsets: { innerOffset: number; outerOffset: number; heightOffset: number },
) {
  const steps = Math.max(96, Math.round(params.trackTurns * 96));
  const sign = params.feedDirection === "clockwise" ? -1 : 1;
  const totalAngle = params.trackTurns * Math.PI * 2;
  const startAngle = Math.PI * 0.2;
  const baseY = params.baseHeight + params.bottomThickness + offsets.heightOffset;
  const totalRise = getEffectiveTotalRise(params);
  const thickness = Math.max(2, params.trackThickness);
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = startAngle + sign * totalAngle * t;
    const profileRatio = getProfileHeightRatio(params, totalRise * t);
    const localRadius = getRoundProfileRadius(params, profileRatio);
    const innerRadius = Math.max(14, localRadius - offsets.innerOffset);
    const outerRadius = Math.max(innerRadius + 4, localRadius - offsets.outerOffset);
    const yTop = baseY + totalRise * t + getTrackThicknessAt(t, thickness);
    const yBottom = baseY + totalRise * t - TRACK_FLOOR_OVERLAP;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    vertices.push(innerRadius * cos, yTop, innerRadius * sin);
    vertices.push(outerRadius * cos, yTop, outerRadius * sin);
    vertices.push(innerRadius * cos, yBottom, innerRadius * sin);
    vertices.push(outerRadius * cos, yBottom, outerRadius * sin);
  }

  for (let i = 0; i < steps; i += 1) {
    const a = i * 4;
    const b = (i + 1) * 4;

    indices.push(a, b, a + 1, a + 1, b, b + 1);
    indices.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
    indices.push(a, a + 2, b, a + 2, b + 2, b);
    indices.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
  }

  indices.push(0, 1, 2, 1, 3, 2);
  const end = steps * 4;
  indices.push(end, end + 2, end + 1, end + 1, end + 2, end + 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createSpiralWallGeometry(params: BowlParams, guardThickness: number) {
  const steps = Math.max(96, Math.round(params.trackTurns * 96));
  const sign = params.feedDirection === "clockwise" ? -1 : 1;
  const totalAngle = params.trackTurns * Math.PI * 2;
  const startAngle = Math.PI * 0.2;
  const baseY = params.baseHeight + params.bottomThickness;
  const totalRise = getEffectiveTotalRise(params);
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = startAngle + sign * totalAngle * t;
    const profileRatio = getProfileHeightRatio(params, totalRise * t);
    const localRadius = getRoundProfileRadius(params, profileRatio) - params.wallThickness - 1;
    const outerRadius = Math.max(18, localRadius);
    const innerRadius = Math.max(14, outerRadius - guardThickness);
    const yBottom = baseY + totalRise * t + getTrackThicknessAt(t, params.trackThickness);
    const yTop = yBottom + params.guardHeight;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    vertices.push(innerRadius * cos, yBottom, innerRadius * sin);
    vertices.push(outerRadius * cos, yBottom, outerRadius * sin);
    vertices.push(innerRadius * cos, yTop, innerRadius * sin);
    vertices.push(outerRadius * cos, yTop, outerRadius * sin);
  }

  for (let i = 0; i < steps; i += 1) {
    const a = i * 4;
    const b = (i + 1) * 4;

    indices.push(a, b, a + 2, a + 2, b, b + 2);
    indices.push(a + 1, a + 3, b + 1, a + 3, b + 3, b + 1);
    indices.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function getEffectiveTotalRise(params: BowlParams) {
  const requested = params.trackRisePerTurn * params.trackTurns;
  const maxRise = Math.max(
    8,
    params.bowlHeight - params.bottomThickness - params.trackThickness - params.guardHeight - 4,
  );
  return Math.min(requested, maxRise);
}

function getTrackThicknessAt(t: number, thickness: number) {
  return thickness * smoothstep(THREE.MathUtils.clamp(t / TRACK_LEAD_IN_RATIO, 0, 1));
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function getOutletGap(params: BowlParams) {
  const layout = getOutletLayout(params);
  const topRadius = Math.max(1, layout.outerRadius);
  const openingWidth = params.outletWidth + params.wallThickness * 3;
  const size = THREE.MathUtils.clamp(openingWidth / topRadius, 0.18, 0.36);

  return {
    center: layout.wallExitAngle,
    size,
  };
}

function getOutletLayout(params: BowlParams) {
  const sign = params.feedDirection === "clockwise" ? -1 : 1;
  const endAngle = Math.PI * 0.2 + sign * params.trackTurns * TWO_PI;
  const totalRise = getEffectiveTotalRise(params);
  const profileRatio = getProfileHeightRatio(params, totalRise);
  const outerRadius = getRoundProfileRadius(params, profileRatio);
  const trackCenterRadius = Math.max(1, outerRadius - params.wallThickness - params.trackWidth / 2);
  const radial = new THREE.Vector3(Math.cos(endAngle), 0, Math.sin(endAngle)).normalize();
  const tangent = new THREE.Vector3(sign * -Math.sin(endAngle), 0, sign * Math.cos(endAngle)).normalize();
  const wallExitDistance = Math.sqrt(Math.max(0, outerRadius * outerRadius - trackCenterRadius * trackCenterRadius));
  const wallExitPoint = radial
    .clone()
    .multiplyScalar(trackCenterRadius)
    .add(tangent.clone().multiplyScalar(wallExitDistance));

  return {
    radial,
    tangent,
    outerRadius,
    trackCenterRadius,
    wallExitDistance,
    wallExitAngle: Math.atan2(wallExitPoint.z, wallExitPoint.x),
  };
}

function getOutletCutBottomY(params: BowlParams) {
  const totalRise = getEffectiveTotalRise(params);
  const railBottomY = params.baseHeight + params.bottomThickness + totalRise;
  const minimumY = params.baseHeight + params.bottomThickness + params.trackThickness;
  const maximumY = params.baseHeight + params.bowlHeight - Math.max(10, params.outletHeight * 0.35);
  return THREE.MathUtils.clamp(railBottomY - 1, minimumY, maximumY);
}

function getOutletCutTopY(params: BowlParams, cutBottomY: number) {
  const railWindowHeight = Math.max(params.outletHeight, params.trackThickness + params.guardHeight * 0.35);
  const topLimit = params.baseHeight + params.bowlHeight - params.wallThickness;
  return THREE.MathUtils.clamp(cutBottomY + railWindowHeight, cutBottomY + params.trackThickness + 4, topLimit);
}

function getOutletQuaternion(tangent: THREE.Vector3, radial: THREE.Vector3) {
  const matrix = new THREE.Matrix4().makeBasis(
    tangent.clone().normalize(),
    new THREE.Vector3(0, 1, 0),
    radial.clone().normalize(),
  );
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function createFrustumSideGeometry(
  topRadius: number,
  bottomRadius: number,
  yBottom: number,
  yTop: number,
  segments: number,
  gapCenter?: number,
  gapSize = 0,
) {
  const hasGap = gapCenter !== undefined && gapSize > 0;
  const start = hasGap ? gapCenter + gapSize / 2 : 0;
  const end = hasGap ? gapCenter + TWO_PI - gapSize / 2 : TWO_PI;
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const angle = start + (end - start) * t;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    vertices.push(bottomRadius * cos, yBottom, bottomRadius * sin);
    vertices.push(topRadius * cos, yTop, topRadius * sin);
  }

  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    const b = (i + 1) * 2;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function getProfileHeightRatio(params: BowlParams, localRise: number) {
  return (params.bottomThickness + localRise) / Math.max(1, params.bowlHeight);
}

function getRoundProfileRadius(params: BowlParams, heightRatio: number) {
  const topRadius = params.bowlDiameter / 2;
  if (params.bowlProfile === "cylindrical") {
    return topRadius;
  }

  const bottomRadius = topRadius * THREE.MathUtils.clamp(params.conicalBottomRatio / 100, 0.35, 1);
  return bottomRadius + (topRadius - bottomRadius) * THREE.MathUtils.clamp(heightRatio, 0, 1);
}

function withEdges(mesh: THREE.Mesh, color: number) {
  const group = new THREE.Group();
  group.add(mesh);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 25),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.32 }),
  );
  edges.position.copy(mesh.position);
  edges.rotation.copy(mesh.rotation);
  edges.quaternion.copy(mesh.quaternion);
  edges.scale.copy(mesh.scale);
  group.add(edges);
  return group;
}
