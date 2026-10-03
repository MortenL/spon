import { describe, expect, it } from 'vitest';
import {
  applyCommands, camContext, createJob, FontStore, importFile, InlayError, type Job, layoutText, makePlugJob, type MakeInlayInput, pathFromPoints, pathsToPoints,
  PipelineCache, programContext, resolveGeometry, runPipeline, setStock, type Shape, type TextPatch, type Tool, type VPlugOp, type Vec2,
} from '../src';
import { faceAt, plateSetup, tool6 } from './fixtures/camSetup';
import { testFontBytes } from './fixtures/testFont';
import { drawingJob } from './fixtures/vcarveSetup';

const v60: Tool = { ...tool6, id: 'v60', number: 7, type: 'vbit', tipAngleDeg: 60, cornerRadius: 0, fluteLength: 20 };
const input: MakeInlayInput = { inlayDepth: 4, startDepth: 2, glueGap: 0.5, margin: 10, plugFileName: 'Sign plug.spon', clearingToolId: 't6' };
const H = 5.5;
const STOCK = { mode: 'fixed' as const, size: { x: 200, y: 100, z: 18 }, modelOffset: { x: 0, y: 0, z: 0 } };

function textBase(patch: TextPatch = {}): Job {
  const job = setStock(createJob('Sign'), STOCK);
  return applyCommands(job, [
    { type: 'addText', id: 't1', patch: { text: 'SPON', size: 30, font: { kind: 'bundled', id: 'sans' }, position: { x: 100, y: 50 }, ...patch } },
    { type: 'addTool', tool: v60 },
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'vcarve', toolId: 'v60', id: 'v' },
    { type: 'updateOperation', id: 'v', patch: { geometry: [{ kind: 'text', textId: 't1' }] } },
  ]);
}
async function fontsFor(job: Job, blobs = {}) {
  const fonts = new FontStore();
  await fonts.ensure(job, blobs);
  return fonts;
}
const inkOf = (job: Job, fonts: FontStore, id: string) => {
  const t = job.texts.find((x) => x.id === id)!;
  return layoutText(t, fonts.get(t.font)!, job.tolerance);
};
const outerPoints = (shapes: readonly Shape[]): Vec2[] => shapes.flatMap((s) => s.outer.segments.flatMap((g) => (g.kind === 'line' ? [g.from] : [])));
const nearest = (p: Vec2, pts: Vec2[]) => Math.min(...pts.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
const bbox = (pts: Vec2[]) => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
};
const errorsOf = (job: Job, fonts: FontStore, geo: never | null = null) =>
  runPipeline(job, geo, programContext(job, geo), new PipelineCache(), { date: '2026-01-01' }, fonts).run.results.flatMap((r) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message));

const L: Vec2[] = [{ x: 20, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 60 }, { x: 20, y: 60 }];
const SQ: Vec2[] = [{ x: 60, y: 40 }, { x: 70, y: 40 }, { x: 70, y: 50 }, { x: 60, y: 50 }];
const drawnBase = (paths: Vec2[][] = [L, SQ]) => {
  const d = drawingJob(paths.map((q) => pathFromPoints(q, true)), 'vcarve', { maxDepth: 4 }, v60, STOCK);
  return { d, base: applyCommands(d.job, [{ type: 'addTool', tool: tool6 }]) };
};
/** The plug's drawn model as CAM geometry. */
const plugGeometry = (job: Job, blobs: Record<string, Uint8Array>) => {
  const svg = importFile('inlay shapes.svg', blobs[job.model!.blobId], { svgScale: 1 });
  if (!svg.ok || svg.kind !== 'drawing') throw new Error('plug model did not import');
  return { kind: 'drawing' as const, drawing: svg.drawing, rawPoints: pathsToPoints(svg.drawing.layers.flatMap((l) => l.paths)) };
};

