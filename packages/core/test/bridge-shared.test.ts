import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyCommand, applyCommands, CommandError, createJob, decideImport, exportInputFromRun, exportOutcome, exportProblems, fromBase64, importedOutcome,
  importFile, type ImportStep, importStep, type Job, type JobCommand, modelSummary, newModelRef, operationsWithGeometry, PipelineCache, programContext,
  runPipeline, runReport, setModel, toBase64, toModelGeometry,
} from '../src';
import { tool6 } from './fixtures/camSetup';

const STL = new TextEncoder().encode(['solid t', 'facet normal 0 0 1', 'outer loop', 'vertex 0 0 0', 'vertex 2 0 0', 'vertex 0 1 0', 'endloop', 'endfacet', 'endsolid t'].join('\n'));

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

describe('runReport', () => {
  it('keeps what the tools read, as plain JSON', () => {
    const { job, geometry } = outlineJob();
    const { run } = runPipeline(job, geometry, programContext(job, geometry), new PipelineCache(), { date: '2026-01-01' });
    const report = runReport(job, run);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(report.results).toEqual([{ operationId: 'p', diagnostics: run.results[0].diagnostics, heights: run.results[0].heights, hasToolpath: true, tabs: [] }]);
    const summary = run.files[0].parsed.analysis.summary;
    expect(report.files[0]).toEqual({
      name: run.files[0].name, text: run.files[0].text, operationIds: ['p'], tools: run.files[0].tools,
      lineCount: summary.lineCount, seconds: summary.totalSeconds, extents: summary.extents,
    });
    expect(report.export).toEqual(exportProblems(exportInputFromRun(job, run)));
  });

  it('turns a report into an export outcome', () => {
    const files = [{ name: 'a.nc', text: 'G0 X0\n', operationIds: [], tools: [], lineCount: 1, seconds: 0, extents: null }];
    expect(exportOutcome({ results: [], files, export: { errors: [], warnings: ['w'] } })).toEqual({ ok: true, files: [{ name: 'a.nc', text: 'G0 X0\n' }], warnings: ['w'] });
    expect(exportOutcome({ results: [], files, export: { errors: ['e'], warnings: ['w'] } })).toEqual({ ok: false, errors: ['e'], warnings: ['w'] });
  });
});

describe('applyCommands', () => {
  it('applies every command, or none, naming the one that failed', () => {
    const job = createJob();
    const good: JobCommand = { type: 'addOperation', opType: 'drill', toolId: null, id: 'd' };
    expect(applyCommands(job, [good]).operations.map((o) => o.id)).toEqual(['d']);
    const bad: JobCommand = { type: 'updateOperation', id: 'nope', patch: { name: 'x' } };
    expect(() => applyCommands(job, [good, bad])).toThrow(CommandError);
    expect(() => applyCommands(job, [good, bad])).toThrow('commands[1] updateOperation: No operation with id nope');
    expect(job.operations).toEqual([]);
  });
});

describe('import decisions', () => {
  const stlStep = (): ImportStep => importStep(importFile('part.stl', STL));

  it('asks for units when the file has none, with the raw size', () => {
    const d = decideImport(stlStep());
    if (d.status !== 'needsUnits') throw new Error(`expected needsUnits, got ${d.status}`);
    expect(['mm', 'in']).toContain(d.suggested);
    expect(d.rawSize).toEqual({ x: 2, y: 1, z: 0 });
  });

  it('is ready once units are given, and builds the model and the outcome', () => {
    const d = decideImport(stlStep(), 'mm');
    if (d.status !== 'ready') throw new Error(`expected ready, got ${d.status}`);
    const model = newModelRef('part.stl', d.geometry, d.units, 'b1');
    // only STEP/IGES results carry a source (format and body); an STL gives neither
    expect(model).toEqual({ sourceName: 'part.stl', blobId: 'b1', kind: 'mesh', importUnits: 'mm' });
    const job = setModel(applyCommands(createJob(), [{ type: 'addOperation', opType: 'drill', toolId: null, id: 'd' }]), model);
    const outcome = importedOutcome(job, d.geometry, 'mm', d.warnings, 2);
    expect(outcome).toEqual({
      status: 'imported', kind: 'mesh', size: { x: 2, y: 1, z: 0 }, units: 'mm',
      // the reader's own warning (a lone triangle is an open mesh) comes first, then the broken-reference note
      warnings: ['Mesh is not closed: 3 open edges', '2 operation(s) referred to the previous model; their geometry no longer resolves'],
    });
  });

  it('passes errors and body choices on', () => {
    expect(decideImport({ kind: 'error', error: 'No solid bodies found' })).toEqual({ status: 'error', error: 'No solid bodies found' });
    const bodies = [{ name: 'small', triangles: 12, size: { x: 1, y: 1, z: 1 } }, { name: 'big', triangles: 12, size: { x: 5, y: 5, z: 5 } }];
    expect(decideImport({ kind: 'chooseBody', format: 'step', bodies })).toEqual({ status: 'needsBody', bodies, suggested: 1 });
  });

  it('counts the operations that have geometry', () => {
    const { job } = outlineJob();
    expect(operationsWithGeometry(job)).toBe(1);
    expect(operationsWithGeometry(createJob())).toBe(0);
  });
});

describe('wire helpers', () => {
  it('round-trips bytes through base64, including large files (review focus 4)', () => {
    const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) & 255);
    const back = fromBase64(toBase64(big));
    // not toEqual: vitest's deep equality on a 3 MB typed array takes seconds
    expect(back.length).toBe(big.length);
    expect(back.every((v, i) => v === big[i])).toBe(true);
    expect(fromBase64(toBase64(new Uint8Array()))).toEqual(new Uint8Array());
    expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=');
  });

  it('summarises the model of a job', () => {
    expect(modelSummary(null)).toBeNull();
    const job = setModel(createJob(), { sourceName: 'a.dxf', blobId: 'b', kind: 'drawing', importUnits: 'mm' });
    expect(modelSummary(job.model)).toEqual({ sourceName: 'a.dxf', kind: 'drawing', format: 'dxf', body: null });
  });
});
