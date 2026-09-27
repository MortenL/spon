import {
  type BlobMap,
  createJob, fileKind, type Job, type LengthUnit, MAX_SOFT_IMPORT_BYTES, migrateJob, modelFilePath, type ModelRef, readSpon, SPON_EXTENSION, writeSpon,
} from '@sponcam/core';
import { toast } from 'sonner';
import { importInWorker } from '../workers/importClient';
import { getBlob, loadCurrentJob } from './autosave';
import { downloadBytes, pickOpenFile, pickSaveHandle, safeFileName, supportsFsAccess, writeToHandle } from './fileio';
import { suggestedUnits, toModelGeometry } from './geometry';
import { importProgramBytes, isProgramFile, loadPrograms, pruneBlobs, storeBlob } from './programs';
import { appStore, type ModelGeometry, type PendingImport } from './store';

const state = () => appStore.getState();
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function geometryForModel(model: ModelRef, bytes: Uint8Array): Promise<{ geometry: ModelGeometry; warnings: string[] }> {
  // the stored name decides the parser, so derive it from the model kind rather than trusting sourceName
  const result = await importInWorker(modelFilePath(model), bytes);
  if (!result.ok) throw new Error(result.error);
  return { geometry: toModelGeometry(result), warnings: result.warnings };
}

/** Stores the model blob (if any) for autosave and drops blobs nothing references any more. */
async function persistModelBlob(keepId: string | null, bytes: Uint8Array | null): Promise<void> {
  if (keepId && bytes) await storeBlob(keepId, bytes);
  await pruneBlobs();
}

function programBytesFrom(job: Job, blobs: BlobMap): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const p of job.programs) if (blobs[p.blobId]) out[p.blobId] = blobs[p.blobId];
  return out;
}

function confirmDiscard(): boolean {
  return !state().dirty || window.confirm('Discard unsaved changes to this job?');
}

export async function newDocument(): Promise<void> {
  if (!confirmDiscard()) return;
  state().loadDocument({ job: createJob(), geometry: null, modelBytes: null, warnings: [], dirty: false, fileHandle: null, programBytes: {} });
  await persistModelBlob(null, null);
}

/** Opens a .spon job, or imports an STL/DXF into the current job. */
export async function openFile(file: File, handle: FileSystemFileHandle | null = null): Promise<void> {
  if (isProgramFile(file.name)) {
    if (file.size > MAX_SOFT_IMPORT_BYTES && !window.confirm(`${file.name} is ${Math.round(file.size / 1048576)} MB and may take a while to load. Continue?`)) return;
    await importProgramBytes(file.name, new Uint8Array(await file.arrayBuffer()));
    return;
  }
  const isJob = file.name.toLowerCase().endsWith(SPON_EXTENSION);
  if (!isJob && !fileKind(file.name)) {
    toast.error(`Unsupported file type: ${file.name} (open .spon, .stl, .dxf or G-code)`);
    return;
  }
  if (file.size > MAX_SOFT_IMPORT_BYTES && !window.confirm(`${file.name} is ${Math.round(file.size / 1048576)} MB and may take a while to load. Continue?`)) {
    return;
  }
  // opening a job or importing over a model replaces the current one (Spec §7: confirm when dirty)
  if ((isJob || state().job.model) && !confirmDiscard()) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isJob) await openSponBytes(bytes, handle);
  else await importModelBytes(file.name, bytes);
}

export async function importModelBytes(fileName: string, bytes: Uint8Array): Promise<void> {
  state().setBusy(`Importing ${fileName}…`);
  let result;
  try {
    result = await importInWorker(fileName, bytes);
  } catch (err) {
    toast.error(`Could not import ${fileName}: ${message(err)}`);
    return;
  } finally {
    state().setBusy(null);
  }
  if (!result.ok) {
    toast.error(`Could not import ${fileName}: ${result.error}`);
    return;
  }
  const pending: PendingImport = {
    fileName,
    bytes,
    geometry: toModelGeometry(result),
    warnings: result.warnings,
    suggestedUnits: suggestedUnits(result),
  };
  if (result.detectedUnits) await finishImport(pending, result.detectedUnits);
  else state().setPendingImport(pending);
}

export async function finishImport(pending: PendingImport, units: LengthUnit): Promise<void> {
  const blobId = crypto.randomUUID();
  state().setPendingImport(null);
  state().applyImportedModel(
    { sourceName: pending.fileName, blobId, kind: pending.geometry.kind, importUnits: units },
    pending.geometry,
    pending.bytes,
    pending.warnings,
  );
  state().requestView('fit');
  if (pending.warnings.length) toast.warning(`${pending.fileName} imported with ${pending.warnings.length} warning(s); see the Model panel`);
  await persistModelBlob(blobId, pending.bytes);
}

