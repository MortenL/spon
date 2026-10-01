import { type Path2D, segmentStart, type Vec2 } from '../path2d';
import { fitArcs } from './arcFit';
import { sweepPolylines } from './clipper';
import { flattenPath } from './pathOps';

export interface OpenOffset { path: Path2D; rounded: boolean }

/**
 * Where a band vertex sits: which side of the path (1 left, −1 right), how far along, and whether on an end cap.
 * A vertex where the offsets of two parts of the line cross is equally near both; `s0`–`s1` is the stretch of
 * line between them, which the tool cannot reach from that side (`s0 = s1 = s` for every other vertex).
 */
interface Mark { side: number; s: number; s0: number; s1: number; cap: 'start' | 'end' | null }
interface Run { pts: Vec2[]; marks: Mark[] }

/**
 * The tool-centre path `distance` to the left or right of an open path, seen along its direction. It is the part
 * of the disc-swept band around the path that lies on that side, without the end caps, so bends too tight for
 * the distance are trimmed (rounded) instead of crossing the line. Like closed-contour offsets, the flattening,
 * join and fit approximations are added to the distance, so the result never comes closer than `distance`.
 *
 * When a bend is so tight that nothing beside the line is left on that side (a U-turn narrower than twice the
 * distance), the two end caps meet there; the result is then the stretch of the caps on that side, which keeps
 * the tool at the mouth of the bend, and it is marked `rounded`.
 */
export function offsetOpenPath(path: Path2D, side: 'left' | 'right', distance: number, tol: number): OpenOffset | null {
  // Tolerance budget: the lower bound (never closer than `distance`) needs flat + join + fit ≤ the added margin;
  // the upper bound (within `distance + tol`) sees margin + flat + fit = 2·flat + join + 2·fit = 0.8·tol.
  const flatTol = tol / 10, joinTol = tol / 10, fitTol = tol / 4;
  const d = distance + flatTol + joinTol + fitTol;
  if (!(distance > 0)) return null;
  // repeated points (where segments meet) would give an edge without a direction
  const pts = flattenPath(path, flatTol).filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-9);
  if (pts.length < 2) return null;
  const want = side === 'left' ? 1 : -1;
  const band = sweepPolylines([{ points: pts, closed: false }], d, joinTol);
  const classify = polylineClassifier(pts, d, joinTol);

  const runs: Run[] = [];
  for (const ring of band) {
    const marks = ring.map(classify);
    const n = ring.length;
    const breakAt = marks.findIndex((m) => m.side !== want);
    if (breakAt < 0) continue; // a ring entirely on one side is a hole inside a tight bend: not a cutting path
    let cur: Run | null = null;
    for (let j = 1; j <= n; j++) {
      const k = (breakAt + j) % n;
      if (marks[k].side === want) {
        cur ??= { pts: [], marks: [] };
        cur.pts.push(ring[k]);
        cur.marks.push(marks[k]);
      } else if (cur) {
        runs.push(cur);
        cur = null;
      }
    }
    if (cur) runs.push(cur);
  }

  // orient each run along the path, then drop the quarter caps at its two ends
  const kept: { run: Run; capsOnly: boolean }[] = [];
  for (const raw of runs) {
    const run = raw.marks[0].s <= raw.marks[raw.marks.length - 1].s ? raw : { pts: [...raw.pts].reverse(), marks: [...raw.marks].reverse() };
    let a = 0, b = run.pts.length;
    while (a < b && run.marks[a].cap === 'start') a++;
    while (b > a && run.marks[b - 1].cap === 'end') b--;
    if (b - a >= 2) kept.push({ run: { pts: run.pts.slice(a, b), marks: run.marks.slice(a, b) }, capsOnly: false });
    else if (run.pts.length >= 2) kept.push({ run, capsOnly: true });
  }
  if (!kept.length) return null;
  const span = (r: Run) => r.marks[r.marks.length - 1].s - r.marks[0].s;
  // a run beside the line wins over one made of caps only; among equals, the one covering most of the line
  kept.sort((x, y) => Number(x.capsOnly) - Number(y.capsOnly) || span(y.run) - span(x.run));
  const best = kept[0];
  // An ordinary inside corner skips the stretch of line around that one corner. A skipped stretch holding two or
  // more corners of the path is a bend narrower than the tool (a U-turn, a slot, a notch), so it was rounded.
  const corners = path.segments.slice(1).map((seg) => classify(segmentStart(seg)).s);
  const skipsBend = best.run.marks.some((m) => corners.filter((c) => c > m.s0 + 1e-6 && c < m.s1 - 1e-6).length >= 2);
  const rounded = kept.length > 1 || best.capsOnly || best.run.marks.some((m) => m.cap !== null) || skipsBend
    || tightBend(path, want, distance);
  const out = fitArcs(best.run.pts, false, fitTol, fitTol);
  return out.segments.length ? { path: out, rounded } : null;
}

