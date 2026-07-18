import { useEffect, useRef } from "react";
import { Box, Focus, Maximize2, MousePointer2, RotateCw, Ruler, ZoomIn } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { AnimationParams, BowlParams, PartFaceSelection } from "../types";
import {
  clampMotionDistance,
  getBowlMotionPose,
  getMotionConstraints,
  getVibrationFeedRate,
} from "../geometry/bowlMotion";
import {
  getOrientationForwardAxis,
  getOrientationGuideLayout,
  isSideTopFace,
  needsVerticalOrientationGuide,
} from "../geometry/orientationGuide";
import { createVibratoryBowl } from "../geometry/vibratoryBowl";
import { PartFacePreview } from "./PartFacePreview";

interface SceneViewportProps {
  params: BowlParams;
  partObject: THREE.Object3D | null;
  selectedFace: PartFaceSelection | null;
  animationParams: AnimationParams;
  onFaceSelected: (selection: PartFaceSelection) => void;
}

interface AnimatedPartMotion {
  captureLength: number;
  constraints: ReturnType<typeof getMotionConstraints>;
  distance: number;
  faceAxis: PartFaceSelection["axis"] | null;
  faceGuideQuaternion: THREE.Quaternion | null;
  forwardAxis: "x" | "z";
  group: THREE.Group;
  initialSize: THREE.Vector3;
  instances: AnimatedPartInstance[];
  lastElapsed: number | null;
  nextCaptureAt: number;
  nextCaptureIndex: number;
  params: BowlParams;
  runSeconds: number;
  size: THREE.Vector3;
}

type AnimatedPartMode = "reservoir" | "capture" | "path";

interface AnimatedPartInstance {
  availableAt: number;
  captureDistance: number;
  captureFromPosition: THREE.Vector3;
  captureFromQuaternion: THREE.Quaternion;
  entryYaw: number;
  group: THREE.Group;
  mode: AnimatedPartMode;
  object: THREE.Object3D;
  pathDistance: number;
  pileLayer: number;
  reservoirIndex: number;
  reservoirYaw: number;
  sequenceIndex: number;
}

