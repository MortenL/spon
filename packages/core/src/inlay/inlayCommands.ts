import type { JobCommand } from '../job/commands';
import type { Job } from '../job/types';

/** Adds a clearing operation for a V-carve or plug, links it to `sourceId` and moves it to sit directly before it. */
export function addClearingCommands(job: Job, sourceId: string, toolId: string | null, newId: string): JobCommand[] {
  const cmds: JobCommand[] = [
    { type: 'addOperation', opType: 'vclear', toolId, id: newId },
    { type: 'updateOperation', id: newId, patch: { sourceId } },
  ];
  const source = job.operations.findIndex((o) => o.id === sourceId);
  // appended at index job.operations.length; the source then sits at `source`
  const moves = source < 0 ? 0 : job.operations.length - source;
  for (let i = 0; i < moves; i++) cmds.push({ type: 'moveOperation', id: newId, delta: -1 });
  return cmds;
}
