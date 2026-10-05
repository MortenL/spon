import { describe, expect, it } from 'vitest';
import v1Job from './fixtures/job-v1.json';
import { CURRENT_SCHEMA_VERSION, migrateJob } from '../src/io/migrations';
import { createJob } from '../src/job/defaults';
import { DEFAULT_MACHINE_PRESET, MACHINE_PRESET_NAMES, machinePreset } from '../src/job/machine';
import {
  addProgram, applyMachinePreset, moveProgram, removeProgram, setMachineProfile, setProgramInTimeline,
} from '../src/job/programs';

const withPrograms = () => {
  let job = createJob();
  job = addProgram(job, { name: 'rough.nc', blobId: 'p1' });
  job = addProgram(job, { name: 'finish.nc', blobId: 'p2' });
  return job;
};

describe('machine presets', () => {
  it('has the two spec presets with exact values', () => {
    expect(MACHINE_PRESET_NAMES).toEqual(['Hobby GRBL router', 'Generic VMC']);
    expect(DEFAULT_MACHINE_PRESET).toBe('Hobby GRBL router');
    expect(machinePreset('Hobby GRBL router')).toEqual({
      name: 'Hobby GRBL router', rapid: { x: 5000, y: 5000, z: 1500 }, accel: { x: 500, y: 500, z: 200 }, maxFeed: 5000, toolChangeSeconds: 30, spoilboardAllowance: 0.5,
    });
    expect(machinePreset('Generic VMC')).toEqual({
      name: 'Generic VMC', rapid: { x: 30000, y: 30000, z: 24000 }, accel: { x: 3000, y: 3000, z: 2500 }, maxFeed: 12000, toolChangeSeconds: 5, spoilboardAllowance: 0.5,
    });
  });

  it('returns fresh copies', () => {
    const a = machinePreset('Generic VMC');
    a.rapid.x = 1;
    expect(machinePreset('Generic VMC').rapid.x).toBe(30000);
  });
});

describe('job v2', () => {
  it('creates jobs with the default machine and no programs', () => {
    const job = createJob();
    expect(job.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(job.machine).toEqual(machinePreset('Hobby GRBL router'));
    expect(job.programs).toEqual([]);
  });

  it('adds programs to the end of the timeline', () => {
    const job = withPrograms();
    expect(job.programs.map((p) => [p.name, p.blobId, p.inTimeline])).toEqual([['rough.nc', 'p1', true], ['finish.nc', 'p2', true]]);
    expect(job.programs[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(job.programs[0].id).not.toBe(job.programs[1].id);
  });

  it('removes, reorders and toggles programs', () => {
    const job = withPrograms();
    const [first, second] = job.programs;
    expect(removeProgram(job, first.id).programs.map((p) => p.name)).toEqual(['finish.nc']);
    expect(removeProgram(job, 'nope')).toBe(job);
    expect(moveProgram(job, second.id, -1).programs.map((p) => p.name)).toEqual(['finish.nc', 'rough.nc']);
    expect(moveProgram(job, first.id, -1)).toBe(job);
    expect(moveProgram(job, second.id, 1)).toBe(job);
    expect(setProgramInTimeline(job, first.id, false).programs[0].inTimeline).toBe(false);
    expect(setProgramInTimeline(job, first.id, true)).toBe(job);
  });

  it('edits the machine profile as Custom and applies presets', () => {
    const job = createJob();
    const edited = setMachineProfile(job, { rapid: { z: 2000 }, maxFeed: 6000 });
    expect(edited.machine).toEqual({ ...machinePreset('Hobby GRBL router'), name: 'Custom', rapid: { x: 5000, y: 5000, z: 2000 }, maxFeed: 6000 });
    expect(applyMachinePreset(edited, 'Generic VMC').machine).toEqual(machinePreset('Generic VMC'));
    expect(setMachineProfile(job, { spoilboardAllowance: 1 }).machine.spoilboardAllowance).toBe(1);
    expect(setMachineProfile(job, {})).toBe(job);
  });
});

describe('migration v8 → v9', () => {
  it('gives the machine profile a 0.5 mm spoilboard allowance', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(9);
    const { spoilboardAllowance: _, ...machine } = createJob().machine;
    const v8 = { ...createJob(), machine, schemaVersion: 8 };
    expect(migrateJob(v8)).toEqual({ ...v8, machine: { ...machine, spoilboardAllowance: 0.5 }, schemaVersion: 9 });
  });
});

describe('migration v1 → v2', () => {
  it('upgrades a Milestone 1 job', () => {
    const job = migrateJob(v1Job);
    expect(job.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(job.machine).toEqual(machinePreset('Hobby GRBL router'));
    expect(job.programs).toEqual([]);
    expect(job.model?.blobId).toBe('b1');
    expect(job.name).toBe('Bracket');
  });
});
