import {
  camContext, type CamContext, circleOf, type DxfPathRef, drawingPath, drawingPathToProgram, flattenPath, type GeometryRef,
  HEIGHT_NAMES, type HeightName, type Job, type LapPosition, type Operation, type OpOverlays, type Path2D, type ResolvedHeights,
  resolveFaceRef, type Vec2, type Vec3,
} from '@sponcam/core';
import { Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { runCommand } from '@/state/camView';
import { programContext, programOrigin } from '@/state/programContext';
import { type ModelGeometry, useApp } from '@/state/store';
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
      {inspectorTab === 'heights' && summary?.heights && <HeightsPlanes job={job} geometry={geometry} heights={summary.heights} />}
      {op.type === 'profile' && summary && <TabHandles op={op} overlays={summary.overlays} origin={origin} />}
      {summary && <UnmachinedAreas overlays={summary.overlays} />}
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
  return (
    <>
      {loops.map((l) => (
        <Line key={l.key} points={l.points as Point3[]} color={PICK_COLOR} lineWidth={3} raycast={noRaycast} />
      ))}
    </>
  );
}

/** Polylines (program coordinates) for one picked reference, following spec §8's picked-geometry conventions. */
function refLoops(ctx: CamContext, ref: GeometryRef): Point3[][] {
  if (ref.kind === 'dxfPath') return [dxfPathPoints(ctx, ref)].filter((p): p is Point3[] => p !== null);
  const faceRef = ref.kind === 'meshFace' ? ref : ref.face;
  const res = resolveFaceRef(ctx, faceRef);
  if (!res.ok) return [];
  const { face } = res;
  if (ref.kind === 'meshFace') return face.loops.map((loop) => closedLoopPoints(loop, face.z));
  const loop = face.loops[ref.loop];
  if (!loop) return [];
  if (ref.kind === 'meshHole') {
    const circle = circleOf(loop);
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
        const lap = overlays.laps.find((l) => l.refIndex === tab.refIndex);
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
                const positions: LapPosition[] = overlays.tabs.map((tb, idx) => ({ refIndex: tb.refIndex, t: idx === i ? drag.t : tb.t }));
                runCommand({ type: 'updateOperation', id: op.id, patch: { tabs: { positions } } });
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
        entry.polys
          .filter((poly) => poly.length >= 3)
          .map((poly, pi) => ({
            key: `${ei}-${pi}`,
            z: entry.z + 0.01,
            geometry: polyShapeGeometry(poly),
            outline: [...poly, poly[0]].map((p): Point3 => [p.x, p.y, 0]),
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
          <Line points={s.outline as Point3[]} color={UNMACHINED_COLOR} lineWidth={1.5} raycast={noRaycast} />
        </group>
      ))}
    </>
  );
}

function polyShapeGeometry(poly: readonly Vec2[]): THREE.ShapeGeometry {
  return new THREE.ShapeGeometry(new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y))));
}
