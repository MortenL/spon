import { describe, expect, it } from 'vitest';
import {
  depthLevels, emitHelix, emitLap, emitRampLaps, leadIn, leadOut, type Move, MoveWriter, pathFromPoints, pathLength, segmentPointAt,
  type TabSettings, tabIntervals, v2, vec3,
} from '../src';

const square = pathFromPoints([v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10)], true); // CCW, length 40
const ends = (moves: Move[]) => moves.map((m) => (m.kind === 'cycle' ? null : [m.kind, +m.to.x.toFixed(3), +m.to.y.toFixed(3), +m.to.z.toFixed(3)]));
const tabs = (o: Partial<TabSettings>): TabSettings => ({ enabled: true, shape: 'rect', width: 4, height: 2, placement: 'count', count: 4, spacing: 50, positions: null, ...o });

describe('depthLevels', () => {
  it('splits the depth into equal steps no deeper than the stepdown', () => {
    expect(depthLevels(0, -6, 2)).toEqual([-2, -4, -6]);
    expect(depthLevels(0, -5, 2).map((z) => +z.toFixed(4))).toEqual([-1.6667, -3.3333, -5]);
    expect(depthLevels(0, -6.0000000001, 2)).toHaveLength(3);
    expect(depthLevels(0, 0, 1)).toEqual([]);
    expect(depthLevels(-1, 0, 1)).toEqual([]);
  });
});

describe('MoveWriter', () => {
  it('skips zero-length moves and travels up, across and down', () => {
    const w = new MoveWriter();
    w.travel(v2(5, 5), 10, 2);
    w.rapid(vec3(5, 5, 2));
    w.line(vec3(5, 5, 0), 100);
    w.travel(v2(0, 0), 10, 2);
    expect(ends(w.moves)).toEqual([
      ['rapid', 5, 5, 10], ['rapid', 5, 5, 2], ['line', 5, 5, 0], ['rapid', 5, 5, 10], ['rapid', 0, 0, 10], ['rapid', 0, 0, 2],
    ]);
  });

  it('writes a very short arc as a line so it never becomes a full circle', () => {
    const w = new MoveWriter();
    w.rapid(vec3(1, 0, 0));
    w.segment({ kind: 'arc', center: v2(0, 0), radius: 1, startAngle: 0, sweep: 1e-5 }, 0, 0, 100);
    expect(w.moves[1].kind).toBe('line');
  });
});

describe('emitLap', () => {
  it('follows a closed path at constant Z', () => {
    const w = new MoveWriter();
    w.rapid(vec3(0, 0, -1));
    emitLap(w, square, -1, -1, 500, null);
    expect(ends(w.moves).slice(1)).toEqual([['line', 10, 0, -1], ['line', 10, 10, -1], ['line', 0, 10, -1], ['line', 0, 0, -1]]);
  });

  it('ramps Z linearly with distance', () => {
    const w = new MoveWriter();
    w.rapid(vec3(0, 0, 0));
    emitLap(w, square, 0, -2, 500, null);
    expect(ends(w.moves).slice(1).map((m) => m![3])).toEqual([-0.5, -1, -1.5, -2]);
  });

  it('lifts over rectangular tabs with vertical moves', () => {
    const w = new MoveWriter();
    w.rapid(vec3(0, 0, -5));
    emitLap(w, square, -5, -5, 500, { top: -3, base: -5, intervals: [{ s0: 5, s1: 8, shape: 'rect' }] });
    expect(ends(w.moves).slice(1, 6)).toEqual([['line', 5, 0, -5], ['line', 5, 0, -3], ['line', 8, 0, -3], ['line', 8, 0, -5], ['line', 10, 0, -5]]);
  });

  it('ramps over triangular tabs', () => {
    const w = new MoveWriter();
    w.rapid(vec3(0, 0, -5));
    emitLap(w, square, -5, -5, 500, { top: -3, base: -5, intervals: [{ s0: 4, s1: 8, shape: 'triangle' }] });
    expect(ends(w.moves).slice(1, 5)).toEqual([['line', 4, 0, -5], ['line', 6, 0, -3], ['line', 8, 0, -5], ['line', 10, 0, -5]]);
  });

  it('clamps a descending ramp to a tab where it passes below the tab top', () => {
    const w = new MoveWriter();
    w.rapid(vec3(0, 0, -2));
    // Z goes −2 → −6 over 40 mm, i.e. −0.1/mm; it reaches the tab top −3 at s = 10, inside the tab [8, 14]
    emitLap(w, square, -2, -6, 500, { top: -3, base: -6, intervals: [{ s0: 8, s1: 14, shape: 'rect' }] });
    const zs = ends(w.moves).slice(1).map((m) => m![3]);
    expect(zs.slice(0, 4)).toEqual([-2.8, -3, -3, -3.4]);
  });
});

