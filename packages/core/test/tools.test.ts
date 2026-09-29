import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportToolLibrary, importFusionLibrary, importToolLibrary, MATERIALS, starterLibrary, ToolLibraryError, validateTool } from '../src';

const fusion = {
  data: [
    {
      type: 'flat end mill', unit: 'millimeters', description: '6mm 2F upcut', vendor: 'Acme', 'product-id': 'A-6',
      geometry: { DC: 6, NOF: 2, LCF: 22, LB: 30, OAL: 50, RE: 0 }, 'post-process': { number: 5 },
      'start-values': { presets: [{ name: 'MDF', n: 18000, v_f: 2000, v_f_plunge: 500, stepdown: 3, stepover: 2.4, 'tool-coolant': 'disabled' }] },
    },
    {
      type: 'ball end mill', unit: 'inches', description: '1/4 ball', geometry: { DC: 0.25, NOF: 2, LCF: 0.75, OAL: 2, RE: 0.125 },
      'post-process': { number: 6 }, 'start-values': { presets: [{ name: 'Alu', n: 12000, v_f: 20, stepdown: 0.02, stepover: 0.025, 'tool-coolant': 'mist' }] },
    },
    { type: 'holder', description: 'BT30 holder' },
    { type: 'drill', unit: 'millimeters', description: '5mm drill', geometry: { DC: 5, SIG: 118, LCF: 30, OAL: 60 }, 'post-process': { number: 7 } },
  ],
};

describe('starter library', () => {
  it('has 10 valid tools with unique ids and numbers and a preset per material', () => {
    const tools = starterLibrary();
    expect(tools).toHaveLength(10);
    expect(new Set(tools.map((t) => t.id)).size).toBe(10);
    expect(new Set(tools.map((t) => t.number)).size).toBe(10);
    for (const t of tools) {
      expect(validateTool(t), t.name).toBe(true);
      expect(t.presets.map((p) => p.name)).toEqual([...MATERIALS]);
    }
    expect(tools.map((t) => `${t.type}:${t.diameter}`)).toEqual([
      'flat:3', 'flat:6', 'flat:8', 'ball:6', 'vbit:12', 'vbit:12', 'drill:3', 'drill:5', 'drill:6', 'drill:8',
    ]);
  });
});

describe('Spon tool library files', () => {
  it('round-trips and rejects broken files', () => {
    const tools = starterLibrary().slice(0, 2);
    expect(importToolLibrary(exportToolLibrary(tools))).toEqual(tools);
    expect(() => importToolLibrary('{')).toThrow(ToolLibraryError);
    expect(() => importToolLibrary('{"format":"other"}')).toThrow(/not a Spon tool library/);
    expect(() => importToolLibrary(JSON.stringify({ format: 'spon-tools', version: 1, tools: [{ id: 'x' }] }))).toThrow(/Tool 1 is invalid/);
  });

  it('rejects malformed presets gracefully', () => {
    const malformed = JSON.stringify({
      format: 'spon-tools', version: 1,
      tools: [{
        id: 'test', name: 'Test', type: 'flat', number: 1, diameter: 6, cornerRadius: 0, tipAngleDeg: 0, fluteLength: 18, stickout: 30, flutes: 2,
        presets: [null],
      }],
    });
    expect(() => importToolLibrary(malformed)).toThrow(/Tool 1 is invalid/);
  });

  it('validates bounds for presets and tool properties', () => {
    const tool = starterLibrary()[0];
    const badFeed = { ...tool, presets: [{ ...tool.presets[0], feed: 0 }] };
    const badPlunge = { ...tool, presets: [{ ...tool.presets[0], plungeFeed: 0 }] };
    const badRpm = { ...tool, presets: [{ ...tool.presets[0], rpm: 0 }] };
    const badFlutes = { ...tool, flutes: 0 };
    const badStickout = { ...tool, stickout: 0 };
    expect(validateTool(badFeed)).toBe(false);
    expect(validateTool(badPlunge)).toBe(false);
    expect(validateTool(badRpm)).toBe(false);
    expect(validateTool(badFlutes)).toBe(false);
    expect(validateTool(badStickout)).toBe(false);
  });
});

describe('Fusion 360 import', () => {
  it('maps tools, converts inches, keeps presets and skips unsupported types', () => {
    const r = importFusionLibrary(strToU8(JSON.stringify(fusion)), 'lib.json');
    expect(r.skipped).toEqual([{ name: 'BT30 holder', reason: 'Unsupported tool type "holder"' }]);
    expect(r.tools).toHaveLength(3);
    const [flat, ball, drill] = r.tools;
    expect(flat).toMatchObject({
      name: '6mm 2F upcut', type: 'flat', number: 5, diameter: 6, fluteLength: 22, stickout: 30, flutes: 2, vendor: 'Acme', productId: 'A-6',
      presets: [{ name: 'MDF', rpm: 18000, feed: 2000, plungeFeed: 500, stepdown: 3, stepoverPct: 40, coolant: 'off' }],
    });
    expect(ball.diameter).toBeCloseTo(6.35, 9);
    expect(ball.cornerRadius).toBeCloseTo(3.175, 9);
    expect(ball.presets[0]).toMatchObject({ rpm: 12000, coolant: 'mist', stepoverPct: 10 });
    expect(ball.presets[0].feed).toBeCloseTo(508, 9);
    expect(ball.presets[0].plungeFeed).toBeCloseTo(508, 9);
    expect(drill).toMatchObject({ type: 'drill', tipAngleDeg: 118, number: 7, presets: [] });
    for (const t of r.tools) expect(validateTool(t)).toBe(true);
  });

  it('reads zipped .tools files and rejects files without tools', () => {
    const zipped = zipSync({ 'tools.json': strToU8(JSON.stringify(fusion)) });
    expect(importFusionLibrary(zipped, 'lib.tools').tools).toHaveLength(3);
    expect(() => importFusionLibrary(strToU8('{"x":1}'), 'a.json')).toThrow(/not a Fusion 360 tool library/);
  });

  it('handles malformed data entries gracefully', () => {
    const malformed = { data: [null, fusion.data[0]] };
    const r = importFusionLibrary(strToU8(JSON.stringify(malformed)), 'lib.json');
    expect(r.tools).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toBe('Not a tool entry');
  });

  it('handles presets that are not arrays', () => {
    const malformed = {
      data: [{
        type: 'flat end mill', unit: 'millimeters', description: 'Test',
        geometry: { DC: 6, NOF: 2 }, 'post-process': { number: 1 },
        'start-values': { presets: 'x' },
      }],
    };
    const r = importFusionLibrary(strToU8(JSON.stringify(malformed)), 'lib.json');
    expect(r.tools).toHaveLength(1);
    expect(r.tools[0].presets).toHaveLength(0);
  });

  it('ignores null preset entries', () => {
    const malformed = {
      data: [{
        type: 'flat end mill', unit: 'millimeters', description: 'Test',
        geometry: { DC: 6, NOF: 2 }, 'post-process': { number: 1 },
        'start-values': { presets: [null, { name: 'Valid', n: 5000, v_f: 500, stepdown: 1 }] },
      }],
    };
    const r = importFusionLibrary(strToU8(JSON.stringify(malformed)), 'lib.json');
    expect(r.tools).toHaveLength(1);
    expect(r.tools[0].presets).toHaveLength(1);
    expect(r.tools[0].presets[0].name).toBe('Valid');
  });
});
