import { describe, expect, it } from 'vitest';
import {
  applyCommands, camContext, createJob, setStock, type Job, type JobCommand, type Move, type Path2D, pathFromPoints, PipelineCache, programContext, runPipeline, type Tool, type Toolpath,
} from '../src';
import { tool6 } from './fixtures/camSetup';
import { terracedSetup } from './fixtures/slotSetup';
import { rectPts } from './fixtures/terraced.mjs';
import { drawingJob } from './fixtures/vcarveSetup';

const vbit90: Tool = { ...tool6, id: 'v90', number: 8, type: 'vbit', tipAngleDeg: 90, cornerRadius: 0, fluteLength: 6 };
const rect = (w: number, h: number): Path2D => pathFromPoints([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], true);
type Feed = Exclude<Move, { kind: 'cycle' } | { kind: 'rapid' }>;

/** V-carve 'o' (maxDepth 3, 90 degree bit) with a 6 mm flat clearing 'c' placed before it. */
function setup(extra: JobCommand[] = [], clearPatch: Record<string, unknown> = {}, carvePatch: Record<string, unknown> = { maxDepth: 3 }) {
  const paths = [rect(40, 20)];
  const base = drawingJob(paths, 'vcarve', carvePatch, vbit90);
  let job = applyCommands(base.job, [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'vclear', toolId: 't6', id: 'c' },
    { type: 'updateOperation', id: 'c', patch: { sourceId: 'o', ...clearPatch } as never },
    { type: 'moveOperation', id: 'c', delta: -1 },
    ...extra,
  ]);
  const { run, toolpaths } = runPipeline(job, base.geometry as never, programContext(job, base.geometry as never), new PipelineCache(), { date: '2026-01-01' });
  const res = (id: string) => run.results.find((r) => r.operationId === id)!;
  const tp = (id: string) => toolpaths.find((t) => t.operationId === id) as Toolpath | undefined;
  return { job, base, res, tp, program: base.program(0), cam: camContext(job, base.geometry) };
}
const errs = (r: { diagnostics: { severity: string; message: string }[] }) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
const bounds = (p: Path2D) => {
  const xs = p.segments.flatMap((s) => ('from' in s ? [s.from.x] : [])), ys = p.segments.flatMap((s) => ('from' in s ? [s.from.y] : []));
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
const topOf = (s: ReturnType<typeof setup>) => s.res('o').heights!.top;
const floorPts = (tp: Toolpath, z: number) => tp.moves.filter((m): m is Feed => m.kind === 'line' || m.kind === 'arc').filter((m) => Math.abs(m.to.z - z) < 1e-6).map((m) => m.to);

describe('V-carve clearing', () => {
  it('clears the 3 mm inset floor at top - 3 with the tool inside it', () => {
    const s = setup();
    expect(errs(s.res('c'))).toEqual([]);
    expect(errs(s.res('o'))).toEqual([]);
    const tp = s.tp('c')!;
    const top = topOf(s);
    const deepest = Math.min(...tp.moves.flatMap((m) => (m.kind === 'cycle' ? [] : [m.to.z])));
    expect(deepest).toBeCloseTo(top - 3, 6);
    const b = bounds(s.program);
    const pts = floorPts(tp, top - 3);
    expect(pts.length).toBeGreaterThan(10);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(b.x0 + 6 - 0.02);
      expect(p.x).toBeLessThanOrEqual(b.x1 - 6 + 0.02);
      expect(p.y).toBeGreaterThanOrEqual(b.y0 + 6 - 0.02);
      expect(p.y).toBeLessThanOrEqual(b.y1 - 6 + 0.02);
    }
  });

  it('clears the V-carve uncleared warning', () => {
    const s = setup();
    expect(s.res('o').diagnostics.some((d) => d.code === 'vcarve-uncleared')).toBe(false);
    const alone = drawingJob([rect(40, 20)], 'vcarve', { maxDepth: 3 }, vbit90);
    expect(alone.diagnostics.some((d) => d.code === 'vcarve-uncleared')).toBe(true);
  });

  it('follows the source: a shallower max depth lowers the floor and widens the area', () => {
    const s = setup([{ type: 'updateOperation', id: 'o', patch: { maxDepth: 2 } }]);
    expect(errs(s.res('c'))).toEqual([]);
    const tp = s.tp('c')!;
    const top = topOf(s);
    const pts = floorPts(tp, top - 2);
    expect(Math.min(...tp.moves.flatMap((m) => (m.kind === 'cycle' ? [] : [m.to.z])))).toBeCloseTo(top - 2, 6);
    const b = bounds(s.program);
    expect(Math.min(...pts.map((p) => p.x))).toBeLessThan(b.x0 + 6 - 0.5);
    expect(Math.min(...pts.map((p) => p.x))).toBeGreaterThanOrEqual(b.x0 + 5 - 0.02);
  });

  it('errors when the source has no max depth', () => {
    const s = setup([{ type: 'updateOperation', id: 'o', patch: { maxDepth: null } }]);
    expect(errs(s.res('c'))).toEqual(['Set a max depth on V-carve 1 first']);
    expect(s.tp('c')).toBeUndefined();
  });

  it('errors when the source was deleted', () => {
    const s = setup([{ type: 'removeOperation', id: 'o' }]);
    expect(errs(s.res('c'))).toEqual(['The V-carve this clears was deleted']);
  });

  it('errors when the source has errors (flat tool)', () => {
    const s = setup([{ type: 'updateOperation', id: 'o', patch: { toolId: 't6' } }]);
    expect(errs(s.res('c'))).toEqual(['V-carve 1 has errors']);
  });

  it('errors for a V-bit clearing tool', () => {
    const s = setup([{ type: 'updateOperation', id: 'c', patch: { toolId: 'v90' } }]);
    expect(errs(s.res('c'))).toEqual(['Clearing needs a flat or bull-nose end mill']);
  });

  it('warns when no area reaches the max depth', () => {
    const s = setup([{ type: 'updateOperation', id: 'o', patch: { maxDepth: 15 } }]);
    const d = s.res('c').diagnostics;
    expect(d.some((x) => x.message === 'Nothing to clear: no area reaches the max depth' && x.code === 'unmachined-area')).toBe(true);
    expect(errs(s.res('c'))).toEqual([]);
    expect(s.tp('c')).toBeUndefined();
  });
});

