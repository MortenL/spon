import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCommand, camContext, type CamGeometry, describeGeometry, importFile, type Job, resolveGeometry, setModel, createJob, setStock, type GeometryRef } from '../src';
import { camPartSetup } from './fixtures/camSetup';
import { terracedSetup } from './fixtures/slotSetup';
import { rectPts } from './fixtures/terraced.mjs';

function threadPlate() {
  const r = importFile('thread-plate.stl', readFileSync(new URL('./fixtures/thread-plate.stl', import.meta.url)));
  if (!r.ok || r.kind !== 'mesh') throw new Error('fixture did not import');
  const geometry: CamGeometry = { kind: 'mesh', mesh: r.mesh, adjacency: r.adjacency, rawPoints: r.mesh.positions };
  let job = setModel(createJob(), { sourceName: 'thread-plate.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' });
  job = setStock(job, { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 } });
  return { job, geometry };
}

function threadOp(job: Job, geometry: CamGeometry, kind: 'internal' | 'external', refs: GeometryRef[]) {
  let j = applyCommand(job, { type: 'addOperation', opType: 'thread', toolId: null, id: 't' });
  j = applyCommand(j, { type: 'updateOperation', id: 't', patch: { kind, geometry: refs } });
  return resolveGeometry(j.operations[0], camContext(j, geometry));
}

describe('thread geometry', () => {
  const { job, geometry } = threadPlate();
  const cat = describeGeometry(job, geometry);
  const boss = cat.bosses[0].ref;
  const hole = cat.holes[0].ref;

  it('catalogs one boss and one hole', () => {
    expect(cat.bosses).toHaveLength(1);
    expect(cat.bosses[0].ref.kind).toBe('meshBoss');
    expect(cat.bosses[0].diameter).toBeCloseTo(20, 2);
    expect(cat.bosses[0].center.x).toBeCloseTo(45, 2);
    expect(cat.bosses[0].center.y).toBeCloseTo(25, 2);
    expect(cat.bosses[0].top).toBeCloseTo(0, 9); // program XY includes the 5 mm stock margin; Z 0 = the boss top (model Z 18)
    expect(cat.holes).toHaveLength(1);
    expect(cat.holes[0].diameter).toBeCloseTo(6.8, 2);
    expect(cat.holes[0].top).toBeCloseTo(-8, 9); // plate top at model Z 10
    expect(cat.holes[0].through).toBe(true);
  });

  it('resolves an internal thread on the hole', () => {
    const r = threadOp(job, geometry, 'internal', [hole]);
    expect(r.diagnostics).toEqual([]);
    expect(r.holes).toHaveLength(1);
    expect(r.holes[0].diameter).toBeCloseTo(6.8, 2);
    expect(r.holes[0].through).toBe(true);
    expect(r.bosses).toHaveLength(0);
  });

  it('resolves an external thread on the boss', () => {
    const r = threadOp(job, geometry, 'external', [boss]);
    expect(r.diagnostics).toEqual([]);
    expect(r.bosses).toHaveLength(1);
    expect(r.bosses[0].diameter).toBeCloseTo(20, 2);
    expect(r.bosses[0].top).toBeCloseTo(0, 9);
  });

  it('rejects the wrong kind of feature', () => {
    expect(threadOp(job, geometry, 'internal', [boss]).diagnostics).toMatchObject([{ code: 'wrong-geometry', message: 'Internal threads need round holes' }]);
    expect(threadOp(job, geometry, 'external', [hole]).diagnostics).toMatchObject([{ code: 'wrong-geometry', message: 'External threads need round bosses' }]);
  });

  it('turns a drawing circle into a boss (external) or a hole (internal)', () => {
    const s = camPartSetup();
    const circle = describeGeometry(s.job, s.geometry).contours.find((c) => c.circle)!;
    const ext = threadOp(s.job, s.geometry, 'external', [circle.ref]);
    expect(ext.diagnostics).toEqual([]);
    expect(ext.bosses).toHaveLength(1);
    expect(ext.bosses[0].diameter).toBeCloseTo(circle.circle!.diameter, 6);
    expect(threadOp(s.job, s.geometry, 'internal', [circle.ref]).holes).toHaveLength(1);
  });
});

describe('a meshBoss needs walls that drop', () => {
  it('refuses the floor of a round pocket (ref-changed)', () => {
    const circle = Array.from({ length: 96 }, (_, i) => [30 + 8 * Math.cos((2 * Math.PI * i) / 96), 20 + 8 * Math.sin((2 * Math.PI * i) / 96)] as [number, number]);
    const s = terracedSetup(rectPts(0, 0, 60, 40), 10, [{ poly: circle, z: 5 }]);
    const floor = s.catalog().faces.at(-1)!;
    expect(floor.z).toBeLessThan(0);
    const r = threadOp(s.job, s.geometry, 'external', [{ kind: 'meshBoss', face: floor.ref }]);
    expect(r.bosses).toHaveLength(0);
    expect(r.diagnostics).toMatchObject([{ severity: 'error', code: 'ref-changed' }]);
  });
});
