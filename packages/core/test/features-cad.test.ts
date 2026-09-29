import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyCommand, cadImport, camContext, type CamGeometry, createJob, describeGeometry, type OcctResult, resolveFaceRef, resolveGeometry, setModel, setStock,
} from '../src';
import { faceAt } from './fixtures/camSetup';

/** box-hole.step (20 × 10 × 5 box, Ø8 through hole at (10, 5)) as a job: identity orientation, 5 mm XY margin, no Z margin. */
function boxHoleSetup() {
  const rec: OcctResult = JSON.parse(readFileSync(new URL('./fixtures/box-hole.step.occt.json', import.meta.url), 'utf8'));
  const r = cadImport(rec, 'step');
  if (!r.ok || r.kind !== 'mesh') throw new Error('fixture did not import');
  const geometry: CamGeometry = { kind: 'mesh', mesh: r.mesh, adjacency: r.adjacency, rawPoints: r.mesh.positions };
  let job = setModel(createJob(), { sourceName: 'box-hole.step', blobId: 'm1', kind: 'mesh', importUnits: 'mm', format: 'step', body: 0 });
  job = setStock(job, { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 } });
  return { job, geometry, mesh: r.mesh };
}

describe('box-hole.step', () => {
  it('lists the top face with its Ø8 hole loop, and the hole as a through hole', () => {
    const { job, geometry } = boxHoleSetup();
    const cat = describeGeometry(job, geometry);
    expect(cat.faces).toHaveLength(1); // only the top face points up
    expect(cat.faces[0].loops.map((l) => l.kind)).toEqual(['outer', 'hole']);
    expect(cat.faces[0].loops[1].circle!.diameter).toBeCloseTo(8, 2);
    expect(Math.abs(cat.faces[0].area - (200 - Math.PI * 16))).toBeLessThan(0.5);
    expect(cat.holes).toHaveLength(1);
    const hole = cat.holes[0];
    expect(hole.diameter).toBeCloseTo(8, 2);
    expect(hole.through).toBe(true);
    expect(hole.top).toBeCloseTo(0, 6);
    expect(hole.bottom).toBeCloseTo(-5, 6);
  });

  it('a picked face is exactly the STEP face', () => {
    const { job, geometry, mesh } = boxHoleSetup();
    const ref = faceAt(geometry as CamGeometry & { kind: 'mesh' }, 2, 2, 5);
    const res = resolveFaceRef(camContext(job, geometry), ref);
    if (!res.ok) throw new Error(res.message);
    const top = mesh.faceIds![ref.seed];
    expect(res.face.tris.length).toBe(mesh.faceIds!.filter((id) => id === top).length);
    expect(res.face.tris.length).toBe(1444);
    expect(res.face.loops).toHaveLength(2);
  });

  it('drills the hole', () => {
    const { job, geometry } = boxHoleSetup();
    const hole = describeGeometry(job, geometry).holes[0];
    let j = applyCommand(job, { type: 'addOperation', opType: 'drill', toolId: null, id: 'd' });
    j = applyCommand(j, { type: 'updateOperation', id: 'd', patch: { geometry: [hole.ref] } });
    const drill = resolveGeometry(j.operations[0], camContext(j, geometry));
    expect(drill.diagnostics).toEqual([]);
    expect(drill.holes).toHaveLength(1);
    expect(drill.holes[0].diameter).toBeCloseTo(8, 2);
    expect(drill.holes[0].through).toBe(true);
    expect(drill.holes[0].bottom).toBeCloseTo(-5, 6);
  });
});
