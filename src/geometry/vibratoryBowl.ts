import * as THREE from "three";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { BowlParams, ExportFormat, PartTopFace } from "../types";
import { getEffectiveTrackTotalRise } from "./trackClimb";

const TRACK_FLOOR_OVERLAP = 0.8;
const TRACK_LEAD_IN_RATIO = 0.08;
const TWO_PI = Math.PI * 2;
const brushedSteelTexture = createBrushedSteelTexture();
const darkAnodizedTexture = createBrushedSteelTexture(72, 84);

const materials = {
  base: new THREE.MeshPhysicalMaterial({
    color: 0x2f3842,
    metalness: 0.74,
    roughness: 0.34,
    roughnessMap: darkAnodizedTexture,
    bumpMap: darkAnodizedTexture,
    bumpScale: 0.12,
    anisotropy: 0.35,
    clearcoat: 0.32,
    clearcoatRoughness: 0.22,
    envMapIntensity: 1.08,
  }),
  bowl: new THREE.MeshStandardMaterial({
    color: 0x8f9aa2,
    metalness: 0.58,
    roughness: 0.4,
    roughnessMap: brushedSteelTexture,
    bumpMap: brushedSteelTexture,
    bumpScale: 0.06,
    envMapIntensity: 0.58,
    side: THREE.DoubleSide,
  }),
  track: new THREE.MeshStandardMaterial({
    color: 0xb8c0c7,
    metalness: 0.56,
    roughness: 0.38,
    roughnessMap: brushedSteelTexture,
    bumpMap: brushedSteelTexture,
    bumpScale: 0.055,
    envMapIntensity: 0.62,
    side: THREE.DoubleSide,
  }),
  guard: new THREE.MeshStandardMaterial({
    color: 0x75828c,
    metalness: 0.48,
    roughness: 0.44,
    roughnessMap: brushedSteelTexture,
    bumpMap: brushedSteelTexture,
    bumpScale: 0.035,
    envMapIntensity: 0.5,
    side: THREE.DoubleSide,
  }),
  outlet: new THREE.MeshStandardMaterial({
    color: 0x1495a7,
    metalness: 0.34,
    roughness: 0.38,
    roughnessMap: brushedSteelTexture,
    bumpMap: brushedSteelTexture,
    bumpScale: 0.04,
    envMapIntensity: 0.55,
  }),
};

function createBrushedSteelTexture(min = 92, max = 176) {
  const width = 256;
  const height = 32;
  const data = new Uint8Array(width * height * 3);

  for (let x = 0; x < width; x += 1) {
    const stripe = Math.sin(x * 0.55) * 12 + Math.sin(x * 0.13) * 18;

    for (let y = 0; y < height; y += 1) {
      const grain = ((x * 17 + y * 31) % 19) - 9;
      const value = THREE.MathUtils.clamp(Math.round((min + max) / 2 + stripe + grain), min, max);
      const index = (y * width + x) * 3;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(18, 2);
  texture.needsUpdate = true;
  return texture;
}

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
  const group = createMeshOnlyExportGroup(params);
  group.updateMatrixWorld(true);
  const exporter = new STLExporter();
  return exporter.parse(group, { binary: false }) as string;
}

export function exportBowlToObj(params: BowlParams) {
  const group = createMeshOnlyExportGroup(params);
  group.updateMatrixWorld(true);
  const exporter = new OBJExporter();
  return exporter.parse(group);
}

export function exportBowlToStep(params: BowlParams) {
  const triangles = collectMeshTriangles(params);
  return createFacetedStepFile(triangles);
}

export function exportBowl(params: BowlParams, format: ExportFormat) {
  const upperFormat = format.toUpperCase();
  const extension = format === "step" ? "step" : format;
  const mimeType = format === "obj"
    ? "text/plain"
    : format === "step"
      ? "model/step"
      : "model/stl";
  const content = format === "obj"
    ? exportBowlToObj(params)
    : format === "step"
      ? exportBowlToStep(params)
      : exportBowlToStl(params);

  return {
    content,
    extension,
    label: upperFormat,
    mimeType,
    fileName: `vibratory-bowl-generated.${extension}`,
  };
}

interface StepTriangle {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
}

function createMeshOnlyExportGroup(params: BowlParams) {
  const source = createVibratoryBowl(params);
  source.updateMatrixWorld(true);

  const group = new THREE.Group();
  group.name = "vibratory-bowl-export";

  source.traverse((child) => {
    if (!isMesh(child)) return;

    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, child.material);
    mesh.name = sanitizeExportName(child.name);
    group.add(mesh);
  });

  group.updateMatrixWorld(true);
  return group;
}

function collectMeshTriangles(params: BowlParams) {
  const group = createVibratoryBowl(params);
  const triangles: StepTriangle[] = [];
  group.updateMatrixWorld(true);

  group.traverse((child) => {
    if (!isMesh(child)) return;

    const geometry = child.geometry;
    const positions = geometry.getAttribute("position");
    if (!positions) return;

    const indices = geometry.getIndex();
    const readVertex = (index: number) => new THREE.Vector3()
      .fromBufferAttribute(positions, index)
      .applyMatrix4(child.matrixWorld);

    const pushTriangle = (aIndex: number, bIndex: number, cIndex: number) => {
      const a = readVertex(aIndex);
      const b = readVertex(bIndex);
      const c = readVertex(cIndex);
      const areaNormal = new THREE.Vector3()
        .subVectors(b, a)
        .cross(new THREE.Vector3().subVectors(c, a));

      if (areaNormal.lengthSq() < 0.000001) return;
      triangles.push({ a, b, c });
    };

    if (indices) {
      for (let i = 0; i < indices.count; i += 3) {
        pushTriangle(indices.getX(i), indices.getX(i + 1), indices.getX(i + 2));
      }
      return;
    }

    for (let i = 0; i < positions.count; i += 3) {
      pushTriangle(i, i + 1, i + 2);
    }
  });

  return triangles;
}