export function SceneViewport({
  params,
  partObject,
  selectedFace,
  animationParams,
  onFaceSelected,
}: SceneViewportProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef(animationParams);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    previewRoot: THREE.Group;
    motionRoot: THREE.Group;
    animatedPart: AnimatedPartMotion | null;
    clock: THREE.Clock;
    frame: number;
  } | null>(null);

  useEffect(() => {
    animationRef.current = animationParams;
    if (!animationParams.enabled && sceneRef.current) {
      resetMotion(sceneRef.current.motionRoot);
    }
  }, [animationParams]);

  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101821);

    const camera = new THREE.PerspectiveCamera(39, 1, 1, 24000);
    camera.position.set(720, 650, 780);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountRef.current.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
    scene.environment = environment;
    pmrem.dispose();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 120, 0);
    controls.maxDistance = 18000;
    controls.minDistance = 40;

    scene.add(new THREE.HemisphereLight(0xf7fbff, 0x3d4852, 2.55));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.15);
    keyLight.position.set(520, 760, 260);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xcee3ff, 1.75);
    fillLight.position.set(-520, 340, -420);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.85);
    rimLight.position.set(-260, 520, 780);
    scene.add(rimLight);

    const frontStripLight = new THREE.RectAreaLight(0xffffff, 2.4, 760, 120);
    frontStripLight.position.set(0, 520, 520);
    frontStripLight.lookAt(0, 80, 0);
    scene.add(frontStripLight);

    const grid = new THREE.GridHelper(2400, 24, 0x3b5b65, 0x233744);
    grid.position.y = -0.5;
    scene.add(grid);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(5000, 5000),
      new THREE.ShadowMaterial({ color: 0x071019, opacity: 0.28 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const previewRoot = new THREE.Group();
    const motionRoot = new THREE.Group();
    previewRoot.add(motionRoot);
    scene.add(previewRoot);
    const clock = new THREE.Clock();

    const resize = () => {
      if (!mountRef.current) return;
      const { clientWidth, clientHeight } = mountRef.current;
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / Math.max(1, clientHeight);
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(mountRef.current);
    resize();

    const animate = () => {
      const current = sceneRef.current;
      if (current) {
        const elapsedSeconds = current.clock.getElapsedTime();
        updateAnimatedPart(current.animatedPart, animationRef.current, elapsedSeconds);
        applyVibration(current.motionRoot, animationRef.current, elapsedSeconds);
      }
      controls.update();
      renderer.render(scene, camera);
      if (current) current.frame = requestAnimationFrame(animate);
    };

    sceneRef.current = {
      scene,
      renderer,
      camera,
      controls,
      previewRoot,
      motionRoot,
      animatedPart: null,
      clock,
      frame: 0,
    };
    animate();

    return () => {
      const current = sceneRef.current;
      if (current) {
        cancelAnimationFrame(current.frame);
        observer.disconnect();
        current.controls.dispose();
        disposeMotionRoot(current.motionRoot, current.animatedPart?.group ?? null);
        current.scene.environment?.dispose();
        current.renderer.dispose();
        current.renderer.domElement.remove();
      }
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const current = sceneRef.current;
    if (!current) return;

    disposeMotionRoot(current.motionRoot, current.animatedPart?.group ?? null);
    current.motionRoot.clear();
    current.animatedPart = null;
    resetMotion(current.motionRoot);

    const bowl = createVibratoryBowl(params);
    bowl.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    current.motionRoot.add(bowl);

    if (partObject) {
      const animatedPart = createAnimatedPartMotion(
        partObject,
        selectedFace,
        params,
        animationRef.current.partCount,
      );
      const { group } = animatedPart;
      current.animatedPart = animatedPart;
      updateAnimatedPart(animatedPart, animationRef.current, current.clock.getElapsedTime());
      current.motionRoot.add(group);
    }

    const targetHeight = params.baseHeight + params.bowlHeight * 0.55;
    current.controls.target.set(0, targetHeight, 0);
    current.controls.update();
  }, [params, partObject, selectedFace, animationParams.partCount]);

  const fitView = () => {
    const current = sceneRef.current;
    if (!current) return;

    const box = new THREE.Box3().setFromObject(current.previewRoot);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1);
    const distance = radius * 1.35;
    current.controls.target.copy(center);
    current.camera.position.copy(center).add(new THREE.Vector3(0.82, 0.62, 0.9).normalize().multiplyScalar(distance));
    current.camera.updateProjectionMatrix();
    current.controls.update();
  };

  const setCameraView = (view: "entry" | "iso" | "top" | "side") => {
    const current = sceneRef.current;
    if (!current) return;

    if (view === "entry" && params.shape === "round") {
      const sign = params.feedDirection === "clockwise" ? -1 : 1;
      const entryPosition = getBowlMotionPose(params, 0).position;
      const mouthAngle = Math.atan2(entryPosition.z, entryPosition.x);
      const angle = mouthAngle - sign * 0.32;
      const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const tangent = new THREE.Vector3(sign * -Math.sin(angle), 0, sign * Math.cos(angle));
      const guideLayout = getOrientationGuideLayout(params);
      const hubRadius = Math.max(24, params.bowlDiameter * 0.08);
      const skirtRadius = Math.min(
        params.bowlDiameter * 0.2,
        Math.max(hubRadius * 1.38, hubRadius + guideLayout.entryPartSpan * 0.3),
      );
      const trackInnerRadius = params.bowlDiameter / 2 - params.wallThickness - params.trackWidth;
      const radius = Math.max(20, (skirtRadius + trackInnerRadius) / 2);
      const target = radial.clone().multiplyScalar(radius);
      target.y = params.baseHeight + params.bottomThickness + Math.max(8, params.guardHeight * 0.38);
      const cameraDistance = THREE.MathUtils.clamp(params.bowlDiameter * 0.9, 220, 560);
      current.controls.target.copy(target);
      current.camera.position.copy(target)
        .add(radial.clone().multiplyScalar(-cameraDistance * 0.64))
        .add(tangent.clone().multiplyScalar(-cameraDistance * 0.1))
        .add(new THREE.Vector3(0, cameraDistance * 0.78, 0));
      current.camera.lookAt(target);
      current.camera.updateProjectionMatrix();
      current.controls.update();
      return;
    }

    const target = view === "top"
      ? new THREE.Vector3(0, params.baseHeight + params.bowlHeight * 0.5, 0)
      : current.controls.target.clone();
    const distance = current.camera.position.distanceTo(target);
    const direction = view === "top"
      ? new THREE.Vector3(0.001, 1, 0.001)
      : view === "side"
        ? new THREE.Vector3(1, 0.32, 0.04)
        : new THREE.Vector3(0.82, 0.62, 0.9);

    current.camera.position.copy(target).add(direction.normalize().multiplyScalar(Math.max(distance, 420)));
    current.camera.lookAt(target);
    current.camera.updateProjectionMatrix();
    current.controls.update();
  };

  const orbitStep = () => {
    const current = sceneRef.current;
    if (!current) return;

    const target = current.controls.target;
    const offset = current.camera.position.clone().sub(target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 7);
    current.camera.position.copy(target).add(offset);
    current.camera.lookAt(target);
    current.controls.update();
  };

  const zoomIn = () => {
    const current = sceneRef.current;
    if (!current) return;

    const target = current.controls.target;
    const offset = current.camera.position.clone().sub(target).multiplyScalar(0.78);
    current.camera.position.copy(target).add(offset);
    current.controls.update();
  };

  return (
    <div className="viewport-shell">
      <div ref={mountRef} className="viewport-canvas" />
      <div className="viewport-toolbar" aria-label="视图工具">
        <button type="button" title="等轴测视图" onClick={() => setCameraView("iso")}>
          <MousePointer2 size={15} />
        </button>
        <button type="button" title="旋转视图" onClick={orbitStep}>
          <RotateCw size={15} />
        </button>
        <button type="button" title="放大视图" onClick={zoomIn}>
          <ZoomIn size={15} />
        </button>
        <button type="button" title="俯视轨道" onClick={() => setCameraView("top")}>
          <Ruler size={15} />
        </button>
        <button type="button" title="盘底入口视图" onClick={() => setCameraView("entry")}>
          <Focus size={15} />
        </button>
        <button type="button" title="适合窗口" onClick={fitView}>
          <Maximize2 size={15} />
        </button>
      </div>
      <PartFacePreview
        partObject={partObject}
        selection={selectedFace}
        onSelect={onFaceSelected}
      />
      <div className="view-cube" aria-hidden="true">
        <Box size={16} />
        <span>TOP</span>
      </div>
      <div className="viewport-axis" aria-hidden="true">
        <span className="axis-y">Y</span>
        <span className="axis-x">X</span>
        <span className="axis-z">Z</span>
      </div>
      {needsVerticalOrientationGuide(params) && (
        <div className="orientation-guide-legend" aria-label="定向机构流程">
          <span><b>1</b>盘底散料</span>
          <i>→</i>
          <span><b>2</b>振动铺开</span>
          <i>→</i>
          <span><b>3</b>限高翻转</span>
          <i>→</i>
          <span><b>4</b>全程锁姿</span>
        </div>
      )}
      <div className="viewport-hint">鼠标左键旋转 · 滚轮缩放 · 右键平移</div>
    </div>
  );
}

function getFaceUprightQuaternion(selection: PartFaceSelection) {
  const normal = getCanonicalFaceNormal(selection.axis);
  if (normal.lengthSq() < 0.000001) return null;

  return new THREE.Quaternion().setFromUnitVectors(normal, new THREE.Vector3(0, 1, 0));
}