describe('makePlugJob, texts', () => {
  it('prepares the base and builds the plug job', async () => {
    const base = textBase();
    const fonts = await fontsFor(base);
    const r = makePlugJob(base, null, fonts, {}, 'v', input);
    expect(r.H).toBeCloseTo(H, 9);

    const nb = applyCommands(base, r.base);
    expect(nb.operations.map((o) => o.type)).toEqual(['vclear', 'vcarve']);
    expect(nb.operations[1]).toMatchObject({ maxDepth: 4, inlay: { startDepth: 2, glueGap: 0.5, margin: 10, plugBoard: r.plugBoard, plugFileName: 'Sign plug.spon' } });
    expect(nb.operations[0]).toMatchObject({ sourceId: 'v', toolId: 't6' });

    const ink = inkOf(base, fonts, 't1').bounds!;
    const w = ink.max.x - ink.min.x, h = ink.max.y - ink.min.y;
    const plug = r.plug.job;
    expect(plug.name).toBe('Sign plug');
    expect(plug.stock.mode).toBe('fixed');
    if (plug.stock.mode !== 'fixed') throw new Error('stock is not fixed');
    expect(plug.stock.size.x).toBeCloseTo(w + 20, 2);
    expect(plug.stock.size.y).toBeCloseTo(h + 20, 2);
    expect(plug.stock.size.z).toBeCloseTo(H + 2, 9);
    expect(r.plugBoard).toEqual(plug.stock.size);

    expect(plug.texts).toHaveLength(1);
    expect(plug.texts[0]).toMatchObject({ text: 'SPON', mirror: true });
    const pf = await fontsFor(plug, r.plug.blobs);
    const pi = inkOf(plug, pf, plug.texts[0].id).bounds!;
    expect((pi.min.x + pi.max.x) / 2).toBeCloseTo(plug.stock.size.x / 2, 2);
    expect((pi.min.y + pi.max.y) / 2).toBeCloseTo(plug.stock.size.y / 2, 2);

    expect(plug.operations.map((o) => o.type)).toEqual(['vclear', 'vplug']);
    expect(plug.operations[1]).toMatchObject({ inlayDepth: 4, startDepth: 2, glueGap: 0.5, toolId: 'v60' });
    expect(plug.operations[0]).toMatchObject({ sourceId: plug.operations[1].id, toolId: 't6' });
    expect(plug.tools.map((t) => t.id).sort()).toEqual(['t6', 'v60']);
    expect(errorsOf(plug, pf)).toEqual([]);
  });

  // The base ink reflected in X about its own centre and moved to the plug stock's centre is the plug's ink.
  it.each<[string, TextPatch]>([
    ['F', { text: 'F', position: { x: 60, y: 45 } }],
    ['rotated F (angle 20)', { text: 'F', position: { x: 60, y: 45 }, angle: 20 }],
    ['F on an arc', { text: 'F', position: { x: 100, y: 20 }, arc: { radius: 40, side: 'outside' } }],
  ])('mirrors %s in X (direction, angle and arc)', async (_name, patch) => {
    const base = textBase(patch);
    const fonts = await fontsFor(base);
    const r = makePlugJob(base, null, fonts, {}, 'v', input);
    const plug = r.plug.job;
    const pf = await fontsFor(plug, r.plug.blobs);
    const t = plug.texts[0], bt = base.texts[0];
    expect(t).toMatchObject({ mirror: true, arc: bt.arc, align: bt.align, anchor: bt.anchor });
    expect(t.angle).toBe(0 - bt.angle);

    const b = inkOf(base, fonts, 't1'), p = inkOf(plug, pf, t.id);
    const bp = outerPoints(b.shapes), pp = outerPoints(p.shapes);
    const bb = bbox(bp);
    const W = r.plugBoard.x, Hh = r.plugBoard.y;
    const mapped = (sign: number) => bp.map((q) => ({ x: W / 2 - sign * (q.x - bb.cx), y: Hh / 2 + (q.y - bb.cy) }));
    const good = mapped(1);
    for (const q of good) expect(nearest(q, pp)).toBeLessThan(1e-3);
    for (const q of pp) expect(nearest(q, good)).toBeLessThan(1e-3);
    // the unmirrored placement is a different shape: it would not pass
    expect(Math.max(...mapped(-1).map((q) => nearest(q, pp)))).toBeGreaterThan(1);
  });

  it('updates an existing plug job without duplicating texts', async () => {
    let base = textBase();
    let fonts = await fontsFor(base);
    const first = makePlugJob(base, null, fonts, {}, 'v', input);
    let plug = applyCommands(first.plug.job, [
      { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'user' },
      { type: 'setWcs', patch: { workOffset: 'G55' } },
    ]);
    base = applyCommands(base, [...first.base, { type: 'updateText', id: 't1', patch: { text: 'SIGN' } }]);
    fonts = await fontsFor(base);
    const r = makePlugJob(base, null, fonts, {}, 'v', { ...input, inlayDepth: 5, glueGap: 0.4 }, { job: plug, blobs: first.plug.blobs });
    plug = r.plug.job;
    expect(plug.id).toBe(first.plug.job.id);
    expect(plug.texts.map((t) => t.text)).toEqual(['SIGN']);
    expect(plug.operations.map((o) => o.type)).toEqual(['vclear', 'vplug', 'profile']);
    expect(plug.tools.map((t) => t.id).sort()).toEqual(['t6', 'v60']);
    expect(plug.wcs.workOffset).toBe('G55');
    const vplug = plug.operations[1] as VPlugOp;
    expect(vplug).toMatchObject({ inlayDepth: 5, glueGap: 0.4, startDepth: 2 });
    expect(vplug.geometry).toEqual([{ kind: 'text', textId: plug.texts[0].id }]);
    // the base already has its clearing: no second one is added
    expect(r.base.filter((c) => c.type === 'addOperation')).toHaveLength(0);
  });

  it('update re-adds a missing clearing and follows the base V-bit, keeping the plug tool numbering', async () => {
    let base = textBase();
    let fonts = await fontsFor(base);
    const first = makePlugJob(base, null, fonts, {}, 'v', input);
    const v90: Tool = { ...v60, id: 'v90', number: 8, tipAngleDeg: 90 };
    // the plug job already has a tool with number 8
    const plug0 = applyCommands(first.plug.job, [
      { type: 'removeOperation', id: 'plug-clear' },
      { type: 'addTool', tool: { ...tool6, id: 'x', number: 8, name: 'other' } },
    ]);
    base = applyCommands(base, [...first.base, { type: 'addTool', tool: v90 }, { type: 'updateOperation', id: 'v', patch: { toolId: 'v90' } }]);
    fonts = await fontsFor(base);
    const r = makePlugJob(base, null, fonts, {}, 'v', input, { job: plug0, blobs: {} });
    const plug = r.plug.job;
    const ops = plug.operations;
    expect(ops.map((o) => o.type)).toEqual(['vclear', 'vplug']);
    expect(ops[0]).toMatchObject({ enabled: true, sourceId: ops[1].id, toolId: 't6' });
    expect(ops[1].toolId).toBe('v90');
    expect(plug.tools.find((t) => t.id === 'x')!.number).toBe(8);
    expect(plug.tools.find((t) => t.id === 'v90')!.number).toBe(9);
    expect(plug.tools.find((t) => t.id === 'v60')!.number).toBe(7);
  });

  it('update changes a tool with the same id in place without a number clash', async () => {
    let base = textBase();
    let fonts = await fontsFor(base);
    const first = makePlugJob(base, null, fonts, {}, 'v', input);
    base = applyCommands(base, [...first.base, { type: 'updateTool', id: 'v60', patch: { tipAngleDeg: 45 } }]);
    fonts = await fontsFor(base);
    const r = makePlugJob(base, null, fonts, {}, 'v', input, { job: first.plug.job, blobs: {} });
    expect(r.plug.job.tools.filter((t) => t.id === 'v60')).toHaveLength(1);
    expect(r.plug.job.tools.find((t) => t.id === 'v60')).toMatchObject({ tipAngleDeg: 45, number: 7 });
  });

  it('copies file-font blobs', async () => {
    const font = { kind: 'file' as const, blobId: 'f1', name: 'TestSans.otf' };
    const base = textBase({ text: 'H', font });
    const blobs = { f1: testFontBytes() };
    const fonts = await fontsFor(base, blobs);
    const r = makePlugJob(base, null, fonts, blobs, 'v', input);
    expect(r.plug.blobs.f1).toBe(blobs.f1);
    expect(r.plug.job.texts[0].font).toEqual(font);
    expect(errorsOf(r.plug.job, await fontsFor(r.plug.job, r.plug.blobs))).toEqual([]);
  });

  it('puts a text from a model face on the plug stock top', async () => {
    const { job: model, geometry } = plateSetup();
    const mesh = geometry as typeof geometry & { kind: 'mesh' };
    const p = mesh.mesh.positions;
    let zTop = -Infinity, xMin = Infinity, yMin = Infinity;
    for (let i = 0; i < p.length; i += 3) { zTop = Math.max(zTop, p[i + 2]); xMin = Math.min(xMin, p[i]); yMin = Math.min(yMin, p[i + 1]); }
    const face = faceAt(mesh, xMin + 1, yMin + 1, zTop);
    const base = applyCommands(model, [
      { type: 'addText', id: 't1', patch: { text: 'HI', size: 5, surface: { from: 'face', face } } },
      { type: 'addTool', tool: v60 },
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'vcarve', toolId: 'v60', id: 'v' },
      { type: 'updateOperation', id: 'v', patch: { geometry: [{ kind: 'text', textId: 't1' }] } },
    ]);
    const fonts = await fontsFor(base);
    const r = makePlugJob(base, geometry, fonts, {}, 'v', input);
    expect(r.plug.job.texts[0].surface).toEqual({ from: 'stockTop' });
    expect(errorsOf(r.plug.job, await fontsFor(r.plug.job, r.plug.blobs))).toEqual([]);
  });

  it('refuses', async () => {
    const base = textBase();
    const fonts = await fontsFor(base);
    const go = (patch: Partial<MakeInlayInput>, b = base, existing?: { job: Job; blobs: Record<string, Uint8Array> }) =>
      () => makePlugJob(b, null, fonts, {}, 'v', { ...input, ...patch }, existing);
    expect(go({}, applyCommands(base, [{ type: 'updateOperation', id: 'v', patch: { toolId: 't6' } }]))).toThrow(new InlayError('Inlays need a V-bit'));
    expect(go({ glueGap: 4 })).toThrow('The glue gap must be smaller than the inlay depth');
    expect(go({ glueGap: 5 })).toThrow('The glue gap must be smaller than the inlay depth');
    for (const patch of [{ inlayDepth: 0 }, { startDepth: -1 }, { glueGap: 0 }]) {
      expect(go(patch)).toThrow('Set the inlay depth, start depth and glue gap to positive values');
    }
    expect(go({}, applyCommands(base, [{ type: 'updateOperation', id: 'v', patch: { geometry: [] } }]))).toThrow('V-carve 1 has no closed outlines to inlay');
    expect(go({ plugBoard: { x: 100, y: 100, z: 5 } })).toThrow('The plug board is thinner than the plug (5.50 mm)');
    expect(go({ clearingToolId: 'nope' })).toThrow('The clearing tool is not in the job');
    expect(go({}, base, { job: base, blobs: {} })).toThrow('This job is not a plug job');
  });
});

