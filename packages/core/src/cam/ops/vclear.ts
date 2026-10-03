import { differencePolys, polysToRegions, type Region } from '../../geometry/offset/clipper';
import { orientPath, pathFromPoints, polyArea } from '../../geometry/offset/pathOps';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry, ResolvedShape } from '../features/resolve';
import { resolveGeometry } from '../features/resolve';
import { resolveHeights } from '../heights';
import { plugWallRegions } from '../inlay/plugStrokes';
import type { CamCode, CamSeverity, PocketOp, VClearOp } from '../types';
import { emptyOverlays, type OpOutput } from './output';
import { pocketToolpath } from './pocket';
import { flatAreas, shapePolys } from './vcarve';
import { plugSettingsError, plugShapeLoops } from './vplug';

const regionShape = (reg: Region, z: number, ref: ResolvedShape['ref']): ResolvedShape => ({
  shape: {
    outer: orientPath(pathFromPoints(reg.outer, true), true),
    islands: reg.holes.map((h) => orientPath(pathFromPoints(h, true), false)),
  },
  z, ref,
});

/**
 * Spec §2.3: clears the flat floor its source V-carve (or V-carve plug) leaves at depth. A V-carve's floor is its shapes inset by
 * `maxDepth x tan(half tip angle)`; a plug's is the stock outside the wall loops M ⊕ R, down to H. It is cut by the pocket generator
 * as a pocket from the source's top down to that depth.
 */
export function vclearToolpath(op: VClearOp, tool: Tool, ctx: CamContext): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays() };
  const diag = (severity: CamSeverity, code: CamCode, message: string) => out.diagnostics.push({ operationId: op.id, severity, code, message });
  if (tool.type !== 'flat' && tool.type !== 'bull') {
    diag('error', 'wrong-tool', 'Clearing needs a flat or bull-nose end mill');
    return out;
  }
  const source = ctx.job.operations.find((o) => o.id === op.sourceId);
  if (!source || (source.type !== 'vcarve' && source.type !== 'vplug')) {
    diag('error', 'source-missing', 'The V-carve this clears was deleted');
    return out;
  }
  if (source.type === 'vcarve' && source.maxDepth === null) {
    diag('error', 'source-incomplete', `Set a max depth on ${source.name} first`);
    return out;
  }
  const bit = ctx.job.tools.find((t) => t.id === source.toolId);
  const srcGeo = bit && bit.type === 'vbit' ? resolveGeometry(source, ctx) : null;
  if (!bit || bit.type !== 'vbit' || !(bit.tipAngleDeg > 0 && bit.tipAngleDeg < 180) || !srcGeo || srcGeo.diagnostics.some((d) => d.severity === 'error')) {
    diag('error', 'source-incomplete', `${source.name} has errors`);
    return out;
  }
  const tol = ctx.tolerance;
  const tanHalf = Math.tan((bit.tipAngleDeg * Math.PI) / 360);
  let depth: number;
  const inset: ResolvedShape[] = [];
  if (source.type === 'vcarve') {
    depth = source.maxDepth as number;
    const R = depth * tanHalf;
    for (const sh of srcGeo.shapes) {
      for (const reg of polysToRegions(flatAreas(shapePolys(sh.shape, tol), R, tol))) {
        if (Math.abs(polyArea(reg.outer)) > 0) inset.push(regionShape(reg, sh.z, sh.ref));
      }
    }
  } else {
    const { inlayDepth: D, startDepth: S, glueGap: g } = source;
    if (plugSettingsError(source, bit, ctx)) {
      diag('error', 'source-incomplete', `${source.name} has errors`);
      return out;
    }
    depth = D - g + S;
    if (!ctx.stock) {
      diag('error', 'no-stock', 'Clearing a plug needs a stock');
      return out;
    }
    const first = srcGeo.shapes[0];
    if (!first) {
      diag('warning', 'unmachined-area', 'Nothing to clear: the plug has no shapes');
      return out;
    }
    if (!resolveHeights(source.heights, ctx, { contourZ: first.z, holeBottom: null, faceZ: srcGeo.faceZ }).values) {
      diag('error', 'source-incomplete', `${source.name} has errors`);
      return out;
    }
    const { min, max } = ctx.stock;
    const board = [{ x: min.x, y: min.y }, { x: max.x, y: min.y }, { x: max.x, y: max.y }, { x: min.x, y: max.y }];
    // the walls' footprint M ⊕ R (outers counter-clockwise, holes clockwise) is what stays; everything else of the stock is floor
    const walls = plugWallRegions(plugShapeLoops(srcGeo, tol), S * tanHalf, tol).flatMap((r) => [r.outer, ...r.holes]);
    for (const reg of polysToRegions(differencePolys([board], walls))) {
      if (Math.abs(polyArea(reg.outer)) > 0) inset.push(regionShape(reg, first.z, first.ref));
    }
  }
  if (!inset.length) {
    diag('warning', 'unmachined-area', 'Nothing to clear: no area reaches the max depth');
    return out;
  }
  const pocket: PocketOp = {
    ...op, type: 'pocket', stockRadial: 0, stockAxial: 0, finishWalls: false, finishFloor: false, geometry: [],
    heights: {
      ...op.heights, top: source.heights.top,
      bottom: { ...source.heights.top, offset: source.heights.top.offset - depth },
    },
  } as PocketOp;
  const geo: ResolvedGeometry = { ...srcGeo, diagnostics: [], shapes: inset };
  const res = pocketToolpath(pocket, tool, ctx, geo);
  return { ...res, diagnostics: res.diagnostics.map((d) => ({ ...d, operationId: op.id })) };
}
