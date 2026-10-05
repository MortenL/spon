import { pathLength, pointAt } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import type { TabInterval, TabProfile } from './writer';

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
/** Bisection steps that place an interval end on a path (well under 1 µm on any sampled stretch). */
const BISECT = 30;

function inPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

interface Zone { poly: Vec2[]; minX: number; minY: number; maxX: number; maxY: number }

/**
 * The material of one tab across a slot: the stretch `[center - width/2, center + width/2]` of the centreline, swept
 * `halfWidth` to either side along the centreline's normals.
 */
function tabZone(centreline: Path2D, center: number, width: number, halfWidth: number): Zone {
  const s0 = center - width / 2, s1 = center + width / 2;
  const n = Math.max(1, Math.ceil((s1 - s0) / 0.25));
  const left: Vec2[] = [], right: Vec2[] = [];
  for (let k = 0; k <= n; k++) {
    const { point, tangent } = pointAt(centreline, s0 + ((s1 - s0) * k) / n);
    left.push({ x: point.x - tangent.y * halfWidth, y: point.y + tangent.x * halfWidth });
    right.push({ x: point.x + tangent.y * halfWidth, y: point.y - tangent.x * halfWidth });
  }
  const poly = [...left, ...right.reverse()];
  const xs = poly.map((q) => q.x), ys = poly.map((q) => q.y);
  return { poly, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
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
  const distance = (p: Vec2): number => {
    let best = Infinity;
    for (const z of zones) {
      const box = Math.max(z.minX - p.x, p.x - z.maxX, z.minY - p.y, p.y - z.maxY, 0);
      if (box >= best) continue;
      if (inPolygon(p, z.poly)) return 0;
      for (let i = 0, j = z.poly.length - 1; i < z.poly.length; j = i++) best = Math.min(best, segmentDistance(p, z.poly[j], z.poly[i]));
    }
    return best;
  };
  const touches = (p: Vec2) => distance(p) < r - 1e-7;
  const cache = new WeakMap<Path2D, TabInterval[]>();

  const intervals = (path: Path2D): TabInterval[] => {
    const hit = cache.get(path);
    if (hit) return hit;
    const total = pathLength(path);
    const out: TabInterval[] = [];
    if (total > EPS) {
      const step = Math.min(0.1, Math.max(0.01, r / 4));
      const n = Math.max(1, Math.ceil(total / step));
      const at = (s: number) => touches(pointAt(path, s).point);
      const edge = (a: number, b: number, inA: boolean) => { // the change between a and b, to within 1e-9 of the stretch
        for (let k = 0; k < BISECT; k++) {
          const m = (a + b) / 2;
          if (at(m) === inA) a = m;
          else b = m;
        }
        return inA ? a : b; // keep the interval on the side that touches
      };
      let prevIn = at(0), prevS = 0, start = prevIn ? 0 : -1;
      for (let k = 1; k <= n; k++) {
        const s = (total * k) / n;
        const cur = at(s);
        if (cur !== prevIn) {
          const e = edge(prevS, s, prevIn);
          if (cur) start = e;
          else { out.push({ s0: start, s1: e, shape: tab.shape }); start = -1; }
        }
        prevIn = cur;
        prevS = s;
      }
      if (start >= 0) out.push({ s0: start, s1: total, shape: tab.shape });
      // a closed path that starts inside a tab: the first and last stretches are one tab; as two pieces each is cut as a rectangle (never lower than the triangle)
      if (path.closed && out.length > 1 && out[0].s0 <= EPS && out[out.length - 1].s1 >= total - EPS && tab.shape === 'triangle') {
        out[0] = { ...out[0], shape: 'rect' };
        out[out.length - 1] = { ...out[out.length - 1], shape: 'rect' };
      }
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
