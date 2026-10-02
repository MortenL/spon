import { fitArcs } from '../../geometry/offset/arcFit';
import {
  differencePolys, offsetPolys, type Poly, polysToRegions, segmentInside, simplifyPolys, sweepPolylines, unionPolys,
} from '../../geometry/offset/clipper';
import { flattenPath, nearestS, orientPath, pathStart, polyArea, rotateStart } from '../../geometry/offset/pathOps';
import { scanlineIntervals } from '../../geometry/offset/scanline';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry } from '../features/resolve';
import { resolveHeights, type ResolvedHeights } from '../heights';
import type { CamCode, CamSeverity, FaceOp } from '../types';
import { emptyOverlays, type OpOutput } from './output';
import { depthLevels, emitLap, MoveWriter } from './writer';

const COVERAGE_TOL = 0.01; // mm; floor for the coverage sweep tolerance
const SLIVER = 0.025; // mm; unreached material thinner than twice this is not reported

interface Ring { path: Path2D; poly: Poly }
/** The cutting layout of one area at one stepover: zig-zag passes, or concentric rings from the outside in. */
type Plan = { kind: 'zigzag'; passes: { a: Vec2; b: Vec2 }[] } | { kind: 'spiral'; rings: Ring[][] };
interface Area { polys: Poly[]; z: number; ref: number }

