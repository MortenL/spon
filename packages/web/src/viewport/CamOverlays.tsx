import {
  camContext, type CamContext, type DxfPathRef, drawingPath, drawingPathToProgram, flattenPath, type GeometryRef,
  HEIGHT_NAMES, type HeightName, type Job, meshSlots, offsetOpenPath, pathLength, pointAt, type Operation, type OpOverlays, type Path2D, type ResolvedHeights,
  programContext, programOrigin, resolveFaceRef, type Vec2, type Vec3,
} from '@sponcam/core';
import { Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { runCommand } from '@/state/camView';
import { type ModelGeometry, useApp } from '@/state/store';
import { sameRef } from '@/inspector/geometryLabels';
import { chamferRunsAsDrawn, openChains } from '@/inspector/openChains';
import { regionShape } from './convert';
import { noRaycast } from './SceneObjects';

const PICK_COLOR = '#f59e0b';
const UNMACHINED_COLOR = '#ef4444';
const TAB_RADIUS = 1.5;
/** Colours match the Heights tab's own swatches (packages/web/src/inspector/HeightsTab.tsx). */
const HEIGHT_COLOR: Record<HeightName, string> = { clearance: '#f97316', retract: '#84cc16', feed: '#22c55e', top: '#38bdf8', bottom: '#1d4ed8' };

type Point3 = readonly [number, number, number];

export function CamOverlays() {
  const job = useApp((s) => s.job);
  const geometry = useApp((s) => s.geometry);
  const selectedOperationId = useApp((s) => s.selectedOperationId);
  const camResults = useApp((s) => s.camResults);
  const inspectorTab = useApp((s) => s.inspectorTab);
  const origin = useMemo(() => programOrigin(job, geometry), [job, geometry]);

  const op = job.operations.find((o) => o.id === selectedOperationId) ?? null;
  if (!op) return null;
  const summary = camResults[op.id] ?? null;

  return (
    <group position={[origin.x, origin.y, origin.z]}>
      <PickedGeometry job={job} geometry={geometry} op={op} />
      {(op.type === 'profile' || op.type === 'chamfer' || op.type === 'slot') && <OpenChainArrows job={job} geometry={geometry} op={op} />}
      {inspectorTab === 'heights' && summary?.heights && <HeightsPlanes job={job} geometry={geometry} heights={summary.heights} />}
      {op.type === 'profile' && summary && <TabHandles op={op} overlays={summary.overlays} origin={origin} />}
      {summary && <UnmachinedAreas overlays={summary.overlays} />}
      {summary && <GougeMarkers overlays={summary.overlays} />}
    </group>
  );
}

// ── picked geometry highlight ───────────────────────────────────────────

function PickedGeometry({ job, geometry, op }: { job: Job; geometry: ModelGeometry | null; op: Operation }) {
  const ctx = useMemo(() => camContext(job, geometry), [job, geometry]);
  const loops = useMemo(
    () => op.geometry.flatMap((ref, i) => refLoops(ctx, ref).map((points, j) => ({ key: `${i}-${j}`, points }))).filter((l) => l.points.length >= 2),
    [ctx, op.geometry],
  );
  // every recognised slot, faintly, while a slot operation is open on a model
  const pickable = useMemo(
    () => op.type === 'slot' && geometry?.kind === 'mesh'
      ? meshSlots(ctx).filter((s) => !op.geometry.some((r) => sameRef(r, s.ref))).map((s, i) => ({ key: `p${i}`, points: outlinePoints(s.outline, s.top) }))
      : [],
    [ctx, op.type, op.geometry, geometry],
  );
  return (
    <>
      {pickable.map((l) => (
        <Line key={l.key} name="slot-pickable" points={l.points as Point3[]} color={PICK_COLOR} lineWidth={2} transparent opacity={0.4} raycast={noRaycast} />
      ))}
      {loops.map((l) => (
        <Line key={l.key} points={l.points as Point3[]} color={PICK_COLOR} lineWidth={3} raycast={noRaycast} />
      ))}
    </>
  );
}

const ARROW_TIP = 2;
const ARROW_BACK = 2;
const ARROW_SIDE = 1.2;

/** Direction arrows (and a dashed preview of the side cut) for the open lines of a profile. */
function OpenChainArrows({ job, geometry, op }: { job: Job; geometry: ModelGeometry | null; op: Operation }) {
  const profile = op.type === 'profile' ? op : null;
  const openSide = op.type === 'chamfer' ? 'on' : profile?.openSide ?? 'on'; // chamfer: arrow only, no side preview
  const stockRadial = profile?.stockRadial ?? 0;
  const finishPass = profile?.finishPass ?? false;
  // a chamfer may cut against the drawn direction
  const flip = op.type === 'chamfer' && !chamferRunsAsDrawn(op.openSide, op.direction);
  const toolDiameter = job.tools.find((t) => t.id === op.toolId)?.diameter ?? null;
  // only what the preview depends on: unrelated job edits do not recompute the offsets
  const items = useMemo(
    () => {
      const ctx = camContext(job, geometry);
      const dashed = (c: { path: Path2D; z: number }, radius: number) =>
        (offsetOpenPath(c.path, openSide as 'left' | 'right', radius, 0.05)?.paths ?? []).map((p) => flattenPath(p, 0.05).map((q): Point3 => [q.x, q.y, c.z]));
      return openChains(op, ctx).map((c) => {
        const at = pointAt(c.path, pathLength(c.path) / 2);
        const point = at.point;
        const tangent = flip ? { x: -at.tangent.x, y: -at.tangent.y } : at.tangent;
        const nx = -tangent.y, ny = tangent.x;
        const bx = point.x - tangent.x * ARROW_BACK, by = point.y - tangent.y * ARROW_BACK;
        const arrow: Point3[] = [
          [bx + nx * ARROW_SIDE, by + ny * ARROW_SIDE, c.z],
          [point.x + tangent.x * ARROW_TIP, point.y + tangent.y * ARROW_TIP, c.z],
          [bx - nx * ARROW_SIDE, by - ny * ARROW_SIDE, c.z],
        ];
        const r = (toolDiameter ?? 0) / 2;
        const active = openSide !== 'on' && toolDiameter !== null;
        const offsets = active ? dashed(c, r + stockRadial) : [];
        const finish = active && finishPass && stockRadial > 0 ? dashed(c, r) : [];
        return { ref: c.ref, arrow, offsets, finish };
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [op.geometry, openSide, flip, stockRadial, finishPass, toolDiameter, job.model, job.stock, job.wcs, job.tolerance, geometry],
  );
  return (
    <>
      {items.map((it) => (
        <group key={it.ref}>
          <Line name="open-chain-arrow" points={it.arrow} color={PICK_COLOR} lineWidth={3} raycast={noRaycast} />
          {it.offsets.filter((pts) => pts.length >= 2).map((pts, i) => (
            <Line key={i} points={pts} color={PICK_COLOR} lineWidth={1} dashed dashSize={1} gapSize={0.6} raycast={noRaycast} />
          ))}
          {it.finish.filter((pts) => pts.length >= 2).map((pts, i) => (
            <Line key={`f${i}`} points={pts} color={PICK_COLOR} lineWidth={1} dashed dashSize={1} gapSize={0.6} transparent opacity={0.4} raycast={noRaycast} />
          ))}
        </group>
      ))}
    </>
  );
}

/** Polylines (program coordinates) for one picked reference, following spec §8's picked-geometry conventions. */
function refLoops(ctx: CamContext, ref: GeometryRef): Point3[][] {
  if (ref.kind === 'text') return []; // texts are drawn from the pipeline result (Task 6)
  if (ref.kind === 'dxfPath') return [dxfPathPoints(ctx, ref)].filter((p): p is Point3[] => p !== null);
  if (ref.kind === 'meshSlot') {
    const slot = meshSlots(ctx).find((s) => sameRef(s.ref, ref));
    return slot ? [outlinePoints(slot.outline, slot.top)] : [];
  }
  const faceRef = ref.kind === 'meshFace' ? ref : ref.face;
  const res = resolveFaceRef(ctx, faceRef);
  if (!res.ok) return [];
  const { face } = res;
  if (ref.kind === 'meshFace') return face.loops.map((loop) => closedLoopPoints(loop, face.z));
  const loop = face.loops[ref.kind === 'meshBoss' ? 0 : ref.loop];
  if (!loop) return [];
  if (ref.kind === 'meshHole') {
    const circle = face.circles[ref.loop];
    if (circle) return [circlePoints(circle.center, circle.diameter / 2, face.z)];
  }
  return [closedLoopPoints(loop, face.z)];
}

function dxfPathPoints(ctx: CamContext, ref: DxfPathRef): Point3[] | null {
  const g = ctx.geometry;
  if (!g || g.kind !== 'drawing' || !ctx.placement) return null;
  const raw = drawingPath(g.drawing, ref.layer, ref.path);
  if (!raw) return null;
  const z = -ctx.origin.z; // a drawing lies at scene Z = 0
  return flattenPath(drawingPathToProgram(ctx, raw), 0.05).map((p): Point3 => [p.x, p.y, z]);
}

function outlinePoints(outline: readonly Vec2[], z: number): Point3[] {
  const pts = outline.map((p): Point3 => [p.x, p.y, z]);
  if (pts.length) pts.push(pts[0]);
  return pts;
}

function closedLoopPoints(loop: Path2D, z: number): Point3[] {
  const pts = flattenPath(loop, 0.05).map((p): Point3 => [p.x, p.y, z]);
  if (pts.length) pts.push(pts[0]);
  return pts;
}

function circlePoints(center: Vec2, radius: number, z: number, n = 48): Point3[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [center.x + radius * Math.cos(a), center.y + radius * Math.sin(a), z] as Point3;
  });
}

// ── heights planes ──────────────────────────────────────────────────────

function HeightsPlanes({ job, geometry, heights }: { job: Job; geometry: ModelGeometry | null; heights: ResolvedHeights }) {
  const stock = useMemo(() => programContext(job, geometry).stock, [job, geometry]);
  if (!stock) return null;
  const w = Math.max(stock.max.x - stock.min.x, 1e-3);
  const h = Math.max(stock.max.y - stock.min.y, 1e-3);
  const cx = (stock.min.x + stock.max.x) / 2;
  const cy = (stock.min.y + stock.max.y) / 2;
  return (
    <>
      {HEIGHT_NAMES.map((name) => (
        <mesh key={name} data-testid={`heights-plane-${name}`} position={[cx, cy, heights[name]]} raycast={noRaycast}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial color={HEIGHT_COLOR[name]} transparent opacity={0.18} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

// ── tab handles ─────────────────────────────────────────────────────────

interface Drag { index: number; point: Vec2; t: number }

function TabHandles({ op, overlays, origin }: { op: Operation; overlays: OpOverlays; origin: Vec3 }) {
  const [drag, setDrag] = useState<Drag | null>(null);

  return (
    <>
      {overlays.tabs.map((tab, i) => {
        const lap = overlays.tabPaths.find((l) => l.refIndex === tab.refIndex);
        if (!lap) return null;
        const point = drag && drag.index === i ? drag.point : tab.point;
        return (
          <mesh
            key={i} data-testid={`tab-handle-${i}`} position={[point.x, point.y, lap.z]}
            onPointerDown={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              (e.target as Element).setPointerCapture(e.pointerId);
              setDrag({ index: i, point: tab.point, t: tab.t });
            }}
            onPointerMove={(e: ThreeEvent<PointerEvent>) => {
              if (!drag || drag.index !== i) return;
              e.stopPropagation();
              const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(lap.z + origin.z));
              const hit = new THREE.Vector3();
              if (!e.ray.intersectPlane(plane, hit)) return;
              const local = { x: hit.x - origin.x, y: hit.y - origin.y };
              const proj = nearestOnPolyline(lap.points, local);
              setDrag({ index: i, point: proj.point, t: proj.t });
            }}
            onPointerUp={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              (e.target as Element).releasePointerCapture(e.pointerId);
              if (drag && drag.index === i) {
                // freeze this contour's current tabs, with the dragged one moved
                const closed = lap.closed;
                const norm = (v: number) => (closed ? (v >= 1 || v < 0 ? ((v % 1) + 1) % 1 : v) : Math.min(1 - 1e-9, Math.max(0, v)));
                const t = overlays.tabs
                  .flatMap((tb, idx) => (tb.refIndex === tab.refIndex ? [idx === i ? drag.t : tb.t] : []))
                  .map(norm)
                  .sort((a, b) => a - b);
                const current = op.type === 'profile' || op.type === 'pocket' || op.type === 'slot' ? op.tabs.manual : [];
                const manual = [...current.filter((m) => m.refIndex !== tab.refIndex), { refIndex: tab.refIndex, t }];
                runCommand({ type: 'updateOperation', id: op.id, patch: { tabs: { manual } } });
              }
              setDrag(null);
            }}
          >
            <sphereGeometry args={[TAB_RADIUS, 16, 16]} />
            <meshBasicMaterial color={PICK_COLOR} />
          </mesh>
        );
      })}
    </>
  );
}

/** Nearest point on a closed polyline (program coordinates), and its fraction of the total (looped) length. */
function nearestOnPolyline(points: readonly Vec2[], q: Vec2): { point: Vec2; t: number } {
  if (points.length === 0) return { point: q, t: 0 };
  if (points.length === 1) return { point: points[0], t: 0 };
  let total = 0;
  let bestDist = Infinity;
  let bestS = 0;
  let bestPoint = points[0];
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const len = Math.sqrt(len2);
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2)) : 0;
    const px = a.x + dx * t, py = a.y + dy * t;
    const d = Math.hypot(q.x - px, q.y - py);
    if (d < bestDist) { bestDist = d; bestS = acc + t * len; bestPoint = { x: px, y: py }; }
    acc += len;
    total += len;
  }
  return { point: bestPoint, t: total > 0 ? bestS / total : 0 };
}

// ── unmachined areas ────────────────────────────────────────────────────

function UnmachinedAreas({ overlays }: { overlays: OpOverlays }) {
  const shapes = useMemo(
    () =>
      overlays.unmachined.flatMap((entry, ei) =>
        entry.regions
          .filter((region) => region.outer.length >= 3)
          .map((region, ri) => ({
            key: `${ei}-${ri}`,
            z: entry.z + 0.01,
            geometry: new THREE.ShapeGeometry(regionShape({ outer: region.outer, holes: region.holes.filter((h) => h.length >= 3) })),
            outlines: [region.outer, ...region.holes]
              .filter((poly) => poly.length >= 3)
              .map((poly) => [...poly, poly[0]].map((p): Point3 => [p.x, p.y, 0])),
          })),
      ),
    [overlays.unmachined],
  );
  useEffect(() => () => shapes.forEach((s) => s.geometry.dispose()), [shapes]);

  return (
    <>
      {shapes.map((s) => (
        <group key={s.key} position={[0, 0, s.z]}>
          <mesh geometry={s.geometry} raycast={noRaycast}>
            <meshBasicMaterial color={UNMACHINED_COLOR} transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          {s.outlines.map((outline, i) => (
            <Line key={i} points={outline} color={UNMACHINED_COLOR} lineWidth={1.5} raycast={noRaycast} />
          ))}
        </group>
      ))}
    </>
  );
}

// -- gouge markers ---------------------------------------------------------

const GOUGE_RADIUS = 0.6;
const gougeGeometry = new THREE.SphereGeometry(1, 8, 6);
const gougeMaterial = new THREE.MeshBasicMaterial({ color: UNMACHINED_COLOR });

/** Small red spheres where the tool cuts into the model, the deepest one slightly larger. */
function GougeMarkers({ overlays }: { overlays: OpOverlays }) {
  const gouges = overlays.gouges ?? [];
  const maxDepth = Math.max(...gouges.map((g) => g.depth));
  const deepest = gouges.findIndex((g) => g.depth === maxDepth);
  return (
    <>
      {gouges.map((g, i) => (
        <mesh
          key={i} data-testid={`gouge-marker-${i}`} position={[g.point.x, g.point.y, g.point.z]}
          scale={i === deepest ? GOUGE_RADIUS * 1.5 : GOUGE_RADIUS} geometry={gougeGeometry} material={gougeMaterial} raycast={noRaycast}
        />
      ))}
    </>
  );
}
