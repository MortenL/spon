import { createJob, describeGeometry, type GeometryRef, importFile, setModel, setStock, toModelGeometry } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { catalogText, HandleMap } from '../src/handles';
import { fixture } from './helpers';

function plateCatalog() {
  const r = importFile('plate-pocket.stl', fixture('plate-pocket.stl'));
  if (!r.ok || r.kind !== 'mesh') throw new Error('fixture did not import');
  const job = setStock(setModel(createJob(), { sourceName: 'plate-pocket.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 } });
  return describeGeometry(job, toModelGeometry(r));
}

describe('HandleMap', () => {
  it('names faces, loops and holes and resolves them to refs', () => {
    const catalog = plateCatalog();
    const map = new HandleMap();
    const handled = map.assign(catalog);
    expect(handled.faces[0].handle).toBe('F1');
    expect(handled.faces[0].loops[0].handle).toBe('F1.L0');
    expect(handled.holes[0].handle).toBe('H1');
    expect(map.resolve('F1')).toEqual(catalog.faces[0].ref);
    expect(map.resolve(' f1.l0 ')).toEqual({ kind: 'meshLoop', face: catalog.faces[0].ref, loop: catalog.faces[0].loops[0].index });
    expect(map.resolve('h1')).toEqual(catalog.holes[0].ref);
  });

  it('passes full refs through and rejects unknown handles', () => {
    const map = new HandleMap();
    const ref: GeometryRef = { kind: 'dxfPath', blobId: 'd', layer: 0, path: 1 };
    expect(map.resolve(ref)).toBe(ref);
    expect(() => map.resolve('F9')).toThrow('Unknown handle F9 — call describe_geometry for the current list');
  });

  it('forgets old handles on assign and clear', () => {
    const map = new HandleMap();
    map.assign(plateCatalog());
    expect(map.size).toBeGreaterThan(0);
    map.assign({ faces: [], holes: [], contours: [] });
    expect(() => map.resolve('F1')).toThrow('Unknown handle F1');
    map.assign(plateCatalog());
    map.clear();
    expect(map.size).toBe(0);
  });

  it('describes the catalog as text', () => {
    const text = catalogText(new HandleMap().assign(plateCatalog()));
    expect(text).toMatch(/^F1 /m);
    expect(text).toContain('F1.L0 outer');
    expect(text).toMatch(/^H1 ⌀/m);
  });

  it('reverses a contour handle with a trailing !', () => {
    const map = new HandleMap();
    map.assign({ faces: [], holes: [], contours: [{ ref: { kind: 'dxfPath', blobId: 'b', layer: 0, path: 2 }, layer: 'L', closed: false, length: 10, bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } }, circle: null }] } as never);
    expect(map.resolve('C1!')).toEqual({ kind: 'dxfPath', blobId: 'b', layer: 0, path: 2, reverse: true });
    expect(map.resolve('c1')).toEqual({ kind: 'dxfPath', blobId: 'b', layer: 0, path: 2 });
    expect(() => map.resolve('F1!')).toThrow(/Unknown handle F1|Only drawing contours/);
  });
});
