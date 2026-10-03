import { describe, expect, it } from 'vitest';
import {
  applyCommands, camContext, type JobCommand, type Move, type Path2D, pathFromPoints, PipelineCache, programContext, runPipeline, type Tool, type Toolpath,
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
