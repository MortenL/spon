import type { Vec2 } from '@sponcam/core';

/** Tab handles and paths carry this in userData, so geometry picking under them leaves their clicks alone. */
export const TAB_TARGET = { tabTarget: true };

/** Whether a tab handle or tab path is among the objects under the pointer (an R3F event's intersections). */
export function hitsTab(e: { intersections: readonly { object: { userData: Record<string, unknown> } }[] }): boolean {
  return e.intersections.some((i) => i.object.userData.tabTarget === true);
}

/** Largest t an open path's tab may take: core wraps 1 to 0, which would move a tab at the end to the start. */
const OPEN_END = 1 - 1e-9;

/** A tab position as a fraction of the path: wrapped into [0, 1) on a closed path, clamped into [0, 1) on an open one. */
export function normaliseTabT(t: number, closed: boolean): number {
  if (!closed) return Math.min(OPEN_END, Math.max(0, t));
  const r = ((t % 1) + 1) % 1;
  return r >= 1 ? 0 : r;
}

/**
 * Nearest point of a flattened tab path (program XY) to `q`, its arc-length fraction `t` (normalised as above) and the
 * path's length. A closed path's points do not repeat the first one; its closing edge is included.
 */
export function nearestOnTabPath(points: readonly Vec2[], q: Vec2, closed: boolean): { point: Vec2; t: number; length: number } {
  if (points.length === 0) return { point: q, t: 0, length: 0 };
  if (points.length === 1) return { point: points[0], t: 0, length: 0 };
  const edges = closed ? points.length : points.length - 1;
  let length = 0;
  let bestDist = Infinity;
  let bestS = 0;
  let bestPoint = points[0];
  for (let i = 0; i < edges; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const len = Math.sqrt(len2);
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2)) : 0;
    const px = a.x + dx * u, py = a.y + dy * u;
    const d = Math.hypot(q.x - px, q.y - py);
    if (d < bestDist) { bestDist = d; bestS = length + u * len; bestPoint = { x: px, y: py }; }
    length += len;
  }
  return { point: bestPoint, t: length > 0 ? normaliseTabT(bestS / length, closed) : 0, length };
}

/**
 * Index of the tab (among `ts`, fractions of a path `length` mm long) nearest to `t` and within `width` mm of it along
 * the path, or -1. On a closed path the distance may run across the seam.
 */
export function tabNear(ts: readonly number[], t: number, width: number, length: number, closed: boolean): number {
  let best = -1;
  let bestD = Infinity;
  ts.forEach((tab, i) => {
    let d = Math.abs(tab - t) * length;
    if (closed) d = Math.min(d, length - d);
    if (d < width && d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/** The point at arc-length fraction `t` of a flattened tab path. */
export function pointAtTabT(points: readonly Vec2[], t: number, closed: boolean): Vec2 {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  const edges = closed ? points.length : points.length - 1;
  const lens: number[] = [];
  let length = 0;
  for (let i = 0; i < edges; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    lens.push(Math.hypot(b.x - a.x, b.y - a.y));
    length += lens[i];
  }
  let s = Math.min(1, Math.max(0, t)) * length;
  for (let i = 0; i < edges; i++) {
    if (s <= lens[i] || i === edges - 1) {
      const a = points[i], b = points[(i + 1) % points.length];
      const u = lens[i] > 0 ? Math.min(1, s / lens[i]) : 0;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
    s -= lens[i];
  }
  return points[0];
}

/** The middle of the largest gap between tabs (fractions of the path); an open path's ends bound its gaps. */
export function freeTabT(ts: readonly number[], closed: boolean): number {
  const sorted = [...ts].sort((a, b) => a - b);
  if (sorted.length === 0) return 0.5;
  const bounds = closed ? [...sorted, sorted[0] + 1] : [0, ...sorted, 1];
  let best = 0.5, bestGap = -1;
  for (let i = 0; i + 1 < bounds.length; i++) {
    const gap = bounds[i + 1] - bounds[i];
    if (gap > bestGap) { bestGap = gap; best = (bounds[i] + bounds[i + 1]) / 2; }
  }
  return normaliseTabT(best, closed);
}