describe('ramps and helix', () => {
  it('descends over whole laps without exceeding the ramp angle', () => {
    const w = new MoveWriter();
    w.rapid(vec3(0, 0, 0));
    emitRampLaps(w, square, 0, -3, 3, 500, null); // 40 mm per lap × tan 3° ≈ 2.1 mm → 2 laps
    const z = ends(w.moves).slice(1).map((m) => m![3]);
    expect(z).toHaveLength(8);
    expect(z[3]).toBe(-1.5);
    expect(z[7]).toBe(-3);
  });

  it('spirals down in half circles and finishes with a full circle at depth', () => {
    const w = new MoveWriter();
    w.rapid(vec3(5, 0, 1));
    emitHelix(w, v2(3, 0), 2, 1, -2, 3, 500); // per rev 2π·2·tan3° ≈ 0.659 → 5 revs → 10 halves, then 2 halves
    expect(w.moves.slice(1).every((m) => m.kind === 'arc' && m.ccw && m.center.x === 3)).toBe(true);
    expect(w.moves).toHaveLength(13);
    const last = w.moves[12];
    expect(last.kind !== 'cycle' && [last.to.x, last.to.z]).toEqual([5, -2]);
  });
});

describe('leads', () => {
  it('builds tangent quarter-arc leads on the free side', () => {
    const P = v2(10, 0), T = v2(1, 0);
    const [inArc] = leadIn(P, T, false, 'arc', 2); // free side on the right (−Y)
    const end = segmentPointAt(inArc, Infinity);
    expect(end.point.x).toBeCloseTo(10, 12);
    expect(end.point.y).toBeCloseTo(0, 12);
    expect(end.tangent.x).toBeCloseTo(1, 12);
    expect(inArc.kind === 'arc' && inArc.center).toEqual({ x: 10, y: -2 });
    const [outArc] = leadOut(P, T, false, 'arc', 2);
    const start = segmentPointAt(outArc, 0);
    expect(start.tangent.x).toBeCloseTo(1, 12);
    expect(leadIn(P, T, true, 'line', 3)).toEqual([{ kind: 'line', from: { x: 10, y: 3 }, to: P }]);
    expect(leadIn(P, T, true, 'none', 3)).toEqual([]);
  });
});

describe('tabIntervals', () => {
  const rect = pathFromPoints([v2(0, 0), v2(100, 0), v2(100, 50), v2(0, 50)], true); // corners at 0, 100, 150, 250

  it('spreads tabs evenly and sizes them by width plus the tool diameter', () => {
    const r = tabIntervals(rect, tabs({ count: 4 }), 3, null);
    expect(r.skipped).toBe(0);
    expect(r.intervals.map((i) => [i.s0, i.s1])).toEqual([[32.5, 42.5], [107.5, 117.5], [182.5, 192.5], [257.5, 267.5]]);
  });

  it('shifts tabs away from sharp corners and skips those that cannot fit', () => {
    // 30 mm square, 8 tabs: centres at 7.5, 22.5, … are 7.5 mm from a corner; a tab needs 5 + 4 = 9 mm → shifted to 9, 21, …
    const shifted = tabIntervals(pathFromPoints([v2(0, 0), v2(30, 0), v2(30, 30), v2(0, 30)], true), tabs({ count: 8 }), 3, null);
    expect(shifted.skipped).toBe(0);
    expect(shifted.intervals.slice(0, 2).map((i) => +i.center.toFixed(6))).toEqual([9, 21]);
    // 16 mm square: an edge is shorter than 2 × 9 mm, so no position works
    const r = tabIntervals(pathFromPoints([v2(0, 0), v2(16, 0), v2(16, 16), v2(0, 16)], true), tabs({ count: 4 }), 3, null);
    expect(r.intervals).toEqual([]);
    expect(r.skipped).toBe(4);
    expect(tabIntervals(square, tabs({ width: 40 }), 3, null)).toEqual({ intervals: [], skipped: 4 });
  });

  it('treats an invalid spacing or count as one tab and never places more than 200', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = tabIntervals(rect, tabs({ placement: 'spacing', spacing: bad }), 3, null);
      expect(r.intervals.length + r.skipped, `spacing ${bad}`).toBe(1);
    }
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = tabIntervals(rect, tabs({ placement: 'count', count: bad }), 3, null);
      expect(r.intervals.length + r.skipped, `count ${bad}`).toBeLessThanOrEqual(200);
    }
    const tiny = tabIntervals(rect, tabs({ placement: 'spacing', spacing: 1e-6 }), 3, null);
    expect(tiny.intervals.length + tiny.skipped).toBe(200);
  });

  it('places explicit positions as given (clamped inside the lap)', () => {
    const r = tabIntervals(rect, tabs({}), 3, [0.5]);
    expect(r.intervals.map((i) => i.center)).toEqual([150]);
    expect(pathLength(rect)).toBe(300);
  });
});
