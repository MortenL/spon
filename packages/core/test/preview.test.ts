import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyCommand, type CamGeometry, createJob, importFile, type JobCommand, niceLength, PipelineCache, type PreviewInput, previewInput, programContext, projector, renderPreviewSvg, runPipeline,
  setModel, simplifyPolyline, type Toolpath,
} from '../src';
import { camPartSetup, tool6 } from './fixtures/camSetup';

function profiled() {
  const { job: base, geometry, layer } = camPartSetup();
  const commands: JobCommand[] = [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'p', name: 'Outline' },
    { type: 'updateOperation', id: 'p', patch: { geometry: [{ kind: 'dxfPath', blobId: 'd1', layer: layer('OUTLINE'), path: 0 }] } },
  ];
  const job = commands.reduce(applyCommand, base);
  // camPartSetup's geometry is a drawing CamGeometry with Float32Array raw points, i.e. a valid ModelGeometry
  const pipeline = runPipeline(job, geometry, programContext(job, geometry as never), new PipelineCache());
  return { job, geometry, input: previewInput(job, geometry, pipeline) };
}

const count = (text: string, needle: string) => text.split(needle).length - 1;
const pathOf = (svg: string, cls: string) => new RegExp(`class="${cls}" d="([^"]*)"`).exec(svg)?.[1] ?? '';

describe('projector', () => {
  it('maps program coordinates to each view', () => {
    const p = { x: 1, y: 2, z: 3 };
    expect(projector('top')(p)).toEqual({ x: 1, y: 2, depth: 3 });
    expect(projector('front')(p)).toEqual({ x: 1, y: 3, depth: -2 });
    const up = projector('iso')({ x: 0, y: 0, z: 1 });
    expect(up.x).toBeCloseTo(0, 12);
    expect(up.y).toBeCloseTo(Math.cos(Math.PI / 6), 12);
  });
});

describe('simplifyPolyline', () => {
  it('drops collinear and sub-pixel points and keeps corners', () => {
    expect(simplifyPolyline([0, 0, 1, 0, 2, 0, 3, 0])).toEqual([0, 0, 3, 0]);
    expect(simplifyPolyline([0, 0, 0.1, 0.1, 5, 0])).toEqual([0, 0, 5, 0]);
    expect(simplifyPolyline([0, 0, 5, 0, 5, 5])).toEqual([0, 0, 5, 0, 5, 5]);
  });
});

describe('niceLength', () => {
  it('rounds down to 1, 2 or 5 × 10^k', () => {
    expect(niceLength(37)).toBe(20);
    expect(niceLength(100)).toBe(100);
    expect(niceLength(0.7)).toBeCloseTo(0.5, 12);
  });
});

describe('renderPreviewSvg', () => {
  it('draws the stock, the model, each operation, the WCS, a legend and a scale', () => {
    const { input } = profiled();
    expect(input.operations).toHaveLength(1);
    expect(input.operations[0].toolpath).not.toBeNull();
    const svg = renderPreviewSvg(input);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    for (const part of ['<g id="stock"', '<g id="model"', '<g id="op-0" data-name="Outline"', '<g id="wcs"', '<g id="legend"', '<g id="scale"', 'id="dims"']) {
      expect(svg).toContain(part);
    }
    expect(svg).toContain('stroke-dasharray="4 3"');
    expect(pathOf(svg, 'feed').length).toBeGreaterThan(0);
    expect(Number(/width="(\d+)"/.exec(svg)![1])).toBeLessThanOrEqual(1024);
  });

  it('renders the three views differently and fills the stock top except in the front view', () => {
    const { input } = profiled();
    const [top, front, iso] = (['top', 'front', 'iso'] as const).map((view) => renderPreviewSvg(input, { view }));
    expect(new Set([top, front, iso]).size).toBe(3);
    expect(top).toContain('<polygon');
    expect(iso).toContain('<polygon');
    expect(front).not.toContain('<polygon');
  });

  it('shows only the requested operations and escapes names', () => {
    const { input } = profiled();
    const named: PreviewInput = { ...input, operations: [{ ...input.operations[0], name: 'A <&> "B"' }] };
    expect(renderPreviewSvg(named)).toContain('A &lt;&amp;&gt; &quot;B&quot;');
    expect(renderPreviewSvg(input, { operations: [] })).not.toContain('id="op-0"');
  });

  it('marks operations with errors, unmachined areas and drill cycles', () => {
    const { input } = profiled();
    const cycle: Toolpath = {
      operationId: 'd', operationName: 'Drill', toolId: 't6', rpm: 1000, coolant: 'off', clearance: 10,
      moves: [{ kind: 'rapid', to: { x: 5, y: 5, z: 10 } }, { kind: 'cycle', cycle: 'drill', at: { x: 5, y: 5 }, top: 0, bottom: -6, r: 2, retract: 10, peck: 0, dwell: 0, feed: 100 }],
    };
    const svg = renderPreviewSvg({
      ...input,
      operations: [
        { ...input.operations[0], hasErrors: true, unmachined: [{ z: -3, regions: [{ outer: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], holes: [] }] }] },
        { id: 'd', name: 'Drill', toolpath: cycle, hasErrors: false, unmachined: [] },
      ],
    });
    expect(svg).toContain('Outline — error');
    expect(svg).toContain('class="unmachined"');
    expect(svg).toContain('url(#hatch)');
    expect(svg).toContain('<circle');
  });

  it('keeps 100,000 moves under 20,000 path commands (review focus 5)', () => {
    const { input } = profiled();
    const moves = Array.from({ length: 100_000 }, (_, i) => {
      const a = (i / 100_000) * 2 * Math.PI;
      return { kind: 'line' as const, to: { x: 20 * Math.cos(a), y: 20 * Math.sin(a), z: -1 }, feed: 1000 };
    });
    const big: Toolpath = { operationId: 'big', operationName: 'Big', toolId: 't6', rpm: 1, coolant: 'off', clearance: 5, moves: [{ kind: 'rapid', to: { x: 20, y: 0, z: 5 } }, ...moves] };
    const started = performance.now();
    const svg = renderPreviewSvg({ ...input, operations: [{ id: 'big', name: 'Big', toolpath: big, hasErrors: false, unmachined: [] }] });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(count(pathOf(svg, 'feed'), 'L')).toBeLessThan(20_000);
  });

  it('says there is nothing to preview without a model', () => {
    const { input } = profiled();
    const svg = renderPreviewSvg({ job: { ...input.job, model: null }, geometry: null, operations: [] });
    expect(svg).toContain('Nothing to preview: import a model first');
  });
});

