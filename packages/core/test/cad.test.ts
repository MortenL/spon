import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cadFormat, cadImport, fileKind, importFile, importResultTransferables, modelFormat, type OcctResult, occtToBodies, weldTriangles,
} from '../src';

const recorded = (name: string): OcctResult => JSON.parse(readFileSync(new URL(`./fixtures/${name}.occt.json`, import.meta.url), 'utf8'));

describe('model formats', () => {
  it('maps extensions to formats and kinds', () => {
    expect(['a.STEP', 'a.stp', 'a.iges', 'a.IGS', 'a.stl', 'a.dxf', 'a.obj', 'noext', 'a.constructor'].map(modelFormat))
      .toEqual(['step', 'step', 'iges', 'iges', 'stl', 'dxf', null, null, null]);
    expect(['a.step', 'a.igs', 'a.stl', 'a.dxf'].map(fileKind)).toEqual(['mesh', 'mesh', 'mesh', 'drawing']);
    expect(['a.stp', 'a.iges', 'a.stl'].map(cadFormat)).toEqual(['step', 'iges', null]);
  });

  it('leaves STEP/IGES reading to the worker', () => {
    const r = importFile('part.step', new Uint8Array([1]));
    expect(r.ok).toBe(false);
  });
});

describe('weldTriangles', () => {
  it('reports which soup triangle each output triangle came from', () => {
    const soup = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, // kept
      0, 0, 0, 0, 0, 0, 1, 1, 0, // degenerate
      1, 0, 0, 1, 1, 0, 0, 1, 0, // kept
    ]);
    const { mesh, degenerateRemoved, kept } = weldTriangles(soup);
    expect(degenerateRemoved).toBe(1);
    expect(Array.from(kept)).toEqual([0, 2]);
    expect(mesh.indices.length).toBe(6);
  });
});

describe('cadImport', () => {
  it('warns about faces the reader left without triangles', () => {
    const rec = recorded('box-hole.step');
    rec.meshes![0].brep_faces!.push({ first: 0, last: -1 }, { first: 0, last: -1 });
    const r = cadImport(rec, 'step');
    if (!r.ok || r.kind !== 'mesh') throw new Error('expected a mesh');
    expect(r.warnings).toContain('2 faces could not be meshed and are missing from the model');
    const clean = cadImport(recorded('box-hole.step'), 'step');
    expect(clean.ok && clean.kind === 'mesh' && clean.warnings).toEqual([]);
  });
});