export function faceToolpath(op: FaceOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays() };
  const diag = (severity: CamSeverity, code: CamCode, message: string, ref?: number) =>
    out.diagnostics.push({ operationId: op.id, severity, code, message, ...(ref === undefined ? {} : { ref }) });
  if (tool.type !== 'flat' && tool.type !== 'bull') {
    diag('error', 'wrong-tool', 'Facing needs a flat or bull-nose tool');
    return out;
  }
  const tol = ctx.tolerance;
  const flatTol = tol / 4;
  const joinTol = tol / 8;
  const fitTol = tol / 2;
  const r = tool.diameter / 2;
  const feed = op.feeds.feed;
  const plunge = op.feeds.plungeFeed;
  const w = new MoveWriter();
  let clearance = -Infinity;
  let first = true;
  let depthWarned = false;

  // areas: the stock rectangle, or the picked shapes' outer loops unioned per Z level
  const areas: Area[] = [];
  if (op.area === 'stock') {
    if (!ctx.stock) {
      diag('error', 'no-stock', 'Set up stock first');
      return out;
    }
    const { min, max } = ctx.stock;
    areas.push({ polys: [[{ x: min.x, y: min.y }, { x: max.x, y: min.y }, { x: max.x, y: max.y }, { x: min.x, y: max.y }]], z: max.z, ref: 0 });
  } else {
    const groups = new Map<string, Area>();
    for (const sh of geo.shapes) {
      const key = sh.z.toFixed(6);
      const g = groups.get(key) ?? { z: sh.z, ref: sh.ref, polys: [] };
      g.polys = unionPolys(g.polys, [flattenPath(orientPath(sh.shape.outer, true), flatTol)]);
      groups.set(key, g);
    }
    for (const g of groups.values()) areas.push(g);
  }

  const orientRing = (poly: Poly): Path2D => {
    const outerRing = polyArea(poly) > 0;
    // rings run outside in with the uncut material inside, so climb (material on the right) is clockwise
    const ccw = outerRing !== (op.direction === 'climb');
    return orientPath(fitArcs(poly, true, fitTol, fitTol), ccw);
  };

  /** Offsets of the area from the outside in, ending with a ring at the deepest offset that still exists (so no gap is wider than a stepover). */
  const spiralRings = (area: Area, stepover: number): Ring[][] => {
    const simple = simplifyPolys(area.polys, flatTol);
    const levels: Poly[][] = [];
    let k = 0;
    let lastD = 0;
    for (; k < 100000; k++) {
      const d = op.overlap - k * stepover;
      const off = offsetPolys(simple, d, joinTol);
      if (!off.length) break;
      levels.push(off);
      lastD = d;
    }
    if (levels.length) {
      let good = lastD, bad = op.overlap - k * stepover;
      for (let i = 0; i < 24; i++) {
        const mid = (good + bad) / 2;
        if (offsetPolys(simple, mid, joinTol).length) good = mid; else bad = mid;
      }
      if (lastD - good > 0.01) {
        const core = offsetPolys(simple, good, joinTol);
        if (core.length) levels.push(core);
      }
    }
    return levels.map((level) => level.map((poly) => ({ poly, path: orientRing(poly) })));
  };

  const plan = (area: Area, stepover: number): Plan => {
    if (op.pattern === 'spiral') return { kind: 'spiral', rings: spiralRings(area, stepover) };
    const centre = offsetPolys(area.polys, op.overlap, joinTol);
    const lines = scanlineIntervals(centre, op.angleDeg, stepover);
    // climb: uncut material on the cutter's right (M3), so the lines are visited from high to low across
    const ordered = op.direction === 'climb' ? [...lines].reverse() : lines;
    // both ways: every other scanline runs backwards, its intervals visited in the order that matches
    const passes = ordered.flatMap((line, k) =>
      op.oneWay || k % 2 === 0 ? line.map((iv) => ({ a: iv.a, b: iv.b })) : [...line].reverse().map((iv) => ({ a: iv.b, b: iv.a })));
    return { kind: 'zigzag', passes };
  };

  /** Cuts every level of `levels` over the area following `p`; links stay inside `linkRegion`. */
  const emit = (p: Plan, linkRegion: Poly[], levels: number[], h: ResolvedHeights) => {
    const reach = (xy: Vec2, z: number, region: Poly[] | null) => {
      if (region && w.pos && w.pos.z <= z + 1e-9 && segmentInside(w.pos, xy, region)) {
        w.line({ ...xy, z }, feed);
        return;
      }
      w.up(h.retract);
      w.travel(xy, first ? h.clearance : h.retract, h.feed);
      first = false;
      w.line({ ...xy, z }, plunge);
    };
    for (const z of levels) {
      if (p.kind === 'zigzag') {
        p.passes.forEach((pass, k) => {
          reach(pass.a, z, !op.oneWay && k > 0 ? linkRegion : null);
          w.line({ ...pass.b, z }, feed);
        });
      } else {
        let prev: Poly[] | null = null;
        for (const level of p.rings) {
          for (const ring of level) {
            const path = w.pos ? rotateStart(ring.path, nearestS(ring.path, w.pos).s) : ring.path;
            reach(pathStart(path), z, prev);
            emitLap(w, path, z, z, feed, null);
          }
          prev = level.map((ring) => ring.poly);
        }
      }
    }
    w.up(h.retract);
  };

  const coverLines = (p: Plan, coverageTol: number) =>
    p.kind === 'zigzag'
      ? p.passes.map((s) => ({ points: [s.a, s.b], closed: false }))
      : p.rings.flatMap((level) => level.map((ring) => {
        // an open polyline closed by hand: a degenerate core ring (a line there and back) has fewer than 3 points
        const pts = flattenPath(ring.path, coverageTol);
        return { points: [...pts, pts[0]], closed: false };
      }));

  for (const area of areas) {
    const hr = resolveHeights(op.heights, ctx, { contourZ: area.z, holeBottom: null, faceZ: geo.faceZ });
    const ref = op.area === 'stock' ? undefined : area.ref;
    if (!hr.values) {
      for (const e of hr.errors) diag('error', 'heights-invalid', e, ref);
      continue;
    }
    const h = hr.values;
    out.heights ??= h;
    clearance = Math.max(clearance, h.clearance);

    const stepover = Math.max(0.01, (tool.diameter * op.stepoverPct) / 100);
    // links may run along the centre region's boundary, so they are tested against it grown by a hair
    const linkRegion = offsetPolys(offsetPolys(area.polys, op.overlap, joinTol), 1e-3, joinTol);
    const rough = plan(area, stepover);
    emit(rough, linkRegion, depthLevels(h.top, h.bottom, op.stepdown), h);
    let last = rough;
    if (op.finishPass) {
      last = plan(area, Math.max(0.01, (tool.diameter * op.finishStepoverPct) / 100));
      emit(last, linkRegion, [h.bottom], h);
    }

    // material the tool never reached at the floor
    const coverageTol = Math.max(tol, COVERAGE_TOL);
    const swept = sweepPolylines(coverLines(last, coverageTol), r, coverageTol);
    const left = polysToRegions(offsetPolys(offsetPolys(differencePolys(area.polys, swept), -SLIVER, tol), SLIVER, tol));
    if (left.length) {
      diag('warning', 'unmachined-area', `The tool cannot reach ${left.length} area(s) of this facing`, ref);
      out.overlays.unmachined.push({ regions: left, z: h.bottom });
    }

    // cutting below the model top removes part of the model
    if (!depthWarned && ctx.geometry?.kind === 'mesh' && ctx.model && h.bottom < ctx.model.max.z - 1e-6) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const poly of area.polys) for (const v of poly) { x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); }
      const m = ctx.model;
      if (x0 < m.max.x && x1 > m.min.x && y0 < m.max.y && y1 > m.min.y) {
        diag('warning', 'facing-depth', 'The facing depth goes below the model top', ref);
        depthWarned = true;
      }
    }
  }

  if (!w.moves.length || out.diagnostics.some((d) => d.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = {
    operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves,
  };
  return out;
}
