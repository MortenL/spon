import { describe, expect, it } from 'vitest';
import {
  camContext, createJob, newOperation, offsetPolys, pathFromPoints, type ResolvedSlot, setStock, slotToolpath, type SlotOp, type Poly, differencePolys, polysArea, sweepPolylines, unionPolys,
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
/** Walls plus the tool swept along each relief move: a tool whose edge just reaches a (stock-inset) corner sits one radius from it on the diagonal and its body overlaps the walls beside the corner (+0.05 mm). */
function dogboneAllowance(stock: number): Poly[] {
  const reliefs = [{ x: 0, y: -5 }, { x: 0, y: 5 }, { x: 40, y: -5 }, { x: 40, y: 5 }].map((c) => {
    const dx = c.x === 0 ? 1 : -1, dy = c.y === -5 ? 1 : -1, k = 3 / Math.SQRT2;
    const tip = { x: c.x + dx * (stock + k), y: c.y + dy * (stock + k) };
    return { points: [tip, { x: tip.x + dx * 1.5, y: tip.y + dy * 1.5 }], closed: false as const };
  });
  return unionPolys(offsetPolys(rect(0, -5, 40, 5), 0.02, 0.005), sweepPolylines(reliefs, 3.05, 0.005));
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
      const allowed = dogboneAllowance(0);
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

describe('dogbone reliefs and the intended-overcut zones', () => {
  for (const stock of [0, 0.5]) {
    for (const strategy of ['wider', 'trochoidal'] as const) {
      it(`every relief move stays in its zone, reports the overcut, and reaches the stock-inset corners (stockRadial ${stock}, ${strategy})`, () => {
        const o = cut(['square', 'square'], { squareEnds: 'dogbone', strategy, stockRadial: stock });
        const lo = 3 + stock, hi = 37 - stock;
        // relief moves are the feed moves that go beyond the roughing region's end cut
        const reliefs = cutsAt(o.toolpath!, -3).filter((c) => c.points.some((p) => p.x < lo - 1e-3 || p.x > hi + 1e-3));
        expect(reliefs.length).toBeGreaterThanOrEqual(8);
        const zone = o.intended!.flatMap((i) => i.zone);
        const outside = differencePolys(sweepPolylines(reliefs, ctx.tolerance, ctx.tolerance / 8), zone);
        expect(polysArea(outside)).toBeLessThan(1e-6);
        const want = (3 * (1 - Math.SQRT1_2) - stock).toFixed(2);
        expect(o.intended!.map((i) => i.message)).toEqual(Array(2).fill(`Square slot end cut past the model wall by up to ${want} mm, as chosen`));
        // the tool edge reaches each corner of the walls inset by the stock
        const pts = cutsAt(o.toolpath!, -3).flatMap((c) => c.points);
        for (const c of [{ x: stock, y: -5 + stock }, { x: stock, y: 5 - stock }, { x: 40 - stock, y: -5 + stock }, { x: 40 - stock, y: 5 - stock }]) {
          expect(Math.min(...pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y)))).toBeLessThanOrEqual(3 + 0.01);
        }
        if (stock === 0) return;
        // with stock the walls are not reached: only the relief bodies cross the inset corner, never beyond the finished wall + relief bound
        expect(uncovered(sweptAt(o.toolpath!, -3, 3), dogboneAllowance(stock))).toBeLessThan(1e-3);
      });
    }
  }

  it('gives no dogbone zone or message when the stock leaves no overcut', () => {
    const o = cut(['square', 'square'], { squareEnds: 'dogbone', stockRadial: 1 });
    expect(o.intended).toEqual([]);
  });

  it('adds the finish-wall reliefs to the zones', () => {
    const o = cut(['square', 'square'], { squareEnds: 'dogbone', stockRadial: 0.5, finishWalls: true });
    expect(o.intended!.map((i) => i.message)).toEqual(Array(2).fill('Square slot end cut past the model wall by up to 0.88 mm, as chosen'));
  });
});

describe('several slots in one operation', () => {
  it('travels between slots at the retract height of the slot it goes to', () => {
    const base = newOperation('slot', { id: 's', name: 'Slot 1', tool: tool6, modelKind: 'mesh' }) as SlotOp;
    // heights relative to each slot's own top: retract 10 above slot 1, 15 above slot 2
    const op: SlotOp = {
      ...base, strategy: 'toolWidth', stepdown: 3,
      heights: { top: { from: 'contour', offset: 0 }, bottom: { from: 'slotBottom', offset: 0 }, feed: { from: 'top', offset: 2 }, retract: { from: 'feed', offset: 8 }, clearance: { from: 'retract', offset: 10 } },
    };
    const mk = (y: number, top: number): ResolvedSlot => ({ centreline: pathFromPoints([{ x: 0, y }, { x: 40, y }], false), width: 6, startEnd: 'round', endEnd: 'round', top, bottom: top - 3, through: false, ref: 0 });
    const o = slotToolpath(op, tool6, ctx, geoOf({ slots: [mk(0, 0), mk(40, 5)] }));
    expect(o.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const moves = o.toolpath!.moves;
    const i = moves.findIndex((m, k) => k > 0 && m.kind === 'rapid' && Math.abs(m.to.y - 40) < 1e-6);
    expect((moves[i - 1] as { to: { z: number } }).to.z).toBeCloseTo(15, 9);
    expect((moves[i] as { to: { z: number } }).to.z).toBeCloseTo(15, 9);
  });
});

describe('open slot ends', () => {
  it('run out past the edge by one tool radius plus 1 mm', () => {
    const o = cut(['open', 'round'], { squareEnds: null });
    expect(o.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(Math.min(...cutsAt(o.toolpath!, -3).flatMap((c) => c.points.map((p) => p.x)))).toBeLessThanOrEqual(-4 + 1e-6);
  });
});
