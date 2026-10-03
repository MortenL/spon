import { applyCommand, camContext, type CamGeometry, createJob, describeGeometry, importFile, type JobCommand, type Operation, setModel, setStock } from '@sponcam/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { camPartSetup, faceAt, plateSetup } from '../../../core/test/fixtures/camSetup';
import { applyPick, connectedDxfRefs, pickDxf, pickMesh, pickSlot } from './camPick';

const op = (job: Parameters<typeof applyCommand>[0], type: Operation['type']) =>
  applyCommand(job, { type: 'addOperation', opType: type, toolId: null, id: 'o' } as JobCommand).operations[0];

describe('DXF picking', () => {
  const { job, geometry, layer } = camPartSetup();
  const ctx = camContext(job, geometry);

  it('picks a whole connected chain for profiles and pockets', () => {
    const refs = connectedDxfRefs(ctx, { kind: 'dxfPath', blobId: 'd1', layer: layer('POCKET'), path: 0 }, new Set());
    expect(refs.map((r) => r.path).sort()).toEqual([0, 1, 2, 3]);
    const r = pickDxf(op(job, 'pocket'), ctx, { x: 55, y: 25.2 }, new Set()); // on the pocket's bottom edge
    expect('refs' in r && r.refs).toHaveLength(4);
  });

  it('picks only circles for drilling', () => {
    expect(pickDxf(op(job, 'drill'), ctx, { x: 18.1, y: 15 }, new Set())).toEqual({ refs: [{ kind: 'dxfPath', blobId: 'd1', layer: layer('HOLES'), path: 0 }] });
    expect(pickDxf(op(job, 'drill'), ctx, { x: 5.1, y: 30 }, new Set())).toEqual({ error: 'Only circles can be drilled' });
    expect(pickDxf(op(job, 'drill'), ctx, { x: 60, y: 60 }, new Set())).toEqual({ error: 'Nothing to pick here' });
  });
});

describe('mesh picking', () => {
  const { job, geometry } = plateSetup();
  const ctx = camContext(job, geometry);
  const top = faceAt(geometry as never, 5, 5, 10);

  it('adds faces, loops and holes by operation type', () => {
    expect(pickMesh(op(job, 'pocket'), ctx, top.seed, { x: 10, y: 10 }, false)).toEqual({ refs: [top] });
    const hole = pickMesh(op(job, 'drill'), ctx, top.seed, { x: 64, y: 20 }, true); // next to the through hole at (65, 20)
    expect('refs' in hole && hole.refs[0]).toMatchObject({ kind: 'meshHole', loop: expect.any(Number) });
    const loop = pickMesh(op(job, 'profile'), ctx, top.seed, { x: 5.2, y: 30 }, true); // on the outer edge
    expect('refs' in loop && loop.refs[0]).toMatchObject({ kind: 'meshLoop', loop: 0 });
  });

  it('toggles references', () => {
    const o = { ...op(job, 'pocket'), geometry: [top] };
    expect(applyPick(o, [top])).toEqual([]);
    expect(applyPick({ ...o, geometry: [] }, [top])).toEqual([top]);
  });
});

describe('facing and chamfer picking rules', () => {
  const { job, geometry } = plateSetup();
  const ctx = camContext(job, geometry);
  it('refuses to pick for facing the stock', () => {
    const face = op(job, 'face');
    const top = faceAt(geometry as never, 5, 5, 10);
    expect(face.type === 'face' && face.area).toBe('stock');
    expect(pickMesh(face, ctx, top.seed, { x: 5, y: 5 }, false)).toMatchObject({ error: expect.stringContaining('Facing the stock') });
  });
  it('picks a round hole of a face as a meshHole for chamfers', () => {
    const top = faceAt(geometry as never, 5, 5, 10);
    const hole = pickMesh(op(job, 'chamfer'), ctx, top.seed, { x: 64, y: 20 }, true);
    expect('refs' in hole && hole.refs[0]).toMatchObject({ kind: 'meshHole' });
    const loop = pickMesh(op(job, 'chamfer'), ctx, top.seed, { x: 5.2, y: 30 }, true);
    expect('refs' in loop && loop.refs[0]).toMatchObject({ kind: 'meshLoop', loop: 0 });
  });
});

describe('slot picking', () => {
  const r = importFile('slot-plate.stl', readFileSync(new URL('../../../core/test/fixtures/slot-plate.stl', import.meta.url)));
  if (!r.ok || r.kind !== 'mesh') throw new Error('fixture did not import');
  const geometry: CamGeometry = { kind: 'mesh', mesh: r.mesh, adjacency: r.adjacency, rawPoints: r.mesh.positions };
  const job = setStock(setModel(createJob(), { sourceName: 'slot-plate.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 } });
  const ctx = camContext(job, geometry);
  const slot = describeGeometry(job, geometry).slots.find((s) => s.through)!; // the obround, centres (20,30)/(33.5,30)
  const top = faceAt(geometry as never, 5, 5, 10);
  // program XY: model corner at the origin plus the 5 mm margin is not applied to program X/Y of raw points, see slot start
  const inside = { x: (slot.start.x + slot.end.x) / 2, y: (slot.start.y + slot.end.y) / 2 };
  const slotOp = op(job, 'slot');

  it('picks the slot under the click, with or without Alt', () => {
    expect(slot.ref.kind).toBe('meshSlot');
    for (const alt of [false, true]) expect(pickMesh(slotOp, ctx, top.seed, inside, alt)).toEqual({ refs: [slot.ref] });
    expect(pickSlot(ctx, inside)).toEqual(slot.ref);
  });
  it('picks within 1 mm of the outline but not beyond', () => {
    expect(pickSlot(ctx, { x: inside.x, y: inside.y + slot.width / 2 + 0.5 })).toEqual(slot.ref);
    expect(pickSlot(ctx, { x: inside.x, y: inside.y + slot.width / 2 + 3 })).toBeNull();
  });
  it('refuses a click away from any slot', () => {
    const far = { x: inside.x, y: inside.y + 20 };
    expect(pickMesh(slotOp, ctx, top.seed, far, false)).toEqual({ error: 'Click a slot, or pick drawn centrelines' });
  });
});
