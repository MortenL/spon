import type { ProgramRef } from '@sponcam/core';
import type { AppState } from './store';

type ProgramSources = Pick<AppState, 'job' | 'generatedPrograms'>;
const cache = new WeakMap<readonly ProgramRef[], WeakMap<readonly ProgramRef[], ProgramRef[]>>();

/** Generated programs first (machining order), then imported ones. Same inputs → same array (safe in selectors). */
export function allPrograms(s: ProgramSources): ProgramRef[] {
  let inner = cache.get(s.generatedPrograms);
  if (!inner) cache.set(s.generatedPrograms, (inner = new WeakMap()));
  let list = inner.get(s.job.programs);
  if (!list) inner.set(s.job.programs, (list = [...s.generatedPrograms, ...s.job.programs]));
  return list;
}

export function findProgram(s: ProgramSources, id: string | null): ProgramRef | null {
  return id === null ? null : (allPrograms(s).find((p) => p.id === id) ?? null);
}
