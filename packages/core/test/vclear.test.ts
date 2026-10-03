import { describe, expect, it } from 'vitest';
import {
  applyCommands, camContext, type JobCommand, type Move, type Path2D, pathFromPoints, PipelineCache, programContext, runPipeline, type Tool, type Toolpath,
} from '../src';
import { tool6 } from './fixtures/camSetup';
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
