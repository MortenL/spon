import type { Path2D, Vec2 } from '../path2d';
import { fitArcs } from './arcFit';
import { flattenPath } from './pathOps';

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
interface Piece { pts: Vec2[]; t0: number; t1: number; far: boolean }

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

  const raw = rawOffset(pts, want, d, joinTol / 4);
  // Clip at d − joinTol/2: the raw offset sits at d, its own round joins at most joinTol/4 inside that, so it is
  // never clipped where no other part of the line comes near; what survives is at least d − joinTol/2 away.
  const pieces = clipRaw(raw, pts, d - joinTol / 2).filter((p) => p.t1 - p.t0 >= tol); // drop slivers
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
    if (Math.hypot(b[0].x - end.x, b[0].y - end.y) <= joinTol) {
      prev.pts = [...a, ...b.slice(1)];
      joined = true;
    } else {
      // two pieces whose end edges cross (an inside corner whose shifted edges were joined by a connector):
      // cut both back to the crossing
      const x = crossing(a[a.length - 2], end, b[0], b[1]);
      if (x) {
        prev.pts = [...a.slice(0, -1), x, ...b.slice(1)];
        joined = true;
      }
    }
    if (joined) prev.t1 = next.t1;
    else merged.push(next);
  }
  if (merged.length > 1) rounded = true;
  const paths = merged.map((m) => fitArcs(m.pts, false, fitTol, fitTol)).filter((p) => p.segments.length);
  return paths.length ? { paths, rounded } : null;
}

/** The raw one-sided offset: its points and, per edge, a key (2i for edge i's shifted copy, 2i + 1 for the join after it). */
interface Raw { pts: Vec2[]; keys: number[]; acc: number[]; total: number }

function rawOffset(pts: readonly Vec2[], want: number, d: number, joinTol: number): Raw {
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
  push({ x: pts[0].x + d * normals[0].x, y: pts[0].y + d * normals[0].y }, 0);
  for (let i = 0; i < m; i++) {
    const n = normals[i], q = pts[i + 1];
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
 * The pieces of the raw offset that lie at least `r` from every edge of the line, in order along the raw offset.
 * Each raw edge is tested against the capsule (the disc swept along the edge) of every line edge near it; a grid
 * of the line's edges keeps that local.
 */
function clipRaw(raw: Raw, line: readonly Vec2[], r: number): Piece[] {
  const h = Math.max(r, raw.total / Math.max(1, raw.pts.length - 1));
  const grid = new Map<number, number[]>();
  const key = (x: number, y: number) => x * 1_000_003 + y;
  const span = (lo: number, hi: number) => [Math.floor(lo / h), Math.floor(hi / h)];
  for (let k = 0; k < line.length - 1; k++) {
    const a = line[k], b = line[k + 1];
    const [x0, x1] = span(Math.min(a.x, b.x), Math.max(a.x, b.x));
    const [y0, y1] = span(Math.min(a.y, b.y), Math.max(a.y, b.y));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const list = grid.get(key(x, y));
        if (list) list.push(k);
        else grid.set(key(x, y), [k]);
      }
    }
  }
  const seen = new Int32Array(line.length).fill(-1);
  const pieces: Piece[] = [];
  let cur: Piece | null = null;
  let open = false; // cur runs on to the end of the previous raw edge
  for (let j = 0; j < raw.pts.length - 1; j++) {
    const a = raw.pts[j], b = raw.pts[j + 1];
    const hits: [number, number, number][] = [];
    const [x0, x1] = span(Math.min(a.x, b.x) - r, Math.max(a.x, b.x) + r);
    const [y0, y1] = span(Math.min(a.y, b.y) - r, Math.max(a.y, b.y) + r);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (const k of grid.get(key(x, y)) ?? []) {
          if (seen[k] === j) continue;
          seen[k] = j;
          const hit = capsuleInterval(a, b, line[k], line[k + 1], r);
          if (hit) hits.push([hit[0], hit[1], k]);
        }
      }
    }
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
        cur = { pts: [at(u0), at(u1)], t0: raw.acc[j] + u0 * len, t1: 0, far: !near(by0) };
      }
      cur.t1 = raw.acc[j] + u1 * len;
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
  if (Math.abs(den) < 1e-15) return null;
  const qx = c.x - a.x, qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + t * rx, y: a.y + t * ry } : null;
}
