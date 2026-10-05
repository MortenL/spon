import { describe, expect, it } from 'vitest';
import { applyCommand, createJob, migrateJob, MIGRATIONS, threadRow } from '../src';
import { tool6 } from './fixtures/camSetup';

const base = () => applyCommand(createJob(), { type: 'addOperation', opType: 'thread', toolId: null, id: 't' });
const update = (patch: object, job = base()) => applyCommand(job, { type: 'updateOperation', id: 't', patch: patch as never });

describe('thread job model', () => {
  it('migrates schema 7 jobs to 8 unchanged', () => {
    const v7 = { ...createJob(), schemaVersion: 7 };
    expect(migrateJob(v7, MIGRATIONS, 8)).toEqual({ ...v7, schemaVersion: 8 });
  });

  it('adds a thread operation with defaults', () => {
    const job = applyCommand(applyCommand(createJob(), { type: 'addTool', tool: tool6 }), { type: 'addOperation', opType: 'thread', toolId: tool6.id, id: 't' });
    const m8 = threadRow('iso-coarse', 'M8')!;
    expect(job.operations[0]).toMatchObject({
      type: 'thread', name: 'Thread 1', kind: 'internal', hand: 'right', length: 10, allowance: 0, passes: 1, springPass: false,
      direction: 'climb', feedCompensation: true,
      thread: { standard: 'iso-coarse', size: 'M8', majorDiameter: m8.majorDiameter, pitch: m8.pitch, angle: m8.angle },
    });
  });

  it('fills a table thread from the table', () => {
    const job = update({ thread: { standard: 'unc', size: '1/4-20', majorDiameter: 1, pitch: 1, angle: 1 } });
    expect(job.operations[0]).toMatchObject({ thread: { standard: 'unc', size: '1/4-20', majorDiameter: 6.35, pitch: 1.27, angle: 60 } });
  });

  it('accepts a custom thread and other settings', () => {
    const job = update({ thread: { standard: 'custom', size: null, majorDiameter: 40, pitch: 4, angle: 60 }, kind: 'external', hand: 'left', direction: 'conventional', passes: 3, springPass: true, allowance: -0.1, length: 12 });
    expect(job.operations[0]).toMatchObject({ thread: { standard: 'custom', size: null, majorDiameter: 40, pitch: 4, angle: 60 }, kind: 'external', hand: 'left', passes: 3, length: 12 });
  });

  it('refuses invalid values', () => {
    const custom = { standard: 'custom', size: null, majorDiameter: 40, pitch: 4, angle: 60 };
    expect(() => update({ thread: { ...custom, standard: 'unc', size: '9/9-99' } })).toThrow('Unknown thread size 9/9-99');
    expect(() => update({ thread: { standard: 'unc' } as never })).toThrow('thread.size is required for a table standard');
    expect(() => update({ thread: { standard: 'iso-coarse', size: null } })).toThrow('thread.size is required for a table standard');
    // a table row needs no dimensions: they come from the table
    expect(update({ thread: { standard: 'iso-coarse', size: 'M10' } }).operations[0]).toMatchObject({ thread: { size: 'M10', majorDiameter: 10, pitch: 1.5, angle: 60 } });
    expect(() => update({ thread: { ...custom, standard: 'bogus' } })).toThrow();
    expect(() => update({ thread: { ...custom, pitch: 0 } })).toThrow();
    expect(() => update({ thread: { ...custom, angle: 180 } })).toThrow();
    expect(() => update({ thread: { ...custom, angle: 0 } })).toThrow();
    expect(() => update({ thread: { ...custom, majorDiameter: 0 } })).toThrow();
    expect(() => update({ thread: { ...custom, size: 'M8' } })).toThrow();
    expect(() => update({ passes: 1.5 })).toThrow();
    expect(() => update({ passes: 0 })).toThrow();
    expect(() => update({ length: 0 })).toThrow();
    expect(() => update({ allowance: Infinity })).toThrow();
    expect(() => update({ kind: 'sideways' })).toThrow();
    expect(() => update({ hand: 'up' })).toThrow();
    expect(() => update({ direction: 'sideways' })).toThrow();
    expect(() => update({ stepdown: 1 })).toThrow();
  });

  it('accepts a meshBoss reference in geometry', () => {
    const face = { kind: 'meshFace' as const, blobId: 'b', seed: 1, normal: { x: 0, y: 0, z: 1 }, point: { x: 0, y: 0, z: 0 } };
    const job = update({ geometry: [{ kind: 'meshBoss', face }] });
    expect(job.operations[0].geometry).toEqual([{ kind: 'meshBoss', face }]);
  });
});