function getCanonicalFaceNormal(axis: PartFaceSelection["axis"]) {
  if (axis === "xPositive") return new THREE.Vector3(1, 0, 0);
  if (axis === "xNegative") return new THREE.Vector3(-1, 0, 0);
  if (axis === "yPositive") return new THREE.Vector3(0, 1, 0);
  if (axis === "yNegative") return new THREE.Vector3(0, -1, 0);
  if (axis === "zPositive") return new THREE.Vector3(0, 0, 1);
  if (axis === "zNegative") return new THREE.Vector3(0, 0, -1);
  return new THREE.Vector3(0, 1, 0);
}

function createAnimatedPartMotion(
  partObject: THREE.Object3D,
  selectedFace: PartFaceSelection | null,
  params: BowlParams,
  partCount: number,
): AnimatedPartMotion {
  const faceGuideQuaternion = selectedFace ? getFaceUprightQuaternion(selectedFace) : null;
  const initialSample = createCenteredPartClone(partObject, false);
  const initialBox = new THREE.Box3().setFromObject(initialSample);
  const initialSize = initialBox.getSize(new THREE.Vector3());
  const guidedSample = createGuidedPartSample(partObject, faceGuideQuaternion);
  const box = new THREE.Box3().setFromObject(guidedSample);
  const size = box.getSize(new THREE.Vector3());
  const targetFace = selectedFace?.axis ?? params.partTopFace;
  const forwardAxis = !isSideTopFace(targetFace) && params.partForwardAxis
    ? params.partForwardAxis
    : getOrientationForwardAxis(targetFace, initialSize.x, initialSize.z);
  const envelope = getPhysicalEnvelope(size, forwardAxis);
  const constraints = getMotionConstraints(params, envelope);
  const group = new THREE.Group();
  const count = THREE.MathUtils.clamp(Math.round(partCount), 1, 32);
  const captureLength = Math.max(envelope.length, constraints.entryDistance);
  const instances: AnimatedPartInstance[] = [];

  const firstObject = createCenteredPartClone(partObject);
  firstObject.name = "送料动画零件-1";
  const firstCarrier = createPartCarrier(firstObject, 0, count);
  instances.push(firstCarrier);
  group.add(firstCarrier.group);

  for (let index = 1; index < count; index += 1) {
    const clone = createCenteredPartClone(partObject);
    clone.name = `送料动画零件-${index + 1}`;
    const carrier = createPartCarrier(clone, index, count);
    instances.push(carrier);
    group.add(carrier.group);
  }

  group.name = "送料动画零件组";

  const motion: AnimatedPartMotion = {
    captureLength,
    constraints,
    distance: 0,
    faceAxis: selectedFace?.axis ?? null,
    faceGuideQuaternion,
    forwardAxis,
    group,
    initialSize,
    instances,
    lastElapsed: null,
    nextCaptureAt: 1.6,
    nextCaptureIndex: Math.min(2, count - 1),
    params,
    runSeconds: 0,
    size,
  };
  resetPartFlow(motion);
  return motion;
}

function createCenteredPartClone(partObject: THREE.Object3D, cloneMaterial = true) {
  const clone = partObject.clone(true);
  clone.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!cloneMaterial) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(createAnimatedPartMaterial)
      : createAnimatedPartMaterial(mesh.material);
  });

  centerObjectAtOrigin(clone);
  return clone;
}

function createAnimatedPartMaterial(source: THREE.Material) {
  const material = source.clone() as THREE.Material & {
    color?: THREE.Color;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
  };
  material.color?.setHex(0xffa23a);
  material.emissive?.setHex(0x351500);
  if (material.emissiveIntensity !== undefined) material.emissiveIntensity = 0.18;
  material.opacity = 1;
  material.transparent = false;
  material.depthWrite = true;
  return material;
}

function createGuidedPartSample(partObject: THREE.Object3D, faceGuideQuaternion: THREE.Quaternion | null) {
  const clone = createCenteredPartClone(partObject, false);
  if (faceGuideQuaternion) {
    clone.applyQuaternion(faceGuideQuaternion);
    centerObjectAtOrigin(clone);
  }
  return clone;
}

function centerObjectAtOrigin(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  object.updateMatrixWorld(true);
}

function getPhysicalEnvelope(size: THREE.Vector3, forwardAxis: "x" | "z") {
  return {
    height: size.y,
    length: forwardAxis === "x" ? size.x : size.z,
    width: forwardAxis === "x" ? size.z : size.x,
  };
}

function createPartCarrier(
  partObject: THREE.Object3D,
  sequenceIndex: number,
  totalCount: number,
): AnimatedPartInstance {
  const group = new THREE.Group();
  group.add(partObject);
  return {
    availableAt: 0,
    captureDistance: 0,
    captureFromPosition: new THREE.Vector3(),
    captureFromQuaternion: new THREE.Quaternion(),
    entryYaw: seededNoise(sequenceIndex, 47) * Math.PI * 2,
    group,
    mode: "reservoir",
    object: partObject,
    pathDistance: 0,
    pileLayer: getPileLayer(sequenceIndex, totalCount),
    reservoirIndex: sequenceIndex,
    reservoirYaw: seededNoise(sequenceIndex, 31) * Math.PI * 2,
    sequenceIndex,
  };
}

function updateAnimatedPart(
  motion: AnimatedPartMotion | null,
  animation: AnimationParams,
  elapsedSeconds: number,
) {
  if (!motion) return;

  const feedRate = getVibrationFeedRate(animation);
  if (feedRate <= 0) {
    motion.lastElapsed = null;
    resetPartFlow(motion);
    updatePartInstances(motion, animation);
    return;
  }

  if (motion.lastElapsed === null) {
    motion.lastElapsed = elapsedSeconds;
  }

  const deltaSeconds = Math.min(0.05, Math.max(0, elapsedSeconds - motion.lastElapsed));
  const deltaDistance = deltaSeconds * feedRate;
  motion.distance += deltaDistance;
  motion.runSeconds += deltaSeconds;
  motion.lastElapsed = elapsedSeconds;
  advancePartFlow(motion, deltaDistance, deltaSeconds, feedRate);
  updatePartInstances(motion, animation);
}

