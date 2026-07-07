import * as THREE from "three";
import occtImport from "occt-import-js";
import occtWasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { defaultParams } from "../types";
import type { BowlParams, PartAnalysis, PartTopFace } from "../types";
import { getMotionConstraints } from "./bowlMotion";
import type { PhysicalEnvelope } from "./bowlMotion";

type OcctMesh = {
  name?: string;
  color?: number[];
  attributes: {
    position: { array: ArrayLike<number> | number[][] };
    normal?: { array: ArrayLike<number> | number[][] };
  };
  index?: { array: ArrayLike<number> | number[][] };
};

type OcctReadResult = {
  success: boolean;
  meshes?: OcctMesh[];
};

type OcctModule = {
  ReadStepFile: (content: Uint8Array, params: Record<string, unknown> | null) => OcctReadResult;
};

let occtModulePromise: Promise<OcctModule> | null = null;

const importedMaterial = new THREE.MeshStandardMaterial({
  color: 0x2f7d8c,
  metalness: 0.15,
  roughness: 0.48,
  transparent: true,
  opacity: 0.78,
});

export async function parsePartFile(file: File): Promise<{
  object: THREE.Object3D;
  analysis: PartAnalysis;
}> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "stl") {
    const buffer = await file.arrayBuffer();
    const geometry = new STLLoader().parse(buffer);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, importedMaterial.clone());
    mesh.name = file.name;
    centerObject(mesh);
    return {
      object: mesh,
      analysis: analyzeObject(mesh, file.name, "STL"),
    };
  }

  if (extension === "obj") {
    const text = await file.text();
    const object = new OBJLoader().parse(text);
    object.name = file.name;
    object.traverse((child) => {
      if (isMesh(child)) {
        child.material = importedMaterial.clone();
        child.geometry.computeVertexNormals();
      }
    });
    centerObject(object);
    return {
      object,
      analysis: analyzeObject(object, file.name, "OBJ"),
    };
  }

  if (extension === "step" || extension === "stp") {
    const object = await parseStepFile(file);
    centerObject(object);
    return {
      object,
      analysis: analyzeObject(object, file.name, "STEP"),
    };
  }

  throw new Error("当前原型支持 STL、OBJ、STEP 文件。");
}

async function parseStepFile(file: File) {
  const occt = await getOcctModule();
  const buffer = await file.arrayBuffer();
  const result = occt.ReadStepFile(new Uint8Array(buffer), {
    linearUnit: "millimeter",
    linearDeflectionType: "bounding_box_ratio",
    linearDeflection: 0.0008,
    angularDeflection: 0.5,
  });

  if (!result.success || !result.meshes?.length) {
    throw new Error("STEP 文件解析失败，请检查文件是否为有效的 STEP/STP 模型。");
  }

  const group = new THREE.Group();
  group.name = file.name;

  result.meshes.forEach((mesh, index) => {
    const geometry = createGeometryFromOcctMesh(mesh);
    const material = importedMaterial.clone();

    if (mesh.color && mesh.color.length >= 3) {
      material.color = new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2]);
    }

    const child = new THREE.Mesh(geometry, material);
    child.name = mesh.name || `${file.name}-${index + 1}`;
    group.add(child);
  });

  return group;
}

function getOcctModule() {
  occtModulePromise ??= occtImport({
    locateFile: (path) => path.endsWith(".wasm") ? occtWasmUrl : path,
  }).then((module) => module as OcctModule);

  return occtModulePromise;
}

