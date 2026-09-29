import { describe, expect, it } from 'vitest';
import { fitArcs, flattenPath, offsetPolys, type Path2D, v2, type Vec2 } from '../src';

const circlePoints = (cx: number, cy: number, r: number, n: number): Vec2[] =>
  Array.from({ length: n }, (_, i) => v2(cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)));

function maxDeviation(points: Vec2[], path: Path2D): number {
  const flat = flattenPath(path, 1e-4);
  const segDist = (p: Vec2, a: Vec2, b: Vec2) => {
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
  };
  let worst = 0;
  for (const p of points) {
    let best = Infinity;
    for (let i = 0; i < flat.length; i++) best = Math.min(best, segDist(p, flat[i], flat[(i + 1) % flat.length]));
    worst = Math.max(worst, best);
  }
  return worst;
}

describe('fitArcs', () => {
  it('keeps arcs within maxBulge of the chords between sparse input points', () => {
    const pts = Array.from({ length: 6 }, (_, i) => v2(10 * Math.cos((i * Math.PI) / 10), 10 * Math.sin((i * Math.PI) / 10)));
    expect(fitArcs(pts, false, 0.01).segments).toMatchObject([{ kind: 'arc' }]); // unbounded by default
    const fitted = fitArcs(pts, false, 0.01, 0.01);
    const input: Path2D = { closed: false, segments: pts.slice(1).map((to, i) => ({ kind: 'line' as const, from: pts[i], to })) };
    const segDist = (p: Vec2, a: Vec2, b: Vec2) => {
      const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
      return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
    };
    const chords = flattenPath(input, 1e-4);
    for (const p of flattenPath(fitted, 1e-4)) {
      expect(Math.min(...chords.slice(1).map((b, i) => segDist(p, chords[i], b)))).toBeLessThanOrEqual(0.01 + 1e-9);
    }
  });

  it('recovers a full circle from a 64-facet polygon', () => {
    const pts = circlePoints(5, 5, 4, 64);
    const path = fitArcs(pts, true, 0.002);
    expect(path.segments).toHaveLength(1);
    const s = path.segments[0];
    expect(s.kind).toBe('arc');
    if (s.kind === 'arc') {
      expect(s.radius).toBeCloseTo(4, 9);
      expect(Math.abs(s.sweep)).toBeCloseTo(2 * Math.PI, 9);
      expect(s.sweep).toBeGreaterThan(0);
    }
  });

  it('keeps sharp corners as lines', () => {
    const path = fitArcs([v2(0, 0), v2(10, 0), v2(10, 5), v2(0, 5)], true, 0.002);
    expect(path.segments.map((s) => s.kind)).toEqual(['line', 'line', 'line', 'line']);
  });

  it('turns a rounded rectangle into 4 lines and 4 quarter arcs', () => {
    const [poly] = offsetPolys([[v2(0, 0), v2(20, 0), v2(20, 10), v2(0, 10)]], 3, 0.002);
    const path = fitArcs(poly, true, 0.002);
    expect(path.segments.filter((s) => s.kind === 'line')).toHaveLength(4);
    const arcs = path.segments.filter((s) => s.kind === 'arc');
    expect(arcs).toHaveLength(4);
    for (const a of arcs) if (a.kind === 'arc') expect(a.radius).toBeCloseTo(3, 2);
    expect(maxDeviation(poly, path)).toBeLessThanOrEqual(0.0021);
  });

  it('merges colinear points into one line and handles degenerate input', () => {
    expect(fitArcs([v2(0, 0), v2(1, 0), v2(2, 0), v2(3, 0)], false, 0.002).segments).toHaveLength(1);
    expect(fitArcs([v2(1, 1)], false, 0.002).segments).toEqual([]);
    expect(fitArcs([v2(1, 1), v2(1, 1)], false, 0.002).segments).toEqual([]);
  });

  it('keeps arc end points exactly on the input points', () => {
    const pts = circlePoints(0, 0, 10, 40).slice(0, 11); // a quarter-plus arc, open
    const path = fitArcs(pts, false, 0.002);
    expect(path.segments).toHaveLength(1);
    const s = path.segments[0];
    if (s.kind !== 'arc') throw new Error('expected an arc');
    const end = { x: s.center.x + s.radius * Math.cos(s.startAngle + s.sweep), y: s.center.y + s.radius * Math.sin(s.startAngle + s.sweep) };
    expect(end.x).toBeCloseTo(pts[10].x, 9);
    expect(end.y).toBeCloseTo(pts[10].y, 9);
  });
});
