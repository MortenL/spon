import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importModel, OCCT_PARAMS, type OcctReader } from '../src';

const reader = { ReadStepFile: vi.fn(), ReadIgesFile: vi.fn() };
const loadReader = vi.fn(async () => reader as unknown as OcctReader);
const recorded = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.occt.json`, import.meta.url), 'utf8'));
const STL = new TextEncoder().encode(['solid t', 'facet normal 0 0 1', 'outer loop', 'vertex 0 0 0', 'vertex 2 0 0', 'vertex 0 1 0', 'endloop', 'endfacet', 'endsolid t'].join('\n'));
const BYTES = new Uint8Array([1, 2, 3]);

beforeEach(() => {
  vi.clearAllMocks();
  loadReader.mockImplementation(async () => reader as unknown as OcctReader);
});

describe('importModel', () => {
  it('never loads the reader for STL or DXF', async () => {
    const r = await importModel('part.stl', STL, {}, loadReader);
    expect(r.ok && r.kind).toBe('mesh');
    await importModel('part.dxf', new TextEncoder().encode('0\nEOF\n'), {}, loadReader);
    expect(loadReader).not.toHaveBeenCalled();
  });

  it('reads STEP with the fixed parameters and returns the body with its source', async () => {
    reader.ReadStepFile.mockReturnValue(recorded('box-hole.step'));
    const r = await importModel('bracket.STP', BYTES, {}, loadReader);
    expect(loadReader).toHaveBeenCalledOnce();
    expect(reader.ReadStepFile).toHaveBeenCalledWith(BYTES, OCCT_PARAMS);
    expect(reader.ReadIgesFile).not.toHaveBeenCalled();
    if (!r.ok || r.kind !== 'mesh') throw new Error('expected a mesh');
    expect(r.source).toEqual({ format: 'step', body: 0, bodies: 1, name: 'Bracket' });
  });

  it('reads IGES with ReadIgesFile', async () => {
    reader.ReadIgesFile.mockReturnValue(recorded('box.iges'));
    const r = await importModel('box.igs', BYTES, {}, loadReader);
    expect(reader.ReadIgesFile).toHaveBeenCalledWith(BYTES, OCCT_PARAMS);
    expect(r.ok && r.kind === 'mesh' && r.source?.format).toBe('iges');
  });

  it('lists bodies until one is chosen', async () => {
    reader.ReadStepFile.mockReturnValue(recorded('two-bodies.step'));
    const list = await importModel('two.step', BYTES, {}, loadReader);
    expect(list.ok && list.kind).toBe('bodies');
    const chosen = await importModel('two.step', BYTES, { body: 1 }, loadReader);
    expect(chosen.ok && chosen.kind === 'mesh' && chosen.source?.name).toBe('Large block');
  });

  it('reports reader crashes and load failures', async () => {
    reader.ReadStepFile.mockImplementation(() => { throw new Error('abort'); });
    expect(await importModel('bad.step', BYTES, {}, loadReader)).toEqual({ ok: false, error: 'Not a readable STEP file' });
    loadReader.mockRejectedValue(new Error('offline'));
    expect(await importModel('bad.iges', BYTES, {}, loadReader)).toEqual({ ok: false, error: 'Could not load the IGES reader: offline' });
  });

  it('keeps the tessellation parameters fixed', () => {
    expect(OCCT_PARAMS).toEqual({ linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: 0.01, angularDeflection: (0.5 * Math.PI) / 180 });
  });
});
