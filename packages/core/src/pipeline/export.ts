import { strToU8, zipSync } from 'fflate';
import type { CamDiagnostic } from '../cam/types';
import type { Diagnostic } from '../gcode/types';
import type { Job } from '../job/types';
import { sanitizeName } from '../post/format';
import type { CamRun } from './run';

export interface ExportFileInput { name: string; text: string; postErrors: readonly Diagnostic[]; analysisDiagnostics: readonly Diagnostic[] }
export interface ExportInput {
  jobName: string;
  operations: readonly { id: string; name: string }[];
  results: Readonly<Record<string, { diagnostics: readonly CamDiagnostic[] } | undefined>>;
  files: readonly ExportFileInput[];
}

/** Errors block an export; warnings need the user's confirmation (web) or are relayed (MCP); info notes do neither. */
export function exportProblems(input: ExportInput): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const op of input.operations) {
    for (const d of input.results[op.id]?.diagnostics ?? []) {
      if (d.severity !== 'info') (d.severity === 'error' ? errors : warnings).push(`${op.name}: ${d.message}`); // info is not a problem
    }
  }
  for (const f of input.files) {
    for (const d of f.postErrors) errors.push(`${f.name}: post-processor produced invalid G-code (${d.message})`);
    for (const d of f.analysisDiagnostics) warnings.push(`${f.name} line ${d.line + 1}: ${d.message}`);
  }
  if (!input.files.length) errors.push('Nothing to export: add operations with geometry');
  return { errors, warnings };
}

/** One file as it is, several as a zip named after the job. */
export function exportFiles(input: ExportInput): { name: string; bytes: Uint8Array } {
  const files = input.files;
  if (files.length === 1) return { name: files[0].name, bytes: strToU8(files[0].text) };
  return { name: `${sanitizeName(input.jobName)}.zip`, bytes: zipSync(Object.fromEntries(files.map((f) => [f.name, strToU8(f.text)]))) };
}

export function exportInputFromRun(job: Job, run: CamRun): ExportInput {
  return {
    jobName: job.name,
    operations: job.operations,
    results: Object.fromEntries(run.results.map((r) => [r.operationId, r])),
    files: run.files.map((f) => ({ name: f.name, text: f.text, postErrors: f.postErrors, analysisDiagnostics: f.parsed.analysis.diagnostics })),
  };
}
