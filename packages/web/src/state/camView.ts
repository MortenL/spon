import { CommandError, type JobCommand, type Operation, type OperationType } from '@sponcam/core';
import { toast } from 'sonner';
import { type AppState, appStore } from './store';
import { defaultToolFor, toolLibraryStore } from './toolLibrary';

export type OperationStatus = 'generating' | 'ok' | 'warning' | 'error' | 'disabled';

export function operationStatus(op: Operation, s: Pick<AppState, 'camResults' | 'camStatus'>): OperationStatus {
  if (!op.enabled) return 'disabled';
  if (s.camStatus === 'generating') return 'generating';
  const d = s.camResults[op.id]?.diagnostics ?? [];
  return d.some((x) => x.severity === 'error') ? 'error' : d.some((x) => x.severity === 'warning') ? 'warning' : 'ok';
}

/** How many of these diagnostics are problems (warnings and errors); info rows are not. */
export function problemCount(diagnostics: readonly { severity: 'error' | 'warning' | 'info' }[]): number {
  return diagnostics.filter((d) => d.severity !== 'info').length;
}

/** Estimated seconds of an operation: sum of row durations whose source line lies in its section. */
export function operationSeconds(opId: string, s: Pick<AppState, 'camFiles' | 'programData'>): number | null {
  for (const f of s.camFiles) {
    const section = f.sections.find((x) => x.operationId === opId);
    const table = s.programData[f.blobId]?.parsed?.table;
    if (!section || !table) continue;
    let total = 0;
    for (let i = 0; i < table.count; i++) {
      const line = table.line[i];
      if (line >= section.firstLine && line <= section.lastLine) total += table.t[i] - (i > 0 ? table.t[i - 1] : 0);
    }
    return total;
  }
  return null;
}

export function runCommand(command: JobCommand): boolean {
  try {
    appStore.getState().dispatch(command);
    return true;
  } catch (err) {
    if (err instanceof CommandError) {
      toast.error(err.message);
      return false;
    }
    throw err;
  }
}

export function addOperation(type: OperationType): void {
  const s = appStore.getState();
  const lib = defaultToolFor(type, toolLibraryStore.getState().tools);
  const inJob = lib ? s.job.tools.find((t) => t.id === lib.id) : undefined;
  if (lib && !inJob && !runCommand({ type: 'addTool', tool: lib })) return;
  const id = crypto.randomUUID();
  if (!runCommand({ type: 'addOperation', opType: type, toolId: lib?.id ?? null, id })) return;
  const next = appStore.getState();
  next.selectOperation(id);
  next.setInspectorTab('geometry');
  next.setCamPick({ operationId: id, target: 'geometry' });
}
