import type { Vec2 } from '../../geometry/path2d';
import type { MedialGraph } from './medial';

export interface StrokePoint { x: number; y: number; z: number }
export interface Stroke { points: StrokePoint[]; closed: boolean }

/** Spec §3.4–3.6: depths, max-depth clipping, the flat-area loops, and the graph walked into strokes. */
export function vcarveStrokes(g: MedialGraph, o: { top: number; tanHalf: number; maxDepth: number | null; spacing: number; tol: number; flatLoops: Vec2[][]; outline?: Vec2[][] }): Stroke[] {
  const R = o.maxDepth === null ? Infinity : o.maxDepth * o.tanHalf;
  const dist = o.outline ? outlineDistance(o.outline, 4 * o.spacing, 3 * R) : null;
  const zAt = (r: number) => o.top - Math.min(r, R) / o.tanHalf;
  const nodeCache = new Map<number, number>();
  const nodeR = (i: number) => {
    let r = nodeCache.get(i);
    if (r === undefined) { r = dist!(g.nodes[i].x, g.nodes[i].y); nodeCache.set(i, r); }
    return r;
  };
  // 1. clip edges at r = R and subdivide to pieces no longer than `spacing`
  type P = { x: number; y: number; r: number };
  const pts: P[] = [];
  const key = new Map<string, number>();
  const id = (p: P) => {
    // the chord between two centreline nodes overestimates the clearance (it is convex between reflex corners): never exceed the true distance
    if (dist) p = { ...p, r: Math.min(p.r, dist(p.x, p.y)) };
    const k = `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
    let i = key.get(k);
    if (i === undefined) { i = pts.push(p) - 1; key.set(k, i); }
    return i;
  };
  const adj = new Map<number, number[]>();
  const edgeSeen = new Set<string>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (edgeSeen.has(k)) return; // coincident nodes merge, so the same edge can arrive twice
    edgeSeen.add(k);
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  };
  for (const [ia, ib] of g.edges) {
    let a: P = g.nodes[ia], b: P = g.nodes[ib];
    if (dist) { a = { ...a, r: Math.min(a.r, nodeR(ia)) }; b = { ...b, r: Math.min(b.r, nodeR(ib)) }; }
    if (a.r > R && b.r > R) continue;
    if (a.r > R || b.r > R) {
      if (a.r > R) [a, b] = [b, a];
      const t = (R - a.r) / (b.r - a.r);
      b = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, r: R };
    }
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / o.spacing));
    let prev = id(a);
    for (let k = 1; k <= n; k++) {
      const q = id({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, r: a.r + ((b.r - a.r) * k) / n });
      link(prev, q);
      prev = q;
    }
  }
  // 2. walk: start at odd-degree vertices first, follow unused edges, one stroke per walk
  const used = new Set<string>();
  const ek = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const free = (v: number) => (adj.get(v) ?? []).filter((w) => !used.has(ek(v, w)));
  const strokes: Stroke[] = [];
  const order = [...adj.keys()].sort((a, b) => (adj.get(b)!.length % 2) - (adj.get(a)!.length % 2));
  for (const s0 of order) {
    while (free(s0).length) {
      const walk = [s0];
      let v = s0;
      for (let next = free(v)[0]; next !== undefined; next = free(v)[0]) { used.add(ek(v, next)); walk.push(next); v = next; }
      strokes.push({ points: walk.map((i) => ({ x: pts[i].x, y: pts[i].y, z: zAt(pts[i].r) })), closed: false });
    }
  }
  // single nodes (no edges): a plunge point (clarification 5)
  if (!g.edges.length) for (const n of g.nodes) strokes.push({ points: [{ x: n.x, y: n.y, z: zAt(n.r) }], closed: false });
  // 3. flat-area loops at max depth
  if (o.maxDepth !== null) for (const loop of o.flatLoops) strokes.push({ points: loop.map((p) => ({ x: p.x, y: p.y, z: o.top - o.maxDepth! })), closed: true });
  // 4. merge points closer than a quarter of tol to the last KEPT point (never to the previous original point, which would collapse
  // a densely sampled stroke to a chord); the stroke's last point always survives, replacing a too-close tail
  const minGap = o.tol / 4;
  return strokes.map((s) => {
    const kept: StrokePoint[] = [];
    s.points.forEach((p, i) => {
      const tail = kept[kept.length - 1];
      if (!tail || Math.hypot(p.x - tail.x, p.y - tail.y) >= minGap) kept.push(p);
      else if (i === s.points.length - 1 && kept.length > 1) kept[kept.length - 1] = p;
    });
    return { ...s, points: kept };
  });
}

/**
 * Distance from a point to the nearest outline segment, through a grid of segments (expanding ring search).
 * A point farther than `cap` from the outline's bounding box returns its box distance (a lower bound above `cap`) without searching,
 * so far-away graph nodes (the plug's Delaunay hull circumcentres) cost nothing.
 */
export function outlineDistance(polys: Vec2[][], minCell: number, cap = Infinity): (x: number, y: number) => number {
  // about one segment per cell on average, so long straight outlines get big cells and a ring search stays short
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity, n = 0;
  for (const poly of polys) for (const p of poly) { bx0 = Math.min(bx0, p.x); by0 = Math.min(by0, p.y); bx1 = Math.max(bx1, p.x); by1 = Math.max(by1, p.y); n++; }
  const cell = Math.max(minCell, 2 * Math.sqrt(Math.max(0, (bx1 - bx0) * (by1 - by0)) / Math.max(1, n)));
  const grid = new Map<string, number[]>();
  const segs: number[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const id = segs.length / 4;
      segs.push(a.x, a.y, b.x, b.y);
      const gx0 = Math.floor(Math.min(a.x, b.x) / cell), gx1 = Math.floor(Math.max(a.x, b.x) / cell);
      const gy0 = Math.floor(Math.min(a.y, b.y) / cell), gy1 = Math.floor(Math.max(a.y, b.y) / cell);
      for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) {
        const k = `${gx},${gy}`;
        const l = grid.get(k);
        if (l) l.push(id); else grid.set(k, [id]);
      }
      x0 = Math.min(x0, gx0); x1 = Math.max(x1, gx1); y0 = Math.min(y0, gy0); y1 = Math.max(y1, gy1);
    }
  }
  const segDist = (px: number, py: number, id: number) => {
    const ax = segs[4 * id], ay = segs[4 * id + 1], bx = segs[4 * id + 2], by = segs[4 * id + 3];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  const maxRing = Math.max(x1 - x0, y1 - y0) + 2;
  return (x, y) => {
    const box = Math.hypot(Math.max(bx0 - x, 0, x - bx1), Math.max(by0 - y, 0, y - by1));
    if (box > cap) return box;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let best = Infinity;
    for (let ring = 0; ring <= maxRing + Math.max(Math.abs(cx - x0), Math.abs(cx - x1), Math.abs(cy - y0), Math.abs(cy - y1)); ring++) {
      // every cell of this ring is at least (ring - 1) * cell away
      if (best <= (ring - 1) * cell) break;
      for (let gx = cx - ring; gx <= cx + ring; gx++) {
        const edge = gx === cx - ring || gx === cx + ring;
        for (let gy = cy - ring; gy <= cy + ring; gy += edge ? 1 : 2 * ring || 1) {
          for (const id of grid.get(`${gx},${gy}`) ?? []) best = Math.min(best, segDist(x, y, id));
        }
      }
    }
    return best;
  };
}
