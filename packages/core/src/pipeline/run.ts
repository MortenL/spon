import type { CamGeometry } from '../cam/context';
import { describeGeometry, type GeometryCatalog } from '../cam/features/describe';
import { GenerationCache, generateJob } from '../cam/generate';
import type { ResolvedHeights } from '../cam/heights';
import type { OpOverlays } from '../cam/ops/output';
import type { CamDiagnostic, Toolpath } from '../cam/types';
import { type ParsedProgram, parseProgram, type ProgramContext } from '../gcode/program';
import type { Diagnostic } from '../gcode/types';
import type { Job } from '../job/types';
import { EMPTY_FONTS, type FontSet } from '../text/fonts';
import { camContext } from '../cam/context';
import { textSummaries, type TextSummary } from '../text/resolve';
import { type PostOptions, postProcess, type PostSection } from '../post/engine';

export interface OperationSummary { operationId: string; diagnostics: CamDiagnostic[]; heights: ResolvedHeights | null; overlays: OpOverlays; hasToolpath: boolean }
export interface GeneratedFile { name: string; text: string; operationIds: string[]; tools: number[]; sections: PostSection[]; parsed: ParsedProgram; postErrors: Diagnostic[] }
export interface CamRun { results: OperationSummary[]; files: GeneratedFile[]; catalog: GeometryCatalog | null; texts: TextSummary[] }
/** `run` is what the web worker sends back; `toolpaths` stay with the caller (the MCP preview uses them). */
export interface PipelineResult { run: CamRun; toolpaths: Toolpath[] }

/** Per-operation results and the geometry catalog, kept between runs for one loaded model. */
export class PipelineCache {
  readonly generation = new GenerationCache();
  private catalogKey = '';
  private catalogGeometry: CamGeometry | null = null;
  private catalog: GeometryCatalog | null = null;

  catalogFor(job: Job, geometry: CamGeometry | null): GeometryCatalog | null {
    const key = JSON.stringify([job.model, job.stock, job.wcs, job.tolerance]);
    if (key !== this.catalogKey || geometry !== this.catalogGeometry) {
      this.catalog = geometry && job.model ? describeGeometry(job, geometry) : null;
      this.catalogKey = key;
      this.catalogGeometry = geometry;
    }
    return this.catalog;
  }
}

/** Generates every operation, posts, parses and analyses the files, and describes the geometry. */
export function runPipeline(job: Job, geometry: CamGeometry | null, ctx: ProgramContext, cache = new PipelineCache(), opts: PostOptions = {}, fonts: FontSet = EMPTY_FONTS): PipelineResult {
  const results = generateJob(job, geometry, cache.generation, fonts);
  const toolpaths = results.flatMap((r) => (r.toolpath ? [r.toolpath] : []));
  const encoder = new TextEncoder();
  const files = postProcess(job, toolpaths, opts).map((f) => {
    const parsed = parseProgram(encoder.encode(f.text), ctx);
    return { ...f, parsed, postErrors: parsed.interpretDiagnostics.filter((d) => d.severity === 'error') };
  });
  const summaries = results.map(({ operationId, diagnostics, heights, overlays, toolpath }) => ({ operationId, diagnostics, heights, overlays, hasToolpath: toolpath !== null }));
  return { run: { results: summaries, files, catalog: cache.catalogFor(job, geometry), texts: textSummaries(job, camContext(job, geometry, fonts)) }, toolpaths };
}
