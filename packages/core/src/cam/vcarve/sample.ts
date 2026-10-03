import type { Vec2 } from '../../geometry/path2d';

export interface Sample { x: number; y: number; loop: number; s: number }
export interface Corner { p: Vec2; loop: number }
export interface SampledShape { samples: Sample[]; loopLengths: number[]; corners: Corner[]; polys: Vec2[][] }

/** Spec §3.2: four times the tolerance, kept between 0.02 and 0.25 mm. */
export const sampleSpacing = (tol: number): number => Math.min(0.25, Math.max(0.02, 4 * tol));
/** A vertex is a corner only at a turn of 30 degrees or more; flattened curves turn far less at each vertex. */
const TURN = Math.PI / 6 - 1e-9;

/**
 * Evenly spaced samples along closed polygons (outer counter-clockwise, holes clockwise, so the shape is on the left),
 * every vertex kept, each sample tagged with its loop and arc length. Convex corners (left turns of 30 degrees or more, the shape
 * lying on the left) are listed for the centreline's corner edges.
 */
export function sampleShape(polys: Vec2[][], spacing: number): SampledShape {
  const samples: Sample[] = [];
  const loopLengths: number[] = [];
  const corners: Corner[] = [];
  polys.forEach((poly, loop) => {
    const n = poly.length;
    let s = 0;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], prev = poly[(i - 1 + n) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ux = a.x - prev.x, uy = a.y - prev.y, vx = b.x - a.x, vy = b.y - a.y;
      const turn = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      if (turn >= TURN) corners.push({ p: { x: a.x, y: a.y }, loop });
      if (len < 1e-12) continue;
      const k = Math.max(1, Math.ceil(len / spacing));
      for (let j = 0; j < k; j++) samples.push({ x: a.x + (vx * j) / k, y: a.y + (vy * j) / k, loop, s: s + (len * j) / k });
      s += len;
    }
    loopLengths.push(s);
  });
  return { samples, loopLengths, corners, polys };
}