function updatePartInstances(motion: AnimatedPartMotion, animation: AnimationParams) {
  motion.instances.forEach((instance) => {
    if (instance.mode === "reservoir") {
      applyReservoirPose(instance, motion, animation);
      return;
    }
    if (instance.mode === "capture") {
      applyCapturePose(instance, motion);
      return;
    }

    const physicalDistance = clampMotionDistance(instance.pathDistance, motion.constraints);
    const pose = getBowlMotionPose(motion.params, physicalDistance);
    applyPartPose(instance, motion, pose);
  });
}

function canCompleteMotionPath(constraints: ReturnType<typeof getMotionConstraints>) {
  return constraints.canEnterTrack && constraints.canPassGuide && constraints.canExit;
}

function resetPartFlow(motion: AnimatedPartMotion) {
  motion.distance = 0;
  motion.nextCaptureAt = 1.6;
  motion.nextCaptureIndex = 0;
  motion.runSeconds = 0;
  motion.instances.forEach((instance) => {
    instance.availableAt = 0;
    instance.captureDistance = 0;
    instance.mode = "reservoir";
    instance.pathDistance = 0;
  });
}

function advancePartFlow(
  motion: AnimatedPartMotion,
  deltaDistance: number,
  deltaSeconds: number,
  feedRate: number,
) {
  if (deltaDistance <= 0 || deltaSeconds <= 0) return;
  const completePath = canCompleteMotionPath(motion.constraints);
  const captureRate = Math.min(52, feedRate * 0.2);

  motion.instances.forEach((instance) => {
    if (instance.mode === "path") {
      instance.pathDistance += deltaDistance;
      if (completePath && instance.pathDistance >= motion.constraints.pathLength) {
        instance.availableAt = motion.runSeconds + 3.8;
        instance.mode = "reservoir";
        instance.pathDistance = 0;
      } else if (!completePath) {
        instance.pathDistance = Math.min(instance.pathDistance, motion.constraints.maxDistance);
      }
      return;
    }

    if (instance.mode === "capture") {
      instance.captureDistance += captureRate * deltaSeconds;
      if (instance.captureDistance >= motion.captureLength) {
        const overflow = instance.captureDistance - motion.captureLength;
        instance.captureDistance = motion.captureLength;
        instance.mode = "path";
        instance.pathDistance = completePath
          ? Math.min(overflow, motion.constraints.pathLength - 0.001)
          : Math.min(overflow, motion.constraints.maxDistance);
      }
    }
  });

  if (motion.instances.some((instance) => instance.mode === "capture")) return;
  if (motion.runSeconds < motion.nextCaptureAt) return;

  if (!completePath) {
    const hasPathPart = motion.instances.some((instance) => instance.mode === "path");
    if (motion.constraints.canEnterTrack && !hasPathPart) {
      const candidate = getNextReservoirInstance(motion);
      if (candidate) beginCapture(candidate, motion);
    }
    return;
  }

  const nearestPathDistance = motion.instances.reduce((nearest, instance) => (
    instance.mode === "path" ? Math.min(nearest, instance.pathDistance) : nearest
  ), Number.POSITIVE_INFINITY);
  if (nearestPathDistance < motion.constraints.minimumSpacing) return;

  const candidate = getNextReservoirInstance(motion);
  if (candidate) beginCapture(candidate, motion);
}

function getNextReservoirInstance(motion: AnimatedPartMotion) {
  const candidates = motion.instances.filter((instance) => (
    instance.mode === "reservoir"
      && instance.availableAt <= motion.runSeconds
      && !isScatterSupportCovered(instance, motion)
  ));
  if (candidates.length === 0) return null;

  const entryPosition = getBowlMotionPose(motion.params, 0).position;
  const guideLayout = getOrientationGuideLayout(motion.params);
  const partDiagonal = Math.hypot(motion.initialSize.x, motion.initialSize.z);
  const count = motion.instances.length;
  const exposed = motion.params.shape === "round"
    ? getRoundCaptureCandidates(candidates, motion, entryPosition, guideLayout.entryCaptureWidth, partDiagonal)
    : candidates
      .map((instance) => ({
        instance,
        primary: new THREE.Vector2(instance.group.position.x, instance.group.position.z)
          .distanceToSquared(new THREE.Vector2(entryPosition.x, entryPosition.z)),
        secondary: 0,
      }))
      .filter((candidate) => candidate.primary <= Math.max(
        motion.captureLength,
        partDiagonal * 1.8,
      ) ** 2);
  exposed.sort((left, right) => {
      const primaryDelta = left.primary - right.primary;
      if (Math.abs(primaryDelta) > 0.001) return primaryDelta;
      const secondaryDelta = left.secondary - right.secondary;
      if (Math.abs(secondaryDelta) > 0.001) return secondaryDelta;
      const leftInstance = left.instance;
      const rightInstance = right.instance;
      const leftOrder = (leftInstance.sequenceIndex - motion.nextCaptureIndex + count) % count;
      const rightOrder = (rightInstance.sequenceIndex - motion.nextCaptureIndex + count) % count;
      return leftOrder - rightOrder;
    });
  const candidate = exposed[0]?.instance ?? null;
  if (candidate) {
    motion.nextCaptureIndex = (candidate.sequenceIndex + 1) % count;
  }
  return candidate;
}

