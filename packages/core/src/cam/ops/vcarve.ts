import { offsetPolys, type Poly } from '../../geometry/offset/clipper';
import { flattenPath, orientPath, polyArea } from '../../geometry/offset/pathOps';
import type { Vec2 } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { Shape } from '../features/chain';
import type { ResolvedGeometry } from '../features/resolve';
import { resolveHeights, type ResolvedHeights } from '../heights';
import type { CamCode, CamSeverity, VCarveOp } from '../types';
import { medialGraph } from '../vcarve/medial';
import { sampleShape, sampleSpacing } from '../vcarve/sample';
import { type Stroke, vcarveStrokes } from '../vcarve/strokes';
import { emptyOverlays, type OpOutput } from './output';
import { MoveWriter } from './writer';

/** A shape as flattened polygons (within `tol / 4`): the outline counter-clockwise, the islands clockwise. */
export function shapePolys(shape: Shape, tol: number): Vec2[][] {
  const orient = (poly: Vec2[], ccw: boolean) => ((polyArea(poly) > 0) === ccw ? poly : [...poly].reverse());
  return [
    orient(flattenPath(orientPath(shape.outer, true), tol / 4), true),
    ...shape.islands.map((i) => orient(flattenPath(orientPath(i, false), tol / 4), false)),
  ];
}

/** The part of a shape deeper than `R` from every wall: the inward offset by `R`, where a V-bit at its max depth cuts flat. */
export function flatAreas(polys: Vec2[][], R: number, tol = 0.001): Poly[] {
  return offsetPolys(polys, -R, tol / 8);
}

const EPS = 1e-9;

/** Spec §3: V-carving cuts each shape's centreline at the depth where the V's surface width meets the walls. */
export function vcarveToolpath(op: VCarveOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays(), intended: [] };
  const diag = (severity: CamSeverity, code: CamCode, message: string, ref?: number) =>
    out.diagnostics.push({ operationId: op.id, severity, code, message, ...(ref === undefined ? {} : { ref }) });
  if (tool.type !== 'vbit') {
    diag('error', 'wrong-tool', 'V-carve needs a V-bit');
    return out;
  }
  const tanHalf = Math.tan((tool.tipAngleDeg * Math.PI) / 360);
  const tol = ctx.tolerance;
  const s = sampleSpacing(tol);
  const w = new MoveWriter();
  const feed = op.feeds.feed, plunge = op.feeds.plungeFeed;
  let clearance = -Infinity;
  let deepest = 0;
  let hasFlat = false;

  for (const sh of geo.shapes) {
    const hr = resolveHeights(op.heights, ctx, { contourZ: sh.z, holeBottom: null, faceZ: geo.faceZ });
    if (!hr.values) {
      for (const e of hr.errors) diag('error', 'heights-invalid', e, sh.ref);
      continue;
    }
    const h = hr.values;
    out.heights ??= h;
    clearance = Math.max(clearance, h.clearance);
    const polys = shapePolys(sh.shape, tol);
    const g = medialGraph(sampleShape(polys, s), s);
    const R = op.maxDepth === null ? Infinity : op.maxDepth * tanHalf;
    const flat = op.maxDepth === null ? [] : flatAreas(polys, R, tol);
    if (flat.length) hasFlat = true;
    const strokes = vcarveStrokes(g, { top: h.top, tanHalf, maxDepth: op.maxDepth, spacing: s, tol, flatLoops: flat, outline: polys });
    let shapeDeepest = 0;
    for (const st of strokes) for (const p of st.points) shapeDeepest = Math.max(shapeDeepest, h.top - p.z);
    deepest = Math.max(deepest, shapeDeepest);
    emitShape(w, strokes, h, shapeDeepest, op.stepdown, 2 * s, feed, plunge);
  }

  if (deepest > tool.fluteLength + EPS) diag('warning', 'flute-exceeded', `V-carve depth reaches ${deepest.toFixed(2)} mm, beyond the bit's ${tool.fluteLength.toFixed(2)} mm cutting length`);
  if (op.maxDepth !== null && hasFlat && !ctx.job.operations.some((o) => o.enabled && o.type === 'vclear' && o.sourceId === op.id)) {
    diag('warning', 'vcarve-uncleared', 'Wide areas stop at the max depth; add a clearing operation');
  }
  if (!w.moves.length || out.diagnostics.some((x) => x.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = { operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves };
  return out;
}

/** One shape's strokes, in depth passes of at most `stepdown` each, each pass visiting the strokes nearest-first. */
function emitShape(w: MoveWriter, strokes: Stroke[], h: ResolvedHeights, deepest: number, stepdown: number | null, link: number, feed: number, plunge: number): void {
  if (!strokes.length) return;
  const limits: number[] = [];
  if (stepdown === null || !(stepdown > 0)) limits.push(deepest);
  else for (let k = 1; (k - 1) * stepdown < deepest - EPS; k++) limits.push(Math.min(k * stepdown, deepest));
  limits.forEach((limit, k) => {
    const prevLimit = k > 0 ? limits[k - 1] : null;
    // the first stroke of a shape never links to the previous shape's end
    let firstStroke = k === 0;
    const pending = strokes.filter((st) => prevLimit === null || st.points.some((p) => h.top - p.z > prevLimit + EPS));
    const cut = (st: Stroke): Stroke => ({ ...st, points: st.points.map((p) => ({ x: p.x, y: p.y, z: Math.max(p.z, h.top - limit) })) });
    while (pending.length) {
      const at = w.pos;
      let best = 0, bestD = Infinity, bestRev = false, bestRot = 0;
      pending.forEach((st, i) => {
        const pts = st.points;
        if (!at) { best = 0; bestD = -1; return; }
        const d = (p: Vec2) => Math.hypot(p.x - at.x, p.y - at.y);
        if (st.closed) {
          pts.forEach((p, j) => { if (d(p) < bestD) { bestD = d(p); best = i; bestRev = false; bestRot = j; } });
        } else {
          const d0 = d(pts[0]), d1 = d(pts[pts.length - 1]);
          if (Math.min(d0, d1) < bestD) { bestD = Math.min(d0, d1); best = i; bestRev = d1 < d0; bestRot = 0; }
        }
      });
      const [picked] = pending.splice(best, 1);
      let st = cut(picked);
      if (st.closed && bestRot) st = { ...st, points: [...st.points.slice(bestRot), ...st.points.slice(0, bestRot)] };
      else if (bestRev) st = { ...st, points: [...st.points].reverse() };
      const pts = st.points;
      const first = pts[0];
      const linked = !firstStroke && w.pos !== null && w.pos.z <= h.top - 0.01 && first.z <= h.top - 0.01 && Math.hypot(first.x - w.pos.x, first.y - w.pos.y) <= link;
      firstStroke = false;
      if (linked) w.line(first, feed);
      else {
        if (w.pos) w.up(h.retract);
        w.travel(first, w.pos ? h.retract : h.clearance, h.feed);
        w.line(first, plunge);
      }
      for (let i = 1; i < pts.length; i++) w.line(pts[i], feed);
      if (st.closed) w.line(first, feed);
      if (pts.length === 1) w.up(h.retract);
    }
  });
}
