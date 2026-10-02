import { differencePolys, type Poly, sweepPolylines } from '../../geometry/offset/clipper';
import { flattenPath, pathLength, subPath } from '../../geometry/offset/pathOps';
import type { Path2D, Segment, Vec2 } from '../../geometry/path2d';
import { endFrame } from '../features/slots';
import type { ResolvedSlot } from '../features/resolve';
import type { SlotEnd, SlotOp } from '../types';

/** Where the tool-centre region stops at an end: a signed distance (mm) along the outward tangent from the centreline end; null = a round end. */
export type EndCut = number | null;
export interface SlotCuts { start: EndCut; end: EndCut }
type SquareEnds = NonNullable<SlotOp['squareEnds']>;

/** Plan clarification 6: round ends are not cut; open ends run out r + 1 mm; square ends stop at the wall (endWall) or r + stock inside it. */
export function slotCuts(slot: Pick<ResolvedSlot, 'centreline' | 'startEnd' | 'endEnd'>, r: number, squareEnds: SquareEnds, stockRadial: number): SlotCuts {
  if (slot.centreline.closed) return { start: null, end: null };
  const cut = (e: SlotEnd): EndCut => (e === 'round' ? null : e === 'open' ? r + 1 : squareEnds === 'endWall' ? 0 : -(r + stockRadial));
  return { start: cut(slot.startEnd), end: cut(slot.endEnd) };
}

const lineSeg = (from: Vec2, to: Vec2): Segment => ({ kind: 'line', from, to });

/** Trims (negative) or extends (positive, straight along the end tangent) each end of an open path; null when nothing is left. */
export function adjustCentreline(path: Path2D, start: EndCut, end: EndCut): Path2D | null {
  if (path.closed) return path;
  const L = pathLength(path);
  const s0 = Math.max(0, -(start ?? 0));
  const s1 = L - Math.max(0, -(end ?? 0));
  if (s1 - s0 <= 1e-6) return null;
  const segs = s0 > 0 || s1 < L ? subPath(path, s0, s1) : [...path.segments];
  const out: Path2D = { closed: false, segments: segs };
  if (start !== null && start > 0) {
    const f = endFrame(path, 'start');
    segs.unshift(lineSeg({ x: f.p.x + f.t.x * start, y: f.p.y + f.t.y * start }, f.p));
  }
  if (end !== null && end > 0) {
    const f = endFrame(path, 'end');
    segs.push(lineSeg(f.p, { x: f.p.x + f.t.x * end, y: f.p.y + f.t.y * end }));
  }
  return out;
}

/** The box beyond a cut end: everything past the cut point, out to `reach` along the end and `reach` to each side. */
function capBox(path: Path2D, which: 'start' | 'end', reach: number): Poly {
  const { p, t, n } = endFrame(path, which);
  const at = (a: number, b: number) => ({ x: p.x + t.x * a + n.x * b, y: p.y + t.y * a + n.y * b });
  return [at(0, -reach), at(reach, -reach), at(reach, reach), at(0, reach)];
}

/**
 * The XY area the tool centre may cover in a slot at half-width `d`: the centreline swept by a disc of radius `d`,
 * with round caps at round ends and flat ends at the cut points. The disc at a cut end already covers the full
 * width there, so its round cap beyond the cut point is simply clipped off with a box reaching only `d + 1` mm,
 * so a long curved slot never loses material at its far side.
 */
export function centreRegion(path: Path2D, cuts: SlotCuts, d: number, tol: number): Poly[] {
  const centre = adjustCentreline(path, cuts.start, cuts.end);
  if (!centre || !(d > 0)) return [];
  const sweepTol = tol / 8;
  if (centre.closed) return sweepPolylines([{ points: flattenPath(centre, tol / 4), closed: true }], d, sweepTol);
  let region = sweepPolylines([{ points: flattenPath(centre, tol / 4), closed: false }], d, sweepTol);
  if (cuts.start !== null) region = differencePolys(region, [capBox(centre, 'start', d + 1)]);
  if (cuts.end !== null) region = differencePolys(region, [capBox(centre, 'end', d + 1)]);
  return region;
}

