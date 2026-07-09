import { useEffect, useRef } from "react";
import { Box, Maximize2, MousePointer2, RotateCw, Ruler, ZoomIn } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { AnimationParams, BowlParams, PartFaceSelection } from "../types";
import {
  clampMotionDistance,
  getBowlMotionPathLength,
  getBowlMotionPose,
  getMotionConstraints,
  getVibrationFeedRate,
} from "../geometry/bowlMotion";
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
  constraints: ReturnType<typeof getMotionConstraints>;
  distance: number;
  faceGuideQuaternion: THREE.Quaternion | null;
  forwardAxis: "x" | "z";
  group: THREE.Group;
  initialSize: THREE.Vector3;
  instances: AnimatedPartInstance[];
  lastElapsed: number | null;
  params: BowlParams;
  size: THREE.Vector3;
}

interface AnimatedPartInstance {
  group: THREE.Group;
  object: THREE.Object3D;
  offsetDistance: number;
  pathIndex: number | null;
  reservoirIndex: number | null;
  reservoirRoll: number;
  reservoirYaw: number;
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
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;
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

  const setCameraView = (view: "iso" | "top" | "side") => {
    const current = sceneRef.current;
    if (!current) return;

    const target = current.controls.target.clone();
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
      <div className="viewport-hint">鼠标左键旋转 · 滚轮缩放 · 右键平移</div>
    </div>
  );
}

function getFaceUprightQuaternion(selection: PartFaceSelection) {
  const normal = new THREE.Vector3(...selection.normal).normalize();
  if (normal.lengthSq() < 0.000001) return null;

  return new THREE.Quaternion().setFromUnitVectors(normal, new THREE.Vector3(0, 1, 0));
}

function createAnimatedPartMotion(
  partObject: THREE.Object3D,
  selectedFace: PartFaceSelection | null,
  params: BowlParams,
  partCount: number,
): AnimatedPartMotion {
  const faceGuideQuaternion = selectedFace ? getFaceUprightQuaternion(selectedFace) : null;
  const initialSample = createCenteredPartClone(partObject);
  const initialBox = new THREE.Box3().setFromObject(initialSample);
  const initialSize = initialBox.getSize(new THREE.Vector3());
  const guidedSample = createGuidedPartSample(partObject, faceGuideQuaternion);
  const box = new THREE.Box3().setFromObject(guidedSample);
  const size = box.getSize(new THREE.Vector3());
  const forwardAxis = size.x >= size.z ? "x" : "z";
  const envelope = getPhysicalEnvelope(size, forwardAxis);
  const constraints = getMotionConstraints(params, envelope);
  const group = new THREE.Group();
  const count = THREE.MathUtils.clamp(Math.round(partCount), 1, 12);
  const pathLength = getBowlMotionPathLength(params);
  const canCompletePath = canCompleteMotionPath(constraints);
  const availablePathLength = canCompletePath ? pathLength : constraints.maxDistance;
  const pathCapacity = constraints.canEnterTrack
    ? Math.max(1, Math.floor(availablePathLength / constraints.minimumSpacing) + 1)
    : 0;
  const pathCount = Math.min(count, pathCapacity);
  const spacing = pathCount > 0
    ? canCompletePath
      ? Math.max(pathLength / pathCount, constraints.minimumSpacing)
      : constraints.minimumSpacing
    : constraints.minimumSpacing;
  const instances: AnimatedPartInstance[] = [];

  const firstObject = createCenteredPartClone(partObject);
  firstObject.name = "送料动画零件-1";
  const firstCarrier = createPartCarrier(firstObject, 0, pathCount > 0 ? 0 : null, pathCount > 0 ? null : 0);
  instances.push(firstCarrier);
  group.add(firstCarrier.group);

  for (let index = 1; index < count; index += 1) {
    const onPath = index < pathCount;
    const clone = createCenteredPartClone(partObject);
    clone.name = `送料动画零件-${index + 1}`;
    const reservoirIndex = onPath ? null : index - pathCount;
    const carrier = createPartCarrier(clone, spacing * index, onPath ? index : null, reservoirIndex);
    instances.push(carrier);
    group.add(carrier.group);
  }

  group.name = "送料动画零件组";

  return {
    constraints,
    distance: 0,
    faceGuideQuaternion,
    forwardAxis,
    group,
    initialSize,
    instances,
    lastElapsed: null,
    params,
    size,
  };
}

function createCenteredPartClone(partObject: THREE.Object3D) {
  const clone = partObject.clone(true);
  clone.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  centerObjectAtOrigin(clone);
  return clone;
}

function createGuidedPartSample(partObject: THREE.Object3D, faceGuideQuaternion: THREE.Quaternion | null) {
  const clone = createCenteredPartClone(partObject);
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
  offsetDistance: number,
  pathIndex: number | null,
  reservoirIndex: number | null,
): AnimatedPartInstance {
  const group = new THREE.Group();
  group.add(partObject);
  return {
    group,
    object: partObject,
    offsetDistance,
    pathIndex,
    reservoirIndex,
    reservoirRoll: reservoirIndex === null ? 0 : seededNoise(reservoirIndex, 13) * Math.PI * 1.35,
    reservoirYaw: reservoirIndex === null ? 0 : seededNoise(reservoirIndex, 31) * Math.PI * 2,
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
    motion.distance = 0;
    motion.lastElapsed = null;
    updatePartInstances(motion);
    return;
  }

  if (motion.lastElapsed === null) {
    motion.lastElapsed = elapsedSeconds;
  }

  const deltaSeconds = Math.max(0, elapsedSeconds - motion.lastElapsed);
  motion.distance += deltaSeconds * feedRate;
  motion.lastElapsed = elapsedSeconds;
  updatePartInstances(motion);
}

