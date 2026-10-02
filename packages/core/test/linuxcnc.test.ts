import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importToolFile, mergeToolTable, parseLinuxCncToolTable, starterLibrary, suggestToolTableUnits, validateTool } from '../src';

const text = readFileSync(new URL('./fixtures/tool.tbl', import.meta.url), 'utf8');

describe('LinuxCNC tool tables', () => {
  it('parses words in any order and case, converting inches to mm', () => {
    const r = parseLinuxCncToolTable(text, 'in');
    expect(r.tools.map((t) => t.number)).toEqual([1, 2, 3, 4, 5, 6, 8]);
    expect(r.tools[0]).toMatchObject({ id: 'linuxcnc-T1', name: '1/4 flat endmill', type: 'flat', diameter: 6.35, flutes: 2, presets: [] });
    expect(r.tools[0].fluteLength).toBeCloseTo(19.05, 9);
    expect(r.tools[0].stickout).toBeCloseTo(25.4, 9);
    expect(r.tools[6]).toMatchObject({ name: 'T8 ⌀0.1', diameter: 2.54 });
    expect(r.skipped).toEqual([
      { line: 9, reason: 'no diameter (D)' },
      { line: 10, reason: 'T1 appears again; the first line was used' },
    ]);
    for (const t of r.tools) expect(validateTool(t)).toBe(true);
  });

  it('guesses the tool type from the comment and lists the guesses', () => {
    const r = parseLinuxCncToolTable(text, 'in');
    const by = (n: number) => r.tools.find((t) => t.number === n)!;
    expect(by(2)).toMatchObject({ type: 'drill', tipAngleDeg: 118 });
    expect(by(3)).toMatchObject({ type: 'vbit', tipAngleDeg: 60 });
    expect(by(4)).toMatchObject({ type: 'ball', cornerRadius: 3.175 });
    expect(by(5).type).toBe('bull');
    expect(by(5).cornerRadius).toBeCloseTo(0.762, 9);
    expect(by(6)).toMatchObject({ type: 'chamfer', tipAngleDeg: 90 });
    expect(r.guesses).toContain('T2 Spiralbohrer 1/8: drill (from the comment)');
    expect(r.guesses.some((g) => g.startsWith('T1 '))).toBe(false); // flat with no keyword is not a guess
  });

  it('suggests inches when every diameter is under 1', () => {
    expect(suggestToolTableUnits(text)).toBe('in');
    expect(suggestToolTableUnits('T1 D6\nT2 D0.5')).toBe('mm');
  });

  it("keeps the table's T numbers and moves clashing library tools (review focus 5)", () => {
    const library = starterLibrary();
    const clash = library.find((t) => t.number === 3)!;
    const merge = mergeToolTable(library, parseLinuxCncToolTable(text, 'in').tools);
    const numbers = merge.library.map((t) => t.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(merge.library.find((t) => t.id === 'linuxcnc-T3')!.number).toBe(3);
    const moved = merge.library.find((t) => t.id === clash.id)!;
    expect(moved.number).not.toBe(3);
    expect(merge.notes).toContain(`${clash.name} moved from T3 to T${moved.number}`);
    expect(merge.incoming.some((t) => t.id === clash.id)).toBe(true);
    // re-importing updates the same tools
    const again = mergeToolTable(merge.library, parseLinuxCncToolTable(text, 'in').tools);
    expect(again.added).toBe(0);
    expect(again.updated).toBe(7);
  });

  it('imports through importToolFile, and needs units for .tbl', () => {
    const bytes = new TextEncoder().encode(text);
    expect(() => importToolFile([], bytes, 'tool.tbl')).toThrow('A LinuxCNC tool table has no units');
    const r = importToolFile([], bytes, 'tool.tbl', 'in');
    expect(r.added).toBe(7);
    expect(r.skipped).toEqual([
      { name: 'line 9', reason: 'no diameter (D)' },
      { name: 'line 10', reason: 'T1 appears again; the first line was used' },
    ]);
    expect(() => parseLinuxCncToolTable('; nothing\n', 'mm')).toThrow('No tools found in this tool table');
  });
});
