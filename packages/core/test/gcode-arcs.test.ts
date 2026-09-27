import { describe, expect, it } from 'vitest';
import { arcBoundsInto, arcGeometry, arcLength, arcPointInto, centreFromRadius } from '../src/gcode/arcs';
import { DiagnosticSink } from '../src/gcode/diagnostics';
import { rowStart, TableBuilder } from '../src/gcode/motion';
import { MoveKind } from '../src/gcode/types';

const pt = (g: ReturnType<typeof arcGeometry>, s: number[], f: number) => {
  const out = [0, 0, 0];
  arcPointInto(g, s, f, out);
  return out.map((v) => Math.round(v * 1e9) / 1e9);
};

describe('arcGeometry', () => {
  it('computes CCW and CW sweeps in G17', () => {
    const ccw = arcGeometry([10, 0, 0], [0, 10, 0], [0, 0, 0], 17, false);
    expect(ccw.r).toBeCloseTo(10, 12);
    expect(ccw.sweep).toBeCloseTo(Math.PI / 2, 12);
    expect(pt(ccw, [10, 0, 0], 0.5)).toEqual([7.071067812, 7.071067812, 0]);
    const cw = arcGeometry([10, 0, 0], [0, 10, 0], [0, 0, 0], 17, true);
    expect(cw.sweep).toBeCloseTo(-1.5 * Math.PI, 12);
  });

  it('treats a closed arc as a full circle and supports helices', () => {
    const full = arcGeometry([10, 0, 0], [10, 0, -3], [0, 0, 0], 17, false);
    expect(full.sweep).toBeCloseTo(2 * Math.PI, 12);
    expect(full.dn).toBe(-3);
    expect(arcLength(full)).toBeCloseTo(Math.hypot(20 * Math.PI, 3), 9);
    expect(pt(full, [10, 0, 0], 0.5)).toEqual([-10, 0, -1.5]);
  });

  it('uses (Z, X) in G18 and (Y, Z) in G19 with CCW seen from the positive normal', () => {
    // G18: from +Z to +X counter-clockwise about +Y
    const g18 = arcGeometry([0, 0, 10], [10, 0, 0], [0, 0, 0], 18, false);
    expect(g18.sweep).toBeCloseTo(Math.PI / 2, 12);
    expect(pt(g18, [0, 0, 10], 0.5)).toEqual([7.071067812, 0, 7.071067812]);
    // G19: from +Y to +Z counter-clockwise about +X
    const g19 = arcGeometry([0, 10, 0], [0, 0, 10], [0, 0, 0], 19, false);
    expect(g19.sweep).toBeCloseTo(Math.PI / 2, 12);
  });

  it('reports the end radius for mismatch checks', () => {
    expect(arcGeometry([10, 0, 0], [0, 10.5, 0], [0, 0, 0], 17, false).endRadius).toBeCloseTo(10.5, 12);
  });

  it('bounds an arc exactly, including crossed quadrant points', () => {
    const g = arcGeometry([10, 0, 0], [-10, 0, 0], [0, 0, 0], 17, false); // upper half circle
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    arcBoundsInto(g, [10, 0, 0], [-10, 0, 0], min, max);
    expect(min).toEqual([-10, 0, 0]);
    expect(max.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([10, 10, 0]);
  });
});

describe('centreFromRadius', () => {
  it('picks the shorter arc for +R and the longer for -R', () => {
    const ccwShort = centreFromRadius([0, 0, 0], [10, 0, 0], 17, 10, false)!;
    expect(ccwShort[0]).toBeCloseTo(5, 12);
    expect(ccwShort[1]).toBeCloseTo(Math.sqrt(75), 12); // left of the chord
    const g = arcGeometry([0, 0, 0], [10, 0, 0], ccwShort, 17, false);
    expect(Math.abs(g.sweep)).toBeLessThan(Math.PI);
    const ccwLong = centreFromRadius([0, 0, 0], [10, 0, 0], 17, -10, false)!;
    expect(ccwLong[1]).toBeCloseTo(-Math.sqrt(75), 12);
    expect(Math.abs(arcGeometry([0, 0, 0], [10, 0, 0], ccwLong, 17, false).sweep)).toBeGreaterThan(Math.PI);
    const cwShort = centreFromRadius([0, 0, 0], [10, 0, 0], 17, 10, true)!;
    expect(cwShort[1]).toBeCloseTo(-Math.sqrt(75), 12);
  });

  it('handles a half circle and rejects impossible radii', () => {
    const half = centreFromRadius([0, 0, 0], [10, 0, 0], 17, 5, false)!;
    expect(half[0]).toBeCloseTo(5, 12);
    expect(half[1]).toBeCloseTo(0, 6);
    expect(centreFromRadius([0, 0, 0], [10, 0, 0], 17, 4, false)).toBeNull();
    expect(centreFromRadius([0, 0, 0], [0, 0, 0], 17, 4, false)).toBeNull();
  });
});

describe('TableBuilder', () => {
  it('grows and builds a trimmed table', () => {
    const b = new TableBuilder(1);
    b.push(MoveKind.Rapid, 1, 2, 3, 0, 0, 0, 0, 0, 0, 4, 1, 0);
    b.push(MoveKind.Feed, 5, 6, 7, 0, 0, 0, 0, 300, 0, 5, 1, 2);
    const t = b.build({ x: 0, y: 0, z: 10 });
    expect(t.count).toBe(2);
    expect(Array.from(t.end)).toEqual([1, 2, 3, 5, 6, 7]);
    expect(Array.from(t.feed)).toEqual([0, 300]);
    expect(Array.from(t.line)).toEqual([4, 5]);
    expect(t.flags[1]).toBe(2);
    expect(t.t.length).toBe(2);
    const out = [0, 0, 0];
    rowStart(t, 0, out);
    expect(out).toEqual([0, 0, 10]);
    rowStart(t, 1, out);
    expect(out).toEqual([1, 2, 3]);
  });
});

describe('DiagnosticSink', () => {
  it('caps each code and sorts by line', () => {
    const sink = new DiagnosticSink(2);
    for (const line of [5, 1, 3, 4]) sink.add({ line, severity: 'warning', code: 'arc-radius', message: `arc ${line}` });
    sink.add({ line: 0, severity: 'info', code: 'inch-program', message: 'inch' });
    const list = sink.list();
    expect(list.map((d) => d.line)).toEqual([0, 1, 4, 5]); // the summary sits at the last overflowed line
    expect(list[2].message).toBe('… and 2 more arc-radius diagnostics');
  });
});