describe('V-carve clearing cache', () => {
  const deepest = (tp?: Toolpath) => Math.min(...tp!.moves.flatMap((m) => (m.kind === 'cycle' ? [] : [m.to.z])));
  it('follows the source through a shared cache', () => {
    const s = setup();
    const cache = new PipelineCache();
    const run = (job: typeof s.job) => runPipeline(job, s.base.geometry as never, programContext(job, s.base.geometry as never), cache, { date: '2026-01-01' });
    const first = run(s.job);
    const top = topOf(s);
    expect(deepest(first.toolpaths.find((t) => t.operationId === 'c') as Toolpath)).toBeCloseTo(top - 3, 6);
    const j2 = applyCommands(s.job, [{ type: 'updateOperation', id: 'o', patch: { maxDepth: 2 } }]);
    expect(deepest(run(j2).toolpaths.find((t) => t.operationId === 'c') as Toolpath)).toBeCloseTo(top - 2, 6);
    const j3 = applyCommands(j2, [{ type: 'updateTool', id: 'v90', patch: { tipAngleDeg: 60 } }]);
    const b = bounds(s.program);
    const xs = (run(j3).toolpaths.find((t) => t.operationId === 'c') as Toolpath).moves.flatMap((m) => (m.kind === 'cycle' ? [] : [m.to.x]));
    // 60 degree tip: R = 2 tan30 = 1.155, so the area reaches closer to the wall than with 90 degrees (R = 2)
    expect(Math.min(...xs)).toBeLessThan(b.x0 + 5 - 0.02 + 1e-9);
    const j4 = applyCommands(j3, [{ type: 'removeOperation', id: 'o' }]);
    const r4 = run(j4);
    expect(r4.run.results.find((r) => r.operationId === 'c')!.diagnostics.map((d) => d.message)).toContain('The V-carve this clears was deleted');
  });
  it('re-evaluates the V-carve warning when its clearing is added or disabled', () => {
    const s = setup();
    const cache = new PipelineCache();
    const warn = (job: typeof s.job) => {
      const { run } = runPipeline(job, s.base.geometry as never, programContext(job, s.base.geometry as never), cache, { date: '2026-01-01' });
      return run.results.find((r) => r.operationId === 'o')!.diagnostics.some((d) => d.code === 'vcarve-uncleared');
    };
    const without = applyCommands(s.job, [{ type: 'removeOperation', id: 'c' }]);
    expect(warn(without)).toBe(true);
    expect(warn(s.job)).toBe(false);
    expect(warn(applyCommands(s.job, [{ type: 'setOperationEnabled', id: 'c', enabled: false }]))).toBe(true);
  });
});

