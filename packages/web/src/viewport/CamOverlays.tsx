import {
  camContext, type CamContext, type DxfPathRef, drawingPath, drawingPathToProgram, flattenPath, type GeometryRef,
  HEIGHT_NAMES, type HeightName, type Job, meshSlots, offsetOpenPath, pathLength, pointAt, type Operation, type OpOverlays, type Path2D, type ResolvedHeights,
  programContext, programOrigin, resolveFaceRef, type Vec2, type Vec3,
} from '@sponcam/core';
import { Html, Line } from '@react-three/drei';
import { type ThreeEvent, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { runCommand } from '@/state/camView';
import { appStore, type ModelGeometry, useApp } from '@/state/store';
import { contourTabTs, removeSelectedTabCommand } from '@/state/tabEdits';
import { sameRef } from '@/inspector/geometryLabels';
import { chamferRunsAsDrawn, openChains } from '@/inspector/openChains';
import { regionShape } from './convert';
import { noRaycast, type OrbitLike } from './SceneObjects';
import { freeTabT, nearestOnTabPath, normaliseTabT, pointAtTabT, TAB_TARGET, tabNear } from './tabPath';

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
      {(op.type === 'profile' || op.type === 'pocket' || op.type === 'slot') && op.tabs.enabled && summary && (
        <TabEditor op={op} overlays={summary.overlays} origin={origin} />
      )}
      {op.type === 'pocket' && op.tabs.enabled && summary && <TabBridges overlays={summary.overlays} />}
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

// ── tabs: paths to add on, handles to select, drag and remove ──────────

const MANUAL_TAB_COLOR = '#a855f7';
const SELECTED_TAB_COLOR = '#fde047';
/** Screen pixels a handle must move before a press counts as a drag rather than a click. */
const DRAG_PX = 3;
/** Width in screen pixels of the invisible band around a tab path that takes hover and clicks. */
const PATH_PICK_PX = 12;

type TabOp = Extract<Operation, { tabs: unknown }>;
type TabPath = OpOverlays['tabPaths'][number];
interface Drag { refIndex: number; index: number; x: number; y: number; moved: boolean; point: Vec2; t: number }

/**
 * Tab paths and handles. While toolpaths regenerate the overlays may be stale (an index could name another tab), so
 * clicks, drags and Del are ignored and the handles are dimmed until the new overlays arrive.
 */
function TabEditor({ op, overlays, origin }: { op: TabOp; overlays: OpOverlays; origin: Vec3 }) {
  const stale = useApp((st) => st.camStatus === 'generating');
  return (
    <>
      {overlays.tabPaths.map((lap) => <TabPathTarget key={lap.refIndex} op={op} overlays={overlays} lap={lap} origin={origin} stale={stale} />)}
      <TabHandles op={op} overlays={overlays} origin={origin} stale={stale} />
    </>
  );
}

/**
 * The tab path of one contour: hover shows a ghost tab at the nearest point, a click adds a tab there (or selects
 * the tab already within a tab width of it). A screen anchor (`tab-path-{refIndex}`) marks a free spot on it.
 */
function TabPathTarget({ op, overlays, lap, origin, stale }: { op: TabOp; overlays: OpOverlays; lap: TabPath; origin: Vec3; stale: boolean }) {
  const gl = useThree((st) => st.gl);
  const [ghost, setGhost] = useState<Vec2 | null>(null);
  const points = useMemo(() => {
    const pts = lap.points.map((p): Point3 => [p.x, p.y, lap.z]);
    if (lap.closed && pts.length) pts.push(pts[0]);
    return pts;
  }, [lap]);
  const anchor = useMemo(
    () => pointAtTabT(lap.points, freeTabT(contourTabTs(overlays, lap.refIndex), lap.closed), lap.closed),
    [lap, overlays],
  );
  useEffect(() => () => { gl.domElement.style.cursor = ''; }, [gl]);
  if (points.length < 2) return null;

  const nearest = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    nearestOnTabPath(lap.points, { x: e.point.x - origin.x, y: e.point.y - origin.y }, lap.closed);

  return (
    <>
      <Line
        name="tab-path" points={points} color={PICK_COLOR} lineWidth={PATH_PICK_PX} transparent opacity={0} depthWrite={false}
        userData={TAB_TARGET}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => e.stopPropagation()}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          if (stale) return;
          gl.domElement.style.cursor = 'copy';
          setGhost(nearest(e).point);
        }}
        onPointerOut={() => {
          gl.domElement.style.cursor = '';
          setGhost(null);
        }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.delta > 4 || stale) return; // the end of an orbit drag, or overlays about to be replaced
          const { t, length } = nearest(e);
          const current = contourTabTs(overlays, lap.refIndex);
          const near = tabNear(current, t, op.tabs.width, length, lap.closed);
          if (near >= 0) appStore.getState().selectTab({ refIndex: lap.refIndex, index: near });
          else runCommand({ type: 'addTab', opId: op.id, refIndex: lap.refIndex, t, current });
        }}
      />
      {ghost && !stale && (
        <mesh position={[ghost.x, ghost.y, lap.z]} raycast={noRaycast}>
          <sphereGeometry args={[TAB_RADIUS, 16, 16]} />
          <meshBasicMaterial color={PICK_COLOR} transparent opacity={0.45} depthWrite={false} />
        </mesh>
      )}
      <ScreenAnchor position={[anchor.x, anchor.y, lap.z]} testId={`tab-path-${lap.refIndex}`} />
    </>
  );
}

