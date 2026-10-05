import { type AxisValues, CUSTOM_MACHINE_NAME, type MachinePresetName, machinePreset } from './machine';
import type { Job } from './types';

export interface NewProgram {
  name: string;
  blobId: string;
}

export interface MachinePatch {
  rapid?: Partial<AxisValues>;
  accel?: Partial<AxisValues>;
  maxFeed?: number;
  toolChangeSeconds?: number;
  spoilboardAllowance?: number;
}

export function addProgram(job: Job, program: NewProgram): Job {
  return { ...job, programs: [...job.programs, { id: crypto.randomUUID(), name: program.name, blobId: program.blobId, inTimeline: true, source: 'imported' }] };
}

export function removeProgram(job: Job, id: string): Job {
  const programs = job.programs.filter((p) => p.id !== id);
  return programs.length === job.programs.length ? job : { ...job, programs };
}

export function moveProgram(job: Job, id: string, delta: -1 | 1): Job {
  const from = job.programs.findIndex((p) => p.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= job.programs.length) return job;
  const programs = [...job.programs];
  [programs[from], programs[to]] = [programs[to], programs[from]];
  return { ...job, programs };
}

export function setProgramInTimeline(job: Job, id: string, inTimeline: boolean): Job {
  const target = job.programs.find((p) => p.id === id);
  if (!target || target.inTimeline === inTimeline) return job;
  return { ...job, programs: job.programs.map((p) => (p.id === id ? { ...p, inTimeline } : p)) };
}

/** Any edit turns the profile into "Custom". */
export function setMachineProfile(job: Job, patch: MachinePatch): Job {
  if (Object.keys(patch).length === 0) return job;
  const m = job.machine;
  return {
    ...job,
    machine: {
      name: CUSTOM_MACHINE_NAME,
      rapid: { ...m.rapid, ...patch.rapid },
      accel: { ...m.accel, ...patch.accel },
      maxFeed: patch.maxFeed ?? m.maxFeed,
      toolChangeSeconds: patch.toolChangeSeconds ?? m.toolChangeSeconds,
      spoilboardAllowance: patch.spoilboardAllowance ?? m.spoilboardAllowance,
    },
  };
}

export function applyMachinePreset(job: Job, name: MachinePresetName): Job {
  return { ...job, machine: machinePreset(name) };
}
