import { differencePolys, offsetPolys, type Poly, polysToRegions, type Region } from '../../geometry/offset/clipper';
import type { Vec2 } from '../../geometry/path2d';
import { medialGraph } from '../vcarve/medial';
import { sampleShape } from '../vcarve/sample';
import { type Stroke, vcarveStrokes } from '../vcarve/strokes';

/** M ⊕ R as regions (outer + holes), program coordinates. */
export function plugWallRegions(polys: Vec2[][], R: number, tol: number): Region[] {
  return polysToRegions(offsetPolys(polys, R, tol / 8));
}

/** Clarification 2: the plug's floor, the board rectangle (program coordinates) minus the walls' footprint M ⊕ R. */
export function plugFloor(board: { minX: number; minY: number; maxX: number; maxY: number }, polys: Vec2[][], R: number, tol: number): Poly[] {
  const rect = [{ x: board.minX, y: board.minY }, { x: board.maxX, y: board.minY }, { x: board.maxX, y: board.maxY }, { x: board.minX, y: board.maxY }];
  return differencePolys([rect], plugWallRegions(polys, R, tol).flatMap((r) => [r.outer, ...r.holes]));
}

/**
 * Spec §2.3: the plug's wall strokes around M (`polys` = M's flattened loops, outers counter-clockwise, holes clockwise).
 * Depth at a point outside M is `top − (D − g) − min(r, R) / t` with r the distance to M only; the loops of M ⊕ R cut at H.
 * Bias: where the gap between two shapes ends, the strokes stop at the Delaunay hull, so up to about 0.6 mm there is cut a little
 * shallower than ideal. That is conservative: the extra plug material lies above the base surface, in the planed-off S band, so it can't collide.
 * `top` is the surface, `t` the tangent of the half tip angle.
 */
export function plugStrokes(polys: Vec2[][], o: { top: number; t: number; D: number; S: number; g: number; spacing: number; tol: number }): Stroke[] {
  const R = o.S * o.t;
  const loops = plugWallRegions(polys, R, o.tol).flatMap((r) => [r.outer, ...r.holes]);
  // M's loops reversed: the medial graph of the outside, whose reflex corners are M's convex ones' complement
  const samples = sampleShape(polys.map((p) => [...p].reverse()), o.spacing);
  const graph = medialGraph(samples, o.spacing, { outside: true });
  return vcarveStrokes(graph, { top: o.top - (o.D - o.g), tanHalf: o.t, maxDepth: o.S, spacing: o.spacing, tol: o.tol, flatLoops: loops, outline: polys });
}