function updatePartInstances(motion: AnimatedPartMotion) {
  const canCompletePath = canCompleteMotionPath(motion.constraints);

  motion.instances.forEach((instance) => {
    if (instance.pathIndex === null) {
      applyReservoirPose(instance, motion);
      return;
    }

    const desiredDistance = canCompletePath
      ? motion.distance + instance.offsetDistance
      : motion.constraints.maxDistance - instance.pathIndex * motion.constraints.minimumSpacing;
    const physicalDistance = clampMotionDistance(desiredDistance, motion.constraints);
    const pose = getBowlMotionPose(motion.params, physicalDistance);
    applyPartPose(instance, motion, pose);
  });
}

function canCompleteMotionPath(constraints: ReturnType<typeof getMotionConstraints>) {
  return constraints.canEnterTrack && constraints.canPassGuide && constraints.canExit;
}

function applyReservoirPose(instance: AnimatedPartInstance, motion: AnimatedPartMotion) {
  const group = instance.group;
  const index = instance.reservoirIndex ?? 0;
  const pose = getReservoirPose(motion.params, motion.size, index);
  instance.object.quaternion.identity();
  group.position.copy(pose.position);
  group.quaternion.copy(getTravelQuaternion(pose.tangent, motion.forwardAxis));
  group.rotateY(instance.reservoirYaw);
  group.rotateX(instance.reservoirRoll);
}

function applyPartPose(
  instance: AnimatedPartInstance,
  motion: AnimatedPartMotion,
  pose: ReturnType<typeof getBowlMotionPose>,
) {
  const group = instance.group;
  const faceGuideProgress = motion.faceGuideQuaternion ? pose.guideProgress : 0;
  const activeSize = getGuidedSizeAtProgress(motion, faceGuideProgress);
  const outletRollProgress = getOutletRollProgress(pose.outletProgress);
  const verticalLift = getOutletPoseLift(motion.params, activeSize, motion.forwardAxis, outletRollProgress);

  applyFaceGuidePose(instance.object, motion.faceGuideQuaternion, faceGuideProgress);

  group.position.set(
    pose.position.x,
    pose.position.y + activeSize.y / 2 + verticalLift,
    pose.position.z,
  );
  applyLaneBoundaryCorrection(group, motion, pose, activeSize);
  group.quaternion.copy(getTravelQuaternion(pose.tangent, motion.forwardAxis));

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

  object.quaternion.slerp(targetQuaternion, smoothstep(THREE.MathUtils.clamp(guideProgress, 0, 1)));
}

function getGuidedSizeAtProgress(motion: AnimatedPartMotion, guideProgress: number) {
  const t = smoothstep(THREE.MathUtils.clamp(guideProgress, 0, 1));
  return new THREE.Vector3(
    THREE.MathUtils.lerp(motion.initialSize.x, motion.size.x, t),
    THREE.MathUtils.lerp(motion.initialSize.y, motion.size.y, t),
    THREE.MathUtils.lerp(motion.initialSize.z, motion.size.z, t),
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

function getReservoirPose(params: BowlParams, size: THREE.Vector3, index: number) {
  const columns = 3;
  const row = Math.floor(index / columns);
  const column = index % columns;
  const spacingX = Math.max(size.x + 8, params.trackWidth * 0.72);
  const spacingZ = Math.max(size.z + 8, params.trackWidth * 0.72);
  const radius = params.shape === "round"
    ? Math.max(20, params.bowlDiameter / 2 - params.trackWidth - params.wallThickness * 4)
    : Math.max(20, Math.min(params.bowlLength, params.bowlWidth) / 2 - params.wallThickness * 4);
  const x = THREE.MathUtils.clamp(
    (column - 1) * spacingX,
    -radius + size.x / 2,
    radius - size.x / 2,
  );
  const z = THREE.MathUtils.clamp(
    -radius * 0.35 - row * spacingZ,
    -radius + size.z / 2,
    radius - size.z / 2,
  );
  const y = params.baseHeight + params.bottomThickness + size.y / 2 + 3;

  return {
    position: new THREE.Vector3(x, y, z),
    tangent: new THREE.Vector3(1, 0, 0),
  };
}

function getOutletRollProgress(outletProgress: number) {
  return smoothstep(THREE.MathUtils.clamp((outletProgress - 0.18) / 0.72, 0, 1));
}

function getOutletPoseRoll(params: BowlParams, rollProgress: number) {
  if (params.outletOrientation === "backUp") {
    return Math.PI * rollProgress;
  }

  if (params.outletOrientation === "sideUp" || params.outletOrientation === "standing") {
    return Math.PI * 0.5 * rollProgress;
  }

  return 0;
}

function getOutletPoseLift(
  params: BowlParams,
  size: THREE.Vector3,
  forwardAxis: "x" | "z",
  rollProgress: number,
) {
  if (params.outletOrientation !== "sideUp" && params.outletOrientation !== "standing") {
    return 0;
  }

  const sideHalfHeight = forwardAxis === "x" ? size.z / 2 : size.x / 2;
  const standingHalfHeight = Math.max(size.x, size.z) / 2;
  const targetHalfHeight = params.outletOrientation === "standing" ? standingHalfHeight : sideHalfHeight;
  return Math.max(0, targetHalfHeight - size.y / 2) * rollProgress;
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

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function seededNoise(index: number, salt: number) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}
