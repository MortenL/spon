import { describe, expect, it } from 'vitest';
import { analyzeTable, segmentHitsBox } from '../src/gcode/analysis';
import { interpretProgram } from '../src/gcode/interpreter';
import { vec3 } from '../src/geometry/vec3';
import { machinePreset } from '../src/job/machine';

const profile = machinePreset('Hobby GRBL router');
// stock of the Milestone 1 box job, in program coordinates (WCS at the stock's min-X/min-Y/top corner)
const STOCK = { min: vec3(0, 0, -6), max: vec3(30, 20, 0) };
const PRE = 'G21 G90 G17 G54\nS10000 M3\nG0 X5 Y5 Z5\n'; // lines 0–2

function analyse(body: string, stock: typeof STOCK | null = STOCK) {
  const r = interpretProgram(PRE + body, { jobWorkOffset: 'G54' });
  return { r, a: analyzeTable(r.table, r.lineFlags, { profile, stock }) };
}
const codes = (x: ReturnType<typeof analyse>) => x.a.diagnostics.map((d) => `${d.code}@${d.line}`);

describe('segmentHitsBox', () => {
  it('clips segments against a box', () => {
    const min = [0, 0, -Infinity];
    const max = [10, 10, 0];
    expect(segmentHitsBox([5, 5, 5], [5, 5, -1], min, max)).toBe(true);
    expect(segmentHitsBox([-5, 5, -1], [-1, 5, -1], min, max)).toBe(false);
    expect(segmentHitsBox([-5, 5, -1], [15, 5, -1], min, max)).toBe(true);
    expect(segmentHitsBox([5, 5, 5], [5, 5, 1], min, max)).toBe(false);
  });
});

describe('analyzeTable: stock checks', () => {
  it('reports nothing for a clean program', () => {
    expect(analyse('G1 Z-1 F300\nG1 X10\nG0 Z5\nG0 X40 Y40\n').a.diagnostics).toEqual([]);
  });

  it('flags a rapid down into the stock', () => {
    expect(codes(analyse('G0 Z-2\nG0 Z5\n'))).toEqual(['rapid-into-stock@3']);
  });

  it('flags a level rapid below the stock top inside the footprint', () => {
    expect(codes(analyse('G1 Z-1 F300\nG0 X10\n'))).toEqual(['rapid-into-stock@4']);
  });

  it('ignores retracts, rapids outside the footprint and canned-cycle pecks', () => {
    expect(codes(analyse('G1 Z-1 F300\nG0 Z5\n'))).toEqual([]);
    expect(codes(analyse('G0 X-5 Y-5\nG0 Z-3\nG0 Z5\n'))).toEqual([]);
    expect(codes(analyse('G83 X10 Y10 Z-4 R1 Q1 F200\nG80\n'))).toEqual([]);
  });

  it('ignores moves from an unknown position', () => {
    const r = interpretProgram('G21 G90\nG0 X10 Y10\nG0 Z5\n', { jobWorkOffset: 'G54' });
    expect(analyzeTable(r.table, r.lineFlags, { profile, stock: STOCK }).diagnostics).toEqual([]);
  });

  it('flags moves below the stock bottom', () => {
    expect(codes(analyse('G1 Z-7 F300\nG0 Z5\n'))).toEqual(['below-stock-bottom@3']);
  });

  it('ignores G53 (machine-coordinate) moves and the move directly after one, checked in program coordinates', () => {
    // G53 targets are machine coordinates, not program coordinates, so checking them (or the very
    // next move, whose start is really the machine-coordinate end point) against the program's
    // stock box is meaningless and gives false positives.
    expect(codes(analyse('G53 G0 Z-2\n'))).toEqual([]);
    expect(codes(analyse('G53 G0 Z-2\nG0 X10\n'))).toEqual([]);
    // but checks resume normally for the move after that
    expect(codes(analyse('G53 G0 Z-2\nG0 X10\nG1 X15 Z-7 F300\n'))).toEqual(['below-stock-bottom@5']);
  });

  it('falls back to "below Z 0" without stock', () => {
    const x = analyse('G0 Z-1\nG0 Z5\n', null);
    expect(codes(x)).toEqual(['rapid-into-stock@3']);
    expect(x.a.diagnostics[0].message).toMatch(/below Z 0/);
  });
});

describe('analyzeTable: summary', () => {
  it('summarises time, distances, extents, feeds and tools', () => {
    const { r, a } = analyse('T4 M6\nG1 Z-1 F300\nG1 X15 F600\nG0 Z5\n#1=2\n');
    const s = a.summary;
    expect(s.totalSeconds).toBeCloseTo(r.table.t[r.table.count - 1], 9);
    expect(s.cutDistance).toBeCloseTo(16, 9);
    expect(s.plungeDistance).toBeCloseTo(6, 9);
    expect(s.rapidDistance).toBeCloseTo(6, 9); // the first rapid starts from an unknown position and is not counted
    expect(s.extents).toEqual({ min: vec3(5, 5, -1), max: vec3(15, 5, 5) });
    expect(s.feedRange).toEqual([300, 600]);
    expect(s.tools).toEqual([4]);
    expect(s.perTool.map((p) => p.tool)).toEqual([0, 4]);
    expect(s.perTool.reduce((sum, p) => sum + p.seconds, 0)).toBeCloseTo(s.totalSeconds, 9);
    expect(s.lineCount).toBe(9);
    expect(s.notSimulatedLines).toBe(1);
    expect(s.moveCount).toBe(4);
  });

  it('includes arc bulges in the extents', () => {
    const { a } = analyse('G1 Z0 F300\nG3 X-5 Y5 I-5 J0\n');
    expect(a.summary.extents?.max.y).toBeCloseTo(10, 9);
  });
});