/** True when an arc of the path bends toward `want` (1 = left) with a radius no larger than the distance. */
function tightBend(path: Path2D, want: number, distance: number): boolean {
  return path.segments.some((s) => s.kind === 'arc' && Math.sign(s.sweep) === want && s.radius <= distance);
}

/** Ten times Clipper's 10 nm grid: band vertices are rounded to it, so comparisons finer than this are noise. */
const NEAR = 1e-4;

/**
 * Classifies points against the flattened polyline the band was swept from (not the exact path, whose tangent at
 * the first and last point differs slightly from the end chords the caps are built on). A point nearest to a
 * polyline vertex takes its side from the bisector of the two edges meeting there, so the round join on the
 * outside of a corner is on that side throughout. A point beyond either end sits on that end's cap, and its side
 * splits the cap into a left and a right quarter.
 */
function polylineClassifier(pts: readonly Vec2[], d: number, joinTol: number): (v: Vec2) => Mark {
  const n = pts.length;
  const dirs: Vec2[] = [];
  const acc: number[] = [0];
  for (let k = 0; k < n - 1; k++) {
    const dx = pts[k + 1].x - pts[k].x, dy = pts[k + 1].y - pts[k].y;
    const len = Math.hypot(dx, dy);
    dirs.push(len > 0 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 });
    acc.push(acc[k] + len);
  }
  const total = acc[n - 1];
  return (v) => {
    let best = Infinity, seg = 0, t = 0;
    const touching: number[] = [];
    for (let k = 0; k < n - 1; k++) {
      const a = pts[k], dx = pts[k + 1].x - a.x, dy = pts[k + 1].y - a.y;
      const len2 = dx * dx + dy * dy;
      const u = len2 > 0 ? Math.max(0, Math.min(1, ((v.x - a.x) * dx + (v.y - a.y) * dy) / len2)) : 0;
      const e = Math.hypot(v.x - a.x - dx * u, v.y - a.y - dy * u);
      // the band's edge runs exactly d from a segment's side, but its round joins and caps are chords of the
      // circle of radius d around a vertex, up to joinTol inside it
      if (e <= d + NEAR && e >= d - (u <= 0 || u >= 1 ? joinTol : 0) - NEAR) touching.push(acc[k] + u * (acc[k + 1] - acc[k]));
      if (e < best - 1e-12) { best = e; seg = k; t = u; }
    }
    // the nearest point, as a polyline vertex index when it is one
    const vertex = t <= 0 ? seg : t >= 1 ? seg + 1 : -1;
    const s = vertex >= 0 ? acc[vertex] : acc[seg] + t * (acc[seg + 1] - acc[seg]);
    const at = vertex >= 0 ? pts[vertex] : { x: pts[seg].x + t * (pts[seg + 1].x - pts[seg].x), y: pts[seg].y + t * (pts[seg + 1].y - pts[seg].y) };
    const dx = v.x - at.x, dy = v.y - at.y;
    let tan = dirs[seg];
    let cap: Mark['cap'] = null;
    if (vertex === 0) {
      tan = dirs[0];
      if (dx * tan.x + dy * tan.y < -NEAR) cap = 'start';
    } else if (vertex === n - 1) {
      tan = dirs[n - 2];
      if (dx * tan.x + dy * tan.y > NEAR) cap = 'end';
    } else if (vertex > 0) {
      const bx = dirs[vertex - 1].x + dirs[vertex].x, by = dirs[vertex - 1].y + dirs[vertex].y;
      if (Math.hypot(bx, by) > 1e-9) tan = { x: bx, y: by };
    }
    return { side: tan.x * dy - tan.y * dx > 0 ? 1 : -1, s: Math.min(s, total), s0: Math.min(s, ...touching), s1: Math.max(s, ...touching), cap };
  };
}
