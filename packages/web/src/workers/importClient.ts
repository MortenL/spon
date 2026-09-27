import type { ImportResult } from '@sponcam/core';
import * as Comlink from 'comlink';
import type { ImportWorkerApi } from './import.worker';
import { withTimeout } from './timeout';

/** A parse still running after this long is assumed stuck; its worker is terminated. */
export const IMPORT_TIMEOUT_MS = 120_000;

let instance: Worker | null = null;
let remote: Comlink.Remote<ImportWorkerApi> | null = null;

function worker(): { worker: Worker; api: Comlink.Remote<ImportWorkerApi> } {
  if (!instance || !remote) {
    instance = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
    remote = Comlink.wrap<ImportWorkerApi>(instance);
  }
  return { worker: instance, api: remote };
}

/** Parses a model file off the main thread. Sends a copy of `bytes`, so the caller can keep using them. */
export async function importInWorker(fileName: string, bytes: Uint8Array): Promise<ImportResult> {
  const copy = bytes.slice();
  const { worker: current, api } = worker();
  const terminate = () => {
    current.terminate();
    if (instance === current) {
      // the next import creates a fresh worker
      instance = null;
      remote = null;
    }
  };
  return withTimeout<ImportResult>(api.import(fileName, Comlink.transfer(copy, [copy.buffer])), IMPORT_TIMEOUT_MS, terminate, 'Import timed out');
}
