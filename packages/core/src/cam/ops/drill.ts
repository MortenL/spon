import { dist2 } from '../../geometry/offset/pathOps';
import type { Vec2 } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry, ResolvedHole } from '../features/resolve';
import { resolveHeights } from '../heights';
import type { CamCode, CamSeverity, DrillOp } from '../types';
import { emptyOverlays, type OpOutput } from './output';
import { MoveWriter } from './writer';

export function drillToolpath(op: DrillOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays() };
  const diag = (severity: CamSeverity, code: CamCode, message: string, ref?: number) =>
    out.diagnostics.push({ operationId: op.id, severity, code, message, ...(ref === undefined ? {} : { ref }) });
  const f = op.diameterFilter;
  const holes = geo.holes.filter((h) => !f || (h.diameter >= f.min - 1e-9 && h.diameter <= f.max + 1e-9));
  if (!holes.length) {
    diag('error', 'no-geometry', f ? 'No holes match the diameter filter' : 'There are no holes to drill');
    return out;
  }
  let undersize = false;
  for (const h of holes) {
    if (tool.diameter > h.diameter + ctx.tolerance) diag('error', 'tool-too-large', `The ${tool.diameter} mm tool is larger than a ${h.diameter.toFixed(2)} mm hole`, h.ref);
    else if (tool.diameter < 0.9 * h.diameter) undersize = true;
  }
  if (undersize) diag('warning', 'tool-undersize', 'The tool is more than 10 % smaller than some holes');
  if (out.diagnostics.some((d) => d.severity === 'error')) return out;

  const ordered: ResolvedHole[] = [];
  const left = [...holes];
  let at: Vec2 = { x: 0, y: 0 };
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (dist2(left[i].center, at) < dist2(left[best].center, at) - 1e-12) best = i;
    const [h] = left.splice(best, 1);
    ordered.push(h);
    at = h.center;
  }

  const w = new MoveWriter();
  let clearance = -Infinity;
  for (const h of ordered) {
    const hr = resolveHeights(op.heights, ctx, { contourZ: h.top, holeBottom: h.bottom, faceZ: geo.faceZ });
    if (!hr.values) {
      for (const e of hr.errors) diag('error', 'heights-invalid', e, h.ref);
      continue;
    }
    const v = hr.values;
    out.heights ??= v;
    clearance = Math.max(clearance, v.clearance);
    if (!w.pos) w.travel(h.center, v.clearance, v.retract);
    else if (Math.abs(w.pos.z - v.retract) > 1e-9) w.travel(h.center, Math.max(w.pos.z, v.retract), v.retract);
    w.cycle({
      kind: 'cycle', cycle: op.cycle, at: h.center, top: v.top, bottom: v.bottom, r: v.feed, retract: v.retract,
      peck: op.peck, dwell: op.dwellSeconds, feed: op.feeds.plungeFeed,
    });
  }
  if (!w.moves.length || out.diagnostics.some((d) => d.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = {
    operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves,
  };
  return out;
}
