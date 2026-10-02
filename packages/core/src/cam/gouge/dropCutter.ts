import type { MeshIndex } from './meshIndex';
import type { ToolShape } from './toolShape';

const EPS_IN = 1e-12;
const SORT_LIMIT = 256;

/** Is (px, py) inside the XY projection of the triangle at offset o (barycentric signs, tolerance 1e-12)? */
function inside(t: Float64Array, o: number, px: number, py: number): boolean {
  const ax = t[o], ay = t[o + 1], bx = t[o + 3], by = t[o + 4], cx = t[o + 6], cy = t[o + 7];
  const d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const d2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const d3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  return (d1 >= -EPS_IN && d2 >= -EPS_IN && d3 >= -EPS_IN) || (d1 <= EPS_IN && d2 <= EPS_IN && d3 <= EPS_IN);
}

/** Tool constants for one call. */
interface Cut {
  R: number;
  R2: number;
  cone: boolean;
  rc: number;
  ring: number;
  invTan: number;
  /** a torus with no corner radius: the profile is 0 inside the disc */
  plain: boolean;
}

/** Profile height at distance d, d clamped into the radius (so clip endpoints stay finite). */
function h(c: Cut, d: number): number {
  if (d > c.R) d = c.R;
  if (c.cone) return d * c.invTan;
  if (d <= c.ring) return 0;
  const e = d - c.ring;
  const q = c.rc * c.rc - e * e;
  return c.rc - (q > 0 ? Math.sqrt(q) : 0);
}

