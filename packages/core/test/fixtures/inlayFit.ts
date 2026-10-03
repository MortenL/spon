import { describe, expect, it } from 'vitest';
import {
  applyCommands, camContext, createJob, flattenPath, FontStore, type Job, pathFromPoints, PipelineCache, programContext, runPipeline, setStock, type Tool, type Toolpath, type Vec2,
} from '../../src';
import { tool6 } from './camSetup';
import { heightField, sweep } from './sweep';
import { testFontBytes } from './testFont';
import { drawingJob } from './vcarveSetup';

/**
 * The inlay fit test (spec §9): the base pocket and the flipped plug, each generated with its clearing, swept into height fields
 * on a 0.05 mm grid and paired (the plug mirrored about the shapes' centres, its face at D − g).
 */
export const v60: Tool = { ...tool6, id: 'v60', number: 7, type: 'vbit', tipAngleDeg: 60, cornerRadius: 0, fluteLength: 20 };
// realistic clearing tools: the 3 mm starter flat and a 6 mm flat (both clear the base and the plug)
export const flat3: Tool = { ...tool6, id: 't3', number: 2, name: '3 mm flat', diameter: 3 };

const B = (minX: number, minY: number, maxX: number, maxY: number) => ({ minX, minY, maxX, maxY });

// ── fit cases ────────────────────────────────────────────────────────────
const D = 4, S = 2, g = 0.5, H = D - g + S, R = S * Math.tan(Math.PI / 6);
const STEP = 0.05, MARGIN = 12, FIELD = 8;

interface Built { loops: Vec2[][]; stock: { minX: number; minY: number; maxX: number; maxY: number; top: number }; tps: Toolpath[]; tol: number; errors: string[]; clearErrors: string[] }
export type Content = { kind: 'poly'; polys: Vec2[][] } | { kind: 'text'; text: string; size: number };