function createFacetedStepFile(triangles: StepTriangle[]) {
  const entities: string[] = [];
  let nextId = 1;
  const addEntity = (body: string) => {
    const id = nextId;
    nextId += 1;
    entities.push(`#${id}=${body};`);
    return id;
  };

  const applicationContext = addEntity("APPLICATION_CONTEXT('automotive design')");
  addEntity(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${applicationContext})`);
  const productContext = addEntity(`PRODUCT_CONTEXT('',#${applicationContext},'mechanical')`);
  const product = addEntity(`PRODUCT('Vibratory Bowl Generator','Vibratory Bowl Generator','',(#${productContext}))`);
  const formation = addEntity(`PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#${product},.NOT_KNOWN.)`);
  const definitionContext = addEntity(`PRODUCT_DEFINITION_CONTEXT('part definition',#${applicationContext},'design')`);
  const definition = addEntity(`PRODUCT_DEFINITION('design','',#${formation},#${definitionContext})`);

  const origin = addEntity("CARTESIAN_POINT('',(0.,0.,0.))");
  const zDirection = addEntity("DIRECTION('',(0.,0.,1.))");
  const xDirection = addEntity("DIRECTION('',(1.,0.,0.))");
  const axis = addEntity(`AXIS2_PLACEMENT_3D('',#${origin},#${zDirection},#${xDirection})`);
  const lengthUnit = addEntity("(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))");
  const angleUnit = addEntity("(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))");
  const solidAngleUnit = addEntity("(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())");
  const uncertainty = addEntity(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.001),#${lengthUnit},'distance_accuracy_value','')`);
  const context = addEntity(`GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthUnit},#${angleUnit},#${solidAngleUnit})) REPRESENTATION_CONTEXT('3D Context','')`);

  const pointIds = new Map<string, number>();
  const faceIds: number[] = [];
  const getPointId = (point: THREE.Vector3) => {
    const key = formatPointKey(point);
    const existing = pointIds.get(key);
    if (existing) return existing;

    const id = addEntity(`CARTESIAN_POINT('',${formatStepVector(point)})`);
    pointIds.set(key, id);
    return id;
  };

  triangles.forEach((triangle) => {
    const a = getPointId(triangle.a);
    const b = getPointId(triangle.b);
    const c = getPointId(triangle.c);
    const edge = new THREE.Vector3().subVectors(triangle.b, triangle.a).normalize();
    const normal = new THREE.Vector3()
      .subVectors(triangle.b, triangle.a)
      .cross(new THREE.Vector3().subVectors(triangle.c, triangle.a))
      .normalize();

    const normalDirection = addEntity(`DIRECTION('',${formatStepVector(normal)})`);
    const referenceDirection = addEntity(`DIRECTION('',${formatStepVector(edge)})`);
    const placement = addEntity(`AXIS2_PLACEMENT_3D('',#${a},#${normalDirection},#${referenceDirection})`);
    const plane = addEntity(`PLANE('',#${placement})`);
    const loop = addEntity(`POLY_LOOP('',(#${a},#${b},#${c}))`);
    const bound = addEntity(`FACE_OUTER_BOUND('',#${loop},.T.)`);
    const face = addEntity(`ADVANCED_FACE('',(#${bound}),#${plane},.T.)`);
    faceIds.push(face);
  });

  const shell = addEntity(`CLOSED_SHELL('',(${faceIds.map((id) => `#${id}`).join(",")}))`);
  const solid = addEntity(`MANIFOLD_SOLID_BREP('Vibratory Bowl',#${shell})`);
  const representation = addEntity(`ADVANCED_BREP_SHAPE_REPRESENTATION('Vibratory Bowl',(#${axis},#${solid}),#${context})`);
  const shape = addEntity(`PRODUCT_DEFINITION_SHAPE('','',#${definition})`);
  addEntity(`SHAPE_DEFINITION_REPRESENTATION(#${shape},#${representation})`);

  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "");

  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('Faceted STEP AP214 generated locally'),'2;1');",
    `FILE_NAME('vibratory-bowl-generated.step','${timestamp}',('Vibratory Bowl Generator'),('Vibratory Bowl Generator'),'Vibratory Bowl Generator','Vibratory Bowl Generator','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN_CC2'));",
    "ENDSEC;",
    "DATA;",
    ...entities,
    "ENDSEC;",
    "END-ISO-10303-21;",
  ].join("\n");
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh<THREE.BufferGeometry> {
  return (object as THREE.Mesh).isMesh === true && (object as THREE.Mesh).geometry?.isBufferGeometry === true;
}

function sanitizeExportName(name: string) {
  return (name || "mesh").replace(/\s+/g, "_");
}

function formatPointKey(point: THREE.Vector3) {
  return [point.x, point.y, point.z].map((value) => formatStepNumber(value, 4)).join(",");
}

function formatStepVector(vector: THREE.Vector3) {
  return `(${formatStepNumber(vector.x)},${formatStepNumber(vector.y)},${formatStepNumber(vector.z)})`;
}

function formatStepNumber(value: number, precision = 6) {
  const normalized = Math.abs(value) < 10 ** -precision ? 0 : value;
  const rounded = Number(normalized.toFixed(precision));
  const text = rounded.toString();
  return text.includes(".") || text.includes("e") ? text : `${text}.`;
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

  const rimTube = THREE.MathUtils.clamp(params.wallThickness * 0.36, 1.5, 5);
  group.add(createPolishedRim(topRadius - params.wallThickness / 2, rimTube, bowlY + params.bowlHeight));
  group.add(createPolishedRim(
    Math.max(8, innerWallBottomRadius - params.wallThickness / 2),
    Math.max(1.2, rimTube * 0.65),
    bowlY + params.bottomThickness + 0.6,
  ));

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

function createPolishedRim(radius: number, tubeRadius: number, y: number) {
  const geometry = new THREE.TorusGeometry(radius, tubeRadius, 12, 180);
  const mesh = new THREE.Mesh(geometry, materials.bowl.clone());
  mesh.name = "圆角抛光卷边";
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = y;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
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
  const group = new THREE.Group();
  group.name = "轨道限位挡边";
  const guardThickness = Math.max(2.4, params.wallThickness * 0.72);
  const guardHeight = getTrackEdgeBaffleHeight(params);

  const innerGuard = new THREE.Mesh(
    createTrackEdgeBaffleGeometry(params, "inner", guardThickness, guardHeight * 0.82),
    materials.guard.clone(),
  );
  innerGuard.name = "轨道内侧限位挡边";
  group.add(withEdges(innerGuard, 0x55616d));

  const outerGuard = new THREE.Mesh(
    createTrackEdgeBaffleGeometry(params, "outer", guardThickness, guardHeight),
    materials.guard.clone(),
  );
  outerGuard.name = "轨道外侧限位挡边";
  group.add(withEdges(outerGuard, 0x55616d));

  return group;
}

function createSpiralOrientationStation(params: BowlParams) {
  const group = new THREE.Group();
  group.name = "全程轨道选面导向";
  if (params.partTopFace === "auto") return group;

  const faceName = getTopFaceStructureName(params.partTopFace);
  const isSideFace = isSideTopFace(params.partTopFace);
  const railThickness = Math.max(4, params.wallThickness);
  const guideStart = Math.max(TRACK_LEAD_IN_RATIO, 0.06);
  const holdStart = 0.82;
  const guideEnd = 1;
  const laneWidth = getFittedLaneWidth(params) ?? (isSideFace
    ? THREE.MathUtils.clamp(params.trackWidth * 0.46, railThickness * 3.2, params.trackWidth * 0.62)
    : THREE.MathUtils.clamp(params.trackWidth * 0.72, railThickness * 4.2, params.trackWidth - railThickness * 1.4));
  const guideLaneWidth = THREE.MathUtils.clamp(
    Math.max(laneWidth + railThickness * 4, params.trackWidth * 0.86),
    laneWidth,
    Math.max(laneWidth, params.trackWidth - railThickness * 1.2),
  );
  const railHeightFallback = isSideFace
    ? Math.max(params.guardHeight * 0.92, params.outletHeight * 0.66)
    : Math.max(8, Math.min(params.guardHeight * 0.48, params.outletHeight * 0.34));
  const railHeight = getFittedGuideHeight(params, railHeightFallback);
  const guideLaneOffset = guideLaneWidth / 2 + railThickness / 2;
  const keepLaneOffset = laneWidth / 2 + railThickness / 2;
  const guideDeckThickness = Math.max(1.2, params.trackThickness * 0.18);
  const guideDeckLift = getGuideDeckLift(params);

  group.add(createSpiralGuideWall(params, {
    capEnd: false,
    capStart: false,
    edgeColor: 0x1f5963,
    heightRiseEndRatio: 0.18,
    height: railHeight,
    material: materials.outlet,
    name: `${faceName}全程爬升窄槽外挡`,
    radialOffset: guideLaneOffset,
    radialThickness: railThickness,
    startHeight: Math.max(railThickness * 0.7, railHeight * 0.18),
    tEnd: holdStart,
    tStart: guideStart,
  }));

  group.add(createSpiralGuideWall(params, {
    capEnd: false,
    capStart: false,
    edgeColor: 0x55616d,
    heightRiseEndRatio: 0.18,
    height: isSideFace ? railHeight * 0.52 : railHeight,
    material: materials.guard,
    name: `${faceName}全程爬升窄槽内挡`,
    radialOffset: -guideLaneOffset,
    radialThickness: railThickness,
    startHeight: Math.max(railThickness * 0.7, railHeight * 0.14),
    tEnd: holdStart,
    tStart: guideStart,
  }));

  group.add(createSpiralGuideWall(params, {
    capEnd: false,
    capStart: false,
    edgeColor: 0x1f5963,
    endRadialOffset: keepLaneOffset,
    height: railHeight,
    material: materials.outlet,
    name: `${faceName}末端渐缩保持外挡`,
    radialOffset: guideLaneOffset,
    radialThickness: railThickness,
    tEnd: guideEnd,
    tStart: holdStart,
  }));

  group.add(createSpiralGuideWall(params, {
    capEnd: false,
    capStart: false,
    edgeColor: 0x55616d,
    endRadialOffset: -keepLaneOffset,
    height: isSideFace ? railHeight * 0.52 : railHeight,
    material: materials.guard,
    name: `${faceName}末端渐缩保持内挡`,
    radialOffset: -guideLaneOffset,
    radialThickness: railThickness,
    tEnd: guideEnd,
    tStart: holdStart,
  }));

  group.add(createSpiralTaperedLaneSurface(params, {
    capEnd: false,
    capStart: false,
    edgeColor: 0x1f5963,
    endLaneWidth: guideLaneWidth,
    endYOffset: guideDeckLift,
    material: materials.outlet,
    name: `${faceName}导向入口连续上坡轨面`,
    riseEndRatio: 0.72,
    riseStartRatio: 0.14,
    startLaneWidth: guideLaneWidth,
    startYOffset: 0,
    thickness: guideDeckThickness,
    tEnd: holdStart,
    tStart: guideStart,
  }));

  group.add(createSpiralTaperedLaneSurface(params, {
    capEnd: false,
    capStart: false,
    edgeColor: 0x1f5963,
    endLaneWidth: laneWidth,
    endYOffset: guideDeckLift,
    material: materials.outlet,
    name: `${faceName}末端渐缩保持轨面`,
    startLaneWidth: guideLaneWidth,
    startYOffset: guideDeckLift,
    thickness: guideDeckThickness,
    tEnd: guideEnd,
    tStart: holdStart,
  }));

  if (isSideFace) {
    const sideBias = getTopFaceSideBias(params.partTopFace);
    const rampWidth = Math.max(params.trackWidth * 0.68, laneWidth + railThickness * 2);
    const rampThickness = Math.max(2.4, railThickness * 0.48);
    const rampLow = rampThickness + 0.8;
    const rampLift = Math.max(railThickness * 2.1, params.trackThickness * 1.35);
    const topRailOffset = getTopGuideSurfaceYOffset(
      params,
      Math.max(railHeight * 0.82, rampLift + railThickness * 1.2),
      railThickness,
    );

    group.add(createSpiralSlopedGuideSurface(params, {
      capEnd: false,
      capStart: false,
      aRadialOffset: -sideBias * rampWidth / 2,
      aYOffset: rampLow,
      aEndYOffset: rampLow,
      bRadialOffset: sideBias * rampWidth / 2,
      bYOffset: rampLow,
      bEndYOffset: rampLift,
      edgeColor: 0x1f5963,
      material: materials.outlet,
      name: `${faceName}全程连续翻面导向斜面`,
      riseEndRatio: 0.92,
      riseStartRatio: 0.12,
      thickness: rampThickness,
      tEnd: guideEnd,
      tStart: guideStart,
    }));

    group.add(createSpiralSlopedGuideSurface(params, {
      capEnd: false,
      capStart: false,
      aRadialOffset: -laneWidth * 0.32,
      aYOffset: topRailOffset,
      bRadialOffset: laneWidth * 0.32,
      bYOffset: topRailOffset,
      edgeColor: 0x55616d,
      material: materials.guard,
      name: `${faceName}全程立槽上限轨`,
      thickness: railThickness,
      tEnd: guideEnd,
      tStart: guideStart,
    }));
  } else {
    const clearance = getTopGuideSurfaceYOffset(
      params,
      Math.max(params.trackThickness + railThickness * 2.4, railHeight + railThickness * 1.8),
      railThickness,
    );
    const returnThickness = Math.max(2.4, railThickness * 0.45);
    const returnLow = returnThickness + 0.8;

    group.add(createSpiralSlopedGuideSurface(params, {
      capEnd: false,
      capStart: false,
      aRadialOffset: -laneWidth * 0.24,
      aYOffset: clearance,
      bRadialOffset: laneWidth * 0.24,
      bYOffset: clearance,
      edgeColor: 0x55616d,
      material: materials.guard,
      name: `${faceName}全程上压保持窄条`,
      thickness: railThickness,
      tEnd: guideEnd,
      tStart: guideStart,
    }));

    group.add(createSpiralSlopedGuideSurface(params, {
      capEnd: false,
      capStart: false,
      aRadialOffset: -params.trackWidth / 2 + railThickness * 0.8,
      aYOffset: railHeight + railThickness * 0.8,
      bRadialOffset: -laneWidth / 2 - railThickness * 0.5,
      bYOffset: returnLow,
      edgeColor: 0x1f5963,
      material: materials.outlet,
      name: `${faceName}全程错姿态回料斜面`,
      thickness: returnThickness,
      tEnd: guideEnd,
      tStart: guideStart,
    }));
  }

  return group;
}

interface SpiralStripCapOptions {
  capEnd?: boolean;
  capStart?: boolean;
}

interface OutletGuideSurfaceOptions extends SpiralStripCapOptions {
  aStartY?: number;
  bStartY?: number;
  riseEndRatio?: number;
  riseStartRatio?: number;
  steps?: number;
}

interface SpiralGuideWallSpec extends SpiralStripCapOptions {
  edgeColor: number;
  endRadialOffset?: number;
  endHeight?: number;
  heightRiseEndRatio?: number;
  heightRiseStartRatio?: number;
  material: THREE.Material;
  name: string;
  height: number;
  radialOffset: number;
  radialThickness: number;
  startHeight?: number;
  tEnd: number;
  tStart: number;
}

interface SpiralSlopedSurfaceSpec extends SpiralStripCapOptions {
  aEndYOffset?: number;
  aRadialOffset: number;
  aYOffset: number;
  bEndYOffset?: number;
  bRadialOffset: number;
  bYOffset: number;
  edgeColor: number;
  material: THREE.Material;
  name: string;
  riseEndRatio?: number;
  riseStartRatio?: number;
  thickness: number;
  tEnd: number;
  tStart: number;
}

function createSpiralGuideWall(
  params: BowlParams,
  spec: SpiralGuideWallSpec,
) {
  const steps = getOrientationGuideSteps(params, spec.tStart, spec.tEnd);
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    const t = THREE.MathUtils.lerp(spec.tStart, spec.tEnd, ratio);
    const pose = getSpiralTrackPose(params, t);
    const radialOffset = THREE.MathUtils.lerp(
      spec.radialOffset,
      spec.endRadialOffset ?? spec.radialOffset,
      smoothstep(ratio),
    );
    const height = THREE.MathUtils.lerp(
      spec.startHeight ?? spec.height,
      spec.endHeight ?? spec.height,
      getGuideRiseBlend(ratio, spec.heightRiseStartRatio, spec.heightRiseEndRatio),
    );
    const centerRadius = pose.trackCenterRadius + radialOffset;
    const innerRadius = Math.max(1, centerRadius - spec.radialThickness / 2);
    const outerRadius = Math.max(innerRadius + 0.1, centerRadius + spec.radialThickness / 2);
    const yBottom = pose.position.y;
    const yTop = yBottom + height;

    pushRadialVertex(vertices, pose.radial, innerRadius, yBottom);
    pushRadialVertex(vertices, pose.radial, outerRadius, yBottom);
    pushRadialVertex(vertices, pose.radial, innerRadius, yTop);
    pushRadialVertex(vertices, pose.radial, outerRadius, yTop);
  }

  stitchSpiralStripIndices(indices, steps, spec);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, spec.material.clone());
  mesh.name = spec.name;
  return withEdges(mesh, spec.edgeColor);
}

interface SpiralTaperedLaneSurfaceSpec extends SpiralStripCapOptions {
  edgeColor: number;
  endLaneWidth: number;
  endYOffset?: number;
  material: THREE.Material;
  name: string;
  riseEndRatio?: number;
  riseStartRatio?: number;
  startLaneWidth: number;
  startYOffset?: number;
  thickness: number;
  tEnd: number;
  tStart: number;
  yOffset?: number;
}

function createSpiralTaperedLaneSurface(
  params: BowlParams,
  spec: SpiralTaperedLaneSurfaceSpec,
) {
  const steps = getOrientationGuideSteps(params, spec.tStart, spec.tEnd);
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    const t = THREE.MathUtils.lerp(spec.tStart, spec.tEnd, ratio);
    const pose = getSpiralTrackPose(params, t);
    const laneWidth = THREE.MathUtils.lerp(spec.startLaneWidth, spec.endLaneWidth, smoothstep(ratio));
    const liftBlend = getGuideRiseBlend(ratio, spec.riseStartRatio, spec.riseEndRatio);
    const yOffset = THREE.MathUtils.lerp(
      spec.startYOffset ?? spec.yOffset ?? 0,
      spec.endYOffset ?? spec.yOffset ?? 0,
      liftBlend,
    );
    const innerRadius = Math.max(1, pose.trackCenterRadius - laneWidth / 2);
    const outerRadius = Math.max(innerRadius + 0.1, pose.trackCenterRadius + laneWidth / 2);
    const yTop = pose.position.y + yOffset;
    const yBottom = yTop - spec.thickness;

    pushRadialVertex(vertices, pose.radial, innerRadius, yTop);
    pushRadialVertex(vertices, pose.radial, outerRadius, yTop);
    pushRadialVertex(vertices, pose.radial, innerRadius, yBottom);
    pushRadialVertex(vertices, pose.radial, outerRadius, yBottom);
  }

  stitchSpiralStripIndices(indices, steps, spec);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, spec.material.clone());
  mesh.name = spec.name;
  return withEdges(mesh, spec.edgeColor);
}

function createSpiralSlopedGuideSurface(
  params: BowlParams,
  spec: SpiralSlopedSurfaceSpec,
) {
  const steps = getOrientationGuideSteps(params, spec.tStart, spec.tEnd);
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    const liftBlend = getGuideRiseBlend(ratio, spec.riseStartRatio, spec.riseEndRatio);
    const t = THREE.MathUtils.lerp(spec.tStart, spec.tEnd, ratio);
    const pose = getSpiralTrackPose(params, t);
    const aRadius = Math.max(1, pose.trackCenterRadius + spec.aRadialOffset);
    const bRadius = Math.max(1, pose.trackCenterRadius + spec.bRadialOffset);
    const aTopY = pose.position.y + THREE.MathUtils.lerp(
      spec.aYOffset,
      spec.aEndYOffset ?? spec.aYOffset,
      liftBlend,
    );
    const bTopY = pose.position.y + THREE.MathUtils.lerp(
      spec.bYOffset,
      spec.bEndYOffset ?? spec.bYOffset,
      liftBlend,
    );

    pushRadialVertex(vertices, pose.radial, aRadius, aTopY);
    pushRadialVertex(vertices, pose.radial, bRadius, bTopY);
    pushRadialVertex(vertices, pose.radial, aRadius, aTopY - spec.thickness);
    pushRadialVertex(vertices, pose.radial, bRadius, bTopY - spec.thickness);
  }

  stitchSpiralStripIndices(indices, steps, spec);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, spec.material.clone());
  mesh.name = spec.name;
  return withEdges(mesh, spec.edgeColor);
}

function pushRadialVertex(vertices: number[], radial: THREE.Vector3, radius: number, y: number) {
  vertices.push(radial.x * radius, y, radial.z * radius);
}

function stitchSpiralStripIndices(
  indices: number[],
  steps: number,
  options: SpiralStripCapOptions = {},
) {
  for (let index = 0; index < steps; index += 1) {
    const a = index * 4;
    const b = (index + 1) * 4;

    indices.push(a, b, a + 1, a + 1, b, b + 1);
    indices.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
    indices.push(a, a + 2, b, a + 2, b + 2, b);
    indices.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
  }

  if (options.capStart ?? true) {
    indices.push(0, 1, 2, 1, 3, 2);
  }

  if (options.capEnd ?? true) {
    const end = steps * 4;
    indices.push(end, end + 2, end + 1, end + 1, end + 2, end + 3);
  }
}

function getOrientationGuideSteps(params: BowlParams, tStart: number, tEnd: number) {
  return Math.max(64, Math.round(params.trackTurns * 88 * Math.max(0.15, tEnd - tStart)));
}

function getSpiralTrackPose(params: BowlParams, t: number) {
  const sign = params.feedDirection === "clockwise" ? -1 : 1;
  const totalAngle = params.trackTurns * TWO_PI;
  const angle = Math.PI * 0.2 + sign * totalAngle * t;
  const totalRise = getEffectiveTotalRise(params);
  const profileRatio = getProfileHeightRatio(params, totalRise * t);
  const localRadius = getRoundProfileRadius(params, profileRatio);
  const outerRadius = Math.max(18, localRadius - params.wallThickness);
  const innerRadius = Math.max(14, outerRadius - params.trackWidth);
  const trackCenterRadius = (innerRadius + outerRadius) / 2;
  const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const tangent = new THREE.Vector3(-Math.sin(angle) * sign, 0, Math.cos(angle) * sign).normalize();
  const yTop = params.baseHeight
    + params.bottomThickness
    + totalRise * t
    + getTrackThicknessAt(t, Math.max(2, params.trackThickness));

  return {
    position: radial.clone().multiplyScalar(trackCenterRadius).setY(yTop),
    radial,
    tangent,
    trackCenterRadius,
  };
}

function isSideTopFace(face: PartTopFace) {
  return face === "xPositive" || face === "xNegative" || face === "zPositive" || face === "zNegative";
}

function getTopFaceSideBias(face: PartTopFace) {
  return face === "xNegative" || face === "zNegative" ? -1 : 1;
}

function getFittedLaneWidth(params: BowlParams) {
  if (!params.partFitWidth || params.partFitWidth <= 0) return null;
  return params.partFitWidth + getFitClearance(params) * 2 + getFittedBendAllowance(params);
}

function getFittedGuideHeight(params: BowlParams, fallback: number) {
  if (!params.partFitHeight || params.partFitHeight <= 0) return fallback;
  return Math.max(fallback, params.partFitHeight + getFitClearance(params));
}

function getFittedTopYOffset(params: BowlParams, fallback: number) {
  if (!params.partFitHeight || params.partFitHeight <= 0) return fallback;
  return Math.max(
    fallback,
    params.partFitHeight + getFitClearance(params) + getTopGuideRelief(params) + getGuideDeckLift(params) + 2,
  );
}

function getTopGuideSurfaceYOffset(params: BowlParams, fallback: number, guideThickness: number) {
  return getFittedTopYOffset(params, fallback) + Math.max(0, guideThickness);
}

function getFitClearance(params: BowlParams) {
  return params.partFitClearance && params.partFitClearance > 0 ? params.partFitClearance : 2;
}

function getTopGuideRelief(params: BowlParams) {
  if (!params.partFitHeight || params.partFitHeight <= 0) return 3;
  return THREE.MathUtils.clamp(params.partFitHeight * 0.18, 2.8, 5.5);
}

function getGuideDeckLift(params: BowlParams) {
  return Math.max(1.6, params.trackThickness * 0.24);
}

function getOutletTransitionOverlap(params: BowlParams) {
  const railThickness = Math.max(4, params.wallThickness);
  return Math.max(railThickness * 2.4, Math.min(params.trackWidth * 0.45, 28));
}

function getOutletSupportMinimumBottomY(params: BowlParams) {
  return params.baseHeight + params.bottomThickness + 0.6;
}

function getFittedBendAllowance(params: BowlParams) {
  if (params.shape !== "round" || !params.partFitLength || params.partFitLength <= 0) return 0;

  const topRadius = params.bowlDiameter / 2;
  const profileScale = params.bowlProfile === "conical"
    ? THREE.MathUtils.clamp((params.conicalBottomRatio / 100 + 1) / 2, 0.55, 1)
    : 1;
  const trackCenterRadius = Math.max(20, topRadius * profileScale - params.wallThickness - params.trackWidth / 2);
  return (params.partFitLength * params.partFitLength) / (4 * trackCenterRadius);
}

function getTopFaceStructureName(face: PartTopFace) {
  const names: Record<PartTopFace, string> = {
    auto: "未选定",
    xPositive: "右侧面朝上",
    xNegative: "左侧面朝上",
    yPositive: "上表面朝上",
    yNegative: "底面朝上",
    zPositive: "前端面朝上",
    zNegative: "后端面朝上",
  };
  return names[face];
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
  outlet.quaternion.copy(getOutletQuaternion(layout.tangent));

  const group = new THREE.Group();
  group.name = "出料口";
  group.add(createOutletPlatform(params, layout, y, totalOutletLength));
  group.add(withEdges(outlet, 0x1f5963));
  group.add(createOutletOrientationGuides(params, layout, y, totalOutletLength));
  return group;
}

function createOutletPlatform(
  params: BowlParams,
  layout: ReturnType<typeof getOutletLayout>,
  trackCenterY: number,
  totalOutletLength: number,
) {
  const group = new THREE.Group();
  group.name = "出料平台结构";
  const railThickness = Math.max(4, params.wallThickness);
  const transitionOverlap = getOutletTransitionOverlap(params);
  const platformThickness = Math.max(3, params.trackThickness * 0.45);
  const platformLength = Math.max(params.outletLength, totalOutletLength - layout.wallExitDistance);
  const platformStart = layout.wallExitDistance + railThickness * 0.5 + platformLength / 2;
  const platformCenterY = Math.max(
    -params.trackThickness * 0.75,
    getOutletSupportMinimumBottomY(params) + platformThickness / 2 - trackCenterY,
  );
  const tongueLength = Math.max(
    48,
    params.trackWidth * 1.5,
    layout.wallExitDistance + transitionOverlap + railThickness * 3,
  );
  const tongueStart = -transitionOverlap;
  const tongueWidth = Math.max(getFittedLaneWidth(params) ?? params.outletWidth, params.trackWidth * 0.9);
  const tongueTopStart = params.trackThickness / 2 + 0.12;
  const tongueTopEnd = params.trackThickness / 2 + getGuideDeckLift(params);
  const tongueThickness = Math.max(1.2, params.trackThickness * 0.18);

  addOutletBox(
    group,
    "出料承托底板",
    [platformLength, platformThickness, params.outletWidth + railThickness * 4],
    [platformStart, platformCenterY, 0],
    trackCenterY,
    layout,
    materials.bowl.clone(),
    0x75818c,
  );

  addOutletGuideSurface(
    group,
    "轨道过渡舌板",
    tongueStart,
    tongueStart + tongueLength,
    -tongueWidth / 2,
    tongueTopEnd,
    tongueWidth / 2,
    tongueTopEnd,
    tongueThickness,
    trackCenterY,
    layout,
    materials.outlet.clone(),
    0x1f5963,
    {
      aStartY: tongueTopStart,
      bStartY: tongueTopStart,
      capStart: false,
      riseEndRatio: 0.72,
      riseStartRatio: 0.12,
      steps: 20,
    },
  );

  return group;
}

function createOrientationSelector(
  params: BowlParams,
  layout: ReturnType<typeof getOutletLayout>,
  trackCenterY: number,
  totalOutletLength: number,
) {
  const group = new THREE.Group();
  group.name = "出料过渡选面接续导向";
  if (params.partTopFace === "auto") return group;

  const faceName = getTopFaceStructureName(params.partTopFace);
  const isSideFace = isSideTopFace(params.partTopFace);
  const railThickness = Math.max(4, params.wallThickness);
  const selectorStart = -getOutletTransitionOverlap(params);
  const selectorEnd = Math.max(selectorStart + 24, totalOutletLength - railThickness * 0.6);
  const selectorLength = selectorEnd - selectorStart;
  const laneWidth = getFittedLaneWidth(params) ?? (isSideFace
    ? THREE.MathUtils.clamp(params.trackWidth * 0.46, railThickness * 3.2, params.trackWidth * 0.62)
    : THREE.MathUtils.clamp(params.trackWidth * 0.72, railThickness * 4.2, params.trackWidth - railThickness * 1.4));
  const selectorHeightFallback = isSideFace
    ? Math.max(params.guardHeight * 0.86, params.outletHeight * 0.6)
    : Math.max(4, Math.min(params.guardHeight * 0.5, params.outletHeight * 0.3));
  const selectorHeight = getFittedGuideHeight(params, selectorHeightFallback);
  const innerHeight = Math.max(3, Math.min(selectorHeight * 0.72, params.guardHeight * 0.5));
  const sideBias = getTopFaceSideBias(params.partTopFace);
  const entryLaneWidth = THREE.MathUtils.clamp(
    Math.max(laneWidth + railThickness * 4, params.trackWidth * 0.92),
    laneWidth,
    Math.max(laneWidth, params.outletWidth - railThickness * 1.2),
  );
  const keepLaneWidth = laneWidth;

  addOutletTaperedGuideWall(
    group,
    `${faceName}过渡渐缩保持外挡`,
    selectorStart,
    selectorStart + selectorLength,
    entryLaneWidth,
    keepLaneWidth,
    1,
    selectorHeight,
    railThickness,
    params.trackThickness / 2,
    trackCenterY,
    layout,
    materials.outlet.clone(),
    0x1f5963,
    { capStart: false },
  );

  addOutletTaperedGuideWall(
    group,
    `${faceName}过渡渐缩保持内挡`,
    selectorStart,
    selectorStart + selectorLength,
    entryLaneWidth,
    keepLaneWidth,
    -1,
    innerHeight,
    railThickness,
    params.trackThickness / 2,
    trackCenterY,
    layout,
    materials.outlet.clone(),
    0x55616d,
    { capStart: false },
  );

  if (isSideFace) {
    const rampWidth = Math.max(params.trackWidth * 0.68, laneWidth + railThickness * 2);
    const rampThickness = Math.max(2.4, railThickness * 0.48);
    const rampLow = params.trackThickness / 2 + rampThickness + 0.8;
    const rampLift = params.trackThickness / 2 + Math.max(railThickness * 2.1, params.trackThickness * 1.35);
    const topRail = params.trackThickness / 2 + getTopGuideSurfaceYOffset(
      params,
      Math.max(selectorHeight * 0.82, rampLift + railThickness * 1.2),
      railThickness,
    );

    addOutletGuideSurface(
      group,
      `${faceName}过渡连续翻面导向斜面`,
      selectorStart,
      selectorStart + selectorLength,
      -sideBias * rampWidth / 2,
      rampLow,
      sideBias * rampWidth / 2,
      rampLift,
      rampThickness,
      trackCenterY,
      layout,
      materials.outlet.clone(),
      0x1f5963,
      {
        aStartY: rampLow,
        bStartY: rampLow,
        capStart: false,
        riseEndRatio: 0.86,
        riseStartRatio: 0.14,
        steps: 18,
      },
    );

    addOutletGuideSurface(
      group,
      `${faceName}过渡立槽上限轨`,
      selectorStart,
      selectorStart + selectorLength,
      -laneWidth * 0.32,
      topRail,
      laneWidth * 0.32,
      topRail,
      railThickness,
      trackCenterY,
      layout,
      materials.guard.clone(),
      0x55616d,
      { capStart: false },
    );
  } else {
    const clearance = params.trackThickness / 2 + getTopGuideSurfaceYOffset(
      params,
      Math.max(
        params.trackThickness + railThickness * 2.4,
        selectorHeight + railThickness * 1.8,
      ),
      railThickness,
    );
    const returnThickness = Math.max(2.4, railThickness * 0.45);
    const returnLow = params.trackThickness / 2 + returnThickness + 0.8;

    addOutletGuideSurface(
      group,
      `${faceName}过渡上压保持窄条`,
      selectorStart,
      selectorStart + selectorLength * 0.94,
      -keepLaneWidth * 0.24,
      clearance,
      keepLaneWidth * 0.24,
      clearance,
      railThickness,
      trackCenterY,
      layout,
      materials.guard.clone(),
      0x55616d,
      { capStart: false },
    );

    addOutletGuideSurface(
      group,
      `${faceName}过渡错姿态回料斜面`,
      selectorStart,
      selectorStart + selectorLength * 0.82,
      -entryLaneWidth / 2 + railThickness * 0.55,
      params.trackThickness / 2 + selectorHeight + railThickness * 0.8,
      -keepLaneWidth / 2 - railThickness * 0.28,
      returnLow,
      returnThickness,
      trackCenterY,
      layout,
      materials.outlet.clone(),
      0x1f5963,
      { capStart: false },
    );
  }

  return group;
}

function addOutletBox(
  group: THREE.Group,
  name: string,
  size: [number, number, number],
  localPosition: [number, number, number],
  trackCenterY: number,
  layout: ReturnType<typeof getOutletLayout>,
  material: THREE.Material,
  edgeColor: number,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.name = name;
  const startPoint = layout.radial.clone().multiplyScalar(layout.trackCenterRadius);
  const xAxis = layout.tangent.clone().normalize();
  const zAxis = getOutletSideAxis(layout.tangent);
  const position = startPoint
    .clone()
    .add(xAxis.clone().multiplyScalar(localPosition[0]))
    .add(zAxis.clone().multiplyScalar(localPosition[2]));

  mesh.position.set(position.x, trackCenterY + localPosition[1], position.z);
  mesh.quaternion.copy(getOutletQuaternion(layout.tangent));
  group.add(withEdges(mesh, edgeColor));
}

function addOutletTaperedGuideWall(
  group: THREE.Group,
  name: string,
  xStart: number,
  xEnd: number,
  entryLaneWidth: number,
  keepLaneWidth: number,
  side: 1 | -1,
  height: number,
  railThickness: number,
  yBottomOffset: number,
  trackCenterY: number,
  layout: ReturnType<typeof getOutletLayout>,
  material: THREE.Material,
  edgeColor: number,
  options: SpiralStripCapOptions = {},
) {
  const yBottom = trackCenterY + yBottomOffset;
  const yTop = yBottom + height;
  const startInner = side * entryLaneWidth / 2;
  const startOuter = side * (entryLaneWidth / 2 + railThickness);
  const endInner = side * keepLaneWidth / 2;
  const endOuter = side * (keepLaneWidth / 2 + railThickness);
  const vertices = [
    getOutletLocalPoint(layout, xStart, yBottom, startInner),
    getOutletLocalPoint(layout, xStart, yBottom, startOuter),
    getOutletLocalPoint(layout, xStart, yTop, startInner),
    getOutletLocalPoint(layout, xStart, yTop, startOuter),
    getOutletLocalPoint(layout, xEnd, yBottom, endInner),
    getOutletLocalPoint(layout, xEnd, yBottom, endOuter),
    getOutletLocalPoint(layout, xEnd, yTop, endInner),
    getOutletLocalPoint(layout, xEnd, yTop, endOuter),
  ];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(flattenVectors(vertices), 3));
  const indices = [
    0, 4, 1, 1, 4, 5,
    2, 3, 6, 3, 7, 6,
    0, 2, 4, 2, 6, 4,
    1, 5, 3, 3, 5, 7,
  ];
  if (options.capStart ?? true) {
    indices.push(0, 1, 2, 1, 3, 2);
  }
  if (options.capEnd ?? true) {
    indices.push(4, 6, 5, 5, 6, 7);
  }
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  group.add(withEdges(mesh, edgeColor));
}

function addOutletGuideSurface(
  group: THREE.Group,
  name: string,
  xStart: number,
  xEnd: number,
  zA: number,
  yA: number,
  zB: number,
  yB: number,
  thickness: number,
  trackCenterY: number,
  layout: ReturnType<typeof getOutletLayout>,
  material: THREE.Material,
  edgeColor: number,
  options: OutletGuideSurfaceOptions = {},
) {
  const steps = Math.max(1, Math.round(options.steps ?? 1));
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    const liftBlend = getGuideRiseBlend(ratio, options.riseStartRatio, options.riseEndRatio);
    const x = THREE.MathUtils.lerp(xStart, xEnd, ratio);
    const currentYA = THREE.MathUtils.lerp(options.aStartY ?? yA, yA, liftBlend);
    const currentYB = THREE.MathUtils.lerp(options.bStartY ?? yB, yB, liftBlend);

    vertices.push(
      ...flattenVectors([
        getOutletLocalPoint(layout, x, trackCenterY + currentYA, zA),
        getOutletLocalPoint(layout, x, trackCenterY + currentYB, zB),
        getOutletLocalPoint(layout, x, trackCenterY + currentYA - thickness, zA),
        getOutletLocalPoint(layout, x, trackCenterY + currentYB - thickness, zB),
      ]),
    );
  }

  stitchSpiralStripIndices(indices, steps, options);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  group.add(withEdges(mesh, edgeColor));
}

function getOutletLocalPoint(
  layout: ReturnType<typeof getOutletLayout>,
  x: number,
  y: number,
  z: number,
) {
  const startPoint = layout.radial.clone().multiplyScalar(layout.trackCenterRadius);
  const xAxis = layout.tangent.clone().normalize();
  const zAxis = getOutletSideAxis(layout.tangent);
  return startPoint
    .clone()
    .add(xAxis.multiplyScalar(x))
    .add(zAxis.multiplyScalar(z))
    .setY(y);
}

function flattenVectors(vectors: THREE.Vector3[]) {
  return vectors.flatMap((vector) => [vector.x, vector.y, vector.z]);
}

function createOutletOrientationGuides(
  params: BowlParams,
  layout: ReturnType<typeof getOutletLayout>,
  trackCenterY: number,
  totalOutletLength: number,
) {
  const group = new THREE.Group();
  group.name = "出口末端姿态处理机构";
  if (params.outletOrientation === "free") return group;

  const railThickness = Math.max(4, params.wallThickness);
  const startPoint = layout.radial.clone().multiplyScalar(layout.trackCenterRadius);
  const xAxis = layout.tangent.clone().normalize();
  const zAxis = getOutletSideAxis(layout.tangent);
  const orientation = getOutletQuaternion(layout.tangent);
  const guideLength = THREE.MathUtils.clamp(
    params.outletLength * 0.76,
    Math.min(70, totalOutletLength),
    Math.max(80, totalOutletLength - railThickness * 3),
  );
  const guideStart = THREE.MathUtils.clamp(
    layout.wallExitDistance + railThickness,
    0,
    Math.max(0, totalOutletLength - guideLength),
  );

  const addBox = (
    name: string,
    size: [number, number, number],
    localPosition: [number, number, number],
    edgeColor = 0x55616d,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), materials.guard.clone());
    mesh.name = name;
    const position = startPoint
      .clone()
      .add(xAxis.clone().multiplyScalar(localPosition[0]))
      .add(zAxis.clone().multiplyScalar(localPosition[2]));
    mesh.position.set(position.x, trackCenterY + localPosition[1], position.z);
    mesh.quaternion.copy(orientation);
    group.add(withEdges(mesh, edgeColor));
  };

  const sideGuide = (height: number, laneWidth = params.outletWidth) => {
    const centerX = guideStart + guideLength / 2;
    const centerY = params.trackThickness / 2 + height / 2;
    const sideOffset = laneWidth / 2 + railThickness / 2;
    addBox("末端姿态左导条", [guideLength, height, railThickness], [centerX, centerY, sideOffset]);
    addBox("末端姿态右导条", [guideLength, height, railThickness], [centerX, centerY, -sideOffset]);
  };

  if (params.outletOrientation === "sideUp" || params.outletOrientation === "standing") {
    const guideHeightFallback = params.outletOrientation === "standing"
      ? Math.max(params.outletHeight * 0.9, params.guardHeight + params.trackThickness)
      : Math.max(params.guardHeight, params.outletHeight * 0.58);
    const guideHeight = getFittedGuideHeight(params, guideHeightFallback);
    const laneWidth = getFittedLaneWidth(params) ?? (params.outletOrientation === "standing"
      ? Math.max(params.trackWidth * 0.42, params.outletWidth * 0.54)
      : params.outletWidth);

    sideGuide(guideHeight, laneWidth);

    if (params.outletOrientation === "standing") {
      addBox(
        "立式出料底部定位条",
        [guideLength * 0.75, railThickness * 1.4, railThickness],
        [guideStart + guideLength * 0.48, params.trackThickness / 2 + railThickness * 0.7, 0],
        0x1f5963,
      );
    }

    return group;
  }

  const sideHeight = getFittedGuideHeight(
    params,
    Math.max(10, Math.min(params.guardHeight * 0.48, params.outletHeight * 0.35)),
  );
  const holdDownLength = guideLength * 0.7;
  const holdDownClearance = getFittedTopYOffset(
    params,
    Math.max(
      params.trackThickness + 8,
      Math.min(params.outletHeight, params.guardHeight + params.trackThickness + 12),
    ),
  );
  const sideBias = params.outletOrientation === "backUp" ? -1 : 1;
  const laneWidth = getFittedLaneWidth(params) ?? params.outletWidth;

  sideGuide(sideHeight, laneWidth);
  addBox(
    params.outletOrientation === "backUp" ? "末端背面朝上限高压板" : "末端正面朝上限高压板",
    [holdDownLength, railThickness, laneWidth],
    [
      guideStart + holdDownLength / 2,
      params.trackThickness / 2 + holdDownClearance + railThickness / 2,
      sideBias * getFitClearance(params) * 0.35,
    ],
  );

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
    const baseInnerRadius = Math.max(14, localRadius - offsets.innerOffset);
    const baseOuterRadius = Math.max(baseInnerRadius + 4, localRadius - offsets.outerOffset);
    const trackShape = getIntegratedTrackShape(params, t, baseInnerRadius, baseOuterRadius);
    const yTop = baseY + totalRise * t + getTrackThicknessAt(t, thickness);
    const yBottom = baseY + totalRise * t - TRACK_FLOOR_OVERLAP;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    vertices.push(trackShape.innerRadius * cos, yTop + trackShape.innerYOffset, trackShape.innerRadius * sin);
    vertices.push(trackShape.outerRadius * cos, yTop + trackShape.outerYOffset, trackShape.outerRadius * sin);
    vertices.push(trackShape.innerRadius * cos, yBottom, trackShape.innerRadius * sin);
    vertices.push(trackShape.outerRadius * cos, yBottom, trackShape.outerRadius * sin);
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

function getIntegratedTrackShape(
  params: BowlParams,
  t: number,
  baseInnerRadius: number,
  baseOuterRadius: number,
) {
  const baseWidth = Math.max(1, baseOuterRadius - baseInnerRadius);
  if (params.partTopFace === "auto") {
    return {
      innerRadius: baseInnerRadius,
      innerYOffset: 0,
      outerRadius: baseOuterRadius,
      outerYOffset: 0,
    };
  }

  const railThickness = Math.max(4, params.wallThickness);
  const laneWidth = getIntegratedTrackLaneWidth(params, baseWidth, railThickness, t);
  const centerRadius = (baseInnerRadius + baseOuterRadius) / 2
    + getIntegratedTrackCenterOffset(params, baseWidth, laneWidth, t);
  const innerRadius = Math.max(1, centerRadius - laneWidth / 2);
  const outerRadius = Math.max(innerRadius + 0.1, centerRadius + laneWidth / 2);
  const sideLift = getIntegratedTrackSideLift(params, railThickness, t);

  return {
    innerRadius,
    innerYOffset: sideLift.inner,
    outerRadius,
    outerYOffset: sideLift.outer,
  };
}

function getIntegratedTrackLaneWidth(
  params: BowlParams,
  baseWidth: number,
  railThickness: number,
  t: number,
) {
  const targetWidth = getFittedLaneWidth(params) ?? (isSideTopFace(params.partTopFace)
    ? THREE.MathUtils.clamp(params.trackWidth * 0.54, railThickness * 3.4, params.trackWidth * 0.7)
    : THREE.MathUtils.clamp(params.trackWidth * 0.76, railThickness * 4.4, params.trackWidth - railThickness));
  const narrowing = getGuideRiseBlend(t, TRACK_LEAD_IN_RATIO + 0.06, 0.96);
  return THREE.MathUtils.lerp(baseWidth, Math.min(baseWidth, targetWidth), narrowing);
}

function getIntegratedTrackCenterOffset(
  params: BowlParams,
  baseWidth: number,
  laneWidth: number,
  t: number,
) {
  if (!isSideTopFace(params.partTopFace)) return 0;

  const availableShift = Math.max(0, (baseWidth - laneWidth) / 2);
  const preferredShift = params.partFitWidth
    ? getFitClearance(params) * 0.85
    : baseWidth * 0.08;
  const progress = getGuideRiseBlend(t, TRACK_LEAD_IN_RATIO, 0.98);
  return THREE.MathUtils.clamp(
    getTopFaceSideBias(params.partTopFace) * preferredShift * progress,
    -availableShift,
    availableShift,
  );
}

function getIntegratedTrackSideLift(params: BowlParams, railThickness: number, t: number) {
  if (!isSideTopFace(params.partTopFace)) {
    return { inner: 0, outer: 0 };
  }

  const progress = getGuideRiseBlend(t, TRACK_LEAD_IN_RATIO + 0.08, 1);
  const lift = Math.max(
    params.trackThickness * 1.15,
    railThickness * 1.5,
    getFitClearance(params) * 2.2,
  ) * progress;

  return getTopFaceSideBias(params.partTopFace) >= 0
    ? { inner: 0, outer: lift }
    : { inner: lift, outer: 0 };
}

function createTrackEdgeBaffleGeometry(
  params: BowlParams,
  side: "inner" | "outer",
  baffleThickness: number,
  baffleHeight: number,
) {
  const steps = Math.max(96, Math.round(params.trackTurns * 96));
  const sign = params.feedDirection === "clockwise" ? -1 : 1;
  const totalAngle = params.trackTurns * Math.PI * 2;
  const startAngle = Math.PI * 0.2;
  const baseY = params.baseHeight + params.bottomThickness;
  const totalRise = getEffectiveTotalRise(params);
  const trackThickness = Math.max(2, params.trackThickness);
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = startAngle + sign * totalAngle * t;
    const profileRatio = getProfileHeightRatio(params, totalRise * t);
    const localRadius = getRoundProfileRadius(params, profileRatio);
    const baseInnerRadius = Math.max(14, localRadius - params.wallThickness - params.trackWidth);
    const baseOuterRadius = Math.max(baseInnerRadius + 4, localRadius - params.wallThickness);
    const trackShape = getIntegratedTrackShape(params, t, baseInnerRadius, baseOuterRadius);
    const edgeRadius = side === "inner" ? trackShape.innerRadius : trackShape.outerRadius;
    const edgeYOffset = side === "inner" ? trackShape.innerYOffset : trackShape.outerYOffset;
    const innerRadius = side === "inner" ? Math.max(1, edgeRadius - baffleThickness) : edgeRadius;
    const outerRadius = side === "inner" ? edgeRadius : edgeRadius + baffleThickness;
    const yBottom = baseY + totalRise * t + getTrackThicknessAt(t, trackThickness) + edgeYOffset - 0.18;
    const yTop = yBottom + baffleHeight;
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

function getTrackEdgeBaffleHeight(params: BowlParams) {
  const fittedHeight = params.partFitHeight && params.partFitHeight > 0
    ? params.partFitHeight * 0.74 + getFitClearance(params)
    : params.guardHeight * 0.72;
  const minimumHeight = Math.max(6, params.trackThickness);
  return THREE.MathUtils.clamp(
    Math.max(params.trackThickness * 1.4, fittedHeight),
    minimumHeight,
    Math.max(minimumHeight, params.guardHeight),
  );
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
  return getEffectiveTrackTotalRise(params);
}

function getTrackThicknessAt(t: number, thickness: number) {
  return thickness * smoothstep(THREE.MathUtils.clamp(t / TRACK_LEAD_IN_RATIO, 0, 1));
}

function getGuideRiseBlend(t: number, startRatio = 0, endRatio = 1) {
  if (endRatio <= startRatio) return smootherstep(t);
  const localT = THREE.MathUtils.clamp((t - startRatio) / (endRatio - startRatio), 0, 1);
  return smootherstep(localT);
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function smootherstep(t: number) {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
}

function getOutletGap(params: BowlParams) {
  const layout = getOutletLayout(params);
  const halfOpeningWidth = params.outletWidth / 2 + params.wallThickness * 2;
  const innerEdgeRadius = THREE.MathUtils.clamp(
    layout.trackCenterRadius - halfOpeningWidth,
    1,
    layout.outerRadius - 0.1,
  );
  const outerEdgeRadius = THREE.MathUtils.clamp(
    layout.trackCenterRadius + halfOpeningWidth,
    1,
    layout.outerRadius - 0.1,
  );
  const innerEdgeOffset = Math.acos(THREE.MathUtils.clamp(innerEdgeRadius / layout.outerRadius, -1, 1));
  const outerEdgeOffset = Math.acos(THREE.MathUtils.clamp(outerEdgeRadius / layout.outerRadius, -1, 1));
  const startOffset = Math.min(innerEdgeOffset, outerEdgeOffset);
  const endOffset = Math.max(innerEdgeOffset, outerEdgeOffset);
  const angularMargin = THREE.MathUtils.clamp(
    (params.wallThickness * 2 + params.trackThickness) / layout.outerRadius,
    0.03,
    0.12,
  );
  const centerOffset = (startOffset + endOffset) / 2;
  const size = THREE.MathUtils.clamp(endOffset - startOffset + angularMargin * 2, 0.2, 1.15);

  return {
    center: layout.endAngle + layout.sign * centerOffset,
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
    sign,
    endAngle,
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

function getOutletQuaternion(tangent: THREE.Vector3) {
  const xAxis = tangent.clone().normalize();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = getOutletSideAxis(tangent);
  const matrix = new THREE.Matrix4().makeBasis(
    xAxis,
    yAxis,
    zAxis,
  );
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function getOutletSideAxis(tangent: THREE.Vector3) {
  return new THREE.Vector3()
    .crossVectors(tangent.clone().normalize(), new THREE.Vector3(0, 1, 0))
    .normalize();
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