/** XY distance from (x, y) to the box [x0, x1] x [y0, y1]. */
function boxDist(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
  const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Best of `best` and the maximum of g(t) = z(t) - h(d(t)) along the edge a-b clipped to the disc.
 * g is concave (linear z minus a convex, non-decreasing profile of a convex distance), so bisection on the slope
 * over the clipped interval is exact; a cheap upper bound (and tangent bounds while bisecting) skip edges that cannot win.
 */
function edgeBest(c: Cut, ax: number, ay: number, az: number, bx: number, by: number, bz: number, x: number, y: number, best: number): number {
  const dx = bx - ax, dy = by - ay;
  const A = dx * dx + dy * dy;
  if (A < 1e-18) return best; // degenerate in XY: the vertex test covers it
  const ex = ax - x, ey = ay - y;
  const B = 2 * (ex * dx + ey * dy);
  const disc = B * B - 4 * A * (ex * ex + ey * ey - c.R2);
  if (disc < 0) return best;
  const sq = Math.sqrt(disc);
  let t0 = (-B - sq) / (2 * A), t1 = (-B + sq) / (2 * A);
  if (t0 < 0) t0 = 0;
  if (t1 > 1) t1 = 1;
  if (t0 > t1) return best;
  const dz = bz - az;
  const z0 = az + t0 * dz, z1 = az + t1 * dz;
  const zTop = z0 > z1 ? z0 : z1;
  if (zTop <= best) return best;
  if (c.plain) return zTop; // g = z inside the disc: the maximum is an end of the clipped interval
  let tc = -B / (2 * A);
  if (tc < t0) tc = t0; else if (tc > t1) tc = t1;
  const cx = ex + tc * dx, cy = ey + tc * dy;
  if (zTop - h(c, Math.sqrt(cx * cx + cy * cy)) <= best) return best;
  // Bisection on the sign of g' (g is concave, so the maximum stays inside the bracket). The tangent at every
  // midpoint also bounds g over the bracket, so edges that cannot beat `best` stop after a few steps.
  const sqrtA = Math.sqrt(A);
  const tEnd = 1e-10 / sqrtA;
  let lo = t0, hi = t1, upper = Infinity;
  for (let it = 0; it < 64 && hi - lo > tEnd; it++) {
    const m = (lo + hi) * 0.5;
    const px = ex + m * dx, py = ey + m * dy;
    const d = Math.sqrt(px * px + py * py);
    const gv = az + m * dz - h(c, d);
    if (gv > best) best = gv;
    // slope of -h(d(t)) is -h'(d) d'(t); d'(t) = (p . v) / d
    let hp: number;
    if (c.cone) hp = c.invTan;
    else if (d <= c.ring) hp = 0;
    else { const e = (d > c.R ? c.R : d) - c.ring, q = c.rc * c.rc - e * e; hp = q > 1e-18 ? e / Math.sqrt(q) : Infinity; }
    let slope: number;
    if (d < 1e-12) {
      // at the apex of the distance: one-sided slopes decide which way the maximum lies
      const left = dz + hp * sqrtA, right = dz - hp * sqrtA;
      if (left <= 0) slope = left; else if (right >= 0) slope = right; else break;
    } else {
      const dd = (px * dx + py * dy) / d;
      slope = hp === 0 || dd === 0 ? dz : dz - hp * dd;
    }
    let ub: number;
    if (slope > 0) { ub = gv + slope * (hi - m); lo = m; } else { ub = gv - slope * (m - lo); hi = m; }
    if (ub < upper) upper = ub; // NaN and +Infinity never lower the bound
    if (upper <= best + 1e-9) break;
  }
  return best;
}

/**
 * The highest tip Z at which the tool centred at (x, y) touches the mesh, or -Infinity when nothing is under it.
 *
 * Vertices and facets are exact (facets are two-sided: the plane's upward normal is used, so winding does not
 * matter). Edges are maximised exactly by slope bisection over the part inside the tool's disc, since the
 * function along an edge is concave. `tol` is accepted for API symmetry; the edge search converges far below any
 * gouge tolerance on its own.
 *
 * `floor` (optional) is a height the caller does not care to distinguish below: it seeds the search, so candidates that
 * cannot beat it are pruned and `floor` itself is returned when nothing does.
 *
 * Candidates are pruned with upper bounds (top Z minus the profile at the nearest XY distance), cells are visited
 * by upper bound, and cheap vertex and facet tests run for every triangle before any edge search.
 */
export function dropCutter(index: MeshIndex, shape: ToolShape, x: number, y: number, _tol: number, floor = -Infinity): number {
  const R = shape.radius;
  const cone = shape.kind === 'cone';
  const c: Cut = {
    R, R2: R * R, cone, rc: shape.cornerRadius, ring: R - shape.cornerRadius,
    invTan: cone ? 1 / Math.tan(shape.halfAngle) : 0,
    plain: !cone && shape.cornerRadius <= 0,
  };
  const tris = index.tris, normals = index.normals, box = index.triBox;
  const { cellMaxZ, cellStart, cellTris, nx, cell } = index;
  let best = floor;

  // cells under the disc, best upper bound first
  const i0 = index.ix(x - R), i1 = index.ix(x + R), j0 = index.iy(y - R), j1 = index.iy(y + R);
  const want = (i1 - i0 + 1) * (j1 - j0 + 1);
  if (index.scratchCells.length < want) { index.scratchCells = new Int32Array(want * 2); index.scratchKeys = new Float64Array(want * 2); }
  const cells = index.scratchCells, keys = index.scratchKeys;
  let nc = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const ci = j * nx + i;
      if (cellMaxZ[ci] <= best) continue; // also skips empty cells (-Infinity); the profile is never negative
      const cx0 = index.minX + i * cell, cy0 = index.minY + j * cell;
      const cd = boxDist(x, y, cx0 - 1e-9, cy0 - 1e-9, cx0 + cell + 1e-9, cy0 + cell + 1e-9);
      if (cd > R) continue;
      const top = cellMaxZ[ci] - h(c, cd); // upper bound for everything in the cell
      if (nc < SORT_LIMIT) { // insertion sort, descending by upper bound
        let k = nc++;
        while (k > 0 && keys[k - 1] < top) { keys[k] = keys[k - 1]; cells[k] = cells[k - 1]; k--; }
        keys[k] = top; cells[k] = ci;
      } else { keys[nc] = top; cells[nc++] = ci; }
    }
  }

  if (index.scratchTris.length < 64) index.scratchTris = new Int32Array(1024);
  let list = index.scratchTris;
  let nt = 0;
  const stamp = index.nextStamp();
  const stamps = index.stamp;

  // phase 1: vertices and facets
  for (let q = 0; q < nc; q++) {
    const ci = cells[q];
    if (keys[q] <= best) { if (nc <= SORT_LIMIT) break; continue; } // sorted: nothing later can win
    for (let p = cellStart[ci]; p < cellStart[ci + 1]; p++) {
      const tri = cellTris[p];
      const b = tri * 5;
      if (box[b + 4] <= best) continue; // the profile is never negative: a triangle whose top is not above the best cannot win
      if (stamps[tri] === stamp) continue;
      stamps[tri] = stamp;
      const dmin = boxDist(x, y, box[b], box[b + 1], box[b + 2], box[b + 3]);
      if (dmin > R || box[b + 4] - h(c, dmin) <= best) continue;
      const o = tri * 9;
      for (let k = 0; k < 3; k++) {
        const ex = tris[o + k * 3] - x, ey = tris[o + k * 3 + 1] - y;
        const d2 = ex * ex + ey * ey;
        if (d2 <= c.R2) {
          const v = tris[o + k * 3 + 2] - h(c, Math.sqrt(d2));
          if (v > best) best = v;
        }
      }
      const nz = normals[tri * 3 + 2];
      if (nz > 1e-9 || nz < -1e-9) {
        const sg = nz > 0 ? 1 : -1;
        const nxu = normals[tri * 3] * sg, nyu = normals[tri * 3 + 1] * sg, nzu = nz * sg; // upward normal of the plane
        const x0 = tris[o], y0 = tris[o + 1], z0 = tris[o + 2];
        const hl = Math.sqrt(nxu * nxu + nyu * nyu);
        const ux = hl < 1e-12 ? 0 : nxu / hl, uy = hl < 1e-12 ? 0 : nyu / hl;
        if (!cone) {
          // the plane rises opposite to (nx, ny): the contact is on the ring on that side, then one corner radius further along -n
          const px = x - c.ring * ux - c.rc * nxu, py = y - c.ring * uy - c.rc * nyu;
          if (inside(tris, o, px, py)) {
            const v = z0 - (nxu * (px - x0) + nyu * (py - y0)) / nzu + c.rc * nzu - c.rc;
            if (v > best) best = v;
          }
        } else {
          if (inside(tris, o, x, y)) {
            const v = z0 - (nxu * (x - x0) + nyu * (y - y0)) / nzu;
            if (v > best) best = v;
          }
          const px = x - R * ux, py = y - R * uy;
          if (inside(tris, o, px, py)) {
            const v = z0 - (nxu * (px - x0) + nyu * (py - y0)) / nzu - R * c.invTan;
            if (v > best) best = v;
          }
        }
      }
      if (nt === list.length) { const bigger = new Int32Array(list.length * 2); bigger.set(list); index.scratchTris = list = bigger; }
      list[nt++] = tri;
    }
  }

  // phase 2: edges of the triangles that can still beat the best
  for (let q = 0; q < nt; q++) {
    const tri = list[q];
    const b = tri * 5;
    if (box[b + 4] - h(c, boxDist(x, y, box[b], box[b + 1], box[b + 2], box[b + 3])) <= best) continue;
    const o = tri * 9;
    for (let k = 0; k < 3; k++) {
      const a = o + k * 3, e = o + ((k + 1) % 3) * 3;
      best = edgeBest(c, tris[a], tris[a + 1], tris[a + 2], tris[e], tris[e + 1], tris[e + 2], x, y, best);
    }
  }
  return best;
}