describe('V-carve clearing: review fixes', () => {
  it('a source V-bit without a tip angle gives a clear error and no toolpath', () => {
    const s = setup();
    const job = applyCommands(s.job, [{ type: 'updateTool', id: 'v90', patch: { tipAngleDeg: 0 } }]);
    const { run, toolpaths } = runPipeline(job, s.base.geometry as never, programContext(job, s.base.geometry as never), new PipelineCache(), { date: '2026-01-01' });
    expect(errs(run.results.find((r) => r.operationId === 'c')!)).toEqual([`${s.job.operations.find((o) => o.id === 'o')!.name} has errors`]);
    expect(toolpaths.find((t) => t.operationId === 'c')).toBeUndefined();
  });

  it('keeps the V-carve top reference, so a face-referenced top still clears', () => {
    const m = terracedSetup(rectPts(0, 0, 100, 60), 10, [{ poly: rectPts(20, 20, 50, 40), z: 7 }]);
    const face = m.catalog().faces.find((f) => Math.abs(f.z) < 1e-6)!;
    expect(face).toBeTruthy();
    const job = applyCommands(m.job, [
      { type: 'addTool', tool: vbit90 },
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'vcarve', toolId: 'v90', id: 'o' },
      { type: 'updateOperation', id: 'o', patch: { geometry: [face.ref], maxDepth: 2 } as never },
    ] as JobCommand[]);
    // keep the default heights, change only the top
    const withTop = applyCommands(job, [
      { type: 'updateOperation', id: 'o', patch: { heights: { ...job.operations[0].heights, top: { from: 'face', offset: 0, face: face.ref } } } as never },
      { type: 'addOperation', opType: 'vclear', toolId: 't6', id: 'c' },
      { type: 'updateOperation', id: 'c', patch: { sourceId: 'o' } as never },
    ] as JobCommand[]);
    const { run, toolpaths } = runPipeline(withTop, m.geometry as never, programContext(withTop, m.geometry as never), new PipelineCache(), { date: '2026-01-01' });
    const rc = run.results.find((r) => r.operationId === 'c')!;
    expect(errs(rc)).toEqual([]);
    const tp = toolpaths.find((t) => t.operationId === 'c') as Toolpath;
    expect(tp).toBeTruthy();
    const top = run.results.find((r) => r.operationId === 'o')!.heights!.top;
    expect(Math.min(...tp.moves.flatMap((mv) => (mv.kind === 'cycle' ? [] : [mv.to.z])))).toBeCloseTo(top - 2, 6);
  });

  it('a ring: the island inside the counter is never cleared', () => {
    const circle = (r: number): Path2D => ({ segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: r, startAngle: 0, sweep: 2 * Math.PI }], closed: true });
    const base = drawingJob([circle(30), circle(10)], 'vcarve', { maxDepth: 3 }, vbit90);
    const job = applyCommands(base.job, [
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'vclear', toolId: 't6', id: 'c' },
      { type: 'updateOperation', id: 'c', patch: { sourceId: 'o' } as never },
    ]);
    const { run, toolpaths } = runPipeline(job, base.geometry as never, programContext(job, base.geometry as never), new PipelineCache(), { date: '2026-01-01' });
    expect(errs(run.results.find((r) => r.operationId === 'c')!)).toEqual([]);
    const tp = toolpaths.find((t) => t.operationId === 'c') as Toolpath;
    const c = (base.program(0).segments[0] as unknown as { center: { x: number; y: number } }).center;
    // floor ring is r 13..27 (R = 3); the 3 mm radius tool centre stays within 16..24
    let n = 0;
    for (const mv of tp.moves) {
      if (mv.kind === 'cycle' || mv.kind === 'rapid' || mv.to.z > -2.99) continue;
      n++;
      const r = Math.hypot(mv.to.x - c.x, mv.to.y - c.y);
      expect(r).toBeGreaterThanOrEqual(16 - 0.02);
      expect(r).toBeLessThanOrEqual(24 + 0.02);
    }
    expect(n).toBeGreaterThan(10);
  });
});

