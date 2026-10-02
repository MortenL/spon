import type { ArcSegment, Path2D, Segment, Vec2 } from '../path2d';
import { arcSweepBetween, dist2, v2 } from './pathOps';

const MAX_RUN = 1500;
const MAX_TURN = Math.cos(Math.PI / 4); // consecutive chords may turn at most 45° inside one arc

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Distance from p to segment a–b. */
function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

/**
 * Largest distance from the circle arc (centre c, radius r) running from angle a0 through the signed `sweep` to
 * the segment p–q. Besides the arc's ends and middle, it checks where the arc's tangent is parallel to p–q (the
 * circle points along the chord's normal from the centre): with p and q off the circle in opposite directions
 * the chord tilts against the arc and the farthest point is there, not at the middle.
 */
function arcChordBulge(c: Vec2, r: number, a0: number, sweep: number, p: Vec2, q: Vec2): number {
  const angles = [a0, a0 + sweep / 2, a0 + sweep];
  const normal = Math.atan2(q.x - p.x, -(q.y - p.y)); // direction of (−dy, dx), perpendicular to p→q
  for (const phi of [normal, normal + Math.PI]) {
    const t = (sweep >= 0 ? phi - a0 : a0 - phi) % (2 * Math.PI);
    const along = t < 0 ? t + 2 * Math.PI : t;
    if (along <= Math.abs(sweep)) angles.push(phi);
  }
  let worst = 0;
  for (const a of angles) worst = Math.max(worst, segmentDistance(v2(c.x + r * Math.cos(a), c.y + r * Math.sin(a)), p, q));
  return worst;
}

function circumcenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  return v2((a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d);
}

/**
 * An arc through pts[i..j] within `tol` of every point and within `maxBulge` of every chord between consecutive
 * points, turning consistently, or null.
 */
function arcThrough(pts: readonly Vec2[], i: number, j: number, tol: number, maxBulge: number): ArcSegment | null {
  const m = (i + j) >> 1;
  const c = circumcenter(pts[i], pts[m], pts[j]);
  if (!c) return null;
  const r = dist2(c, pts[i]);
  if (r > 1e4) return null;
  const turn = Math.sign(cross(pts[i], pts[m], pts[j]));
  let travelled = 0;
  for (let k = i + 1; k <= j; k++) {
    if (k < j && Math.abs(dist2(c, pts[k]) - r) > tol) return null;
    if (k < j) {
      const t = cross(pts[k - 1], pts[k], pts[k + 1]);
      if (Math.sign(t) !== turn && Math.abs(t) > 1e-12) return null;
      const ax = pts[k].x - pts[k - 1].x, ay = pts[k].y - pts[k - 1].y, bx = pts[k + 1].x - pts[k].x, by = pts[k + 1].y - pts[k].y;
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la > 0 && lb > 0 && (ax * bx + ay * by) / (la * lb) < MAX_TURN) return null;
    }
    const a0 = Math.atan2(pts[k - 1].y - c.y, pts[k - 1].x - c.x);
    const a1 = Math.atan2(pts[k].y - c.y, pts[k].x - c.x);
    const sweep = arcSweepBetween(a0, a1, turn > 0);
    // between two input points the arc must also stay near the chord joining them (on long chords it could
    // otherwise bulge well beyond tol, even with every input point on the arc)
    if (maxBulge !== Infinity && arcChordBulge(c, r, a0, sweep, pts[k - 1], pts[k]) > maxBulge) return null;
    travelled += Math.abs(sweep);
  }
  if (travelled >= 2 * Math.PI - 1e-9) return null;
  const startAngle = Math.atan2(pts[i].y - c.y, pts[i].x - c.x);
  return { kind: 'arc', center: c, radius: r, startAngle, sweep: turn > 0 ? travelled : -travelled };
}

function lineFits(pts: readonly Vec2[], i: number, j: number, tol: number): boolean {
  const a = pts[i], b = pts[j];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (len < 1e-12) return false;
  let lastT = 0;
  for (let k = i + 1; k < j; k++) {
    const t = ((pts[k].x - a.x) * dx + (pts[k].y - a.y) * dy) / (len * len);
    if (t < lastT - 1e-9 || t > 1 + 1e-9) return false;
    lastT = t;
    if (Math.abs(cross(a, b, pts[k])) / len > tol) return false;
  }
  return true;
}

function dedupe(input: readonly Vec2[], closed: boolean, eps: number): Vec2[] {
  const out: Vec2[] = [];
  for (const p of input) if (!out.length || dist2(out[out.length - 1], p) > eps) out.push(p);
  if (closed && out.length > 1 && dist2(out[0], out[out.length - 1]) <= eps) out.pop();
  return out;
}

/**
 * Where to start fitting a closed polygon: its sharpest corner if one turns by more than 45°, otherwise the
 * start of its longest chord (a straight edge), so no arc is split across the start point.
 */
