import type { AnalysisContext, AnalysisResult, CamGeometry, ImportResult, Job, MotionTable, ParsedProgram, ProgramContext } from '@sponcam/core';
import * as Comlink from 'comlink';
import type { CamRun } from '../state/camTypes';
import type { ImportWorkerApi } from './import.worker';
import { withTimeout } from './timeout';

/** A parse still running after this long is assumed stuck; its worker is terminated. */
export const IMPORT_TIMEOUT_MS = 120_000;

let instance: Worker | null = null;
let remote: Comlink.Remote<ImportWorkerApi> | null = null;
let epoch = 0;

/**
 * Changes whenever the shared worker is terminated (a stuck call timed out). The next call gets a fresh
 * worker that has lost any state, such as the CAM model.
 */
export function workerEpoch(): number {
  return epoch;
}

function worker(): { worker: Worker; api: Comlink.Remote<ImportWorkerApi> } {
  if (!instance || !remote) {
    instance = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
    remote = Comlink.wrap<ImportWorkerApi>(instance);
  }
  return { worker: instance, api: remote };
}

/** Runs one worker call with the stuck-worker timeout; on timeout the worker is terminated and replaced. */
function run<T>(call: (api: Comlink.Remote<ImportWorkerApi>) => Promise<T>, message: string): Promise<T> {
  const { worker: current, api } = worker();
  const terminate = () => {
    current.terminate();
    if (instance === current) {
      instance = null;
      remote = null;
      epoch++;
    }
  };
  return withTimeout<T>(call(api), IMPORT_TIMEOUT_MS, terminate, message);
}

/** Parses a model file off the main thread. Sends a copy of `bytes`, so the caller can keep using them. */
export function importInWorker(fileName: string, bytes: Uint8Array): Promise<ImportResult> {
  const copy = bytes.slice();
  return run<ImportResult>((api) => api.import(fileName, Comlink.transfer(copy, [copy.buffer])), 'Import timed out');
}

/** Parses and analyses a G-code program off the main thread (bytes are copied). */
export function parseProgramInWorker(bytes: Uint8Array, ctx: ProgramContext): Promise<ParsedProgram> {
  const copy = bytes.slice();
  return run((api) => api.parseProgram(Comlink.transfer(copy, [copy.buffer]), ctx), 'Parsing the program timed out');
}

/** Re-times and re-analyses a program; the table is copied to the worker, only the new times come back. */
export function analyzeInWorker(table: MotionTable, lineFlags: Uint8Array, ctx: AnalysisContext): Promise<{ analysis: AnalysisResult; t: Float64Array }> {
  return run((api) => api.analyze(table, lineFlags, ctx), 'Analysing the program timed out');
}

/** Copies the model into the worker for CAM (the main thread keeps its own). */
export function setCamModelInWorker(geometry: CamGeometry | null): Promise<void> {
  return run((api) => api.setCamModel(geometry), 'Sending the model to the CAM worker timed out');
}

export function generateInWorker(job: Job, ctx: ProgramContext): Promise<CamRun> {
  return run((api) => api.generate(job, ctx), 'Generating toolpaths timed out');
}
