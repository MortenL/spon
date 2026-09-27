import type { Path2D, Segment, Vec2 } from '../../geometry/path2d';

const TAU = 2 * Math.PI;

function distanceToChord(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Adaptive flattening: splits each interval until its midpoint lies within `tol` of the chord. */
export function flattenCurve(evaluate: (t: number) => Vec2, t0: number, t1: number, tol: number, minSegments = 4): Vec2[] {
  const out: Vec2[] = [evaluate(t0)];
  const refine = (ta: number, pa: Vec2, tb: number, pb: Vec2, depth: number) => {
    const tm = (ta + tb) / 2;
    const pm = evaluate(tm);
    if (depth < 18 && distanceToChord(pm, pa, pb) > tol) {
      refine(ta, pa, tm, pm, depth + 1);
      refine(tm, pm, tb, pb, depth + 1);
    } else {
      out.push(pb);
    }
  };
  let prevT = t0;
  let prevP = out[0];
  for (let i = 1; i <= minSegments; i++) {
    const t = t0 + ((t1 - t0) * i) / minSegments;
    const p = evaluate(t);
    refine(prevT, prevP, t, p, 0);
    prevT = t;
    prevP = p;
  }
  return out;
}

export function pointsToPath(points: Vec2[]): Path2D {
  const segments: Segment[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-12) segments.push({ kind: 'line', from: a, to: b });
  }
  const first = points[0], last = points[points.length - 1];
  const closed = points.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-9;
  return { segments, closed };
}

/** DXF ELLIPSE: P(t) = C + M·cos t + m·sin t, with m = ratio · (M rotated 90° CCW). Params in radians. */
export function ellipseToPath(center: Vec2, majorAxis: Vec2, ratio: number, startParam: number, endParam: number, tol: number): Path2D {
  let end = endParam;
  while (end <= startParam) end += TAU;
  const minor = { x: -majorAxis.y * ratio, y: majorAxis.x * ratio };
  const evaluate = (t: number): Vec2 => ({
    x: center.x + majorAxis.x * Math.cos(t) + minor.x * Math.sin(t),
    y: center.y + majorAxis.y * Math.cos(t) + minor.y * Math.sin(t),
  });
  return pointsToPath(flattenCurve(evaluate, startParam, end, tol, 8));
}

/**
 * De Boor evaluation of a B-spline; `knots.length` must equal `ctrl.length + degree + 1`.
 * With `weights` (one per control point) the curve is a NURBS, evaluated in homogeneous coordinates.
 */
export function evalBSpline(degree: number, knots: readonly number[], ctrl: readonly Vec2[], t: number, weights?: readonly number[] | null): Vec2 {
  const n = ctrl.length;
  let k = degree;
  while (k < n - 1 && knots[k + 1] <= t) k++;
  const d = Array.from({ length: degree + 1 }, (_, j) => {
    const p = ctrl[j + k - degree];
    const w = weights ? weights[j + k - degree] : 1;
    return { x: p.x * w, y: p.y * w, w };
  });
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const lo = knots[j + k - degree];
      const hi = knots[j + 1 + k - r];
      const alpha = hi === lo ? 0 : (t - lo) / (hi - lo);
      d[j] = {
        x: (1 - alpha) * d[j - 1].x + alpha * d[j].x,
        y: (1 - alpha) * d[j - 1].y + alpha * d[j].y,
        w: (1 - alpha) * d[j - 1].w + alpha * d[j].w,
      };
    }
  }
  const { x, y, w } = d[degree];
  return w === 1 ? { x, y } : { x: x / w, y: y / w };
}

export function splineToPath(
  degree: number,
  knots: readonly number[],
  ctrl: readonly Vec2[],
  fitPoints: readonly Vec2[],
  tol: number,
  weights?: readonly number[] | null,
): { path: Path2D | null; note: string | null } {
  if (ctrl.length > degree && knots.length === ctrl.length + degree + 1) {
    const start = knots[degree];
    const end = knots[ctrl.length];
    const breaks = [...new Set(knots.filter((k) => k >= start && k <= end))].sort((a, b) => a - b);
    const points: Vec2[] = [];
    for (let i = 1; i < breaks.length; i++) {
      const span = flattenCurve((t) => evalBSpline(degree, knots, ctrl, t, weights), breaks[i - 1], breaks[i], tol);
      points.push(...(points.length ? span.slice(1) : span));
    }
    return { path: pointsToPath(points), note: null };
  }
  if (fitPoints.length >= 2) {
    return { path: pointsToPath([...fitPoints]), note: 'SPLINEs without control points were approximated through their fit points' };
  }
  return { path: null, note: 'Some SPLINEs had no usable control or fit points and were skipped' };
}