export function cancelPendingImport(): void {
  state().setPendingImport(null);
}

async function openSponBytes(bytes: Uint8Array, handle: FileSystemFileHandle | null): Promise<void> {
  let job: Job;
  let blobs: BlobMap;
  try {
    ({ job, blobs } = readSpon(bytes));
  } catch (err) {
    toast.error(message(err));
    return;
  }
  const modelBytes = job.model ? blobs[job.model.blobId] ?? null : null;
  let geometry: ModelGeometry | null = null;
  let warnings: string[] = [];
  if (job.model && modelBytes) {
    state().setBusy(`Loading ${job.model.sourceName}…`);
    try {
      ({ geometry, warnings } = await geometryForModel(job.model, modelBytes));
    } catch (err) {
      toast.error(`Could not load the job's model: ${message(err)}`);
      return;
    } finally {
      state().setBusy(null);
    }
  }
  state().loadDocument({ job, geometry, modelBytes, warnings, dirty: false, fileHandle: handle, programBytes: programBytesFrom(job, blobs) });
  state().requestView('fit');
  for (const [id, data] of Object.entries(blobs)) await storeBlob(id, data);
  await pruneBlobs();
  await loadPrograms();
}

export async function saveDocument(saveAs = false): Promise<boolean> {
  const { job, modelBytes, fileHandle } = state();
  const fileName = `${safeFileName(job.name)}${SPON_EXTENSION}`;
  try {
    const { programBytes } = state();
    const blobs: BlobMap = { ...programBytes };
    if (job.model && modelBytes) blobs[job.model.blobId] = modelBytes;
    const bytes = writeSpon(job, blobs);
    if (supportsFsAccess()) {
      const handle = (!saveAs && fileHandle) || (await pickSaveHandle(fileName));
      if (!handle) return false;
      await writeToHandle(handle, bytes);
      state().markSaved(handle);
    } else {
      downloadBytes(fileName, bytes);
      state().markSaved(null);
    }
  } catch (err) {
    toast.error(`Could not save: ${message(err)}`);
    return false;
  }
  toast.success(`Saved ${fileName}`);
  return true;
}

let openFallback: (() => void) | null = null;

/** Registers what Open does in browsers without the File System Access API (clicking a hidden file input). */
export function registerOpenFallback(fn: (() => void) | null): void {
  openFallback = fn;
}

export async function openViaPicker(): Promise<void> {
  if (!supportsFsAccess()) {
    openFallback?.();
    return;
  }
  try {
    const picked = await pickOpenFile();
    if (picked) await openFile(picked.file, picked.handle);
  } catch (err) {
    toast.error(`Could not open: ${message(err)}`);
  }
}

let restoreStarted = false;

/** Restores the autosaved job and its model on startup. Safe to call more than once. */
export async function restoreAutosave(): Promise<void> {
  if (restoreStarted) return;
  restoreStarted = true;
  const jobAtStart = state().job;
  let saved;
  try {
    saved = await loadCurrentJob();
  } catch (err) {
    console.error('Could not read autosave', err);
    return;
  }
  if (!saved) return;
  let job: Job;
  try {
    job = migrateJob(saved.job);
  } catch (err) {
    toast.error(`Could not restore the autosaved job: ${message(err)}`);
    return;
  }
  let geometry: ModelGeometry | null = null;
  let modelBytes: Uint8Array | null = null;
  let warnings: string[] = [];
  if (job.model) {
    let bytes: Uint8Array | undefined;
    try {
      bytes = await getBlob(job.model.blobId);
    } catch (err) {
      console.error('Could not read the autosaved model', err);
    }
    if (!bytes) {
      toast.warning('The autosaved model could not be found; the job was restored without it');
      job = { ...job, model: null };
    } else {
      try {
        ({ geometry, warnings } = await geometryForModel(job.model, bytes));
        modelBytes = bytes;
      } catch (err) {
        toast.error(`Could not restore the autosaved model: ${message(err)}`);
        job = { ...job, model: null };
      }
    }
  }
  const programBytes: Record<string, Uint8Array> = {};
  const missing: string[] = [];
  for (const p of job.programs) {
    try {
      const data = await getBlob(p.blobId);
      if (data) programBytes[p.blobId] = data;
      else missing.push(p.id);
    } catch {
      missing.push(p.id);
    }
  }
  if (missing.length) {
    toast.warning(`${missing.length} autosaved program(s) could not be found and were removed from the job`);
    job = { ...job, programs: job.programs.filter((p) => !missing.includes(p.id)) };
  }
  // the user already opened, imported or started something while the restore was pending: keep their work
  if (state().job !== jobAtStart) return;
  state().loadDocument({ job, geometry, modelBytes, warnings, dirty: saved.dirty, fileHandle: null, programBytes });
  state().requestView('fit');
  await loadPrograms();
}
