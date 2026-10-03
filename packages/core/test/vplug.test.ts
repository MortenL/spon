import { describe, expect, it } from 'vitest';
import { flattenPath } from '../src';
import { cutMoves, rectPath, tool6 } from './fixtures/camSetup';
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
});
