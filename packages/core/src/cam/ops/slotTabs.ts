import { pathLength, pointAt } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import type { TabInterval, TabProfile } from './writer';
import { type ContactPolygon, contactDistance, contactIntervals, contactPolygon, contactStep, toolTouches, wrapTriangles } from './zoneContact';

/** Tabs across one slot, and how tool-centre paths and points meet them (spec §4, Slot). */
export interface SlotTabs {
  /** Tab top: below it the tool keeps out of the tabs. */
  readonly top: number;
  /** Distance from a tool-centre point to the nearest tab's material (0 inside one). */
  distance(p: Vec2): number;
  /** Whether a tool centred at `p` at height `z` would cut into a tab (z below the tab top, tool touching a tab). */
  blocks(p: Vec2, z: number): boolean;
  /** Stretches of a tool-centre path where the tool touches a tab, as distances along the path. */
  intervals(path: Path2D): TabInterval[];
  /** Tab profile of a tool-centre path cut at level `z`: null at or above the tab top, or when no tab lies on the path. */
  on(path: Path2D, z: number): TabProfile | null;
}

const EPS = 1e-9;

/**
 * The material of one tab across a slot: the stretch `[center - width/2, center + width/2]` of the centreline, swept
 * `halfWidth` to either side along the centreline's normals.
 */
function tabZone(centreline: Path2D, center: number, width: number, halfWidth: number): ContactPolygon {
  const s0 = center - width / 2, s1 = center + width / 2;
  const n = Math.max(1, Math.ceil((s1 - s0) / 0.25));
  const left: Vec2[] = [], right: Vec2[] = [];
  for (let k = 0; k <= n; k++) {
    const { point, tangent } = pointAt(centreline, s0 + ((s1 - s0) * k) / n);
    left.push({ x: point.x - tangent.y * halfWidth, y: point.y + tangent.x * halfWidth });
    right.push({ x: point.x + tangent.y * halfWidth, y: point.y - tangent.x * halfWidth });
  }
  return contactPolygon([...left, ...right.reverse()]);
}

/**
 * Tabs across a slot at `centres` (distances along its centreline). Each tab is `width` long along the centreline
 * and spans the slot; a tool of `toolRadius` keeps out of it below `top`. Paths are mapped onto the tabs by where
 * the tool actually meets them, so the centreline, every offset ring (on both sides of the slot) and the finish
 * pass rise over the same tabs. Null when there are no tabs.
 */
export function slotTabs(
  centreline: Path2D, centres: readonly number[], tab: { width: number; shape: 'rect' | 'triangle' }, slotWidth: number,
  toolRadius: number, top: number, base: number,
): SlotTabs | null {
  if (!centres.length) return null;
  const zones = centres.map((c) => tabZone(centreline, c, Math.max(0, tab.width), slotWidth / 2));
  const r = toolRadius;
  const distance = (p: Vec2): number => contactDistance(zones, p);
  const touches = (p: Vec2) => toolTouches(zones, p, r);
  const cache = new WeakMap<Path2D, TabInterval[]>();

  const intervals = (path: Path2D): TabInterval[] => {
    const hit = cache.get(path);
    if (hit) return hit;
    const total = pathLength(path);
    const out: TabInterval[] = [];
    if (total > EPS) {
      for (const iv of contactIntervals(path, touches, contactStep(r))) out.push({ ...iv, shape: tab.shape });
      wrapTriangles(out, path, total);
    }
    cache.set(path, out);
    return out;
  };

  return {
    top,
    distance,
    blocks: (p, z) => z < top - EPS && touches(p),
    intervals,
    on: (path, z) => {
      if (!(z < top - EPS)) return null;
      const iv = intervals(path);
      return iv.length ? { top, base, intervals: iv } : null;
    },
  };
}
