import { fitArcs } from '../../geometry/offset/arcFit';
import {
  differencePolys, offsetPolys, type Poly, pointInPolys, polysToRegions, regionPolys, segmentInside, simplifyPolys, sweepPolylines,
} from '../../geometry/offset/clipper';
import { dist2, flattenPath, nearestS, orientPath, pathStart, polyArea, rotateStart } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry } from '../features/resolve';
import { resolveHeights, type ResolvedHeights } from '../heights';
import type { CamCode, CamSeverity, PocketOp } from '../types';
import { emptyOverlays, type OpOutput } from './output';
import { depthLevels, emitHelix, emitLap, emitRampLaps, MoveWriter } from './writer';

interface Ring { k: number; path: Path2D; poly: Poly }
interface Area { polys: Poly[]; rings: Ring[] }

const LIFT = 1; // mm above the previous level for moves inside the pocket
const COVERAGE_TOL = 0.01; // mm; floor for the unmachined-area sweep's tolerance (see below)
const SLIVER = 0.025; // mm; unreached material thinner than twice this is not reported

export function pocketToolpath(op: PocketOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays() };
  const diag = (severity: CamSeverity, code: CamCode, message: string, ref?: number) =>
    out.diagnostics.push({ operationId: op.id, severity, code, message, ...(ref === undefined ? {} : { ref }) });
  const tol = ctx.tolerance;
  const r = tool.diameter / 2;
  const stepover = Math.max(0.01, (tool.diameter * op.stepoverPct) / 100);
  const feed = op.feeds.feed;
  const plunge = op.feeds.plungeFeed;
  const angle = op.entry.rampAngleDeg;
  const w = new MoveWriter();
  let clearance = -Infinity;
  let first = true;

  const orientRing = (poly: Poly): Path2D => {
    const outerRing = polyArea(poly) > 0;
    const ccw = outerRing === (op.direction === 'climb');
    return orientPath(fitArcs(poly, true, tol), ccw);
  };
  const startNear = (path: Path2D, p: Vec2 | null): Path2D => (p ? rotateStart(path, nearestS(path, p).s) : path);

  /** Clears one area at the given levels; `startZ` is where the entry begins for the first level. */
  const clearArea = (area: Area, levels: number[], h: ResolvedHeights, startZ: number) => {
    const rings = [...area.rings].sort((a, b) => b.k - a.k);
    let prev = startZ;
    /**
     * A rejected straight link: rises to feed height (clear of islands, which are never machined and so stand
     * solid from the top down), crosses to `xy`, drops to `safeZ` (already cleared above that XY — the previous
     * depth level, or feed height before any level has been cut), then feeds the rest of the way down to `target`.
     */
    const liftAcross = (xy: Vec2, safeZ: number, target: number) => {
      w.up(h.feed);
      w.rapid({ ...xy, z: h.feed });
      if (safeZ < h.feed - 1e-9) w.rapid({ ...xy, z: safeZ });
      w.line({ ...xy, z: target }, plunge);
    };
    levels.forEach((z, li) => {
      const entryZ = li === 0 ? startZ : Math.min(h.feed, prev + LIFT);
      let ring = startNear(rings[0].path, w.pos);
      const rh = (tool.diameter * op.entry.helixDiameterPct) / 200;
      const inner = op.entry.mode === 'auto' || op.entry.mode === 'helix' ? offsetPolys(area.polys, -rh, tol) : [];
      if (inner.length && rh > 0) {
        const start = pathStart(ring);
        let c = start;
        if (!pointInPolys(start, inner)) {
          let best = Infinity;
          for (const poly of inner) for (const p of poly) if (dist2(p, start) < best) { best = dist2(p, start); c = p; }
        }
        const hStart = { x: c.x + rh, y: c.y };
        if (w.pos && w.pos.z <= entryZ + 1e-9 && segmentInside(w.pos, hStart, area.polys)) w.line({ ...hStart, z: entryZ }, feed);
        else w.travel(hStart, first ? h.clearance : h.feed, entryZ);
        first = false;
        emitHelix(w, c, rh, entryZ, z, angle, feed);
        ring = startNear(ring, w.pos);
        const s = pathStart(ring);
        if (segmentInside(w.pos!, s, area.polys)) w.line({ ...s, z }, feed);
        else liftAcross(s, entryZ, z);
      } else {
        w.travel(pathStart(ring), first ? h.clearance : h.feed, entryZ);
        first = false;
        if (op.entry.mode === 'plunge') w.line({ ...pathStart(ring), z }, plunge);
        else emitRampLaps(w, ring, entryZ, z, angle, feed, null);
      }
      emitLap(w, ring, z, z, feed, null);
      for (const next of rings.slice(1)) {
        const path = startNear(next.path, w.pos);
        const s = pathStart(path);
        if (segmentInside(w.pos!, s, area.polys)) w.line({ ...s, z }, feed);
        else liftAcross(s, entryZ, z);
        emitLap(w, path, z, z, feed, null);
      }
      prev = z;
    });
    w.up(h.retract);
  };

  geo.shapes.forEach((sh) => {
    const hr = resolveHeights(op.heights, ctx, { contourZ: sh.z, holeBottom: null, faceZ: geo.faceZ });
    if (!hr.values) {
      for (const e of hr.errors) diag('error', 'heights-invalid', e, sh.ref);
      return;
    }
    const h = hr.values;
    out.heights ??= h;
    clearance = Math.max(clearance, h.clearance);
    const region: Poly[] = [
      flattenPath(orientPath(sh.shape.outer, true), tol),
      ...sh.shape.islands.map((i) => flattenPath(orientPath(i, false), tol)),
    ];
    // Every ring is offset from the region itself (never from the previous ring: chained offsets double their
    // vertex count around islands and concave curves on every ring). The region is simplified once, within
    // tol/2, and each ring is offset tol/2 further, so the rings stay at least as far from the walls and
    // islands as offsets of the exact region would.
    const simple = simplifyPolys(region, tol / 2);
    const ringLevels: Poly[][] = [];
    for (let k = 0; k < 100000; k++) {
      const off = offsetPolys(simple, -(r + op.stockRadial + k * stepover + tol / 2), tol);
      if (!off.length) break;
      ringLevels.push(off);
    }
    if (!ringLevels.length) return diag('error', 'offset-collapsed', 'The tool does not fit in this pocket', sh.ref);
    const areas: Area[] = polysToRegions(ringLevels[0]).map((reg) => ({ polys: regionPolys(reg), rings: [] }));
    ringLevels.forEach((level, k) => {
      for (const poly of level) {
        const area = areas.find((a) => pointInPolys(poly[0], a.polys)) ?? areas[0];
        area.rings.push({ k, poly, path: orientRing(poly) });
      }
    });

    // material the tool cannot reach: sweeping a disc of radius r along every ring and unioning the bands is
    // a lot of Clipper work when there are many rings on a fine contour, so the rings feed it as their
    // already arc-fitted path re-flattened at a coarser tolerance — this check only needs to place a gap to
    // within a fraction of the tool radius, not to the operation's cutting tolerance.
    const target = op.stockRadial > 0 ? offsetPolys(region, -op.stockRadial, tol) : region;
    const coverageTol = Math.max(tol, COVERAGE_TOL);
    const sweepInput = areas.flatMap((a) => a.rings.map((ring) => ({ points: flattenPath(ring.path, coverageTol), closed: true })));
    const swept = sweepPolylines(sweepInput, r, coverageTol);
    // a morphological opening drops slivers thinner than 2 × SLIVER (flattening error, the rings' tol/2 margin)
    // so they neither count as leftovers nor join real leftovers into one region
    const left = polysToRegions(offsetPolys(offsetPolys(differencePolys(target, swept), -SLIVER, tol), SLIVER, tol));
    if (left.length) {
      diag('warning', 'unmachined-area', `The tool cannot reach ${left.length} area(s) of this pocket`, sh.ref);
      out.overlays.unmachined.push({ regions: left, z: h.bottom });
    }

    const levels = depthLevels(h.top, h.bottom + op.stockAxial, op.stepdown);
    for (const area of areas) clearArea(area, levels, h, h.feed);
    if (op.finishFloor && op.stockAxial > 0) for (const area of areas) clearArea(area, [h.bottom], h, h.feed);
    if (op.finishWalls) {
      for (const poly of offsetPolys(region, -r, tol)) {
        const path = orientRing(poly);
        w.travel(pathStart(path), h.retract, h.feed);
        emitRampLaps(w, path, h.feed, h.bottom, angle, feed, null);
        emitLap(w, path, h.bottom, h.bottom, feed, null);
        w.up(h.retract);
      }
    }
  });

  if (!w.moves.length || out.diagnostics.some((d) => d.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = {
    operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves,
  };
  return out;
}
