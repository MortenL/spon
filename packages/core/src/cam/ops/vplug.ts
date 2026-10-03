import { polysToRegions } from '../../geometry/offset/clipper';
import { polyArea } from '../../geometry/offset/pathOps';
import type { Vec2 } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry } from '../features/resolve';
import { resolveHeights } from '../heights';
import { plugStrokes } from '../inlay/plugStrokes';
import type { CamCode, CamSeverity, VPlugOp } from '../types';
import { sampleSpacing } from '../vcarve/sample';
import { emptyOverlays, type OpOutput } from './output';
import { emitStrokes, shapePolys } from './vcarve';
import { MoveWriter } from './writer';

const EPS = 1e-9;

/** Spec §2: the V-carve plug: walls around the mirrored shapes M, cut from D − g at M out to the flat floor H. */
export function vplugToolpath(op: VPlugOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays(), intended: [] };
  const diag = (severity: CamSeverity, code: CamCode, message: string) => out.diagnostics.push({ operationId: op.id, severity, code, message });
  if (tool.type !== 'vbit') {
    diag('error', 'wrong-tool', 'Inlays need a V-bit');
    return out;
  }
  if (!(tool.tipAngleDeg > 0 && tool.tipAngleDeg < 180)) {
    diag('error', 'wrong-tool', 'The tool needs a tip angle between 0 and 180 degrees');
    return out;
  }
  const { inlayDepth: D, startDepth: S, glueGap: g } = op;
  if (!(g < D)) {
    diag('error', 'inlay-settings', 'The glue gap must be smaller than the inlay depth');
    return out;
  }
  const H = D - g + S;
  if (ctx.stock && ctx.stock.max.z - ctx.stock.min.z < H - EPS) {
    diag('error', 'plug-board-thin', `The plug board is thinner than the plug (${H.toFixed(2)} mm)`);
    return out;
  }
  if (H > tool.fluteLength + EPS) diag('warning', 'flute-exceeded', `The plug needs ${H.toFixed(2)} mm of V-bit; its cutting length is ${tool.fluteLength.toFixed(2)} mm`);
  // Task 3 teaches the clearing to take a plug as its source
  if (!ctx.job.operations.some((o) => o.enabled && o.type === 'vclear' && o.sourceId === op.id)) {
    diag('warning', 'vcarve-uncleared', 'Wide areas stop at the max depth; add a clearing operation');
  }
  const first = geo.shapes[0];
  if (!first) return out;
  const hr = resolveHeights(op.heights, ctx, { contourZ: first.z, holeBottom: null, faceZ: geo.faceZ });
  if (!hr.values) {
    for (const e of hr.errors) out.diagnostics.push({ operationId: op.id, severity: 'error', code: 'heights-invalid', message: e, ref: first.ref });
    return out;
  }
  const h = hr.values;
  out.heights = h;
  const tol = ctx.tolerance;
  const s = sampleSpacing(tol);
  // touching shapes are one M
  const orient = (poly: Vec2[], ccw: boolean) => ((polyArea(poly) > 0) === ccw ? poly : [...poly].reverse());
  const M = polysToRegions(geo.shapes.flatMap((sh) => shapePolys(sh.shape, tol))).flatMap((r) => [orient(r.outer, true), ...r.holes.map((x) => orient(x, false))]);
  const strokes = plugStrokes(M, { top: h.top, t: Math.tan((tool.tipAngleDeg * Math.PI) / 360), D, S, g, spacing: s, tol });
  const w = new MoveWriter();
  emitStrokes(w, strokes, h, H, op.stepdown, 2 * s, op.feeds.feed, op.feeds.plungeFeed);
  if (!w.moves.length) return out;
  w.up(h.clearance);
  out.toolpath = { operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance: h.clearance, moves: w.moves };
  return out;
}
