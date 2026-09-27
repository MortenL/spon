import { computeTiming, interpretProgram, machinePreset, type ParsedProgram, type ProgramRef } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import type { ProgramData } from '../state/store';
import { buildTimeline, locate, stepTime, timeOfLine } from './timeline';

const profile = machinePreset('Hobby GRBL router');

function data(text: string): ProgramData {
  const r = interpretProgram(text, { jobWorkOffset: 'G54' });
  computeTiming(r.table, profile);
  const parsed = {
    table: r.table, lineStarts: r.lineStarts, lineFlags: r.lineFlags, firstMoveOfLine: r.firstMoveOfLine,
    interpretDiagnostics: r.diagnostics, tools: r.tools, usesInch: r.usesInch,
    analysis: { summary: { totalSeconds: r.table.t[r.table.count - 1] } as never, diagnostics: [] },
  } satisfies ParsedProgram;
  return { status: 'ready', text, parsed, error: null };
}

const prog = (id: string, blobId: string, inTimeline = true): ProgramRef => ({ id, name: `${id}.nc`, blobId, inTimeline });

describe('timeline', () => {
  const a = data('G4 P2\nG4 P3\n'); // 5 s, dwell rows on lines 0 and 1
  const b = data('G4 P10\n'); // 10 s
  const programs = [prog('A', 'a'), prog('X', 'x', false), prog('B', 'b')];
  const all = { a, b, x: data('G4 P99\n') };

  it('chains included, ready programs back to back', () => {
    const tl = buildTimeline(programs, all);
    expect(tl.entries.map((e) => [e.programId, e.start, e.duration])).toEqual([['A', 0, 5], ['B', 5, 10]]);
    expect(tl.total).toBe(15);
    expect(buildTimeline(programs, { a }).entries.map((e) => e.programId)).toEqual(['A']);
  });

  it('locates a global time and clamps it', () => {
    const tl = buildTimeline(programs, all);
    expect(locate(tl, 7)).toMatchObject({ index: 1, local: 2 });
    expect(locate(tl, -3)).toMatchObject({ index: 0, local: 0 });
    expect(locate(tl, 99)).toMatchObject({ index: 1, local: 10 });
    expect(locate(buildTimeline([], {}), 1)).toBeNull();
  });

  it('finds the start time of a line and steps between moves', () => {
    expect(timeOfLine(a.parsed!, 1)).toBe(2);
    expect(timeOfLine(a.parsed!, 2)).toBeNull();
    const tl = buildTimeline(programs, all);
    expect(stepTime(tl, all, 0, 1)).toBe(2);
    expect(stepTime(tl, all, 2.5, 1)).toBe(5);
    expect(stepTime(tl, all, 6, -1)).toBe(5);
    expect(stepTime(tl, all, 3, -1)).toBe(2);
  });

  it('steps back across program boundaries', () => {
    const tl = buildTimeline(programs, all);
    // At the start of program B (global time 5), step back should go to the start of A's last move
    // A's last move (row 1) starts at program-local time 2, so global time is 0 + 2 = 2
    expect(stepTime(tl, all, 5, -1)).toBe(2);
  });
});
