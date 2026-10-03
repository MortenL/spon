import { Delaunay } from 'd3-delaunay';
import { pointInPolys } from '../../geometry/offset/clipper';
import type { SampledShape } from './sample';

export interface MedialNode { x: number; y: number; r: number }
export interface MedialGraph { nodes: MedialNode[]; edges: [number, number][] }

/**
 * Spec §3.3: the shape's centreline as the circumcentres of the inside Delaunay triangles of its outline samples,
 * joined across shared triangle edges whose two samples are far apart along the outline (or on different outlines),
 * (`outside`: the circumcentres outside the polygons instead, for the plug's walls),
 * plus an edge from every convex corner to the nearest small node, so corners are reached exactly.
 */
export function medialGraph(shape: SampledShape, spacing: number, opts: { outside?: boolean } = {}): MedialGraph {
  const keepInside = !opts.outside;
  const { samples, loopLengths } = shape;
  const nodes: MedialNode[] = [];
  const edges: [number, number][] = [];
  if (samples.length < 3) return { nodes, edges };
  const d = Delaunay.from(samples, (p) => p.x, (p) => p.y);
  const { triangles, halfedges } = d;
  const triNode = new Int32Array(triangles.length / 3).fill(-1);
  for (let t = 0; t < triangles.length / 3; t++) {
    const a = samples[triangles[3 * t]], b = samples[triangles[3 * t + 1]], c = samples[triangles[3 * t + 2]];
    const dd = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(dd) < 1e-18) continue;
    const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
    const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / dd;
    const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / dd;
    const r = Math.hypot(a.x - x, a.y - y);
    if (!Number.isFinite(x + y + r) || r <= 0 || pointInPolys({ x, y }, shape.polys) !== keepInside) continue;
    triNode[t] = nodes.push({ x, y, r }) - 1;
  }
  const along = (i: number, j: number) => {
    const p = samples[i], q = samples[j];
    if (p.loop !== q.loop) return Infinity;
    const L = loopLengths[p.loop], ds = Math.abs(p.s - q.s);
    return Math.min(ds, L - ds);
  };
  for (let e = 0; e < halfedges.length; e++) {
    const o = halfedges[e];
    if (o < e) continue; // each shared edge once (o === -1 is a hull edge: skipped by o < e)
    const t1 = triNode[Math.floor(e / 3)], t2 = triNode[Math.floor(o / 3)];
    if (t1 < 0 || t2 < 0) continue;
    const p = triangles[e], q = triangles[e % 3 === 2 ? e - 2 : e + 1];
    if (along(p, q) > 3 * spacing) edges.push([t1, t2]);
  }
  const cell = 6 * spacing;
  const grid = new Map<string, number[]>();
  nodes.forEach((n, i) => {
    if (n.r > 3 * spacing) return;
    const key = `${Math.floor(n.x / cell)},${Math.floor(n.y / cell)}`;
    const list = grid.get(key);
    if (list) list.push(i); else grid.set(key, [i]);
  });
  for (const c of shape.corners) {
    let best = -1, bestD = 6 * spacing;
    const cx = Math.floor(c.p.x / cell), cy = Math.floor(c.p.y / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (const i of grid.get(`${gx},${gy}`) ?? []) {
        const dd = Math.hypot(nodes[i].x - c.p.x, nodes[i].y - c.p.y);
        if (dd < bestD || (dd === bestD && i > best)) { best = i; bestD = dd; }
      }
    }
    if (best >= 0) edges.push([best, nodes.push({ x: c.p.x, y: c.p.y, r: 0 }) - 1]);
  }
  return { nodes, edges };
}
