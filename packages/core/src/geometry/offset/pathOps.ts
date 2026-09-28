import { type ArcSegment, arcPoint, type Path2D, type Segment, segmentEnd, segmentStart, tessellatePath, type Vec2 } from '../path2d';

const TAU = 2 * Math.PI;

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

export function segmentLength(s: Segment): number {
  return s.kind === 'line' ? dist2(s.from, s.to) : s.radius * Math.abs(s.sweep);
}

export function pathLength(p: Path2D): number {
  let total = 0;
  for (const s of p.segments) total += segmentLength(s);
  return total;
}

export function pathStart(p: Path2D): Vec2 {
  if (p.segments.length === 0) throw new Error('Path has no segments');
  return segmentStart(p.segments[0]);
}

export function pathEnd(p: Path2D): Vec2 {
  if (p.segments.length === 0) throw new Error('Path has no segments');
  return segmentEnd(p.segments[p.segments.length - 1]);
}

/** Point and unit tangent (direction of travel) at distance `d` from the segment start, clamped to the segment. */
export function segmentPointAt(s: Segment, d: number): { point: Vec2; tangent: Vec2 } {
  const len = segmentLength(s);
  const t = len > 0 ? Math.min(1, Math.max(0, d / len)) : 0;
  if (s.kind === 'line') {
    const dx = s.to.x - s.from.x;
    const dy = s.to.y - s.from.y;
    return { point: v2(s.from.x + dx * t, s.from.y + dy * t), tangent: len > 0 ? v2(dx / len, dy / len) : v2(1, 0) };
  }
  const a = s.startAngle + s.sweep * t;
  const dir = s.sweep >= 0 ? 1 : -1;
  return { point: arcPoint(s, a), tangent: v2(-Math.sin(a) * dir, Math.cos(a) * dir) };
}

/** Point, tangent and segment index at distance `s` along the path (clamped to the path). */
export function pointAt(p: Path2D, s: number): { point: Vec2; tangent: Vec2; segment: number } {
  let rest = Math.max(0, s);
  for (let i = 0; i < p.segments.length; i++) {
    const len = segmentLength(p.segments[i]);
    if (rest <= len || i === p.segments.length - 1) return { ...segmentPointAt(p.segments[i], rest), segment: i };
    rest -= len;
  }
  return { point: v2(0, 0), tangent: v2(1, 0), segment: -1 };
}

/** Splits a segment at distance `d` from its start. */
export function splitSegment(s: Segment, d: number): [Segment, Segment] {
  if (s.kind === 'line') {
    const m = segmentPointAt(s, d).point;
    return [{ kind: 'line', from: s.from, to: m }, { kind: 'line', from: m, to: s.to }];
  }
  const len = segmentLength(s);
  const first = len > 0 ? s.sweep * Math.min(1, Math.max(0, d / len)) : 0;
  return [{ ...s, sweep: first }, { ...s, startAngle: s.startAngle + first, sweep: s.sweep - first }];
}

/** Segments covering distances [s0, s1] of the path (no wrap-around); zero-length pieces are dropped. */
export function subPath(p: Path2D, s0: number, s1: number): Segment[] {
  const out: Segment[] = [];
  let acc = 0;
  for (const seg of p.segments) {
    const len = segmentLength(seg);
    const a = acc;
    acc += len;
    if (len <= 0 || acc <= s0 + 1e-12 || a >= s1 - 1e-12) continue;
    let piece: Segment = seg;
    const hi = Math.min(len, s1 - a);
    const lo = Math.max(0, s0 - a);
    if (hi < len - 1e-12) piece = splitSegment(piece, hi)[0];
    if (lo > 1e-12) piece = splitSegment(piece, lo)[1];
    if (segmentLength(piece) > 1e-12) out.push(piece);
  }
  return out;
}

export function reverseSegment(s: Segment): Segment {
  return s.kind === 'line' ? { kind: 'line', from: s.to, to: s.from } : { ...s, startAngle: s.startAngle + s.sweep, sweep: -s.sweep };
}

export function reversePath(p: Path2D): Path2D {
  return { closed: p.closed, segments: p.segments.map(reverseSegment).reverse() };
}

/** A closed path re-started at distance `s`. Open paths are returned unchanged. */
export function rotateStart(p: Path2D, s: number): Path2D {
  const total = pathLength(p);
  if (!p.closed || total <= 0) return p;
  const at = ((s % total) + total) % total;
  if (at < 1e-9 || total - at < 1e-9) return p;
  return { closed: true, segments: [...subPath(p, at, total), ...subPath(p, 0, at)] };
}

