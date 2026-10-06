import { describe, expect, it } from 'vitest';
import {
  applyCommand, camContext, dist2, flattenPath, newOperation, polyArea, type ProfileOp, profileToolpath, type ResolvedContour, v2,
} from '../src';
import { camPartSetup, cutMoves, geoOf, rectPath, tool6 } from './fixtures/camSetup';

type AnyMove = NonNullable<ReturnType<typeof profileToolpath>['toolpath']>['moves'][number];
/** Largest XY distance of the tool centre from `c` over every move below `zBelow` (lines sampled, arcs sampled along the arc). */
function maxRadius(moves: readonly AnyMove[], c: { x: number; y: number }, zBelow: number): number {
  let worst = 0;
  let prev: { x: number; y: number; z: number } | null = null;
  const at = (x: number, y: number, z: number) => { if (z < zBelow) worst = Math.max(worst, Math.hypot(x - c.x, y - c.y)); };
  for (const m of moves) {
    if (m.kind === 'cycle') continue;
    const to = m.to;
    if (prev && m.kind === 'arc') {
      const r0 = Math.hypot(prev.x - m.center.x, prev.y - m.center.y);
      const a0 = Math.atan2(prev.y - m.center.y, prev.x - m.center.x);
      let a1 = Math.atan2(to.y - m.center.y, to.x - m.center.x);
      if (m.ccw) { while (a1 <= a0 + 1e-12) a1 += 2 * Math.PI; } else { while (a1 >= a0 - 1e-12) a1 -= 2 * Math.PI; }
      for (let i = 0; i <= 64; i++) {
        const a = a0 + ((a1 - a0) * i) / 64;
        at(m.center.x + r0 * Math.cos(a), m.center.y + r0 * Math.sin(a), prev.z + ((to.z - prev.z) * i) / 64);
      }
    } else if (prev) {
      for (let i = 0; i <= 64; i++) {
        const t = i / 64;
        at(prev.x + (to.x - prev.x) * t, prev.y + (to.y - prev.y) * t, prev.z + (to.z - prev.z) * t);
      }
    } else at(to.x, to.y, to.z);
    prev = to;
  }
  return worst;
}
/**
 * A lap coordinate sits at its nominal value or up to the tolerance (0.002 mm) further away from the material,
 * in direction `dir` (+1: the value may be larger), never closer: laps are offset conservatively.
 */
