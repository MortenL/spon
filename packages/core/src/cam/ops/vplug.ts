import { polysToRegions } from '../../geometry/offset/clipper';
import type { Vec2 } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry } from '../features/resolve';
import { resolveHeights } from '../heights';
import { plugFloor, plugStrokes, plugWallRegions } from '../inlay/plugStrokes';
import { dropBoardCorners, floorResidue, linkedClearingTools, residuePasses } from '../inlay/residue';
import type { CamCode, CamDiagnostic, CamSeverity, VPlugOp } from '../types';
import { sampleSpacing } from '../vcarve/sample';
import { emptyOverlays, type OpOutput } from './output';
import { emitStrokes, orientPoly, shapePolys } from './vcarve';
import { MoveWriter } from './writer';

const EPS = 1e-9;

/** The plug's mirrored shapes M as loops (outers counter-clockwise, holes clockwise); touching shapes are one M. */
export const plugShapeLoops = (geo: ResolvedGeometry, tol: number): Vec2[][] =>
  polysToRegions(geo.shapes.flatMap((sh) => shapePolys(sh.shape, tol))).flatMap((r) => [orientPoly(r.outer, true), ...r.holes.map((x) => orientPoly(x, false))]);

/** The first reason a plug can't be cut with `tool`: not a V-bit, a bad tip angle, bad inlay settings, or a board thinner than the plug. */
export function plugSettingsError(op: VPlugOp, tool: Tool, ctx: CamContext): CamDiagnostic | null {
  const err = (code: CamCode, message: string): CamDiagnostic => ({ operationId: op.id, severity: 'error', code, message });
  if (tool.type !== 'vbit') return err('wrong-tool', 'Inlays need a V-bit');
  if (!(tool.tipAngleDeg > 0 && tool.tipAngleDeg < 180)) return err('wrong-tool', 'The tool needs a tip angle between 0 and 180 degrees');
  const { inlayDepth: D, startDepth: S, glueGap: g } = op;
  if (![D, S, g].every((v) => Number.isFinite(v) && v > 0)) return err('inlay-settings', 'Set the inlay depth, start depth and glue gap to positive values');
  if (!(g < D)) return err('inlay-settings', 'The glue gap must be smaller than the inlay depth');
  const H = D - g + S;
  if (ctx.stock && ctx.stock.max.z - ctx.stock.min.z < H - EPS) return err('plug-board-thin', `The plug board is thinner than the plug (${H.toFixed(2)} mm)`);
  return null;
}

/** Spec §2: the V-carve plug: walls around the mirrored shapes M, cut from D − g at M out to the flat floor H. */
export function vplugToolpath(op: VPlugOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays(), intended: [] };
  const diag = (severity: CamSeverity, code: CamCode, message: string) => out.diagnostics.push({ operationId: op.id, severity, code, message });
  const bad = plugSettingsError(op, tool, ctx);
  if (bad) {
    out.diagnostics.push(bad);
    return out;
  }
  const { inlayDepth: D, startDepth: S, glueGap: g } = op;
  const H = D - g + S;
  if (H > tool.fluteLength + EPS) diag('warning', 'flute-exceeded', `The plug needs ${H.toFixed(2)} mm of V-bit; its cutting length is ${tool.fluteLength.toFixed(2)} mm`);
  if (!ctx.job.operations.some((o) => o.enabled && o.type === 'vclear' && o.sourceId === op.id)) {
    diag('warning', 'vcarve-uncleared', "The plug's floor is not cleared; it will not fit. Add a clearing operation");
  }
  const first = geo.shapes[0];
  if (!first) return out;
  const hr = resolveHeights(op.heights, ctx, { contourZ: first.z, holeBottom: null, faceZ: geo.faceZ });
  if (!hr.values) {
    for (const e of hr.errors) out.diagnostics.push({ operationId: op.id, severity: 'error', code: 'heights-invalid', message: e, ref: first.ref });
    return out;
  }
  const h = hr.values;
  if (geo.shapes.some((sh) => Math.abs(sh.z - first.z) > 1e-6)) diag('warning', 'wrong-geometry', "The plug's shapes are at different heights; all are cut at the first one's height");
  out.heights = h;
  const tol = ctx.tolerance;
  const s = sampleSpacing(tol);
  const M = plugShapeLoops(geo, tol);
  const t = Math.tan((tool.tipAngleDeg * Math.PI) / 360);
  const R = S * t;
  const strokes = plugStrokes(M, { top: h.top, t, D, S, g, spacing: s, tol });
  if (ctx.stock) {
    const board = { minX: ctx.stock.min.x, minY: ctx.stock.min.y, maxX: ctx.stock.max.x, maxY: ctx.stock.max.y };
    const off = plugWallRegions(M, R, tol).some((r) => r.outer.some((p) => p.x < board.minX - tol || p.x > board.maxX + tol || p.y < board.minY - tol || p.y > board.maxY + tol));
    if (off) diag('warning', 'plug-board-small', 'The plug walls run off the plug board');
    // the floor the clearing tools can't reach (narrow wedges and tips between the walls): any point within R of a pass at H is
    // cut at least D − g deep, which keeps it clear of the base board around the pocket
    const tools = linkedClearingTools(ctx.job, op.id);
    if (tools.length) {
      const corner = Math.max(...tools.map((x) => x.diameter / 2)) + 0.05;
      const residue = dropBoardCorners(floorResidue(plugFloor(board, M, R, tol), tools, tol), board, corner);
      strokes.push(...residuePasses(residue, h.top - H, R, tol));
    }
  }
  const w = new MoveWriter();
  emitStrokes(w, strokes, h, H, op.stepdown, 2 * s, op.feeds.feed, op.feeds.plungeFeed);
  if (!w.moves.length) return out;
  w.up(h.clearance);
  out.toolpath = { operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance: h.clearance, moves: w.moves };
  return out;
}
