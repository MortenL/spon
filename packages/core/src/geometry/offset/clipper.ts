import {
  booleanOpWithPolyTree, ClipType, difference, EndType, FillRule, inflatePaths, intersect, JoinType, type Path64,
  pointInPolygon, PointInPolygonResult, type PolyPath64, PolyTree64, union,
} from 'clipper2-ts';
import type { Vec2 } from '../path2d';
import { polyArea, v2 } from './pathOps';

/** Clipper works in integers: 1e5 units per mm (10 nm resolution). */
export const CLIP_SCALE = 1e5;

/** A closed polygon without a repeated end point. Outer boundaries run counter-clockwise, holes clockwise. */
export type Poly = Vec2[];
export interface Region { outer: Poly; holes: Poly[] }

const toPath = (p: readonly Vec2[]): Path64 => p.map((v) => ({ x: Math.round(v.x * CLIP_SCALE), y: Math.round(v.y * CLIP_SCALE) }));
const fromPath = (p: Path64): Poly => p.map((v) => v2(v.x / CLIP_SCALE, v.y / CLIP_SCALE));
const toPaths = (ps: readonly (readonly Vec2[])[]): Path64[] => ps.map(toPath);
const fromPaths = (ps: Path64[]): Poly[] => ps.map(fromPath);
const arcTol = (tol: number) => Math.max(tol, 1e-4) * CLIP_SCALE;

/** Offsets closed polygons by `delta` mm (negative = inward) with round joins. The result is normalised: outers CCW, holes CW. */
export function offsetPolys(polys: readonly Poly[], delta: number, tol: number): Poly[] {
  if (!polys.length) return [];
  return fromPaths(inflatePaths(toPaths(polys), delta * CLIP_SCALE, JoinType.Round, EndType.Polygon, 2, arcTol(tol)));
}

/** The area covered by a disc of `radius` moving along each polyline (closed polylines sweep a band). */
export function sweepPolylines(lines: readonly { points: readonly Vec2[]; closed: boolean }[], radius: number, tol: number): Poly[] {
  const open = lines.filter((l) => !l.closed && l.points.length > 1).map((l) => toPath(l.points));
  const closed = lines.filter((l) => l.closed && l.points.length > 2).map((l) => toPath(l.points));
  const parts: Path64[] = [];
  if (open.length) parts.push(...inflatePaths(open, radius * CLIP_SCALE, JoinType.Round, EndType.Round, 2, arcTol(tol)));
  if (closed.length) parts.push(...inflatePaths(closed, radius * CLIP_SCALE, JoinType.Round, EndType.Joined, 2, arcTol(tol)));
  return parts.length ? fromPaths(union(parts, FillRule.NonZero)) : [];
}

export function unionPolys(a: readonly Poly[], b: readonly Poly[] = []): Poly[] {
  return fromPaths(union(toPaths(a), toPaths(b), FillRule.NonZero));
}
export function differencePolys(a: readonly Poly[], b: readonly Poly[]): Poly[] {
  return fromPaths(difference(toPaths(a), toPaths(b), FillRule.NonZero));
}
export function intersectPolys(a: readonly Poly[], b: readonly Poly[]): Poly[] {
  return fromPaths(intersect(toPaths(a), toPaths(b), FillRule.NonZero));
}

/** Splits a polygon set into separate regions (each outer with its own holes); islands inside holes become regions of their own. */
export function polysToRegions(polys: readonly Poly[]): Region[] {
  if (!polys.length) return [];
  const tree = new PolyTree64();
  booleanOpWithPolyTree(ClipType.Union, toPaths(polys), null, tree, FillRule.NonZero);
  const out: Region[] = [];
  const visit = (node: PolyPath64) => {
    const holes: Poly[] = [];
    for (let i = 0; i < node.count; i++) {
      const hole = node.child(i);
      holes.push(fromPath(hole.poly ?? []));
      for (let j = 0; j < hole.count; j++) visit(hole.child(j));
    }
    out.push({ outer: fromPath(node.poly ?? []), holes });
  };
  for (let i = 0; i < tree.count; i++) visit(tree.child(i));
  return out;
}

export const regionPolys = (r: Region): Poly[] => [r.outer, ...r.holes];

/** Total signed area of a normalised polygon set (holes subtract). */
export function polysArea(polys: readonly Poly[]): number {
  return polys.reduce((sum, p) => sum + polyArea(p), 0);
}

/** Even-odd containment; points on a boundary count as inside. */
export function pointInPolys(p: Vec2, polys: readonly Poly[]): boolean {
  const q = { x: Math.round(p.x * CLIP_SCALE), y: Math.round(p.y * CLIP_SCALE) };
  let inside = false;
  for (const poly of polys) {
    const r = pointInPolygon(q, toPath(poly));
    if (r === PointInPolygonResult.IsOn) return true;
    if (r === PointInPolygonResult.IsInside) inside = !inside;
  }
  return inside;
}

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Proper crossing of segments p1p2 and p3p4 (touching at end points does not count). */
function segmentsCross(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const eps = 1e-12;
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

/** True when segment a→b properly crosses an edge of any polygon of the set. */
export function segmentCrossesPolys(a: Vec2, b: Vec2, polys: readonly Poly[]): boolean {
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) if (segmentsCross(a, b, poly[i], poly[(i + 1) % poly.length])) return true;
  }
  return false;
}

/** True when segment a→b crosses no polygon edge and its midpoint is inside the set. */
export function segmentInside(a: Vec2, b: Vec2, polys: readonly Poly[]): boolean {
  return !segmentCrossesPolys(a, b, polys) && pointInPolys(v2((a.x + b.x) / 2, (a.y + b.y) / 2), polys);
}
