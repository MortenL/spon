import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCommand, camContext, type CamGeometry, circleOf, describeGeometry, importFile, layFlat, pathArea, resolveFaceRef, resolveGeometry, vec3 } from '../src';
import { faceAt, plateSetup } from './fixtures/camSetup';

describe('plate-pocket.stl', () => {
  it('imports as a closed, manifold mesh', () => {
    const r = importFile('plate-pocket.stl', readFileSync(new URL('./fixtures/plate-pocket.stl', import.meta.url)));
    if (!r.ok || r.kind !== 'mesh') throw new Error('fixture did not import');
    expect(r.warnings).toEqual([]);
    expect(r.adjacency.openEdges).toBe(0);
    expect(r.adjacency.nonManifoldEdges).toBe(0);
  });
});

describe('mesh faces', () => {
  it('resolves the top face with its outer loop, pocket rim and two round holes', () => {
    const { job, geometry } = plateSetup();
    const ctx = camContext(job, geometry);
    const res = resolveFaceRef(ctx, faceAt(geometry as CamGeometry & { kind: 'mesh' }, 5, 5, 10));
    if (!res.ok) throw new Error(res.message);
    expect(res.face.z).toBeCloseTo(0, 9);
    expect(res.face.loops).toHaveLength(4);
    expect(pathArea(res.face.loops[0])).toBeCloseTo(4000, 3);
    const circles = res.face.loops.slice(1).map((l) => circleOf(l)).filter((c) => c !== null);
    expect(circles).toHaveLength(2);
    for (const c of circles) expect(c!.diameter).toBeCloseTo(8, 2);
    for (const l of res.face.loops.slice(1)) expect(pathArea(l)).toBeLessThan(0);
  });

  it('reports changed, non-horizontal and missing faces', () => {
    const { job, geometry } = plateSetup();
    const ctx = camContext(job, geometry);
    const top = faceAt(geometry as CamGeometry & { kind: 'mesh' }, 5, 5, 10);
    expect(resolveFaceRef(ctx, { ...top, normal: vec3(1, 0, 0) })).toMatchObject({ ok: false, code: 'ref-changed' });
    const nowhere = vec3(5, 5, 99);
    expect(resolveFaceRef(ctx, { ...top, seed: 1e9, point: nowhere })).toMatchObject({ ok: false, code: 'ref-missing' });
    expect(resolveFaceRef(ctx, { ...top, point: nowhere })).toMatchObject({ ok: false, code: 'ref-changed' });
    expect(resolveFaceRef(ctx, { ...top, blobId: 'other' })).toMatchObject({ ok: false, code: 'ref-missing' });
    const tipped = camContext(layFlat(job, vec3(1, 0, 0)), geometry); // the +X side now faces down
    expect(resolveFaceRef(tipped, top)).toMatchObject({ ok: false, code: 'face-not-horizontal' });
  });

  it('finds a face again by its point when the model was triangulated differently (a re-read STEP file)', () => {
    const { job, geometry } = plateSetup();
    const ctx = camContext(job, geometry);
    const mesh = geometry as CamGeometry & { kind: 'mesh' };
    const top = faceAt(mesh, 5, 5, 10);
    const floor = faceAt(mesh, 12, 17, 6);
    const expected = resolveFaceRef(ctx, top);
    if (!expected.ok) throw new Error(expected.message);
    // the old triangle number now lands on the pocket floor: same normal, different face
    const moved = resolveFaceRef(ctx, { ...top, seed: floor.seed });
    if (!moved.ok) throw new Error(moved.message);
    expect([...moved.face.tris].sort((a, b) => a - b)).toEqual([...expected.face.tris].sort((a, b) => a - b));
    // the old triangle number is past the end of the new mesh
    const gone = resolveFaceRef(ctx, { ...top, seed: 1e9 });
    if (!gone.ok) throw new Error(gone.message);
    expect(gone.face.tris.length).toBe(expected.face.tris.length);
  });
});

describe('resolveGeometry', () => {
  it('pocket from a face: outer loop plus islands; profile: outer loop; drill: the face holes', () => {
    const { job, geometry } = plateSetup();
    const floor = faceAt(geometry as CamGeometry & { kind: 'mesh' }, 12, 17, 6);
    let j = applyCommand(job, { type: 'addOperation', opType: 'pocket', toolId: null, id: 'p' });
    j = applyCommand(j, { type: 'updateOperation', id: 'p', patch: { geometry: [floor] } });
    const ctx = camContext(j, geometry);
    const pocket = resolveGeometry(j.operations[0], ctx);
    expect(pocket.diagnostics).toEqual([]);
    expect(pocket.shapes).toHaveLength(1);
    expect(pocket.shapes[0].z).toBeCloseTo(-4, 9);
    expect(pocket.shapes[0].shape.islands).toHaveLength(1);
    j = applyCommand(j, { type: 'addOperation', opType: 'drill', toolId: null, id: 'd' });
    j = applyCommand(j, { type: 'updateOperation', id: 'd', patch: { geometry: [floor, faceAt(geometry as CamGeometry & { kind: 'mesh' }, 5, 5, 10)] } });
    const drill = resolveGeometry(j.operations[1], camContext(j, geometry));
    expect(drill.holes.map((h) => [Math.round(h.diameter), h.through, Math.round(h.bottom)])).toEqual([[6, false, -7], [8, true, -10], [8, true, -10]]);
    expect(drill.holes[0].center.x).toBeCloseTo(30, 2);
    expect(drill.holes[0].center.y).toBeCloseTo(30, 2);
    expect(drill.holes[0].top).toBeCloseTo(-4, 9);
  });

  it('reports broken references per index and keeps the good ones', () => {
    const { job, geometry } = plateSetup();
    const floor = faceAt(geometry as CamGeometry & { kind: 'mesh' }, 12, 17, 6);
    let j = applyCommand(job, { type: 'addOperation', opType: 'profile', toolId: null, id: 'p' });
    j = applyCommand(j, { type: 'updateOperation', id: 'p', patch: { geometry: [{ ...floor, seed: 1e9, point: vec3(12, 17, 99) }, floor] } });
    const res = resolveGeometry(j.operations[0], camContext(j, geometry));
    expect(res.contours).toHaveLength(1);
    expect(res.diagnostics).toMatchObject([{ severity: 'error', code: 'ref-missing', ref: 0 }]);
  });
});

describe('describeGeometry', () => {
  it('lists up-facing faces top-down and the holes with depths', () => {
    const { job, geometry } = plateSetup();
    const cat = describeGeometry(job, geometry);
    expect(cat.faces.map((f) => Math.round(f.z))).toEqual([0, -4, -7]);
    expect(cat.faces[0].loops.map((l) => l.kind)).toEqual(['outer', 'hole', 'hole', 'hole']);
    // hole loops are fitted as true circles, so the face area is 80·50 − 30·20 − 2·π·4² (flattened at 0.01 mm)
    expect(Math.abs(cat.faces[0].area - (80 * 50 - 30 * 20 - 2 * Math.PI * 16))).toBeLessThan(1);
    expect(cat.holes.map((h) => [Math.round(h.diameter), h.through, Math.round(h.top), Math.round(h.bottom)]).sort()).toEqual(
      [[6, false, -4, -7], [8, true, 0, -10], [8, true, 0, -10]],
    );
    expect(cat.contours).toEqual([]);
  });
});