function fitStart(pts: readonly Vec2[]): number {
  let sharp = 0, sharpCos = Infinity, longest = 0, longestLen = -1;
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const p = pts[(k + n - 1) % n], q = pts[k], r = pts[(k + 1) % n];
    const ax = q.x - p.x, ay = q.y - p.y, bx = r.x - q.x, by = r.y - q.y;
    const lb = Math.hypot(bx, by);
    const c = (ax * bx + ay * by) / (Math.hypot(ax, ay) * lb || 1);
    if (c < sharpCos) { sharpCos = c; sharp = k; }
    if (lb > longestLen) { longestLen = lb; longest = k; }
  }
  return sharpCos < MAX_TURN ? sharp : longest;
}

/** Optional output of fitArcs. */
export interface ArcFitStats {
  /** Largest distance between a polyline chord and the arc fitted over it (grown, never reset). */
  sagitta: number;
}

/** Records the largest gap between the circle (c, r) and the chords joining pts[i..j], consecutive and closing when `wrap`. */
function noteSagitta(stats: ArcFitStats, c: Vec2, r: number, pts: readonly Vec2[], i: number, j: number, wrap: boolean): void {
  const last = wrap ? j + 1 : j;
  for (let k = i + 1; k <= last; k++) {
    const p = pts[k - 1], q = pts[k % pts.length];
    const s = Math.abs(r - Math.hypot((p.x + q.x) / 2 - c.x, (p.y + q.y) / 2 - c.y));
    if (s > stats.sagitta) stats.sagitta = s;
  }
}

/**
 * Replaces runs of polyline points with lines and arcs that stay within `tol` of every input point.
 * `maxBulge` bounds how far an arc may stray from the polyline between input points. It is unbounded by
 * default, so a coarsely faceted circle (an STL hole) is still recognised as one; callers that need the
 * fitted path to stay near the polyline itself (pocket rings, which must keep their wall clearance) pass a
 * bound and feed polygons whose facets are finer than it.
 */
export function fitArcs(input: readonly Vec2[], closed: boolean, tol: number, maxBulge = Infinity, stats?: ArcFitStats): Path2D {
  let pts = dedupe(input, closed, tol * 1e-3);
  if (pts.length < 2) return { segments: [], closed };
  if (closed) {
    if (pts.length >= 8) {
      // the whole ring as one circle: centre from three spread points, every point within tol
      const c = circumcenter(pts[0], pts[Math.floor(pts.length / 3)], pts[Math.floor((2 * pts.length) / 3)]);
      const turn = Math.sign(cross(pts[0], pts[1], pts[2]));
      if (c && turn !== 0) {
        const r = dist2(c, pts[0]);
        // as in arcThrough: the circle between two consecutive points must stay within maxBulge of the chord
        // joining them; the points themselves may sit up to tol off the circle
        const bulgeOk = (p: Vec2, q: Vec2) => {
          if (maxBulge === Infinity) return true;
          const a0 = Math.atan2(p.y - c.y, p.x - c.x);
          return arcChordBulge(c, r, a0, arcSweepBetween(a0, Math.atan2(q.y - c.y, q.x - c.x), turn > 0), p, q) <= maxBulge;
        };
        if (r <= 1e4 && pts.every((p, k) => Math.abs(dist2(c, p) - r) <= tol && bulgeOk(p, pts[(k + 1) % pts.length]))) {
          if (stats) noteSagitta(stats, c, r, pts, 0, pts.length - 1, true);
          return { closed, segments: [{ kind: 'arc', center: c, radius: r, startAngle: Math.atan2(pts[0].y - c.y, pts[0].x - c.x), sweep: turn * 2 * Math.PI }] };
        }
      }
    }
    const k = fitStart(pts);
    pts = [...pts.slice(k), ...pts.slice(0, k), pts[k]];
  }
  const segments: Segment[] = [];
  const n = pts.length;
  let i = 0;
  while (i < n - 1) {
    let arc: ArcSegment | null = null;
    let arcEnd = -1;
    for (let j = i + 3; j < n && j - i <= MAX_RUN; j++) {
      const a = arcThrough(pts, i, j, tol, maxBulge);
      if (!a) break;
      arc = a;
      arcEnd = j;
    }
    let lineEnd = i + 1;
    for (let j = i + 2; j < n && j - i <= MAX_RUN; j++) {
      if (!lineFits(pts, i, j, tol)) break;
      lineEnd = j;
    }
    if (arc && arcEnd > lineEnd) {
      segments.push(arc);
      if (stats) noteSagitta(stats, arc.center, arc.radius, pts, i, arcEnd, false);
      i = arcEnd;
    } else {
      segments.push({ kind: 'line', from: pts[i], to: pts[lineEnd] });
      i = lineEnd;
    }
  }
  return { segments, closed };
}
