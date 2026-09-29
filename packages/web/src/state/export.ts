import { sanitizeName } from '@sponcam/core';
import { strToU8, zipSync } from 'fflate';
import { toast } from 'sonner';
import { type AppState, appStore } from './store';

export type ExportState = Pick<AppState, 'job' | 'camResults' | 'camFiles' | 'programData'>;

export function exportProblems(s: ExportState): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const op of s.job.operations) {
    for (const d of s.camResults[op.id]?.diagnostics ?? []) (d.severity === 'error' ? errors : warnings).push(`${op.name}: ${d.message}`);
  }
  for (const f of s.camFiles) {
    for (const d of f.postErrors) errors.push(`${f.name}: post-processor produced invalid G-code (${d.message})`);
    for (const d of s.programData[f.blobId]?.parsed?.analysis.diagnostics ?? []) warnings.push(`${f.name} line ${d.line + 1}: ${d.message}`);
  }
  if (!s.camFiles.length) errors.push('Nothing to export: add operations with geometry');
  return { errors, warnings };
}

export function exportFiles(s: ExportState): { name: string; bytes: Uint8Array } {
  const files = s.camFiles.map((f) => ({ name: f.name, text: s.programData[f.blobId]?.text ?? '' }));
  if (files.length === 1) return { name: files[0].name, bytes: strToU8(files[0].text) };
  return { name: `${sanitizeName(s.job.name)}.zip`, bytes: zipSync(Object.fromEntries(files.map((f) => [f.name, strToU8(f.text)]))) };
}

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
