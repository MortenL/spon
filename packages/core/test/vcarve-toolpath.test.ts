import { describe, expect, it } from 'vitest';
import {
  applyCommands, differencePolys, flattenPath, type JobCommand, type Move, offsetPolys, type Path2D, pathFromPoints, PipelineCache, programContext, runPipeline,
  outlineDistance, polysArea, type Tool, type Toolpath, type Vec2,
} from '../src';
import { tool6 } from './fixtures/camSetup';
import { terracedSetup, uncovered } from './fixtures/slotSetup';
import { rectPts } from './fixtures/terraced.mjs';
import { drawingJob, polysOf, vSwept } from './fixtures/vcarveSetup';
import { expectWithin } from './fixtures/perf';

const vbit90: Tool = { ...tool6, id: 'v90', number: 8, type: 'vbit', tipAngleDeg: 90, cornerRadius: 0, fluteLength: 6 };
const tanHalf = 1; // 90 degrees
const rectPath = (w: number, h: number, x = 0) => pathFromPoints([{ x, y: 0 }, { x: x + w, y: 0 }, { x: x + w, y: h }, { x, y: h }], true);
const circlePath = (r: number): Path2D => ({ segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: r, startAngle: 0, sweep: 2 * Math.PI }], closed: true });
const errors = (d: { severity: string; message: string }[]) => d.filter((x) => x.severity === 'error').map((x) => x.message);
type Feed = Exclude<Move, { kind: 'cycle' }>;
const feeds = (tp: Toolpath) => tp.moves.filter((m): m is Feed => m.kind !== 'rapid' && m.kind !== 'cycle');
const startOf = (p: Path2D) => (p.segments[0] as { from: Vec2 }).from;

describe('vSwept', () => {
  it('keeps a radius peak in the middle of a collinear run', () => {
    const tp = { moves: [{ kind: 'rapid', to: { x: 0, y: 0, z: 0 } }, { kind: 'line', to: { x: 0.5, y: 0, z: -0.5 }, feed: 1 }, { kind: 'line', to: { x: 1, y: 0, z: 0 }, feed: 1 }] } as unknown as Toolpath;
    expect(polysArea(vSwept(tp, 0, 1))).toBeGreaterThanOrEqual(Math.PI * 0.5 * 0.5 * 0.9);
  });
});

describe('V-carve overcut', () => {
  for (const scale of [1, 4]) {
    it(`a T-shape x${scale}: the groove never exceeds the true clearance by more than 2s`, () => {
      const k = scale;
      const T = pathFromPoints([[8, 0], [12, 0], [12, 30], [20, 30], [20, 35], [0, 35], [0, 30], [8, 30]].map(([x, y]) => ({ x: x * k, y: y * k })), true);
      const r = drawingJob([T], 'vcarve', {}, { ...vbit90, fluteLength: 100 });
      expect(errors(r.diagnostics)).toEqual([]);
      const outline = [flattenPath(r.program(0), 0.001)];
      const dist = outlineDistance(outline, 1);
      let worst = -Infinity, n = 0;
      for (const m of feeds(r.tp!)) {
        const d = -m.to.z;
        if (d <= 0) continue;
        n++;
        worst = Math.max(worst, d * tanHalf - dist(m.to.x, m.to.y));
      }
      console.log(`T-shape x${scale}: ${n} points, max overcut ${worst.toFixed(4)} mm`);
      expect(n).toBeGreaterThan(100);
      expect(worst).toBeLessThanOrEqual(0.08);
    });
  }
});

