import { describe, expect, it } from 'vitest';
import { applyCommand, axisMap, createJob, defaultPostSettings, type Job, mapToolpath, postProcess, type Tool, type Toolpath, type WcsAxes } from '../src';

const tool: Tool = { id: 'a', name: '6 mm flat', type: 'flat', number: 1, diameter: 6, cornerRadius: 0, tipAngleDeg: 0, fluteLength: 20, stickout: 30, flutes: 2, presets: [] };
const tp: Toolpath = {
  operationId: 'A', operationName: 'Mixed', toolId: 'a', rpm: 18000, coolant: 'off', clearance: 15,
  moves: [
    { kind: 'rapid', to: { x: 10, y: 5, z: 15 } },
    { kind: 'line', to: { x: 20, y: 8, z: -1 }, feed: 1000 },
    { kind: 'arc', to: { x: 30, y: 8, z: -1 }, center: { x: 25, y: 8 }, ccw: true, feed: 1000 },
    { kind: 'arc', to: { x: 40, y: 8, z: -1 }, center: { x: 35, y: 11 }, ccw: false, feed: 1000 },
    { kind: 'arc', to: { x: 40, y: 8, z: -1 }, center: { x: 45, y: 8 }, ccw: true, feed: 1000 },
    { kind: 'rapid', to: { x: 40, y: 8, z: 15 } },
    { kind: 'cycle', cycle: 'drill', at: { x: 12, y: 33 }, top: 0, bottom: -5, r: 2, retract: 5, peck: 0, dwell: 0, feed: 200 },
  ],
};
const job = (axes: WcsAxes): Job => {
  const j = applyCommand(createJob('Axes'), { type: 'addTool', tool });
  return { ...j, wcs: { ...j.wcs, axes }, post: { ...defaultPostSettings('linuxcnc'), arcFormat: 'ij' } };
};
const words = (line: string): Record<string, number> => Object.fromEntries([...line.matchAll(/([XYIJ])(-?[\d.]+)/g)].map((m) => [m[1], Number(m[2])]));

const layouts: WcsAxes[] = [];
for (const reverseX of [false, true]) for (const reverseY of [false, true]) for (const swapXY of [false, true]) layouts.push({ reverseX, reverseY, swapXY });

describe('mapToolpath', () => {
  it('returns the same object for the identity map', () => {
    expect(mapToolpath(tp, axisMap({ reverseX: false, reverseY: false, swapXY: false }))).toBe(tp);
  });
  it.each(layouts)('maps every XY, flips arcs when mirrored, IJ follow (%j)', (axes) => {
    const map = axisMap(axes);
    const text = postProcess(job(axes), [tp], { date: 'd' })[0].text.split('\n');
    const motion = text.filter((l) => !l.startsWith('(') && /[XY]-?\d/.test(l));
    const moves = tp.moves.filter((_, k) => k !== 5); // the retract has no XY
    expect(motion).toHaveLength(moves.length);
    let start = { x: NaN, y: NaN };
    moves.forEach((m, k) => {
      const p = map.toMachine(m.kind === 'cycle' ? m.at : m.to);
      const w = words(motion[k]);
      expect(w.X).toBeCloseTo(p.x, 9);
      expect(w.Y).toBeCloseTo(p.y, 9);
      if (m.kind === 'arc') {
        expect(/G3/.test(motion[k])).toBe(m.ccw !== map.mirrored);
        const c = map.toMachine(m.center);
        expect(w.I).toBeCloseTo(c.x - start.x, 9);
        expect(w.J).toBeCloseTo(c.y - start.y, 9);
      }
      start = p;
    });
  });
  it('writes the unchanged program with all switches off', () => {
    const text = postProcess(job({ reverseX: false, reverseY: false, swapXY: false }), [tp], { date: 'd' })[0].text;
    expect(text.split('\n').slice(5, 16)).toEqual([
      '(Mixed)', 'T1 M6', 'G43 H1', 'S18000 M3', 'G0 Z15', 'X10 Y5', 'G1 X20 Y8 Z-1 F1000', 'G3 X30 Y8 I5 J0', 'G2 X40 Y8 I5 J3', 'G3 X40 Y8 I5 J0', 'G0 Z15',
    ]);
  });
});