function getRoundCaptureCandidates(
  candidates: AnimatedPartInstance[],
  motion: AnimatedPartMotion,
  entryPosition: THREE.Vector3,
  entryCaptureWidth: number,
  partDiagonal: number,
) {
  const feedSign = motion.params.feedDirection === "clockwise" ? -1 : 1;
  const mouthAngle = Math.atan2(entryPosition.z, entryPosition.x);
  const entryRadius = Math.hypot(entryPosition.x, entryPosition.z);
  const radialReach = entryCaptureWidth * 0.56 + partDiagonal * 0.18;

  return candidates.flatMap((instance) => {
    const position = instance.group.position;
    const radius = Math.hypot(position.x, position.z);
    const angle = Math.atan2(position.z, position.x);
    const remainingAngle = positiveModulo(feedSign * (mouthAngle - angle), Math.PI * 2);
    const captureArcLength = Math.max(entryCaptureWidth * 0.78, partDiagonal * 1.25);
    const captureWindowAngle = THREE.MathUtils.clamp(
      captureArcLength / Math.max(20, radius),
      0.26,
      0.72,
    );
    const radialOffset = Math.abs(radius - entryRadius);
    if (remainingAngle > captureWindowAngle || radialOffset > radialReach) return [];
    return [{
      instance,
      primary: remainingAngle * Math.max(20, radius),
      secondary: radialOffset,
    }];
  });
}

function isScatterSupportCovered(instance: AnimatedPartInstance, motion: AnimatedPartMotion) {
  if (instance.pileLayer !== 0) return false;
  const count = motion.instances.length;
  return motion.instances.some((other) => (
    other !== instance
      && other.mode === "reservoir"
      && other.pileLayer > 0
      && getScatterBaseSlot(other.reservoirIndex, count) === instance.reservoirIndex
  ));
}

function positiveModulo(value: number, modulus: number) {
  return ((value % modulus) + modulus) % modulus;
}

function beginCapture(instance: AnimatedPartInstance, motion: AnimatedPartMotion) {
  instance.captureDistance = 0;
  instance.captureFromPosition.copy(instance.group.position);
  instance.captureFromQuaternion.copy(instance.group.quaternion);
  instance.mode = "capture";
  motion.nextCaptureAt = motion.runSeconds + 0.75;
}

function applyReservoirPose(
  instance: AnimatedPartInstance,
  motion: AnimatedPartMotion,
  animation: AnimationParams,
) {
  const group = instance.group;
  const pose = getReservoirPose(
    motion.params,
    motion.initialSize,
    instance.reservoirIndex,
    motion.instances.length,
    motion.runSeconds,
    animation,
  );
  instance.object.quaternion.identity();
  group.position.copy(pose.position);
  group.quaternion.setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    instance.reservoirYaw + pose.yawOffset,
  );
  group.rotateX(pose.pitch);
  group.rotateZ(pose.roll);
}

function applyCapturePose(instance: AnimatedPartInstance, motion: AnimatedPartMotion) {
  const ratio = THREE.MathUtils.clamp(instance.captureDistance / Math.max(1, motion.captureLength), 0, 1);
  const blend = smootherstep(ratio);
  const entryPose = getBowlMotionPose(motion.params, 0);
  const targetPosition = entryPose.position
    .clone()
    .setY(entryPose.position.y + motion.initialSize.y / 2);
  const chordLength = Math.max(20, instance.captureFromPosition.distanceTo(targetPosition));
  const tangentLength = chordLength * 0.34;
  const feedSign = motion.params.feedDirection === "clockwise" ? -1 : 1;
  const startRadial = instance.captureFromPosition.clone().setY(0);
  const startTangent = startRadial.lengthSq() > 0.001
    ? new THREE.Vector3(-startRadial.z * feedSign, 0, startRadial.x * feedSign).normalize()
    : entryPose.tangent.clone();
  const startHandle = startTangent.multiplyScalar(tangentLength);
  const endHandle = entryPose.tangent.clone().multiplyScalar(tangentLength);

  instance.object.quaternion.identity();
  instance.group.position.copy(getHermitePoint(
    instance.captureFromPosition,
    targetPosition,
    startHandle,
    endHandle,
    blend,
  ));
  const targetQuaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    instance.entryYaw,
  );
  instance.group.quaternion.copy(instance.captureFromQuaternion).slerp(targetQuaternion, blend);
}

function getHermitePoint(
  start: THREE.Vector3,
  end: THREE.Vector3,
  startTangent: THREE.Vector3,
  endTangent: THREE.Vector3,
  t: number,
) {
  const t2 = t * t;
  const t3 = t2 * t;
  return start.clone().multiplyScalar(2 * t3 - 3 * t2 + 1)
    .add(startTangent.clone().multiplyScalar(t3 - 2 * t2 + t))
    .add(end.clone().multiplyScalar(-2 * t3 + 3 * t2))
    .add(endTangent.clone().multiplyScalar(t3 - t2));
}

function applyPartPose(
  instance: AnimatedPartInstance,
  motion: AnimatedPartMotion,
  pose: ReturnType<typeof getBowlMotionPose>,
) {
  const group = instance.group;
  const faceGuideProgress = motion.faceGuideQuaternion ? pose.guideProgress : 0;
  const faceGuidedSize = getGuidedSizeAtProgress(motion, faceGuideProgress);
  const faceGuideProvidesRoll = motion.faceAxis ? isSideTopFace(motion.faceAxis) : false;
  const mechanismRoll = faceGuideProvidesRoll ? 0 : pose.guideRollAngle;
  const activeSize = getRolledSize(faceGuidedSize, motion.forwardAxis, mechanismRoll);
  const outletRollProgress = getOutletRollProgress(pose.outletProgress);

  applyFaceGuidePose(instance.object, motion.faceGuideQuaternion, faceGuideProgress);

  group.position.set(
    pose.position.x,
    pose.position.y + activeSize.y / 2,
    pose.position.z,
  );
  applyLaneBoundaryCorrection(group, motion, pose, activeSize);
  const travelQuaternion = getTravelQuaternion(pose.tangent, motion.forwardAxis);
  if (pose.entryProgress < 1) {
    const scatteredQuaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      instance.entryYaw,
    );
    group.quaternion.copy(scatteredQuaternion).slerp(
      travelQuaternion,
      smoothstep(THREE.MathUtils.clamp(pose.entryProgress, 0, 1)),
    );
  } else {
    group.quaternion.copy(travelQuaternion);
  }

  if (mechanismRoll !== 0) {
    if (motion.forwardAxis === "x") {
      group.rotateX(mechanismRoll);
    } else {
      group.rotateZ(mechanismRoll);
    }
  }

  const outletRoll = getOutletPoseRoll(motion.params, outletRollProgress);
  if (outletRoll !== 0) {
    if (motion.forwardAxis === "x") {
      group.rotateX(outletRoll);
    } else {
      group.rotateZ(outletRoll);
    }
  }
}

