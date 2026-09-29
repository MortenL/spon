import {
  type AnalysisContext, type AnalysisResult, analyzeTable, type CamGeometry, describeGeometry, GenerationCache, generateJob, type GeometryCatalog,
  type ImportResult, importResultTransferables, type Job, type MotionTable, type ParsedProgram, parsedProgramTransferables, parseProgram,
  postProcess, type ProgramContext,
} from '@sponcam/core';
import * as Comlink from 'comlink';
import type { CamRun } from '../state/camTypes';
import { importModel } from './modelImport';
import { loadOcct } from './occtReader';

let camGeometry: CamGeometry | null = null;
const camCache = new GenerationCache();
let catalogKey = '';
let catalog: GeometryCatalog | null = null;

const api = {
  async import(fileName: string, bytes: Uint8Array, body?: number): Promise<ImportResult> {
    const result = await importModel(fileName, bytes, body);
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
    catalogKey = '';
  },
  /** Generates, posts, parses and analyses every operation; returns summaries, files and the geometry catalog. */
  generate(job: Job, ctx: ProgramContext): CamRun {
    const results = generateJob(job, camGeometry, camCache);
    const toolpaths = results.flatMap((r) => (r.toolpath ? [r.toolpath] : []));
    const files = postProcess(job, toolpaths).map((f) => {
      const parsed = parseProgram(new TextEncoder().encode(f.text), ctx);
      return { ...f, parsed, postErrors: parsed.interpretDiagnostics.filter((d) => d.severity === 'error') };
    });
    const key = JSON.stringify([job.model, job.stock, job.wcs, job.tolerance]);
    if (key !== catalogKey) {
      catalog = camGeometry && job.model ? describeGeometry(job, camGeometry) : null;
      catalogKey = key;
    }
    const summaries = results.map(({ operationId, diagnostics, heights, overlays, toolpath }) => ({ operationId, diagnostics, heights, overlays, hasToolpath: toolpath !== null }));
    return Comlink.transfer({ results: summaries, files, catalog }, files.flatMap((f) => parsedProgramTransferables(f.parsed)));
  },
};

export type ImportWorkerApi = typeof api;

Comlink.expose(api);
