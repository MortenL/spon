/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allDiagnostics, motionTableTransferables, parsedProgramTransferables, parseProgram } from '../src/gcode/program';
import { vec3 } from '../src/geometry/vec3';
import { machinePreset } from '../src/job/machine';
import { expectWithin } from './fixtures/perf';

const ctx = { profile: machinePreset('Hobby GRBL router'), stock: { min: vec3(0, 0, -6), max: vec3(30, 20, 0) }, jobWorkOffset: 'G54' as const };
const fixture = readFileSync(new URL('./fixtures/drill-arc.nc', import.meta.url));

describe('parseProgram', () => {
  it('parses the fixture program with exactly one diagnostic', () => {
    const p = parseProgram(new Uint8Array(fixture), ctx);
    expect(allDiagnostics(p).map((d) => `${d.code}@${d.line}`)).toEqual(['rapid-into-stock@17']);
    expect(p.tools).toEqual([1]);
    expect(p.analysis.summary.totalSeconds).toBeGreaterThan(30); // includes the 30 s tool change
    expect(p.lineStarts.length).toBe(p.lineFlags.length);
    expect(p.firstMoveOfLine[17]).toBeGreaterThan(0);
  });

  it('merges interpreter and analysis diagnostics by line', () => {
    const merged = allDiagnostics({
      interpretDiagnostics: [{ line: 5, severity: 'warning', code: 'arc-radius', message: 'a' }],
      analysis: { summary: {} as never, diagnostics: [{ line: 2, severity: 'error', code: 'rapid-into-stock', message: 'b' }] },
    });
    expect(merged.map((d) => d.line)).toEqual([2, 5]);
  });

  it('lists every typed-array buffer for zero-copy transfer', () => {
    const p = parseProgram(new Uint8Array(fixture), ctx);
    expect(motionTableTransferables(p.table)).toHaveLength(10);
    expect(new Set(parsedProgramTransferables(p)).size).toBe(13);
  });

  it('parses and times a 2 M-line program quickly', () => {
    const lines = ['G21 G90 G17', 'S10000 M3', 'G0 X0 Y0 Z1', 'G1 Z0 F1000'];
    for (let i = 0; i < 2_000_000; i++) lines.push(`X${(i % 1000) / 10} Y${Math.floor(i / 1000) / 10}`);
    const bytes = new TextEncoder().encode(lines.join('\n'));
    const started = performance.now();
    const p = parseProgram(bytes, { ...ctx, stock: null });
    const ms = performance.now() - started;
    expect(p.table.count).toBe(2_000_002);
    // spec target ≈ 3 s; 5 s leaves headroom for slower machines while still catching per-line allocations
    expectWithin(ms, 5000);
  }, 60_000);
});