const mirrorPolys = (polys: Vec2[][]) => polys.map((p) => p.map((q) => ({ x: -q.x, y: q.y })).reverse());
const bboxOf = (loops: Vec2[][]) => {
  const xs = loops.flatMap((l) => l.map((p) => p.x)), ys = loops.flatMap((l) => l.map((p) => p.y));
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

async function build(role: 'base' | 'plug', c: Content, clearTool: Tool): Promise<Built> {
  // the base V-carve as makePlugJob leaves it: max depth D and the inlay settings
  const inlay = { startDepth: S, glueGap: g, margin: 10, plugBoard: { x: 50, y: 50, z: H + 2 }, plugFileName: 'plug.spon' };
  const opPatch = role === 'base' ? { maxDepth: D, inlay } : { inlayDepth: D, startDepth: S, glueGap: g };
  const opType = role === 'base' ? 'vcarve' : 'vplug';
  const thick = role === 'base' ? 12 : 10;
  let job: Job;
  let geometry: never | null = null;
  let loops: Vec2[][];
  let fonts: FontStore | undefined;
  if (c.kind === 'poly') {
    const polys = role === 'base' ? c.polys : mirrorPolys(c.polys);
    const bb = bboxOf(polys);
    const stock = { mode: 'fixed' as const, size: { x: bb.maxX - bb.minX + 2 * MARGIN, y: bb.maxY - bb.minY + 2 * MARGIN, z: thick }, modelOffset: { x: MARGIN, y: MARGIN, z: 0 } };
    const d = drawingJob(polys.map((p) => pathFromPoints(p, true)), opType, opPatch, v60, stock);
    job = d.job;
    geometry = d.geometry as never;
    loops = polys.map((_, i) => flattenPath(d.program(i), 0.001));
  } else {
    // size is the cap height: the 'O' is 12.86 x 15 mm
    const w = 12.86 + 2 * MARGIN, h = 15 + 2 * MARGIN;
    job = setStock(createJob(), { mode: 'fixed', size: { x: w, y: h, z: thick }, modelOffset: { x: 0, y: 0, z: 0 } });
    job = applyCommands(job, [
      { type: 'addText', id: 'tx', patch: { text: c.text, size: c.size, font: { kind: 'file', blobId: 'f1', name: 'TestSans.otf' }, position: { x: w / 2, y: h / 2 }, mirror: role === 'plug' } },
      { type: 'addTool', tool: v60 },
      { type: 'addOperation', opType, toolId: 'v60', id: 'o' },
      { type: 'updateOperation', id: 'o', patch: { geometry: [{ kind: 'text', textId: 'tx' }], ...opPatch } as never },
    ]);
    fonts = new FontStore();
    await fonts.ensure(job, { f1: testFontBytes() });
    loops = [];
  }
  job = applyCommands(job, [
    { type: 'addTool', tool: clearTool },
    { type: 'addOperation', opType: 'vclear', toolId: clearTool.id, id: 'c' },
    { type: 'updateOperation', id: 'c', patch: { sourceId: 'o' } as never },
  ]);
  const { run, toolpaths } = runPipeline(job, geometry, programContext(job, geometry), new PipelineCache(), { date: '2026-01-01' }, fonts);
  if (c.kind === 'text') loops = run.texts[0].loops.map((l) => l.points);
  const box = camContext(job, geometry, fonts).stock!;
  const errorsOf = (id: string) => run.results.filter((r) => r.operationId === id).flatMap((r) => r.diagnostics.filter((x) => x.severity === 'error').map((x) => x.message));
  return { loops, stock: { minX: box.min.x, minY: box.min.y, maxX: box.max.x, maxY: box.max.y, top: box.max.z }, tps: toolpaths as Toolpath[], tol: job.tolerance, errors: errorsOf('o'), clearErrors: errorsOf('c') };
}

const insideAny = (p: Vec2, loops: Vec2[][]) => {
  let inside = false;
  for (const l of loops) for (let i = 0; i < l.length; i++) {
    const a = l[i], b = l[(i + 1) % l.length];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  }
  return inside;
};
const distToLoops = (p: Vec2, loops: Vec2[][]) => {
  let best = Infinity;
  for (const l of loops) for (let i = 0; i < l.length; i++) {
    const a = l[i], b = l[(i + 1) % l.length];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy));
  }
  return best;
};

const toolOf = (tp: Toolpath) => [tool6, flat3, v60].find((t) => t.id === tp.toolId)!;

// a clearing tool wider than a floor everywhere is an error on the clearing; the V-bit then cleans that floor on its own
const NARROW = 'The clearing tool is wider than the pocket floor; choose a smaller one, or a smaller inlay depth';

