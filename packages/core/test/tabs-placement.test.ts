import { describe, expect, it } from 'vitest';
import { type Path2D, pathFromPoints, pathLength, pointAt, tabIntervals, type TabSettings, type Vec2 } from '../src';
import { rectPath } from './fixtures/camSetup';

const R = 3; // tool radius
const tabs = (patch: Partial<TabSettings> = {}): TabSettings =>
  ({ enabled: true, shape: 'rect', width: 4, height: 2, placement: 'count', count: 4, spacing: 50, manual: [], ...patch });
const centres = (path: Path2D, t: TabSettings) => tabIntervals(path, t, R, null).intervals.map((iv) => iv.center);
const pointOf = (path: Path2D, s: number) => pointAt(path, s).point;
const deg = (a: number) => (a * 180) / Math.PI;
/** Angles (degrees, 0..360) of the points about `c`, sorted. */
const anglesAbout = (c: Vec2, pts: Vec2[]) => pts.map((p) => (deg(Math.atan2(p.y - c.y, p.x - c.x)) + 360) % 360).sort((a, b) => a - b);
/** Gaps between consecutive sorted angles, including the wrap-around. */
const angleGaps = (a: number[]) => a.map((x, i) => (i + 1 < a.length ? a[i + 1] - x : a[0] + 360 - x));
const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** 100 × 60 rounded rectangle with 10 mm corner arcs, counter-clockwise. */
function roundedRect(): Path2D {
  const h = Math.PI / 2;
  return {
    closed: true,
    segments: [
      { kind: 'line', from: { x: 10, y: 0 }, to: { x: 90, y: 0 } },
      { kind: 'arc', center: { x: 90, y: 10 }, radius: 10, startAngle: -h, sweep: h },
      { kind: 'line', from: { x: 100, y: 10 }, to: { x: 100, y: 50 } },
      { kind: 'arc', center: { x: 90, y: 50 }, radius: 10, startAngle: 0, sweep: h },
      { kind: 'line', from: { x: 90, y: 60 }, to: { x: 10, y: 60 } },
      { kind: 'arc', center: { x: 10, y: 50 }, radius: 10, startAngle: h, sweep: h },
      { kind: 'line', from: { x: 0, y: 50 }, to: { x: 0, y: 10 } },
      { kind: 'arc', center: { x: 10, y: 10 }, radius: 10, startAngle: 2 * h, sweep: h },
    ],
  };
}

const lShape = () => pathFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }], true);
const circle: Path2D = { closed: true, segments: [{ kind: 'arc', center: { x: 50, y: 50 }, radius: 25, startAngle: 0, sweep: 2 * Math.PI }] };
const polygon64 = pathFromPoints(
  Array.from({ length: 64 }, (_, i) => ({ x: 50 + 25 * Math.cos((i * 2 * Math.PI) / 64), y: 50 + 25 * Math.sin((i * 2 * Math.PI) / 64) })), true);