describe('V-carve toolpaths', () => {
  it('a 40 x 10 rectangle: deepest at half width, inside the outline, covering it', () => {
    const r = drawingJob([rectPath(40, 10)], 'vcarve', {}, vbit90);
    expect(errors(r.diagnostics)).toEqual([]);
    const top = 0;
    expect(Math.min(...r.tp!.moves.map((m) => (m.kind === 'cycle' ? 0 : m.to.z)))).toBeCloseTo(top - 5, 1);
    const target = polysOf([r.program(0)]);
    const sw = vSwept(r.tp!, top, tanHalf);
    expect(uncovered(sw, offsetPolys(target, 0.08, 0.005))).toBeLessThan(1e-3);
    expect(uncovered(offsetPolys(target, -0.12, 0.005), sw)).toBeLessThan(1e-2);
  });

  it('a ring: never cuts into the hole', () => {
    const r = drawingJob([circlePath(10), circlePath(5)], 'vcarve', {}, vbit90);
    expect(errors(r.diagnostics)).toEqual([]);
    const outer = polysOf([r.program(0)]), inner = polysOf([r.program(1)]);
    const c = (r.program(1).segments[0] as { center: Vec2 }).center;
    for (const m of feeds(r.tp!)) expect(Math.hypot(m.to.x - c.x, m.to.y - c.y)).toBeGreaterThan(5 - 0.01);
    const ring = differencePolys(outer, inner);
    const sw = vSwept(r.tp!, 0, tanHalf);
    expect(uncovered(sw, offsetPolys(ring, 0.08, 0.005))).toBeLessThan(1e-3);
    expect(uncovered(offsetPolys(ring, -0.12, 0.005), sw)).toBeLessThan(1e-2);
  });

  it('max depth: nothing deeper, loops at max depth along the inset, warning without clearing', () => {
    const r = drawingJob([rectPath(40, 20)], 'vcarve', { maxDepth: 3 }, vbit90);
    expect(Math.min(...feeds(r.tp!).map((m) => m.to.z))).toBeGreaterThanOrEqual(-3 - 1e-9);
    const o = startOf(r.program(0));
    const flat = feeds(r.tp!).filter((m) => Math.abs(m.to.z + 3) < 1e-9).map((m) => ({ x: m.to.x - o.x, y: m.to.y - o.y }));
    // the loop runs along the inset: straight sides are single moves, so check its four corners rather than a point count
    for (const c of [[3, 3], [37, 3], [37, 17], [3, 17]]) expect(flat.some((p) => Math.hypot(p.x - c[0], p.y - c[1]) < 0.02)).toBe(true);
    for (const p of flat) expect(Math.min(p.x - 3, 37 - p.x, p.y - 3, 17 - p.y)).toBeGreaterThan(-0.02);
    expect(r.diagnostics.map((d) => d.message)).toContain('Wide areas stop at the max depth; add a clearing operation');
  });

  it('max depth deeper than the shape needs changes nothing', () => {
    const a = drawingJob([rectPath(40, 10)], 'vcarve', {}, vbit90), b = drawingJob([rectPath(40, 10)], 'vcarve', { maxDepth: 8 }, vbit90);
    expect(b.tp!.moves).toEqual(a.tp!.moves);
    expect(b.diagnostics.map((d) => d.code)).not.toContain('vcarve-uncleared');
  });

  it('stepdown: depth levels are reached in turn; a stepdown deeper than the cut changes nothing', () => {
    const r = drawingJob([rectPath(40, 10)], 'vcarve', { stepdown: 1 }, vbit90);
    expect(errors(r.diagnostics)).toEqual([]);
    const zs = feeds(r.tp!).map((m) => m.to.z);
    for (const k of [1, 2, 3, 4, 5]) expect(zs.some((z) => Math.abs(z + k) < 1e-9)).toBe(true);
    expect(Math.min(...zs)).toBeCloseTo(-5, 4);
    // pass k never goes below -k, and the next pass starts only after pass k reached it
    let level = 1;
    for (const z of zs) {
      expect(z).toBeGreaterThanOrEqual(-level - 1e-4);
      if (z <= -level + 1e-4 && level < 5) level++;
    }
    const a = drawingJob([rectPath(40, 10)], 'vcarve', { maxDepth: 1 }, vbit90), b = drawingJob([rectPath(40, 10)], 'vcarve', { maxDepth: 1, stepdown: 3 }, vbit90);
    expect(b.tp!.moves).toEqual(a.tp!.moves);
  });

  it('warns past the flute length', () => {
    const r = drawingJob([rectPath(40, 20)], 'vcarve', {}, vbit90);
    expect(r.diagnostics.map((d) => d.message)).toContain("V-carve depth reaches 10.00 mm, beyond the bit's 6.00 mm cutting length");
  });

  it('errors: wrong tool, open outlines', () => {
    const a = drawingJob([rectPath(40, 10)], 'vcarve', {}, tool6);
    expect(errors(a.diagnostics)).toContain('V-carve needs a V-bit');
    expect(a.tp).toBeUndefined();
    const b = drawingJob([pathFromPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }], false)], 'vcarve', {}, vbit90);
    expect(errors(b.diagnostics)).toContain('V-carve needs closed outlines');
  });

  it('separate letters: lifts only between strokes', () => {
    const r = drawingJob([rectPath(10, 10), rectPath(10, 10, 20)], 'vcarve', {}, vbit90);
    expect(errors(r.diagnostics)).toEqual([]);
    const x0 = startOf(r.program(0)).x, x1 = startOf(r.program(1)).x;
    expect(x1 - x0).toBeCloseTo(20, 6);
    const moves = r.tp!.moves;
    // every sideways rapid starts from the surface or above: the tool is lifted before it travels
    let crossings = 0;
    moves.forEach((m, i) => {
      const prev = moves[i - 1];
      if (m.kind !== 'rapid' || !prev || prev.kind === 'cycle') return;
      if (Math.hypot(m.to.x - prev.to.x, m.to.y - prev.to.y) > 1e-9) {
        expect(prev.to.z).toBeGreaterThanOrEqual(-1e-9);
        if (prev.to.x < x0 + 10.5 && m.to.x > x1 - 0.5) crossings++;
      }
    });
    expect(crossings).toBeGreaterThanOrEqual(1);
    // no cut lands in the gap between the letters
    for (const m of feeds(r.tp!)) expect(m.to.x < x0 + 10 + 1e-6 || m.to.x > x1 - 1e-6).toBe(true);
  });

  it('a 300 mm word generates quickly', () => {
    const letters = Array.from({ length: 10 }, (_, i) => rectPath(24, 40, i * 30));
    const t0 = performance.now();
    const r = drawingJob(letters, 'vcarve', { maxDepth: 4 }, vbit90);
    const ms = performance.now() - t0;
    console.log(`300 mm word: ${ms.toFixed(0)} ms`);
    expect(r.tp).toBeTruthy();
    expectWithin(ms, 5000);
  });

  it('text recessed in a model top face, with an island', () => {
    const s = terracedSetup(rectPts(0, 0, 100, 60), 10, [{ poly: rectPts(20, 20, 50, 40), z: 7 }, { poly: rectPts(30, 27, 40, 33), z: 10 }]);
    const top = s.catalog().faces.find((f) => Math.abs(f.z) < 1e-6 && f.loops.length > 1)!;
    expect(top).toBeTruthy();
    const job = applyCommands(s.job, [
      { type: 'addTool', tool: vbit90 },
      { type: 'addOperation', opType: 'vcarve', toolId: 'v90', id: 'v' },
      { type: 'updateOperation', id: 'v', patch: { geometry: [top.ref], maxDepth: 3 } as never },
    ] as JobCommand[]);
    const { run, toolpaths } = runPipeline(job, s.geometry as never, programContext(job, s.geometry as never), new PipelineCache(), { date: '2026-01-01' });
    expect(errors(run.results[0].diagnostics)).toEqual([]);
    const tp = toolpaths[0] as Toolpath;
    expect(tp).toBeTruthy();
    // program coordinates sit 5 mm in from the raw part (auto stock margin)
    const ox = 5, oy = 5;
    const cuts = feeds(tp);
    expect(cuts.length).toBeGreaterThan(10);
    for (const m of cuts) {
      const inside = m.to.x > 30 + ox + 1e-6 && m.to.x < 40 + ox - 1e-6 && m.to.y > 27 + oy + 1e-6 && m.to.y < 33 + oy - 1e-6;
      if (inside) expect(m.to.z).toBeGreaterThanOrEqual(-0.01);
    }
    // the groove does cut next to the island
    expect(Math.min(...cuts.map((m) => m.to.z))).toBeLessThan(-0.5);
  });
});

