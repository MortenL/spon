import 'fake-indexeddb/auto';
import { createJob, renameJob } from '@sponcam/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAutosave, getBlob, loadCurrentJob, putBlob, removeOrphanBlobs, saveCurrentJob, startAutosave } from './autosave';
import { createAppStore } from './store';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('autosave', () => {
  beforeEach(async () => {
    await clearAutosave();
  });

  it('saves and loads the current job', async () => {
    const job = createJob('Saved');
    await saveCurrentJob(job, true);
    expect(await loadCurrentJob()).toEqual({ job, dirty: true });
  });

  it('stores model blobs and removes orphans', async () => {
    await putBlob('a', new Uint8Array([1]));
    await putBlob('b', new Uint8Array([2]));
    await removeOrphanBlobs(['b']);
    expect(await getBlob('a')).toBeUndefined();
    expect(await getBlob('b')).toEqual(new Uint8Array([2]));
    await putBlob('c', new Uint8Array([3]));
    await removeOrphanBlobs(['b', 'c']);
    expect(await getBlob('c')).toEqual(new Uint8Array([3]));
    await removeOrphanBlobs([]);
    expect(await getBlob('b')).toBeUndefined();
  });

  it('debounces job writes after commits', async () => {
    const store = createAppStore(createJob('A'));
    const stop = startAutosave(store, 20);
    store.getState().commit((j) => renameJob(j, 'B'));
    store.getState().commit((j) => renameJob(j, 'C'));
    expect(await loadCurrentJob()).toBeUndefined();
    await wait(80);
    const saved = await loadCurrentJob();
    expect(saved?.job.name).toBe('C');
    expect(saved?.dirty).toBe(true);
    stop();
  });
});
