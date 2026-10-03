import 'fake-indexeddb/auto';
import { applyCommands, createJob } from '@sponcam/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../workers/importClient', () => ({ importInWorker: vi.fn(), cadReaderLoaded: () => true, loadCadReaderInWorker: vi.fn(), addFontsInWorker: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }) }));

const { toast } = await import('sonner');
const { saveCurrentJob } = await import('./autosave');
const { restoreAutosave } = await import('./documents');
const { appStore } = await import('./store');

describe('restoreAutosave with a missing font blob', () => {
  it('keeps the text and tells the user which font file is missing', async () => {
    const job = applyCommands(createJob('Sign'), [
      { type: 'addText', id: 't', patch: { name: 'Door sign', font: { kind: 'file', blobId: 'font-gone', name: 'Gone.ttf' } } },
    ]);
    await saveCurrentJob(job, true);
    await restoreAutosave();
    expect(appStore.getState().job.texts.map((t) => t.name)).toEqual(['Door sign']);
    expect(appStore.getState().fontBytes).toEqual({});
    expect(toast.warning).toHaveBeenCalledWith('The font file for Door sign is missing');
  });
});
