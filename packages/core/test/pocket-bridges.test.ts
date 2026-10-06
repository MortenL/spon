import { describe, expect, it } from 'vitest';
import {
  applyCommand, bridgeZones, camContext, flattenPath, MAX_BRIDGE, type Move, newOperation, type Path2D, pathFromPoints, type PocketOp, pocketToolpath,
  type ResolvedShape, type TabSettings, type TabZone, v2, type Vec2,
} from '../src';
import { camPartSetup, geoOf, rectPath, tool6 } from './fixtures/camSetup';

const { job, geometry } = camPartSetup();
const ctx = camContext(applyCommand(job, { type: 'addTool', tool: tool6 }), geometry);
const R = tool6.diameter / 2;
/** The stock is 6 mm thick: Z 0 to -6. "Through" pockets end 0.2 mm below it. */
const BOTTOM = -6.2;
const TAB_TOP = BOTTOM + 2;

const pocket = (tabs: Partial<TabSettings> | null, patch: Partial<PocketOp> = {}): PocketOp => {
  const base = newOperation('pocket', { id: 'k', name: 'Pocket', tool: tool6, modelKind: 'drawing' }) as PocketOp;
  return {
    ...base,
    heights: { ...base.heights, bottom: { from: 'stockBottom', offset: -0.2 } },
    ...patch,
    tabs: { ...base.tabs, ...(tabs ? { enabled: true, ...tabs } : {}) },
  };
};
const shape = (outer: Path2D, islands: Path2D[], ref = 0): ResolvedShape => ({ shape: { outer, islands }, z: 0, ref });
const run = (op: PocketOp, shapes: ResolvedShape[]) => pocketToolpath(op, tool6, ctx, geoOf({ shapes }));

/** Distance from `p` to the segment a–b. */
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}
/** Distance from `p` to a closed polyline's edges. */
const edgeDist = (p: Vec2, poly: readonly Vec2[]) => Math.min(...poly.map((a, i) => segDist(p, a, poly[(i + 1) % poly.length])));
function inside(p: Vec2, poly: readonly Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Points along every move (lines every 0.1 mm, arcs every 2°), with Z. */
function samples(moves: readonly Move[]): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  let prev: { x: number; y: number; z: number } | null = null;
  for (const m of moves) {
    if (m.kind === 'cycle') continue;
    const to = m.to;
    if (prev && m.kind === 'arc') {
      const a0 = Math.atan2(prev.y - m.center.y, prev.x - m.center.x);
      let a1 = Math.atan2(to.y - m.center.y, to.x - m.center.x);
      const rad = Math.hypot(prev.x - m.center.x, prev.y - m.center.y);
      if (m.ccw) { while (a1 <= a0 + 1e-12) a1 += 2 * Math.PI; } else { while (a1 >= a0 - 1e-12) a1 -= 2 * Math.PI; }
      const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 90)));
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        out.push({ x: m.center.x + rad * Math.cos(a), y: m.center.y + rad * Math.sin(a), z: prev.z + ((to.z - prev.z) * i) / n });
      }
    } else if (prev) {
      const len = Math.hypot(to.x - prev.x, to.y - prev.y, to.z - prev.z);
      const n = Math.max(1, Math.ceil(len / 0.1));
      for (let i = 0; i <= n; i++) out.push({ x: prev.x + ((to.x - prev.x) * i) / n, y: prev.y + ((to.y - prev.y) * i) / n, z: prev.z + ((to.z - prev.z) * i) / n });
    } else out.push(to);
    prev = to;
  }
  return out;
}

/** Points where the tool (radius R) cuts into a bridge below the tab top. */
function intoBridges(moves: readonly Move[], polys: readonly Vec2[][], top = TAB_TOP): { x: number; y: number; z: number }[] {
  return samples(moves).filter((p) => p.z < top - 1e-6 && polys.some((poly) => inside(p, poly) || edgeDist(p, poly) < R - 1e-3));
}

const outer100 = rectPath(0, 0, 100, 60);
const island20 = rectPath(40, 20, 60, 40);

