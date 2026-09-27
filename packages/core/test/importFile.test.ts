import { describe, expect, it } from 'vitest';
import { fileKind, importFile, importResultTransferables } from '../src/import/importFile';
import { dxfText, line } from './fixtures/dxfBuilder';
import { binaryStl, boxTriangles } from './fixtures/stlBuilders';

describe('fileKind', () => {
  it('maps extensions case-insensitively', () => {
    expect(fileKind('part.STL')).toBe('mesh');
    expect(fileKind('plate.dxf')).toBe('drawing');
    expect(fileKind('job.spon')).toBeNull();
    expect(fileKind('noext')).toBeNull();
  });
});

describe('importFile', () => {
  it('imports STL with units left to the user', () => {
    const r = importFile('box.stl', binaryStl(boxTriangles(20, 10, 5)));
    expect(r.ok && r.kind).toBe('mesh');
    if (r.ok && r.kind === 'mesh') {
      expect(r.detectedUnits).toBeNull();
      expect(r.diagnostics.triangles).toBe(12);
      expect(importResultTransferables(r)).toHaveLength(4);
    }
  });

  it('imports DXF with detected units', () => {
    const r = importFile('plate.dxf', new TextEncoder().encode(dxfText({ insunits: 4, entities: [line('A', 0, 0, 1, 0)] })));
    expect(r.ok && r.kind === 'drawing' && r.detectedUnits).toBe('mm');
    expect(importResultTransferables(r)).toEqual([]);
  });

  it('reports errors instead of throwing', () => {
    expect(importFile('bad.stl', new TextEncoder().encode('nonsense'))).toEqual({
      ok: false,
      error: 'Not a valid STL file (neither binary nor ASCII)',
    });
    expect(importFile('x.obj', new Uint8Array())).toEqual({ ok: false, error: 'Unsupported file type: x.obj' });
  });
});
