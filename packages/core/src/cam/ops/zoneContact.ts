import { pathLength, segmentLength, segmentPointAt } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';

/**
 * Where a round tool meets polygons: the distance from a tool-centre point to a set of polygons, and the stretches of
 * a tool-centre path where the tool touches them. Touching a polygon with a tool of radius r is the same as the
 * centre entering the polygon grown by r with round corners, so this is an exact round offset without Clipper.
 */
export interface ContactPolygon { readonly poly: readonly Vec2[]; readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

const EPS = 1e-9;
/** Bisection steps that place a contact edge on a sampled stretch (well under 1 µm). */
const BISECT = 30;

export function contactPolygon(poly: readonly Vec2[]): ContactPolygon {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of poly) {
    minX = Math.min(minX, q.x); minY = Math.min(minY, q.y);
    maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y);
  }
  return { poly, minX, minY, maxX, maxY };
}

function inPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Distance from `p` to the nearest polygon (0 inside one). */
export function contactDistance(polys: readonly ContactPolygon[], p: Vec2): number {
  let best = Infinity;
  for (const z of polys) {
    const box = Math.max(z.minX - p.x, p.x - z.maxX, z.minY - p.y, p.y - z.maxY, 0);
    if (box >= best) continue;
    if (inPolygon(p, z.poly)) return 0;
    for (let i = 0, j = z.poly.length - 1; i < z.poly.length; j = i++) best = Math.min(best, segmentDistance(p, z.poly[j], z.poly[i]));
  }
  return best;
}

/** Whether a tool of radius `r` centred at `p` touches any polygon (overlaps it by more than 0.1 µm, or sits inside). */
export function toolTouches(polys: readonly ContactPolygon[], p: Vec2, r: number): boolean {
  const d = contactDistance(polys, p);
  return d === 0 || d < r - 1e-7;
}

/**
 * Stretches `[s0, s1]` (distances along `path`) where `touches` holds, found by sampling every `step` within each
 * segment and bisecting each change; interval ends keep to the touching side. Overlapping contacts come out as one
 * stretch.
 */
export function contactIntervals(path: Path2D, touches: (p: Vec2) => boolean, step: number): { s0: number; s1: number }[] {
  const out: { s0: number; s1: number }[] = [];
  if (pathLength(path) <= EPS) return out;
  let start = -1;
  let first = true;
  let prevIn = false;
  let base = 0;
  for (const seg of path.segments) {
    const len = segmentLength(seg);
    if (len <= EPS) { base += len; continue; }
    const at = (d: number) => touches(segmentPointAt(seg, d).point);
    if (first) {
      prevIn = at(0);
      if (prevIn) start = 0;
      first = false;
    }
    const n = Math.max(1, Math.ceil(len / step));
    let prevD = 0;
    for (let k = 1; k <= n; k++) {
      const d = (len * k) / n;
      const cur = at(d);
      if (cur !== prevIn) {
        let a = prevD, b = d;
        for (let i = 0; i < BISECT; i++) {
          const m = (a + b) / 2;
          if (at(m) === prevIn) a = m;
          else b = m;
        }
        const e = base + (prevIn ? a : b);
        if (cur) start = e;
        else { out.push({ s0: start, s1: e }); start = -1; }
      }
      prevIn = cur;
      prevD = d;
    }
    base += len;
  }
  if (start >= 0) out.push({ s0: start, s1: base });
  return out;
}

/** Sample step for a tool of radius `r`: a quarter radius, between 0.01 and 0.1 mm. */
export const contactStep = (r: number): number => Math.min(0.1, Math.max(0.01, r / 4));

/**
 * A closed path that starts inside a triangular tab meets it twice, as its first and last stretches. As two pieces
 * each half would ramp down to the base at the seam, so both are cut as rectangles (never lower than the triangle).
 */
export function wrapTriangles<T extends { s0: number; s1: number; shape: 'rect' | 'triangle' }>(out: T[], path: Path2D, total: number): T[] {
  if (!path.closed || out.length < 2) return out;
  const head = out[0], tail = out[out.length - 1];
  if (head.s0 > EPS || tail.s1 < total - EPS || (head.shape !== 'triangle' && tail.shape !== 'triangle')) return out;
  out[0] = { ...head, shape: 'rect' };
  out[out.length - 1] = { ...tail, shape: 'rect' };
  return out;
}
