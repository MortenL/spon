import { describe, expect, it } from 'vitest';
import {
  applyCommands, camContext, createJob, flattenPath, FontStore, type Job, pathFromPoints, PipelineCache, programContext, runPipeline, setStock, type Tool, type Toolpath, type Vec2,
} from '../src';
import { tool6 } from './fixtures/camSetup';
import { heightField, sweep } from './fixtures/sweep';
import { testFontBytes } from './fixtures/testFont';
import { drawingJob } from './fixtures/vcarveSetup';

const v60: Tool = { ...tool6, id: 'v60', number: 7, type: 'vbit', tipAngleDeg: 60, cornerRadius: 0, fluteLength: 20 };
// A 6 mm end mill doesn't fit the floor of the base pockets (D t = 2.3 mm inset: the 10 mm rectangle leaves 5.4 mm), so the base is cleared with a 2 mm one.
const flat2: Tool = { ...tool6, id: 't2', number: 2, name: '2 mm flat', diameter: 2 };
const tpOf = (moves: Toolpath['moves']): Toolpath => ({ operationId: 'x', operationName: 'x', toolId: 't', rpm: 0, coolant: 'off', clearance: 5, moves });
const B = (minX: number, minY: number, maxX: number, maxY: number) => ({ minX, minY, maxX, maxY });

describe('sweep', () => {
  const at = (f: ReturnType<typeof heightField>, x: number, y: number) => f.z[Math.floor((y - f.y0) / f.step) * f.nx + Math.floor((x - f.x0) / f.step)];

  it('a V-bit plunge makes a cone of the right slope', () => {
    const f = heightField(B(-5, -5, 5, 5), 0.05, 0);
    const slope = Math.tan(Math.PI / 6);
    sweep(f, tpOf([{ kind: 'rapid', to: { x: 0, y: 0, z: 5 } }, { kind: 'line', to: { x: 0, y: 0, z: -2 }, feed: 100 }]), v60);
    expect(at(f, 0.025, 0.025)).toBeCloseTo(-2 + 0.035 / slope, 2);
    for (const d of [0.5, 1, 1.1]) expect(at(f, d, 0.025)).toBeCloseTo(-2 + d / slope, 1);
    expect(at(f, 1.3, 0)).toBe(0); // the cone reaches the surface at 2 tan(30) = 1.155
  });

  it('a flat-tool line makes a trench of its width', () => {
    const f = heightField(B(-8, -8, 8, 8), 0.05, 0);
    sweep(f, tpOf([{ kind: 'rapid', to: { x: -4, y: 0, z: 5 } }, { kind: 'line', to: { x: -4, y: 0, z: -1 }, feed: 1 }, { kind: 'line', to: { x: 3, y: 0, z: -1 }, feed: 1 }]), tool6);
    expect(at(f, 0, 2.9)).toBe(-1);
    expect(at(f, 0, -2.9)).toBe(-1);
    expect(at(f, 0, 3.1)).toBe(0);
    expect(at(f, 0, -3.1)).toBe(0);
    expect(at(f, 6.1, 0)).toBe(0); // beyond the end of the line plus the radius (3 + 3 = 6)
    expect(at(f, 5.9, 0)).toBe(-1);
    expect(at(f, -7.1, 0)).toBe(0);
  });
});

// ── fit cases ────────────────────────────────────────────────────────────
const D = 4, S = 2, g = 0.5, H = D - g + S, R = S * Math.tan(Math.PI / 6), toolR = tool6.diameter / 2;
const STEP = 0.05, MARGIN = 12, FIELD = 8;

interface Built { loops: Vec2[][]; stock: { minX: number; minY: number; maxX: number; maxY: number; top: number }; tps: Toolpath[]; tol: number; errors: string[] }
type Content = { kind: 'poly'; polys: Vec2[][] } | { kind: 'text'; text: string; size: number };

const mirrorPolys = (polys: Vec2[][]) => polys.map((p) => p.map((q) => ({ x: -q.x, y: q.y })).reverse());
const bboxOf = (loops: Vec2[][]) => {
  const xs = loops.flatMap((l) => l.map((p) => p.x)), ys = loops.flatMap((l) => l.map((p) => p.y));
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

async function build(role: 'base' | 'plug', c: Content): Promise<Built> {
  const opPatch = role === 'base' ? { maxDepth: D } : { inlayDepth: D, startDepth: S, glueGap: g };
  const opType = role === 'base' ? 'vcarve' : 'vplug';
  const thick = role === 'base' ? 12 : 10;
  const clearTool = role === 'base' ? flat2 : tool6;
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
  const errors = run.results.filter((r) => r.operationId === 'o').flatMap((r) => r.diagnostics.filter((x) => x.severity === 'error').map((x) => x.message));
  return { loops, stock: { minX: box.min.x, minY: box.min.y, maxX: box.max.x, maxY: box.max.y, top: box.max.z }, tps: toolpaths as Toolpath[], tol: job.tolerance, errors };
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

const toolOf = (tp: Toolpath) => (tp.toolId === 't6' ? tool6 : tp.toolId === 't2' ? flat2 : v60);

async function fit(c: Content) {
  const base = await build('base', c), plug = await build('plug', c);
  expect(base.errors).toEqual([]);
  expect(plug.errors).toEqual([]);
  expect(base.tps.some((tp) => tp.operationId === 'o')).toBe(true);
  expect(plug.tps).toHaveLength(2);
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

const cases: [string, Content][] = [
  ['a 20 x 10 rectangle', { kind: 'poly', polys: [rect(0, 0, 20, 10)] }],
  ['an O (size 15) with a counter', { kind: 'text', text: 'O', size: 15 }],
  ['a 0.8 x 12 stroke', { kind: 'poly', polys: [rect(0, 0, 0.8, 12)] }],
  ['two 8 x 8 squares 1 mm apart', { kind: 'poly', polys: [rect(0, 0, 8, 8), rect(9, 0, 17, 8)] }],
];

describe('inlay fit (pocket vs flipped plug)', () => {
  for (const [name, content] of cases) {
    it(`fits: ${name}`, async () => {
      const r = await fit(content);
      console.log(`FIT ${name}: maxPenetration=${r.maxPen.toFixed(4)} maxWallGap=${r.maxGap.toFixed(4)} floorDev=${r.floorDev.toFixed(4)} (tol ${r.tol}, pocketCells ${r.pocketCells}, floorCells ${r.floorCells})`);
      expect(r.pocketCells).toBeGreaterThan(0);
      expect(r.floorCells).toBeGreaterThan(0);
      expect(r.maxPen).toBeLessThanOrEqual(r.tol + 0.01);
      expect(r.maxGap).toBeLessThanOrEqual(g + 0.15);
      expect(r.floorDev).toBeLessThanOrEqual(0.01);
    }, 10000);
  }
});
