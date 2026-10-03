import { describe, expect, it } from 'vitest';
import { applyCommands, camContext, createJob, FontStore, type Job, PipelineCache, programContext, runPipeline, setStock } from '../src';
import { faceAt, plateSetup, tool6 } from './fixtures/camSetup';
import { testFontBytes } from './fixtures/testFont';

const vbit = { ...tool6, id: 'v60', number: 7, type: 'vbit' as const, tipAngleDeg: 60, cornerRadius: 0 };

async function signJob(textPatch: object, opType: 'vcarve' | 'engrave' | 'pocket' | 'profile' | 'drill' = 'vcarve', fontBlobs: Record<string, Uint8Array> = {}) {
  let job: Job = setStock(createJob(), { mode: 'fixed', size: { x: 200, y: 100, z: 18 }, modelOffset: { x: 0, y: 0, z: 0 } });
  job = applyCommands(job, [
    { type: 'addText', id: 't', patch: { text: 'SPON', size: 30, ...textPatch } },
    { type: 'addTool', tool: vbit },
    { type: 'addOperation', opType, toolId: 'v60', id: 'o' },
    { type: 'updateOperation', id: 'o', patch: { geometry: [{ kind: 'text', textId: 't' }] } },
  ]);
  const fonts = new FontStore();
  await fonts.ensure(job, fontBlobs);
  const { run, toolpaths } = runPipeline(job, null, programContext(job, null), new PipelineCache(), { date: '2026-01-01' }, fonts);
  return { job, fonts, run, toolpaths, ctx: camContext(job, null, fonts) };
}

