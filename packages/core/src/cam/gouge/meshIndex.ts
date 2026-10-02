import { toProgram, type CamContext } from '../context';
import { vec3 } from '../../geometry/vec3';

/** A uniform XY grid over triangles in program coordinates. */
export class MeshIndex {
  /** 9 numbers per triangle (x, y, z for each vertex). */
  readonly tris: Float64Array;
  /** Unit normal per triangle (0, 0, 0 for a degenerate triangle), from the vertex winding. */
  readonly normals: Float64Array;
  readonly triangleCount: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cell: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly cellStart: Int32Array;
  private readonly cellTris: Int32Array;
  private readonly stamp: Uint32Array;
  private stampNow = 0;

  constructor(tris: Float64Array, cellSize: number) {
    this.tris = tris;
    const n = (this.triangleCount = tris.length / 9);
    this.normals = new Float64Array(n * 3);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let t = 0; t < n; t++) {
      const o = t * 9;
      const ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2];
      const vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const len = Math.hypot(cx, cy, cz);
      if (len > 0) { this.normals[t * 3] = cx / len; this.normals[t * 3 + 1] = cy / len; this.normals[t * 3 + 2] = cz / len; }
      for (let k = 0; k < 3; k++) {
        const x = tris[o + k * 3], y = tris[o + k * 3 + 1];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (n === 0) { minX = minY = 0; maxX = maxY = 0; }
    let cell = Math.max(cellSize, 1e-6);
    // cap the grid at about four million cells
    const span = Math.max(maxX - minX, maxY - minY, 1e-9);
    cell = Math.max(cell, span / 2000);
    this.cell = cell;
    this.minX = minX;
    this.minY = minY;
    this.nx = Math.floor((maxX - minX) / cell) + 1;
    this.ny = Math.floor((maxY - minY) / cell) + 1;
    this.stamp = new Uint32Array(n);

    const counts = new Int32Array(this.nx * this.ny + 1);
    const forCells = (t: number, f: (c: number) => void) => {
      const o = t * 9;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const x = tris[o + k * 3], y = tris[o + k * 3 + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      const i0 = this.ix(x0), i1 = this.ix(x1), j0 = this.iy(y0), j1 = this.iy(y1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * this.nx + i);
    };
    for (let t = 0; t < n; t++) forCells(t, (c) => { counts[c + 1]++; });
    for (let c = 0; c < this.nx * this.ny; c++) counts[c + 1] += counts[c];
    this.cellStart = counts;
    this.cellTris = new Int32Array(counts[this.nx * this.ny]);
    const fill = counts.slice(0, this.nx * this.ny);
    for (let t = 0; t < n; t++) forCells(t, (c) => { this.cellTris[fill[c]++] = t; });
  }

  private ix(x: number): number { return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.minX) / this.cell))); }
  private iy(y: number): number { return Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.minY) / this.cell))); }

  /** Visits each triangle whose XY box overlaps the query box at most once. Not re-entrant. */
  query(minX: number, minY: number, maxX: number, maxY: number, visit: (tri: number) => void): void {
    if (this.triangleCount === 0) return;
    if (this.stampNow === 0xffffffff) { this.stamp.fill(0); this.stampNow = 0; }
    const now = ++this.stampNow;
    const tris = this.tris;
    const i0 = this.ix(minX), i1 = this.ix(maxX), j0 = this.iy(minY), j1 = this.iy(maxY);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * this.nx + i;
        for (let p = this.cellStart[c]; p < this.cellStart[c + 1]; p++) {
          const t = this.cellTris[p];
          if (this.stamp[t] === now) continue;
          this.stamp[t] = now;
          const o = t * 9;
          const x0 = tris[o], x1 = tris[o + 3], x2 = tris[o + 6];
          const y0 = tris[o + 1], y1 = tris[o + 4], y2 = tris[o + 7];
          if (Math.max(x0, x1, x2) < minX || Math.min(x0, x1, x2) > maxX) continue;
          if (Math.max(y0, y1, y2) < minY || Math.min(y0, y1, y2) > maxY) continue;
          visit(t);
        }
      }
    }
  }
}

/** Builds an index from triangles given as 9 numbers each, in program coordinates. */
export function meshIndexFromTriangles(tris: number[][], cellSize: number): MeshIndex {
  const a = new Float64Array(tris.length * 9);
  tris.forEach((t, i) => a.set(t, i * 9));
  return new MeshIndex(a, cellSize);
}

const cache = new WeakMap<object, Map<string, MeshIndex>>();

/** The model mesh in program coordinates, indexed; null without a placed mesh. Cached per geometry, orientation, origin and cell size. */
export function meshIndex(ctx: CamContext, cellSize: number): MeshIndex | null {
  const g = ctx.geometry;
  if (!g || g.kind !== 'mesh' || !ctx.placement) return null;
  const key = JSON.stringify([ctx.job.model?.transform, ctx.origin, cellSize]);
  let byKey = cache.get(g);
  if (!byKey) cache.set(g, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const { positions, indices } = g.mesh;
  const vcount = positions.length / 3;
  const mapped = new Float64Array(vcount * 3);
  for (let i = 0; i < vcount; i++) {
    const p = toProgram(ctx, vec3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
    mapped[i * 3] = p.x; mapped[i * 3 + 1] = p.y; mapped[i * 3 + 2] = p.z;
  }
  const tris = new Float64Array(indices.length * 3);
  for (let k = 0; k < indices.length; k++) {
    const v = indices[k] * 3;
    tris[k * 3] = mapped[v]; tris[k * 3 + 1] = mapped[v + 1]; tris[k * 3 + 2] = mapped[v + 2];
  }
  const index = new MeshIndex(tris, cellSize); // normals are recomputed from the mapped vertices, so rotation and scale are honoured
  byKey.set(key, index);
  return index;
}
