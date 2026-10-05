import { cornerDistances, flattenPath, pathLength, segmentLength, segmentPointAt } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import type { TabSettings } from '../types';
import type { TabInterval } from './writer';

/** Upper bound on automatic tabs per lap (a tiny spacing must not hang the worker). */
const MAX_TABS = 200;
/** A tab is straight when the path turns less than this (degrees) over the whole tab. */
const STRAIGHT_TURN = 5;
/** Corners sharper than this (degrees) keep a tab width of clearance. */
const SHARP_TURN = 30;
/** Start angles tried per `360° / n` when balancing. */
const START_STEPS = 12;
const TAU = 2 * Math.PI;

/** Automatic tab count; an invalid count or spacing (≤ 0, NaN, ±∞) means one tab. */
function autoCount(t: TabSettings, total: number): number {
  const n = t.placement === 'count' ? Math.round(t.count) : t.spacing > 0 && Number.isFinite(t.spacing) ? Math.floor(total / t.spacing) : 1;
  return Number.isFinite(n) ? Math.max(1, n) : 1;
}

/** A possible tab centre: distance along the path, whether the tab is straight, direction from the centroid. */
interface Candidate { s: number; straight: boolean; angle: number }

/**
 * Absolute turning (radians) of the path from its start to `s`: arcs turn by their sweep, joints by the angle between
 * the tangents either side (counted from the joint on). Zero-length segments are ignored.
 */
function turningProfile(path: Path2D): (s: number) => number {
  const starts: number[] = [], before: number[] = [], rate: number[] = [];
  let acc = 0, turn = 0;
  let prevEnd: Vec2 | null = null;
  for (const seg of path.segments) {
    const len = segmentLength(seg);
    if (!(len > 1e-12)) continue;
    const t0 = segmentPointAt(seg, 0).tangent;
    if (prevEnd) turn += Math.acos(Math.max(-1, Math.min(1, prevEnd.x * t0.x + prevEnd.y * t0.y)));
    starts.push(acc);
    before.push(turn);
    rate.push(seg.kind === 'arc' ? Math.abs(seg.sweep) / len : 0);
    if (seg.kind === 'arc') turn += Math.abs(seg.sweep);
    prevEnd = segmentPointAt(seg, len).tangent;
    acc += len;
  }
  return (s) => {
    if (starts.length === 0) return 0;
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return before[lo] + rate[lo] * Math.max(0, s - starts[lo]);
  };
}

/** Area-weighted centroid of a closed path (the mean of its points when it encloses no area). */
function centroid(path: Path2D): Vec2 {
  const pts = flattenPath(path, 0.01);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const cross = pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    a += cross;
    cx += (pts[j].x + pts[i].x) * cross;
    cy += (pts[j].y + pts[i].y) * cross;
  }
  if (Math.abs(a) > 1e-9) return { x: cx / (3 * a), y: cy / (3 * a) };
  const n = Math.max(1, pts.length);
  return { x: pts.reduce((m, p) => m + p.x, 0) / n, y: pts.reduce((m, p) => m + p.y, 0) / n };
}

/** Points along the path at non-decreasing distances, walking the segments once. */
function pointWalker(path: Path2D): (s: number) => Vec2 {
  let i = 0, acc = 0;
  const segs = path.segments;
  return (s) => {
    while (i + 1 < segs.length && acc + segmentLength(segs[i]) < s) acc += segmentLength(segs[i++]);
    return segmentPointAt(segs[i], s - acc).point;
  };
}

/**
 * Tab centres sampled every `width / 4` where the whole tab (`±half`) lies on the path and keeps `width` clear of
 * every corner sharper than 30° (and, on an open path, of its ends). A candidate is straight when the path turns
 * less than 5° over the tab. Sorted by distance along the path.
 */