export async function fit(c: Content, clearTool: Tool) {
  const base = await build('base', c, clearTool), plug = await build('plug', c, clearTool);
  expect(base.errors).toEqual([]);
  expect(plug.errors).toEqual([]);
  for (const e of [...base.clearErrors, ...plug.clearErrors]) expect(e).toBe(NARROW);
  expect(base.tps.some((tp) => tp.operationId === 'o')).toBe(true);
  expect(plug.tps.some((tp) => tp.operationId === 'o')).toBe(true);
  const toolR = clearTool.diameter / 2;
  const bb = bboxOf(base.loops), pb = bboxOf(plug.loops);
  const cb = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 }, cp = { x: (pb.minX + pb.maxX) / 2, y: (pb.minY + pb.maxY) / 2 };
  const bx0 = bb.minX - FIELD, by0 = bb.minY - FIELD;
  const nx = Math.ceil((bb.maxX - bb.minX + 2 * FIELD) / STEP), ny = Math.ceil((bb.maxY - bb.minY + 2 * FIELD) / STEP);
  // the plug field is the exact mirror of the base field about the shapes' centres
  const px0 = cp.x - (bx0 + nx * STEP - cb.x), py0 = cp.y + (by0 - cb.y);
  const mk = (x0: number, y0: number, surface: number) => ({ ...heightField(B(x0, y0, x0 + 1, y0 + 1), STEP, surface), x0, y0, nx, ny, z: new Float64Array(nx * ny).fill(surface) });
  const bf = mk(bx0, by0, base.stock.top), pf = mk(px0, py0, plug.stock.top);
  expect(bx0).toBeGreaterThanOrEqual(base.stock.minX);
  expect(px0).toBeGreaterThanOrEqual(plug.stock.minX);
  for (const tp of base.tps) sweep(bf, tp, toolOf(tp));
  for (const tp of plug.tps) sweep(pf, tp, toolOf(tp));

  let maxPen = -Infinity, maxGap = -Infinity, floorDev = 0, pocketCells = 0, floorCells = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const zb = base.stock.top - bf.z[j * nx + i];
    const zp = plug.stock.top - pf.z[j * nx + (nx - 1 - i)];
    const pen = D - g - zp - zb;
    if (pen > maxPen) maxPen = pen;
    if (zb > 0.05) { pocketCells++; maxGap = Math.max(maxGap, zb - (D - g - zp)); }
    const cell = { x: pf.x0 + (nx - 1 - i + 0.5) * STEP, y: pf.y0 + (j + 0.5) * STEP };
    if (!insideAny(cell, plug.loops) && distToLoops(cell, plug.loops) > R + toolR + 0.1) {
      floorCells++;
      floorDev = Math.max(floorDev, Math.abs(zp - H));
    }
  }
  return { maxPen, maxGap, floorDev, tol: base.tol, pocketCells, floorCells };
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

export const cases: [string, Content][] = [
  ['a 20 x 10 rectangle', { kind: 'poly', polys: [rect(0, 0, 20, 10)] }],
  ['an O (size 15) with a counter', { kind: 'text', text: 'O', size: 15 }],
  ['a 0.8 x 12 stroke', { kind: 'poly', polys: [rect(0, 0, 0.8, 12)] }],
  ['two 8 x 8 squares 1 mm apart', { kind: 'poly', polys: [rect(0, 0, 8, 8), rect(9, 0, 17, 8)] }],
  // acute corners (48, 59 and 73 degrees): the clearing tool can't reach the floor's corners
  ['an acute triangle', { kind: 'poly', polys: [[{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 12, y: 20 }]] }],
  // the gap between the shapes widens from 1 to 9 mm over 60 mm: the plug floor's wedge is narrower than the clearing tool
  ['a wedge gap (rectangle next to a quadrilateral)', { kind: 'poly', polys: [rect(0, 0, 60, 5), [{ x: 0, y: 6 }, { x: 60, y: 14 }, { x: 60, y: 19 }, { x: 0, y: 11 }]] }],
  // the notch between the arms of a V
  ['a V', { kind: 'poly', polys: [[{ x: 0, y: 20 }, { x: 5, y: 20 }, { x: 10, y: 6 }, { x: 15, y: 20 }, { x: 20, y: 20 }, { x: 12.5, y: 0 }, { x: 7.5, y: 0 }]] }],
];

/** The fit cases with `tool` clearing both the pocket and the plug (one file per tool, so the heavy cases run in parallel). */
export function fitSuite(tool: Tool): void {
  describe(`inlay fit (pocket vs flipped plug), ${tool.name} clearing`, () => {
    for (const [name, content] of cases) {
      it(`fits: ${name}`, async () => {
        const r = await fit(content, tool);
        expect(r.pocketCells).toBeGreaterThan(0);
        expect(r.floorCells).toBeGreaterThan(0);
        expect(r.maxPen).toBeLessThanOrEqual(r.tol + 0.01);
        expect(r.maxGap).toBeLessThanOrEqual(g + 0.15);
        expect(r.floorDev).toBeLessThanOrEqual(0.01);
      }, 60000);
    }
  });
}
