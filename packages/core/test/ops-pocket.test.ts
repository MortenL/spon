import { describe, expect, it } from 'vitest';
import { applyCommand, camContext, type Move, newOperation, type PocketOp, pocketToolpath, type ResolvedShape, v2 } from '../src';
import { camPartSetup, cutMoves, geoOf, rectPath, tool6 } from './fixtures/camSetup';

/**
 * Every move of `moves` (including rapids), whose straight segment (or, for an arc, whose end points) runs below
 * Z 0, must keep the tool centre at least `minDist` from `center`. Straight segments are sampled every 0.2 mm.
 */
function assertClearOfCenter(moves: readonly Move[], center: { x: number; y: number }, minDist: number) {
  const checkPoint = (x: number, y: number, z: number) => {
    if (z < 0) expect(Math.hypot(x - center.x, y - center.y)).toBeGreaterThanOrEqual(minDist);
  };
  let prev: { x: number; y: number; z: number } | null = null;
  for (const m of moves) {
    if (m.kind === 'cycle') {
      prev = { x: m.at.x, y: m.at.y, z: m.retract };
      continue;
    }
    const to = m.to;
    if (m.kind === 'arc') {
      if (prev) checkPoint(prev.x, prev.y, prev.z);
      checkPoint(to.x, to.y, to.z);
    } else if (!prev) {
      checkPoint(to.x, to.y, to.z);
    } else {
      const dx = to.x - prev.x, dy = to.y - prev.y, dz = to.z - prev.z;
      const len = Math.hypot(dx, dy, dz);
      const steps = Math.max(1, Math.ceil(len / 0.2));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        checkPoint(prev.x + dx * t, prev.y + dy * t, prev.z + dz * t);
      }
    }
    prev = to;
  }
}

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
    expect(out.overlays.unmachined[0].regions).toHaveLength(4);
    for (const reg of out.overlays.unmachined[0].regions) expect(reg).toMatchObject({ outer: expect.any(Array), holes: [] });
    expect(out.overlays.unmachined[0].z).toBe(-3);
  });

  it('clears a round pocket with no unmachined warning', () => {
    const out = pocketToolpath(pocket(), tool6, ctx, geoOf({ shapes: [{ shape: { outer: ccwCircle(55, 35, 15), islands: [] }, z: 0, ref: 0 }] }));
    expect(out.diagnostics).toEqual([]);
  });

  it.each([8, 50])('raises no unmachined warning on a clean R%i round pocket with a 12 mm tool', (R) => {
    const tool12 = { ...tool6, id: 't12', number: 2, diameter: 12 };
    const out = pocketToolpath(pocket(), tool12, ctx, geoOf({ shapes: [{ shape: { outer: ccwCircle(55, 35, R), islands: [] }, z: 0, ref: 0 }] }));
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

  it('never rapids or feeds through the island, even between the two lobes of a ring', () => {
    const out = pocketToolpath(pocket(), tool6, ctx, geoOf({ shapes: [withIsland] }));
    assertClearOfCenter(out.toolpath!.moves, { x: 55, y: 35 }, 7 - 1e-3);
  });

  it('never rapids or feeds through the island across multiple depth levels', () => {
    const op = pocket({ stepdown: 1 }); // 3 levels
    const out = pocketToolpath(op, tool6, ctx, geoOf({ shapes: [withIsland] }));
    assertClearOfCenter(out.toolpath!.moves, { x: 55, y: 35 }, 7 - 1e-3);
  });

  it('cuts the outermost ring clockwise under conventional milling', () => {
    const op = pocket({ direction: 'conventional' });
    const out = pocketToolpath(
      op, tool6, ctx, geoOf({ shapes: [{ shape: { outer: ccwCircle(55, 35, 15), islands: [] }, z: 0, ref: 0 }] }),
    );
    const arcs = cutMoves(out.toolpath!.moves).filter((m): m is Extract<Move, { kind: 'arc' }> => m.kind === 'arc');
    const radius = (m: Extract<Move, { kind: 'arc' }>) => Math.hypot(m.to.x - m.center.x, m.to.y - m.center.y);
    const outer = arcs.reduce((best, m) => (radius(m) > radius(best) ? m : best));
    const signedArea = (outer.ccw ? 1 : -1) * Math.PI * radius(outer) ** 2;
    expect(signedArea).toBeLessThan(0);
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

  it.each([10, 45])('clears a pocket around a small island at %i percent stepover quickly and with a sane move count', (stepoverPct) => {
    const shape: ResolvedShape = { shape: { outer: rectPath(0, 0, 120, 80), islands: [circle(60, 40, 4)] }, z: 0, ref: 0 };
    const started = performance.now();
    const out = pocketToolpath(pocket({ stepoverPct }), tool6, ctx, geoOf({ shapes: [shape] }));
    expect(performance.now() - started).toBeLessThan(3000);
    expect(out.toolpath!.moves.length).toBeLessThan(1500);
    assertClearOfCenter(out.toolpath!.moves, { x: 60, y: 40 }, 7 - 1e-3);
    for (const m of cutMoves(out.toolpath!.moves)) {
      expect(Math.min(m.to.x, 120 - m.to.x, m.to.y, 80 - m.to.y)).toBeGreaterThanOrEqual(3 - 1e-6);
    }
  });

  it.each(['polygonal', 'smooth'])('clears a 1,000-segment %s star in under 2 s at 0.002 mm, clear of its walls', (kind) => {
    const pts = Array.from({ length: 1000 }, (_, i) => {
      const a = (i / 1000) * 2 * Math.PI;
      let rr = 30 + 3 * Math.cos(5 * a);
      if (kind === 'polygonal') {
        // a 5-point star (tips 33, notches 27) with each of its 10 edges split into 100 segments
        const k = Math.floor(i / 100), f = (i % 100) / 100;
        const ra = k % 2 ? 27 : 33, rb = k % 2 ? 33 : 27;
        const va = (k / 10) * 2 * Math.PI, vb = ((k + 1) / 10) * 2 * Math.PI;
        const A = v2(ra * Math.cos(va), ra * Math.sin(va)), B = v2(rb * Math.cos(vb), rb * Math.sin(vb));
        return v2(55 + A.x + (B.x - A.x) * f, 35 + A.y + (B.y - A.y) * f);
      }
      return v2(55 + rr * Math.cos(a), 35 + rr * Math.sin(a));
    });
    const outer = { closed: true, segments: pts.map((from, i) => ({ kind: 'line' as const, from, to: pts[(i + 1) % pts.length] })) };
    const started = performance.now();
    const out = pocketToolpath(pocket(), tool6, ctx, geoOf({ shapes: [{ shape: { outer, islands: [] }, z: 0, ref: 0 }] }));
    expect(performance.now() - started).toBeLessThan(2000);
    const wall = (p: { x: number; y: number }) => Math.min(...pts.map((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
    }));
    for (const m of cutMoves(out.toolpath!.moves)) expect(wall(m.to)).toBeGreaterThanOrEqual(3 - 1e-6);
  });
});
