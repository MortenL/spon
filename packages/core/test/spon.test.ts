import { unzipSync, zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { SponFileError } from '../src/io/errors';
import { migrateJob } from '../src/io/migrations';
import { modelFilePath, readSpon, writeSpon } from '../src/io/spon';
import { createJob } from '../src/job/defaults';
import { setModel, setZSpin } from '../src/job/update';

const MODEL = new Uint8Array([1, 2, 3, 4, 5]);

describe('.spon files', () => {
  it('round-trips a job with its model bytes', () => {
    const job = setZSpin(setModel(createJob('Bracket'), { sourceName: 'b.stl', blobId: 'abc', kind: 'mesh', importUnits: 'in' }), 12.5);
    const bytes = writeSpon(job, MODEL);
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual(['job.json', 'models/abc.stl']);
    const read = readSpon(bytes);
    expect(read.job).toEqual(job);
    expect(read.modelBytes).toEqual(MODEL);
  });

  it('round-trips a job without a model', () => {
    const job = createJob();
    expect(readSpon(writeSpon(job, null))).toEqual({ job, modelBytes: null });
  });

  it('names model files by blob id and kind', () => {
    const job = setModel(createJob(), { sourceName: 'p.dxf', blobId: 'd1', kind: 'drawing', importUnits: 'mm' });
    expect(modelFilePath(job.model!)).toBe('models/d1.dxf');
  });

  it('refuses a model job without model bytes', () => {
    const job = setModel(createJob(), { sourceName: 'b.stl', blobId: 'abc', kind: 'mesh', importUnits: 'mm' });
    expect(() => writeSpon(job, null)).toThrow(SponFileError);
  });

  it('rejects broken files with clear messages', () => {
    expect(() => readSpon(new Uint8Array([1, 2, 3]))).toThrow('Not a Spon job file (invalid zip)');
    expect(() => readSpon(zipSync({ 'other.txt': strToU8('x') }))).toThrow('Not a Spon job file (job.json missing)');
    expect(() => readSpon(zipSync({ 'job.json': strToU8('{oops') }))).toThrow('job.json is not valid JSON');
    const job = setModel(createJob(), { sourceName: 'b.stl', blobId: 'abc', kind: 'mesh', importUnits: 'mm' });
    const noModel = zipSync({ 'job.json': strToU8(JSON.stringify(job)) });
    expect(() => readSpon(noModel)).toThrow('models/abc.stl is missing');
  });
});

describe('migrateJob', () => {
  it('refuses jobs from a newer schema', () => {
    expect(() => migrateJob({ ...createJob(), schemaVersion: 2 })).toThrow(/newer version of Spon/);
  });

  it('rejects data without a valid schemaVersion or job shape', () => {
    expect(() => migrateJob(null)).toThrow(SponFileError);
    expect(() => migrateJob({ name: 'x' })).toThrow(/schemaVersion/);
    expect(() => migrateJob({ schemaVersion: 1, name: 'x' })).toThrow(/not a valid job/);
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
    expect(migrateJob(v0, migrations, 1)).toEqual(current);
  });

  it('fails when a migration step is missing', () => {
    expect(() => migrateJob({ ...createJob(), schemaVersion: 0 }, {}, 1)).toThrow('No migration from schema 0');
  });
});
