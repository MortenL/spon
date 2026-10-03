import { describe, expect, it } from 'vitest';
import {
  applyCommands, camContext, createJob, FontStore, type Job, PipelineCache, programContext, resolveGeometry, resolveText, runPipeline, setStock, type Move,
} from '../src';
import { flattenPath } from '../src/geometry/offset/pathOps';
import { pointInPolys } from '../src/geometry/offset/clipper';
import { tool6 } from './fixtures/camSetup';

const vbit = { ...tool6, id: 'v60', number: 7, type: 'vbit' as const, tipAngleDeg: 60, cornerRadius: 0 };
const bold = { kind: 'bundled', id: 'sansBold' } as const;

async function run(job: Job, cache = new PipelineCache()) {
  const fonts = new FontStore();
  await fonts.ensure(job, {});
  return { fonts, ...runPipeline(job, null, programContext(job, null), cache, { date: '2026-01-01' }, fonts) };
}
const stocked = () => setStock(createJob(), { mode: 'fixed', size: { x: 200, y: 100, z: 18 }, modelOffset: { x: 0, y: 0, z: 0 } });
const xs = (moves: Move[]) => moves.flatMap((m) => ('to' in m ? [m.to.x] : []));

describe('V-carve clearing follows its source text', () => {
  it('moves the clearing when the text moves (shared cache)', async () => {
    let job = applyCommands(stocked(), [
      { type: 'addText', id: 't', patch: { text: 'O', size: 30, font: bold, position: { x: 100, y: 50 } } },
      { type: 'addTool', tool: vbit },
      { type: 'addTool', tool: { ...tool6, id: 'flat', number: 1, diameter: 1 } },
      { type: 'addOperation', opType: 'vcarve', toolId: 'v60', id: 'v' },
      { type: 'updateOperation', id: 'v', patch: { geometry: [{ kind: 'text', textId: 't' }], maxDepth: 4 } },
      { type: 'addOperation', opType: 'vclear', toolId: 'flat', id: 'c' },
      { type: 'updateOperation', id: 'c', patch: { sourceId: 'v' } },
    ]);
    const cache = new PipelineCache();
    const a = await run(job, cache);
    const clearing = (r: typeof a) => r.toolpaths.find((t) => t.operationId === 'c')!;
    expect(a.run.results.flatMap((r) => r.diagnostics).filter((d) => d.severity === 'error')).toEqual([]);
    expect(clearing(a)).toBeTruthy();
    const ax = xs(clearing(a).moves);
    job = applyCommands(job, [{ type: 'updateText', id: 't', patch: { position: { x: 40, y: 50 } } }]);
    const b = await run(job, cache);
    expect(Math.max(...xs(clearing(b).moves))).toBeLessThan(Math.min(...ax));
  });
});

describe('profile on outline text', () => {
  const profileOn = async (side: 'outside' | 'inside') => {
    const job = applyCommands(stocked(), [
      { type: 'addText', id: 't', patch: { text: 'O', size: 40, font: bold, position: { x: 100, y: 50 } } },
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'profile', toolId: tool6.id, id: 'p' },
      { type: 'updateOperation', id: 'p', patch: { geometry: [{ kind: 'text', textId: 't' }], side } },
    ]);
    const r = await run(job);
    expect(r.run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const ctx = camContext(job, null, r.fonts);
    const ink = resolveText(job.texts[0], ctx).shapes.flatMap((s) => [s.outer, ...s.islands]).map((p) => flattenPath(p, 0.01));
    const pts = r.toolpaths[0].moves.flatMap((m) => (m.kind === 'line' || m.kind === 'arc' ? [{ x: m.to.x, y: m.to.y }] : []));
    return { ink, pts };
  };
  it('outside: no tool centre lies in the ink, counters included', async () => {
    const { ink, pts } = await profileOn('outside');
    expect(pts.length).toBeGreaterThan(100);
    expect(pts.filter((p) => pointInPolys(p, ink))).toEqual([]);
  });
  it('inside: every tool centre lies in the ink', async () => {
    const { ink, pts } = await profileOn('inside');
    expect(pts.length).toBeGreaterThan(100);
    expect(pts.filter((p) => !pointInPolys(p, ink))).toEqual([]);
  });
});

describe('text contour kinds and stock', () => {
  it('outline engraving resolves outer and inner contours', async () => {
    const job = applyCommands(stocked(), [
      { type: 'addText', id: 't', patch: { text: 'O', size: 40, font: bold } },
      { type: 'addTool', tool: vbit },
      { type: 'addOperation', opType: 'engrave', toolId: 'v60', id: 'e' },
      { type: 'updateOperation', id: 'e', patch: { geometry: [{ kind: 'text', textId: 't' }] } },
    ]);
    const fonts = new FontStore();
    await fonts.ensure(job, {});
    const geo = resolveGeometry(job.operations[0], camContext(job, null, fonts));
    expect(geo.contours.map((c) => c.kind)).toEqual(['outer', 'inner']);
  });
  it('an operation on text without model or fixed stock reports text-no-stock', async () => {
    const job = applyCommands(createJob(), [
      { type: 'addText', id: 't', patch: { text: 'O', font: bold } },
      { type: 'addTool', tool: vbit },
      { type: 'addOperation', opType: 'vcarve', toolId: 'v60', id: 'o' },
      { type: 'updateOperation', id: 'o', patch: { geometry: [{ kind: 'text', textId: 't' }] } },
    ]);
    const r = await run(job);
    expect(r.run.results[0].diagnostics).toContainEqual(expect.objectContaining({ code: 'text-no-stock' }));
  });
});
