import { interpretProgram } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { buildToolpathBuffers, toolpathGeometryKey, TOOLPATH_COLORS } from './toolpath';

const table = interpretProgram('G21 G90 G17\nS1 M3\nG0 X0 Y0 Z5\nG1 Z0 F100\nG1 X10\nG3 X-10 Y0 I-10 J0\nG4 P1\n', { jobWorkOffset: 'G54' }).table;

describe('buildToolpathBuffers', () => {
  it('emits one segment per line move and several per arc, coloured by move type', () => {
    const b = buildToolpathBuffers(table, { showRapids: true });
    const perRow = Array.from(b.rowVertexEnd).map((v, i, all) => v - (i ? all[i - 1] : 0));
    expect(perRow.slice(0, 3)).toEqual([2, 2, 2]);
    expect(perRow[3]).toBeGreaterThan(20);
    expect(perRow[4]).toBe(0); // dwell draws nothing
    expect(b.positions.length).toBe(b.rowVertexEnd[4] * 3);
    expect(Array.from(b.colors.slice(0, 3))).toEqual(TOOLPATH_COLORS.rapid);
    expect(Array.from(b.colors.slice(6, 9))).toEqual(TOOLPATH_COLORS.plunge);
    expect(Array.from(b.colors.slice(12, 15))).toEqual(TOOLPATH_COLORS.feed);
    expect(Array.from(b.positions.slice(12, 18))).toEqual([0, 0, 0, 10, 0, 0]);
  });

  it('can leave rapids out while keeping the row map monotonic', () => {
    const b = buildToolpathBuffers(table, { showRapids: false });
    expect(b.rowVertexEnd[0]).toBe(0);
    expect(b.rowVertexEnd[1]).toBe(2);
  });
});

describe('toolpathGeometryKey', () => {
  it('stays reference-stable across the {...table, t} spread reanalyzeAll uses (only `t` differs)', () => {
    // simulate reanalyzeAll (packages/web/src/state/programs.ts): a fresh table wrapper sharing
    // every geometry array, only `t` replaced after re-timing.
    const reanalyzed = { ...table, t: new Float64Array(table.t.length) };
    const before = toolpathGeometryKey(table);
    const after = toolpathGeometryKey(reanalyzed);
    expect(before.length).toBe(after.length);
    for (let i = 0; i < before.length; i++) expect(after[i]).toBe(before[i]); // Object.is, not deep equality
  });

  it('changes when the actual geometry changes', () => {
    const other = interpretProgram('G21 G90 G17\nS1 M3\nG0 X1 Y1 Z1\n', { jobWorkOffset: 'G54' }).table;
    const key = toolpathGeometryKey(table);
    const otherKey = toolpathGeometryKey(other);
    expect(otherKey.some((v, i) => v !== key[i])).toBe(true);
  });
});
