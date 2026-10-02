import type { MeshIndex } from './meshIndex';
import { profileHeight, type ToolShape } from './toolShape';

const GOLDEN = 0.6180339887498949;
const REFINE_ITERATIONS = 12;
const EPS_IN = 1e-12;

/** Is (px, py) inside the XY projection of the triangle at offset o (barycentric signs, tolerance 1e-12)? */
function inside(t: Float64Array, o: number, px: number, py: number): boolean {
  const ax = t[o], ay = t[o + 1], bx = t[o + 3], by = t[o + 4], cx = t[o + 6], cy = t[o + 7];
  const d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const d2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const d3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  return (d1 >= -EPS_IN && d2 >= -EPS_IN && d3 >= -EPS_IN) || (d1 <= EPS_IN && d2 <= EPS_IN && d3 <= EPS_IN);
}

/** The tool surface height at distance d, with d clamped into the radius so clip endpoints stay finite. */
function profileClamped(shape: ToolShape, d: number): number {
  return profileHeight(shape, d > shape.radius ? shape.radius : d);
}

/**
 * The highest tip Z at which the tool centred at (x, y) touches the mesh, or -Infinity when nothing is under it.
 * Vertices and facets are exact. Edges are sampled over the part inside the tool's disc at min(tol, R / 32)
 * and the best sample is refined by golden-section search; the function along an edge is concave
 * (linear z minus a convex, non-decreasing profile of a convex distance), so the refinement bracket
 * [best - ds, best + ds] always contains the true maximum.
 */
export function dropCutter(index: MeshIndex, shape: ToolShape, x: number, y: number, tol: number): number {
  const R = shape.radius;
  const R2 = R * R;
  const tris = index.tris;
  const normals = index.normals;
  const isCone = shape.kind === 'cone';
  const rc = shape.cornerRadius;
  const ring = R - rc;
  const invTan = isCone ? 1 / Math.tan(shape.halfAngle) : 0;
  const ds = Math.max(Math.min(tol, R / 32), R / 4096);
  let best = -Infinity;

  const edge = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): void => {
    const dx = bx - ax, dy = by - ay;
    const A = dx * dx + dy * dy;
    if (A < 1e-18) return; // degenerate in XY: the vertex test covers it
    const ex = ax - x, ey = ay - y;
    const B = 2 * (ex * dx + ey * dy);
    const C = ex * ex + ey * ey - R2;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return;
    const sq = Math.sqrt(disc);
    let t0 = (-B - sq) / (2 * A), t1 = (-B + sq) / (2 * A);
    if (t0 < 0) t0 = 0;
    if (t1 > 1) t1 = 1;
    if (t0 > t1) return;
    const dz = bz - az;
    const g = (t: number): number => az + t * dz - profileClamped(shape, Math.hypot(ex + t * dx, ey + t * dy));
    const len = (t1 - t0) * Math.sqrt(A);
    const n = Math.max(1, Math.ceil(len / ds));
    const step = (t1 - t0) / n;
    let bi = 0, bv = -Infinity;
    for (let i = 0; i <= n; i++) {
      const v = g(i === n ? t1 : t0 + i * step);
      if (v > bv) { bv = v; bi = i; }
    }
    if (bv > best) best = bv;
    let lo = Math.max(t0, t0 + (bi - 1) * step), hi = Math.min(t1, t0 + (bi + 1) * step);
    let m1 = hi - GOLDEN * (hi - lo), m2 = lo + GOLDEN * (hi - lo);
    let f1 = g(m1), f2 = g(m2);
    for (let it = 0; it < REFINE_ITERATIONS; it++) {
      if (f1 < f2) {
        lo = m1; m1 = m2; f1 = f2; m2 = lo + GOLDEN * (hi - lo); f2 = g(m2);
      } else {
        hi = m2; m2 = m1; f2 = f1; m1 = hi - GOLDEN * (hi - lo); f1 = g(m1);
      }
      if (f1 > best) best = f1;
      if (f2 > best) best = f2;
    }
  };

  index.query(x - R, y - R, x + R, y + R, (tri) => {
    const o = tri * 9;
    // vertices
    for (let k = 0; k < 3; k++) {
      const px = tris[o + k * 3], py = tris[o + k * 3 + 1];
      const d = Math.hypot(px - x, py - y);
      if (d <= R) {
        const v = tris[o + k * 3 + 2] - profileHeight(shape, d);
        if (v > best) best = v;
      }
    }
    // facet
    const nx = normals[tri * 3], ny = normals[tri * 3 + 1], nz = normals[tri * 3 + 2];
    if (nz > 1e-9) {
      const x0 = tris[o], y0 = tris[o + 1], z0 = tris[o + 2];
      const planeZ = (px: number, py: number): number => z0 - (nx * (px - x0) + ny * (py - y0)) / nz;
      const h = Math.hypot(nx, ny);
      const ux = h < 1e-12 ? 0 : nx / h, uy = h < 1e-12 ? 0 : ny / h;
      if (!isCone) {
        // the plane rises opposite to (nx, ny): the contact sits on the ring on that side, then one corner radius further along -n
        const px = x - ring * ux - rc * nx, py = y - ring * uy - rc * ny;
        if (inside(tris, o, px, py)) {
          const v = planeZ(px, py) + rc * nz - rc;
          if (v > best) best = v;
        }
      } else {
        if (inside(tris, o, x, y)) {
          const v = planeZ(x, y);
          if (v > best) best = v;
        }
        const px = x - R * ux, py = y - R * uy;
        if (inside(tris, o, px, py)) {
          const v = planeZ(px, py) - R * invTan;
          if (v > best) best = v;
        }
      }
    }
    // edges
    for (let k = 0; k < 3; k++) {
      const a = o + k * 3, b = o + ((k + 1) % 3) * 3;
      edge(tris[a], tris[a + 1], tris[a + 2], tris[b], tris[b + 1], tris[b + 2]);
    }
  });
  return best;
}
