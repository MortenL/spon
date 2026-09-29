import type { ProgramRef } from '@sponcam/core';
import { toast } from 'sonner';
import type { StoreApi } from 'zustand/vanilla';
import { generateInWorker, setCamModelInWorker } from '../workers/importClient';
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

export async function regenerate(): Promise<void> {
  const gen = ++generation;
  const s = appStore.getState();
  if (!s.job.operations.length) {
    if (s.generatedPrograms.length || Object.keys(s.camResults).length) s.setCamOutput(EMPTY_CAM_OUTPUT);
    return;
  }
  s.setCamStatus('generating');
  try {
    if (s.geometry !== sentGeometry) {
      await setCamModelInWorker(s.geometry);
      sentGeometry = s.geometry;
    }
    const result = await generateInWorker(s.job, programContext(s.job, s.geometry));
    if (gen !== generation) return;
    appStore.getState().setCamOutput(toCamOutput(result));
  } catch (err) {
    if (gen !== generation) return;
    appStore.getState().setCamStatus('idle');
    toast.error(`Toolpath generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Regenerates `delayMs` after anything that affects toolpaths changes, and once at start. Returns a stop function. */
export function startCamPipeline(store: StoreApi<AppState>, delayMs = 250): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
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
