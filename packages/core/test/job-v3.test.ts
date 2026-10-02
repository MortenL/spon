import { describe, expect, it } from 'vitest';
import { addProgram, createJob, CURRENT_SCHEMA_VERSION, DEFAULT_TOLERANCE, defaultPostSettings, migrateJob, readSpon, writeSpon } from '../src';
import v1Job from './fixtures/job-v1.json';

describe('job schema v3', () => {
  it('creates v3 jobs with empty CAM data and GRBL post defaults', () => {
    const job = createJob();
    expect(job.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(job.tools).toEqual([]);
    expect(job.operations).toEqual([]);
    expect(job.post).toEqual(defaultPostSettings('grbl'));
    expect(job.tolerance).toBe(DEFAULT_TOLERANCE);
    expect(DEFAULT_TOLERANCE).toBe(0.002);
  });

  it('marks added programs as imported', () => {
    const job = addProgram(createJob(), { name: 'a.nc', blobId: 'p1' });
    expect(job.programs[0].source).toBe('imported');
  });

  it('migrates v2 jobs: programs become imported, CAM fields get defaults', () => {
    const { tools: _t, operations: _o, post: _p, tolerance: _tol, ...rest } = createJob('Old');
    const v2 = { ...rest, schemaVersion: 2, programs: [{ id: 'x', name: 'a.nc', blobId: 'p1', inTimeline: true }] };
    const job = migrateJob(v2);
    expect(job.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(job.programs[0]).toEqual({ id: 'x', name: 'a.nc', blobId: 'p1', inTimeline: true, source: 'imported' });
    expect(job.tools).toEqual([]);
    expect(job.operations).toEqual([]);
    expect(job.post).toEqual(defaultPostSettings('grbl'));
    expect(job.tolerance).toBe(0.002);
  });

  it('migrates v1 jobs all the way to v3', () => {
    const job = migrateJob(v1Job);
    expect(job.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(job.operations).toEqual([]);
  });

  it('round-trips CAM fields through .spon', () => {
    const job = { ...createJob(), tolerance: 0.01, post: defaultPostSettings('fanuc') };
    expect(readSpon(writeSpon(job, {})).job).toEqual(job);
  });

  it('gives each dialect its defaults', () => {
    expect(defaultPostSettings('grbl').splitByTool).toBe(true);
    expect(defaultPostSettings('linuxcnc').splitByTool).toBe(false);
    expect(defaultPostSettings('fanuc')).toMatchObject({ splitByTool: false, safeStart: 'G40 G49 G80', programNumber: 1000 });
  });

  it('rejects v3 data without the CAM fields', () => {
    const { operations: _o, ...broken } = createJob();
    expect(() => migrateJob(broken)).toThrow(/not a valid job/);
  });
});
