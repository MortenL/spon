import type { Path2D, Vec2 } from '../path2d';
import { fitArcs } from './arcFit';
import { flattenPath, pathLength, pointAt } from './pathOps';

/**
 * The tool-centre paths beside an open line. `paths` are the pieces that remain, in order along the line and each
 * running in its direction. `rounded` is true when the tool could not follow some stretch of the line on that side
 * (beyond the ordinary inside corner it cannot get into), so that stretch is left uncut.
 */
export interface OpenOffset { paths: Path2D[]; rounded: boolean }

/**
 * A kept piece of the raw offset: its points, where it starts and ends along the raw offset, and whether either end
 * was cut by an edge of the line other than the one the raw edge came from or its neighbours (more than an inside
 * corner was lost there).
 */
interface Piece { pts: Vec2[]; t0: number; t1: number; k0: number; k1: number; far: boolean }

/**
 * The tool-centre path `distance` to the left or right of an open path, seen along its direction.
 *
 * Each edge of the flattened line is shifted sideways (the raw offset). Corners turning away from that side get a
 * round join; at corners turning toward it the two shifted edges are cut back to where they cross, or just
 * connected when they do not meet. There are no end caps, so nothing lies beyond the line's ends. Everything
 * closer to the line than the distance is then clipped away, exactly, against the disc-swept capsule of each edge.
 * That removes what is left of each inside corner, and whole bends too tight for the tool. Pieces that meet again
 * are joined.
 *
 * `rounded` is true when more than one piece remains, or when the clip cut the raw offset with any part of the line
 * other than the edges next to that part of it (which is all an inside corner does). Like closed-contour offsets,
 * the flattening, join and fit approximations are added to the distance, so the result never comes closer than
 * `distance` and stays within 0.8·tol of it. The result is null when nothing remains.
 *
 * Cost: close to linear in the number of flattened points (a grid keeps the clip local).
 */
export function offsetOpenPath(path: Path2D, side: 'left' | 'right', distance: number, tol: number): OpenOffset | null {
  if (!(distance > 0)) return null;
  const flatTol = tol / 10, joinTol = tol / 10, fitTol = tol / 4;
  const d = distance + flatTol + joinTol + fitTol;
  // repeated points (where segments meet) would give an edge without a direction
  const pts = flattenPath(path, flatTol).filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-9);
  if (pts.length < 2) return null;
  const want = side === 'left' ? 1 : -1;

  // the two ends sit level with the line's own ends, square to its true direction there (not the end chords')
  const ends = [pointAt(path, 0).tangent, pointAt(path, pathLength(path)).tangent];
  const raw = rawOffset(pts, want, d, joinTol / 4, ends);
  // Clip at d − joinTol/2: the raw offset sits at d, its own round joins at most joinTol/4 inside that, so it is
  // never clipped where no other part of the line comes near; what survives is at least d − joinTol/2 away.
  const index = new LineIndex(pts, d);
  const pieces = clipRaw(raw, index, d - joinTol / 2).filter((p) => p.t1 - p.t0 >= tol); // drop slivers
  if (!pieces.length) return null;

  // An inside corner clips each shifted edge only where the neighbouring edge comes within the distance. A cut by
  // any other part of the line means a bend too tight to follow (a slot, a notch, a U-turn) was left out.
  let rounded = pieces.some((p) => p.far);
  const merged: Piece[] = [pieces[0]];
  for (const next of pieces.slice(1)) {
    const prev = merged[merged.length - 1];
    const a = prev.pts, b = next.pts;
    const end = a[a.length - 1];
    let joined = false;
    // Two pieces of one shifted edge were cut apart by something in between: never bridge them. Any other join
    // must stay clear of the line (by the distance less the join budget), which it checks.
    if (prev.k1 !== next.k0) {
      if (Math.hypot(b[0].x - end.x, b[0].y - end.y) <= joinTol) {
        const mid = { x: (b[0].x + end.x) / 2, y: (b[0].y + end.y) / 2 };
        if (index.clearance(mid) >= d - joinTol) {
          prev.pts = [...a, ...b.slice(1)];
          joined = true;
        }
      } else {
        // two pieces whose end edges cross (the shifted edges of an inside corner that were joined by a connector,
        // or of edges either side of a short one): cut both back to the crossing
        const x = crossing(a[a.length - 2], end, b[0], b[1]);
        if (x && index.clearance(x) >= d - joinTol) {
          prev.pts = [...a.slice(0, -1), x, ...b.slice(1)];
          joined = true;
        }
      }
    }
    if (joined) {
      prev.t1 = next.t1;
      prev.k1 = next.k1;
      prev.far ||= next.far;
    }
    else merged.push(next);
  }
  if (merged.length > 1) rounded = true;
  const paths = merged.map((m) => fitArcs(m.pts, false, fitTol, fitTol)).filter((p) => p.segments.length);
  return paths.length ? { paths, rounded } : null;
}

