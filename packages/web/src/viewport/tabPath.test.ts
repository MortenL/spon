import { describe, expect, it } from 'vitest';
import { freeTabT, hitsTab, nearestOnTabPath, normaliseTabT, pointAtTabT, TAB_TARGET, tabNear } from './tabPath';

// a 10 × 10 square, drawn without repeating its first point (as flattenPath returns a closed lap)
const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
// an open L: 10 along X, then 10 up
const ell = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];

describe('normaliseTabT', () => {
  it('wraps a closed path: 1 is 0, negatives wrap, values above 1 wrap', () => {
    expect(normaliseTabT(1, true)).toBe(0);
    expect(normaliseTabT(0, true)).toBe(0);
    expect(normaliseTabT(-0.25, true)).toBeCloseTo(0.75, 12);
    expect(normaliseTabT(1.5, true)).toBeCloseTo(0.5, 12);
    expect(normaliseTabT(-1e-18, true)).toBe(0); // never 1
  });

  it('clamps an open path into [0, 1)', () => {
    expect(normaliseTabT(-0.25, false)).toBe(0);
    expect(normaliseTabT(0.4, false)).toBe(0.4);
    const end = normaliseTabT(1, false);
    expect(end).toBeLessThan(1);
    expect(end).toBeGreaterThan(0.999);
    expect(normaliseTabT(1.5, false)).toBe(end);
  });
});

describe('nearestOnTabPath', () => {
  it('measures t along the arc length, including the closing edge of a closed path', () => {
    const a = nearestOnTabPath(square, { x: 5, y: -3 }, true);
    expect(a.point).toEqual({ x: 5, y: 0 });
    expect(a.t).toBeCloseTo(5 / 40, 12);
    expect(a.length).toBeCloseTo(40, 12);
    // on the closing edge (0,10) → (0,0)
    const b = nearestOnTabPath(square, { x: -2, y: 5 }, true);
    expect(b.point).toEqual({ x: 0, y: 5 });
    expect(b.t).toBeCloseTo(35 / 40, 12);
  });

  it('a point at the closing vertex of a closed path gives t = 0, not 1', () => {
    const p = nearestOnTabPath(square, { x: -1, y: -1 }, true);
    expect(p.t).toBe(0);
  });

  it('an open path has no closing edge and clamps at its end', () => {
    const a = nearestOnTabPath(ell, { x: -2, y: 5 }, false);
    expect(a.point).toEqual({ x: 0, y: 0 }); // nearest is the start, not a closing edge
    expect(a.t).toBe(0);
    expect(a.length).toBeCloseTo(20, 12);
    const b = nearestOnTabPath(ell, { x: 12, y: 15 }, false);
    expect(b.point).toEqual({ x: 10, y: 10 });
    expect(b.t).toBeLessThan(1);
    expect(b.t).toBeGreaterThan(0.999);
    expect(nearestOnTabPath(ell, { x: 12, y: 5 }, false).t).toBeCloseTo(0.75, 12);
  });

  it('copes with degenerate paths', () => {
    expect(nearestOnTabPath([], { x: 1, y: 2 }, true)).toEqual({ point: { x: 1, y: 2 }, t: 0, length: 0 });
    expect(nearestOnTabPath([{ x: 3, y: 3 }], { x: 1, y: 2 }, false)).toEqual({ point: { x: 3, y: 3 }, t: 0, length: 0 });
  });
});

describe('tabNear', () => {
  it('finds the nearest tab within the width, measured along the path', () => {
    // 40 mm loop, tabs at 4 and 20 mm
    expect(tabNear([0.1, 0.5], 0.15, 4, 40, true)).toBe(0); // 2 mm from the first
    expect(tabNear([0.1, 0.5], 0.3, 4, 40, true)).toBe(-1); // 8 mm from both
    expect(tabNear([0.1, 0.5], 0.45, 4, 40, true)).toBe(1);
  });

  it('wraps across the seam of a closed path but not of an open one', () => {
    expect(tabNear([0.02], 0.98, 4, 40, true)).toBe(0); // 1.6 mm across the seam
    expect(tabNear([0.02], 0.98, 4, 40, false)).toBe(-1); // 38.4 mm along an open path
  });

  it('picks the closer of two tabs in range', () => {
    expect(tabNear([0.1, 0.2], 0.16, 10, 40, true)).toBe(1);
  });
});

describe('pointAtTabT', () => {
  it('walks the arc length, including a closed path\'s closing edge', () => {
    expect(pointAtTabT(square, 0.125, true)).toEqual({ x: 5, y: 0 });
    expect(pointAtTabT(square, 0.875, true)).toEqual({ x: 0, y: 5 });
    expect(pointAtTabT(ell, 0.75, false)).toEqual({ x: 10, y: 5 });
    expect(pointAtTabT(ell, 1, false)).toEqual({ x: 10, y: 10 });
  });
});

describe('freeTabT', () => {
  it('is the middle of the largest gap between tabs, across the seam of a closed path', () => {
    expect(freeTabT([], true)).toBe(0.5);
    expect(freeTabT([0.1, 0.3], true)).toBeCloseTo(0.7, 12);
    expect(freeTabT([0.4, 0.8], true)).toBeCloseTo(0.1, 12); // the gap 0.8 → 1.4 wraps to 0.1
  });

  it('counts the ends of an open path as edges of its gaps', () => {
    expect(freeTabT([0.2], false)).toBeCloseTo(0.6, 12);
    expect(freeTabT([0.8], false)).toBeCloseTo(0.4, 12);
  });
});

describe('hitsTab', () => {
  it('is true when a tab object is among the intersections', () => {
    const plain = { object: { userData: {} } };
    expect(hitsTab({ intersections: [plain] })).toBe(false);
    expect(hitsTab({ intersections: [plain, { object: { userData: TAB_TARGET } }] })).toBe(true);
  });
});