function expectAway(value: number, nominal: number, dir: 1 | -1) {
  expect((value - nominal) * dir).toBeGreaterThanOrEqual(-1e-9);
  expect((value - nominal) * dir).toBeLessThanOrEqual(0.002);
}
const ccwHole = (cx: number, cy: number, r: number) => ({
  closed: true, segments: [{ kind: 'arc' as const, center: v2(cx, cy), radius: r, startAngle: 0, sweep: 2 * Math.PI }],
});

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
    expectAway(Math.max(...xs), 108, 1);
    expectAway(Math.min(...ys), 2, -1);
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
    expectAway(Math.min(...xs), 38, 1);
    expectAway(Math.max(...xs), 72, -1);
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
    expectAway(Math.max(...rough.map((m) => m.to.x)), 108.5, 1);
    const finish = cuts.filter((m) => Math.abs(m.to.z + 6.2) < 1e-9);
    expectAway(Math.max(...finish.map((m) => m.to.x)), 108, 1);
    expect(zs(cuts)).toEqual(expect.arrayContaining([-2.95, -5.9, -6.2]));
  });

  it('raises the path over tabs on levels below the tab top', () => {
    const op = profile({ tabs: { enabled: true, shape: 'rect', width: 4, height: 2, placement: 'count', count: 4, spacing: 50, manual: [] } });
    const out = profileToolpath(op, tool6, ctx, geoOf({ contours: [outline] }));
    expect(out.diagnostics).toEqual([]);
    const atTabTop = cutMoves(out.toolpath!.moves).filter((m) => Math.abs(m.to.z + 4.2) < 1e-9);
    expect(atTabTop.length).toBeGreaterThanOrEqual(8); // up + across, for each of 4 tabs on the last level
    expect(out.overlays.tabs).toHaveLength(4);
    expect(out.overlays.tabPaths).toMatchObject([{ refIndex: 0, z: -4.2 }]);
  });

  it('keys explicit tab positions to the contour index, applying to rough and finish laps alike', () => {
    const c0: ResolvedContour = { path: rectPath(5, 5, 45, 25), z: 0, ref: 0 };
    const c1: ResolvedContour = { path: rectPath(55, 5, 95, 25), z: 0, ref: 1 };
    const tabs = {
      enabled: true, shape: 'rect' as const, width: 4, height: 2, placement: 'count' as const, count: 4, spacing: 50,
      manual: [{ refIndex: 1, t: [0.5] }],
    };
    const rough = profileToolpath(profile({ tabs }), tool6, ctx, geoOf({ contours: [c0, c1] }));
    const both = profileToolpath(profile({ tabs, finishPass: true }), tool6, ctx, geoOf({ contours: [c0, c1] }));
    expect(rough.diagnostics).toEqual([]);
    expect(both.diagnostics).toEqual([]);

    // contour 1 has one manual tab; contour 0 (no manual entry) gets its automatic tabs
    expect(rough.overlays.tabs.filter((t) => t.refIndex === 1)).toHaveLength(1);
    expect(rough.overlays.tabs.filter((t) => t.refIndex === 0)).toHaveLength(4);
    expect(rough.overlays.tabPaths.map((l) => l.refIndex).sort()).toEqual([0, 1]);

    // both the roughing laps and the finish lap of contour 1 ride up over the tab (at z = tab top, -4.2); the tab's
    // rising/falling edges sit tool-width + half tab width from its centre, so search within that radius
    const tabPoint = rough.overlays.tabs.find((t) => t.refIndex === 1)!.point;
    const clipsNearTab = (o: typeof rough) =>
      cutMoves(o.toolpath!.moves).filter((m) => dist2(v2(m.to.x, m.to.y), tabPoint) < 6 && Math.abs(m.to.z + 4.2) < 1e-6).length;
    expect(clipsNearTab(rough)).toBeGreaterThan(0);
    expect(clipsNearTab(both)).toBeGreaterThan(clipsNearTab(rough));
  });

  it('keys the explicit lead start point to the contour index, leaving other contours on the automatic start', () => {
    const c0: ResolvedContour = { path: rectPath(5, 5, 45, 25), z: 0, ref: 0 };
    const c1: ResolvedContour = { path: rectPath(55, 5, 95, 25), z: 0, ref: 1 };
    const tabs = { enabled: true, shape: 'rect' as const, width: 4, height: 2, placement: 'count' as const, count: 2, spacing: 50, manual: [] };
    const auto = profileToolpath(
      profile({ tabs, leads: { mode: 'none', length: 0, startPoint: 'auto' } }), tool6, ctx, geoOf({ contours: [c0, c1] }),
    );
    const explicit = profileToolpath(
      profile({ tabs, leads: { mode: 'none', length: 0, startPoint: { refIndex: 1, t: 0.25 } } }), tool6, ctx, geoOf({ contours: [c0, c1] }),
    );
    // where the tool first goes over each contour (contour 0 lies left of x = 50, contour 1 right of it)
    const start = (o: typeof auto, refIndex: number) =>
      o.toolpath!.moves.flatMap((m) => ('to' in m ? [m.to] : [])).find((p) => (refIndex === 0 ? p.x < 50 : p.x > 50));
    expect(start(explicit, 0)).toEqual(start(auto, 0)); // contour 0 stays on the automatic start
    expect(start(explicit, 1)).not.toEqual(start(auto, 1)); // contour 1 starts at t = 0.25 instead
    // the tab path is measured from the automatic start either way: the lead start point does not move the tabs
    expect(explicit.overlays.tabs).toEqual(auto.overlays.tabs);
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

  it.each([4, 5])('keeps leads and level links inside an R%i hole profiled on the inside', (R) => {
    const hole: ResolvedContour = { path: ccwHole(55, 35, R), z: 0, ref: 0 };
    for (const entry of ['auto', 'plunge'] as const) {
      const op = profile({ side: 'inside', stepdown: 1, entry: { mode: entry, helixDiameterPct: 90, rampAngleDeg: 3 } });
      const out = profileToolpath(op, tool6, ctx, geoOf({ contours: [hole] }));
      expect(out.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(maxRadius(out.toolpath!.moves, v2(55, 35), 0)).toBeLessThanOrEqual(R - 3 + 1e-3);
    }
  });

  it('warns when a lead does not fit and is dropped', () => {
    const out = profileToolpath(profile({ side: 'inside' }), tool6, ctx, geoOf({ contours: [{ path: ccwHole(55, 35, 3.05), z: 0, ref: 0 }] }));
    expect(out.diagnostics.map((d) => d.code)).toEqual(['entry-plunge']);
    expect(maxRadius(out.toolpath!.moves, v2(55, 35), 0)).toBeLessThanOrEqual(0.05 + 1e-3);
  });

  it('keeps full-size arc leads on an outside profile of the outline', () => {
    const out = profileToolpath(profile(), tool6, ctx, geoOf({ contours: [outline] }));
    expect(out.diagnostics).toEqual([]);
    const leadArcs = cutMoves(out.toolpath!.moves).filter((m) => m.kind === 'arc' && Math.abs(Math.hypot(m.to.x - m.center.x, m.to.y - m.center.y) - 3) < 1e-6);
    expect(leadArcs.length).toBeGreaterThanOrEqual(2);
  });

  const ngon = (n: number, cx: number, cy: number, R: number) => {
    const pts = Array.from({ length: n }, (_, i) => v2(cx + R * Math.cos((2 * Math.PI * i) / n), cy + R * Math.sin((2 * Math.PI * i) / n)));
    return { closed: true, segments: pts.map((from, i) => ({ kind: 'line' as const, from, to: pts[(i + 1) % n] })) };
  };
  it.each([0.02, 0.01, 0.005])('keeps full clearance where a nearly round lap is fitted as one circle, at tolerance %s', (tolerance) => {
    // a 36-gon whose vertices sit 0.97 × tol/2 inside a circle except every 12th: its lap (after the 0.875 × tol
    // margin) is fitted as one circle; the circle must not bulge more than tol/2 beyond the lap's chords
    const rho = 2.59 * (tolerance / 0.02); // linear: the lap's sagitta scales with the tolerance
    const lap = Array.from({ length: 36 }, (_, k) => {
      const a = (2 * Math.PI * k) / 36;
      const rr = k % 12 === 4 ? rho : rho - 0.97 * (tolerance / 2);
      return v2(55 + rr * Math.cos(a), 35 + rr * Math.sin(a));
    });
    const contour = miterOffset(lap, 3 + 0.875 * tolerance);
    const path = { closed: true, segments: contour.map((from, i) => ({ kind: 'line' as const, from, to: contour[(i + 1) % contour.length] })) };
    const out = profileToolpath(profile({ side: 'inside', leads: { mode: 'none', length: 0, startPoint: 'auto' } }), tool6, { ...ctx, tolerance },
      geoOf({ contours: [{ path, z: 0, ref: 0 }] }));
    expect(minContourDistance(out.toolpath!.moves, contour, 0.005)).toBeGreaterThanOrEqual(3 - 1e-3);
  });

  for (const side of ['outside', 'inside'] as const) {
    for (const [name, path] of [['a 12-gon', ngon(12, 55, 35, 20)], ['a sparse 40-gon', ngon(40, 55, 35, 20)], ['a round hole', ccwHole(55, 35, 20)]] as const) {
      it.each([0.002, 0.01, 0.02])(`keeps full clearance from ${name} profiled ${side}, arc interiors included, at tolerance %s`, (tolerance) => {
        const wall = flattenPath(path, 1e-4);
        for (const stockRadial of [0, 0.5]) {
          const out = profileToolpath(profile({ side, stockRadial }), tool6, { ...ctx, tolerance }, geoOf({ contours: [{ path, z: 0, ref: 0 }] }));
          expect(minContourDistance(out.toolpath!.moves, wall), `stock ${stockRadial}`).toBeGreaterThanOrEqual(3 + stockRadial - 1e-3);
        }
        const finished = profileToolpath(profile({ side, stockRadial: 0.5, finishPass: true }), tool6, { ...ctx, tolerance },
          geoOf({ contours: [{ path, z: 0, ref: 0 }] }));
        expect(minContourDistance(finished.toolpath!.moves, wall), 'finish pass').toBeGreaterThanOrEqual(3 - 1e-3);
      }, 30_000);
    }
  }
});

/** Outward offset of a convex counter-clockwise polygon by `d` with mitred (sharp) corners. */
function miterOffset(pts: { x: number; y: number }[], d: number): { x: number; y: number }[] {
  const n = pts.length;
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
    return { p: v2(a.x + (dy / l) * d, a.y - (dx / l) * d), d: v2(dx, dy) };
  });
  return lines.map((l1, i) => {
    const l0 = lines[(i - 1 + n) % n];
    const den = l0.d.x * l1.d.y - l0.d.y * l1.d.x;
    const t = ((l1.p.x - l0.p.x) * l1.d.y - (l1.p.y - l0.p.y) * l1.d.x) / den;
    return v2(l0.p.x + l0.d.x * t, l0.p.y + l0.d.y * t);
  });
}

