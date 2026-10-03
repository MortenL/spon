import { pathStart, reversePath } from '../../geometry/offset/pathOps';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry } from '../features/resolve';
import { resolveHeights } from '../heights';
import type { CamCode, CamSeverity, EngraveOp } from '../types';
import { emptyOverlays, type OpOutput } from './output';
import { depthLevels, emitLap, MoveWriter } from './writer';

/** The depth of an engraving: given directly, or the depth at which a V-bit's groove is `lineWidth` wide. */
export function engraveDepth(op: EngraveOp, tool: Tool): { depth: number } | { error: string } {
  if (op.depthMode === 'depth') return { depth: op.depth };
  if (tool.type !== 'vbit') return { error: 'Line width needs a V-bit; set a depth' };
  return { depth: op.lineWidth / 2 / Math.tan((tool.tipAngleDeg * Math.PI) / 360) };
}

/** Engraving follows each line or outline with the tool centre on it, cutting each depth level in turn. */
export function engraveToolpath(op: EngraveOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays(), intended: [] };
  const diag = (severity: CamSeverity, code: CamCode, message: string, ref?: number) =>
    out.diagnostics.push({ operationId: op.id, severity, code, message, ...(ref === undefined ? {} : { ref }) });
  if (!['vbit', 'ball', 'flat', 'bull'].includes(tool.type)) {
    diag('error', 'wrong-tool', 'Engraving needs a V-bit, ball, flat or bull-nose tool');
    return out;
  }
  const d = engraveDepth(op, tool);
  if ('error' in d) {
    diag('error', 'wrong-tool', d.error);
    return out;
  }
  const feed = op.feeds.feed;
  const plunge = op.feeds.plungeFeed;
  const w = new MoveWriter();
  let clearance = -Infinity;
  let first = true;
  for (const c of geo.contours) {
    const hr = resolveHeights(op.heights, ctx, { contourZ: c.z, holeBottom: null, faceZ: geo.faceZ });
    if (!hr.values) { for (const e of hr.errors) diag('error', 'heights-invalid', e, c.ref); continue; }
    const h = hr.values;
    out.heights ??= h;
    clearance = Math.max(clearance, h.clearance);
    const levels = depthLevels(h.top, h.top - d.depth, op.stepdown);
    if (!levels.length) continue;
    if (first) w.travel(pathStart(c.path), h.clearance, h.feed);
    else {
      w.up(h.retract);
      w.travel(pathStart(c.path), h.retract, h.feed);
    }
    first = false;
    let cur = c.path;
    for (const z of levels) {
      // the tool is at the start of `cur` (closed: back where it began; open: at the end the last level reached)
      w.line({ ...w.pos!, z }, plunge);
      emitLap(w, cur, z, z, feed, null);
      if (!cur.closed) cur = reversePath(cur);
    }
    w.up(h.retract);
  }
  if (!w.moves.length || out.diagnostics.some((x) => x.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = { operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves };
  return out;
}