const pointsOf = (d: string) => [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
const feedPoints = (input: PreviewInput, toolpath: Toolpath) =>
  pointsOf(pathOf(renderPreviewSvg({ ...input, operations: [{ id: toolpath.operationId, name: 'T', toolpath, hasErrors: false, unmachined: [] }] }), 'feed'));
const tp = (moves: Toolpath['moves']): Toolpath => ({ operationId: 'a', operationName: 'A', toolId: 't6', rpm: 1, coolant: 'off', clearance: 5, moves });

describe('preview geometry', () => {
  it('tessellates arcs in the right direction and closes full circles', () => {
    const { input } = profiled();
    const start = { x: 10, y: 0, z: -1 };
    const arc = (to: { x: number; y: number }, ccw: boolean) => feedPoints(input, tp([
      { kind: 'rapid', to: start }, { kind: 'arc', to: { ...to, z: -1 }, center: { x: 0, y: 0 }, ccw, feed: 100 },
    ] as Toolpath['moves']));
    // screen centre: x of the end point (X = 0), y of the start point (Y = 0); screen y points down
    const short = arc({ x: 0, y: 10 }, true);
    const cx = short[short.length - 1].x;
    const cy = short[0].y;
    expect(short.length).toBeGreaterThan(2);
    expect(short.every((p) => p.x >= cx - 0.2 && p.y <= cy + 0.2)).toBe(true);
    const long = arc({ x: 0, y: 10 }, false);
    const lcx = long[long.length - 1].x;
    const lcy = long[0].y;
    expect(long.some((p) => p.x < lcx - 5 && p.y > lcy + 5)).toBe(true);
    const full = arc({ x: 10, y: 0 }, true);
    expect(full.length).toBeGreaterThan(8);
    expect(full[full.length - 1]).toEqual(full[0]);
  });

  it('flips Y on screen in the top view', () => {
    const { input } = profiled();
    const pts = feedPoints(input, tp([{ kind: 'rapid', to: { x: 0, y: 0, z: -1 } }, { kind: 'line', to: { x: 0, y: 10, z: -1 }, feed: 100 }] as Toolpath['moves']));
    expect(pts[1].y).toBeLessThan(pts[0].y);
  });

  it('projects iso with the documented handedness', () => {
    const x = projector('iso')({ x: 1, y: 0, z: 0 });
    const y = projector('iso')({ x: 0, y: 1, z: 0 });
    expect(x.x).toBeGreaterThan(0);
    expect(x.y).toBeLessThan(0);
    expect(y.x).toBeGreaterThan(0);
    expect(y.y).toBeGreaterThan(0);
  });

  it('draws the 12 feature edges of a box mesh', () => {
    const r = importFile('box-20x10x5.stl', readFileSync(new URL('./fixtures/box-20x10x5.stl', import.meta.url)));
    if (!r.ok || r.kind !== 'mesh') throw new Error('fixture did not import');
    const geometry: CamGeometry = { kind: 'mesh', mesh: r.mesh, adjacency: r.adjacency, rawPoints: r.mesh.positions };
    const job = setModel(createJob(), { sourceName: 'box.stl', blobId: 'b', kind: 'mesh', importUnits: 'mm' });
    const svg = renderPreviewSvg({ job, geometry, operations: [] });
    const model = /<g id="model"[^>]*><path d="([^"]*)"/.exec(svg)![1];
    expect(count(model, 'M')).toBe(12);
  });

  it('labels the scale and stock size in the display unit', () => {
    const { input } = profiled();
    const svg = renderPreviewSvg({ ...input, job: { ...input.job, displayUnits: 'in' } });
    expect(/ in<\/text><\/g>/.test(/<g id="scale".*?<\/g>/.exec(svg)![0])).toBe(true);
    expect(/<text id="dims"[^>]*>[^<]* in<\/text>/.test(svg)).toBe(true);
  });

  it('keeps overlapping unmachined regions from different operations hatched', () => {
    const { input } = profiled();
    const region = { z: -3, regions: [{ outer: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], holes: [] }] };
    const op = input.operations[0];
    const svg = renderPreviewSvg({ ...input, operations: [{ ...op, unmachined: [region] }, { ...op, id: 'q', unmachined: [region] }] });
    const group = /<g class="unmachined".*?<\/g>/.exec(svg)![0];
    expect(count(group, '<path')).toBe(2);
  });
});
