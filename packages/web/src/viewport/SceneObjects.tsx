import { bboxCenter, bboxSize } from '@sponcam/core';
import { Edges, Grid, Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { usePlacement, useStockBox, useWcsPoint } from '@/state/selectors';
import { appStore, useApp } from '@/state/store';
import { fitDistance, sceneBounds, VIEW_DIRECTIONS } from './camera';
import { niceGridStep } from './convert';

/** The subset of OrbitControls this code uses (drei registers it as the default controls). */
export interface OrbitLike {
  target: THREE.Vector3;
  update(): void;
}

export const noRaycast = () => undefined;

export function BedGrid() {
  const units = useApp((s) => s.job.displayUnits);
  const [step, setStep] = useState(10);
  useFrame(({ camera, controls }) => {
    const target = (controls as unknown as OrbitLike | null)?.target;
    const distance = target ? camera.position.distanceTo(target) : camera.position.length();
    const next = niceGridStep(distance, units);
    if (next !== step) setStep(next);
  });
  return (
    <Grid
      rotation={[Math.PI / 2, 0, 0]} // drei's grid lies in XZ; rotate it onto the XY bed
      position={[0, 0, -0.01]}
      cellSize={step}
      sectionSize={step * 10}
      cellThickness={0.6}
      sectionThickness={1.1}
      cellColor="#34373e"
      sectionColor="#4b5059"
      infiniteGrid
      fadeDistance={step * 300}
      fadeStrength={1.5}
      followCamera={false}
    />
  );
}

export function StockBox() {
  const visible = useApp((s) => s.visibility.stock);
  const box = useStockBox();
  if (!visible || !box) return null;
  const size = bboxSize(box);
  const center = bboxCenter(box);
  return (
    <mesh position={[center.x, center.y, center.z]} raycast={noRaycast} renderOrder={1}>
      <boxGeometry args={[Math.max(size.x, 1e-3), Math.max(size.y, 1e-3), Math.max(size.z, 1e-3)]} />
      <meshStandardMaterial color="#c8a36a" transparent opacity={0.15} depthWrite={false} />
      <Edges color="#d6b27a" />
    </mesh>
  );
}

export function WcsTriad() {
  const point = useWcsPoint();
  const stock = useStockBox();
  const label = useApp((s) => s.job.wcs.workOffset);
  if (!point || !stock) return null;
  const size = bboxSize(stock);
  const length = Math.max(5, 0.2 * Math.max(size.x, size.y, size.z));
  return (
    <group position={[point.x, point.y, point.z]}>
      <axesHelper args={[length]} raycast={noRaycast} />
      <Html position={[0, 0, length * 0.25]} center className="pointer-events-none select-none rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">
        {label}
      </Html>
    </group>
  );
}

/** Reports the pointer's position on the Z = 0 plane to the status bar. */
export function CursorTracker() {
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  useEffect(() => {
    const raycaster = new THREE.Raycaster();
    const bed = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();
    const ndc = new THREE.Vector2();
    const { setCursor } = appStore.getState();
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      setCursor(raycaster.ray.intersectPlane(bed, hit) ? { x: hit.x, y: hit.y, z: 0 } : null);
    };
    const onLeave = () => setCursor(null);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, [camera, canvas]);
  return null;
}

/** Applies view requests (Fit / Top / Front / Right / Iso) from the store. */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const size = useThree((s) => s.size);
  const request = useApp((s) => s.viewRequest);
  const placement = usePlacement();
  const stock = useStockBox();

  useEffect(() => {
    if (request.nonce === 0 || !controls) return;
    const box = sceneBounds([placement?.bbox ?? null, stock]);
    const c = bboxCenter(box);
    const s = bboxSize(box);
    const center = new THREE.Vector3(c.x, c.y, c.z);
    const radius = Math.max(Math.hypot(s.x, s.y, s.z) / 2, 1);
    const direction = request.preset === 'fit'
      ? camera.position.clone().sub(controls.target).normalize()
      : new THREE.Vector3(...VIEW_DIRECTIONS[request.preset]).normalize();
    if (direction.lengthSq() === 0) direction.set(...VIEW_DIRECTIONS.iso).normalize();
    const distance = fitDistance(radius, camera.fov, size.width / Math.max(size.height, 1));
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.near = distance / 1000;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
    // Deliberately keyed on the request only: model or stock edits must not move the camera.
  }, [request.nonce]);

  return null;
}
