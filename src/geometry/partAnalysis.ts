import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { BowlParams, defaultParams, PartAnalysis } from "../types";

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

  throw new Error("当前原型支持 STL 和 OBJ；STEP 将在本地 CAD 内核模块中扩展。");
}

export function buildRecommendedParams(
  analysis: PartAnalysis,
  current: BowlParams = defaultParams,
): BowlParams {
  const maxPlan = Math.max(analysis.length, analysis.width);
  const crossSize = Math.max(Math.min(analysis.length, analysis.width), analysis.height);
  const clearance = Math.max(8, crossSize * 0.18);
  const trackWidth = roundToStep(crossSize + clearance * 2, 5);
  const bowlDiameter = roundToStep(Math.max(300, maxPlan * 5.2, trackWidth * 7.6), 10);
  const bowlHeight = roundToStep(Math.max(120, analysis.height * 4.5 + 70), 10);
  const trackTurns = clamp(roundToStep(Math.max(1.5, bowlDiameter / 180), 0.5), 1.5, 5);
  const risePerTurn = roundToStep(Math.max(16, analysis.height * 1.15 + 10), 5);
  const baseLength = roundToStep(Math.max(bowlDiameter + 100, maxPlan * 6), 10);

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
    guardHeight: roundToStep(Math.max(18, analysis.height * 0.65 + 12), 2),
    outletWidth: roundToStep(trackWidth + 8, 2),
    outletHeight: roundToStep(Math.max(30, analysis.height * 1.45), 2),
    outletLength: roundToStep(Math.max(110, trackWidth * 2.5), 10),
    baseLength,
    baseWidth: baseLength,
    baseHeight: roundToStep(Math.max(60, bowlHeight * 0.42), 10),
  };
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