/** The raw one-sided offset: its points and, per edge, a key (2i for edge i's shifted copy, 2i + 1 for the join after it). */
interface Raw { pts: Vec2[]; keys: number[]; acc: number[]; total: number }

function rawOffset(pts: readonly Vec2[], want: number, d: number, joinTol: number, ends: readonly Vec2[]): Raw {
  const m = pts.length - 1;
  const normals: Vec2[] = [];
  const dirs: Vec2[] = [];
  for (let i = 0; i < m; i++) {
    const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy);
    dirs.push({ x: dx / len, y: dy / len });
    normals.push({ x: (-dy / len) * want, y: (dx / len) * want }); // left normal for want = 1
  }
  const out: Vec2[] = [];
  const keys: number[] = [];
  const push = (p: Vec2, key: number) => {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) <= 1e-9) return;
    if (out.length) keys.push(key);
    out.push(p);
  };
  const step = 2 * Math.acos(Math.max(-1, 1 - joinTol / d));
  const side = (t: Vec2): Vec2 => ({ x: -t.y * want, y: t.x * want });
  const n0 = side(ends[0]), nEnd = side(ends[1]);
  push({ x: pts[0].x + d * n0.x, y: pts[0].y + d * n0.y }, 0);
  for (let i = 0; i < m; i++) {
    const n = i === m - 1 ? nEnd : normals[i], q = pts[i + 1];
    push({ x: q.x + d * n.x, y: q.y + d * n.y }, 2 * i);
    if (i === m - 1) break;
    const n1 = normals[i + 1];
    const turn = (dirs[i].x * dirs[i + 1].y - dirs[i].y * dirs[i + 1].x) * want;
    const back = dirs[i].x * dirs[i + 1].x + dirs[i].y * dirs[i + 1].y < 0;
    // a corner turning away from the side (or reversing) gets a round join; one turning toward it is cut back to
    // the crossing of the two shifted edges, or (when they do not meet) gets a plain connector for the clip to remove
    if (turn < -1e-12 || (Math.abs(turn) <= 1e-12 && back)) {
      const a0 = Math.atan2(n.y, n.x);
      let sweep = Math.atan2(n.x * n1.y - n.y * n1.x, n.x * n1.x + n.y * n1.y);
      if (Math.abs(turn) <= 1e-12) sweep = -want * Math.PI; // a hairpin: around the tip
      const k = Math.max(1, Math.ceil(Math.abs(sweep) / step));
      for (let j = 1; j < k; j++) {
        const a = a0 + (sweep * j) / k;
        push({ x: q.x + d * Math.cos(a), y: q.y + d * Math.sin(a) }, 2 * i + 1);
      }
    } else if (out.length >= 2) {
      // a corner turning toward the side: where the two shifted edges cross, cut both back to the crossing
      const next = pts[i + 2];
      const x = crossing(out[out.length - 2], out[out.length - 1], { x: q.x + d * n1.x, y: q.y + d * n1.y }, { x: next.x + d * n1.x, y: next.y + d * n1.y });
      if (x) {
        out[out.length - 1] = x;
        continue;
      }
    }
    push({ x: q.x + d * n1.x, y: q.y + d * n1.y }, 2 * i + 1);
  }
  const acc = [0];
  for (let j = 1; j < out.length; j++) acc.push(acc[j - 1] + Math.hypot(out[j].x - out[j - 1].x, out[j].y - out[j - 1].y));
  return { pts: out, keys, acc, total: acc[acc.length - 1] };
}

/**
 * The line's edges in a uniform grid, for finding the edges near a point or a segment. An edge is entered only in
 * the cells it passes through (sampled every half cell), not every cell of its bounding box, so one long diagonal
 * edge among many short ones costs cells in proportion to its length, not its area.
 */
