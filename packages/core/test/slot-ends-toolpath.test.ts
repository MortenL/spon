import { describe, expect, it } from 'vitest';
import {
  camContext, createJob, newOperation, offsetPolys, pathFromPoints, type ResolvedSlot, setStock, slotToolpath, type SlotOp, type Poly, sweepPolylines, unionPolys,
} from '../src';
import { geoOf, tool6 } from './fixtures/camSetup';
import { cutsAt, sweptAt, uncovered } from './fixtures/slotSetup';

const ctx = camContext(setStock(createJob(), { mode: 'fixed', size: { x: 200, y: 200, z: 20 }, modelOffset: { x: 0, y: 0, z: 0 } }), null);
const rect = (x0: number, y0: number, x1: number, y1: number): Poly[] => [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]];

function cut(ends: [ResolvedSlot['startEnd'], ResolvedSlot['endEnd']], patch: Partial<SlotOp>, width = 10) {
  const base = newOperation('slot', { id: 's', name: 'Slot 1', tool: tool6, modelKind: 'mesh' }) as SlotOp;
  // top at the slot's own top (0), bottom at its slot bottom (-3)
  const op: SlotOp = { ...base, stepdown: 3, heights: { ...base.heights, top: { from: 'contour', offset: 0 } }, ...patch };
  const slot: ResolvedSlot = { centreline: pathFromPoints([{ x: 0, y: 0 }, { x: 40, y: 0 }], false), width, startEnd: ends[0], endEnd: ends[1], top: 0, bottom: -3, through: false, ref: 0 };
  return slotToolpath(op, tool6, ctx, geoOf({ slots: [slot] }));
}
const messages = (o: ReturnType<typeof cut>) => o.diagnostics.map((d) => d.message);

describe('square slot ends', () => {
  it('must be chosen before the slot is cut (review focus 3)', () => {
    const o = cut(['square', 'square'], { squareEnds: null });
    expect(messages(o)).toContain('Choose how square slot ends are cut');
    expect(o.toolpath).toBeNull();
  });

  for (const strategy of ['wider', 'trochoidal'] as const) {
    it(`inside: stays inside the walls and warns about the corners (${strategy})`, () => {
      const o = cut(['square', 'square'], { squareEnds: 'inside', strategy });
      expect(messages(o)).toContain('Square slot ends keep the tool radius in their corners');
      const swept = sweptAt(o.toolpath!, -3, 3);
      expect(uncovered(swept, offsetPolys(rect(0, -5, 40, 5), 0.02, 0.005))).toBeLessThan(1e-3);
      expect(uncovered(rect(0.1, -0.5, 39.9, 0.5), swept)).toBeLessThan(1e-3); // the end walls are reached across their middle
      expect(o.intended).toEqual([]);
    });

    it(`endWall: clears the whole end line by overcutting one tool radius (${strategy})`, () => {
      const o = cut(['square', 'square'], { squareEnds: 'endWall', strategy });
      const swept = sweptAt(o.toolpath!, -3, 3);
      // wider loops reach the square corners' edges; trochoidal circles cannot (the finish-wall pass would), so they are checked across the middle
      expect(uncovered(strategy === 'wider' ? rect(0, -5, 40, 5) : rect(0, -0.5, 40, 0.5), swept)).toBeLessThan(1e-3);
      expect(uncovered(swept, offsetPolys(rect(-3, -5, 43, 5), 0.02, 0.005))).toBeLessThan(1e-3);
      expect(o.intended!.map((i) => i.message)).toEqual([
        'Square slot end cut past the model wall by up to 3.00 mm, as chosen', 'Square slot end cut past the model wall by up to 3.00 mm, as chosen',
      ]);
    });

    it(`dogbone: the tool edge reaches every corner, and only the corner reliefs cut past the walls (${strategy})`, () => {
      const o = cut(['square', 'square'], { squareEnds: 'dogbone', strategy });
      const corners = [{ x: 0, y: -5 }, { x: 0, y: 5 }, { x: 40, y: -5 }, { x: 40, y: 5 }];
      const pts = cutsAt(o.toolpath!, -3).flatMap((c) => c.points);
      for (const c of corners) expect(Math.min(...pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y)))).toBeLessThanOrEqual(3 + 0.01);
      // a tool whose edge just reaches a corner sits one radius from it on the diagonal, and its body overlaps the walls beside the corner:
      // the allowance is the walls plus the tool swept along each relief move (tip to the region corner), +0.05 mm
      const reliefs = corners.map((c) => {
        const dx = c.x === 0 ? 1 : -1, dy = c.y === -5 ? 1 : -1, k = 3 / Math.SQRT2;
        const tip = { x: c.x + dx * k, y: c.y + dy * k };
        return { points: [tip, { x: tip.x + dx * 1.5, y: tip.y + dy * 1.5 }], closed: false as const };
      });
      const allowed = unionPolys(offsetPolys(rect(0, -5, 40, 5), 0.02, 0.005), sweepPolylines(reliefs, 3.05, 0.005));
      expect(uncovered(sweptAt(o.toolpath!, -3, 3), allowed)).toBeLessThan(1e-3);
      expect(o.intended).toHaveLength(2);
    });
  }

  it('dogbones a tool-width keyway too', () => {
    const o = cut(['square', 'square'], { squareEnds: 'dogbone' }, 6);
    const pts = cutsAt(o.toolpath!, -3).flatMap((c) => c.points);
    expect(Math.min(...pts.map((p) => Math.hypot(p.x - 0, p.y - 3)))).toBeLessThanOrEqual(3 + 0.01);
  });
});

describe('open slot ends', () => {
  it('run out past the edge by one tool radius plus 1 mm', () => {
    const o = cut(['open', 'round'], { squareEnds: null });
    expect(o.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(Math.min(...cutsAt(o.toolpath!, -3).flatMap((c) => c.points.map((p) => p.x)))).toBeLessThanOrEqual(-4 + 1e-6);
  });
});
