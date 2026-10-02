import { orientPath, pathStart, reversePath, rotateStart } from '../../geometry/offset/pathOps';
import type { Path2D } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry } from '../features/resolve';
import { resolveHeights, type ResolvedHeights } from '../heights';
import type { CamCode, CamSeverity, ChamferOp } from '../types';
import { emptyOverlays, type OpOutput } from './output';
import { autoStart, contourLaps, lapRunsCW } from './profile';
import { emitLap, MoveWriter } from './writer';

export interface ChamferGeometry {
  /** Tip depth below the edge at the final level (mm). */
  depth: number;
  /** Distance of the tool centre from the edge at the final level (mm). */
  offset: number;
  /** The widest chamfer this tool can cut (mm). */
  maxWidth: number;
  /** Half the included tip angle (rad). */
  halfAngle: number;
}

/** Depth, centre offset and widest chamfer of `tool` for a chamfer `width` measured on the surface with the tip `tipOffset` out of the edge. */
export function chamferGeometry(tool: Tool, width: number, tipOffset: number): ChamferGeometry {
  const halfAngle = ((tool.tipAngleDeg / 2) * Math.PI) / 180;
  const offset = tipOffset * Math.tan(halfAngle);
  return { depth: width / Math.tan(halfAngle) + tipOffset, offset, maxWidth: tool.diameter / 2 - offset, halfAngle };
}

export function chamferToolpath(op: ChamferOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays() };
  const diag = (severity: CamSeverity, code: CamCode, message: string, ref?: number) =>
    out.diagnostics.push({ operationId: op.id, severity, code, message, ...(ref === undefined ? {} : { ref }) });
  if (tool.type !== 'chamfer' && tool.type !== 'vbit') {
    diag('error', 'wrong-tool', 'Chamfering needs a chamfer mill or V-bit');
    return out;
  }
  if (!(tool.tipAngleDeg > 0 && tool.tipAngleDeg < 180)) {
    diag('error', 'wrong-tool', 'The tool needs a tip angle between 0 and 180 degrees');
    return out;
  }
  const g = chamferGeometry(tool, op.width, op.tipOffset);
  if (op.width > g.maxWidth + 1e-9) {
    diag('error', 'tool-too-large', `Chamfer too wide for this tool (max ${g.maxWidth.toFixed(2)} mm)`);
    return out;
  }
  const tol = ctx.tolerance;
  const tanA = Math.tan(g.halfAngle);
  const feed = op.feeds.feed;
  const plunge = op.feeds.plungeFeed;
  const w = new MoveWriter();
  let clearance = -Infinity;
  let first = true;
  let roundedWarned = false;
  // the depth is computed, so the bottom height is a placeholder far below anything (it is ignored)
  const heights = { ...op.heights, bottom: { from: 'origin' as const, offset: -1e6 } };

  /** Tip depths below the edge and the centre offset of each level: every cone stays on the final chamfer surface. */
  const n = op.stepdown > 0 ? Math.max(1, Math.ceil(g.depth / op.stepdown - 1e-9)) : 1;
  const levels = Array.from({ length: n }, (_, k) => {
    const d = (g.depth * (k + 1)) / n;
    return { d, offset: g.offset - (g.depth - d) * tanA };
  });

  /**
   * Cuts every level of one path. `side` is the side of the air next to the edge (the tool centre sits there for a
   * positive offset); a negative offset puts the centre on the other side. The running direction follows the
   * unswapped side at every level, so a chamfer and a profile on the same edge run the same way.
   */
  const cutPath = (path: Path2D, side: 'outside' | 'inside', openSide: 'left' | 'right', h: ResolvedHeights, ref: number) => {
    // climb keeps the cut edge on the tool's right (M3): left of the line runs with it, right runs against it
    const forward = (openSide === 'left') === (op.direction === 'climb');
    for (const lv of levels) {
      const neg = lv.offset < -1e-9;
      // contourLaps biases a lap away from the edge by up to 7/8 tol and its approximations err by up to 7/8 tol either
      // way. That is right for a positive offset (the cone stays clear of the final surface), but a swapped level
      // sits inside the part edge, where the bias would cut past the final surface. Take 7/4 tol off the distance so
      // the lap is never deeper than nominal (a clamped level runs on the edge itself).
      const abs = Math.abs(lv.offset);
      const off = abs < 1e-9 ? 0 : neg ? Math.max(0, abs - 1.75 * tol) : abs;
      const cSide = neg ? (side === 'outside' ? 'inside' : 'outside') : side;
      const cOpen = neg ? (openSide === 'left' ? 'right' : 'left') : openSide;
      // contourLaps decides the open travel direction from its side; hand it the direction that keeps the unswapped rule
      const dir = (cOpen === 'left') === forward ? 'climb' : 'conventional';
      const res = contourLaps(path, cSide, cOpen, dir, off, tol);
      if (!res) return diag('error', 'offset-collapsed', path.closed ? 'The tool does not fit inside this contour' : 'The tool does not fit beside this line', ref);
      if (res.rounded && !roundedWarned) {
        diag('warning', 'bend-rounded', 'The tool is too large for a bend in this line; the bend was rounded', ref);
        roundedWarned = true;
      }
      const z = h.top - lv.d;
      for (const lap of res.laps) {
        let run = lap;
        if (lap.closed) {
          run = orientPath(lap, !lapRunsCW(side, op.direction));
          run = rotateStart(run, autoStart(run));
        } else if (off === 0 && !forward) {
          run = reversePath(lap); // an unoffset line runs as drawn from contourLaps
        }
        w.travel(pathStart(run), first ? h.clearance : h.retract, h.feed);
        w.line({ x: w.pos!.x, y: w.pos!.y, z }, plunge);
        emitLap(w, run, z, z, feed, null);
        w.up(h.retract);
        first = false;
      }
    }
  };

  const heightsFor = (contourZ: number) => resolveHeights(heights, ctx, { contourZ, holeBottom: null, faceZ: geo.faceZ });

  geo.contours.forEach((c) => {
    const hr = heightsFor(c.z);
    if (!hr.values) {
      for (const e of hr.errors) diag('error', 'heights-invalid', e, c.ref);
      return;
    }
    const h = hr.values;
    out.heights ??= { ...h, bottom: h.top - g.depth };
    clearance = Math.max(clearance, h.clearance);
    const side = op.side === 'auto' ? (c.kind === 'inner' ? 'inside' : 'outside') : op.side;
    cutPath(c.path, side, op.openSide, h, c.ref);
  });

  geo.holes.forEach((hole) => {
    const hr = heightsFor(hole.top);
    if (!hr.values) {
      for (const e of hr.errors) diag('error', 'heights-invalid', e, hole.ref);
      return;
    }
    const h = hr.values;
    out.heights ??= { ...h, bottom: h.top - g.depth };
    clearance = Math.max(clearance, h.clearance);
    const circle: Path2D = { closed: true, segments: [{ kind: 'arc', center: hole.center, radius: hole.diameter / 2, startAngle: 0, sweep: 2 * Math.PI }] };
    cutPath(circle, 'inside', op.openSide, h, hole.ref);
  });

  if (!w.moves.length || out.diagnostics.some((d) => d.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = {
    operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves,
  };
  return out;
}