const cBand = () => {
  const pts: Vec2[] = [];
  for (let a = 0; a <= 270; a += 3) pts.push({ x: 20 * Math.cos((a * Math.PI) / 180), y: 20 * Math.sin((a * Math.PI) / 180) });
  for (let a = 270; a >= 0; a -= 3) pts.push({ x: 14 * Math.cos((a * Math.PI) / 180), y: 14 * Math.sin((a * Math.PI) / 180) });
  return pathFromPoints(pts, true);
};

describe('V-carve at a coarse tolerance', () => {
  for (const tol of [0.5, 1]) {
    it(`a C-shaped band at tolerance ${tol}: sampled along every move the cone stays inside the walls`, () => {
      const base = drawingJob([cBand()], 'vcarve', {}, { ...vbit90, fluteLength: 100 });
      const job = applyCommands(base.job, [{ type: 'setTolerance', tolerance: tol }]);
      const { run, toolpaths } = runPipeline(job, base.geometry as never, programContext(job, base.geometry as never), new PipelineCache(), { date: '2026-01-01' });
      expect(errors(run.results[0].diagnostics)).toEqual([]);
      const tp = toolpaths[0] as Toolpath;
      const dist = outlineDistance([flattenPath(base.program(0), 0.001)], 1);
      let worst = -Infinity, n = 0, prev: { x: number; y: number; z: number } | null = null;
      for (const m of tp.moves) {
        if (m.kind === 'cycle') { prev = null; continue; }
        if (m.kind !== 'rapid' && prev) {
          for (let k = 0; k <= 10; k++) {
            const t = k / 10, x = prev.x + (m.to.x - prev.x) * t, y = prev.y + (m.to.y - prev.y) * t, z = prev.z + (m.to.z - prev.z) * t;
            if (z < 0) { n++; worst = Math.max(worst, -z * tanHalf - dist(x, y)); }
          }
        }
        prev = m.to;
      }
      expect(n).toBeGreaterThan(100);
      expect(worst).toBeLessThanOrEqual(tol / 4 + 0.01);
    });
  }
});

describe('V-carve tip angle and surface-level shapes', () => {
  it.each([0, 180, Number.NaN])('a V-bit with tip angle %s is refused with a diagnostic and no G-code', (angle) => {
    const r = drawingJob([rectPath(40, 10)], 'vcarve', {}, { ...vbit90, tipAngleDeg: angle });
    expect(errors(r.diagnostics)).toEqual(['The tool needs a tip angle between 0 and 180 degrees']);
    expect(r.tp).toBeUndefined();
  });

  it.each([null, 1])('a shape whose deepest point is at the surface cuts nothing (stepdown %s)', (stepdown) => {
    // a degenerate sliver: a bit with max depth 0 would be refused elsewhere, so use a sliver thinner than the sampling noise
    const r = drawingJob([rectPath(40, 1e-7)], 'vcarve', { stepdown }, vbit90);
    expect(r.tp).toBeUndefined();
  });
});
