import type { Job, JobCommand, Operation, Tool } from '@sponcam/core';

/** The first enabled clearing operation that clears the given V-carve. */
export function clearingFor(job: Job, vcarveId: string): Operation | null {
  return job.operations.find((o) => o.type === 'vclear' && o.enabled && o.sourceId === vcarveId) ?? null;
}

/** Adds a clearing operation, links it to the V-carve and moves it to sit directly before it. */
export function addClearingCommands(job: Job, vcarveId: string, toolId: string | null, newId: string): JobCommand[] {
  const cmds: JobCommand[] = [
    { type: 'addOperation', opType: 'vclear', toolId, id: newId },
    { type: 'updateOperation', id: newId, patch: { sourceId: vcarveId } },
  ];
  const source = job.operations.findIndex((o) => o.id === vcarveId);
  // appended at index job.operations.length; the V-carve then sits at `source`
  const moves = source < 0 ? 0 : job.operations.length - source;
  for (let i = 0; i < moves; i++) cmds.push({ type: 'moveOperation', id: newId, delta: -1 });
  return cmds;
}

/** The first flat tool in the job, else the first flat tool of the library. */
export function defaultClearingTool(job: Job, library: readonly Tool[]): Tool | null {
  return job.tools.find((t) => t.type === 'flat') ?? library.find((t) => t.type === 'flat') ?? null;
}