describe('automatic tab placement', () => {
  it('puts one tab on each side of a rectangle', () => {
    const path = rectPath(0, 0, 100, 60);
    const { intervals, skipped } = tabIntervals(path, tabs(), R, null);
    expect(skipped).toBe(0);
    expect(intervals).toHaveLength(4);
    const pts = intervals.map((iv) => pointOf(path, iv.center));
    const side = (p: Vec2) => (p.y < 1e-6 ? 'bottom' : p.x > 100 - 1e-6 ? 'right' : p.y > 60 - 1e-6 ? 'top' : 'left');
    expect(new Set(pts.map(side)).size).toBe(4);
    const corners = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
    for (const p of pts) for (const k of corners) expect(near(p, k)).toBeGreaterThanOrEqual(4);
  });

  it('keeps tabs on the straight edges of a rounded rectangle', () => {
    const path = roundedRect();
    for (const count of [4, 6, 8]) {
      const { intervals, skipped } = tabIntervals(path, tabs({ count }), R, null);
      expect(skipped).toBe(0);
      expect(intervals).toHaveLength(count);
      for (const iv of intervals) expect(path.segments[pointAt(path, iv.center).segment].kind).toBe('line');
    }
  });

  it('balances tabs around an L-shape', () => {
    const path = lShape();
    const { intervals, skipped } = tabIntervals(path, tabs({ count: 3 }), R, null);
    expect(skipped).toBe(0);
    expect(intervals).toHaveLength(3);
    const pts = intervals.map((iv) => pointOf(path, iv.center));
    // area centroid of the L: (50,20)·4000 and (20,70)·2400
    const c = { x: (50 * 4000 + 20 * 2400) / 6400, y: (20 * 4000 + 70 * 2400) / 6400 };
    for (const g of angleGaps(anglesAbout(c, pts))) expect(Math.abs(g - 120)).toBeLessThanOrEqual(30);
    for (const p of pts) expect(near(p, { x: 40, y: 40 })).toBeGreaterThan(4);
  });

  it('falls back to the curve on a circle', () => {
    const { intervals, skipped } = tabIntervals(circle, tabs(), R, null);
    expect(skipped).toBe(0);
    expect(intervals).toHaveLength(4);
    const gaps = angleGaps(anglesAbout({ x: 50, y: 50 }, intervals.map((iv) => pointOf(circle, iv.center))));
    for (const g of gaps) expect(Math.abs(g - 90)).toBeLessThanOrEqual(5);
  });

  it('treats short facets as a curve', () => {
    const { intervals, skipped } = tabIntervals(polygon64, tabs(), R, null);
    expect(skipped).toBe(0);
    expect(intervals).toHaveLength(4);
    const gaps = angleGaps(anglesAbout({ x: 50, y: 50 }, intervals.map((iv) => pointOf(polygon64, iv.center))));
    for (const g of gaps) expect(Math.abs(g - 90)).toBeLessThanOrEqual(5);
    // the same tabs as the true circle (within a facet), not pulled onto particular facets
    const onCircle = anglesAbout({ x: 50, y: 50 }, centres(circle, tabs()).map((s) => pointOf(circle, s)));
    const onPolygon = anglesAbout({ x: 50, y: 50 }, intervals.map((iv) => pointOf(polygon64, iv.center)));
    onPolygon.forEach((a, i) => expect(Math.abs(a - onCircle[i])).toBeLessThan(360 / 64));
  });

  it('keeps the minimum gap', () => {
    const path = rectPath(0, 0, 100, 100);
    const t = tabs({ count: 40, width: 6 });
    const { intervals, skipped } = tabIntervals(path, t, R, null);
    const total = pathLength(path);
    const cs = intervals.map((iv) => iv.center);
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const d = Math.abs(cs[i] - cs[j]);
        expect(Math.min(d, total - d)).toBeGreaterThanOrEqual(2 * t.width - 1e-9);
      }
    }
    expect(skipped).toBeGreaterThan(0);
    expect(intervals.length + skipped).toBe(40);
  });

  it('is deterministic', () => {
    for (const path of [roundedRect(), lShape(), circle, polygon64]) {
      expect(tabIntervals(path, tabs({ count: 5 }), R, null)).toEqual(tabIntervals(path, tabs({ count: 5 }), R, null));
    }
  });

  it('spaces tabs on an open line away from its ends', () => {
    const line = pathFromPoints([{ x: 0, y: 0 }, { x: 60, y: 0 }], false);
    const half = 2 + R;
    const cs = centres(line, tabs());
    expect(cs).toHaveLength(4);
    // at least one tab width between each tab and the line's ends
    for (const c of cs) expect(c).toBeGreaterThanOrEqual(half + 4 - 1e-9);
    for (const c of cs) expect(c).toBeLessThanOrEqual(60 - half - 4 + 1e-9);
    // a single tab is moved off a sharp bend onto a straight stretch
    const bent = pathFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], false);
    const [c] = centres(bent, tabs({ count: 1 }));
    expect(Math.abs(c - 100)).toBeGreaterThanOrEqual(half + 4 - 1e-9);
    expect(Math.abs(c - 100)).toBeLessThanOrEqual(100);
  });
});
