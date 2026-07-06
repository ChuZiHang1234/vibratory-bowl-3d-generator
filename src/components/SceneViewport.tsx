import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { BowlParams } from "../types";
import { createVibratoryBowl } from "../geometry/vibratoryBowl";

interface SceneViewportProps {
  params: BowlParams;
  partObject: THREE.Object3D | null;
}

export function SceneViewport({ params, partObject }: SceneViewportProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    previewRoot: THREE.Group;
    frame: number;
  } | null>(null);

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
    scene.add(previewRoot);

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
      controls.update();
      renderer.render(scene, camera);
      const current = sceneRef.current;
      if (current) current.frame = requestAnimationFrame(animate);
    };

    sceneRef.current = { scene, renderer, camera, controls, previewRoot, frame: 0 };
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

    current.previewRoot.clear();
    const bowl = createVibratoryBowl(params);
    bowl.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    current.previewRoot.add(bowl);

    if (partObject) {
      const clone = partObject.clone(true);
      clone.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      const box = new THREE.Box3().setFromObject(clone);
      const size = box.getSize(new THREE.Vector3());
      const offset = params.shape === "round"
        ? params.bowlDiameter / 2 + Math.max(90, size.x / 2)
        : Math.max(params.bowlLength, params.bowlWidth) / 2 + Math.max(90, size.x / 2);
      clone.position.x -= offset;
      clone.position.y += params.baseHeight + params.bottomThickness + 3;
      current.previewRoot.add(clone);
    }

    const targetHeight = params.baseHeight + params.bowlHeight * 0.55;
    current.controls.target.set(0, targetHeight, 0);
    current.controls.update();
  }, [params, partObject]);

  return (
    <div className="viewport-shell">
      <div ref={mountRef} className="viewport-canvas" />
      <div className="viewport-hint">鼠标左键旋转 · 滚轮缩放 · 右键平移</div>
    </div>
  );
}