describe('makePlugJob, drawings', () => {
  it('writes the mirrored, centred shapes as an SVG model', () => {
    const { d, base } = drawnBase();
    const r = makePlugJob(base, d.geometry, new FontStore(), {}, 'o', input);
    const plug = r.plug.job;
    expect(plug.model).toMatchObject({ sourceName: 'inlay shapes.svg', kind: 'drawing', format: 'svg', svgScale: 1, importUnits: 'mm' });
    expect(plug.texts).toEqual([]);
    expect(plug.operations.map((o) => o.type)).toEqual(['vclear', 'vplug']);
    const vplug = plug.operations[1] as VPlugOp;
    expect(vplug.geometry).toHaveLength(2);

    const geo = plugGeometry(plug, r.plug.blobs);
    const pctx = camContext(plug, geo);
    const plugPts = outerPoints(resolveGeometry(vplug, pctx).shapes.map((s) => s.shape));
    const carve = applyCommands(base, r.base).operations.find((o) => o.id === 'o')!;
    const basePts = outerPoints(resolveGeometry(carve, camContext(base, d.geometry)).shapes.map((s) => s.shape));
    expect(plugPts).toHaveLength(basePts.length);
    const bb = bbox(basePts);
    const pcx = (pctx.stock!.min.x + pctx.stock!.max.x) / 2, pcy = (pctx.stock!.min.y + pctx.stock!.max.y) / 2;
    const mapped = (sign: number) => basePts.map((q) => ({ x: pcx - sign * (q.x - bb.cx), y: pcy + (q.y - bb.cy) }));
    for (const q of mapped(1)) expect(nearest(q, plugPts)).toBeLessThan(1e-4);
    expect(Math.max(...mapped(-1).map((q) => nearest(q, plugPts)))).toBeGreaterThan(1);
    const pb = bbox(plugPts);
    expect(pb.cx).toBeCloseTo(pcx, 4);
    expect(pb.cy).toBeCloseTo(pcy, 4);
    expect(pctx.stock!.max.x - pctx.stock!.min.x).toBeCloseTo(r.plugBoard.x, 6);
    expect(errorsOf(plug, new FontStore(), geo as never)).toEqual([]);
  });

  it('keeps the relative placement of texts and drawn shapes (mirrored)', async () => {
    const { d, base: b0 } = drawnBase();
    const base = applyCommands(b0, [
      { type: 'addText', id: 't1', patch: { text: 'F', size: 20, font: { kind: 'bundled', id: 'sans' }, position: { x: 150, y: 30 } } },
      { type: 'updateOperation', id: 'o', patch: { geometry: [...b0.operations[0].geometry, { kind: 'text', textId: 't1' }] } },
    ]);
    const fonts = await fontsFor(base);
    const r = makePlugJob(base, d.geometry, fonts, {}, 'o', input);
    const plug = r.plug.job;
    const vplug = plug.operations.find((o) => o.type === 'vplug') as VPlugOp;
    const centreOf = (op: typeof vplug | NonNullable<Job['operations'][number]>, kind: 'dxfPath' | 'text', ctx: ReturnType<typeof camContext>) =>
      bbox(outerPoints(resolveGeometry({ ...op, geometry: op.geometry.filter((g) => (kind === 'text') === (g.kind === 'text')) } as never, ctx).shapes.map((s) => s.shape)));

    const bctx = camContext(base, d.geometry, fonts);
    const carve = base.operations.find((o) => o.id === 'o')!;
    const dB = centreOf(carve, 'dxfPath', bctx), tB = centreOf(carve, 'text', bctx);

    const pf = await fontsFor(plug, r.plug.blobs);
    const geo = plugGeometry(plug, r.plug.blobs);
    const pctx = camContext(plug, geo, pf);
    const dP = centreOf(vplug, 'dxfPath', pctx), tP = centreOf(vplug, 'text', pctx);
    expect(tP.cx - dP.cx).toBeCloseTo(-(tB.cx - dB.cx), 3);
    expect(tP.cy - dP.cy).toBeCloseTo(tB.cy - dB.cy, 3);
    expect(errorsOf(plug, pf, geo as never)).toEqual([]);
  });

  it('update replaces the drawn model and the stock size', () => {
    const { d, base } = drawnBase();
    const first = makePlugJob(base, d.geometry, new FontStore(), {}, 'o', input);
    const wide: Vec2[] = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 30 }, { x: 10, y: 30 }];
    const d2 = drawnBase([wide]);
    const r = makePlugJob(d2.base, d2.d.geometry, new FontStore(), {}, 'o', input, first.plug);
    const oldId = first.plug.job.model!.blobId, plug = r.plug.job;
    expect(plug.model!.blobId).not.toBe(oldId);
    expect(r.plug.blobs[oldId]).toBeUndefined();
    expect(r.plug.blobs[plug.model!.blobId]).toBeDefined();
    expect(plug.stock).toMatchObject({ mode: 'fixed', size: { x: 100, y: 40 } });
    expect((plug.operations.find((o) => o.type === 'vplug') as VPlugOp).geometry).toEqual([{ kind: 'dxfPath', blobId: plug.model!.blobId, layer: 0, path: 0 }]);
    expect(plug.operations.map((o) => o.type)).toEqual(['vclear', 'vplug']);
  });
});