/**
 * Tab handles: a click selects (with a × beside it), a drag moves the tab along its contour. Handles of contours
 * placed by hand are drawn in a second colour.
 */
function TabHandles({ op, overlays, origin, stale }: { op: TabOp; overlays: OpOverlays; origin: Vec3; stale: boolean }) {
  const controls = useThree((st) => st.controls) as unknown as OrbitLike | null;
  const gl = useThree((st) => st.gl);
  const selected = useApp((st) => st.selectedTab);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const update = (d: Drag | null) => { dragRef.current = d; setDrag(d); };
  const endDrag = () => {
    if (controls) controls.enabled = true;
    update(null);
  };
  useEffect(() => () => { if (controls) controls.enabled = true; }, [controls]);

  return (
    <>
      {overlays.tabs.map((tab) => {
        const lap = overlays.tabPaths.find((l) => l.refIndex === tab.refIndex);
        if (!lap) return null;
        const key = `${tab.refIndex}-${tab.index}`;
        const mine = (d: Drag | null) => d !== null && d.refIndex === tab.refIndex && d.index === tab.index;
        const dragging = mine(drag) ? drag : null;
        const isSelected = selected?.refIndex === tab.refIndex && selected.index === tab.index;
        const point = dragging?.moved ? dragging.point : tab.point;
        const color = isSelected ? SELECTED_TAB_COLOR : tab.manual ? MANUAL_TAB_COLOR : PICK_COLOR;
        return (
          <group key={key}>
            <mesh
              position={[point.x, point.y, lap.z]} scale={isSelected ? 1.35 : 1} userData={TAB_TARGET}
              onClick={(e: ThreeEvent<MouseEvent>) => e.stopPropagation()}
              onPointerDown={(e: ThreeEvent<PointerEvent>) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                if (stale) return;
                (e.target as Element).setPointerCapture(e.pointerId);
                if (controls) controls.enabled = false;
                update({ refIndex: tab.refIndex, index: tab.index, x: e.clientX, y: e.clientY, moved: false, point: tab.point, t: tab.t });
              }}
              onPointerMove={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation(); // the tab path behind loses its hover and ghost
                gl.domElement.style.cursor = 'pointer';
                const d = dragRef.current;
                if (!d || !mine(d)) return;
                if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= DRAG_PX) return;
                const hit = new THREE.Vector3();
                if (!e.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -(lap.z + origin.z)), hit)) return;
                const proj = nearestOnTabPath(lap.points, { x: hit.x - origin.x, y: hit.y - origin.y }, lap.closed);
                update({ ...d, moved: true, point: proj.point, t: proj.t });
              }}
              onPointerUp={(e: ThreeEvent<PointerEvent>) => {
                const d = dragRef.current;
                if (!d || !mine(d)) return;
                e.stopPropagation();
                (e.target as Element).releasePointerCapture(e.pointerId);
                endDrag();
                if (appStore.getState().camStatus === 'generating') return; // regenerating since the press: stale overlays
                if (d.moved) {
                  runCommand({
                    type: 'moveTab', opId: op.id, refIndex: tab.refIndex, index: tab.index,
                    t: normaliseTabT(d.t, lap.closed), current: contourTabTs(overlays, tab.refIndex),
                  });
                } else {
                  appStore.getState().selectTab({ refIndex: tab.refIndex, index: tab.index });
                }
              }}
              onPointerOut={() => { if (!dragRef.current) gl.domElement.style.cursor = ''; }}
              onPointerCancel={() => endDrag()}
            >
              <sphereGeometry args={[TAB_RADIUS, 16, 16]} />
              <meshBasicMaterial color={color} transparent={stale} opacity={stale ? 0.35 : 1} />
            </mesh>
            <ScreenAnchor position={[point.x, point.y, lap.z]} testId={`tab-handle-${key}`} selected={isSelected} />
            {isSelected && !dragging?.moved && !stale && (
              <Html position={[point.x, point.y, lap.z]} zIndexRange={[20, 10]} style={{ transform: 'translate(8px, -28px)' }}>
                <button
                  type="button" data-testid="tab-remove" aria-label="Remove tab" title="Remove tab (Del)"
                  className="flex size-5 items-center justify-center rounded-full border bg-background text-xs leading-none text-foreground shadow hover:bg-destructive hover:text-white"
                  // keep the press from reaching the canvas's own event handling (and orbiting or picking)
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    const command = removeSelectedTabCommand(appStore.getState());
                    if (command) runCommand(command);
                  }}
                >
                  ×
                </button>
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
}

