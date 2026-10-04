import { addClearingCommands as coreAddClearingCommands, type Job, type JobCommand, type Operation, type Tool } from '@sponcam/core';

/** The first enabled clearing operation that clears the given V-carve. */
export function clearingFor(job: Job, vcarveId: string): Operation | null {
  return job.operations.find((o) => o.type === 'vclear' && o.enabled && o.sourceId === vcarveId) ?? null;
}

/** Adds a clearing operation, links it to the V-carve and moves it to sit directly before it. */
export function addClearingCommands(job: Job, vcarveId: string, toolId: string | null, newId: string): JobCommand[] {
  return coreAddClearingCommands(job, vcarveId, toolId, newId);
}

/** The first flat tool in the job, else the first flat tool of the library. */
export function defaultClearingTool(job: Job, library: readonly Tool[]): Tool | null {
  return job.tools.find((t) => t.type === 'flat') ?? library.find((t) => t.type === 'flat') ?? null;
}

/** Which engrave depth field shows, and whether "Line width" may be chosen (it needs a V-bit). */
export function engraveModeUi(op: { depthMode: 'depth' | 'width' }, tool: Tool | null): { widthAllowed: boolean; showWidth: boolean } {
  return { widthAllowed: tool?.type === 'vbit', showWidth: op.depthMode === 'width' };
}

/** The whole "Add clearing operation" batch: the default tool is added first only when it is not in the job yet. */
export function addClearingBatch(job: Job, library: readonly Tool[], vcarveId: string, newId: string): JobCommand[] {
  const tool = defaultClearingTool(job, library);
  return [
    ...(tool && !job.tools.some((t) => t.id === tool.id) ? [{ type: 'addTool' as const, tool }] : []),
    ...addClearingCommands(job, vcarveId, tool?.id ?? null, newId),
  ];
}
