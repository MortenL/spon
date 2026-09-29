import { describe, expect, it } from 'vitest';
import { applyCommand, camContext, newOperation, type PocketOp, pocketToolpath, type ResolvedShape, v2 } from '../src';
import { camPartSetup, cutMoves, geoOf, rectPath, tool6 } from './fixtures/camSetup';

const { job, geometry } = camPartSetup();
const ctx = camContext(applyCommand(job, { type: 'addTool', tool: tool6 }), geometry);
const circle = (cx: number, cy: number, r: number) => ({
  closed: true, segments: [{ kind: 'arc' as const, center: v2(cx, cy), radius: r, startAngle: 0, sweep: -2 * Math.PI }],
});
const withIsland: ResolvedShape = { shape: { outer: rectPath(35, 25, 75, 45), islands: [circle(55, 35, 4)] }, z: 0, ref: 0 };
const ccwCircle = (cx: number, cy: number, r: number) => ({
  closed: true, segments: [{ kind: 'arc' as const, center: v2(cx, cy), radius: r, startAngle: 0, sweep: 2 * Math.PI }],
});
const pocket = (patch: Partial<PocketOp> = {}): PocketOp =>
  ({ ...(newOperation('pocket', { id: 'k', name: 'Pocket', tool: tool6, modelKind: 'drawing' }) as PocketOp), ...patch });

describe('pocketToolpath', () => {
  it('keeps the tool centre inside the pocket and clear of the island', () => {
    const out = pocketToolpath(pocket(), tool6, ctx, geoOf({ shapes: [withIsland] }));
    expect(out.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    for (const m of cutMoves(out.toolpath!.moves)) {
      expect(m.to.x).toBeGreaterThanOrEqual(38 - 1e-6);
      expect(m.to.x).toBeLessThanOrEqual(72 + 1e-6);
      expect(m.to.y).toBeGreaterThanOrEqual(28 - 1e-6);
      expect(m.to.y).toBeLessThanOrEqual(42 + 1e-6);
      expect(Math.hypot(m.to.x - 55, m.to.y - 35)).toBeGreaterThanOrEqual(7 - 1e-3);
    }
    expect(Math.min(...cutMoves(out.toolpath!.moves).map((m) => m.to.z))).toBeCloseTo(-3, 9);
  });

  it('enters with a helix and warns about the four square corners it cannot reach', () => {
    const out = pocketToolpath(pocket(), tool6, ctx, geoOf({ shapes: [withIsland] }));
    const firstCut = cutMoves(out.toolpath!.moves)[0];
    expect(firstCut.kind).toBe('arc');
    expect(out.diagnostics.map((d) => d.code)).toEqual(['unmachined-area']);
    expect(out.overlays.unmachined).toHaveLength(1);
    expect(out.overlays.unmachined[0].polys).toHaveLength(4);
    expect(out.overlays.unmachined[0].z).toBe(-3);
  });

  it('clears a round pocket with no unmachined warning', () => {
    const out = pocketToolpath(pocket(), tool6, ctx, geoOf({ shapes: [{ shape: { outer: ccwCircle(55, 35, 15), islands: [] }, z: 0, ref: 0 }] }));
    expect(out.diagnostics).toEqual([]);
  });

  it('steps down in levels and finishes the floor when axial stock is left', () => {
    const op = pocket({ stepdown: 1, stockAxial: 0.5, finishFloor: true });
    const cuts = cutMoves(pocketToolpath(op, tool6, ctx, geoOf({ shapes: [withIsland] })).toolpath!.moves);
    const flat = [...new Set(cuts.filter((m) => m.kind === 'line').map((m) => +m.to.z.toFixed(4)))];
    expect(flat).toEqual(expect.arrayContaining([-0.8333, -1.6667, -2.5, -3]));
  });

  it('reports a tool that does not fit', () => {
    const big = { ...tool6, id: 'big', diameter: 30 };
    const out = pocketToolpath(pocket(), big, ctx, geoOf({ shapes: [withIsland] }));
    expect(out.toolpath).toBeNull();
    expect(out.diagnostics).toMatchObject([{ severity: 'error', code: 'offset-collapsed' }]);
  });

  it('clears separate areas of a pocket one after the other', () => {
    // two 20 × 20 rooms joined by a 4 mm corridor the 6 mm tool cannot enter
    const outer = { closed: true, segments: [
      [v2(0, 0), v2(20, 0)], [v2(20, 0), v2(20, 8)], [v2(20, 8), v2(40, 8)], [v2(40, 8), v2(40, 0)], [v2(40, 0), v2(60, 0)],
      [v2(60, 0), v2(60, 20)], [v2(60, 20), v2(40, 20)], [v2(40, 20), v2(40, 12)], [v2(40, 12), v2(20, 12)], [v2(20, 12), v2(20, 20)],
      [v2(20, 20), v2(0, 20)], [v2(0, 20), v2(0, 0)],
    ].map(([from, to]) => ({ kind: 'line' as const, from, to })) };
    const out = pocketToolpath(pocket(), tool6, ctx, geoOf({ shapes: [{ shape: { outer, islands: [] }, z: 0, ref: 0 }] }));
    const rooms = cutMoves(out.toolpath!.moves).map((m) => (m.to.x < 20 ? 'L' : m.to.x > 40 ? 'R' : '')).join('');
    expect(rooms).toMatch(/^(L+R+|R+L+)$/); // one room is finished completely before the other starts
  });
});
