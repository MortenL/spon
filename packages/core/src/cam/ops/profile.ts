import { fitArcs } from '../../geometry/offset/arcFit';
import { offsetOpenPath } from '../../geometry/offset/openOffset';
import { offsetPolys, pointInPolys, segmentCrossesPolys } from '../../geometry/offset/clipper';
import {
  dist2, flattenPath, orientPath, pathLength, pathStart, pointAt, polyArea, reversePath, rotateStart, segmentLength, v2,
} from '../../geometry/offset/pathOps';
import { type Path2D, type Segment, segmentStart, type Vec2 } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry } from '../features/resolve';
import { resolveHeights, type ResolvedHeights } from '../heights';
import type { CamCode, CamSeverity, ProfileOp } from '../types';
import { leadIn, leadOut } from './leads';
import { emptyOverlays, type OpOutput } from './output';
import { tabIntervals } from './tabs';
import { depthLevels, emitLap, emitRampLaps, MoveWriter, type TabProfile } from './writer';

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

/** Flattening tolerance and slack (mm) of the free-region check for leads and links; together they stay under 1 µm. */
const FREE_TOL = 1e-4;
const FREE_SLACK = 5e-4;
/** Leads are halved until they fit, but never below this length (mm); shorter leads are left out. */
const MIN_LEAD = 0.1;

/**
 * Tool-centre laps of a contour: offset outward/inward by `offset`, or the contour itself for "on" and open paths.
 *
 * Three approximations can each move a lap towards the material: flattening the contour (chords cut into convex
 * material), up to tol/4; Clipper's round joins (chords inside the true offset arc), up to tol/8; and arc
 * fitting, up to tol/2, which fitArcs also enforces between input points (a few sparse vertices would otherwise
 * be fitted by one arc bulging far from the lap). The joins stay well under the fit bound, or arcs could not
 * follow their chords. The lap is offset by their sum beyond `offset`, so the tool centre never comes closer
 * than `offset` to the contour; the lap stays within `tol` of nominal.
 */
