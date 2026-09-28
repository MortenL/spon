import { fitArcs } from '../../geometry/offset/arcFit';
import { offsetPolys } from '../../geometry/offset/clipper';
import {
  flattenPath, orientPath, pathLength, pathStart, pointAt, polyArea, reversePath, rotateStart, segmentLength,
} from '../../geometry/offset/pathOps';
import { type Path2D, type Segment, segmentStart } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry } from '../features/resolve';
import { resolveHeights, type ResolvedHeights } from '../heights';
import type { CamCode, CamSeverity, ProfileOp } from '../types';
import { leadIn, leadOut } from './leads';
import { emptyOverlays, type OpOutput } from './output';
import { tabIntervals } from './tabs';
import { depthLevels, emitLap, emitRampLaps, MoveWriter, type TabProfile } from './writer';

/** Tool-centre laps of a contour: offset outward/inward by `offset`, or the contour itself for "on" and open paths. */
function centreLaps(path: Path2D, side: ProfileOp['side'], offset: number, tol: number): Path2D[] | null {
  if (!path.closed || side === 'on' || offset === 0) return [path];
  const poly = flattenPath(orientPath(path, true), tol);
  const res = offsetPolys([poly], side === 'outside' ? offset : -offset, tol).filter((p) => polyArea(p) > 0);
  return res.length ? res.map((p) => fitArcs(p, true, tol)) : null;
}

/** Midpoint of the longest line segment, else of the longest arc. */
function autoStart(path: Path2D): number {
  let best = 0, bestLen = -1, bestIsLine = false, acc = 0;
  for (const s of path.segments) {
    const len = segmentLength(s);
    const isLine = s.kind === 'line';
    if ((isLine && !bestIsLine) || (isLine === bestIsLine && len > bestLen)) {
      best = acc + len / 2;
      bestLen = len;
      bestIsLine = isLine;
    }
    acc += len;
  }
  return best;
}

