import { flattenPath, pathLength, segmentLength, subPath } from '../../geometry/offset/pathOps';
import { type Path2D, type Segment, segmentEnd, type Vec2 } from '../../geometry/path2d';
import type { Vec3 } from '../../geometry/vec3';
import type { Move } from '../types';
import { contactIntervals, contactPolygon, contactStep, toolTouches, wrapTriangles } from './zoneContact';

const EPS = 1e-9;
/** An arc whose chord is shorter than this is written as a line (a near-zero arc would read as a full circle). */
const MIN_ARC_CHORD = 1e-3;
const p3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const same = (a: Vec3, b: Vec3) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS && Math.abs(a.z - b.z) < EPS;

/** Equal depth levels from just below `top` down to `bottom`, each step no deeper than `stepdown`. */
export function depthLevels(top: number, bottom: number, stepdown: number): number[] {
  const depth = top - bottom;
  if (!(depth > EPS) || !(stepdown > 0)) return [];
  const n = Math.max(1, Math.ceil(depth / stepdown - 1e-9));
  return Array.from({ length: n }, (_, k) => (k === n - 1 ? bottom : top - (depth * (k + 1)) / n));
}

type CycleMove = Extract<Move, { kind: 'cycle' }>;

export class MoveWriter {
  readonly moves: Move[] = [];
  pos: Vec3 | null = null;

  rapid(to: Vec3): void {
    if (this.pos && same(this.pos, to)) return;
    this.moves.push({ kind: 'rapid', to });
    this.pos = to;
  }

  line(to: Vec3, feed: number): void {
    if (this.pos && same(this.pos, to)) return;
    this.moves.push({ kind: 'line', to, feed });
    this.pos = to;
  }

  /** XY arc from the current position; `to` equal to the current XY means a full circle. */
  arc(to: Vec3, center: Vec2, ccw: boolean, feed: number): void {
    this.moves.push({ kind: 'arc', to, center, ccw, feed });
    this.pos = to;
  }

  cycle(c: CycleMove): void {
    this.moves.push(c);
    this.pos = p3(c.at.x, c.at.y, c.retract);
  }

  /** Straight up (rapid) to `z` if the tool is below it. */
  up(z: number): void {
    if (this.pos && this.pos.z < z - EPS) this.rapid(p3(this.pos.x, this.pos.y, z));
  }

  /** Up to `safeZ`, across to `xy`, then rapid down to `downZ`. */
  travel(xy: Vec2, safeZ: number, downZ: number): void {
    if (!this.pos) this.rapid(p3(xy.x, xy.y, safeZ));
    else {
      this.up(safeZ);
      this.rapid(p3(xy.x, xy.y, this.pos.z));
    }
    if (downZ < this.pos!.z - EPS) this.rapid(p3(xy.x, xy.y, downZ));
  }

  /** One path segment from the current position (at the segment start), Z moving linearly from z0 to z1. */
  segment(s: Segment, _z0: number, z1: number, feed: number): void {
    const end = segmentEnd(s);
    const to = p3(end.x, end.y, z1);
    const fullCircle = s.kind === 'arc' && Math.abs(Math.abs(s.sweep) - 2 * Math.PI) < 1e-9;
    if (s.kind === 'line' || (!fullCircle && segmentLength(s) < MIN_ARC_CHORD * 2 && Math.hypot(end.x - (this.pos?.x ?? end.x), end.y - (this.pos?.y ?? end.y)) < MIN_ARC_CHORD)) {
      this.line(to, feed);
    } else {
      this.arc(to, s.center, s.sweep > 0, feed);
    }
  }
}

/** A stretch `[s0, s1]` along a path where material stays; `top` overrides the profile's top for this stretch. */
export interface TabInterval { s0: number; s1: number; shape: 'rect' | 'triangle'; top?: number }
/** Tabs on one lap: material stays up to `top`; triangles fall to `base` at their ends. */
export interface TabProfile { top: number; base: number; intervals: TabInterval[] }

/**
 * Follows `path` from its start (the tool must be at the path start), with Z moving linearly from zStart to zEnd
 * over the whole length. Tabs raise Z: rectangular tabs with vertical moves, triangular tabs with ramps.
 */