function applyLaneBoundaryCorrection(
  group: THREE.Group,
  motion: AnimatedPartMotion,
  pose: ReturnType<typeof getBowlMotionPose>,
  activeSize: THREE.Vector3,
) {
  const laneHalfWidth = Math.max(0, pose.laneWidth / 2);
  const partHalfWidth = getPartLaneWidth(activeSize, motion.forwardAxis) / 2;
  const availableCenterOffset = Math.max(0, laneHalfWidth - partHalfWidth - 1);
  const clampedOffset = THREE.MathUtils.clamp(
    pose.laneCenterOffset,
    -availableCenterOffset,
    availableCenterOffset,
  );
  const correction = clampedOffset - pose.laneCenterOffset;

  if (Math.abs(correction) > 0.001) {
    group.position.add(pose.sideAxis.clone().multiplyScalar(correction));
  }
}

function getPartLaneWidth(size: THREE.Vector3, forwardAxis: "x" | "z") {
  return forwardAxis === "x" ? size.z : size.x;
}

function applyFaceGuidePose(
  object: THREE.Object3D,
  targetQuaternion: THREE.Quaternion | null,
  guideProgress: number,
) {
  object.quaternion.identity();
  if (!targetQuaternion) return;

  object.quaternion.slerp(targetQuaternion, THREE.MathUtils.clamp(guideProgress, 0, 1));
}

function getGuidedSizeAtProgress(motion: AnimatedPartMotion, guideProgress: number) {
  const t = THREE.MathUtils.clamp(guideProgress, 0, 1);
  if (motion.faceAxis === "xPositive" || motion.faceAxis === "xNegative") {
    const angle = t * Math.PI * 0.5;
    const cosine = Math.abs(Math.cos(angle));
    const sine = Math.abs(Math.sin(angle));
    return new THREE.Vector3(
      motion.initialSize.x * cosine + motion.initialSize.y * sine,
      motion.initialSize.y * cosine + motion.initialSize.x * sine,
      motion.initialSize.z,
    );
  }

  if (motion.faceAxis === "zPositive" || motion.faceAxis === "zNegative") {
    const angle = t * Math.PI * 0.5;
    const cosine = Math.abs(Math.cos(angle));
    const sine = Math.abs(Math.sin(angle));
    return new THREE.Vector3(
      motion.initialSize.x,
      motion.initialSize.y * cosine + motion.initialSize.z * sine,
      motion.initialSize.z * cosine + motion.initialSize.y * sine,
    );
  }

  return new THREE.Vector3(
    THREE.MathUtils.lerp(motion.initialSize.x, motion.size.x, t),
    THREE.MathUtils.lerp(motion.initialSize.y, motion.size.y, t),
    THREE.MathUtils.lerp(motion.initialSize.z, motion.size.z, t),
  );
}

function getRolledSize(size: THREE.Vector3, forwardAxis: "x" | "z", angle: number) {
  if (Math.abs(angle) < 0.000001) return size;

  const cosine = Math.abs(Math.cos(angle));
  const sine = Math.abs(Math.sin(angle));
  if (forwardAxis === "x") {
    return new THREE.Vector3(
      size.x,
      size.y * cosine + size.z * sine,
      size.z * cosine + size.y * sine,
    );
  }

  return new THREE.Vector3(
    size.x * cosine + size.y * sine,
    size.y * cosine + size.x * sine,
    size.z,
  );
}

function getTravelQuaternion(tangent: THREE.Vector3, forwardAxis: "x" | "z") {
  const up = new THREE.Vector3(0, 1, 0);
  const forward = tangent.clone().setY(0);
  if (forward.lengthSq() < 0.000001) {
    forward.set(1, 0, 0);
  }
  forward.normalize();

  const matrix = new THREE.Matrix4();
  if (forwardAxis === "x") {
    const xAxis = forward;
    const zAxis = new THREE.Vector3().crossVectors(xAxis, up).normalize();
    matrix.makeBasis(xAxis, up, zAxis);
  } else {
    const zAxis = forward;
    const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize();
    matrix.makeBasis(xAxis, up, zAxis);
  }

  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function getScatteredBaseCount(totalCount: number) {
  return Math.max(1, Math.ceil(totalCount * 0.875));
}

function getPileLayer(index: number, totalCount: number) {
  return index < getScatteredBaseCount(totalCount) ? 0 : 1;
}

function getScatterBaseSlot(index: number, totalCount: number) {
  const baseCount = getScatteredBaseCount(totalCount);
  if (index < baseCount) return index;
  return (index * 5 + 3) % baseCount;
}

function getRoundScatterPoint(
  slot: number,
  count: number,
  minRadius: number,
  maxRadius: number,
) {
  const candidateCount = 14;
  const placed: Array<{ x: number; z: number }> = [];
  let selectedAngle = 0;
  let selectedRadius = minRadius;

  for (let pointIndex = 0; pointIndex <= slot; pointIndex += 1) {
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestAngle = 0;
    let bestRadius = minRadius;
    for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
      const sampleIndex = pointIndex * candidateCount + candidateIndex + count * 41;
      const angle = -Math.PI * 0.5 + seededNoise(sampleIndex, 137) * Math.PI * 2;
      const radialMix = 0.035 + seededNoise(sampleIndex, 149) * 0.93;
      const radius = Math.sqrt(THREE.MathUtils.lerp(
        minRadius * minRadius,
        maxRadius * maxRadius,
        radialMix,
      ));
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const minimumDistanceSq = placed.reduce((minimum, point) => (
        Math.min(minimum, (x - point.x) ** 2 + (z - point.z) ** 2)
      ), Number.POSITIVE_INFINITY);
      const irregularity = 0.84 + seededNoise(sampleIndex, 157) * 0.24;
      const score = placed.length === 0
        ? seededNoise(sampleIndex, 163)
        : minimumDistanceSq * irregularity;
      if (score > bestScore) {
        bestScore = score;
        bestAngle = angle;
        bestRadius = radius;
      }
    }

    selectedAngle = bestAngle;
    selectedRadius = bestRadius;
    placed.push({
      x: Math.cos(bestAngle) * bestRadius,
      z: Math.sin(bestAngle) * bestRadius,
    });
  }

  return { angle: selectedAngle, radius: selectedRadius };
}

