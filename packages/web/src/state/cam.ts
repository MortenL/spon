import type { ProgramRef } from '@sponcam/core';
import { toast } from 'sonner';
import type { StoreApi } from 'zustand/vanilla';
import { generateInWorker, setCamModelInWorker, workerEpoch } from '../workers/importClient';
import type { CamFile, CamRun, OperationSummary } from './camTypes';
import { programContext } from './programContext';
import { type AppState, appStore, type ModelGeometry, type ProgramData } from './store';

export const GEN_PREFIX = 'gen:';

export interface CamOutput {
  programs: ProgramRef[];
  files: CamFile[];
  results: Record<string, OperationSummary>;
  programData: Record<string, ProgramData>;
  catalog: CamRun['catalog'];
}

export const EMPTY_CAM_OUTPUT: CamOutput = { programs: [], files: [], results: {}, programData: {}, catalog: null };

export function toCamOutput(run: CamRun): CamOutput {
  const id = (name: string) => `${GEN_PREFIX}${name}`;
  return {
    programs: run.files.map((f) => ({ id: id(f.name), name: f.name, blobId: id(f.name), inTimeline: true, source: 'generated' as const, operationIds: f.operationIds })),
    files: run.files.map((f) => ({ name: f.name, blobId: id(f.name), operationIds: f.operationIds, sections: f.sections, postErrors: f.postErrors })),
    results: Object.fromEntries(run.results.map((r) => [r.operationId, r])),
    programData: Object.fromEntries(run.files.map((f) => [id(f.name), { status: 'ready' as const, text: f.text, parsed: f.parsed, error: null }])),
    catalog: run.catalog,
  };
}

let generation = 0;
let sentGeometry: ModelGeometry | null | undefined;
let sentEpoch = -1;

export async function regenerate(): Promise<void> {
  const gen = ++generation;
  const s = appStore.getState();
  const { job, geometry } = s;
  if (!job.operations.length) {
    if (s.generatedPrograms.length || Object.keys(s.camResults).length) s.setCamOutput(EMPTY_CAM_OUTPUT);
    else s.setCamStatus('idle');
    return;
  }
  s.setCamStatus('generating');
  /**
   * After an await: 'superseded' when a newer run started (it owns the status), 'changed' when the job or the
   * geometry changed since this run started (its output would be stale).
   */
  const check = () => {
    if (gen !== generation) return 'superseded';
    const now = appStore.getState();
    return now.job !== job || now.geometry !== geometry ? 'changed' : 'current';
  };
  try {
    // the worker keeps its own copy of the model; a replaced worker has lost it
    if (geometry !== sentGeometry || workerEpoch() !== sentEpoch) {
      const epoch = workerEpoch();
      await setCamModelInWorker(geometry);
      sentGeometry = geometry;
      sentEpoch = epoch;
    }
    const result = await generateInWorker(job, programContext(job, geometry));
    const state = check();
    if (state === 'superseded') return;
    if (state === 'changed') return regenerate(); // never leave the status at 'generating'
    appStore.getState().setCamOutput(toCamOutput(result));
  } catch (err) {
    const state = check();
    if (state === 'superseded') return;
    if (state === 'changed') return regenerate();
    appStore.getState().setCamStatus('idle');
    toast.error(`Toolpath generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Regenerates `delayMs` after anything that affects toolpaths changes, and once at start. Returns a stop function. */
export function startCamPipeline(store: StoreApi<AppState>, delayMs = 250): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    // the current output is out of date from now on: export refuses while generating
    if (store.getState().camStatus !== 'generating') store.getState().setCamStatus('generating');
    timer = setTimeout(() => void regenerate(), delayMs);
  };
  const unsubscribe = store.subscribe((s, prev) => {
    const a = s.job, b = prev.job;
    if (
      a.operations !== b.operations || a.tools !== b.tools || a.post !== b.post || a.tolerance !== b.tolerance || a.model !== b.model ||
      a.stock !== b.stock || a.wcs !== b.wcs || a.machine !== b.machine || a.displayUnits !== b.displayUnits || a.name !== b.name ||
      s.geometry !== prev.geometry
    ) schedule();
  });
  schedule();
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
