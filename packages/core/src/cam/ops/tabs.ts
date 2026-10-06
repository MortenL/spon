import { cornerDistances, pathLength } from '../../geometry/offset/pathOps';
import type { Path2D } from '../../geometry/path2d';
import type { TabSettings } from '../types';
import type { TabInterval } from './writer';

/** Upper bound on automatic tabs per lap (a tiny spacing must not hang the worker). */
const MAX_TABS = 200;

/** Automatic tab count; an invalid count or spacing (≤ 0, NaN, ±∞) means one tab. */
function autoCount(t: TabSettings, total: number): number {
  const n = t.placement === 'count' ? Math.round(t.count) : t.spacing > 0 && Number.isFinite(t.spacing) ? Math.floor(total / t.spacing) : 1;
  return Number.isFinite(n) ? Math.max(1, n) : 1;
}

/**
 * Tab intervals along a closed tool-centre lap. Each covers the tab width plus the tool diameter.
 * Automatic tabs keep at least one tab width between their edges and any corner sharper than 30°, shifting
 * by up to half their spacing; tabs that cannot be placed are counted as skipped. Explicit positions (fractions of
 * the lap) are placed as given, clamped inside the lap.
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
  const corners = path.closed ? cornerDistances(path, 30) : [];
  const cyc = (a: number, b: number) => { const d = Math.abs(a - b) % total; return Math.min(d, total - d); };
  const fits = (c: number) => c - half >= 0 && c + half <= total && corners.every((k) => cyc(k, c) >= half + t.width - 1e-9);
  const intervals: (TabInterval & { center: number })[] = [];
  let skipped = 0;
  const step = total / (n * 40);
  for (let i = 0; i < n; i++) {
    const base = ((i + 0.5) * total) / n;
    let placed: number | null = null;
    for (let j = 0; j <= 20 && placed === null; j++) {
      for (const c of j === 0 ? [base] : [base + j * step, base - j * step]) if (placed === null && fits(c)) placed = c;
    }
    if (placed === null) skipped++;
    else intervals.push(make(placed));
  }
  return { intervals, skipped };
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
