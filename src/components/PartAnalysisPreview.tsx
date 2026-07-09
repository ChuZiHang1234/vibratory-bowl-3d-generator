import { useEffect, useRef } from "react";
import * as THREE from "three";

interface PartAnalysisPreviewProps {
  partObject: THREE.Object3D | null;
}

export function PartAnalysisPreview({ partObject }: PartAnalysisPreviewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    root: THREE.Group;
    frame: number;
  } | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf2f6f8);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 1600);
    camera.position.set(118, 82, 124);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mountRef.current.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xa9b3bd, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(90, 120, 80);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xbdd7ff, 0.85);
    fillLight.position.set(-80, 40, -70);
    scene.add(fillLight);

    const root = new THREE.Group();
    scene.add(root);

    const current = { scene, renderer, camera, root, frame: 0 };
    sceneRef.current = current;

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
      root.rotation.y += 0.006;
      renderer.render(scene, camera);
      current.frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(current.frame);
      observer.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const current = sceneRef.current;
    if (!current) return;

    current.root.clear();
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
    clone.scale.setScalar(34 / maxSize);
    current.root.add(clone);
    current.root.rotation.set(0.12, 0, 0);
    current.camera.position.set(118, 82, 124);
    current.camera.lookAt(0, 0, 0);
  }, [partObject]);

  return <div ref={mountRef} className="analysis-preview-canvas" />;
}
