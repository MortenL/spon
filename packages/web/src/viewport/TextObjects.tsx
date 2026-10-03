import { programOrigin, type TextSummary } from '@sponcam/core';
import { Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { updateText } from '@/state/texts';
import { appStore, useApp } from '@/state/store';
import { type DragState, distanceToLoops, dragBegin, dragStep, dragStillValid, loopsBox, nearBox, planeHit, type Box2 } from './textDrag';
import { noRaycast, type OrbitLike } from './SceneObjects';

const NORMAL_COLOR = '#e7e5e4';
const HOVER_COLOR = '#fcd34d';
const SELECTED_COLOR = '#f59e0b';
const PICK_MM = 1.5; // line pick threshold, grown to at least PICK_PX on screen
const PICK_PX = 5;
const MIN_MOVE_MM = 0.5;
const CLICK_PX = 4;

type Point3 = readonly [number, number, number];

/** Texts from the last generation, drawn at their surface; click selects, dragging the selected one moves it. */
export function TextObjects() {
  const job = useApp((s) => s.job);
  const geometry = useApp((s) => s.geometry);
  const camTexts = useApp((s) => s.camTexts);
  const selectedTextId = useApp((s) => s.selectedTextId);
  const playing = useApp((s) => s.playing);
  const origin = useMemo(() => programOrigin(job, geometry), [job, geometry]);
  const { gl, camera, controls } = useThree();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const live = useRef({ camTexts, origin, selectedTextId, playing, hoverId });
  live.current = { camTexts, origin, selectedTextId, playing, hoverId };

  useEffect(() => {
    const el = gl.domElement;
    const orbit = () => controls as unknown as OrbitLike | null;
    const raycaster = new THREE.Raycaster();
    const boxes = new WeakMap<TextSummary, Box2>();
    let down: { x: number; y: number; id: string | null } | null = null;

    const rayAt = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      const { origin: o, direction: d } = raycaster.ray;
      return { origin: { x: o.x, y: o.y, z: o.z }, direction: { x: d.x, y: d.y, z: d.z } };
    };
    /** The text whose lines are nearest the pointer, within the pick threshold; point is in scene coordinates. */
    const hitText = (e: PointerEvent): { id: string; z: number; point: { x: number; y: number } } | null => {
      const { camTexts: texts, origin: org } = live.current;
      const ray = rayAt(e);
      const rect = el.getBoundingClientRect();
      let best: { id: string; z: number; point: { x: number; y: number } } | null = null;
      let bestD = Infinity;
      for (const t of texts) {
        if (t.z === null) continue;
        const z = t.z + org.z;
        const hit = planeHit(ray, z);
        if (!hit) continue;
        const p = { x: hit.x - org.x, y: hit.y - org.y };
        // world size of one pixel at the hit, so the threshold stays usable when zoomed out
        const perPx = camera instanceof THREE.PerspectiveCamera
          ? (2 * camera.position.distanceTo(new THREE.Vector3(hit.x, hit.y, hit.z)) * Math.tan((camera.fov * Math.PI) / 360)) / rect.height
          : 1 / Math.max((camera as THREE.OrthographicCamera).zoom, 1e-6);
        const threshold = Math.max(PICK_MM, PICK_PX * perPx);
        let box = boxes.get(t);
        if (!box) boxes.set(t, (box = loopsBox(t.loops)));
        if (!nearBox(box, p, threshold)) continue;
        const d = distanceToLoops(t.loops, p);
        if (d <= threshold && d < bestD) { bestD = d; best = { id: t.textId, z, point: { x: hit.x, y: hit.y } }; }
      }
      return best;
    };
    const picking = () => {
      const s = appStore.getState();
      return s.pickMode !== 'none' || s.camPick !== null || s.textPick !== null;
    };
    const apply = (step: ReturnType<typeof dragStep>) => {
      dragRef.current = step.state;
      setDrag(step.state);
      const o = orbit();
      if (o) o.enabled = step.orbitEnabled;
    };
    const releaseCapture = (id: number) => {
      try { if (el.hasPointerCapture(id)) el.releasePointerCapture(id); } catch { /* already released */ }
    };
    const cancel = () => {
      down = null;
      apply(dragStep(dragRef.current, { type: 'cancel' }, MIN_MOVE_MM));
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || picking() || live.current.playing) return;
      const hit = hitText(e);
      down = { x: e.clientX, y: e.clientY, id: hit?.id ?? null };
      const item = hit && hit.id === live.current.selectedTextId ? appStore.getState().job.texts.find((t) => t.id === hit.id) : null;
      if (hit && item) {
        try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        apply(dragBegin(hit.id, { x: item.position.x, y: item.position.y }, hit.point, hit.z));
      }
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d) {
        const s = appStore.getState();
        if (!dragStillValid(d, s.job.texts.map((t) => t.id), s.selectedTextId)) {
          releaseCapture(e.pointerId);
          cancel();
          return;
        }
        const hit = planeHit(rayAt(e), d.z);
        apply(dragStep(d, { type: 'move', hit }, MIN_MOVE_MM));
        return;
      }
      if (e.buttons !== 0 || picking() || live.current.playing) {
        if (live.current.hoverId !== null) setHoverId(null);
        return;
      }
      const id = hitText(e)?.id ?? null;
      if (id !== live.current.hoverId) setHoverId(id);
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      const was = down;
      down = null;
      if (d) {
        releaseCapture(e.pointerId);
        const s = appStore.getState();
        const valid = dragStillValid(d, s.job.texts.map((t) => t.id), s.selectedTextId);
        const step = dragStep(d, valid ? { type: 'up', hit: planeHit(rayAt(e), d.z) } : { type: 'cancel' }, MIN_MOVE_MM);
        apply(step);
        if (step.commit) updateText(d.id, { position: step.commit });
        return;
      }
      if (!was || was.id === null || picking() || live.current.playing) return;
      if (Math.hypot(e.clientX - was.x, e.clientY - was.y) > CLICK_PX) return;
      appStore.getState().selectText(was.id);
    };
    const onCancel = (e: PointerEvent) => {
      releaseCapture(e.pointerId);
      cancel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    el.addEventListener('pointerdown', onDown, { capture: true });
    el.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown, { capture: true });
      el.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', onKey);
      const o = orbit();
      if (o) o.enabled = true;
    };
  }, [gl, camera, controls]);

  if (playing) return null;
  return (
    <group position={[origin.x, origin.y, origin.z]}>
      {camTexts.map((t) => {
        const shift = drag && drag.id === t.textId ? drag.offset : null;
        const color = t.textId === selectedTextId ? SELECTED_COLOR : t.textId === hoverId ? HOVER_COLOR : NORMAL_COLOR;
        return <TextLines key={t.textId} summary={t} color={color} dx={shift?.x ?? 0} dy={shift?.y ?? 0} />;
      })}
    </group>
  );
}

function TextLines({ summary, color, dx, dy }: { summary: TextSummary; color: string; dx: number; dy: number }) {
  const z = summary.z;
  const loops = useMemo(
    () => (z === null ? [] : summary.loops.filter((l) => l.points.length >= 2).map((l) => {
      const pts = l.points.map((p): Point3 => [p.x, p.y, z]);
      if (l.closed) pts.push(pts[0]);
      return pts;
    })),
    [summary.loops, z],
  );
  if (z === null) return null;
  return (
    <group name="text-object" position={[dx, dy, 0]} userData={{ textId: summary.textId }}>
      {loops.map((pts, i) => <Line key={i} points={pts as Point3[]} color={color} lineWidth={2} raycast={noRaycast} />)}
    </group>
  );
}
