import { describe, expect, it } from 'vitest';
import { camContext, createJob, flattenPath, newOperation, pathFromPoints, setStock, vplugToolpath, type Path2D, type VPlugOp } from '../src';
import { cutMoves, geoOf, rectPath, tool6 } from './fixtures/camSetup';
import { drawingJob } from './fixtures/vcarveSetup';

const v60 = { ...tool6, id: 'v60', number: 7, type: 'vbit' as const, tipAngleDeg: 60, cornerRadius: 0, fluteLength: 20 };
const t = Math.tan(Math.PI / 6);
const D = 4, S = 2, g = 0.5, H = D - g + S, R = S * t;

const bounds = (poly: { x: number; y: number }[]) => ({
  x0: Math.min(...poly.map((p) => p.x)), x1: Math.max(...poly.map((p) => p.x)),
  y0: Math.min(...poly.map((p) => p.y)), y1: Math.max(...poly.map((p) => p.y)),
});

describe('V-carve plug', () => {
  it('cuts a rectangle plug: deepest point H, walls from D − g at the outline', () => {
    const { tp, diagnostics, program, cam } = drawingJob([rectPath(0, 0, 40, 20)], 'vplug', { inlayDepth: D, startDepth: S, glueGap: g }, v60);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const top = cam.stock!.max.z; // auto stock: the drawing top
    const moves = cutMoves(tp!.moves);
    const zs = moves.map((m) => m.to.z);
    expect(Math.min(...zs)).toBeCloseTo(top - H, 6);
    expect(Math.max(...zs)).toBeLessThanOrEqual(top - (D - g) + 1e-6);
    // every cutting point lies outside the rectangle, within R of it (walls) or on the H loop
    const { x0, x1, y0, y1 } = bounds(flattenPath(program(0), 0.001));
    for (const m of moves) {
      const dx = Math.max(x0 - m.to.x, 0, m.to.x - x1), dy = Math.max(y0 - m.to.y, 0, m.to.y - y1);
      const d = Math.hypot(dx, dy);
      expect(d).toBeLessThanOrEqual(R + 0.02);
      // depth follows the distance: top − (D − g) − d/t, clamped at H
      expect(m.to.z).toBeCloseTo(top - Math.min(H, D - g + d / t), 1);
    }
  });

  it('reports a wrong tool, a bad glue gap, a short bit and a missing clearing', () => {
    const flat = drawingJob([rectPath(0, 0, 40, 20)], 'vplug', {}, tool6);
    expect(flat.diagnostics).toContainEqual(expect.objectContaining({ code: 'wrong-tool', message: 'Inlays need a V-bit' }));
    const gap = drawingJob([rectPath(0, 0, 40, 20)], 'vplug', { inlayDepth: 2, glueGap: 2 }, v60);
    expect(gap.diagnostics).toContainEqual(expect.objectContaining({ code: 'inlay-settings', message: 'The glue gap must be smaller than the inlay depth' }));
    const short = drawingJob([rectPath(0, 0, 40, 20)], 'vplug', {}, { ...v60, fluteLength: 3 });
    expect(short.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'flute-exceeded', message: 'The plug needs 5.50 mm of V-bit; its cutting length is 3.00 mm' }));
    expect(short.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'vcarve-uncleared' }));
  });

  it('refuses a plug board thinner than H', () => {
    const stock = { mode: 'fixed' as const, size: { x: 80, y: 40, z: 5 }, modelOffset: { x: 10, y: 10, z: 0 } }; // z = 5 < H = 5.5
    const { tp, diagnostics } = drawingJob([rectPath(0, 0, 40, 20)], 'vplug', { inlayDepth: D, startDepth: S, glueGap: g }, v60, stock);
    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'plug-board-thin', message: 'The plug board is thinner than the plug (5.50 mm)' }));
    expect(tp).toBeUndefined();
  });

  it('cuts between two close shapes at the right depth (medial strokes outside M)', () => {
    const { tp, program, cam } = drawingJob([rectPath(0, 0, 10, 10), rectPath(11, 0, 21, 10)], 'vplug', { inlayDepth: D, startDepth: S, glueGap: g }, v60);
    const top = cam.stock!.max.z;
    const a = bounds(flattenPath(program(0), 0.001)), b = bounds(flattenPath(program(1), 0.001));
    const gapMid = (a.x1 + b.x0) / 2;
    const inGap = cutMoves(tp!.moves).filter((m) => Math.abs(m.to.x - gapMid) < 0.05 && m.to.y > a.y0 + 0.5 && m.to.y < a.y1 - 0.5);
    expect(inGap.length).toBeGreaterThan(0);
    for (const m of inGap) expect(m.to.z).toBeCloseTo(top - (D - g) - 0.5 / t, 1); // 0.5 mm from both shapes
  });

  const polyPath = (pts: [number, number][]): Path2D => pathFromPoints(pts.map(([x, y]) => ({ x, y })), true);
  const segDist = (p: { x: number; y: number }, polys: { x: number; y: number }[][]) => {
    let best = Infinity;
    for (const poly of polys) for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const u = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy));
    }
    return best;
  };
  const insideRect = (p: { x: number; y: number }, r: ReturnType<typeof bounds>, eps: number) => p.x > r.x0 + eps && p.x < r.x1 - eps && p.y > r.y0 + eps && p.y < r.y1 - eps;
  const settings = { inlayDepth: D, startDepth: S, glueGap: g };

  it('an L-shape: depth follows the distance to M, and the reflex corner is reached at D - g', () => {
    const L = polyPath([[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]]);
    const { tp, program, cam } = drawingJob([L], 'vplug', settings, v60);
    const top = cam.stock!.max.z;
    const loop = flattenPath(program(0), 0.001);
    const b = bounds(loop);
    const moves = cutMoves(tp!.moves);
    for (const m of moves) expect(Math.abs(m.to.z - (top - (D - g) - Math.min(segDist(m.to, [loop]), R) / t))).toBeLessThan(0.02);
    const corner = { x: b.x0 + 4, y: b.y0 + 4 };
    const near = moves.filter((m) => Math.hypot(m.to.x - corner.x, m.to.y - corner.y) < 0.05);
    expect(near.length).toBeGreaterThan(0);
    expect(Math.abs(Math.max(...near.map((m) => m.to.z)) - (top - (D - g)))).toBeLessThan(0.01);
  });

  it('a ring: the hole side gets an inward loop at H, and nothing cuts the ring material', () => {
    // a square hole: its medial axis does not trace the loop, so the loop at H comes from M + R alone
    const { tp, program, cam } = drawingJob([rectPath(0, 0, 30, 30), rectPath(10, 10, 20, 20)], 'vplug', settings, v60);
    const top = cam.stock!.max.z;
    const outer = bounds(flattenPath(program(0), 0.001)), hole = bounds(flattenPath(program(1), 0.001));
    const c = cutMoves(tp!.moves);
    for (const m of c) {
      expect(insideRect(m.to, outer, 0.02) && !insideRect(m.to, { x0: hole.x0 - 0.02, x1: hole.x1 + 0.02, y0: hole.y0 - 0.02, y1: hole.y1 + 0.02 }, 0)).toBe(false);
    }
    const inHole = c.filter((m) => insideRect(m.to, hole, 0.001));
    const loop = inHole.filter((m) => Math.abs(m.to.z - (top - H)) < 1e-6 && Math.abs(Math.min(m.to.x - hole.x0, hole.x1 - m.to.x, m.to.y - hole.y0, hole.y1 - m.to.y) - R) < 0.02);
    expect(loop.length).toBeGreaterThan(8);
    // and every cut inside the hole follows the distance to the hole edge
    for (const m of inHole) expect(Math.abs(m.to.z - (top - (D - g) - Math.min(Math.min(m.to.x - hole.x0, hole.x1 - m.to.x, m.to.y - hole.y0, hole.y1 - m.to.y), R) / t))).toBeLessThan(0.02);
  });

  it('overlapping shapes are one M: nothing cuts inside their union', () => {
    const { tp, program } = drawingJob([rectPath(0, 0, 10, 10), rectPath(5, 5, 15, 15)], 'vplug', settings, v60);
    const a = bounds(flattenPath(program(0), 0.001)), b = bounds(flattenPath(program(1), 0.001));
    const moves = cutMoves(tp!.moves);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(insideRect(m.to, a, 0.02)).toBe(false);
      expect(insideRect(m.to, b, 0.02)).toBe(false);
    }
  });

  it('steps down: no pass cuts below its level and the last pass reaches H', () => {
    const { tp, cam } = drawingJob([rectPath(0, 0, 40, 20)], 'vplug', { ...settings, stepdown: 1 }, v60);
    const top = cam.stock!.max.z;
    const depths = cutMoves(tp!.moves).map((m) => top - m.to.z);
    expect(Math.max(...depths)).toBeCloseTo(H, 6);
    // a point deeper than k mm only occurs after an earlier pass has cut at exactly k mm (its clamped level)
    const levels = new Set<number>();
    for (const d of depths) {
      for (let k = 1; k < d - 1e-6; k++) expect(levels.has(k)).toBe(true);
      const k = Math.round(d);
      if (Math.abs(d - k) < 1e-6) levels.add(k);
    }
    expect(depths.some((d) => Math.abs(d - 1) < 1e-6)).toBe(true);
  });

  it('refuses non-positive settings (as a loaded file could hold them)', () => {
    const ctx = camContext(setStock(createJob(), { mode: 'fixed', size: { x: 100, y: 100, z: 20 }, modelOffset: { x: 0, y: 0, z: 0 } }), null);
    const op = newOperation('vplug', { id: 'p', name: 'Plug', tool: v60, modelKind: 'drawing' }) as VPlugOp;
    const geo = geoOf({ shapes: [{ shape: { outer: rectPath(0, 0, 10, 10), islands: [] }, z: 0, ref: 0 }] });
    for (const patch of [{ inlayDepth: 0 }, { startDepth: -1 }, { glueGap: Number.NaN }, { glueGap: 0 }]) {
      const r = vplugToolpath({ ...op, ...patch }, v60, ctx, geo);
      expect(r.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'inlay-settings', message: 'Set the inlay depth, start depth and glue gap to positive values' }));
      expect(r.toolpath).toBeNull();
    }
  });

  it('warns when the shapes are at different heights', () => {
    const ctx = camContext(setStock(createJob(), { mode: 'fixed', size: { x: 100, y: 100, z: 20 }, modelOffset: { x: 0, y: 0, z: 0 } }), null);
    const op = newOperation('vplug', { id: 'p', name: 'Plug', tool: v60, modelKind: 'drawing' }) as VPlugOp;
    const shape = (x: number) => ({ outer: rectPath(x, 0, x + 10, 10), islands: [] });
    const run = (z2: number) => vplugToolpath(op, v60, ctx, geoOf({ shapes: [{ shape: shape(0), z: 0, ref: 0 }, { shape: shape(20), z: z2, ref: 1 }] }));
    expect(run(-1).diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'wrong-geometry', message: "The plug's shapes are at different heights; all are cut at the first one's height" }));
    expect(run(0).diagnostics.filter((d) => d.code === 'wrong-geometry')).toEqual([]);
  });
});