function getReservoirPose(
  params: BowlParams,
  size: THREE.Vector3,
  index: number,
  totalCount: number,
  runSeconds: number,
  animation: AnimationParams,
) {
  const count = Math.max(1, totalCount);
  const baseCount = getScatteredBaseCount(count);
  const layer = getPileLayer(index, count);
  const baseSlot = getScatterBaseSlot(index, count);
  const halfDiagonal = Math.hypot(size.x, size.z) / 2;
  const minimumFootprint = Math.max(1, Math.min(size.x, size.z));
  const equivalentFootprint = Math.sqrt(Math.max(1, size.x * size.z));
  const feedSign = params.feedDirection === "clockwise" ? -1 : 1;
  const feedRate = getVibrationFeedRate(animation);
  const position = new THREE.Vector3();
  const radialAxis = new THREE.Vector3(0, 0, 1);
  const tangentAxis = new THREE.Vector3(1, 0, 0);
  let minCenterRadius = 0;
  let maxCenterRadius = Number.POSITIVE_INFINITY;
  let rectHalfX = Number.POSITIVE_INFINITY;
  let rectHalfZ = Number.POSITIVE_INFINITY;

  if (params.shape === "round") {
    const guideLayout = getOrientationGuideLayout(params);
    const hubRadius = Math.max(24, params.bowlDiameter * 0.08);
    const skirtRadius = Math.min(
      params.bowlDiameter * 0.2,
      Math.max(hubRadius * 1.38, hubRadius + guideLayout.entryPartSpan * 0.3),
    );
    const trackInnerRadius = params.bowlDiameter / 2 - params.wallThickness - params.trackWidth;
    const requestedMinRadius = skirtRadius + halfDiagonal + 2;
    const requestedMaxRadius = trackInnerRadius - halfDiagonal - 2;
    if (requestedMinRadius <= requestedMaxRadius) {
      minCenterRadius = requestedMinRadius;
      maxCenterRadius = requestedMaxRadius;
    } else {
      const fallbackRadius = Math.max(1, (skirtRadius + trackInnerRadius) / 2);
      minCenterRadius = fallbackRadius;
      maxCenterRadius = fallbackRadius;
    }
    const radialSpan = Math.max(0, maxCenterRadius - minCenterRadius);
    const scatterPoint = getRoundScatterPoint(
      baseSlot,
      baseCount,
      minCenterRadius,
      maxCenterRadius,
    );
    const angularSpeed = THREE.MathUtils.clamp(
      feedRate * 0.075 / Math.max(20, scatterPoint.radius),
      0,
      0.16,
    ) * THREE.MathUtils.lerp(0.88, 1.12, seededNoise(baseSlot, 167));
    const angularWander = animation.enabled
      ? Math.sin(runSeconds * 0.23 + seededNoise(baseSlot, 97) * Math.PI * 2)
        * 0.026
      : 0;
    let angle = scatterPoint.angle + feedSign * runSeconds * angularSpeed + angularWander;
    let radius = scatterPoint.radius;
    if (animation.enabled) {
      radius += Math.sin(
        runSeconds * (0.17 + seededNoise(baseSlot, 173) * 0.08)
          + seededNoise(baseSlot, 179) * Math.PI * 2,
      ) * radialSpan * 0.045;
    }
    if (layer === 1) {
      const overlapTangent = Math.min(
        equivalentFootprint * 0.18,
        equivalentFootprint * 0.24,
      );
      const overlapRadial = Math.min(radialSpan * 0.36, equivalentFootprint * 0.12);
      angle += (seededNoise(index, 109) - 0.5) * 2
        * overlapTangent / Math.max(20, scatterPoint.radius);
      radius += (seededNoise(index, 113) - 0.5) * 2 * overlapRadial;
    }
    radius = THREE.MathUtils.clamp(radius, minCenterRadius, maxCenterRadius);
    radialAxis.set(Math.cos(angle), 0, Math.sin(angle));
    tangentAxis.set(-Math.sin(angle) * feedSign, 0, Math.cos(angle) * feedSign);
    position.copy(radialAxis).multiplyScalar(radius);
  } else {
    rectHalfX = Math.max(1, params.bowlLength / 2 - params.wallThickness * 3 - size.x / 2 - 2);
    rectHalfZ = Math.max(1, params.bowlWidth / 2 - params.wallThickness * 3 - size.z / 2 - 2);
    const aspect = Math.max(0.25, params.bowlLength / Math.max(1, params.bowlWidth));
    const columns = Math.max(1, Math.ceil(Math.sqrt(baseCount * aspect)));
    const rows = Math.max(1, Math.ceil(baseCount / columns));
    const column = baseSlot % columns;
    const row = Math.floor(baseSlot / columns);
    const cellWidth = rectHalfX * 2 / columns;
    const cellDepth = rectHalfZ * 2 / rows;
    const baseX = -rectHalfX + (column + 0.5) * cellWidth
      + (seededNoise(baseSlot, 83) - 0.5) * cellWidth * 0.58;
    const baseZ = -rectHalfZ + (row + 0.5) * cellDepth
      + (seededNoise(baseSlot, 89) - 0.5) * cellDepth * 0.58;
    const travelSpan = rectHalfX * 2;
    const drift = feedSign * feedRate * runSeconds * 0.045;
    const wrappedX = travelSpan > 0.001
      ? ((baseX + drift + rectHalfX) % travelSpan + travelSpan) % travelSpan - rectHalfX
      : baseX;
    const overlapX = layer === 1
      ? (seededNoise(index, 109) - 0.5) * Math.min(cellWidth * 0.3, equivalentFootprint * 0.35)
      : 0;
    const overlapZ = layer === 1
      ? (seededNoise(index, 113) - 0.5) * Math.min(cellDepth * 0.3, equivalentFootprint * 0.35)
      : 0;
    position.set(
      THREE.MathUtils.clamp(wrappedX + overlapX, -rectHalfX, rectHalfX),
      0,
      THREE.MathUtils.clamp(baseZ + overlapZ, -rectHalfZ, rectHalfZ),
    );
    tangentAxis.set(feedSign, 0, 0);
    radialAxis.set(0, 0, 1);
  }

  const voltageRatio = THREE.MathUtils.clamp(animation.voltage / 220, 0, 1.35);
  const effectiveAmplitude = animation.enabled ? animation.amplitude * voltageRatio : 0;
  const cyclesPerSecond = THREE.MathUtils.clamp(
    (animation.frequency / 50) * animation.speed * 1.45,
    0.12,
    7,
  );
  const phase = runSeconds * Math.PI * 2 * cyclesPerSecond
    + seededNoise(index, 73) * Math.PI * 2;
  const jitter = Math.min(1.8, equivalentFootprint * 0.05, effectiveAmplitude * 0.3)
    * (1 + layer * 0.12);
  const tangentialJitter = jitter
    * (Math.sin(phase * 1.03) * 0.72 + Math.sin(phase * 2.31) * 0.28);
  const radialJitter = jitter
    * (Math.cos(phase * 0.91) * 0.65 + Math.cos(phase * 2.07) * 0.35);
  position.addScaledVector(tangentAxis, tangentialJitter);
  position.addScaledVector(radialAxis, radialJitter);

  if (params.shape === "round" && position.lengthSq() > 0.001) {
    position.setLength(THREE.MathUtils.clamp(position.length(), minCenterRadius, maxCenterRadius));
  } else if (params.shape !== "round") {
    position.x = THREE.MathUtils.clamp(position.x, -rectHalfX, rectHalfX);
    position.z = THREE.MathUtils.clamp(position.z, -rectHalfZ, rectHalfZ);
  }

  const supportLift = Math.min(1.1, Math.max(0.3, minimumFootprint * 0.02));
  const layerRise = Math.max(size.y * 0.94, minimumFootprint * 0.055);
  const verticalJump = Math.min(0.8, effectiveAmplitude * 0.11, size.y * 0.14)
    * Math.max(0, Math.sin(phase * 1.87));
  position.y = params.baseHeight
    + params.bottomThickness
    + size.y / 2
    + supportLift
    + layer * layerRise
    + verticalJump;

  const baseTiltLimit = layer === 0 ? 0.022 : 0.065;
  const vibrationTilt = Math.min(0.028, effectiveAmplitude * 0.008) * (1 + layer * 0.18);
  const pitch = (seededNoise(index, 101) - 0.5) * baseTiltLimit * 2
    + Math.sin(phase * 0.79) * vibrationTilt;
  const roll = (seededNoise(index, 107) - 0.5) * baseTiltLimit * 2
    + Math.cos(phase * 0.67) * vibrationTilt;
  const yawOffset = Math.sin(phase * 0.73) * Math.min(0.075, effectiveAmplitude * 0.018);

  return {
    pitch,
    position,
    roll,
    yawOffset,
  };
}

