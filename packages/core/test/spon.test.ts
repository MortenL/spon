import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import v1Job from './fixtures/job-v1.json';
import { SponFileError } from '../src/io/errors';
import { CURRENT_SCHEMA_VERSION, migrateJob } from '../src/io/migrations';
import { jobBlobIds, modelFilePath, programFilePath, readSpon, writeSpon } from '../src/io/spon';
import { createJob } from '../src/job/defaults';
import { addProgram } from '../src/job/programs';
import { setModel, setZSpin } from '../src/job/update';

const MODEL = new Uint8Array([1, 2, 3, 4, 5]);
const P1 = new TextEncoder().encode('G0 X0\n');
const P2 = new TextEncoder().encode('G1 X1 F100\n');

function fullJob() {
  let job = setZSpin(setModel(createJob('Bracket'), { sourceName: 'b.stl', blobId: 'abc', kind: 'mesh', importUnits: 'in' }), 12.5);
  job = addProgram(job, { name: 'rough.nc', blobId: 'p1' });
  job = addProgram(job, { name: 'finish.nc', blobId: 'p2' });
  return job;
}

describe('.spon files', () => {
  it('round-trips a job with a model and several programs', () => {
    const job = fullJob();
    const bytes = writeSpon(job, { abc: MODEL, p1: P1, p2: P2, unused: new Uint8Array([9]) });
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual(['job.json', 'models/abc.stl', 'programs/p1.nc', 'programs/p2.nc']);
    const read = readSpon(bytes);
    expect(read.job).toEqual(job);
    expect(read.blobs).toEqual({ abc: MODEL, p1: P1, p2: P2 });
  });

  it('round-trips a job without model or programs', () => {
    const job = createJob();
    expect(readSpon(writeSpon(job, {}))).toEqual({ job, blobs: {} });
  });

  it('names blob files and lists referenced blob ids', () => {
    const job = fullJob();
    expect(modelFilePath(job.model!)).toBe('models/abc.stl');
    expect(programFilePath(job.programs[0])).toBe('programs/p1.nc');
    expect(jobBlobIds(job)).toEqual(['abc', 'p1', 'p2']);
    expect(jobBlobIds(createJob())).toEqual([]);
  });

  it('refuses to write a job whose blobs are missing', () => {
    expect(() => writeSpon(fullJob(), { abc: MODEL, p1: P1 })).toThrow('Missing data for programs/p2.nc');
  });

  it('opens Milestone 1 files and migrates them', () => {
    const bytes = zipSync({ 'job.json': strToU8(JSON.stringify(v1Job)), 'models/b1.stl': MODEL });
    const read = readSpon(bytes);
    expect(read.job.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(read.blobs).toEqual({ b1: MODEL });
  });

  it('rejects broken files with clear messages', () => {
    expect(() => readSpon(new Uint8Array([1, 2, 3]))).toThrow('Not a Spon job file (invalid zip)');
    expect(() => readSpon(zipSync({ 'other.txt': strToU8('x') }))).toThrow('Not a Spon job file (job.json missing)');
    expect(() => readSpon(zipSync({ 'job.json': strToU8('{oops') }))).toThrow('job.json is not valid JSON');
    const job = fullJob();
    const missing = zipSync({ 'job.json': strToU8(JSON.stringify(job)), 'models/abc.stl': MODEL, 'programs/p1.nc': P1 });
    expect(() => readSpon(missing)).toThrow('programs/p2.nc is missing from the job file');
  });

  it('stores STEP and IGES models under their own extension and keeps format and body', () => {
    const job = setModel(createJob('Bracket'), { sourceName: 'b.stp', blobId: 'cad', kind: 'mesh', importUnits: 'mm', format: 'step', body: 2 });
    expect(modelFilePath(job.model!)).toBe('models/cad.step');
    expect(modelFilePath({ ...job.model!, format: 'iges' })).toBe('models/cad.iges');
    expect(modelFilePath({ sourceName: 'b.stl', blobId: 'cad', kind: 'mesh', importUnits: 'mm', transform: job.model!.transform })).toBe('models/cad.stl');
    const bytes = writeSpon(job, { cad: MODEL });
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual(['job.json', 'models/cad.step']);
    const back = readSpon(bytes);
    expect(back.job.model).toMatchObject({ format: 'step', body: 2, importUnits: 'mm' });
    expect(back.blobs.cad).toEqual(MODEL);
  });
});

describe('migrateJob', () => {
  it('refuses jobs from a newer schema', () => {
    expect(() => migrateJob({ ...createJob(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 })).toThrow(/newer version of Spon/);
  });

  it('rejects data without a valid schemaVersion or job shape', () => {
    expect(() => migrateJob(null)).toThrow(SponFileError);
    expect(() => migrateJob({ name: 'x' })).toThrow(/schemaVersion/);
    expect(() => migrateJob({ schemaVersion: 2, name: 'x' })).toThrow(/not a valid job/);
  });

  it('runs migrations in order up to the current version', () => {
    const current = createJob('Migrated');
    const { name, ...rest } = current;
    const v0 = { ...rest, schemaVersion: 0, title: name };
    const migrations = {
      0: (j: Record<string, unknown>) => {
        const { title, ...others } = j;
        return { ...others, name: title };
      },
    };
    expect(migrateJob(v0, migrations, 1)).toEqual({ ...current, schemaVersion: 1 });
  });

  it('fails when a migration step is missing', () => {
    expect(() => migrateJob({ ...createJob(), schemaVersion: 0 }, {}, 1)).toThrow('No migration from schema 0');
  });
});
