import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PartFaceSelection, PartTopFace } from "../types";

interface PartFacePreviewProps {
  partObject: THREE.Object3D | null;
  selection: PartFaceSelection | null;
  onSelect: (selection: PartFaceSelection) => void;
}

interface PickerScene {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root: THREE.Group;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  highlight: THREE.Mesh | null;
  frame: number;
}

const FACE_LABELS: Record<PartTopFace, string> = {
  auto: "未选定",
  xPositive: "右侧面朝上",
  xNegative: "左侧面朝上",
  yPositive: "上表面朝上",
  yNegative: "底面朝上",
  zPositive: "前侧面朝上",
  zNegative: "后侧面朝上",
};

export function PartFacePreview({ partObject, selection, onSelect }: PartFacePreviewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);
  const sceneRef = useRef<PickerScene | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf6f8fa);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 1200);
    camera.position.set(88, 64, 94);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 34;
    controls.maxDistance = 260;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xa8b2bc, 2.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
    keyLight.position.set(90, 130, 80);
    scene.add(keyLight);

    const root = new THREE.Group();
    scene.add(root);

    const current: PickerScene = {
      scene,
      renderer,
      camera,
      controls,
      root,
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
      highlight: null,
      frame: 0,
    };
    sceneRef.current = current;

    const resize = () => {
      if (!mountRef.current) return;
      const { clientWidth, clientHeight } = mountRef.current;
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / Math.max(1, clientHeight);
      camera.updateProjectionMatrix();
    };

    const handlePointerDown = (event: PointerEvent) => {
      const activeScene = sceneRef.current;
      if (!activeScene) return;

      const rect = renderer.domElement.getBoundingClientRect();
      activeScene.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      activeScene.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      activeScene.raycaster.setFromCamera(activeScene.pointer, activeScene.camera);

      const meshes: THREE.Object3D[] = [];
      activeScene.root.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) meshes.push(child);
      });

      const [hit] = activeScene.raycaster.intersectObjects(meshes, false);
      if (!hit?.face) return;

      const normal = getWorldFaceNormal(hit);
      const face = classifyFaceNormal(normal);
      setHighlight(activeScene, hit, normal);
      onSelectRef.current({
        axis: face.axis,
        label: face.label,
        normal: [roundNormal(normal.x), roundNormal(normal.y), roundNormal(normal.z)],
      });
    };

    const observer = new ResizeObserver(resize);
    observer.observe(mountRef.current);
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    resize();

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      current.frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(current.frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const current = sceneRef.current;
    if (!current) return;

    current.root.clear();
    clearHighlight(current);

    if (!partObject) return;

    const clone = partObject.clone(true);
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });

    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z, 1);
    clone.position.sub(center);
    clone.scale.setScalar(58 / maxSize);
    current.root.add(clone);

    current.camera.position.set(88, 64, 94);
    current.controls.target.set(0, 0, 0);
    current.controls.update();
  }, [partObject]);

  useEffect(() => {
    if (!selection) clearHighlight(sceneRef.current);
  }, [selection]);

  return (
    <div className="part-face-picker" aria-label="零件朝上面选择预览">
      <div ref={mountRef} className="part-face-picker-canvas" />
      <div className="part-face-picker-status">
        {partObject ? selection?.label ?? "点击零件面" : "导入零件后选面"}
      </div>
    </div>
  );
}

export function createFaceSelectionFromAxis(axis: PartTopFace): PartFaceSelection | null {
  if (axis === "auto") return null;

  const normal = new THREE.Vector3();
  if (axis === "xPositive") normal.set(1, 0, 0);
  if (axis === "xNegative") normal.set(-1, 0, 0);
  if (axis === "yPositive") normal.set(0, 1, 0);
  if (axis === "yNegative") normal.set(0, -1, 0);
  if (axis === "zPositive") normal.set(0, 0, 1);
  if (axis === "zNegative") normal.set(0, 0, -1);

  return {
    axis,
    label: FACE_LABELS[axis],
    normal: [normal.x, normal.y, normal.z],
  };
}

export function getPartTopFaceLabel(axis: PartTopFace) {
  return FACE_LABELS[axis];
}

function getWorldFaceNormal(intersection: THREE.Intersection) {
  const mesh = intersection.object as THREE.Mesh;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  return intersection.face!.normal.clone().applyNormalMatrix(normalMatrix).normalize();
}

function classifyFaceNormal(normal: THREE.Vector3): { axis: PartTopFace; label: string } {
  const candidates: Array<{ axis: PartTopFace; value: number }> = [
    { axis: normal.x >= 0 ? "xPositive" : "xNegative", value: Math.abs(normal.x) },
    { axis: normal.y >= 0 ? "yPositive" : "yNegative", value: Math.abs(normal.y) },
    { axis: normal.z >= 0 ? "zPositive" : "zNegative", value: Math.abs(normal.z) },
  ];
  candidates.sort((a, b) => b.value - a.value);
  const axis = candidates[0].axis;
  return { axis, label: FACE_LABELS[axis] };
}

function setHighlight(scene: PickerScene, intersection: THREE.Intersection, normal: THREE.Vector3) {
  clearHighlight(scene);

  const mesh = intersection.object as THREE.Mesh<THREE.BufferGeometry>;
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  if (!position) return;

  const sourceBox = new THREE.Box3().setFromObject(scene.root);
  const maxSize = Math.max(...sourceBox.getSize(new THREE.Vector3()).toArray(), 1);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, intersection.point);
  const tolerance = Math.max(0.03, maxSize * 0.018);
  const offset = Math.max(0.02, maxSize * 0.006);
  const vertices: number[] = [];
  const index = geometry.getIndex();
  const triangleCount = index ? index.count / 3 : position.count / 3;

  const readVertex = (slot: number) => {
    const sourceIndex = index ? index.getX(slot) : slot;
    return new THREE.Vector3()
      .fromBufferAttribute(position, sourceIndex)
      .applyMatrix4(mesh.matrixWorld);
  };

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const base = triangle * 3;
    const a = readVertex(base);
    const b = readVertex(base + 1);
    const c = readVertex(base + 2);
    const triangleNormal = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
      .normalize();
    const center = new THREE.Vector3()
      .addVectors(a, b)
      .add(c)
      .multiplyScalar(1 / 3);

    if (triangleNormal.dot(normal) < 0.985 || Math.abs(plane.distanceToPoint(center)) > tolerance) {
      continue;
    }

    [a, b, c].forEach((point) => {
      const lifted = point.clone().addScaledVector(normal, offset);
      vertices.push(lifted.x, lifted.y, lifted.z);
    });
  }

  if (vertices.length === 0) return;

  const highlightGeometry = new THREE.BufferGeometry();
  highlightGeometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  highlightGeometry.computeVertexNormals();

  scene.highlight = new THREE.Mesh(
    highlightGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xff4545,
      depthTest: false,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.58,
    }),
  );
  scene.highlight.renderOrder = 10;
  scene.scene.add(scene.highlight);
}

function clearHighlight(scene: PickerScene | null) {
  if (!scene?.highlight) return;
  scene.highlight.geometry.dispose();
  if (Array.isArray(scene.highlight.material)) {
    scene.highlight.material.forEach((material) => material.dispose());
  } else {
    scene.highlight.material.dispose();
  }
  scene.highlight.removeFromParent();
  scene.highlight = null;
}

function roundNormal(value: number) {
  return Math.round(value * 10000) / 10000;
}