function tabCandidates(path: Path2D, total: number, half: number, width: number, origin: Vec2): Candidate[] {
  const step = width > 0 ? width / 4 : total / 400;
  const corners = cornerDistances(path, SHARP_TURN);
  if (path.closed && corners[0] === 0) corners.push(total); // the joint at the start is also the joint at the end
  const clear = half + width - 1e-9;
  const lo = path.closed ? half : half + width;
  const hi = path.closed ? total - half : total - half - width;
  const out: Candidate[] = [];
  if (hi < lo) return out;
  const turning = turningProfile(path);
  const pointAtS = pointWalker(path);
  const limit = (STRAIGHT_TURN * Math.PI) / 180;
  let corner = 0; // index of the first corner not before the sample
  const pushAt = (s: number) => {
    while (corner < corners.length && corners[corner] < s) corner++;
    const toCorner = Math.min(corner < corners.length ? corners[corner] - s : Infinity, corner > 0 ? s - corners[corner - 1] : Infinity);
    if (toCorner < clear) return;
    const p = pointAtS(s);
    out.push({ s, straight: turning(s + half) - turning(s - half) < limit, angle: Math.atan2(p.y - origin.y, p.x - origin.x) });
  };
  const k0 = Math.ceil(lo / step - 1e-9), k1 = Math.floor(hi / step + 1e-9);
  if (k0 * step > lo + 1e-9) pushAt(lo); // the ends of the usable stretch are candidates too
  for (let k = k0; k <= k1; k++) pushAt(Math.min(hi, Math.max(lo, k * step)));
  if (k1 * step < hi - 1e-9) pushAt(hi);
  return out;
}

const angleDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % TAU;
  return Math.min(d, TAU - d);
};

/** Index of the first candidate at or after `s` (candidates sorted by distance). */
function firstFrom(cands: Candidate[], s: number): number {
  let a = 0, b = cands.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (cands[m].s < s) a = m + 1;
    else b = m;
  }
  return a;
}

/** Marks the candidates closer than `gap` along the path (around the end, on a closed path) to `s`. */
function block(cands: Candidate[], blocked: Uint8Array, s: number, gap: number, total: number, closed: boolean): void {
  const g = gap - 1e-9;
  if (!(g > 0)) return;
  const mark = (a: number, b: number) => { // open range (a, b)
    for (let k = firstFrom(cands, a); k < cands.length && cands[k].s < b; k++) if (cands[k].s > a) blocked[k] = 1;
  };
  mark(s - g, s + g);
  if (closed) {
    mark(s + total - g, Infinity);
    mark(-Infinity, s - total + g);
  }
}

/**
 * Unblocked candidate of `byAngle` (indices sorted by direction) closest in direction to `target`; on a tie the one
 * earliest along the path. -1 when every one is blocked.
 */
function nearestByAngle(cands: Candidate[], byAngle: number[], blocked: Uint8Array, target: number): { k: number; err: number } {
  const m = byAngle.length;
  let best = -1, bestErr = Infinity;
  if (m === 0) return { k: best, err: bestErr };
  const t = Math.atan2(Math.sin(target), Math.cos(target));
  let a = 0, b = m;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (cands[byAngle[mid]].angle < t) a = mid + 1;
    else b = mid;
  }
  const consider = (k: number) => {
    const e = angleDiff(cands[k].angle, t);
    if (blocked[k]) return e;
    if (e < bestErr - 1e-15 || (Math.abs(e - bestErr) <= 1e-15 && cands[k].s < cands[best].s)) { best = k; bestErr = e; }
    return e;
  };
  // walk outward both ways; directions only get worse until the walks meet
  let up = true, down = true;
  for (let step = 0; step < m && (up || down); step++) {
    if (up && consider(byAngle[(a + step) % m]) > bestErr + 1e-15) up = false;
    if (down && consider(byAngle[(((a - 1 - step) % m) + m) % m]) > bestErr + 1e-15) down = false;
  }
  return { k: best, err: bestErr };
}

/**
 * Closed paths: for 12 start angles `θ₀` over `360°/n`, target directions `θ₀ + 360°·i/n` about the centroid; each
 * target takes the candidate closest in direction, straight before curved, not yet blocked by a placed tab. Keeps the
 * set that places the most tabs, then has the fewest curved ones, then the smallest total angular error; ties keep
 * the earlier start angle.
 */
