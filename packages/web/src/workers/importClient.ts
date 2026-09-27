import type { ImportResult } from '@sponcam/core';
import * as Comlink from 'comlink';
import type { ImportWorkerApi } from './import.worker';

let remote: Comlink.Remote<ImportWorkerApi> | null = null;

function worker(): Comlink.Remote<ImportWorkerApi> {
  remote ??= Comlink.wrap<ImportWorkerApi>(new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' }));
  return remote;
}

/** Parses a model file off the main thread. Sends a copy of `bytes`, so the caller can keep using them. */
export async function importInWorker(fileName: string, bytes: Uint8Array): Promise<ImportResult> {
  const copy = bytes.slice();
  return worker().import(fileName, Comlink.transfer(copy, [copy.buffer]));
}
