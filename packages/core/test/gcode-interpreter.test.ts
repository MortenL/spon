import { describe, expect, it } from 'vitest';
import { interpretProgram } from '../src/gcode/interpreter';
import { LineFlag, MoveKind, RowFlag } from '../src/gcode/types';

const run = (text: string, maxRows?: number) => interpretProgram(text, { jobWorkOffset: 'G54', maxRows });
const ends = (r: ReturnType<typeof run>) =>
  Array.from({ length: r.table.count }, (_, i) => Array.from(r.table.end.slice(i * 3, i * 3 + 3)).map((v) => Math.round(v * 1000) / 1000));
const kinds = (r: ReturnType<typeof run>) => Array.from(r.table.kind);
const codes = (r: ReturnType<typeof run>) => r.diagnostics.map((d) => `${d.code}@${d.line}`);

const HEADER = 'G21 G90 G17\nS1000 M3\n';

describe('interpretProgram: motion and modal state', () => {
  it('carries modal motion, feed and coordinates across lines', () => {
    const r = run(`${HEADER}G0 X1 Y2 Z3\nX4\nG1 Z0 F200\nY5\n`);
    expect(kinds(r)).toEqual([MoveKind.Rapid, MoveKind.Rapid, MoveKind.Feed, MoveKind.Feed]);
    expect(ends(r)).toEqual([[1, 2, 3], [4, 2, 3], [4, 2, 0], [4, 5, 0]]);
    expect(Array.from(r.table.feed)).toEqual([0, 0, 200, 200]);
    expect(Array.from(r.table.line)).toEqual([2, 3, 4, 5]);
    expect(Array.from(r.firstMoveOfLine)).toEqual([-1, -1, 0, 1, 2, 3, -1]);
  });

  it('converts inches and flags inch programs', () => {
    const r = run('G20 G90\nS1 M3\nG1 X1 Y0.5 Z0 F10\n');
    expect(ends(r)).toEqual([[25.4, 12.7, 0]]);
    expect(r.table.feed[0]).toBeCloseTo(254, 4);
    expect(r.usesInch).toBe(true);
    expect(codes(r)).toContain('inch-program@0');
  });

  it('handles incremental moves', () => {
    const r = run(`${HEADER}G0 X1 Y1 Z1\nG91\nG0 X2\nX2 Z-1\n`);
    expect(ends(r).slice(1)).toEqual([[3, 1, 1], [5, 1, 0]]);
  });

  it('builds arcs from I/J and from R, in every plane', () => {
    const r = run(`${HEADER}G0 X10 Y0 Z0\nG3 X0 Y10 I-10 J0 F100\nG2 X10 Y0 R10\nG18 G2 X15 Z5 I5 K0\nG19 G3 Y5 Z10 J0 K5\n`);
    expect(kinds(r).slice(1)).toEqual([MoveKind.ArcCCW, MoveKind.ArcCW, MoveKind.ArcCW, MoveKind.ArcCCW]);
    expect(Array.from(r.table.arc.slice(3, 6))).toEqual([0, 0, 0]);
    expect(Array.from(r.table.plane.slice(1))).toEqual([17, 17, 18, 19]);
    expect(Array.from(r.table.arc.slice(9, 12))).toEqual([15, 0, 0]); // G18 centre: X+I, Z+K from (10,0,0)
    expect(r.diagnostics.filter((d) => d.code === 'arc-radius')).toEqual([]);
  });

  it('reports arc end-radius mismatches over 0.01 mm', () => {
    const r = run(`${HEADER}G0 X10 Y0 Z0\nG3 X0 Y10.5 I-10 J0 F100\n`);
    expect(codes(r)).toContain('arc-radius@3');
  });

  it('records tool changes, dwells, pauses and spindle state', () => {
    const r = run('G21 G90\nT3 M6\nG4 P1.5\nM0\nG0 X1 Y1 Z1\nG1 X2 F100\n');
    expect(kinds(r)).toEqual([MoveKind.ToolChange, MoveKind.Dwell, MoveKind.Pause, MoveKind.Rapid, MoveKind.Feed]);
    expect(r.table.param[1]).toBe(1.5);
    expect(r.table.tool[4]).toBe(3);
    expect(r.tools).toEqual([3]);
    expect(codes(r)).toContain('feed-spindle-off@5');
  });

  it('treats M1 as a pause, same as M0 (motion table kind 6 = "pause (M0/M1)")', () => {
    const r = run(`${HEADER}G0 X1 Y1 Z1\nM1\n`);
    expect(kinds(r)).toEqual([MoveKind.Rapid, MoveKind.Pause]);
  });

  it('flags feed moves without F', () => {
    expect(codes(run(`${HEADER}G0 X0 Y0 Z0\nG1 X5\n`))).toContain('feed-no-f@3');
  });

  it('marks unknown-start rows and warns about feed moves with unknown axes', () => {
    const r = run(`${HEADER}G0 Z5\nG0 X1 Y1\nG1 X2 F100\n`);
    expect(Array.from(r.table.flags)).toEqual([RowFlag.UnknownStart, RowFlag.UnknownStart, 0]);
    expect(r.diagnostics.filter((d) => d.code === 'unknown-axis')).toEqual([]);
    expect(codes(run(`${HEADER}G1 X5 F100\n`))).toContain('unknown-axis@2');
  });

  it('flags macros, unsupported codes and cutter compensation without stopping', () => {
    const r = run(`${HEADER}#1=5\nG93\nG41 D1\nG0 X1 Y1 Z1\nM98 P100\n`);
    expect(r.lineFlags[2]).toBe(LineFlag.Macro | LineFlag.NotSimulated);
    expect(r.lineFlags[3] & LineFlag.NotSimulated).toBeTruthy();
    expect(codes(r)).toEqual(expect.arrayContaining(['not-simulated@2', 'not-simulated@3', 'not-simulated@4', 'not-simulated@6']));
    expect(r.table.count).toBe(1);
  });

  it('warns about other work offsets and G53', () => {
    const r = run(`${HEADER}G55 G0 X1 Y1 Z1\nG53 G0 Z0\n`);
    expect(codes(r)).toEqual(expect.arrayContaining(['other-work-offset@2', 'other-work-offset@3']));
    expect(r.table.flags[1] & RowFlag.MachineCoords).toBeTruthy();
  });

  it('warns when a tool change is not followed by G43 in a program that uses G43', () => {
    const text = 'G21 G90\nT1 M6\nG43 H1\nS1 M3\nG0 X0 Y0 Z5\nT2 M6\nG0 Z10\nG43 H2\n';
    expect(codes(run(text)).filter((c) => c.startsWith('no-g43'))).toEqual(['no-g43@5']);
    expect(codes(run('G21 G90\nT1 M6\nG0 X0 Y0 Z5\n')).filter((c) => c.startsWith('no-g43'))).toEqual([]);
  });

  it('handles G28 as a home event with unknown position afterwards', () => {
    const r = run(`${HEADER}G0 X1 Y1 Z1\nG28 Z5\nG0 X2\n`);
    expect(kinds(r)).toEqual([MoveKind.Rapid, MoveKind.Rapid, MoveKind.Home, MoveKind.Rapid]);
    expect(r.table.flags[3] & RowFlag.UnknownStart).toBeTruthy();
  });

  it('expands canned cycles and repeats them on following XY lines', () => {
    const r = run(`${HEADER}G0 X0 Y0 Z5\nG81 X10 Y0 Z-2 R1 F100\nX20\nG80\nG0 Z5\n`);
    const cycleRows = Array.from(r.table.line).filter((l) => l === 3 || l === 4).length;
    expect(cycleRows).toBe(8);
    expect(ends(r)[4]).toEqual([10, 0, 5]); // G98 default: back to the initial level
    expect(r.table.flags[4] & RowFlag.CycleInternal).toBeTruthy();
  });

  it('refuses canned cycles in G91 or with L', () => {
    const r = run(`${HEADER}G0 X0 Y0 Z5\nG91 G81 X10 Z-2 R1 F100\n`);
    expect(codes(r)).toContain('not-simulated@3');
    expect(r.table.count).toBe(1);
  });

  it('stops at the row budget', () => {
    const r = run(`${HEADER}G0 X0 Y0 Z0\nX1\nX2\nX3\n`, 2);
    expect(r.table.count).toBe(2);
    expect(codes(r)).toContain('too-many-moves@4');
  });
});
