import { fitArcs } from '../../geometry/offset/arcFit';
import { offsetOpenPath } from '../../geometry/offset/openOffset';
import { offsetPolys, pointInPolys, segmentCrossesPolys } from '../../geometry/offset/clipper';
import {
  dist2, flattenPath, nearestS, orientPath, pathLength, pathStart, pointAt, polyArea, reversePath, rotateStart, segmentLength, v2,
} from '../../geometry/offset/pathOps';
import { type Path2D, type Segment, segmentStart, type Vec2 } from '../../geometry/path2d';
import type { Tool } from '../../tools/types';
import type { CamContext } from '../context';
import type { ResolvedGeometry } from '../features/resolve';
import { resolveHeights, type ResolvedHeights } from '../heights';
import type { CamCode, CamSeverity, ProfileOp } from '../types';
import { leadIn, leadOut } from './leads';
import { emptyOverlays, type OpOutput } from './output';
import { contourTabs, pushTabOverlays } from './tabs';
import { depthLevels, emitLap, emitRampLaps, MoveWriter, type TabInterval, type TabProfile } from './writer';

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

/** Flattening tolerance and slack (mm) of the free-region check for leads and links; together they stay under 1 µm. */
const FREE_TOL = 1e-4;
const FREE_SLACK = 5e-4;
/** Leads are halved until they fit, but never below this length (mm); shorter leads are left out. */
const MIN_LEAD = 0.1;

/** Whether a closed lap cut on `side` runs clockwise: with an M3 spindle climb keeps the cut edge on the cutter's right. */
export const lapRunsCW = (side: 'outside' | 'inside' | 'on', direction: 'climb' | 'conventional'): boolean => (side !== 'inside') === (direction === 'climb');

/**
 * Tool-centre laps of a contour: offset outward/inward by `offset`, or the contour itself for "on" and open paths.
 *
 * Three approximations can each move a lap towards the material: flattening the contour (chords cut into convex
 * material), up to tol/4; Clipper's round joins (chords inside the true offset arc), up to tol/8; and arc
 * fitting, up to tol/2, which fitArcs also enforces between input points (a few sparse vertices would otherwise
 * be fitted by one arc bulging far from the lap). The joins stay well under the fit bound, or arcs could not
 * follow their chords. The lap is offset by their sum beyond `offset`, so the tool centre never comes closer
 * than `offset` to the contour; the lap stays within `tol` of nominal. Open laps come in cutting order and direction;
 * `reversed` tells when that runs against `path`.
 */
export function contourLaps(
  path: Path2D, side: 'outside' | 'inside' | 'on', openSide: 'left' | 'on' | 'right', direction: 'climb' | 'conventional', offset: number, tol: number,
): { laps: Path2D[]; rounded: boolean; reversed: boolean } | null {
  if (!path.closed) {
    if (openSide === 'on' || offset === 0) return { laps: [path], rounded: false, reversed: false };
    const res = offsetOpenPath(path, openSide, offset, tol);
    if (!res) return null;
    // climb keeps the cut edge on the tool's right (M3): left of the line runs with it, right runs against it
    const forward = (openSide === 'left') === (direction === 'climb');
    const laps = forward ? res.paths : res.paths.map(reversePath).reverse();
    return { laps, rounded: res.rounded, reversed: !forward };
  }
  if (side === 'on' || offset === 0) return { laps: [path], rounded: false, reversed: false };
  const flatTol = tol / 4, joinTol = tol / 8, fitTol = tol / 2;
  const d = offset + flatTol + joinTol + fitTol;
  const poly = flattenPath(orientPath(path, true), flatTol);
  const res = offsetPolys([poly], side === 'outside' ? d : -d, joinTol).filter((p) => polyArea(p) > 0);
  return res.length ? { laps: res.map((p) => fitArcs(p, true, fitTol, fitTol)), rounded: false, reversed: false } : null;
}

