import type { ExportOutcome } from '../bridge/protocol';
import type { ResolvedHeights } from '../cam/heights';
import type { CamDiagnostic } from '../cam/types';
import type { BBox } from '../geometry/bbox';
import type { Job } from '../job/types';
import { exportInputFromRun, exportProblems } from './export';
import type { CamRun } from './run';

export interface ReportOperation { operationId: string; diagnostics: CamDiagnostic[]; heights: ResolvedHeights | null; hasToolpath: boolean }
export interface ReportFile { name: string; text: string; operationIds: string[]; tools: number[]; lineCount: number; seconds: number; extents: BBox | null }
/** A CamRun without motion tables or overlays: plain JSON, so it can cross the live bridge. */
export interface RunReport { results: ReportOperation[]; files: ReportFile[]; export: { errors: string[]; warnings: string[] } }

export function runReport(job: Job, run: CamRun): RunReport {
  return {
    results: run.results.map(({ operationId, diagnostics, heights, hasToolpath }) => ({ operationId, diagnostics, heights, hasToolpath })),
    files: run.files.map((f) => {
      const { lineCount, totalSeconds, extents } = f.parsed.analysis.summary;
      return { name: f.name, text: f.text, operationIds: f.operationIds, tools: f.tools, lineCount, seconds: totalSeconds, extents };
    }),
    export: exportProblems(exportInputFromRun(job, run)),
  };
}

/** Errors block the export; warnings travel with the files. */
export function exportOutcome(report: RunReport): ExportOutcome {
  const { errors, warnings } = report.export;
  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, files: report.files.map(({ name, text }) => ({ name, text })), warnings };
}
