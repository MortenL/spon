import { type GeometryCatalog, type Job, type PreviewOptions, programContext, type ProgramRef } from '@sponcam/core';
import { toast } from 'sonner';
import type { StoreApi } from 'zustand/vanilla';
import { addFontsInWorker, catalogInWorker, generateInWorker, previewSvgInWorker, setCamModelInWorker, workerEpoch } from '../workers/importClient';
import type { CamFile, CamRun, OperationSummary } from './camTypes';
import { type AppState, appStore, type ModelGeometry, type ProgramData } from './store';

export const GEN_PREFIX = 'gen:';

export interface CamOutput {
  programs: ProgramRef[];
  files: CamFile[];
  results: Record<string, OperationSummary>;
  programData: Record<string, ProgramData>;
  catalog: CamRun['catalog'];
  texts: CamRun['texts'];
}

export const EMPTY_CAM_OUTPUT: CamOutput = { programs: [], files: [], results: {}, programData: {}, catalog: null, texts: [] };

export function toCamOutput(run: CamRun): CamOutput {
  const id = (name: string) => `${GEN_PREFIX}${name}`;
  return {
    programs: run.files.map((f) => ({ id: id(f.name), name: f.name, blobId: id(f.name), inTimeline: true, source: 'generated' as const, operationIds: f.operationIds })),
    files: run.files.map((f) => ({ name: f.name, blobId: id(f.name), operationIds: f.operationIds, sections: f.sections, postErrors: f.postErrors })),
    results: Object.fromEntries(run.results.map((r) => [r.operationId, r])),
    programData: Object.fromEntries(run.files.map((f) => [id(f.name), { status: 'ready' as const, text: f.text, parsed: f.parsed, error: null }])),
    catalog: run.catalog,
    texts: run.texts,
  };
}

export const EMPTY_RUN: CamRun = { results: [], files: [], catalog: null, texts: [] };

/** True when the change from (a, ga) to (b, gb) can change the toolpaths: what triggers regeneration. */
export function camInputsChanged(a: Job, b: Job, ga: ModelGeometry | null, gb: ModelGeometry | null): boolean {
  return (
    a.operations !== b.operations || a.texts !== b.texts || a.tools !== b.tools || a.post !== b.post || a.tolerance !== b.tolerance || a.model !== b.model ||
    a.stock !== b.stock || a.wcs !== b.wcs || a.machine !== b.machine || a.displayUnits !== b.displayUnits || a.name !== b.name || ga !== gb
  );
}

let generation = 0;
let sentGeometry: ModelGeometry | null | undefined;
let sentEpoch = -1;
const sentFontIds = new Set<string>();
let sentFontEpoch = -1;

/** The newest finished run and the inputs it was made from. */
let latest: { job: Job; geometry: ModelGeometry | null; run: CamRun } | null = null;

const camModelSent = (geometry: ModelGeometry | null): boolean => geometry === sentGeometry && workerEpoch() === sentEpoch;

/** Sends the model to the worker when it changed or the worker was replaced. */
export async function ensureCamModel(geometry: ModelGeometry | null): Promise<void> {
  if (camModelSent(geometry)) return;
  const epoch = workerEpoch();
  await setCamModelInWorker(geometry);
  sentGeometry = geometry;
  sentEpoch = epoch;
}

/** Sends font bytes the worker has not got yet (once per blob id; a replaced worker has lost them all). */
function freshFonts(): [string, Uint8Array][] {
  if (sentFontEpoch !== workerEpoch()) {
    sentFontIds.clear();
    sentFontEpoch = workerEpoch();
  }
  return Object.entries(appStore.getState().fontBytes).filter(([id]) => !sentFontIds.has(id));
}

export async function ensureCamFonts(): Promise<void> {
  const epoch = workerEpoch();
  const fresh = freshFonts();
  if (!fresh.length) return;
  await addFontsInWorker(Object.fromEntries(fresh));
  if (workerEpoch() !== epoch) return;
  for (const [id] of fresh) sentFontIds.add(id);
}

export async function regenerate(): Promise<void> {
  const gen = ++generation;
  const s = appStore.getState();
  const { job, geometry } = s;
  if (!job.operations.length && !job.texts.length) {
    latest = { job, geometry, run: EMPTY_RUN };
    if (s.generatedPrograms.length || Object.keys(s.camResults).length || s.camTexts.length) s.setCamOutput(EMPTY_CAM_OUTPUT);
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
    // no await when the worker already has the model: generation then starts synchronously
    if (!camModelSent(geometry)) await ensureCamModel(geometry);
    // no await when the worker has every font: generation then starts synchronously
    if (freshFonts().length) await ensureCamFonts();
    const result = await generateInWorker(job, programContext(job, geometry));
    const state = check();
    if (state === 'superseded') return;
    if (state === 'changed') return regenerate(); // never leave the status at 'generating'
    latest = { job, geometry, run: result };
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
    if (camInputsChanged(prev.job, s.job, prev.geometry, s.geometry) || s.fontBytes !== prev.fontBytes) schedule();
  });
  schedule();
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}

/** The newest run, if the pipeline is idle and nothing that affects toolpaths changed since it was made. */
export function currentCamRun(s: Pick<AppState, 'job' | 'geometry' | 'camStatus'>): CamRun | null {
  if (s.camStatus !== 'idle' || !latest) return null;
  return camInputsChanged(latest.job, s.job, latest.geometry, s.geometry) ? null : latest.run;
}

/** Resolves with the run for the job as it is now, once the pipeline is idle; rejects when generation failed. */
export function waitForCamRun(store: StoreApi<AppState> = appStore): Promise<{ job: Job; run: CamRun }> {
  return new Promise((resolve, reject) => {
    // read the store, not the listener's argument: a nested set (the pipeline marking itself 'generating') may have happened since
    const settle = (): boolean => {
      const s = store.getState();
      if (s.camStatus !== 'idle') return false;
      const run = currentCamRun(s);
      if (run) resolve({ job: s.job, run });
      else reject(new Error('Toolpath generation failed; see the tab'));
      return true;
    };
    if (settle()) return;
    const unsubscribe = store.subscribe(() => {
      if (settle()) unsubscribe();
    });
  });
}

export async function camCatalog(): Promise<GeometryCatalog | null> {
  const { job, geometry } = appStore.getState();
  await ensureCamModel(geometry);
  return catalogInWorker(job);
}

export async function camPreviewSvg(options: PreviewOptions): Promise<string> {
  const { job, geometry } = appStore.getState();
  await ensureCamModel(geometry);
  await ensureCamFonts();
  return previewSvgInWorker(job, programContext(job, geometry), options);
}