export function profileToolpath(op: ProfileOp, tool: Tool, ctx: CamContext, geo: ResolvedGeometry): OpOutput {
  const out: OpOutput = { toolpath: null, diagnostics: [], heights: null, overlays: emptyOverlays() };
  const diag = (severity: CamSeverity, code: CamCode, message: string, ref?: number) =>
    out.diagnostics.push({ operationId: op.id, severity, code, message, ...(ref === undefined ? {} : { ref }) });
  const tol = ctx.tolerance;
  const r = tool.diameter / 2;
  const feed = op.feeds.feed;
  const plunge = op.feeds.plungeFeed;
  const angle = op.entry.rampAngleDeg;
  const tanA = Math.tan((Math.max(0.1, angle) * Math.PI) / 180);
  const w = new MoveWriter();
  let clearance = -Infinity;
  let plungeWarned = false;

  const emitSegs = (segs: Segment[], z0: number, z1: number) => {
    const total = segs.reduce((a, s) => a + segmentLength(s), 0);
    let acc = 0;
    for (const s of segs) {
      const len = segmentLength(s);
      w.segment(s, z0 + ((z1 - z0) * acc) / total, z0 + ((z1 - z0) * (acc + len)) / total, feed);
      acc += len;
    }
  };

  /**
   * Cuts one closed lap at the given levels; the tool travels to it first. `index` is the contour's index in
   * `geo.contours` (the refIndex tabs and lead start points key on). `useExplicit` is true for a contour's first
   * roughing or finish piece, where explicit tab positions and an explicit lead start point apply; a contour whose
   * offset splits falls back to automatic placement and an automatic start for its later pieces. `recordOverlay`
   * is true only for a contour's first roughing piece, so overlays are reported once per contour.
   */
  const cutClosed = (
    lap: Path2D, levels: number[], h: ResolvedHeights, first: boolean, index: number, useExplicit: boolean, recordOverlay: boolean,
  ) => {
    const wantCW = (op.side !== 'inside') === (op.direction === 'climb');
    let path = orientPath(lap, !wantCW);
    const total = pathLength(path);
    const explicitStart =
      useExplicit && op.leads.startPoint !== 'auto' && op.leads.startPoint.refIndex === index ? op.leads.startPoint.t * total : null;
    path = rotateStart(path, explicitStart ?? autoStart(path));
    const P = pathStart(path);
    const T = pointAt(path, 0).tangent;
    const freeLeft = op.side === 'inside' ? !wantCW : wantCW; // CW loop: outside is on the left
    const inSegs = leadIn(P, T, freeLeft, op.leads.mode, op.leads.length);
    const outSegs = leadOut(P, T, freeLeft, op.leads.mode, op.leads.length);
    const S = inSegs.length ? segmentStart(inSegs[0]) : P;
    const inLen = inSegs.reduce((a, s) => a + segmentLength(s), 0);

    let tabsAt: (z: number) => TabProfile | null = () => null;
    if (op.tabs.enabled) {
      const explicit = useExplicit && op.tabs.positions ? op.tabs.positions.filter((p) => p.refIndex === index).map((p) => p.t) : null;
      const { intervals, skipped } = tabIntervals(path, op.tabs, r, explicit);
      if (skipped) diag('warning', 'tab-skipped', `${skipped} tab(s) did not fit and were skipped`);
      const top = h.bottom + op.tabs.height;
      const profile: TabProfile = { top, base: h.bottom, intervals };
      tabsAt = (z) => (intervals.length && z < top - 1e-9 ? profile : null);
      if (recordOverlay) {
        for (const iv of intervals) out.overlays.tabs.push({ refIndex: index, t: iv.center / total, point: pointAt(path, iv.center).point });
        if (intervals.length || (useExplicit && op.tabs.positions)) {
          out.overlays.laps.push({ refIndex: index, points: flattenPath(path, 0.01), z: top });
        }
      }
    }

    w.travel(S, first ? h.clearance : h.retract, h.feed);
    let prev = h.feed;
    levels.forEach((z, i) => {
      const drop = prev - z;
      if (op.entry.mode === 'plunge') {
        w.line({ x: S.x, y: S.y, z }, plunge);
        emitSegs(inSegs, z, z);
      } else if (inSegs.length && inLen * tanA >= drop - 1e-9) {
        emitSegs(inSegs, prev, z);
      } else {
        emitSegs(inSegs, prev, prev);
        emitRampLaps(w, path, prev, z, angle, feed, tabsAt(z));
      }
      emitLap(w, path, z, z, feed, tabsAt(z));
      emitSegs(outSegs, z, z);
      if (i < levels.length - 1 && inSegs.length) w.line({ x: S.x, y: S.y, z }, feed);
      prev = z;
    });
    w.up(h.retract);
  };

  const cutOpen = (lap: Path2D, levels: number[], h: ResolvedHeights, first: boolean) => {
    if (op.entry.mode !== 'plunge' && !plungeWarned) {
      diag('warning', 'entry-plunge', 'Open contours are entered with a plunge');
      plungeWarned = true;
    }
    let path = lap;
    w.travel(pathStart(path), first ? h.clearance : h.retract, h.feed);
    for (const z of levels) {
      w.line({ x: w.pos!.x, y: w.pos!.y, z }, plunge);
      emitLap(w, path, z, z, feed, null);
      path = reversePath(path);
    }
    w.up(h.retract);
  };

  let first = true;
  geo.contours.forEach((c, index) => {
    const hr = resolveHeights(op.heights, ctx, { contourZ: c.z, holeBottom: null, faceZ: geo.faceZ });
    if (!hr.values) {
      for (const e of hr.errors) diag('error', 'heights-invalid', e, c.ref);
      return;
    }
    const h = hr.values;
    out.heights ??= h;
    clearance = Math.max(clearance, h.clearance);
    const laps = centreLaps(c.path, op.side, r + op.stockRadial, tol);
    if (!laps) return diag('error', 'offset-collapsed', 'The tool does not fit inside this contour', c.ref);
    const levels = depthLevels(h.top, h.bottom + op.stockAxial, op.stepdown);
    laps.forEach((lap, i) => {
      if (lap.closed) cutClosed(lap, levels, h, first, index, i === 0, i === 0);
      else cutOpen(lap, levels, h, first);
      first = false;
    });
    if (op.finishPass && c.path.closed) {
      const finishLaps = centreLaps(c.path, op.side, r, tol) ?? [];
      finishLaps.forEach((lap, i) => cutClosed(lap, [h.bottom], h, false, index, i === 0, false));
    }
  });

  if (!w.moves.length || out.diagnostics.some((d) => d.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = {
    operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves,
  };
  return out;
}
