import { describe, expect, it } from 'vitest';
import { camContext, resolveGeometry } from '../src';
import { drawingSlotJob } from './fixtures/slotSetup';
import {
  adjustCentreline, centreRegion, differencePolys, endFrame, offsetPolys, pathFromPoints, pathLength, pathStart, pathEnd, polysArea,
  pointInPolys, slotCuts, slotStrategy, sweepPolylines, flattenPath, type Path2D,
} from '../src';

const line = pathFromPoints([{ x: 0, y: 0 }, { x: 40, y: 0 }], false);
const arc: Path2D = { closed: false, segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 30, startAngle: 0, sweep: Math.PI / 2 }] };
const thin = (a: ReturnType<typeof differencePolys>) => polysArea(offsetPolys(offsetPolys(a, -0.02, 0.005), 0.02, 0.005));

describe('slot ends', () => {
  it('gives each end an outward frame', () => {
    expect(endFrame(line, 'start')).toMatchObject({ p: { x: 0, y: 0 }, t: { x: -1, y: 0 } });
    const e = endFrame(arc, 'end');
    expect(e.p.x).toBeCloseTo(0, 9); expect(e.p.y).toBeCloseTo(30, 9);
    expect(e.t.x).toBeCloseTo(-1, 9); expect(e.t.y).toBeCloseTo(0, 9);
  });

  it('turns end kinds into cuts', () => {
    const s = { centreline: line, startEnd: 'round' as const, endEnd: 'square' as const };
    expect(slotCuts(s, 3, 'inside', 0.5)).toEqual({ start: null, end: -3.5 });
    expect(slotCuts(s, 3, 'endWall', 0.5)).toEqual({ start: null, end: 0 });
    expect(slotCuts({ ...s, startEnd: 'open' }, 3, 'dogbone', 0)).toEqual({ start: 4, end: -3 });
    expect(slotCuts({ ...s, centreline: { ...line, closed: true } }, 3, 'inside', 0)).toEqual({ start: null, end: null });
  });

  it('trims and extends a centreline along its end tangents', () => {
    const p = adjustCentreline(line, 2, -5)!;
    expect(pathStart(p)).toEqual({ x: -2, y: 0 });
    expect(pathEnd(p).x).toBeCloseTo(35, 9);
    expect(pathLength(adjustCentreline(arc, -3, -3)!)).toBeCloseTo(15 * Math.PI - 6, 6);
    expect(adjustCentreline(line, -20, -20)).toBeNull();
  });

  it('builds the tool-centre region: round ends as obrounds, cut ends square', () => {
    const round = centreRegion(line, { start: null, end: null }, 2, 0.01);
    const obround = sweepPolylines([{ points: flattenPath(line, 0.001), closed: false }], 2, 0.005);
    expect(thin(differencePolys(obround, round))).toBeLessThan(1e-3);
    expect(thin(differencePolys(round, offsetPolys(obround, 0.02, 0.005)))).toBeLessThan(1e-3);

    const cut = centreRegion(line, { start: -3, end: 0 }, 2, 0.01);
    const rect = [[{ x: 3, y: -2 }, { x: 40, y: -2 }, { x: 40, y: 2 }, { x: 3, y: 2 }]];
    expect(thin(differencePolys(rect, cut))).toBeLessThan(1e-3);
    expect(thin(differencePolys(cut, offsetPolys(rect, 0.02, 0.005)))).toBeLessThan(1e-3);
    expect(pointInPolys({ x: 40.5, y: 0 }, cut)).toBe(false);
  });

  it('picks tool-width or wider automatically and checks forced strategies', () => {
    expect(slotStrategy('auto', 6.04, 6)).toMatchObject({ strategy: 'toolWidth' });
    expect(slotStrategy('auto', 10, 6)).toMatchObject({ strategy: 'wider', reason: 'width 10 > tool 6' });
    expect(slotStrategy('auto', 5.9, 6)).toEqual({ error: { code: 'tool-too-large', message: 'The tool is wider than this slot (5.90 mm)' } });
    expect(slotStrategy('toolWidth', 10, 6)).toEqual({ error: { code: 'slot-width-mismatch', message: 'Tool-width slots need a tool as wide as the slot (10.00 mm); use Wider' } });
    expect(slotStrategy('trochoidal', 10, 6)).toMatchObject({ strategy: 'trochoidal' });
  });
});

describe('drawn slot centrelines', () => {
  it('resolve to round-ended slots; a circle is a ring', () => {
    const open = pathFromPoints([{ x: 0, y: 0 }, { x: 30, y: 0 }], false);
    const circle: Path2D = { closed: true, segments: [{ kind: 'arc', center: { x: 0, y: 40 }, radius: 10, startAngle: 0, sweep: 2 * Math.PI }] };
    const { job, geometry } = drawingSlotJob([open, circle], { width: 8 });
    const g = resolveGeometry(job.operations[0], camContext(job, geometry));
    expect(g.slots).toHaveLength(2);
    const o = g.slots.find((s) => !s.centreline.closed)!;
    expect(o).toMatchObject({ startEnd: 'round', endEnd: 'round', width: 8, bottom: null, through: false });
    expect(g.slots.find((s) => s.centreline.closed)!.centreline.closed).toBe(true);
  });
});
