import { differencePolys, offsetPolys, type Poly, polysToRegions, unionPolys } from '../../geometry/offset/clipper';
import type { Tool } from '../../tools/types';
import type { Job } from '../../job/types';
import type { Stroke } from '../vcarve/strokes';

/** The pocket generator keeps its ring paths up to this much farther from the walls than the tool radius (see pocket.ts). */
const pocketMargin = (tol: number) => (2 * tol) / 4 + tol / 8 + tol / 2;

/** The flat end mills of the enabled clearing operations linked to `sourceId` (a clearing without a usable tool clears nothing). */
export function linkedClearingTools(job: Job, sourceId: string): Tool[] {
  return job.operations.flatMap((o) => {
    if (!o.enabled || o.type !== 'vclear' || o.sourceId !== sourceId) return [];
    const t = job.tools.find((x) => x.id === o.toolId);
    return t && (t.type === 'flat' || t.type === 'bull') && t.diameter > 0 ? [t] : [];
  });
}

/**
 * The part of a flat floor (`floor`, normalised polygons) that none of the clearing `tools` cut flat: the floor minus each tool's
 * reach, which is the floor eroded by the tool radius (plus the pocket generator's margin, so this errs towards more residue)
 * and grown back by the radius of the tool's flat bottom (a bull-nose's corner leaves its rim above the floor).
 * Slivers thinner than a few tolerances (where the estimate is conservative) are dropped.
 */
export function floorResidue(floor: readonly Poly[], tools: readonly Tool[], tol: number): Poly[] {
  if (!floor.length) return [];
  const m = pocketMargin(tol);
  let cleared: Poly[] = [];
  for (const t of tools) {
    const r = t.diameter / 2;
    const flat = t.type === 'bull' ? r - Math.min(Math.max(0, t.cornerRadius), r) : r;
    const centres = offsetPolys(floor, -(r + 2 * m), tol / 8);
    if (centres.length && flat > 0) cleared = unionPolys(cleared, offsetPolys(centres, flat, tol / 8));
  }
  const left = cleared.length ? differencePolys(floor, cleared) : [...floor];
  const eps = 1.5 * m;
  return left.length ? offsetPolys(offsetPolys(left, -eps, tol / 8), eps, tol / 8) : [];
}

/**
 * Closed V-bit passes at depth `z` over `residue`, so that every residue point lies within `cover` of a pass: the residue's own
 * boundary and its inward offsets every `0.9 x cover` (a point at distance d inside the residue is at distance d − k·step from the
 * k-th offset's boundary, and some k makes that less than the step).
 */
export function residuePasses(residue: readonly Poly[], z: number, cover: number, tol: number): Stroke[] {
  const step = 0.9 * cover;
  const out: Stroke[] = [];
  if (!(step > 0)) return out;
  for (let k = 0; k < 100000; k++) {
    const level = k === 0 ? residue : offsetPolys(residue, -k * step, tol / 8);
    if (!level.length) break;
    for (const poly of level) if (poly.length >= 3) out.push({ points: poly.map((p) => ({ x: p.x, y: p.y, z })), closed: true });
  }
  return out;
}

/** Drops residue regions that lie wholly in a corner square (side `size`) of the board: the board's own corners, never near the plug. */
export function dropBoardCorners(residue: readonly Poly[], board: { minX: number; minY: number; maxX: number; maxY: number }, size: number): Poly[] {
  return polysToRegions(residue).filter((reg) => {
    const xs = reg.outer.map((p) => p.x), ys = reg.outer.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const inX = x1 <= board.minX + size || x0 >= board.maxX - size;
    const inY = y1 <= board.minY + size || y0 >= board.maxY - size;
    return !(inX && inY);
  }).flatMap((reg) => [reg.outer, ...reg.holes]);
}
