import { describe, expect, it } from 'vitest';
import { quatRotate } from '../src/geometry/quat';
import { v3near, v3normalize, vec3 } from '../src/geometry/vec3';
import { CURRENT_SCHEMA_VERSION } from '../src/io/migrations';
import { createJob, DEFAULT_AUTO_STOCK } from '../src/job/defaults';
import { normalizeDegrees, orientationQuat } from '../src/job/orientation';
import type { Job } from '../src/job/types';
import {
  alignEdgeToX, layFlat, renameJob, resetOrientation, rotateQuarter, setImportUnits, setModel, setWcs, setZSpin,
} from '../src/job/update';

const DOWN = vec3(0, 0, -1);

function meshJob(): Job {
  return setModel(createJob('Test'), { sourceName: 'part.stl', blobId: 'b1', kind: 'mesh', importUnits: 'mm' });
}
const orient = (job: Job) => orientationQuat(job.model!.transform);

describe('createJob', () => {
  it('uses the spec defaults', () => {
    const job = createJob();
    expect(job).toMatchObject({
      schemaVersion: CURRENT_SCHEMA_VERSION, name: 'Untitled', displayUnits: 'mm', model: null,
      stock: { mode: 'auto', margin: { xy: 5, zTop: 1, zBottom: 0 } },
      wcs: { anchor: { x: 'min', y: 'min', z: 'top' }, offset: { x: 0, y: 0, z: 0 }, workOffset: 'G54' },
    });
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(job.stock).not.toBe(DEFAULT_AUTO_STOCK);
  });
});

describe('simple updates', () => {
  it('renames with trimming and ignores empty names', () => {
    const job = createJob();
    expect(renameJob(job, '  Bracket ').name).toBe('Bracket');
    expect(renameJob(job, '   ')).toBe(job);
  });

  it('sets a model with identity orientation and changes its import units', () => {
    const job = meshJob();
    expect(job.model?.transform).toEqual({ base: { x: 0, y: 0, z: 0, w: 1 }, zDeg: 0 });
    expect(setImportUnits(job, 'in').model?.importUnits).toBe('in');
    expect(setImportUnits(job, 'mm')).toBe(job);
  });

  it('patches the WCS', () => {
    const job = setWcs(createJob(), { workOffset: 'G55' });
    expect(job.wcs.workOffset).toBe('G55');
    expect(job.wcs.anchor.z).toBe('top');
  });
});

describe('orientation', () => {
  it('normalises degrees into (-180, 180]', () => {
    expect(normalizeDegrees(270)).toBe(-90);
    expect(normalizeDegrees(-180)).toBe(180);
    expect(normalizeDegrees(540)).toBe(180);
    expect(setZSpin(meshJob(), 450).model?.transform.zDeg).toBe(90);
  });

  it('turns +90° about X so that +Y points up', () => {
    const job = rotateQuarter(meshJob(), 'x', 1);
    expect(v3near(quatRotate(orient(job), vec3(0, 1, 0)), vec3(0, 0, 1))).toBe(true);
  });

  it('turns about the machine axis as seen, even after a Z spin', () => {
    const spun = setZSpin(meshJob(), 90);
    const job = rotateQuarter(spun, 'x', 1);
    expect(job.model?.transform.zDeg).toBe(90);
    // expected orientation = Rx(90) · Rz(90): +X → +Y → +Z
    expect(v3near(quatRotate(orient(job), vec3(1, 0, 0)), vec3(0, 0, 1))).toBe(true);
  });

  it('lays the chosen face flat on the bed, for any prior orientation', () => {
    for (const setup of [(j: Job) => j, (j: Job) => rotateQuarter(j, 'y', -1), (j: Job) => setZSpin(rotateQuarter(j, 'x', 1), 33)]) {
      for (const normal of [vec3(0, -1, 0), v3normalize(vec3(1, 2, 3)), vec3(0, 0, -1), vec3(0, 0, 1)]) {
        const job = layFlat(setup(meshJob()), normal);
        expect(v3near(quatRotate(orient(job), normal), DOWN, 1e-9)).toBe(true);
      }
    }
  });

  it('keeps the Z spin when laying flat', () => {
    expect(layFlat(setZSpin(meshJob(), 30), vec3(1, 0, 0)).model?.transform.zDeg).toBe(30);
  });

  it('aligns an edge with X using the smaller rotation', () => {
    expect(alignEdgeToX(meshJob(), vec3(0, 0, 0), vec3(1, 1, 0)).model?.transform.zDeg).toBeCloseTo(-45, 9);
    expect(alignEdgeToX(meshJob(), vec3(0, 0, 0), vec3(-1, 1, 0)).model?.transform.zDeg).toBeCloseTo(45, 9);
    const spun = setZSpin(meshJob(), 10);
    expect(alignEdgeToX(spun, vec3(0, 0, 0), vec3(1, 0, 0)).model?.transform.zDeg).toBeCloseTo(0, 9);
  });

  it('ignores vertical edges and drawings', () => {
    const job = meshJob();
    expect(alignEdgeToX(job, vec3(0, 0, 0), vec3(0, 0, 5))).toBe(job);
    const drawing = setModel(createJob(), { sourceName: 'p.dxf', blobId: 'b2', kind: 'drawing', importUnits: 'mm' });
    expect(rotateQuarter(drawing, 'x', 1)).toBe(drawing);
    expect(layFlat(drawing, vec3(0, 1, 0))).toBe(drawing);
    expect(setZSpin(drawing, 15).model?.transform.zDeg).toBe(15);
  });

  it('resets orientation', () => {
    const job = resetOrientation(setZSpin(rotateQuarter(meshJob(), 'x', 1), 20));
    expect(job.model?.transform).toEqual({ base: { x: 0, y: 0, z: 0, w: 1 }, zDeg: 0 });
  });
});
