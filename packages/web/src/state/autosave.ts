import type { Job } from '@sponcam/core';
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { StoreApi } from 'zustand/vanilla';
import type { AppState } from './store';

interface SponDb extends DBSchema {
  jobs: { key: string; value: { job: Job; dirty: boolean } };
  blobs: { key: string; value: Uint8Array };
}

const CURRENT = 'current';
let connection: Promise<IDBPDatabase<SponDb>> | null = null;

function db(): Promise<IDBPDatabase<SponDb>> {
  connection ??= openDB<SponDb>('spon', 1, {
    upgrade(database) {
      database.createObjectStore('jobs');
      database.createObjectStore('blobs');
    },
  });
  return connection;
}

export async function saveCurrentJob(job: Job, dirty: boolean): Promise<void> {
  await (await db()).put('jobs', { job, dirty }, CURRENT);
}

export async function loadCurrentJob(): Promise<{ job: Job; dirty: boolean } | undefined> {
  return (await db()).get('jobs', CURRENT);
}

export async function putBlob(id: string, bytes: Uint8Array): Promise<void> {
  await (await db()).put('blobs', bytes, id);
}

export async function getBlob(id: string): Promise<Uint8Array | undefined> {
  return (await db()).get('blobs', id);
}

/** Deletes every stored blob whose id is not in `keepIds`. */
export async function removeOrphanBlobs(keepIds: readonly string[]): Promise<void> {
  const keep = new Set(keepIds);
  const tx = (await db()).transaction('blobs', 'readwrite');
  for (const key of await tx.store.getAllKeys()) {
    if (!keep.has(key)) await tx.store.delete(key);
  }
  await tx.done;
}

export async function clearAutosave(): Promise<void> {
  const database = await db();
  await Promise.all([database.clear('jobs'), database.clear('blobs')]);
}

/** Writes the current job (and dirty flag) to IndexedDB `delayMs` after the last change. Returns a stop function. */
export function startAutosave(store: StoreApi<AppState>, delayMs = 1000): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.job === previous.job && state.dirty === previous.dirty) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const { job, dirty } = store.getState();
      saveCurrentJob(job, dirty).catch((err) => console.error('Autosave failed', err));
    }, delayMs);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
