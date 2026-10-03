import 'fake-indexeddb/auto';
import { addProgram, createJob, removeProgram, renameJob, setModel } from '@sponcam/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAutosave, getBlob, putBlob } from './autosave';
import { isProgramFile, pruneBlobs, referencedBlobIds } from './programs';
import { appStore, UNDO_LIMIT } from './store';

describe('isProgramFile', () => {
  it('accepts the spec extensions case-insensitively', () => {
    for (const name of ['a.nc', 'b.NGC', 'c.gcode', 'd.tap', 'e.cnc']) expect(isProgramFile(name)).toBe(true);
    for (const name of ['a.stl', 'b.spon', 'nc', 'x.txt']) expect(isProgramFile(name)).toBe(false);
  });
});

describe('referencedBlobIds', () => {
  it('collects blobs from the job and the undo/redo stacks without duplicates', () => {
    const base = setModel(createJob(), { sourceName: 'm.stl', blobId: 'm', kind: 'mesh', importUnits: 'mm' });
    const withP1 = addProgram(base, { name: 'a.nc', blobId: 'p1' });
    const withP2 = addProgram(withP1, { name: 'b.nc', blobId: 'p2' });
    expect(referencedBlobIds(withP1, [base], [withP2]).sort()).toEqual(['m', 'p1', 'p2']);
  });
});

describe('pruneBlobs', () => {
  beforeEach(async () => {
    await clearAutosave();
  });

  it('drops programBytes/programData for a removed program once it also leaves the undo/redo history, and deletes its stored blob', async () => {
    appStore.getState().loadDocument({ job: createJob(), geometry: null, modelBytes: null, warnings: [], dirty: false, fileHandle: null, programBytes: {}, fontBytes: {} });
    appStore.getState().setProgramBytes('p1', new Uint8Array([1]));
    appStore.getState().setProgramData('p1', { status: 'ready', text: 'G0', parsed: null, error: null });
    appStore.getState().commit((job) => addProgram(job, { name: 'a.nc', blobId: 'p1' }));
    await putBlob('p1', new Uint8Array([1]));

    const id = appStore.getState().job.programs[0].id;
    appStore.getState().commit((job) => removeProgram(job, id));
    // still reachable via undo (past holds the job that had it), so nothing is dropped yet
    await pruneBlobs();
    expect(appStore.getState().programBytes.p1).toBeDefined();
    expect(await getBlob('p1')).toBeDefined();

    // once enough further commits push that past entry out of the (capped) undo history, it's gone
    for (let i = 0; i < UNDO_LIMIT; i++) appStore.getState().commit((job) => renameJob(job, `N${i}`));
    await pruneBlobs();
    expect(appStore.getState().programBytes.p1).toBeUndefined();
    expect(appStore.getState().programData.p1).toBeUndefined();
    expect(await getBlob('p1')).toBeUndefined();
  });
});