/** Polyline through the path; a closed path's repeated end point is dropped. */
export function flattenPath(p: Path2D, tol: number): Vec2[] {
  const pts = tessellatePath(p, tol);
  if (p.closed && pts.length > 1 && dist2(pts[0], pts[pts.length - 1]) < 1e-9) pts.pop();
  return pts;
}

/** Signed area (counter-clockwise positive) of a closed polygon. */
export function polyArea(poly: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) sum += (poly[j].x - poly[i].x) * (poly[j].y + poly[i].y);
  return sum / 2;
}

export function pathArea(p: Path2D, tol = 1e-3): number {
  return polyArea(flattenPath(p, tol));
}

/** The path with counter-clockwise (ccw = true) or clockwise orientation. */
export function orientPath(p: Path2D, ccw: boolean): Path2D {
  const a = pathArea(p);
  return a === 0 || a > 0 === ccw ? p : reversePath(p);
}

export function pathFromPoints(points: readonly Vec2[], closed: boolean): Path2D {
  const segments: Segment[] = [];
  const n = points.length;
  for (let i = 0; i + 1 < n; i++) segments.push({ kind: 'line', from: points[i], to: points[i + 1] });
  if (closed && n > 2) segments.push({ kind: 'line', from: points[n - 1], to: points[0] });
  return { segments, closed };
}

/** Signed sweep from angle a0 to a1 in the given direction, in (0, 2π] (ccw) or [−2π, 0) (cw). */
export function arcSweepBetween(a0: number, a1: number, ccw: boolean): number {
  let d = (a1 - a0) % TAU;
  if (ccw) {
    if (d <= 1e-12) d += TAU;
    return d;
  }
  if (d >= -1e-12) d -= TAU;
  return d;
}

function nearestOnSegment(s: Segment, q: Vec2): { d: number; distance: number } {
  if (s.kind === 'line') {
    const dx = s.to.x - s.from.x, dy = s.to.y - s.from.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((q.x - s.from.x) * dx + (q.y - s.from.y) * dy) / len2)) : 0;
    return { d: t * Math.sqrt(len2), distance: Math.hypot(q.x - s.from.x - dx * t, q.y - s.from.y - dy * t) };
  }
  const a: ArcSegment = s;
  const sweepAbs = Math.abs(a.sweep);
  const dir = a.sweep >= 0 ? 1 : -1;
  let rel = ((Math.atan2(q.y - a.center.y, q.x - a.center.x) - a.startAngle) * dir) % TAU;
  if (rel < 0) rel += TAU;
  if (rel <= sweepAbs) return { d: rel * a.radius, distance: Math.abs(dist2(q, a.center) - a.radius) };
  const ds = dist2(q, arcPoint(a, a.startAngle));
  const de = dist2(q, arcPoint(a, a.startAngle + a.sweep));
  return ds <= de ? { d: 0, distance: ds } : { d: sweepAbs * a.radius, distance: de };
}

/** Distance along the path of the point nearest to `q`, and how far `q` is from it. */
export function nearestS(p: Path2D, q: Vec2): { s: number; distance: number } {
  let best = { s: 0, distance: Infinity };
  let acc = 0;
  for (const seg of p.segments) {
    const n = nearestOnSegment(seg, q);
    if (n.distance < best.distance - 1e-12) best = { s: acc + n.d, distance: n.distance };
    acc += segmentLength(seg);
  }
  return best;
}

/** Distances along the path where the direction turns by more than `minTurnDeg` between consecutive segments (closed paths include the joint at 0). */
export function cornerDistances(p: Path2D, minTurnDeg: number): number[] {
  const out: number[] = [];
  const cos = Math.cos((minTurnDeg * Math.PI) / 180);
  const n = p.segments.length;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const len = segmentLength(p.segments[i]);
    const next = i + 1 < n ? p.segments[i + 1] : p.closed ? p.segments[0] : null;
    if (next) {
      const t0 = segmentPointAt(p.segments[i], len).tangent;
      const t1 = segmentPointAt(next, 0).tangent;
      if (t0.x * t1.x + t0.y * t1.y < cos) out.push(i + 1 < n ? acc + len : 0);
    }
    acc += len;
  }
  return out.sort((a, b) => a - b);
}