describe('V-carve clearing of a plug', () => {
  const t = Math.tan(Math.PI / 6);
  const D = 4, S = 2, g = 0.5, H = D - g + S, R = S * t;
  const v60: Tool = { ...tool6, id: 'v60', number: 7, type: 'vbit', tipAngleDeg: 60, cornerRadius: 0, fluteLength: 20 };
  const stock = { mode: 'fixed' as const, size: { x: 80, y: 60, z: 8 }, modelOffset: { x: 20, y: 20, z: 0 } };
  function plugSetup(extra: JobCommand[] = []) {
    const base = drawingJob([rect(40, 20)], 'vplug', { inlayDepth: D, startDepth: S, glueGap: g }, v60, stock);
    const job = applyCommands(base.job, [
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'vclear', toolId: 't6', id: 'c' },
      { type: 'updateOperation', id: 'c', patch: { sourceId: 'o' } as never },
      ...extra,
    ]);
    const run = (j: typeof job, cache = new PipelineCache()) => runPipeline(j, base.geometry as never, programContext(j, base.geometry as never), cache, { date: '2026-01-01' });
    const { run: r, toolpaths } = run(job);
    return { base, job, run, res: (id: string) => r.results.find((x) => x.operationId === id)!, tp: toolpaths.find((x) => x.operationId === 'c') as Toolpath | undefined };
  }
  const cutPts = (tp: Toolpath) => tp.moves.filter((m): m is Feed => m.kind === 'line' || m.kind === 'arc').map((m) => m.to);

  it('clears the floor outside the M + R loop at top - H, reaching the stock edges', () => {
    const s = plugSetup();
    expect(errs(s.res('c'))).toEqual([]);
    expect(errs(s.res('o'))).toEqual([]);
    expect(s.res('o').diagnostics.some((d) => d.code === 'vcarve-uncleared')).toBe(false);
    const tp = s.tp!;
    const top = s.res('o').heights!.top;
    expect(Math.min(...tp.moves.flatMap((m) => (m.kind === 'cycle' ? [] : [m.to.z])))).toBeCloseTo(top - H, 6);
    const b = bounds(s.base.program(0));
    const pts = cutPts(tp);
    const r = 3; // tool6 radius
    for (const p of pts) {
      const d = Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.y0 - p.y, 0, p.y - b.y1));
      expect(d).toBeGreaterThanOrEqual(R + r - 0.01);
    }
    const box = camContext(s.job, s.base.geometry).stock!;
    expect(Math.min(...pts.map((p) => p.x)) - box.min.x).toBeLessThanOrEqual(r + 0.05);
    expect(box.max.x - Math.max(...pts.map((p) => p.x))).toBeLessThanOrEqual(r + 0.05);
    expect(Math.min(...pts.map((p) => p.y)) - box.min.y).toBeLessThanOrEqual(r + 0.05);
    expect(box.max.y - Math.max(...pts.map((p) => p.y))).toBeLessThanOrEqual(r + 0.05);
  });

  it("a rectangle plug's floor is all reached by the clearing: the V-bit adds no passes (not even at the board's own corners)", () => {
    const s = plugSetup();
    const b = bounds(s.base.program(0));
    const tp = s.run(s.job).toolpaths.find((x) => x.operationId === 'o') as Toolpath;
    for (const p of cutPts(tp)) {
      const d = Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.y0 - p.y, 0, p.y - b.y1));
      expect(d).toBeLessThanOrEqual(R + 0.02);
    }
  });

  it('follows the plug through a shared cache', () => {
    const s = plugSetup();
    const cache = new PipelineCache();
    const lowest = (j: typeof s.job) => Math.min(...(s.run(j, cache).toolpaths.find((x) => x.operationId === 'c') as Toolpath).moves.flatMap((m) => (m.kind === 'cycle' ? [] : [m.to.z])));
    const a = lowest(s.job);
    const b = lowest(applyCommands(s.job, [{ type: 'updateOperation', id: 'o', patch: { startDepth: 3 } }]));
    expect(a - b).toBeCloseTo(1, 6);
  });

  it('errors when the plug has errors', () => {
    const s = plugSetup([{ type: 'updateOperation', id: 'o', patch: { glueGap: 9 } }]);
    expect(errs(s.res('c'))).toEqual(['V-carve plug 1 has errors']);
    expect(s.tp).toBeUndefined();
  });

  it('errors when the plug board is thinner than the plug (the plug reports it too)', () => {
    const thin = { ...stock, size: { x: 80, y: 60, z: 4 } };
    const base = drawingJob([rect(40, 20)], 'vplug', { inlayDepth: D, startDepth: S, glueGap: g }, v60, thin);
    const job = applyCommands(base.job, [
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'vclear', toolId: 't6', id: 'c' },
      { type: 'updateOperation', id: 'c', patch: { sourceId: 'o' } as never },
    ]);
    const { run, toolpaths } = runPipeline(job, base.geometry as never, programContext(job, base.geometry as never), new PipelineCache(), { date: '2026-01-01' });
    const res = (id: string) => run.results.find((r) => r.operationId === id)!;
    expect(res('o').diagnostics).toContainEqual(expect.objectContaining({ code: 'plug-board-thin' }));
    expect(errs(res('c'))).toEqual(['V-carve plug 1 has errors']);
    expect(toolpaths.find((x) => x.operationId === 'c')).toBeUndefined();
  });

  it('clears inside a wide ring hole as well as outside', () => {
    const circle = (r: number, cx: number, cy: number): Path2D => ({ segments: [{ kind: 'arc', center: { x: cx, y: cy }, radius: r, startAngle: 0, sweep: 2 * Math.PI }], closed: true });
    const big = { ...stock, size: { x: 100, y: 100, z: 8 }, modelOffset: { x: 50, y: 50, z: 0 } };
    const base = drawingJob([circle(30, 0, 0), circle(15, 0, 0)], 'vplug', { inlayDepth: D, startDepth: S, glueGap: g }, v60, big);
    const job = applyCommands(base.job, [
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'vclear', toolId: 't6', id: 'c' },
      { type: 'updateOperation', id: 'c', patch: { sourceId: 'o' } as never },
    ]);
    const { run, toolpaths } = runPipeline(job, base.geometry as never, programContext(job, base.geometry as never), new PipelineCache(), { date: '2026-01-01' });
    expect(errs(run.results.find((r) => r.operationId === 'c')!)).toEqual([]);
    const tp = toolpaths.find((x) => x.operationId === 'c') as Toolpath;
    const top = run.results.find((r) => r.operationId === 'o')!.heights!.top;
    const c = (base.program(0).segments[0] as unknown as { center: { x: number; y: number } }).center;
    const rad = (p: { x: number; y: number }) => Math.hypot(p.x - c.x, p.y - c.y);
    const pts = cutPts(tp);
    const floor = pts.filter((p) => Math.abs(p.z - (top - H)) < 1e-6);
    expect(floor.filter((p) => rad(p) < 15).length).toBeGreaterThan(5); // inside the hole
    for (const p of pts) {
      const d = rad(p) <= 22.5 ? 15 - rad(p) : rad(p) - 30; // distance to the ring material (hole side or outer side)
      if (rad(p) < 15 || rad(p) > 30) expect(d).toBeGreaterThanOrEqual(R + 3 - 0.01);
    }
  });

  function holeSetup(extra: JobCommand[] = []) {
    const square = (x0: number, y0: number, w: number): Path2D => pathFromPoints([{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + w }, { x: x0, y: y0 + w }], true);
    const base = drawingJob([square(0, 0, 30), square(11.5, 11.5, 7)], 'vplug', { inlayDepth: D, startDepth: S, glueGap: g }, v60, stock);
    const job = applyCommands(base.job, [
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'vclear', toolId: 't6', id: 'c' },
      { type: 'updateOperation', id: 'c', patch: { sourceId: 'o' } as never },
      ...extra,
    ]);
    const { run, toolpaths } = runPipeline(job, base.geometry as never, programContext(job, base.geometry as never), new PipelineCache(), { date: '2026-01-01' });
    return { base, run, toolpaths, c: run.results.find((r) => r.operationId === 'c')! };
  }

  it("a floor area the tool does not fit in is cleaned by the plug's V-bit, so the clearing reports nothing about it", () => {
    const { base, run, toolpaths, c } = holeSetup();
    expect(errs(c)).toEqual([]);
    expect(c.diagnostics.map((d) => d.message).join('|')).not.toMatch(/does not fit|cannot reach/);
    expect(c.overlays.unmachined).toEqual([]);
    expect(toolpaths.find((x) => x.operationId === 'c')).toBeDefined();
    // the 7 mm hole leaves a 4.69 mm floor: the plug cuts it at H with passes farther than R from the hole's walls
    const top = run.results.find((r) => r.operationId === 'o')!.heights!.top;
    const hole = bounds(base.program(1));
    const inner = cutPts(toolpaths.find((x) => x.operationId === 'o') as Toolpath).filter((p) => Math.abs(p.z - (top - H)) < 1e-6
      && p.x > hole.x0 + R + 0.5 && p.x < hole.x1 - R - 0.5 && p.y > hole.y0 + R + 0.5 && p.y < hole.y1 - R - 0.5);
    expect(inner.length).toBeGreaterThan(0);
  });

  it('the same area is an error when the plug is disabled, since nothing cleans it', () => {
    const { c } = holeSetup([{ type: 'setOperationEnabled', id: 'o', enabled: false }]);
    expect(errs(c)).toEqual(['The tool does not fit in 1 area(s) of the floor, so the plug will not fit; choose a smaller clearing tool']);
  });

  it('a plug floor narrower than the tool everywhere is an error that says what to do', () => {
    const tight = { ...stock, size: { x: 44, y: 24, z: 8 }, modelOffset: { x: 2, y: 2, z: 0 } };
    const base = drawingJob([rect(40, 20)], 'vplug', { inlayDepth: D, startDepth: S, glueGap: g }, v60, tight);
    const job = applyCommands(base.job, [
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'vclear', toolId: 't6', id: 'c' },
      { type: 'updateOperation', id: 'c', patch: { sourceId: 'o' } as never },
    ]);
    const { run } = runPipeline(job, base.geometry as never, programContext(job, base.geometry as never), new PipelineCache(), { date: '2026-01-01' });
    expect(errs(run.results.find((r) => r.operationId === 'c')!)).toEqual(['The clearing tool is wider than the pocket floor; choose a smaller one, or a smaller inlay depth']);
  });

  it('reports no-stock when there is no model, leaving the plug alone', () => {
    let job = setStock(createJob(), { mode: 'auto', margin: { xy: 20, zTop: 0, zBottom: 40 } });
    job = applyCommands(job, [
      { type: 'addTool', tool: v60 },
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'vplug', toolId: 'v60', id: 'o' },
      { type: 'addOperation', opType: 'vclear', toolId: 't6', id: 'c' },
      { type: 'updateOperation', id: 'c', patch: { sourceId: 'o' } as never },
    ]);
    const { run, toolpaths } = runPipeline(job, null as never, programContext(job, null as never), new PipelineCache(), { date: '2026-01-01' });
    const c = run.results.find((r) => r.operationId === 'c')!;
    expect(c.diagnostics.map((d) => d.code)).toEqual(['no-stock']);
    expect(toolpaths.find((x) => x.operationId === 'c')).toBeUndefined();
    expect(run.results.find((r) => r.operationId === 'o')!.diagnostics.map((d) => d.code)).not.toContain('no-stock');
  });
});