/**
 * An invisible screen-space anchor at a 3D point. It takes no pointer events itself, so a click at its centre reaches
 * the object under it; the end-to-end tests find tab handles and paths on screen through these.
 */
function ScreenAnchor({ position, testId, selected }: { position: Point3; testId: string; selected?: boolean }) {
  return (
    <Html position={position as [number, number, number]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div data-testid={testId} data-selected={selected ? 'true' : undefined} aria-hidden style={{ width: 6, height: 6, pointerEvents: 'none' }} />
    </Html>
  );
}

// ── pocket tab bridges ──────────────────────────────────────────────────

/** The strips of material a pocket leaves to hold its islands, drawn at the tab top. */
function TabBridges({ overlays }: { overlays: OpOverlays }) {
  const bridges = useMemo(
    () =>
      overlays.tabBridges
        .filter((b) => b.polygon.length >= 3)
        .map((b, i) => ({
          key: i,
          z: b.z,
          geometry: new THREE.ShapeGeometry(regionShape({ outer: b.polygon, holes: [] })),
          outline: [...b.polygon, b.polygon[0]].map((p): Point3 => [p.x, p.y, 0]),
        })),
    [overlays.tabBridges],
  );
  useEffect(() => () => bridges.forEach((b) => b.geometry.dispose()), [bridges]);

  return (
    <>
      {bridges.map((b) => (
        <group key={b.key} name="tab-bridge" position={[0, 0, b.z]}>
          <mesh geometry={b.geometry} raycast={noRaycast}>
            <meshBasicMaterial color={PICK_COLOR} transparent opacity={0.3} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <Line points={b.outline} color={PICK_COLOR} lineWidth={1.5} raycast={noRaycast} />
        </group>
      ))}
    </>
  );
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
