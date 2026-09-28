import { describe, expect, it } from 'vitest';
import {
  type ArcSegment, nearestS, offsetPolys, pathArea, pathFromPoints, pathLength, pointAt, pointInPolys, type Poly, polysArea,
  polysToRegions, reversePath, rotateStart, segmentInside, subPath, sweepPolylines, unionPolys, v2,
} from '../src';

const rect = (x0: number, y0: number, x1: number, y1: number): Poly => [v2(x0, y0), v2(x1, y0), v2(x1, y1), v2(x0, y1)];
const cw = (p: Poly): Poly => [...p].reverse();

describe('clipper wrapper', () => {
  it('offsets a rectangle inward and outward with round corners', () => {
    const inner = offsetPolys([rect(0, 0, 20, 10)], -3, 0.002);
    expect(inner).toHaveLength(1);
    expect(polysArea(inner)).toBeCloseTo(56, 6);
    const outer = offsetPolys([rect(0, 0, 20, 10)], 3, 0.002);
    expect(polysArea(outer)).toBeCloseTo(26 * 16 - 36 + 9 * Math.PI, 1);
    expect(offsetPolys([rect(0, 0, 20, 10)], -6, 0.002)).toEqual([]);
  });

  it('keeps islands as holes and splits narrow necks into separate regions', () => {
    const region = offsetPolys([rect(0, 0, 20, 10), cw(rect(8, 3, 12, 7))], -1, 0.002);
    const regions = polysToRegions(region);
    expect(regions).toHaveLength(1);
    expect(regions[0].holes).toHaveLength(1);
    const dumbbell = unionPolys([rect(0, 0, 20, 20), rect(19, 9, 41, 11), rect(40, 0, 60, 20)]);
    expect(polysToRegions(offsetPolys(dumbbell, -2, 0.002))).toHaveLength(2);
  });

  it('sweeps a disc along open and closed polylines', () => {
    const open = sweepPolylines([{ points: [v2(0, 0), v2(10, 0)], closed: false }], 1, 0.002);
    expect(polysArea(open)).toBeCloseTo(20 + Math.PI, 1);
    const ring = sweepPolylines([{ points: rect(0, 0, 10, 10), closed: true }], 1, 0.002);
    expect(polysArea(ring)).toBeCloseTo(12 * 12 - 4 + Math.PI - 8 * 8, 1);
  });

  it('tests points and segments against polygon sets (even-odd)', () => {
    const polys = [rect(0, 0, 10, 10), cw(rect(4, 4, 6, 6))];
    expect(pointInPolys(v2(1, 1), polys)).toBe(true);
    expect(pointInPolys(v2(5, 5), polys)).toBe(false);
    expect(pointInPolys(v2(11, 5), polys)).toBe(false);
    expect(segmentInside(v2(1, 1), v2(9, 1), polys)).toBe(true);
    expect(segmentInside(v2(1, 5), v2(9, 5), polys)).toBe(false);
  });
});

describe('path operations', () => {
  const square = pathFromPoints(rect(0, 0, 10, 10), true);
  const arc: ArcSegment = { kind: 'arc', center: v2(0, 0), radius: 2, startAngle: 0, sweep: Math.PI };

  it('measures, samples and splits paths', () => {
    expect(pathLength(square)).toBe(40);
    expect(pathLength({ segments: [arc], closed: false })).toBeCloseTo(2 * Math.PI, 12);
    const p = pointAt(square, 15);
    expect([p.point.x, p.point.y, p.tangent.x, p.tangent.y, p.segment]).toEqual([10, 5, 0, 1, 1]);
    const half = pointAt({ segments: [arc], closed: false }, Math.PI);
    expect(half.point.x).toBeCloseTo(0, 12);
    expect(half.point.y).toBeCloseTo(2, 12);
    expect(half.tangent.x).toBeCloseTo(-1, 12);
    const piece = subPath(square, 5, 25);
    expect(pathLength({ segments: piece, closed: false })).toBeCloseTo(20, 12);
    expect(piece).toHaveLength(3);
  });

  it('reverses, re-starts and orients closed paths', () => {
    expect(pathArea(square)).toBeCloseTo(100, 9);
    expect(pathArea(reversePath(square))).toBeCloseTo(-100, 9);
    const r = rotateStart(square, 15);
    expect(pathLength(r)).toBeCloseTo(40, 12);
    expect(r.segments[0].kind === 'line' && r.segments[0].from).toEqual({ x: 10, y: 5 });
  });

  it('finds the nearest distance along a path', () => {
    expect(nearestS(square, v2(12, 5))).toEqual({ s: 15, distance: 2 });
    const n = nearestS({ segments: [arc], closed: false }, v2(0, 5));
    expect(n.s).toBeCloseTo(Math.PI, 9);
    expect(n.distance).toBeCloseTo(3, 9);
  });
});
