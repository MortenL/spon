import {
  type AnalysisContext, type AnalysisResult, analyzeTable, type CamGeometry, type CamRun, type GeometryCatalog, type ImportResult, importModel, importResultTransferables, type Job,
  type MotionTable, type ParsedProgram, parsedProgramTransferables, parseProgram, PipelineCache, type PreviewOptions, previewInput, type ProgramContext,
  renderPreviewSvg, runPipeline,
} from '@sponcam/core';
import * as Comlink from 'comlink';
import { loadOcct } from './occtReader';

let camGeometry: CamGeometry | null = null;
let pipeline = new PipelineCache();

const api = {
  async import(fileName: string, bytes: Uint8Array, body?: number): Promise<ImportResult> {
    const result = await importModel(fileName, bytes, body, loadOcct);
    return Comlink.transfer(result, importResultTransferables(result));
  },
  /** Loads the STEP/IGES reader ahead of reading, so the UI can say so; a no-op once loaded. */
  async loadCadReader(): Promise<void> {
    await loadOcct();
  },
  parseProgram(bytes: Uint8Array, ctx: ProgramContext): ParsedProgram {
    const parsed = parseProgram(bytes, ctx);
    return Comlink.transfer(parsed, parsedProgramTransferables(parsed));
  },
  /** Receives a copy of the table (structured clone), re-times it and returns only the new times and analysis. */
  analyze(table: MotionTable, lineFlags: Uint8Array, ctx: AnalysisContext): { analysis: AnalysisResult; t: Float64Array } {
    const analysis = analyzeTable(table, lineFlags, ctx);
    return Comlink.transfer({ analysis, t: table.t }, [table.t.buffer as ArrayBuffer]);
  },
  /** Keeps a copy of the loaded model for CAM (sent once per model load). */
  setCamModel(geometry: CamGeometry | null): void {
    camGeometry = geometry;
    pipeline = new PipelineCache();
  },
  /** Generates, posts, parses and analyses every operation; returns summaries, files and the geometry catalog. */
  generate(job: Job, ctx: ProgramContext): CamRun {
    const { run } = runPipeline(job, camGeometry, ctx, pipeline);
    return Comlink.transfer(run, run.files.flatMap((f) => parsedProgramTransferables(f.parsed)));
  },
  /** The geometry catalog for `job` and the model set with setCamModel (the live bridge's describe_geometry). */
  catalog(job: Job): GeometryCatalog | null {
    return pipeline.catalogFor(job, camGeometry);
  },
  /** The preview drawing of `job` (the live bridge's render_preview); cached operations make this cheap after a generate. */
  previewSvg(job: Job, ctx: ProgramContext, options: PreviewOptions): string {
    return renderPreviewSvg(previewInput(job, camGeometry, runPipeline(job, camGeometry, ctx, pipeline)), options);
  },
};

export type ImportWorkerApi = typeof api;

Comlink.expose(api);