/** Midpoint of the longest line segment, else of the longest arc. */
export function autoStart(path: Path2D): number {
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

/**
 * A closed lap in the frame its tab positions are measured in, whatever the cut direction and lead start point:
 * counter-clockwise, starting at the automatic start point (the middle of the longest straight edge). Where several
 * edges tie for longest (a rectangle), it is the one a clockwise lap picks, the frame schema 9 measured the tabs of
 * the default (climb, outside) cut in, so those convert exactly (see migration 9 → 10).
 */
export function tabFrame(lap: Path2D): Path2D {
  const ccw = orientPath(lap, true);
  const cw = orientPath(lap, false);
  if (cw === ccw) return rotateStart(ccw, autoStart(ccw)); // no area: no orientation to choose
  return rotateStart(ccw, pathLength(ccw) - autoStart(cw));
}

/** Distance from `a` to `b` around a closed path of length `total`. */
const aroundDist = (a: number, b: number, total: number) => {
  const d = Math.abs(a - b) % total;
  return Math.min(d, total - d);
};

/**
 * A start on a closed path of length `total` at least `clear` away from every tab centre: `start` itself when it is,
 * else the nearest free place (the end of a tab's clearance). `start` when the tabs leave no such place.
 */
export function startOffTabs(start: number, centres: readonly number[], clear: number, total: number): number {
  if (!(total > 0) || !centres.length) return start;
  const wrap = (s: number) => ((s % total) + total) % total;
  const free = (s: number) => centres.every((c) => aroundDist(s, c, total) >= clear - 1e-9);
  if (free(wrap(start))) return wrap(start);
  let best = start, bestD = Infinity;
  for (const c of centres) {
    for (const s of [wrap(c - clear), wrap(c + clear)]) {
      const d = aroundDist(s, start, total);
      if (d < bestD - 1e-12 && free(s)) { best = s; bestD = d; }
    }
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
  // the side of the contour being cut: an inner loop (a counter of a letter) is cut on the opposite side, so the tool stays out of the material
  let side = op.side;

  const emitSegs = (segs: Segment[], z0: number, z1: number) => {
    const total = segs.reduce((a, s) => a + segmentLength(s), 0);
    let acc = 0;
    for (const s of segs) {
      const len = segmentLength(s);
      w.segment(s, z0 + ((z1 - z0) * acc) / total, z0 + ((z1 - z0) * (acc + len)) / total, feed);
      acc += len;
    }
  };

  const tabTop = (h: ResolvedHeights) => h.bottom + op.tabs.height;
  /** Half a tab interval along a tool-centre lap: half the tab and the tool radius. */
  const tabHalf = op.tabs.width / 2 + r;
  /** Tool-centre distance kept between a closed lap's start and a tab: the lead-in and lead-out start there too. */
  const startClear = tabHalf + (op.leads.mode === 'none' ? 0 : Math.max(0, op.leads.length));
  const noTabs = { at: (_z: number, _rev: boolean): TabProfile | null => null };

  /**
   * Places one contour's tabs once, on its roughing laps in their tab frames (`frames`: closed laps counter-clockwise
   * from the automatic start, open laps in the line's drawn direction; never the cut direction or lead start), and
   * records the tab path (the frame at `first`, where explicit manual positions apply) in the overlays. Other
   * pieces of a split contour are placed automatically, except that an empty manual list still means no tabs.
   * Returns each lap's tab centres as points; every lap as cut, and every later lap (the finish pass), takes them by
   * projecting each to its nearest point (spec §4).
   */
  const planContourTabs = (frames: Path2D[], first: number, index: number, ref: number, top: number): Vec2[][] => {
    if (!op.tabs.enabled) return frames.map(() => []);
    const emptyEntry = op.tabs.manual.find((m) => m.refIndex === index);
    const noManualTabs = emptyEntry && emptyEntry.t.length === 0 ? [emptyEntry] : [];
    let skippedAll = 0;
    const points = frames.map((path, i) => {
      const { intervals, skipped, manual } = contourTabs(path, i === first ? op.tabs : { ...op.tabs, manual: noManualTabs }, r, index);
      skippedAll += skipped;
      const centres = intervals.map((iv) => iv.center);
      if (i === first) pushTabOverlays(out.overlays, path, centres, index, manual, top);
      return centres.map((c) => pointAt(path, c).point);
    });
    if (skippedAll) diag('warning', 'tab-skipped', `${skippedAll} tab(s) did not fit and were skipped`, ref);
    return points;
  };

  /**
   * Tabs on one lap as cut, from tab centre points: each projected to the lap's nearest point, covering the tab width
   * and the tool diameter. A closed lap's interval across its start is also given shifted by the lap's length, so it
   * holds at both ends. Per level, the profile to cut with (null at or above the tab top); `rev` mirrors it for a lap
   * cut in reverse.
   */
  const lapTabs = (path: Path2D, points: readonly Vec2[], h: ResolvedHeights) => {
    if (!points.length) return noTabs;
    const total = pathLength(path);
    const top = tabTop(h);
    const intervals: TabInterval[] = [];
    for (const c of points.map((p) => nearestS(path, p).s).sort((a, b) => a - b)) {
      const iv: TabInterval = { s0: c - tabHalf, s1: c + tabHalf, shape: op.tabs.shape };
      intervals.push(iv);
      if (path.closed && iv.s0 < 0) intervals.push({ ...iv, s0: iv.s0 + total, s1: iv.s1 + total });
      if (path.closed && iv.s1 > total) intervals.push({ ...iv, s0: iv.s0 - total, s1: iv.s1 - total });
    }
    const forward: TabProfile = { top, base: h.bottom, intervals };
    const mirrored: TabProfile = { top, base: h.bottom, intervals: intervals.map((iv) => ({ ...iv, s0: total - iv.s1, s1: total - iv.s0 })) };
    return { at: (z: number, rev: boolean): TabProfile | null => (z < top - 1e-9 ? (rev ? mirrored : forward) : null) };
  };

  /**
   * A closed lap as cut: oriented for the cut direction, starting at the explicit lead start point (`useExplicit`:
   * the contour's first piece) or the automatic one, moved off the tabs at `tabPoints` when it falls on one.
   */
  const closedRun = (lap: Path2D, index: number, useExplicit: boolean, tabPoints: readonly Vec2[]): Path2D => {
    const path = orientPath(lap, !lapRunsCW(side, op.direction));
    const total = pathLength(path);
    const explicitStart =
      useExplicit && op.leads.startPoint !== 'auto' && op.leads.startPoint.refIndex === index ? op.leads.startPoint.t * total : null;
    const start = explicitStart ?? autoStart(path);
    const centres = tabPoints.map((p) => nearestS(path, p).s);
    return rotateStart(path, startOffTabs(start, centres, startClear, total));
  };

  /**
   * Cuts one closed lap (as cut, see `closedRun`) at the given levels; the tool travels to it first. `tabPoints` are
   * the centres of the tabs on it.
   */
  const cutClosed = (path: Path2D, levels: number[], h: ResolvedHeights, first: boolean, ref: number, tabPoints: readonly Vec2[]) => {
    const wantCW = lapRunsCW(side, op.direction);
    const P = pathStart(path);
    const T = pointAt(path, 0).tangent;
    const freeLeft = side === 'inside' ? !wantCW : wantCW; // CW loop: outside is on the left

    // The tool centre may only move inside the lap ('inside') or outside it ('outside', 'on'); the lap is its
    // boundary. The check polygon is widened by FREE_SLACK so moves along or tangent to the lap itself pass.
    const lapPoly = flattenPath(orientPath(path, true), FREE_TOL);
    const inside = side === 'inside';
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

    const plan = lapTabs(path, tabPoints, h);
    const tabsAt = (z: number) => plan.at(z, false);

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

  const cutOpen = (lap: Path2D, levels: number[], h: ResolvedHeights, first: boolean, sameWay: boolean, tabPoints: readonly Vec2[]) => {
    if (op.entry.mode !== 'plunge' && !plungeWarned) {
      diag('warning', 'entry-plunge', 'Open contours are entered with a plunge');
      plungeWarned = true;
    }
    let path = lap;
    const plan = lapTabs(lap, tabPoints, h);
    let reversed = false;
    w.travel(pathStart(path), first ? h.clearance : h.retract, h.feed);
    levels.forEach((z, i) => {
      if (sameWay && i > 0) w.travel(pathStart(path), h.retract, h.feed); // back over the top: every level cuts the same way
      w.line({ x: w.pos!.x, y: w.pos!.y, z }, plunge);
      emitLap(w, path, z, z, feed, plan.at(z, reversed));
      if (!sameWay) { path = reversePath(path); reversed = !reversed; }
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
    side = c.kind === 'inner' ? (op.side === 'outside' ? 'inside' : op.side === 'inside' ? 'outside' : 'on') : op.side;
    const res = contourLaps(c.path, side, op.openSide, op.direction, r + op.stockRadial, tol);
    if (!res && c.kind === 'inner') return diag('warning', 'offset-collapsed', 'The tool does not fit inside a counter of this contour; it was skipped', c.ref);
    if (!res) {
      return diag('error', 'offset-collapsed', c.path.closed ? 'The tool does not fit inside this contour' : 'The tool does not fit beside this line', c.ref);
    }
    const { laps } = res;
    if (res.rounded) diag('warning', 'bend-rounded', 'The tool is too large for a bend in this line; the bend was rounded', c.ref);
    const levels = depthLevels(h.top, h.bottom + op.stockAxial, op.stepdown);
    // tab frames: open laps (and their order) run against the drawn line when exactly one of them is reversed: the
    // laps against `c.path` (the cut direction), or `c.path` against the drawn line (Reverse)
    const againstDrawn = res.reversed !== (c.reversed === true);
    const frames = laps.map((lap) => (lap.closed ? tabFrame(lap) : againstDrawn ? reversePath(lap) : lap));
    // the tab path is the first lap along the drawn line (laps come in cutting order) or a closed contour's first lap
    const firstFrame = !c.path.closed && againstDrawn ? laps.length - 1 : 0;
    const tabPoints = planContourTabs(frames, firstFrame, index, c.ref, tabTop(h));
    laps.forEach((lap, i) => {
      if (lap.closed) cutClosed(closedRun(lap, index, i === 0, tabPoints[i]), levels, h, first, c.ref, tabPoints[i]);
      else cutOpen(lap, levels, h, first, op.openSide !== 'on', tabPoints[i]);
      first = false;
    });
    if (op.finishPass && (c.path.closed || op.openSide !== 'on')) {
      // closed contours and open-side chains get a finish pass at the tool radius; a cut on the line has none. It
      // keeps the roughing tabs: each goes to the finish lap nearest to it, never placed again on the finish laps
      const finishLaps = contourLaps(c.path, side, op.openSide, op.direction, r, tol)?.laps ?? [];
      const onLap: Vec2[][] = finishLaps.map(() => []);
      for (const p of tabPoints.flat()) {
        let best = -1, bestD = Infinity;
        finishLaps.forEach((lap, i) => {
          const d = nearestS(lap, p).distance;
          if (d < bestD) { bestD = d; best = i; }
        });
        if (best >= 0) onLap[best].push(p);
      }
      finishLaps.forEach((lap, i) => {
        if (lap.closed) cutClosed(closedRun(lap, index, i === 0, onLap[i]), [h.bottom], h, false, c.ref, onLap[i]);
        else cutOpen(lap, [h.bottom], h, false, true, onLap[i]);
      });
    }
  });

  if (!w.moves.length || out.diagnostics.some((d) => d.severity === 'error')) return out;
  w.up(clearance);
  out.toolpath = {
    operationId: op.id, operationName: op.name, toolId: tool.id, rpm: op.feeds.rpm, coolant: op.feeds.coolant, clearance, moves: w.moves,
  };
  return out;
}
