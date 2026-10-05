import { flattenPath, pathFromPoints } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import type { TabZone } from './writer';

/** Longest tab bridge (mm) a pocket leaves; longer ones are skipped with a warning (spec §4, Pocket). */
export const MAX_BRIDGE = 50;

/** Chord tolerance for the boundaries the bridges are cast against. */
const FLATTEN_TOL = 1e-3;
/** Hits closer than this to a ray's origin are the edge it starts on. */
const MIN_T = 1e-6;

/** Parameters t of every crossing of the line o + t·d with the polygons' edges. */
function crossings(o: Vec2, d: Vec2, polys: readonly (readonly Vec2[])[]): number[] {
  const out: number[] = [];
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      const ex = b.x - a.x, ey = b.y - a.y;
      const den = d.x * ey - d.y * ex;
      if (Math.abs(den) < 1e-12) continue; // parallel
      const ax = a.x - o.x, ay = a.y - o.y;
      const u = (ax * d.y - ay * d.x) / den; // along the edge
      if (u < -1e-12 || u > 1 + 1e-12) continue;
      out.push((ax * ey - ay * ex) / den);
    }
  }
  return out;
}

/** Nearest crossing beyond `from` (Infinity if there is none). */
const firstAfter = (ts: readonly number[], from: number) => ts.reduce((m, t) => (t > from && t < m ? t : m), Infinity);

/**
 * Tab bridges of one island of a pocket region: for each centre (a point on the island's edge and the edge's outward
 * normal, pointing into the pocket), a strip `width` wide along the normal from the island's edge to its first hit
 * with the outer boundary or another island. The strip's ends follow the boundaries it joins: each side of the strip
 * starts where it meets the island (a round island curves away from the tab point) and ends at its own first hit, at
 * most a strip width past the centre line's, so a slanted wall is met along the whole end. A strip whose centre line
 * is longer than {@link MAX_BRIDGE} (or never hits anything) is not made and is counted in `tooLong`.
 */
export function bridgeZones(
  region: { outer: Path2D; islands: Path2D[] }, island: number, centers: readonly { point: Vec2; normal: Vec2 }[], width: number, top: number,
  shape: TabZone['shape'],
): { zones: TabZone[]; tooLong: number } {
  const islands = region.islands.map((p) => flattenPath(p, FLATTEN_TOL));
  const all = [flattenPath(region.outer, FLATTEN_TOL), ...islands];
  const own = islands[island] ? [islands[island]] : [];
  const half = Math.max(0, width) / 2;
  const zones: TabZone[] = [];
  let tooLong = 0;
  for (const c of centers) {
    const nl = Math.hypot(c.normal.x, c.normal.y);
    if (!(nl > 0)) continue;
    const n = { x: c.normal.x / nl, y: c.normal.y / nl };
    const u = { x: -n.y, y: n.x };
    const at = (off: number, t: number): Vec2 => ({ x: c.point.x + u.x * off + n.x * t, y: c.point.y + u.y * off + n.y * t });
    const len = firstAfter(crossings(c.point, n, all), MIN_T);
    if (!(len <= MAX_BRIDGE)) {
      tooLong++;
      continue;
    }
    // each side of the strip: where it meets the island (the crossing nearest the tangent line, within a width)
    // and its first hit beyond that
    const side = (off: number): { t0: number; t1: number } => {
      const o = at(off, 0);
      let t0 = Infinity;
      for (const t of crossings(o, n, own)) if (Math.abs(t) <= width && Math.abs(t) < Math.abs(t0)) t0 = t;
      if (!Number.isFinite(t0)) t0 = 0;
      const t1 = firstAfter(crossings(o, n, all), t0 + MIN_T);
      return { t0, t1: Math.min(Number.isFinite(t1) ? t1 : len, len + width) };
    };
    const a = side(-half), b = side(half);
    const polygon = pathFromPoints([at(-half, a.t0), at(0, 0), at(half, b.t0), at(half, b.t1), at(0, len), at(-half, a.t1)], true);
    zones.push({ polygon, top, shape });
  }
  return { zones, tooLong };
}