describe('pocket bridges', () => {
  it('bridges an island to the outer wall', () => {
    const out = run(pocket({ count: 4 }), [shape(outer100, [island20])]);
    expect(out.diagnostics.filter((d) => d.severity !== 'warning' || d.code !== 'unmachined-area')).toEqual([]);
    const bridges = out.overlays.tabBridges;
    expect(bridges).toHaveLength(4);
    const outerPoly = flattenPath(outer100, 0.01);
    const islandPoly = flattenPath(island20, 0.01);
    for (const b of bridges) {
      expect(b.z).toBeCloseTo(TAB_TOP, 9);
      // the strip's vertices lie on the island edge or on the outer wall, both ends covered
      const onIsland = b.polygon.filter((p) => edgeDist(p, islandPoly) < 0.01);
      const onOuter = b.polygon.filter((p) => edgeDist(p, outerPoly) < 0.01);
      expect(onIsland.length).toBeGreaterThanOrEqual(2);
      expect(onOuter.length).toBeGreaterThanOrEqual(2);
      expect(onIsland.length + onOuter.length).toBe(b.polygon.length);
    }
    // one bridge per side of the island: two 40 mm long, two 20 mm long
    const lengths = bridges.map((b) => {
      const xs = b.polygon.map((p) => p.x), ys = b.polygon.map((p) => p.y);
      return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    }).sort((a, b) => a - b);
    expect(lengths.map((l) => +l.toFixed(3))).toEqual([20, 20, 40, 40]);
    expect(out.overlays.tabs).toHaveLength(4);
    expect(out.overlays.tabPaths).toHaveLength(1);
    expect(out.overlays.tabPaths[0]).toMatchObject({ refIndex: 0, closed: true });
    expect(out.overlays.tabPaths[0].z).toBeCloseTo(TAB_TOP, 9);

    const moves = out.toolpath!.moves;
    expect(Math.min(...moves.map((m) => (m.kind === 'cycle' ? 0 : m.to.z)))).toBeCloseTo(BOTTOM, 9);
    expect(intoBridges(moves, bridges.map((b) => b.polygon))).toEqual([]);
  });

  it('keeps clear of the bridges with finish passes and a ramp entry', () => {
    const op = pocket({ count: 4 }, { finishWalls: true, finishFloor: true, stockAxial: 0.3, entry: { ...pocket(null).entry, mode: 'ramp' } });
    const out = run(op, [shape(outer100, [island20])]);
    expect(out.overlays.tabBridges).toHaveLength(4);
    expect(intoBridges(out.toolpath!.moves, out.overlays.tabBridges.map((b) => b.polygon))).toEqual([]);
  });

  it('keeps clear of triangular bridges', () => {
    const out = run(pocket({ count: 4, shape: 'triangle' }), [shape(outer100, [island20])]);
    // triangles leave material only along their ridge at the tab top; the strip itself must still never be cut below the
    // ramp, so the check here is that nothing below the triangle's foot (the pass level) enters the strip
    expect(out.overlays.tabBridges).toHaveLength(4);
    const cuts = samples(out.toolpath!.moves).filter((p) => Math.abs(p.z - BOTTOM) < 1e-6);
    const polys = out.overlays.tabBridges.map((b) => b.polygon);
    expect(cuts.filter((p) => polys.some((poly) => inside(p, poly) || edgeDist(p, poly) < R - 1e-3))).toEqual([]);
  });

  it('stops a bridge at a nearer island', () => {
    const outer = rectPath(0, 0, 120, 60);
    const left = rectPath(30, 20, 50, 40), right = rectPath(70, 20, 90, 40);
    // the middle of the left island's right-hand side (CCW from (30, 20): bottom, right, top, left; 80 mm round)
    const out = run(pocket({ manual: [{ refIndex: 0, t: [0.375] }, { refIndex: 1, t: [] }] }), [shape(outer, [left, right])]);
    expect(out.overlays.tabBridges).toHaveLength(1);
    const xs = out.overlays.tabBridges[0].polygon.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(50, 6);
    expect(Math.max(...xs)).toBeCloseTo(70, 6);
    expect(out.overlays.tabPaths.map((p) => p.refIndex)).toEqual([0, 1]);
  });

  it('numbers islands across shapes', () => {
    const a = shape(rectPath(0, 0, 100, 60), [rectPath(40, 20, 60, 40)], 0);
    const b = shape(rectPath(0, 100, 100, 160), [rectPath(40, 120, 60, 140)], 1);
    const out = run(pocket({ count: 2 }), [a, b]);
    expect(out.overlays.tabPaths.map((p) => p.refIndex)).toEqual([0, 1]);
    expect(out.overlays.tabs.filter((t) => t.refIndex === 1).every((t) => t.point.y > 100)).toBe(true);
  });

  it('skips bridges longer than 50 mm', () => {
    expect(MAX_BRIDGE).toBe(50);
    // 160 mm wide: the left and right bridges would be 70 mm long
    const out = run(pocket({ count: 4 }), [shape(rectPath(0, 0, 160, 60), [rectPath(70, 20, 90, 40)])]);
    const long = out.diagnostics.filter((d) => d.code === 'tab-bridge-long');
    expect(long).toHaveLength(2);
    expect(long[0]).toMatchObject({ severity: 'warning', message: 'A tab bridge would be longer than 50 mm; it was skipped' });
    expect(out.overlays.tabBridges).toHaveLength(2);
  });

  it('skips a bridge that would end on its own island, with a warning', () => {
    const c = pathFromPoints([v2(20, 20), v2(60, 20), v2(60, 30), v2(30, 30), v2(30, 50), v2(60, 50), v2(60, 60), v2(20, 60)], true);
    // (45, 30) on the top face of the lower arm: 65 mm along the 220 mm edge
    const out = run(pocket({ manual: [{ refIndex: 0, t: [65 / 220] }] }), [shape(rectPath(0, 0, 100, 80), [c], 3)]);
    expect(out.diagnostics.filter((d) => d.code === 'tab-bridge-self')).toEqual([
      { operationId: 'k', severity: 'warning', code: 'tab-bridge-self', message: 'A tab bridge would end on its own island; it was skipped', ref: 3 },
    ]);
    expect(out.overlays.tabBridges).toEqual([]);
  });

  it('reports a pocket without islands', () => {
    const plain = [shape(outer100, [])];
    const on = run(pocket({ count: 4 }), plain);
    const off = run(pocket(null), plain);
    expect(on.diagnostics.filter((d) => d.code === 'tab-no-islands')).toEqual([
      { operationId: 'k', severity: 'info', code: 'tab-no-islands', message: 'Tabs hold islands; this pocket has none' },
    ]);
    expect(off.diagnostics.some((d) => d.code === 'tab-no-islands')).toBe(false);
    expect(on.toolpath!.moves).toEqual(off.toolpath!.moves);
    expect(on.overlays.tabBridges).toEqual([]);
  });

  it('moves a helix entry out of a bridge', () => {
    // tabs off, the bottom level's helix goes in around (45.4, 11.1), radius 2.7, to the right of and below the island
    const outer = rectPath(0, 0, 60, 30), island = rectPath(25, 15, 35, 25);
    // a 10 mm wide tab in the middle of the island's right-hand side: a bridge over y 15–25 to the wall at x = 60,
    // which the tool would touch from a helix centred less than 2.7 + 3 mm below y 15
    const op = pocket({ manual: [{ refIndex: 0, t: [0.375] }], width: 10 });
    const off = run(pocket(null, { heights: op.heights }), [shape(outer, [island])]);
    const on = run(op, [shape(outer, [island])]);
    const polys = on.overlays.tabBridges.map((b) => b.polygon);
    expect(polys).toHaveLength(1);
    // without the move, the helix of the bottom level would cut the bridge
    const helixAt = (moves: readonly Move[]) => {
      const arcs = moves.filter((m): m is Extract<Move, { kind: 'arc' }> => m.kind === 'arc' && m.to.z < TAB_TOP);
      return arcs.length ? arcs[0].center : null;
    };
    const cOff = helixAt(off.toolpath!.moves)!;
    expect(cOff).not.toBeNull();
    const reach = (c: Vec2) => (inside(c, polys[0]) ? 0 : edgeDist(c, polys[0]));
    expect(reach(cOff)).toBeLessThan(2.7 + R); // the helix (radius 2.7) would cut the bridge
    const cOn = helixAt(on.toolpath!.moves)!;
    expect(cOn).not.toBeNull();
    expect(Math.hypot(cOn.x - cOff.x, cOn.y - cOff.y)).toBeGreaterThan(1e-3);
    expect(reach(cOn)).toBeGreaterThanOrEqual(2.7 + R - 1e-6);
    expect(intoBridges(on.toolpath!.moves, polys)).toEqual([]);
  });

  it('leaves the pocket unchanged above the tab top', () => {
    const shapes = [shape(outer100, [island20])];
    const on = run(pocket({ count: 4 }), shapes).toolpath!.moves;
    const off = run(pocket(null), shapes).toolpath!.moves;
    // every move up to the end of the last level at or above the tab top
    const z = (m: Move) => (m.kind === 'cycle' ? m.retract : m.to.z);
    const firstBelow = off.findIndex((m) => z(m) < TAB_TOP - 1e-9);
    const lastAbove = off.slice(0, firstBelow).map(z).lastIndexOf(Math.min(...off.slice(0, firstBelow).map(z).filter((v) => v >= TAB_TOP)));
    expect(lastAbove).toBeGreaterThan(10);
    expect(on.slice(0, lastAbove + 1)).toEqual(off.slice(0, lastAbove + 1));
  });
});

