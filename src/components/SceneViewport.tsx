import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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
  forwardAxis: "x" | "z";
  group: THREE.Group;
  instances: AnimatedPartInstance[];
  lastElapsed: number | null;
  params: BowlParams;
  size: THREE.Vector3;
}

interface AnimatedPartInstance {
  group: THREE.Group;
  offsetDistance: number;
  pathIndex: number | null;
  reservoirIndex: number | null;
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
    scene.background = new THREE.Color(0xe9edf1);

    const camera = new THREE.PerspectiveCamera(42, 1, 1, 12000);
    camera.position.set(720, 470, 780);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 120, 0);
    controls.maxDistance = 9000;
    controls.minDistance = 40;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xa9b1ba, 2.6));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(400, 700, 300);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xbdd7ff, 1.2);
    fillLight.position.set(-420, 320, -360);
    scene.add(fillLight);

    const grid = new THREE.GridHelper(2400, 24, 0x9aa4ae, 0xc6ccd3);
    grid.position.y = -0.5;
    scene.add(grid);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(5000, 5000),
      new THREE.ShadowMaterial({ color: 0x83909b, opacity: 0.16 }),
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

  return (
    <div className="viewport-shell">
      <div ref={mountRef} className="viewport-canvas" />
      <PartFacePreview
        partObject={partObject}
        selection={selectedFace}
        onSelect={onFaceSelected}
      />
      <div className="viewport-hint">鼠标左键旋转 · 滚轮缩放 · 右键平移</div>
    </div>
  );
}

function orientPartFaceToUp(object: THREE.Object3D, selection: PartFaceSelection) {
  const normal = new THREE.Vector3(...selection.normal).normalize();
  if (normal.lengthSq() < 0.000001) return;

  const quaternion = new THREE.Quaternion().setFromUnitVectors(normal, new THREE.Vector3(0, 1, 0));
  object.applyQuaternion(quaternion);
  object.updateMatrixWorld(true);
}

function createAnimatedPartMotion(
  partObject: THREE.Object3D,
  selectedFace: PartFaceSelection | null,
  params: BowlParams,
  partCount: number,
): AnimatedPartMotion {
  const sample = createCenteredPartClone(partObject, selectedFace);
  const box = new THREE.Box3().setFromObject(sample);
  const size = box.getSize(new THREE.Vector3());
  const forwardAxis = size.x >= size.z ? "x" : "z";
  const envelope = getPhysicalEnvelope(size, forwardAxis);
  const constraints = getMotionConstraints(params, envelope);
  const group = new THREE.Group();
  const count = THREE.MathUtils.clamp(Math.round(partCount), 1, 12);
  const pathLength = getBowlMotionPathLength(params);
  const availablePathLength = constraints.canExit ? pathLength : constraints.maxDistance;
  const pathCapacity = constraints.canEnterTrack
    ? Math.max(1, Math.floor(availablePathLength / constraints.minimumSpacing) + 1)
    : 0;
  const pathCount = Math.min(count, pathCapacity);
  const spacing = pathCount > 0
    ? constraints.canExit
      ? Math.max(pathLength / pathCount, constraints.minimumSpacing)
      : constraints.minimumSpacing
    : constraints.minimumSpacing;
  const instances: AnimatedPartInstance[] = [];

  sample.name = "送料动画零件-1";
  const firstCarrier = createPartCarrier(sample, 0, pathCount > 0 ? 0 : null, pathCount > 0 ? null : 0);
  instances.push(firstCarrier);
  group.add(firstCarrier.group);

  for (let index = 1; index < count; index += 1) {
    const clone = createCenteredPartClone(partObject, selectedFace);
    clone.name = `送料动画零件-${index + 1}`;
    const onPath = index < pathCount;
    const reservoirIndex = onPath ? null : index - pathCount;
    const carrier = createPartCarrier(clone, spacing * index, onPath ? index : null, reservoirIndex);
    instances.push(carrier);
    group.add(carrier.group);
  }

  group.name = "送料动画零件组";

  return {
    constraints,
    distance: 0,
    forwardAxis,
    group,
    instances,
    lastElapsed: null,
    params,
    size,
  };
}

function createCenteredPartClone(partObject: THREE.Object3D, selectedFace: PartFaceSelection | null) {
  const clone = partObject.clone(true);
  clone.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  if (selectedFace) {
    orientPartFaceToUp(clone, selectedFace);
  }

  clone.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(clone);
  const center = box.getCenter(new THREE.Vector3());
  clone.position.sub(center);
  clone.updateMatrixWorld(true);
  return clone;
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
    offsetDistance,
    pathIndex,
    reservoirIndex,
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
  motion.instances.forEach((instance) => {
    if (instance.pathIndex === null) {
      applyReservoirPose(instance.group, motion, instance.reservoirIndex ?? 0);
      return;
    }

    const desiredDistance = motion.constraints.canExit
      ? motion.distance + instance.offsetDistance
      : motion.constraints.maxDistance - instance.pathIndex * motion.constraints.minimumSpacing;
    const physicalDistance = clampMotionDistance(desiredDistance, motion.constraints);
    const pose = getBowlMotionPose(motion.params, physicalDistance);
    applyPartPose(instance.group, motion, pose);
  });
}

function applyReservoirPose(group: THREE.Group, motion: AnimatedPartMotion, index: number) {
  const pose = getReservoirPose(motion.params, motion.size, index);
  group.position.copy(pose.position);
  group.quaternion.copy(getTravelQuaternion(pose.tangent, motion.forwardAxis));
}

function applyPartPose(
  group: THREE.Group,
  motion: AnimatedPartMotion,
  pose: ReturnType<typeof getBowlMotionPose>,
) {
  const outletRollProgress = getOutletRollProgress(pose.outletProgress);
  const verticalLift = getOutletPoseLift(motion.params, motion.size, motion.forwardAxis, outletRollProgress);

  group.position.set(
    pose.position.x,
    pose.position.y + motion.size.y / 2 + verticalLift,
    pose.position.z,
  );
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