export function emitLap(w: MoveWriter, path: Path2D, zStart: number, zEnd: number, feed: number, tabs: TabProfile | null): void {
  const total = pathLength(path);
  if (total <= EPS) return;
  const intervals = tabs?.intervals ?? [];
  const zLin = (s: number) => zStart + ((zEnd - zStart) * s) / total;
  const tabZ = (s: number, side: -1 | 1): number => {
    let z = -Infinity;
    for (const iv of intervals) {
      const top = iv.top ?? tabs!.top;
      if (iv.shape === 'rect') {
        const inside = side < 0 ? s > iv.s0 + EPS && s <= iv.s1 + EPS : s >= iv.s0 - EPS && s < iv.s1 - EPS;
        if (inside) z = Math.max(z, top);
      } else if (s >= iv.s0 - EPS && s <= iv.s1 + EPS) {
        const mid = (iv.s0 + iv.s1) / 2;
        const half = (iv.s1 - iv.s0) / 2;
        z = Math.max(z, top - ((top - tabs!.base) * Math.abs(s - mid)) / half);
      }
    }
    return z;
  };
  const zAt = (s: number, side: -1 | 1) => Math.max(zLin(s), tabZ(s, side));
  const clamp = (s: number) => Math.min(total, Math.max(0, s));

  const marks = new Set<number>([0, total]);
  let acc = 0;
  for (const seg of path.segments) marks.add(clamp((acc += segmentLength(seg))));
  for (const iv of intervals) {
    marks.add(clamp(iv.s0));
    marks.add(clamp(iv.s1));
    if (iv.shape === 'triangle') marks.add(clamp((iv.s0 + iv.s1) / 2));
  }
  let sorted = [...marks].sort((a, b) => a - b);
  const crossings: number[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (b - a < EPS) continue;
    const fa = zLin(a) - tabZ(a, 1), fb = zLin(b) - tabZ(b, -1);
    if (Number.isFinite(fa) && Number.isFinite(fb) && fa * fb < 0) crossings.push(a + ((b - a) * fa) / (fa - fb));
  }
  sorted = [...new Set([...sorted, ...crossings])].sort((a, b) => a - b);

  const start = w.pos!;
  const z0 = zAt(0, 1);
  if (Math.abs(start.z - z0) > EPS) w.line(p3(start.x, start.y, z0), feed);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (b - a < 1e-7) continue;
    const za = zAt(a, 1), zb = zAt(b, -1);
    let s = a;
    for (const seg of subPath(path, a, b)) {
      const len = segmentLength(seg);
      w.segment(seg, za + ((zb - za) * (s - a)) / (b - a), za + ((zb - za) * (s + len - a)) / (b - a), feed);
      s += len;
    }
    const after = zAt(b, 1);
    if (b < total - EPS && Math.abs(after - zb) > EPS) w.line(p3(w.pos!.x, w.pos!.y, after), feed);
  }
}

/** Material a pass must keep clear of below `top` (a pocket tab bridge): rectangular zones lift and drop vertically, triangular ones ramp. */
export interface TabZone { polygon: Path2D; top: number; shape: 'rect' | 'triangle' }

/** Chord tolerance for flattening a zone polygon with arcs. */
const ZONE_FLATTEN_TOL = 1e-3;

/**
 * Follows `path` like {@link emitLap}, Z moving linearly from `z` to `zEnd` (default: `z`, a level pass), but rises
 * over every zone whose top is above the pass wherever the tool (radius `toolRadius`) touches it, i.e. where the centre
 * is inside the zone grown by the tool radius. Inside, it runs at the zone's top: rectangular zones with vertical moves
 * at the boundary, triangular zones with a linear ramp up to `top` over the first half of the crossing and back down
 * over the second. Overlapping rectangular zones of the same top are one lift; each triangular zone keeps its own
 * triangle, and where triangles overlap the pass stays on or above the highest of them. Elsewhere the highest zone
 * wins. The tool must be at the path start.
 */