function centreLaps(path: Path2D, op: ProfileOp, offset: number, tol: number): { laps: Path2D[]; rounded: boolean } | null {
  if (!path.closed) {
    if (op.openSide === 'on' || offset === 0) return { laps: [path], rounded: false };
    const res = offsetOpenPath(path, op.openSide, offset, tol);
    if (!res) return null;
    // climb keeps the cut edge on the tool's right (M3): left of the line runs with it, right runs against it
    const forward = (op.openSide === 'left') === (op.direction === 'climb');
    const laps = forward ? res.paths : res.paths.map(reversePath).reverse();
    return { laps, rounded: res.rounded };
  }
  const side = op.side;
  if (side === 'on' || offset === 0) return { laps: [path], rounded: false };
  const flatTol = tol / 4, joinTol = tol / 8, fitTol = tol / 2;
  const d = offset + flatTol + joinTol + fitTol;
  const poly = flattenPath(orientPath(path, true), flatTol);
  const res = offsetPolys([poly], side === 'outside' ? d : -d, joinTol).filter((p) => polyArea(p) > 0);
  return res.length ? { laps: res.map((p) => fitArcs(p, true, fitTol, fitTol)), rounded: false } : null;
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
  let leadWarned = false;

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
    lap: Path2D, levels: number[], h: ResolvedHeights, first: boolean, index: number, ref: number, useExplicit: boolean, recordOverlay: boolean,
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

    // The tool centre may only move inside the lap ('inside') or outside it ('outside', 'on'); the lap is its
    // boundary. The check polygon is widened by FREE_SLACK so moves along or tangent to the lap itself pass.
    const lapPoly = flattenPath(orientPath(path, true), FREE_TOL);
    const inside = op.side === 'inside';
    const check = offsetPolys([lapPoly], inside ? FREE_SLACK : -FREE_SLACK, FREE_TOL);
    const clear = (a: Vec2, b: Vec2) => !segmentCrossesPolys(a, b, check) && pointInPolys(b, check) === inside;
    const segsClear = (segs: Segment[]) => {
      const pts = flattenPath({ closed: false, segments: segs }, FREE_TOL);
      for (let i = 0; i + 1 < pts.length; i++) {
        const n = Math.max(1, Math.ceil(dist2(pts[i], pts[i + 1]) / 0.05));
        for (let k = 0; k < n; k++) {
          const a = lerp(pts[i], pts[i + 1], k / n), b = lerp(pts[i], pts[i + 1], (k + 1) / n);
          if (!clear(a, b)) return false;
        }
      }
      return true;
    };
    /** The longest lead (halving from the set length, not below MIN_LEAD) that stays in the free region. */
    const fitLead = (make: (length: number) => Segment[]): Segment[] => {
      if (op.leads.mode === 'none' || !(op.leads.length > 0)) return [];
      for (let len = op.leads.length; ; len /= 2) {
        const segs = make(len);
        if (segsClear(segs)) return segs;
        if (len / 2 < MIN_LEAD) break;
      }
      if (!leadWarned) {
        diag('warning', 'entry-plunge', 'A lead-in or lead-out does not fit beside this contour and was left out; the tool ramps along the path instead', ref);
        leadWarned = true;
      }
      return [];
    };
    const inSegs = fitLead((len) => leadIn(P, T, freeLeft, op.leads.mode, len));
    const outSegs = fitLead((len) => leadOut(P, T, freeLeft, op.leads.mode, len));
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
      if (i < levels.length - 1 && dist2(w.pos!, S) > 1e-9) {
        // back to the entry point for the next level: straight if that stays in the free region, else over the top
        if (segsClear([{ kind: 'line', from: v2(w.pos!.x, w.pos!.y), to: S }])) w.line({ x: S.x, y: S.y, z }, feed);
        else {
          w.travel(S, h.feed, h.feed);
          w.line({ x: S.x, y: S.y, z }, plunge);
        }
      }
      prev = z;
    });
    w.up(h.retract);
  };

  const cutOpen = (lap: Path2D, levels: number[], h: ResolvedHeights, first: boolean, sameWay: boolean) => {
    if (op.entry.mode !== 'plunge' && !plungeWarned) {
      diag('warning', 'entry-plunge', 'Open contours are entered with a plunge');
      plungeWarned = true;
    }
    let path = lap;
    w.travel(pathStart(path), first ? h.clearance : h.retract, h.feed);
    levels.forEach((z, i) => {
      if (sameWay && i > 0) w.travel(pathStart(path), h.retract, h.feed); // back over the top: every level cuts the same way
      w.line({ x: w.pos!.x, y: w.pos!.y, z }, plunge);
      emitLap(w, path, z, z, feed, null);
      if (!sameWay) path = reversePath(path);
    });
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
    const res = centreLaps(c.path, op, r + op.stockRadial, tol);
    if (!res) {
      return diag('error', 'offset-collapsed', c.path.closed ? 'The tool does not fit inside this contour' : 'The tool does not fit beside this line', c.ref);
    }
    const { laps } = res;
    if (res.rounded) diag('warning', 'bend-rounded', 'The tool is too large for a bend in this line; the bend was rounded', c.ref);
    const levels = depthLevels(h.top, h.bottom + op.stockAxial, op.stepdown);
    laps.forEach((lap, i) => {
      if (lap.closed) cutClosed(lap, levels, h, first, index, c.ref, i === 0, i === 0);
      else cutOpen(lap, levels, h, first, op.openSide !== 'on');
      first = false;
    });
    if (op.finishPass && c.path.closed) {
      const finishLaps = centreLaps(c.path, op, r, tol)?.laps ?? [];
      finishLaps.forEach((lap, i) => cutClosed(lap, [h.bottom], h, false, index, c.ref, i === 0, false));
    }
  });

  if (!w.moves.length || out.diagnostics.some((d) => d.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = {
    operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves,
  };
  return out;
}
