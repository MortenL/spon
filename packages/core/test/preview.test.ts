import { describe, expect, it } from 'vitest';
import {
  applyCommand, type JobCommand, niceLength, PipelineCache, type PreviewInput, previewInput, programContext, projector, renderPreviewSvg, runPipeline,
  simplifyPolyline, type Toolpath,
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