function createGeometryFromOcctMesh(mesh: OcctMesh) {
  const geometry = new THREE.BufferGeometry();
  const positions = toFlatNumberArray(mesh.attributes.position.array);
  const normals = mesh.attributes.normal ? toFlatNumberArray(mesh.attributes.normal.array) : [];
  const indices = mesh.index ? toFlatNumberArray(mesh.index.array) : [];

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length === positions.length) {
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  }

  if (indices.length > 0) {
    geometry.setIndex(indices);
  }

  if (!geometry.getAttribute("normal")) {
    geometry.computeVertexNormals();
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function toFlatNumberArray(values: ArrayLike<number> | number[][]) {
  if (Array.isArray(values) && Array.isArray(values[0])) {
    return values.flat();
  }

  return Array.from(values as ArrayLike<number>);
}

export function buildRecommendedParams(
  analysis: PartAnalysis,
  current: BowlParams = defaultParams,
): BowlParams {
  const envelope = getAnalysisEnvelope(analysis, current.partTopFace);
  const wallThickness = current.wallThickness || defaultParams.wallThickness;
  const trackThickness = current.trackThickness || defaultParams.trackThickness;
  const lateralClearance = Math.max(8, Math.min(18, envelope.width * 0.18));
  let trackWidth = roundToStep(
    Math.max(
      defaultParams.trackWidth,
      envelope.width + lateralClearance * 2 + wallThickness * 1.5,
      envelope.width * 1.3,
    ),
    5,
  );
  let outletHeight = roundToStep(
    Math.max(30, getRequiredOutletPoseHeight(current, envelope) + trackThickness + 10),
    2,
  );
  let diameterPadding = 0;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = createRecommendedCandidate(current, envelope, trackWidth, outletHeight, diameterPadding);
    const constraints = getMotionConstraints(candidate, envelope);
    let changed = false;

    if (!constraints.canEnterTrack) {
      const shortage = constraints.requiredLaneWidth - constraints.laneWidth;
      trackWidth = roundToStep(trackWidth + Math.max(5, shortage + wallThickness * 1.5), 5);
      diameterPadding += Math.max(10, envelope.length * 0.12);
      changed = true;
    }

    if (!constraints.canExit) {
      const shortage = constraints.requiredOutletHeight - constraints.outletHeight;
      outletHeight = roundToStep(outletHeight + Math.max(2, shortage + 6), 2);
      changed = true;
    }

    if (!changed) {
      return candidate;
    }
  }

  return createRecommendedCandidate(current, envelope, trackWidth, outletHeight, diameterPadding);
}

function createRecommendedCandidate(
  current: BowlParams,
  envelope: PhysicalEnvelope,
  trackWidth: number,
  outletHeight: number,
  diameterPadding: number,
): BowlParams {
  const bowlDiameter = getRecommendedBowlDiameter(envelope, trackWidth, current, diameterPadding);
  const trackTurns = clamp(roundToStep(Math.max(1.5, bowlDiameter / 180), 0.5), 1.5, 5);
  const risePerTurn = roundToStep(Math.max(16, envelope.height * 1.15 + 10), 5);
  const guardHeight = roundToStep(Math.max(18, envelope.height * 0.65 + 12), 2);
  const totalRise = trackTurns * risePerTurn;
  const bowlHeight = roundToStep(
    Math.max(
      120,
      envelope.height * 4.5 + 70,
      totalRise + guardHeight + current.bottomThickness + current.trackThickness + 28,
    ),
    10,
  );
  const baseLength = roundToStep(
    Math.max(bowlDiameter + 100, envelope.length * 6, trackWidth * 8),
    10,
  );

  return {
    ...current,
    shape: "round",
    bowlDiameter,
    bowlLength: bowlDiameter,
    bowlWidth: bowlDiameter,
    bowlHeight,
    trackTurns,
    trackWidth,
    trackRisePerTurn: risePerTurn,
    guardHeight,
    outletWidth: roundToStep(Math.max(trackWidth + 8, envelope.width + 16), 2),
    outletHeight,
    outletLength: roundToStep(Math.max(110, trackWidth * 2.5, envelope.length * 1.25), 10),
    baseLength,
    baseWidth: baseLength,
    baseHeight: roundToStep(Math.max(60, bowlHeight * 0.42), 10),
  };
}

function getRecommendedBowlDiameter(
  envelope: PhysicalEnvelope,
  trackWidth: number,
  current: BowlParams,
  diameterPadding: number,
) {
  const profileScale = current.bowlProfile === "conical"
    ? 1 / clamp(current.conicalBottomRatio / 100, 0.45, 1)
    : 1;
  const baseDiameter = Math.max(
    300,
    envelope.length * 5.8 * profileScale,
    trackWidth * 7.8 * profileScale,
  );

  return roundToStep(baseDiameter + diameterPadding, 10);
}

export function getAnalysisEnvelope(analysis: PartAnalysis, topFace: PartTopFace): PhysicalEnvelope {
  const size = getTopAlignedAnalysisSize(analysis, topFace);
  const horizontal = [size.x, size.z].sort((a, b) => b - a);

  return {
    height: size.y,
    length: horizontal[0],
    width: horizontal[1],
  };
}

