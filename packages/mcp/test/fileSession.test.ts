import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createJob, type GeometryRef, type JobCommand, setModel, writeSpon } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { FileSession, type FileSessionOptions } from '../src/fileSession';
import { ToolLibraryFile } from '../src/library';
import { loadNodeOcct } from '../src/occt';
import { fixture, tempDir, tool6 } from './helpers';

const options = (): FileSessionOptions => ({ library: new ToolLibraryFile(join(tempDir(), 'tools.json')), loadReader: loadNodeOcct, postDate: '2026-01-01' });

async function profiledDxf() {
  const s = FileSession.create({ name: 'Part' }, options());
  expect((await s.importModel({ fileName: 'cam-part.dxf', bytes: fixture('cam-part.dxf') })).status).toBe('imported');
  const outline = (await s.catalog())!.contours.find((c) => c.layer === 'OUTLINE')!.ref as GeometryRef;
  const commands: JobCommand[] = [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'p' },
    { type: 'updateOperation', id: 'p', patch: { geometry: [outline] } },
  ];
  await s.apply(commands);
  return s;
}

describe('FileSession', () => {
  it('starts clean and needs a path for the first save', async () => {
    const s = FileSession.create({ name: 'New', dialect: 'fanuc', machinePreset: 'Generic VMC' }, options());
    expect(await s.describe()).toEqual({ kind: 'file', name: 'New', path: null, dirty: false, model: null, operations: 0 });
    expect((await s.job()).post.dialect).toBe('fanuc');
    expect((await s.job()).machine.name).toBe('Generic VMC');
    await expect(s.save()).rejects.toThrow('This job has not been saved yet — give a path');
  });

  it('imports, edits, generates, saves and reopens to the same job and G-code (review focus 2)', async () => {
    const s = await profiledDxf();
    const run = await s.run();
    expect(run.results[0].hasToolpath).toBe(true);
    const dir = tempDir();
    const path = await s.save(join(dir, 'part'));
    expect(path).toBe(join(dir, 'part.spon'));
    expect((await s.describe()).dirty).toBe(false);
    const reopened = await FileSession.open(path, options());
    expect(await reopened.job()).toEqual(await s.job());
    expect((await reopened.run()).files.map((f) => f.text)).toEqual(run.files.map((f) => f.text));
    expect((await reopened.describe()).path).toBe(path);
  });

  it('asks for a body, then reopens a STEP job through the Node reader (review focus 2)', async () => {
    const s = FileSession.create({}, options());
    const ask = await s.importModel({ fileName: 'two-bodies.step', bytes: fixture('two-bodies.step') });
    if (ask.status !== 'needsBody') throw new Error(`expected needsBody, got ${ask.status}`);
    expect(ask.bodies).toHaveLength(2);
    expect(ask.suggested).toBe(1);
    expect((await s.importModel({ fileName: 'two-bodies.step', bytes: fixture('two-bodies.step'), body: 1 })).status).toBe('imported');
    const path = await s.save(join(tempDir(), 'two.spon'));
    const reopened = await FileSession.open(path, options());
    expect((await reopened.describe()).model).toEqual({ sourceName: 'two-bodies.step', kind: 'mesh', format: 'step', body: 1 });
    expect((await reopened.catalog())!.faces.map((f) => f.ref)).toEqual((await s.catalog())!.faces.map((f) => f.ref));
  });

  it('asks for units when the file has none', async () => {
    const s = FileSession.create({}, options());
    const ask = await s.importModel({ fileName: 'plate-pocket.stl', bytes: fixture('plate-pocket.stl') });
    if (ask.status !== 'needsUnits') throw new Error(`expected needsUnits, got ${ask.status}`);
    expect(['mm', 'in']).toContain(ask.suggested);
    expect(ask.rawSize.x).toBeGreaterThan(0);
    const done = await s.importModel({ fileName: 'plate-pocket.stl', bytes: fixture('plate-pocket.stl'), units: 'mm' });
    if (done.status !== 'imported') throw new Error('expected imported');
    expect(done.size.x).toBeCloseTo(ask.rawSize.x, 3);
    expect((await s.describe()).dirty).toBe(true);
  });

  it('applies a batch atomically', async () => {
    const s = await profiledDxf();
    const before = await s.job();
    await expect(s.apply([
      { type: 'addOperation', opType: 'drill', toolId: null, id: 'd' },
      { type: 'updateOperation', id: 'nope', patch: { name: 'x' } },
    ])).rejects.toThrow('commands[1] updateOperation: No operation with id nope');
    expect(await s.job()).toBe(before);
  });

  it('warns when a new model replaces the one operations refer to', async () => {
    const s = await profiledDxf();
    const again = await s.importModel({ fileName: 'cam-part.dxf', bytes: fixture('cam-part.dxf') });
    if (again.status !== 'imported') throw new Error('expected imported');
    expect(again.warnings).toContain('1 operation(s) referred to the previous model; their geometry no longer resolves');
    expect((await s.run()).results[0].diagnostics[0].severity).toBe('error');
  });

  it('exports posted files and refuses while there are errors', async () => {
    const s = await profiledDxf();
    const ok = await s.exportGcode();
    if (!ok.ok) throw new Error(ok.errors.join('; '));
    expect(ok.files[0].name).toMatch(/\.nc$/);
    await s.apply([{ type: 'addOperation', opType: 'pocket', toolId: 't6', id: 'empty' }]);
    const blocked = await s.exportGcode();
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.errors.some((e) => e.includes('Pick geometry'))).toBe(true);
  });

  it('adds G-code programs that survive saving', async () => {
    const s = FileSession.create({}, options());
    const program = await s.importProgram('drill-arc.nc', fixture('drill-arc.nc'));
    expect(program).toMatchObject({ name: 'drill-arc.nc', source: 'imported', inTimeline: true });
    const reopened = await FileSession.open(await s.save(join(tempDir(), 'p.spon')), options());
    expect((await reopened.job()).programs).toEqual([program]);
  });

  it('names the file when opening fails', async () => {
    const missing = join(tempDir(), 'missing.spon');
    await expect(FileSession.open(missing, options())).rejects.toThrow(`Could not read ${missing}`);
    expect(existsSync(missing)).toBe(false);
  });

  it('describes the model and stock boxes and renders a preview', async () => {
    const s = await profiledDxf();
    const { model, stock } = await s.boxes();
    expect(stock!.max.x - stock!.min.x).toBeGreaterThan(model!.max.x - model!.min.x);
    expect(await s.previewSvg({ view: 'iso' })).toContain('<g id="op-0"');
  });

  it('saves over an existing file through a temporary file (finding 5)', async () => {
    const s = await profiledDxf();
    const dir = tempDir();
    const path = await s.save(join(dir, 'part'));
    await s.apply([{ type: 'renameJob', name: 'Renamed' }]);
    expect(await s.save()).toBe(path);
    expect(readdirSync(dir)).toEqual(['part.spon']);
    expect((await (await FileSession.open(path, options())).job()).name).toBe('Renamed');
  });

  it('names the file when its model cannot be loaded (finding 9)', async () => {
    const job = setModel(createJob('Bad'), { sourceName: 'bad.stl', blobId: 'b1', kind: 'mesh', importUnits: 'mm', format: 'stl' });
    const path = join(tempDir(), 'bad.spon');
    writeFileSync(path, writeSpon(job, { b1: new TextEncoder().encode('not an stl') }));
    await expect(FileSession.open(path, options())).rejects.toThrow(`${path}: `);
  });
});