/**
 * Smallest XY distance from the tool centre to the closed polyline `wall` over every move below Z 0 (lines and
 * arc interiors sampled every 0.02 mm).
 */
function minContourDistance(moves: readonly AnyMove[], wall: { x: number; y: number }[], step = 0.02): number {
  const segDist = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
  };
  let worst = Infinity;
  const at = (x: number, y: number, z: number) => {
    if (z >= 0) return;
    let d = Infinity;
    for (let i = 0; i < wall.length; i++) d = Math.min(d, segDist({ x, y }, wall[i], wall[(i + 1) % wall.length]));
    worst = Math.min(worst, d);
  };
  let prev: { x: number; y: number; z: number } | null = null;
  for (const m of moves) {
    if (m.kind === 'cycle') continue;
    const to = m.to;
    if (prev && m.kind === 'arc') {
      const r0 = Math.hypot(prev.x - m.center.x, prev.y - m.center.y);
      const a0 = Math.atan2(prev.y - m.center.y, prev.x - m.center.x);
      let a1 = Math.atan2(to.y - m.center.y, to.x - m.center.x);
      if (m.ccw) { while (a1 <= a0 + 1e-12) a1 += 2 * Math.PI; } else { while (a1 >= a0 - 1e-12) a1 -= 2 * Math.PI; }
      const n = Math.max(1, Math.ceil((Math.abs(a1 - a0) * r0) / step));
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        at(m.center.x + r0 * Math.cos(a), m.center.y + r0 * Math.sin(a), prev.z + ((to.z - prev.z) * i) / n);
      }
    } else if (prev) {
      const n = Math.max(1, Math.ceil(Math.hypot(to.x - prev.x, to.y - prev.y) / step));
      for (let i = 0; i <= n; i++) at(prev.x + ((to.x - prev.x) * i) / n, prev.y + ((to.y - prev.y) * i) / n, prev.z + ((to.z - prev.z) * i) / n);
    } else at(to.x, to.y, to.z);
    prev = to;
  }
  return worst;
}
