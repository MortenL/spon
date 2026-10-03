import { polysToRegions } from '../../geometry/offset/clipper';
import { orientPath, pathFromPoints, polyArea } from '../../geometry/offset/pathOps';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry, ResolvedShape } from '../features/resolve';
import { resolveGeometry } from '../features/resolve';
import type { CamCode, CamSeverity, PocketOp, VClearOp } from '../types';
import { emptyOverlays, type OpOutput } from './output';
import { pocketToolpath } from './pocket';
import { flatAreas, shapePolys } from './vcarve';

/**
 * Spec §2.3: clears the flat floor its source V-carve leaves at max depth. The floor is the source shapes inset by
 * `maxDepth x tan(half tip angle)`; it is cut by the pocket generator as a pocket from the source's top down to that depth.
 */
export function vclearToolpath(op: VClearOp, tool: Tool, ctx: CamContext): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays() };
  const diag = (severity: CamSeverity, code: CamCode, message: string) => out.diagnostics.push({ operationId: op.id, severity, code, message });
  if (tool.type !== 'flat' && tool.type !== 'bull') {
    diag('error', 'wrong-tool', 'Clearing needs a flat or bull-nose end mill');
    return out;
  }
  const source = ctx.job.operations.find((o) => o.id === op.sourceId);
  if (!source || source.type !== 'vcarve') {
    diag('error', 'source-missing', 'The V-carve this clears was deleted');
    return out;
  }
  if (source.maxDepth === null) {
    diag('error', 'source-incomplete', `Set a max depth on ${source.name} first`);
    return out;
  }
  const bit = ctx.job.tools.find((t) => t.id === source.toolId);
  const srcGeo = bit && bit.type === 'vbit' ? resolveGeometry(source, ctx) : null;
  if (bit && bit.type === 'vbit' && !(bit.tipAngleDeg > 0 && bit.tipAngleDeg < 180)) {
    diag('error', 'source-incomplete', `${source.name} has errors`);
    return out;
  }
  if (!bit || !srcGeo || srcGeo.diagnostics.some((d) => d.severity === 'error')) {
    diag('error', 'source-incomplete', `${source.name} has errors`);
    return out;
  }
  const maxDepth = source.maxDepth;
  const R = maxDepth * Math.tan((bit.tipAngleDeg * Math.PI) / 360);
  const tol = ctx.tolerance;
  const inset: ResolvedShape[] = [];
  for (const sh of srcGeo.shapes) {
    for (const reg of polysToRegions(flatAreas(shapePolys(sh.shape, tol), R, tol))) {
      const outer = orientPath(pathFromPoints(reg.outer, true), true);
      const islands = reg.holes.map((h) => orientPath(pathFromPoints(h, true), false));
      if (Math.abs(polyArea(reg.outer)) > 0) inset.push({ shape: { outer, islands }, z: sh.z, ref: sh.ref });
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
      bottom: { ...source.heights.top, offset: source.heights.top.offset - maxDepth },
    },
  } as PocketOp;
  const geo: ResolvedGeometry = { ...srcGeo, diagnostics: [], shapes: inset };
  const res = pocketToolpath(pocket, tool, ctx, geo);
  return { ...res, diagnostics: res.diagnostics.map((d) => ({ ...d, operationId: op.id })) };
}
