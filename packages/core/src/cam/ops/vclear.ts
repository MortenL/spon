import { polysToRegions, type Region } from '../../geometry/offset/clipper';
import { flattenPath, orientPath, pathFromPoints, polyArea } from '../../geometry/offset/pathOps';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedShape } from '../features/resolve';
import { resolveGeometry } from '../features/resolve';
import { resolveHeights } from '../heights';
import { plugFloor, plugWallRegions } from '../inlay/plugStrokes';
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
    // the walls' footprint M ⊕ R is what stays; everything else of the stock is floor
    const floor = plugFloor({ minX: min.x, minY: min.y, maxX: max.x, maxY: max.y }, plugWallRegions(plugShapeLoops(srcGeo, tol), S * tanHalf, tol));
    for (const reg of polysToRegions(floor)) {
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
  // An inlay's floor must be cut everywhere, or the plug can't seat. Its V-bit (the plug, or a V-carve with inlay settings) cleans
  // the floor this tool can't reach, so for an enabled inlay source the unreached corners and areas need no warning.
  const inlay = source.type === 'vplug' || !!source.inlay;
  const covered = inlay && source.enabled && (source.type === 'vplug' || (source.inlay?.glueGap ?? 0) > 0);
  // The floor areas are cut one by one: an area the tool does not fit in is left (a warning) as long as another area is cleared.
  const cut: OpOutput[] = [];
  const tooSmall: { shape: ResolvedShape; res: OpOutput }[] = [];
  for (const shape of inset) {
    const res = pocketToolpath(pocket, tool, ctx, { ...srcGeo, diagnostics: [], shapes: [shape] });
    if (res.diagnostics.length === 1 && res.diagnostics[0].code === 'offset-collapsed') tooSmall.push({ shape, res });
    else cut.push(covered ? { ...res, diagnostics: res.diagnostics.filter((d) => d.code !== 'unmachined-area'), overlays: { ...res.overlays, unmachined: [] } } : res);
  }
  if (!cut.length) {
    if (inlay) {
      diag('error', 'offset-collapsed', 'The clearing tool is wider than the pocket floor; choose a smaller one, or a smaller inlay depth');
      return out;
    }
    return { ...tooSmall[0].res, diagnostics: tooSmall.flatMap((x) => x.res.diagnostics).map((d) => ({ ...d, operationId: op.id })) };
  }
  const first = cut[0];
  const moves = cut.flatMap((r) => r.toolpath?.moves ?? []);
  const tp = cut.find((r) => r.toolpath)?.toolpath ?? null;
  const left = covered ? [] : tooSmall;
  const merged: OpOutput = {
    ...first,
    toolpath: tp && moves.length ? { ...tp, moves } : null,
    diagnostics: cut.flatMap((r) => r.diagnostics),
    overlays: {
      ...first.overlays,
      tabs: cut.flatMap((r) => r.overlays.tabs), laps: cut.flatMap((r) => r.overlays.laps), gouges: cut.flatMap((r) => r.overlays.gouges),
      unmachined: [
        ...cut.flatMap((r) => r.overlays.unmachined),
        ...left.map(({ shape }) => ({ regions: [{ outer: flattenPath(shape.shape.outer, tol), holes: shape.shape.islands.map((i) => flattenPath(i, tol)) }], z: first.heights?.bottom ?? 0 })),
      ],
    },
  };
  if (left.length) {
    merged.diagnostics.push(inlay
      ? { operationId: op.id, severity: 'error', code: 'unmachined-area', message: `The tool does not fit in ${left.length} area(s) of the floor, so the plug will not fit; choose a smaller clearing tool` }
      : { operationId: op.id, severity: 'warning', code: 'unmachined-area', message: `The tool does not fit in ${left.length} area(s) of the floor` });
  }
  return { ...merged, diagnostics: merged.diagnostics.map((d) => ({ ...d, operationId: op.id })) };
}
