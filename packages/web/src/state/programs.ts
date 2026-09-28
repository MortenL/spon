import { addProgram, decodeProgramText, type Job, jobBlobIds } from '@sponcam/core';
import { toast } from 'sonner';
import type { StoreApi } from 'zustand/vanilla';
import { analyzeInWorker, parseProgramInWorker } from '../workers/importClient';
import { putBlob, removeOrphanBlobs } from './autosave';
import { programContext } from './programContext';
import { type AppState, appStore } from './store';

export const PROGRAM_EXTENSIONS = ['.nc', '.ngc', '.gcode', '.tap', '.cnc'] as const;

const state = () => appStore.getState();
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Bumped on every `reanalyzeAll` pass; a pass whose generation is stale abandons its work rather than overwrite a newer one. */
let analysisGeneration = 0;
/** Bumped per blobId on every `parseBlob` call; a stale (superseded) parse ignores its own result. */
const parseTokens = new Map<string, number>();

export function isProgramFile(name: string): boolean {
  const lower = name.toLowerCase();
  return PROGRAM_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Blobs referenced by the job or by any undo/redo state, so undo/redo never loses bytes. */
export function referencedBlobIds(job: Job, past: readonly Job[], future: readonly Job[]): string[] {
  const ids = new Set<string>();
  for (const j of [job, ...past, ...future]) for (const id of jobBlobIds(j)) ids.add(id);
  return [...ids];
}

/** IndexedDB write for autosave; failures (quota, private browsing) are logged, never thrown. */
export async function storeBlob(id: string, bytes: Uint8Array): Promise<void> {
  try {
    await putBlob(id, bytes);
  } catch (err) {
    console.error('Could not store data for autosave', err);
  }
}

export async function pruneBlobs(): Promise<void> {
  const { job, past, future } = state();
  const keep = referencedBlobIds(job, past, future);
  state().pruneProgramData(keep);
  const keepSet = new Set(keep);
  for (const id of [...parseTokens.keys()]) if (!keepSet.has(id)) parseTokens.delete(id);
  try {
    await removeOrphanBlobs(keep);
  } catch (err) {
    console.error('Could not clean up autosave data', err);
  }
}

async function parseBlob(blobId: string): Promise<void> {
  const bytes = state().programBytes[blobId];
  if (!bytes) return;
  const text = state().programData[blobId]?.text ?? decodeProgramText(bytes);
  state().setProgramData(blobId, { status: 'parsing', text, parsed: null, error: null });
  // Superseded by a later parseBlob(blobId) call, or the document changed under us.
  const token = (parseTokens.get(blobId) ?? 0) + 1;
  parseTokens.set(blobId, token);
  const stale = () => parseTokens.get(blobId) !== token || !state().programData[blobId];
  const startGeneration = analysisGeneration;
  try {
    const parsed = await parseProgramInWorker(bytes, programContext(state().job, state().geometry));
    if (stale()) return;
    state().setProgramData(blobId, { status: 'ready', text, parsed, error: null });
    // The machine/stock/WCS moved on while this parse (and its embedded analysis) was in flight.
    if (analysisGeneration !== startGeneration) void reanalyzeAll();
  } catch (err) {
    if (stale()) return;
    state().setProgramData(blobId, { status: 'failed', text, parsed: null, error: message(err) });
    toast.error(`Could not parse program: ${message(err)}`);
  }
}

/** Adds a G-code file to the job's program list (never replaces anything). */
export async function importProgramBytes(name: string, bytes: Uint8Array): Promise<void> {
  const blobId = crypto.randomUUID();
  state().setProgramBytes(blobId, bytes);
  state().setProgramData(blobId, { status: 'parsing', text: decodeProgramText(bytes), parsed: null, error: null });
  state().commit((job) => addProgram(job, { name, blobId }));
  const added = state().job.programs.at(-1);
  if (added) state().setActiveProgram(added.id);
  await storeBlob(blobId, bytes);
  await pruneBlobs();
  await parseBlob(blobId);
}

/** Parses every program of the current job (after open/restore). */
export async function loadPrograms(): Promise<void> {
  for (const program of state().job.programs) await parseBlob(program.blobId);
}

/** Re-times and re-analyses every parsed program for the current machine, stock and WCS. */
export async function reanalyzeAll(): Promise<void> {
  const generation = ++analysisGeneration;
  const { job, past, future, geometry } = state();
  const keep = new Set(referencedBlobIds(job, past, future));
  const ctx = programContext(job, geometry);
  for (const [blobId, data] of Object.entries(state().programData)) {
    if (!keep.has(blobId)) continue; // no longer referenced by the job or its undo/redo history
    if (data.status !== 'ready' || !data.parsed) continue;
    try {
      const { analysis, t } = await analyzeInWorker(data.parsed.table, data.parsed.lineFlags, ctx);
      if (generation !== analysisGeneration) return; // a newer pass superseded this one; let it win
      const current = state().programData[blobId];
      if (current?.parsed !== data.parsed) continue; // replaced meanwhile
      state().setProgramData(blobId, { ...current, parsed: { ...data.parsed, table: { ...data.parsed.table, t }, analysis } });
    } catch (err) {
      console.error('Re-analysis failed', err);
    }
  }
}

/** Re-analyses programs `delayMs` after the machine, stock, WCS or model changes. Returns a stop function. */
export function startProgramAnalysis(store: StoreApi<AppState>, delayMs = 300): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = store.subscribe((s, prev) => {
    const changed =
      s.job.machine !== prev.job.machine || s.job.stock !== prev.job.stock || s.job.wcs !== prev.job.wcs ||
      s.job.model !== prev.job.model || s.geometry !== prev.geometry;
    if (!changed) return;
    clearTimeout(timer);
    timer = setTimeout(() => void reanalyzeAll(), delayMs);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