function getTopAlignedAnalysisSize(analysis: PartAnalysis, topFace: PartTopFace) {
  if (topFace === "xPositive" || topFace === "xNegative") {
    return {
      x: analysis.height,
      y: analysis.length,
      z: analysis.width,
    };
  }

  if (topFace === "zPositive" || topFace === "zNegative") {
    return {
      x: analysis.length,
      y: analysis.width,
      z: analysis.height,
    };
  }

  return {
    x: analysis.length,
    y: analysis.height,
    z: analysis.width,
  };
}

function getRequiredOutletPoseHeight(params: Pick<BowlParams, "outletOrientation">, envelope: PhysicalEnvelope) {
  if (params.outletOrientation === "sideUp") {
    return Math.max(envelope.height, envelope.width);
  }

  if (params.outletOrientation === "standing") {
    return Math.max(envelope.height, envelope.length, envelope.width);
  }

  return envelope.height;
}

export function validateParams(params: BowlParams): string[] {
  const warnings: string[] = [];
  const radius = params.bowlDiameter / 2;
  const minimumProfileRadius = params.bowlProfile === "conical"
    ? radius * (params.conicalBottomRatio / 100)
    : radius;
  const neededRadius = params.wallThickness + params.trackWidth + 28;
  const totalRise = params.trackRisePerTurn * params.trackTurns;

  if (params.shape === "round" && minimumProfileRadius < neededRadius) {
    warnings.push("圆盘底部空间偏小，轨道宽度和挡边可能放不下。");
  }

  if (totalRise + params.guardHeight + params.bottomThickness > params.bowlHeight) {
    warnings.push("轨道总爬升接近或超过盘体高度，已在预览中自动压缩。");
  }

  if (params.outletWidth < params.trackWidth) {
    warnings.push("出料口宽度小于轨道宽度，零件可能卡料。");
  }

  if (params.trackWidth <= 0 || params.trackTurns <= 0) {
    warnings.push("轨道宽度和圈数必须大于 0。");
  }

  return warnings;
}

function analyzeObject(
  object: THREE.Object3D,
  fileName: string,
  format: PartAnalysis["format"],
): PartAnalysis {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const volume = computeObjectVolume(object);
  const stableFace = getStableFace(size);

  return {
    fileName,
    format,
    length: round(size.x),
    width: round(size.z),
    height: round(size.y),
    volume: volume > 0 ? round(volume) : null,
    center: [round(center.x), round(center.y), round(center.z)],
    stableFace,
    recommendedFeedDirection: size.x >= size.z ? "沿长度方向出料" : "沿宽度方向出料",
  };
}

function centerObject(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);

  const newBox = new THREE.Box3().setFromObject(object);
  object.position.y -= newBox.min.y;
}

function computeObjectVolume(object: THREE.Object3D) {
  let volume = 0;
  object.updateMatrixWorld(true);

  object.traverse((child) => {
    if (!isMesh(child)) return;

    const geometry = child.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;

    const index = geometry.index;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        a.fromBufferAttribute(position, index.getX(i)).applyMatrix4(child.matrixWorld);
        b.fromBufferAttribute(position, index.getX(i + 1)).applyMatrix4(child.matrixWorld);
        c.fromBufferAttribute(position, index.getX(i + 2)).applyMatrix4(child.matrixWorld);
        volume += signedTriangleVolume(a, b, c);
      }
    } else {
      for (let i = 0; i < position.count; i += 3) {
        a.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
        b.fromBufferAttribute(position, i + 1).applyMatrix4(child.matrixWorld);
        c.fromBufferAttribute(position, i + 2).applyMatrix4(child.matrixWorld);
        volume += signedTriangleVolume(a, b, c);
      }
    }
  });

  return Math.abs(volume);
}

function signedTriangleVolume(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  return a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
}

function getStableFace(size: THREE.Vector3) {
  const faces = [
    { name: "长×宽平面", area: size.x * size.z },
    { name: "长×高侧面", area: size.x * size.y },
    { name: "宽×高侧面", area: size.z * size.y },
  ];
  faces.sort((a, b) => b.area - a.area);
  return faces[0].name;
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function roundToStep(value: number, step: number) {
  return Math.round(value / step) * step;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
