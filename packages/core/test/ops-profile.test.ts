import { describe, expect, it } from 'vitest';
import {
  applyCommand, camContext, newOperation, polyArea, type ProfileOp, profileToolpath, type ResolvedContour, v2,
} from '../src';
import { camPartSetup, cutMoves, geoOf, rectPath, tool6 } from './fixtures/camSetup';

const { job, geometry } = camPartSetup(); // stock top 0, bottom −6; program X 0–110, Y 0–70
const ctx = camContext(applyCommand(job, { type: 'addTool', tool: tool6 }), geometry);
const outline: ResolvedContour = { path: rectPath(5, 5, 105, 65), z: 0, ref: 0 };
const profile = (patch: Partial<ProfileOp> = {}): ProfileOp =>
  ({ ...(newOperation('profile', { id: 'p', name: 'Profile', tool: tool6, modelKind: 'drawing' }) as ProfileOp), ...patch });
const zs = (moves: ReturnType<typeof cutMoves>) => [...new Set(moves.map((m) => +m.to.z.toFixed(4)))];

describe('profileToolpath', () => {
  it('cuts outside the contour, offset by the tool radius, in depth levels, climb = clockwise', () => {
    const noLeads = { mode: 'none' as const, length: 0, startPoint: 'auto' as const };
    const out = profileToolpath(profile({ leads: noLeads }), tool6, ctx, geoOf({ contours: [outline] }));
    expect(out.diagnostics).toEqual([]);
    const tp = out.toolpath!;
    expect(tp.moves[0]).toEqual({ kind: 'rapid', to: { x: expect.any(Number), y: expect.any(Number), z: 15 } });
    const last = tp.moves.at(-1)!;
    expect(last.kind === 'rapid' && last.to.z).toBe(15);
    expect(tp.clearance).toBe(15);
    const bottom = cutMoves(tp.moves).filter((m) => Math.abs(m.to.z + 6.2) < 1e-9);
    const xs = bottom.map((m) => m.to.x), ys = bottom.map((m) => m.to.y);
    expect(Math.max(...xs)).toBeCloseTo(108, 6);
    expect(Math.min(...ys)).toBeCloseTo(2, 6);
    expect(Math.min(...cutMoves(tp.moves).map((m) => m.to.z))).toBeCloseTo(-6.2, 9);
    // the flat bottom lap runs clockwise
    const lap = bottom.filter((m) => m.kind === 'line').map((m) => v2(m.to.x, m.to.y));
    expect(polyArea(lap)).toBeLessThan(0);
    expect(out.heights).toEqual({ top: 0, bottom: -6.2, feed: 2, retract: 5, clearance: 15 });
  });

  it('goes counter-clockwise for conventional milling and cuts inside for side "inside"', () => {
    const conv = profileToolpath(profile({ direction: 'conventional' }), tool6, ctx, geoOf({ contours: [outline] })).toolpath!;
    const lap = cutMoves(conv.moves).filter((m) => m.kind === 'line' && Math.abs(m.to.z + 6.2) < 1e-9).map((m) => v2(m.to.x, m.to.y));
    expect(polyArea(lap)).toBeGreaterThan(0);
    const inside = profileToolpath(profile({ side: 'inside', leads: { mode: 'none', length: 0, startPoint: 'auto' } }), tool6, ctx,
      geoOf({ contours: [{ path: rectPath(35, 25, 75, 45), z: 0, ref: 0 }] })).toolpath!;
    const xs = cutMoves(inside.moves).map((m) => m.to.x);
    expect(Math.min(...xs)).toBeCloseTo(38, 6);
    expect(Math.max(...xs)).toBeCloseTo(72, 6);
  });

  it('reports a collapsed inside offset', () => {
    const out = profileToolpath(profile({ side: 'inside' }), tool6, ctx, geoOf({ contours: [{ path: rectPath(0, 0, 5, 5), z: 0, ref: 3 }] }));
    expect(out.toolpath).toBeNull();
    expect(out.diagnostics).toMatchObject([{ severity: 'error', code: 'offset-collapsed', ref: 3 }]);
  });

  it('leaves radial and axial stock, then finishes at full size', () => {
    const out = profileToolpath(profile({ stockRadial: 0.5, stockAxial: 0.3, finishPass: true }), tool6, ctx, geoOf({ contours: [outline] }));
    const cuts = cutMoves(out.toolpath!.moves);
    const rough = cuts.filter((m) => Math.abs(m.to.z + 5.9) < 1e-9);
    expect(Math.max(...rough.map((m) => m.to.x))).toBeCloseTo(108.5, 6);
    const finish = cuts.filter((m) => Math.abs(m.to.z + 6.2) < 1e-9);
    expect(Math.max(...finish.map((m) => m.to.x))).toBeCloseTo(108, 6);
    expect(zs(cuts)).toEqual(expect.arrayContaining([-2.95, -5.9, -6.2]));
  });

  it('raises the path over tabs on levels below the tab top', () => {
    const op = profile({ tabs: { enabled: true, shape: 'rect', width: 4, height: 2, placement: 'count', count: 4, spacing: 50, positions: null } });
    const out = profileToolpath(op, tool6, ctx, geoOf({ contours: [outline] }));
    expect(out.diagnostics).toEqual([]);
    const atTabTop = cutMoves(out.toolpath!.moves).filter((m) => Math.abs(m.to.z + 4.2) < 1e-9);
    expect(atTabTop.length).toBeGreaterThanOrEqual(8); // up + across, for each of 4 tabs on the last level
    expect(out.overlays.tabs).toHaveLength(4);
    expect(out.overlays.laps).toMatchObject([{ refIndex: 0, z: -4.2 }]);
  });

  it('profiles open chains on the line with plunges and a warning', () => {
    const open = { closed: false, segments: [{ kind: 'line' as const, from: v2(10, 10), to: v2(50, 10) }] };
    const out = profileToolpath(profile({ side: 'on' }), tool6, ctx, geoOf({ contours: [{ path: open, z: 0, ref: 0 }] }));
    expect(out.diagnostics.map((d) => d.code)).toEqual(['entry-plunge']);
    const cuts = cutMoves(out.toolpath!.moves).filter((m) => m.kind === 'line' && m.to.y === 10 && m.to.z < 0);
    expect(cuts.map((m) => m.to.x)).toContain(50);
    expect(cuts.map((m) => m.to.x)).toContain(10);
  });

  it('descends along the lead-in when it is long enough', () => {
    const base = profile().heights;
    // feed height 0.04 above the top: the first drop is 0.24 mm ≤ lead-in length 4.712 × tan 3° = 0.2469 mm
    const op = profile({ stepdown: 0.2, heights: { ...base, feed: { from: 'top', offset: 0.04 }, bottom: { from: 'stockTop', offset: -0.2 } } });
    const tp = profileToolpath(op, tool6, ctx, geoOf({ contours: [outline] })).toolpath!;
    // lead-in quarter arc: length π/2 × 3 ≈ 4.71 mm × tan 3° ≈ 0.247 ≥ drop 0.2 → the first descending move is the lead-in arc
    const firstDown = cutMoves(tp.moves).find((m) => m.to.z < 0)!;
    expect(firstDown.kind).toBe('arc');
  });
});
