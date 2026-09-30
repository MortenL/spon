import { type ExportInput, exportFiles as filesOf, exportProblems as problemsOf } from '@sponcam/core';
import { toast } from 'sonner';
import { type AppState, appStore } from './store';

export type ExportState = Pick<AppState, 'job' | 'camResults' | 'camFiles' | 'programData'>;

export function toExportInput(s: ExportState): ExportInput {
  return {
    jobName: s.job.name,
    operations: s.job.operations,
    results: s.camResults,
    files: s.camFiles.map((f) => {
      const data = s.programData[f.blobId];
      return { name: f.name, text: data?.text ?? '', postErrors: f.postErrors, analysisDiagnostics: data?.parsed?.analysis.diagnostics ?? [] };
    }),
  };
}

export const exportProblems = (s: ExportState): { errors: string[]; warnings: string[] } => problemsOf(toExportInput(s));
export const exportFiles = (s: ExportState): { name: string; bytes: Uint8Array } => filesOf(toExportInput(s));

export function downloadBytes(name: string, bytes: Uint8Array): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart]));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Exports the generated G-code; errors block, warnings ask for confirmation. Resolves true when a download started. */
export async function exportGcode(confirm: (warnings: string[]) => Promise<boolean>): Promise<boolean> {
  const s = appStore.getState();
  if (s.camStatus === 'generating') {
    toast.info('Toolpaths are still being generated; try again in a moment');
    return false;
  }
  const { errors, warnings } = exportProblems(s);
  if (errors.length) {
    toast.error('Cannot export G-code', { description: errors.slice(0, 5).join('\n') + (errors.length > 5 ? `\n… and ${errors.length - 5} more` : '') });
    return false;
  }
  if (warnings.length) {
    if (!(await confirm(warnings))) return false;
    // the job may have changed while the dialog was open: never write output other than what was confirmed
    const now = appStore.getState();
    if (now.camStatus === 'generating' || now.camFiles !== s.camFiles) {
      toast.info('Toolpaths changed while you were confirming; review the warnings and export again');
      return false;
    }
  }
  const { name, bytes } = exportFiles(s);
  downloadBytes(name, bytes);
  return true;
}
