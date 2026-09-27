import { createJob, type Job, renameJob } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { createAppStore, type ModelGeometry, UNDO_LIMIT } from './store';

const drawing: ModelGeometry = { kind: 'drawing', drawing: { layers: [] }, rawPoints: new Float32Array() };
const rename = (name: string) => (job: Job) => renameJob(job, name);

describe('app store', () => {
  it('commits, undoes and redoes job edits', () => {
    const store = createAppStore(createJob('A'));
    const s = () => store.getState();
    s().commit(rename('B'));
    s().commit(rename('C'));
    expect(s().job.name).toBe('C');
    expect(s().dirty).toBe(true);
    s().undo();
    expect(s().job.name).toBe('B');
    s().undo();
    expect(s().job.name).toBe('A');
    s().undo();
    expect(s().job.name).toBe('A');
    s().redo();
    expect(s().job.name).toBe('B');
    s().commit(rename('D'));
    s().redo();
    expect(s().job.name).toBe('D');
    expect(s().future).toEqual([]);
  });

  it('ignores updates that return the same job', () => {
    const store = createAppStore(createJob('A'));
    store.getState().commit((job) => job);
    expect(store.getState().past).toEqual([]);
    expect(store.getState().dirty).toBe(false);
  });

  it('caps the undo history', () => {
    const store = createAppStore(createJob('A'));
    for (let i = 0; i < UNDO_LIMIT + 50; i++) store.getState().commit(rename(`N${i}`));
    expect(store.getState().past).toHaveLength(UNDO_LIMIT);
    expect(store.getState().past[0].name).toBe('N49');
  });

  it('loads a document with fresh history', () => {
    const store = createAppStore(createJob('A'));
    store.getState().commit(rename('B'));
    store.getState().loadDocument({ job: createJob('Loaded'), geometry: drawing, modelBytes: null, warnings: ['w'], dirty: false, fileHandle: null });
    const s = store.getState();
    expect(s.job.name).toBe('Loaded');
    expect(s.past).toEqual([]);
    expect(s.warnings).toEqual(['w']);
    expect(s.dirty).toBe(false);
  });

  it('clears history and marks the job dirty when a model is imported', () => {
    const store = createAppStore(createJob('A'));
    store.getState().commit(rename('B'));
    store.getState().applyImportedModel({ sourceName: 'p.dxf', blobId: 'b1', kind: 'drawing', importUnits: 'mm' }, drawing, new Uint8Array([1]), []);
    const s = store.getState();
    expect(s.past).toEqual([]);
    expect(s.job.model?.blobId).toBe('b1');
    expect(s.job.name).toBe('B');
    expect(s.geometry).toBe(drawing);
    expect(s.dirty).toBe(true);
  });

  it('toggles layers, clears the dirty flag on save and numbers view requests', () => {
    const store = createAppStore(createJob('A'));
    const s = () => store.getState();
    s().toggleLayer('L');
    expect(s().hiddenLayers).toEqual(['L']);
    s().toggleLayer('L');
    expect(s().hiddenLayers).toEqual([]);
    s().commit(rename('B'));
    s().markSaved(null);
    expect(s().dirty).toBe(false);
    s().requestView('top');
    s().requestView('top');
    expect(s().viewRequest).toEqual({ preset: 'top', nonce: 2 });
  });
});