/**
 * Dogbone moves (clarification 7) for every square end cut inside the wall: from each corner `q` of the tool-centre
 * region at half-width `dn`, straight towards the wall corner (inset by the radial stock) until the tool's edge
 * reaches it, at `tip`.
 */
export function dogboneCorners(slot: ResolvedSlot, r: number, stockRadial: number, dn: number, cuts: SlotCuts): { q: Vec2; tip: Vec2; end: 'start' | 'end' }[] {
  const out: { q: Vec2; tip: Vec2; end: 'start' | 'end' }[] = [];
  (['start', 'end'] as const).forEach((which) => {
    const cut = which === 'start' ? cuts.start : cuts.end;
    const kind = which === 'start' ? slot.startEnd : slot.endEnd;
    if (kind !== 'square' || cut === null || cut >= 0) return;
    const { p, t, n } = endFrame(slot.centreline, which);
    for (const side of [-1, 1]) {
      const q = { x: p.x + t.x * cut + n.x * side * dn, y: p.y + t.y * cut + n.y * side * dn };
      const half = slot.width / 2 - stockRadial;
      const c = { x: p.x - t.x * stockRadial + n.x * side * half, y: p.y - t.y * stockRadial + n.y * side * half };
      const len = Math.hypot(c.x - q.x, c.y - q.y);
      const go = len - r;
      if (go <= 1e-6) continue;
      out.push({ end: which, q, tip: { x: q.x + ((c.x - q.x) * go) / len, y: q.y + ((c.y - q.y) * go) / len } });
    }
  });
  return out;
}

/** One pass that cuts dogbone reliefs: the stock left on the walls, the region half-width the reliefs start from, and the end cuts. */
export interface DogbonePass { stock: number; dn: number; cuts: SlotCuts }

/**
 * Tool-centre zones where a square end is cut past its wall by choice (clarification 8, ruled by the controller for dogbones), one per end.
 * endWall: the band within r of the end wall. dogbone: the tool-centre positions of that end's relief moves (q to tip, for every pass in
 * `passes`) swept by 2 tol; the overcut reported is r(1 - 1/sqrt2) less the stock (the tip sits stock + r/sqrt2 from each wall), and an end with none gets no entry.
 */
export function overcutZones(slot: ResolvedSlot, r: number, squareEnds: SquareEnds, tol: number, passes: readonly DogbonePass[] = []): { zone: Poly[]; message: string }[] {
  if (squareEnds === 'inside' || slot.centreline.closed) return [];
  const out: { zone: Poly[]; message: string }[] = [];
  const half = slot.width / 2;
  (['start', 'end'] as const).forEach((which) => {
    if ((which === 'start' ? slot.startEnd : slot.endEnd) !== 'square') return;
    if (squareEnds === 'endWall') {
      const { p, t, n } = endFrame(slot.centreline, which);
      const at = (a: number, b: number) => ({ x: p.x + t.x * a + n.x * b, y: p.y + t.y * a + n.y * b });
      out.push({ zone: [[at(-(r + tol), -half), at(tol, -half), at(tol, half), at(-(r + tol), half)]], message: `Square slot end cut past the model wall by up to ${r.toFixed(2)} mm, as chosen` });
      return;
    }
    const reliefs = passes.flatMap((ps) => dogboneCorners(slot, r, ps.stock, ps.dn, ps.cuts).filter((c) => c.end === which).map((c) => ({ ...c, stock: ps.stock })));
    const depth = Math.max(0, ...reliefs.map((c) => r * (1 - Math.SQRT1_2) - c.stock));
    if (depth <= 1e-6) return;
    out.push({ zone: sweepPolylines(reliefs.map((c) => ({ points: [c.q, c.tip], closed: false })), 2 * tol, tol / 8), message: `Square slot end cut past the model wall by up to ${depth.toFixed(2)} mm, as chosen` });
  });
  return out;
}