function balancedPick(cands: Candidate[], n: number, gap: number, total: number): number[] {
  const sortByAngle = (ks: number[]) => ks.sort((p, q) => cands[p].angle - cands[q].angle || cands[p].s - cands[q].s);
  const all = cands.map((_, k) => k);
  const straight = sortByAngle(all.filter((k) => cands[k].straight));
  const curvedList = sortByAngle(all.filter((k) => !cands[k].straight));
  let best: { picked: number[]; curved: number; error: number } | null = null;
  const blocked = new Uint8Array(cands.length);
  for (let j = 0; j < START_STEPS; j++) {
    blocked.fill(0);
    const theta0 = (TAU / n) * (j / START_STEPS);
    const picked: number[] = [];
    let curved = 0, error = 0;
    for (let i = 0; i < n; i++) {
      const target = theta0 + (TAU * i) / n;
      let pick = nearestByAngle(cands, straight, blocked, target);
      if (pick.k < 0) {
        pick = nearestByAngle(cands, curvedList, blocked, target);
        if (pick.k < 0) break;
        curved++;
      }
      picked.push(cands[pick.k].s);
      error += pick.err;
      blocked[pick.k] = 1; // even with no gap (a zero width), a candidate holds one tab
      block(cands, blocked, cands[pick.k].s, gap, total, true);
    }
    if (!best || picked.length > best.picked.length || (picked.length === best.picked.length
      && (curved < best.curved || (curved === best.curved && error < best.error - 1e-12)))) best = { picked, curved, error };
  }
  return best ? best.picked : [];
}

/**
 * Open paths: tab `i` aims at `(i + 0.5) / n` of the length and takes the nearest candidate within half the spacing,
 * straight before curved, not yet blocked by a placed tab.
 */
function openPick(cands: Candidate[], n: number, gap: number, total: number): number[] {
  const reach = total / n / 2 + 1e-9;
  const blocked = new Uint8Array(cands.length);
  const picked: number[] = [];
  for (let i = 0; i < n; i++) {
    const base = ((i + 0.5) * total) / n;
    let pick = -1;
    for (let k = firstFrom(cands, base - reach); k < cands.length && cands[k].s <= base + reach; k++) {
      if (blocked[k]) continue;
      const d = Math.abs(cands[k].s - base);
      const p = pick < 0 ? null : cands[pick];
      if (!p || (cands[k].straight && !p.straight) || (cands[k].straight === p.straight && d < Math.abs(p.s - base) - 1e-12)) pick = k;
    }
    if (pick < 0) continue;
    picked.push(cands[pick].s);
    blocked[pick] = 1;
    block(cands, blocked, cands[pick].s, gap, total, false);
  }
  return picked;
}

/**
 * Tab intervals along a tool-centre path. Each covers the tab width plus the tool diameter. Automatic tabs (spec §5)
 * keep a tab width between their edges and any corner sharper than 30° (and an open path's ends), prefer stretches
 * where the path turns less than 5°, and stay `2 × width` apart along the path. On a closed path they are balanced
 * in direction around its area centroid; on an open path they sit near `(i + 0.5) / n` of the length. Tabs that
 * cannot be placed are counted as skipped. Explicit positions (fractions of the path) are placed as given, clamped
 * inside the path. The same path and settings always give the same tabs.
 */
export function tabIntervals(
  path: Path2D, t: TabSettings, toolRadius: number, explicitT: number[] | null,
): { intervals: (TabInterval & { center: number })[]; skipped: number } {
  const total = pathLength(path);
  const half = t.width / 2 + toolRadius;
  const n = explicitT ? explicitT.length : Math.min(MAX_TABS, autoCount(t, total));
  if (!(total > 0) || 2 * half >= total) return { intervals: [], skipped: n };
  const make = (center: number) => ({ s0: center - half, s1: center + half, center, shape: t.shape });
  if (explicitT) {
    // a position that is not a number cannot be placed; the others are clamped inside the lap (it is longer than a tab here)
    const valid = explicitT.filter((f) => Number.isFinite(f));
    return { intervals: valid.map((f) => make(Math.min(total - half, Math.max(half, f * total)))), skipped: explicitT.length - valid.length };
  }
  const width = Math.max(0, t.width);
  const cands = tabCandidates(path, total, half, width, path.closed ? centroid(path) : { x: 0, y: 0 });
  const picked = path.closed ? balancedPick(cands, n, 2 * width, total) : openPick(cands, n, 2 * width, total);
  return { intervals: picked.sort((a, b) => a - b).map(make), skipped: n - picked.length };
}

/**
 * Tab intervals for one contour's lap: the manual entry for `refIndex` if there is one (its first, if duplicated;
 * exact positions, clamped inside the lap, none for an empty list), else automatic placement. A tab that does not
 * fit on a lap shorter than itself is skipped and counted.
 */
export function contourTabs(
  path: Path2D, t: TabSettings, toolRadius: number, refIndex: number,
): { intervals: (TabInterval & { center: number })[]; skipped: number; manual: boolean } {
  const entry = t.manual.find((m) => m.refIndex === refIndex);
  return { ...tabIntervals(path, t, toolRadius, entry ? entry.t : null), manual: !!entry };
}