describe('V-carve clearing of an inlay pocket (the V-bit cleans the floor the clearing tool cannot reach)', () => {
  const inlay = { startDepth: 2, glueGap: 0.5, margin: 10, plugBoard: { x: 80, y: 40, z: 6 }, plugFileName: 'p.spon' };
  const at = (x0: number, y0: number, w: number, h: number): Path2D => pathFromPoints([{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }], true);
  /** V-carve 'o' (90 degree bit, max depth 3) over `paths`, cleared by 'c' with `tool`. */
  function run(paths: Path2D[], carve: Record<string, unknown>, tool: Tool = tool6) {
    const base = drawingJob(paths, 'vcarve', { maxDepth: 3, ...carve }, vbit90);
    const job = applyCommands(base.job, [
      { type: 'addTool', tool },
      { type: 'addOperation', opType: 'vclear', toolId: tool.id, id: 'c' },
      { type: 'updateOperation', id: 'c', patch: { sourceId: 'o' } as never },
    ]);
    const { run: r, toolpaths } = runPipeline(job, base.geometry as never, programContext(job, base.geometry as never), new PipelineCache(), { date: '2026-01-01' });
    const res = (id: string) => r.results.find((x) => x.operationId === id)!;
    return { job, base, res, tp: (id: string) => toolpaths.find((t) => t.operationId === id) as Toolpath | undefined };
  }
  const flat3: Tool = { ...tool6, id: 't3', number: 3, name: '3 mm flat', diameter: 3 };

  it('a decorative V-carve keeps the warning for a floor area the tool does not fit in; with inlay settings the V-bit cuts it', () => {
    // the 8 mm square's floor is 2 x 2 mm (inset 3 mm): too small for the 6 mm tool
    const paths = [at(0, 0, 40, 20), at(50, 0, 8, 8)];
    const deco = run(paths, {});
    expect(deco.res('c').diagnostics.map((d) => d.message)).toContain('The tool does not fit in 1 area(s) of the floor');
    const inl = run(paths, { inlay });
    expect(errs(inl.res('c'))).toEqual([]);
    expect(inl.res('c').diagnostics.map((d) => d.message).join('|')).not.toMatch(/does not fit|cannot reach/);
    // passes at max depth strictly inside the small floor (the decorative V-carve only runs its boundary loop there)
    const sq = bounds(inl.base.program(1));
    const inside = (s: ReturnType<typeof run>) => floorPts(s.tp('o')!, s.res('o').heights!.top - 3).filter((p) => p.x > sq.x0 + 3.3 && p.x < sq.x1 - 3.3 && p.y > sq.y0 + 3.3 && p.y < sq.y1 - 3.3);
    expect(inside(deco)).toEqual([]);
    expect(inside(inl).length).toBeGreaterThan(0);
  });

  it('an inlay pocket gets corner passes that depend on the clearing tool; a decorative one does not', () => {
    const paths = [at(0, 0, 40, 20)];
    const moves = (carve: Record<string, unknown>, tool: Tool) => JSON.stringify(run(paths, carve, tool).tp('o')!.moves);
    expect(moves({}, flat3)).toBe(moves({}, tool6));
    expect(moves({ inlay }, flat3)).not.toBe(moves({ inlay }, tool6));
    expect(moves({ inlay }, tool6).length).toBeGreaterThan(moves({}, tool6).length);
  });

  it('the V-carve follows its clearing tool through a shared cache', () => {
    const s = run([at(0, 0, 40, 20)], { inlay });
    const cache = new PipelineCache();
    const go = (j: Job) => JSON.stringify((runPipeline(j, s.base.geometry as never, programContext(j, s.base.geometry as never), cache, { date: '2026-01-01' }).toolpaths.find((t) => t.operationId === 'o') as Toolpath).moves);
    const a = go(s.job);
    const b = go(applyCommands(s.job, [{ type: 'addTool', tool: flat3 }, { type: 'updateOperation', id: 'c', patch: { toolId: 't3' } }]));
    expect(b).not.toBe(a);
  });

  it('an inlay floor narrower than the tool everywhere is an error that says what to do; a decorative one keeps the generic error', () => {
    const paths = [at(0, 0, 10, 10)]; // the floor is 4 x 4 mm
    expect(errs(run(paths, { inlay }).res('c'))).toEqual(['The clearing tool is wider than the pocket floor; choose a smaller one, or a smaller inlay depth']);
    expect(errs(run(paths, {}).res('c'))).toEqual(['The tool does not fit in this pocket']);
  });
});
