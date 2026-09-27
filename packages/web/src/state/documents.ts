import {
  createJob, fileKind, type Job, type LengthUnit, MAX_SOFT_IMPORT_BYTES, type ModelRef, readSpon, SPON_EXTENSION, writeSpon,
} from '@sponcam/core';
import { toast } from 'sonner';
import { importInWorker } from '../workers/importClient';
import { getBlob, loadCurrentJob, putBlob, removeOrphanBlobs } from './autosave';
import { downloadBytes, pickOpenFile, pickSaveHandle, safeFileName, supportsFsAccess, writeToHandle } from './fileio';
import { suggestedUnits, toModelGeometry } from './geometry';
import { appStore, type ModelGeometry, type PendingImport } from './store';

const state = () => appStore.getState();
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function geometryForModel(model: ModelRef, bytes: Uint8Array): Promise<{ geometry: ModelGeometry; warnings: string[] }> {
  const result = await importInWorker(model.sourceName, bytes);
  if (!result.ok) throw new Error(result.error);
  return { geometry: toModelGeometry(result), warnings: result.warnings };
}

function confirmDiscard(): boolean {
  return !state().dirty || window.confirm('Discard unsaved changes to this job?');
}

export async function newDocument(): Promise<void> {
  if (!confirmDiscard()) return;
  state().loadDocument({ job: createJob(), geometry: null, modelBytes: null, warnings: [], dirty: false, fileHandle: null });
  await removeOrphanBlobs(null);
}

/** Opens a .spon job, or imports an STL/DXF into the current job. */
export async function openFile(file: File, handle: FileSystemFileHandle | null = null): Promise<void> {
  const isJob = file.name.toLowerCase().endsWith(SPON_EXTENSION);
  if (!isJob && !fileKind(file.name)) {
    toast.error(`Unsupported file type: ${file.name}`);
    return;
  }
  if (file.size > MAX_SOFT_IMPORT_BYTES && !window.confirm(`${file.name} is ${Math.round(file.size / 1048576)} MB and may take a while to load. Continue?`)) {
    return;
  }
  if (isJob && !confirmDiscard()) return;
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
  try {
    await putBlob(blobId, pending.bytes);
    await removeOrphanBlobs(blobId);
  } catch (err) {
    console.error('Could not store the model for autosave', err);
  }
}

export function cancelPendingImport(): void {
  state().setPendingImport(null);
}

async function openSponBytes(bytes: Uint8Array, handle: FileSystemFileHandle | null): Promise<void> {
  let job: Job;
  let modelBytes: Uint8Array | null;
  try {
    ({ job, modelBytes } = readSpon(bytes));
  } catch (err) {
    toast.error(message(err));
    return;
  }
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
  state().loadDocument({ job, geometry, modelBytes, warnings, dirty: false, fileHandle: handle });
  state().requestView('fit');
  if (job.model && modelBytes) await putBlob(job.model.blobId, modelBytes);
  await removeOrphanBlobs(job.model?.blobId ?? null);
}

export async function saveDocument(saveAs = false): Promise<boolean> {
  const { job, modelBytes, fileHandle } = state();
  const fileName = `${safeFileName(job.name)}${SPON_EXTENSION}`;
  try {
    const bytes = writeSpon(job, modelBytes);
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
  let saved;
  try {
    saved = await loadCurrentJob();
  } catch (err) {
    console.error('Could not read autosave', err);
    return;
  }
  if (!saved) return;
  let job = saved.job;
  let geometry: ModelGeometry | null = null;
  let modelBytes: Uint8Array | null = null;
  let warnings: string[] = [];
  if (job.model) {
    const bytes = await getBlob(job.model.blobId);
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
  state().loadDocument({ job, geometry, modelBytes, warnings, dirty: saved.dirty, fileHandle: null });
  state().requestView('fit');
}
