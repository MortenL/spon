import { describe, expect, it } from 'vitest';
import { starterLibrary, validateTool, type Tool } from '../src';

const base: Tool = {
  id: 't', name: 'TM', type: 'threadmill', number: 20, diameter: 6, cornerRadius: 0, tipAngleDeg: 60, fluteLength: 6, stickout: 30, flutes: 1,
  presets: [], thread: { neckDiameter: 4.5, neckLength: 20, pitch: null, teeth: 1 },
};
const without = (t: Tool): Tool => { const c = { ...t }; delete c.thread; return c; };

describe('thread mill tools', () => {
  it('accepts single-point and multi-tooth thread mills', () => {
    expect(validateTool(base)).toBe(true);
    expect(validateTool({ ...base, thread: { neckDiameter: 4.8, neckLength: 15, pitch: 1.25, teeth: 8 } })).toBe(true);
  });
  it('rejects invalid thread mills', () => {
    expect(validateTool(without(base))).toBe(false);
    expect(validateTool({ ...base, thread: { ...base.thread!, teeth: 0 } })).toBe(false);
    expect(validateTool({ ...base, thread: { ...base.thread!, neckDiameter: 0 } })).toBe(false);
    expect(validateTool({ ...base, thread: { ...base.thread!, neckLength: 0 } })).toBe(false);
    expect(validateTool({ ...base, thread: { ...base.thread!, pitch: 0 } })).toBe(false);
    expect(validateTool({ ...base, tipAngleDeg: 0 })).toBe(false);
    expect(validateTool({ ...base, tipAngleDeg: 180 })).toBe(false);
  });
  it('rejects a non-thread-mill carrying thread data', () => {
    expect(validateTool({ ...base, type: 'flat' })).toBe(false);
  });
  it('starter library has the two thread mills with unique T numbers', () => {
    const lib = starterLibrary();
    const sp6 = lib.find((t) => t.id === 'starter-thread-sp6')!;
    const m8 = lib.find((t) => t.id === 'starter-thread-m8')!;
    expect(sp6).toMatchObject({ name: 'Thread mill 60° single-point 6 mm', type: 'threadmill', diameter: 6, tipAngleDeg: 60, thread: { neckDiameter: 2.8, neckLength: 20, pitch: null, teeth: 1 } });
    expect(m8).toMatchObject({ name: 'Thread mill M8×1.25 multi-tooth', type: 'threadmill', diameter: 6.2, tipAngleDeg: 60, thread: { neckDiameter: 4.8, neckLength: 15, pitch: 1.25, teeth: 8 } });
    expect(sp6.presets).toHaveLength(4);
    expect(validateTool(sp6) && validateTool(m8)).toBe(true);
    expect(new Set(lib.map((t) => t.number)).size).toBe(lib.length);
  });
});
