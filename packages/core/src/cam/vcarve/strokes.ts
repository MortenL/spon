import type { Vec2 } from '../../geometry/path2d';
import type { MedialGraph } from './medial';

export interface StrokePoint { x: number; y: number; z: number }
export interface Stroke { points: StrokePoint[]; closed: boolean }

/** Spec §3.4–3.6: depths, max-depth clipping, the flat-area loops, and the graph walked into strokes. */
export function vcarveStrokes(g: MedialGraph, o: { top: number; tanHalf: number; maxDepth: number | null; spacing: number; tol: number; flatLoops: Vec2[][] }): Stroke[] {
  const R = o.maxDepth === null ? Infinity : o.maxDepth * o.tanHalf;
  const zAt = (r: number) => o.top - Math.min(r, R) / o.tanHalf;
  // 1. clip edges at r = R and subdivide to pieces no longer than `spacing`
  type P = { x: number; y: number; r: number };
  const pts: P[] = [];
  const key = new Map<string, number>();
  const id = (p: P) => {
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
  // 4. merge points closer than tol
  return strokes.map((s) => ({ ...s, points: s.points.filter((p, i, a) => i === 0 || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) >= o.tol || i === a.length - 1) }));
}