export function emitPathOverZones(
  w: MoveWriter, path: Path2D, z: number, feed: number, zones: readonly TabZone[], toolRadius: number, zEnd = z,
): void {
  const low = Math.min(z, zEnd);
  const groups: { top: number; shape: 'rect' | 'triangle'; polys: ReturnType<typeof contactPolygon>[] }[] = [];
  const rects = new Map<number, (typeof groups)[number]>();
  for (const zone of zones) {
    if (!(low < zone.top - EPS)) continue;
    const poly = flattenPath(zone.polygon, ZONE_FLATTEN_TOL);
    if (poly.length < 3) continue;
    const cp = contactPolygon(poly);
    if (zone.shape === 'triangle') { groups.push({ top: zone.top, shape: 'triangle', polys: [cp] }); continue; }
    const g = rects.get(zone.top);
    if (g) g.polys.push(cp);
    else {
      const ng = { top: zone.top, shape: 'rect' as const, polys: [cp] };
      rects.set(zone.top, ng);
      groups.push(ng);
    }
  }
  const intervals: TabInterval[] = [];
  let top = Math.max(z, zEnd);
  const r = Math.max(0, toolRadius);
  for (const g of groups) {
    const found = contactIntervals(path, (p) => toolTouches(g.polys, p, r), contactStep(r));
    for (const iv of found) intervals.push({ ...iv, shape: g.shape, top: g.top });
    if (found.length) top = Math.max(top, g.top);
  }
  intervals.sort((a, b) => a.s0 - b.s0);
  wrapTriangles(intervals, path, pathLength(path));
  emitLap(w, path, z, zEnd, feed, intervals.length ? { top, base: low, intervals } : null);
}

/** Like {@link emitRampLaps}, rising over tab zones (see {@link emitPathOverZones}). */
export function emitRampLapsOverZones(
  w: MoveWriter, path: Path2D, zFrom: number, zTo: number, angleDeg: number, feed: number, zones: readonly TabZone[], toolRadius: number,
): void {
  const total = pathLength(path);
  const drop = zFrom - zTo;
  if (drop <= EPS || total <= EPS) return;
  const laps = rampLapCount(total, drop, angleDeg);
  for (let k = 0; k < laps; k++) emitPathOverZones(w, path, zFrom - (drop * k) / laps, feed, zones, toolRadius, zFrom - (drop * (k + 1)) / laps);
}

const rampLapCount = (total: number, drop: number, angleDeg: number) =>
  Math.max(1, Math.ceil(drop / (total * Math.tan((Math.max(0.1, angleDeg) * Math.PI) / 180)) - 1e-9));

/** Ramps down along a closed path from zFrom to zTo over whole laps, never steeper than `angleDeg`. */
export function emitRampLaps(w: MoveWriter, path: Path2D, zFrom: number, zTo: number, angleDeg: number, feed: number, tabs: TabProfile | null): void {
  const total = pathLength(path);
  const drop = zFrom - zTo;
  if (drop <= EPS || total <= EPS) return;
  const laps = rampLapCount(total, drop, angleDeg);
  for (let k = 0; k < laps; k++) emitLap(w, path, zFrom - (drop * k) / laps, zFrom - (drop * (k + 1)) / laps, feed, tabs);
}

/**
 * Helical entry around `c` with radius r (tool centre path), starting at (c.x + r, c.y, zFrom); descends in
 * counter-clockwise half circles no steeper than `angleDeg`, then one full circle at zTo.
 */
export function emitHelix(w: MoveWriter, c: Vec2, r: number, zFrom: number, zTo: number, angleDeg: number, feed: number): void {
  const drop = zFrom - zTo;
  const perRev = 2 * Math.PI * r * Math.tan((Math.max(0.1, angleDeg) * Math.PI) / 180);
  const halves = Math.max(2, 2 * Math.ceil(drop / Math.max(perRev, 1e-6) - 1e-9));
  for (let k = 1; k <= halves; k++) w.arc(p3(k % 2 === 1 ? c.x - r : c.x + r, c.y, zFrom - (drop * k) / halves), c, true, feed);
  w.arc(p3(c.x - r, c.y, zTo), c, true, feed);
  w.arc(p3(c.x + r, c.y, zTo), c, true, feed);
}
