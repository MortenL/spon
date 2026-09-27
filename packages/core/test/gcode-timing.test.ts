import { describe, expect, it } from 'vitest';
import { interpretProgram } from '../src/gcode/interpreter';
import {
  computeTiming, positionAt, rowAtTime, rowKinematics, rowStartTime, trapezoidDistance, trapezoidDuration,
} from '../src/gcode/timing';
import { machinePreset } from '../src/job/machine';

const GRBL = machinePreset('Hobby GRBL router'); // rapid 5000/5000/1500 mm/min, accel 500/500/200 mm/s², maxFeed 5000
const table = (body: string) => interpretProgram(`G21 G90 G17\nS1000 M3\nG0 X0 Y0 Z0\n${body}`, { jobWorkOffset: 'G54' }).table;

describe('trapezoid', () => {
  it('cruises when the move is long enough, otherwise it is triangular', () => {
    expect(trapezoidDuration(100, 10, 100)).toBeCloseTo(10.1, 12);
    expect(trapezoidDuration(0.01, 10, 100)).toBeCloseTo(0.02, 12);
    expect(trapezoidDuration(0, 10, 100)).toBe(0);
  });

  it('covers the right distance over time, symmetric about the middle', () => {
    for (const [L, v, a] of [[100, 10, 100], [0.01, 10, 100]]) {
      const T = trapezoidDuration(L, v, a);
      expect(trapezoidDistance(L, v, a, 0)).toBe(0);
      expect(trapezoidDistance(L, v, a, T)).toBe(L);
      expect(trapezoidDistance(L, v, a, T / 2)).toBeCloseTo(L / 2, 9);
      expect(trapezoidDistance(L, v, a, T * 0.25) + trapezoidDistance(L, v, a, T * 0.75)).toBeCloseTo(L, 9);
    }
  });
});

describe('rowKinematics', () => {
  it('limits a rapid along X by the X rapid rate and acceleration', () => {
    const k = rowKinematics(table('G0 X100\n'), 1, GRBL);
    expect(k.length).toBe(100);
    expect(k.v).toBeCloseTo(5000 / 60, 9);
    expect(k.a).toBe(500);
    expect(k.duration).toBeCloseTo(100 / (5000 / 60) + 5000 / 60 / 500, 9);
  });

  it('uses the slowest axis on a diagonal', () => {
    const k = rowKinematics(table('G0 X100 Z100\n'), 1, GRBL);
    expect(k.v).toBeCloseTo((1500 / 60) * Math.SQRT2, 9);
    expect(k.a).toBeCloseTo(200 * Math.SQRT2, 9);
    expect(k.duration).toBeCloseTo(4.125, 9);
  });

  it('clamps feed to maxFeed and uses maxFeed when F is missing', () => {
    expect(rowKinematics(table('G1 X100 F10000\n'), 1, GRBL).v).toBeCloseTo(5000 / 60, 9);
    expect(rowKinematics(table('G1 X100 F600\n'), 1, GRBL).duration).toBeCloseTo(10.02, 9);
    expect(rowKinematics(table('G1 X100\n'), 1, GRBL).v).toBeCloseTo(5000 / 60, 9);
  });

  it('measures arcs along the curve', () => {
    const k = rowKinematics(table('G1 X10 F600\nG3 X-10 Y0 I-10 J0\n'), 2, GRBL);
    expect(k.length).toBeCloseTo(10 * Math.PI, 9);
  });

  it('times dwells and tool changes', () => {
    const t = table('G4 P1.5\nT2 M6\n');
    expect(rowKinematics(t, 1, GRBL).duration).toBe(1.5);
    expect(rowKinematics(t, 2, GRBL).duration).toBe(30);
  });
});

describe('computeTiming and playback helpers', () => {
  it('accumulates time and finds rows by time', () => {
    const t = table('G4 P2\nG1 X100 F600\n');
    computeTiming(t, GRBL);
    expect(t.t[0]).toBe(0);
    expect(t.t[1]).toBe(2);
    expect(t.t[2]).toBeCloseTo(12.02, 9);
    expect(rowStartTime(t, 2)).toBe(2);
    expect(rowAtTime(t, 0)).toBe(0);
    expect(rowAtTime(t, 1)).toBe(1);
    expect(rowAtTime(t, 5)).toBe(2);
    expect(rowAtTime(t, 999)).toBe(2);
  });

  it('interpolates the tool position with the same trapezoid', () => {
    const t = table('G1 X100 F600\nG3 X-100 Y0 I-100 J0\n');
    computeTiming(t, GRBL);
    const out = [0, 0, 0];
    const lineDuration = t.t[1] - t.t[0];
    positionAt(t, GRBL, 1, lineDuration / 2, out);
    expect(out[0]).toBeCloseTo(50, 9);
    const arcDuration = t.t[2] - t.t[1];
    positionAt(t, GRBL, 2, arcDuration / 2, out);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(100, 6);
    positionAt(t, GRBL, 2, arcDuration * 2, out);
    expect(out[0]).toBeCloseTo(-100, 6);
  });
});