class LineIndex {
  private readonly h: number;
  private readonly reachCells: number;
  private readonly grid = new Map<number, number[]>();
  private readonly stamp: Int32Array;
  private query = 0;

  /** `reach`: the largest distance queries look for (it sets the cell size together with the edge lengths). */
  private readonly reach: number;

  constructor(readonly pts: readonly Vec2[], reach: number) {
    const lens = pts.slice(1).map((p, k) => Math.hypot(p.x - pts[k].x, p.y - pts[k].y)).sort((x, y) => x - y);
    // cells a third of the reach (or the typical edge, when longer) keep the candidates near what is really in reach
    this.h = Math.max(reach / 3, lens[lens.length >> 1] ?? 0, 1e-6);
    // a point within reach of a sample's neighbourhood: reach, plus a quarter cell either side for the sampling
    this.reachCells = Math.ceil(reach / this.h + 0.5);
    this.reach = reach;
    this.stamp = new Int32Array(pts.length).fill(-1);
    for (let k = 0; k < pts.length - 1; k++) {
      let last = NaN;
      this.walk(pts[k], pts[k + 1], (cx, cy) => {
        const key = cellKey(cx, cy);
        if (key === last) return;
        last = key;
        const list = this.grid.get(key);
        if (list) {
          if (list[list.length - 1] !== k) list.push(k);
        } else {
          this.grid.set(key, [k]);
        }
      });
    }
  }

  /** Calls `fn` once for every point sampled every half cell along a–b, with its cell. */
  private walk(a: Vec2, b: Vec2, fn: (cx: number, cy: number) => void) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (this.h / 2)));
    for (let i = 0; i <= n; i++) {
      fn(Math.floor((a.x + ((b.x - a.x) * i) / n) / this.h), Math.floor((a.y + ((b.y - a.y) * i) / n) / this.h));
    }
  }

  /**
   * Calls `fn` once for every edge that may come within the reach of segment a–b. A point of an edge within reach
   * of the segment is within reach plus a quarter cell of one of the segment's samples, and a quarter cell from one
   * of its own edge's samples, so the cells within reach + half a cell around each sample's cell cover it.
   */
  near(a: Vec2, b: Vec2, fn: (k: number) => void) {
    const q = this.query++;
    let lx = NaN, ly = NaN;
    this.walk(a, b, (cx, cy) => {
      if (cx === lx && cy === ly) return;
      lx = cx;
      ly = cy;
      const R = this.reachCells;
      for (let x = cx - R; x <= cx + R; x++) {
        for (let y = cy - R; y <= cy + R; y++) {
          for (const k of this.grid.get(cellKey(x, y)) ?? []) {
            if (this.stamp[k] === q) continue;
            this.stamp[k] = q;
            fn(k);
          }
        }
      }
    });
  }

  /** The distance from p to the line, or the reach when nothing is nearer. */
  clearance(p: Vec2): number {
    let best = this.reach;
    this.near(p, p, (k) => { best = Math.min(best, segmentDistance(p, this.pts[k], this.pts[k + 1])); });
    return best;
  }
}

const cellKey = (x: number, y: number) => x * 1_000_003 + y;

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - a.x - dx * u, p.y - a.y - dy * u);
}

/**
 * The pieces of the raw offset that lie at least `r` from every edge of the line, in order along the raw offset.
 * Each raw edge is tested against the capsule (the disc swept along the edge) of every line edge near it.
 */