function getOutletRollProgress(outletProgress: number) {
  return smoothstep(THREE.MathUtils.clamp((outletProgress - 0.18) / 0.72, 0, 1));
}

function getOutletPoseRoll(params: BowlParams, rollProgress: number) {
  if (needsVerticalOrientationGuide(params)) return 0;

  if (params.outletOrientation === "backUp") {
    return Math.PI * rollProgress;
  }

  return 0;
}

function applyVibration(root: THREE.Group, animation: AnimationParams, elapsedSeconds: number) {
  if (!animation.enabled || animation.amplitude <= 0 || animation.frequency <= 0 || animation.speed <= 0) {
    resetMotion(root);
    return;
  }

  const voltageRatio = THREE.MathUtils.clamp(animation.voltage / 220, 0, 1.35);
  const cyclesPerSecond = THREE.MathUtils.clamp((animation.frequency / 50) * animation.speed * 1.45, 0.12, 7);
  const wave = elapsedSeconds * Math.PI * 2 * cyclesPerSecond;
  const amplitude = animation.amplitude * voltageRatio;

  root.position.set(
    Math.sin(wave) * amplitude * 0.55,
    Math.sin(wave * 2.08) * amplitude * 0.2,
    Math.cos(wave * 0.92) * amplitude * 0.42,
  );
  root.rotation.x = Math.cos(wave * 1.1) * amplitude * 0.00065;
  root.rotation.z = Math.sin(wave * 1.18) * amplitude * 0.00078;
}

function resetMotion(root: THREE.Group) {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
}

function disposeMotionRoot(root: THREE.Group, animatedGroup: THREE.Group | null) {
  root.children.forEach((child) => {
    const disposeGeometry = child !== animatedGroup;
    child.traverse((descendant) => {
      const mesh = descendant as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (disposeGeometry) mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material.dispose());
    });
  });
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function smootherstep(value: number) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function seededNoise(index: number, salt: number) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}
