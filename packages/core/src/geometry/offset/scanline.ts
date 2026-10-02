import type { Vec2 } from '../path2d';
import type { Poly } from './clipper';

/**
 * Inside intervals of parallel scanlines over polygons (even-odd), the lines at `angleDeg` from +X and `spacing`
 * apart at most, spread evenly so the first and last lines sit on the polygons' extent (nudged just inside). Lines are
 * returned in increasing order across (the rotated y), intervals along each line in increasing order (the rotated x).
 */
export function scanlineIntervals(polys: readonly Poly[], angleDeg: number, spacing: number): { y: number; a: Vec2; b: Vec2 }[][] {
  const t = (angleDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const toLocal = (p: Vec2): Vec2 => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c });
  const toWorld = (p: Vec2): Vec2 => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
  const local = polys.map((p) => p.map(toLocal));
  let lo = Infinity, hi = -Infinity;
  for (const p of local) for (const v of p) { lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); }
  if (!(hi > lo) || !(spacing > 0)) return [];
  const n = Math.max(1, Math.ceil((hi - lo) / spacing - 1e-9));
  const step = (hi - lo) / n;
  const out: { y: number; a: Vec2; b: Vec2 }[][] = [];
  for (let k = 0; k <= n; k++) {
    // nudge the extreme lines inside so they intersect the polygons
    const y = k === 0 ? lo + step * 1e-6 : k === n ? hi - step * 1e-6 : lo + k * step;
    const xs: number[] = [];
    for (const p of local) {
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const a = p[j], b = p[i];
        if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((u, v) => u - v);
    const line: { y: number; a: Vec2; b: Vec2 }[] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-9) line.push({ y, a: toWorld({ x: xs[i], y }), b: toWorld({ x: xs[i + 1], y }) });
    if (line.length) out.push(line);
  }
  return out;
}