describe('bridgeZones', () => {
  const region = { outer: outer100, islands: [island20] };
  it('makes a strip from the island edge to the wall along the outward normal', () => {
    const { zones, tooLong } = bridgeZones(region, 0, [{ point: v2(50, 20), normal: v2(0, -1) }], 6, -4, 'rect');
    expect(tooLong).toBe(0);
    expect(zones).toHaveLength(1);
    const z: TabZone = zones[0];
    expect(z).toMatchObject({ top: -4, shape: 'rect' });
    const pts = flattenPath(z.polygon, 0.01);
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(47, 9);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(53, 9);
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(0, 9);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(20, 9);
  });

  it('counts strips longer than MAX_BRIDGE', () => {
    const wide = { outer: rectPath(0, 0, 200, 60), islands: [rectPath(90, 20, 110, 40)] };
    const { zones, tooLong } = bridgeZones(wide, 0, [{ point: v2(90, 30), normal: v2(-1, 0) }, { point: v2(100, 40), normal: v2(0, 1) }], 6, -4, 'rect');
    expect(tooLong).toBe(1);
    expect(zones).toHaveLength(1);
  });

  it('skips a strip that would end on its own island (a C-shaped island) and counts it', () => {
    // a C opening to the right: the top face of its lower arm looks across the notch at its own upper arm
    const c = pathFromPoints([v2(20, 20), v2(60, 20), v2(60, 30), v2(30, 30), v2(30, 50), v2(60, 50), v2(60, 60), v2(20, 60)], true);
    const r = bridgeZones({ outer: rectPath(0, 0, 100, 80), islands: [c] }, 0, [{ point: v2(45, 30), normal: v2(0, 1) }, { point: v2(40, 20), normal: v2(0, -1) }], 6, -4, 'rect');
    expect(r.selfHits).toBe(1);
    expect(r.tooLong).toBe(0);
    expect(r.zones).toHaveLength(1);
  });

  it('closes the gap to a round island', () => {
    const round: Path2D = { closed: true, segments: [{ kind: 'arc', center: v2(50, 30), radius: 5, startAngle: 0, sweep: 2 * Math.PI }] };
    const { zones } = bridgeZones({ outer: outer100, islands: [round] }, 0, [{ point: v2(50, 25), normal: v2(0, -1) }], 6, -4, 'rect');
    const pts = flattenPath(zones[0].polygon, 0.01);
    // the strip's island end follows the circle: its corners at x = 47 and 53 sit on the circle, 4 mm below its centre
    const roundPoly = flattenPath(round, 0.001);
    const near = pts.filter((p) => p.y > 10);
    expect(near.length).toBeGreaterThanOrEqual(3);
    for (const p of near) expect(edgeDist(p, roundPoly)).toBeLessThan(0.01);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(26, 2);
  });
});
