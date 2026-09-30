import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyCommand, createJob, importFile, type Job, type JobCommand, PipelineCache, programContext, runPipeline, setModel, setStock, toModelGeometry,
} from '../src';
import { tool6 } from './fixtures/camSetup';

function outlineJob() {
  const r = importFile('cam-part.dxf', readFileSync(new URL('./fixtures/cam-part.dxf', import.meta.url)));
  if (!r.ok || r.kind !== 'drawing') throw new Error('fixture did not import');
  const geometry = toModelGeometry(r);
  const outline = r.drawing.layers.findIndex((l) => l.name === 'OUTLINE');
  const commands: JobCommand[] = [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'p' },
    { type: 'updateOperation', id: 'p', patch: { geometry: [{ kind: 'dxfPath', blobId: 'd1', layer: outline, path: 0 }] } },
  ];
  const job: Job = commands.reduce(applyCommand, setModel(createJob('Part'), { sourceName: 'cam-part.dxf', blobId: 'd1', kind: 'drawing', importUnits: 'mm' }));
  return { job, geometry };
}

describe('runPipeline', () => {
  it('generates, posts, parses and describes in one call', () => {
    const { job, geometry } = outlineJob();
    const { run, toolpaths } = runPipeline(job, geometry, programContext(job, geometry), new PipelineCache(), { date: '2026-01-01' });
    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toMatchObject({ operationId: 'p', hasToolpath: true });
    expect(run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(toolpaths).toHaveLength(1);
    expect(run.files).toHaveLength(1);
    expect(run.files[0].text).toContain('Spon 2026-01-01');
    expect(run.files[0].postErrors).toEqual([]);
    expect(run.files[0].parsed.analysis.summary.totalSeconds).toBeGreaterThan(0);
    expect(run.catalog?.contours.length).toBeGreaterThan(0);
  });

  it('reuses cached operation results and the catalog', () => {
    const { job, geometry } = outlineJob();
    const cache = new PipelineCache();
    const ctx = programContext(job, geometry);
    const a = runPipeline(job, geometry, ctx, cache);
    const b = runPipeline(job, geometry, ctx, cache);
    expect(b.toolpaths[0]).toBe(a.toolpaths[0]);
    expect(b.run.catalog).toBe(a.run.catalog);
    const moved = setStock(job, { mode: 'auto', margin: { xy: 10, zTop: 0, zBottom: 6 } });
    expect(runPipeline(moved, geometry, programContext(moved, geometry), cache).run.catalog).not.toBe(a.run.catalog);
  });

  it('reports errors and no catalog without a model', () => {
    const job = applyCommand(createJob(), { type: 'addOperation', opType: 'drill', toolId: null, id: 'd' });
    const { run, toolpaths } = runPipeline(job, null, programContext(job, null));
    expect(run.catalog).toBeNull();
    expect(toolpaths).toEqual([]);
    expect(run.files).toEqual([]);
    expect(run.results[0].diagnostics[0]).toMatchObject({ severity: 'error', code: 'no-tool' });
  });
});