describe('text as geometry', () => {
  it('V-carves a sign on fixed stock with no model', async () => {
    const { run, toolpaths } = await signJob({});
    expect(run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(toolpaths).toHaveLength(1);
    expect(run.texts[0]).toMatchObject({ textId: 't', diagnostics: [], z: 0 });
    expect(run.texts[0].loops.length).toBeGreaterThan(4);   // S, P, O + counter, N
  });

  it('keeps its place on the part when the work origin moves', async () => {
    const a = await signJob({});
    const job = applyCommands(a.job, [{ type: 'setWcs', patch: { anchor: { x: 'max', y: 'max', z: 'top' } } }]);
    const b = runPipeline(job, null, programContext(job, null), new PipelineCache(), { date: '2026-01-01' }, a.fonts);
    const minX = (r: typeof b.run) => Math.min(...r.texts[0].loops.flatMap((l) => l.points.map((p) => p.x)));
    expect(minX(a.run) - minX(b.run)).toBeCloseTo(200, 6);   // program X shifted by the stock width, text unmoved on the stock
  });

  it('engraves Hershey text and refuses single-line text elsewhere', async () => {
    const eng = await signJob({ font: { kind: 'bundled', id: 'hersheySans' } }, 'engrave');
    expect(eng.toolpaths).toHaveLength(1);
    const pocket = await signJob({ font: { kind: 'bundled', id: 'hersheySans' } }, 'pocket');
    expect(pocket.run.results[0].diagnostics).toContainEqual(expect.objectContaining({ code: 'text-single-line', message: 'Text 1 uses a single-line font; this operation needs closed outlines', ref: 0 }));
    const drill = await signJob({}, 'drill');
    expect(drill.run.results[0].diagnostics).toContainEqual(expect.objectContaining({ code: 'wrong-geometry' }));
  });

  it('reports text problems on the text and on the operation', async () => {
    const empty = await signJob({ text: ' ' });
    expect(empty.run.texts[0].diagnostics).toContainEqual(expect.objectContaining({ code: 'text-empty', message: 'Text 1 has no text' }));
    expect(empty.run.results[0].diagnostics).toContainEqual(expect.objectContaining({ code: 'text-empty', ref: 0 }));
    const arc = await signJob({ arc: { radius: 10, side: 'outside' } });
    expect(arc.run.texts[0].diagnostics[0]).toMatchObject({ code: 'text-arc', message: 'The arc radius of Text 1 is smaller than its text' });
    const fit = await signJob({ fit: { width: 1, height: null } });
    expect(fit.run.texts[0].diagnostics[0]).toMatchObject({ code: 'text-fit', message: "Text 1 doesn't fit its box" });
    const glyphs = await signJob({ text: 'SPON😀' });
    expect(glyphs.run.texts[0].diagnostics).toEqual([expect.objectContaining({ severity: 'warning', code: 'text-missing-glyphs', message: 'Inter has no glyph for: 😀' })]);
  });

  it('survives a text whose characters are all missing', async () => {
    const { run } = await signJob({ text: '😀' });
    expect(run.texts[0].diagnostics).toEqual([expect.objectContaining({ code: 'text-missing-glyphs' })]);
    expect(run.results[0].diagnostics.some((d) => d.code === 'internal')).toBe(false);
  });

  it('reports a missing font file, and clears it when the bytes arrive (no stale cache)', async () => {
    const fontRef = { kind: 'file', blobId: 'f1', name: 'TestSans.otf' } as const;
    const a = await signJob({ text: 'HO', font: fontRef });
    expect(a.run.texts[0].diagnostics[0]).toMatchObject({ code: 'font-missing', message: 'The font file for Text 1 is missing' });
    const cache = new PipelineCache();
    runPipeline(a.job, null, programContext(a.job, null), cache, {}, a.fonts);
    await a.fonts.ensure(a.job, { f1: testFontBytes() });
    const b = runPipeline(a.job, null, programContext(a.job, null), cache, {}, a.fonts);
    expect(b.run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(b.toolpaths).toHaveLength(1);
  });

  it('needs a fixed stock without a model', async () => {
    const job = applyCommands(createJob(), [{ type: 'addText', id: 't' }]);
    const fonts = new FontStore();
    await fonts.ensure(job, {});
    const { run } = runPipeline(job, null, programContext(job, null), new PipelineCache(), {}, fonts);
    expect(run.texts[0].diagnostics).toContainEqual(expect.objectContaining({ code: 'text-no-stock', message: 'Text without a model needs a fixed stock size' }));
  });

  it('sits on a picked model face', async () => {
    // plateSetup(): auto stock with no Z margin, so program Z 0 is the plate top
    const { job: base, geometry } = plateSetup();
    const mesh = geometry as typeof geometry & { kind: 'mesh' };
    const p = mesh.mesh.positions;
    let zTop = -Infinity, xMin = Infinity, yMin = Infinity;
    for (let i = 0; i < p.length; i += 3) { zTop = Math.max(zTop, p[i + 2]); xMin = Math.min(xMin, p[i]); yMin = Math.min(yMin, p[i + 1]); }
    const face = faceAt(mesh, xMin + 1, yMin + 1, zTop);
    const job = applyCommands(base, [
      { type: 'addText', id: 't', patch: { text: 'HI', size: 5, surface: { from: 'face', face } } },
      { type: 'addTool', tool: vbit },
      { type: 'addOperation', opType: 'vcarve', toolId: 'v60', id: 'o' },
      { type: 'updateOperation', id: 'o', patch: { geometry: [{ kind: 'text', textId: 't' }] } },
    ]);
    const fonts = new FontStore();
    await fonts.ensure(job, {});
    const { run, toolpaths } = runPipeline(job, geometry, programContext(job, geometry as never), new PipelineCache(), {}, fonts);
    expect(run.texts[0].z).toBeCloseTo(camContext(job, geometry, fonts).model!.max.z, 6);
    expect(run.texts[0].z).toBeCloseTo(0, 6);
    expect(toolpaths).toHaveLength(1);
  });

  it('cuts text that runs off the stock edge without crashing', async () => {
    const { run, toolpaths } = await signJob({ position: { x: 190, y: 50 }, size: 40 });
    expect(toolpaths).toHaveLength(1);
    expect(run.results[0].diagnostics.every((d) => d.code !== 'internal')).toBe(true);
  });

  it('posts an engraving of SPON in Hershey Sans (golden G-code)', async () => {
    let job: Job = setStock(createJob(), { mode: 'fixed', size: { x: 100, y: 50, z: 10 }, modelOffset: { x: 0, y: 0, z: 0 } });
    job = applyCommands(job, [
      { type: 'addText', id: 't', patch: { text: 'SPON', size: 20, font: { kind: 'bundled', id: 'hersheySans' } } },
      { type: 'addTool', tool: vbit },
      { type: 'addOperation', opType: 'engrave', toolId: 'v60', id: 'o' },
      { type: 'updateOperation', id: 'o', patch: { geometry: [{ kind: 'text', textId: 't' }], depthMode: 'depth', depth: 0.3 } },
    ]);
    const fonts = new FontStore();
    await fonts.ensure(job, {});
    const { run } = runPipeline(job, null, programContext(job, null), new PipelineCache(), { date: '2026-01-01' }, fonts);
    expect(run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    await expect(run.files[0].text).toMatchFileSnapshot('./fixtures/text-engrave-spon.nc');
  });
});