describe('occtToBodies', () => {
  it('box-hole.step: one closed body whose face ids follow the B-rep face ranges', () => {
    const rec = recorded('box-hole.step');
    const bodies = occtToBodies(rec, 'step');
    expect(bodies).toHaveLength(1);
    const [b] = bodies;
    expect(b.name).toBe('Bracket');
    expect(b.triangles).toBe(592);
    expect(b.degenerateRemoved).toBe(0);
    expect(b.mesh.faceIds).toBe(b.faceIds);
    expect(b.faceIds.length).toBe(592);
    rec.meshes![0].brep_faces!.forEach((f, id) => {
      for (let t = f.first; t <= f.last; t++) expect(b.faceIds[t]).toBe(id);
    });
    expect(new Set(b.faceIds).size).toBe(7);
    expect(b.bbox.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(b.bbox.max.x).toBeCloseTo(20, 6);
    expect(b.bbox.max.y).toBeCloseTo(10, 6);
    expect(b.bbox.max.z).toBeCloseTo(5, 6);
  });

  it('two-bodies.step: one body per product, named after it', () => {
    const bodies = occtToBodies(recorded('two-bodies.step'), 'step');
    expect(bodies.map((b) => [b.name, b.triangles, new Set(b.faceIds).size])).toEqual([['Small block', 12, 6], ['Large block', 12, 6]]);
    expect(bodies[1].bbox.min.x).toBeCloseTo(30, 6);
  });

  it('box.iges: the per-face reader meshes become one body with six faces', () => {
    const bodies = occtToBodies(recorded('box.iges'), 'iges');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].name).toBe('Body 1');
    expect(bodies[0].triangles).toBe(12);
    expect(new Set(bodies[0].faceIds).size).toBe(6);
    expect(bodies[0].mesh.positions.length / 3).toBe(8); // welded across the face meshes
  });

  it('gives a triangle outside every face range a face of its own, and names unnamed bodies', () => {
    const result: OcctResult = {
      success: true,
      meshes: [{
        name: '',
        attributes: { position: { array: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] } },
        index: { array: [0, 1, 2, 0, 2, 3] },
        brep_faces: [{ first: 0, last: 0 }],
      }],
    };
    const [b] = occtToBodies(result, 'step');
    expect(b.name).toBe('Body 1');
    expect(Array.from(b.faceIds)).toEqual([0, 1]);
  });

  it('leaves mesh.faceIds undefined when no reader mesh has any brep_faces', () => {
    const result: OcctResult = {
      success: true,
      meshes: [{
        name: '',
        attributes: { position: { array: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] } },
        index: { array: [0, 1, 2, 0, 2, 3] },
      }],
    };
    const [b] = occtToBodies(result, 'step');
    expect(b.mesh.faceIds).toBeUndefined();
    expect(b.faceIds).toEqual(new Uint32Array(0));
  });
});

describe('cadImport', () => {
  it('imports a single-body file as a millimetre mesh with its source', () => {
    const r = cadImport(recorded('box-hole.step'), 'step');
    if (!r.ok || r.kind !== 'mesh') throw new Error('expected a mesh');
    expect(r.detectedUnits).toBe('mm');
    expect(r.source).toEqual({ format: 'step', body: 0, bodies: 1, name: 'Bracket' });
    expect(r.warnings).toEqual([]);
    expect(r.adjacency.openEdges).toBe(0);
    expect(r.adjacency.nonManifoldEdges).toBe(0);
    expect(r.mesh.faceIds?.length).toBe(r.mesh.indices.length / 3);
    expect(importResultTransferables(r)).toContain(r.mesh.faceIds!.buffer);
  });

  it('lists the bodies of a multi-body file unless one is chosen', () => {
    const rec = recorded('two-bodies.step');
    const list = cadImport(rec, 'step');
    if (!list.ok || list.kind !== 'bodies') throw new Error('expected a body list');
    expect(list.format).toBe('step');
    expect(list.bodies.map((b) => [b.name, b.triangles, b.size.x, b.size.y, b.size.z])).toEqual([['Small block', 12, 10, 10, 5], ['Large block', 12, 40, 20, 10]]);
    expect(importResultTransferables(list)).toEqual([]);

    const chosen = cadImport(rec, 'step', 1);
    if (!chosen.ok || chosen.kind !== 'mesh') throw new Error('expected a mesh');
    expect(chosen.source).toEqual({ format: 'step', body: 1, bodies: 2, name: 'Large block' });

    expect(cadImport(rec, 'step', 2)).toEqual({ ok: false, error: 'The STEP file has no body 3' });
  });

  it('reports unreadable files and files without bodies', () => {
    expect(cadImport({ success: false }, 'iges')).toEqual({ ok: false, error: 'Not a readable IGES file' });
    expect(cadImport({ success: true, meshes: [] }, 'step')).toEqual({ ok: false, error: 'No solid bodies found' });
    const degenerate: OcctResult = {
      success: true,
      meshes: [{ attributes: { position: { array: [0, 0, 0, 1, 0, 0, 2, 0, 0] } }, index: { array: [0, 1, 2] }, brep_faces: [{ first: 0, last: 0 }] }],
    };
    expect(cadImport(degenerate, 'step')).toEqual({ ok: false, error: 'No solid bodies found' });
  });
});