function clipRaw(raw: Raw, index: LineIndex, r: number): Piece[] {
  const line = index.pts;
  const pieces: Piece[] = [];
  let cur: Piece | null = null;
  let open = false; // cur runs on to the end of the previous raw edge
  for (let j = 0; j < raw.pts.length - 1; j++) {
    const a = raw.pts[j], b = raw.pts[j + 1];
    const hits: [number, number, number][] = [];
    const minX = Math.min(a.x, b.x) - r, maxX = Math.max(a.x, b.x) + r;
    const minY = Math.min(a.y, b.y) - r, maxY = Math.max(a.y, b.y) + r;
    index.near(a, b, (k) => {
      const c = line[k], e = line[k + 1];
      // boxes apart: the capsule cannot reach the edge
      if (Math.max(c.x, e.x) <= minX || Math.min(c.x, e.x) >= maxX || Math.max(c.y, e.y) <= minY || Math.min(c.y, e.y) >= maxY) return;
      const hit = capsuleInterval(a, b, c, e, r);
      if (hit) hits.push([hit[0], hit[1], k]);
    });
    // the parts of [0, 1] outside every capsule, with the line edge that cut each end (−1: not cut)
    hits.sort((p, q) => p[0] - q[0]);
    const kept: [number, number, number, number][] = [];
    let u = 0, uBy = -1;
    for (const [lo, hi, k] of hits) {
      if (lo > u) kept.push([u, lo, uBy, k]);
      if (hi > u) { u = hi; uBy = k; }
    }
    if (u < 1) kept.push([u, 1, uBy, -1]);
    // the line edges an inside corner may cut this raw edge with: its own edge's neighbours, or a join's two edges
    const src = raw.keys[j];
    const near = (k: number) => k < 0 || (src % 2 === 0 ? Math.abs(k - src / 2) <= 1 : k === (src - 1) / 2 || k === (src + 1) / 2);
    const len = raw.acc[j + 1] - raw.acc[j];
    const at = (v: number) => ({ x: a.x + (b.x - a.x) * v, y: a.y + (b.y - a.y) * v });
    const wasOpen = open;
    open = false;
    for (const [u0, u1, by0, by1] of kept) {
      if ((u1 - u0) * len <= 1e-9) continue;
      if (cur && wasOpen && u0 === 0) {
        cur.pts.push(at(u1));
      } else {
        if (cur) pieces.push(cur);
        cur = { pts: [at(u0), at(u1)], t0: raw.acc[j] + u0 * len, t1: 0, k0: src, k1: src, far: !near(by0) };
      }
      cur.t1 = raw.acc[j] + u1 * len;
      cur.k1 = src;
      if (!near(by1)) cur.far = true;
      open = u1 === 1;
    }
  }
  if (cur) pieces.push(cur);
  return pieces;
}

/** The part of segment a–b (as parameters in [0, 1]) strictly inside the capsule of radius r around c–d, if any. */
function capsuleInterval(a: Vec2, b: Vec2, c: Vec2, d: Vec2, r: number): [number, number] | null {
  const vx = b.x - a.x, vy = b.y - a.y;
  let lo = Infinity, hi = -Infinity;
  const add = (i: [number, number] | null) => {
    if (i && i[0] < i[1]) { lo = Math.min(lo, i[0]); hi = Math.max(hi, i[1]); }
  };
  const disc = (o: Vec2): [number, number] | null => {
    const wx = a.x - o.x, wy = a.y - o.y;
    const qa = vx * vx + vy * vy, qb = vx * wx + vy * wy, qc = wx * wx + wy * wy - r * r;
    const det = qb * qb - qa * qc;
    if (det <= 0 || qa === 0) return null;
    const sq = Math.sqrt(det);
    return [(-qb - sq) / qa, (-qb + sq) / qa];
  };
  // α + βu strictly between lo and hi
  const band = (al: number, be: number, l: number, h: number): [number, number] | null => {
    if (Math.abs(be) < 1e-300) return al > l && al < h ? [-Infinity, Infinity] : null;
    const u0 = (l - al) / be, u1 = (h - al) / be;
    return u0 < u1 ? [u0, u1] : [u1, u0];
  };
  add(disc(c));
  add(disc(d));
  const ex = d.x - c.x, ey = d.y - c.y, el = Math.hypot(ex, ey);
  if (el > 0) {
    const tx = ex / el, ty = ey / el;
    const wx = a.x - c.x, wy = a.y - c.y;
    const across = band(tx * wy - ty * wx, tx * vy - ty * vx, -r, r);
    const along = band(tx * wx + ty * wy, tx * vx + ty * vy, 0, el);
    if (across && along) add([Math.max(across[0], along[0]), Math.min(across[1], along[1])]);
  }
  lo = Math.max(lo, 0);
  hi = Math.min(hi, 1);
  return lo < hi ? [lo, hi] : null;
}

/** Where segments a–b and c–d cross, if they do. */
function crossing(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  // parallel, relative to the lengths: collinear pieces must never be found to cross through float noise
  if (Math.abs(den) <= 1e-9 * Math.hypot(rx, ry) * Math.hypot(sx, sy)) return null;
  const qx = c.x - a.x, qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + t * rx, y: a.y + t * ry } : null;
}
