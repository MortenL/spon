import 'fake-indexeddb/auto';
import { createJob, setStock, type Tool } from '@sponcam/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../workers/importClient', () => ({ importInWorker: vi.fn(), cadReaderLoaded: () => true, loadCadReaderInWorker: vi.fn(), addFontsInWorker: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }) }));

const { clearAutosave, getBlob } = await import('./autosave');
const { addTextCentred, addTextOperation, duplicateText, registerFontFile } = await import('./texts');
const { pruneBlobs } = await import('./programs');
const { sponBytesForSave } = await import('./documents');
const { appStore } = await import('./store');
const { testFontBytes } = await import('../../../core/test/fixtures/testFont');
const { readSpon } = await import('@sponcam/core');

const s = () => appStore.getState();
const vbit: Tool = {
  id: 'v60', number: 7, name: '60 V', type: 'vbit', diameter: 12, tipAngleDeg: 60, cornerRadius: 0, fluteLength: 10, stickout: 25, flutes: 2,
  presets: [], materialPresets: [],
} as never;

function fresh() {
  const job = setStock(createJob(), { mode: 'fixed', size: { x: 200, y: 100, z: 18 }, modelOffset: { x: 0, y: 0, z: 0 } });
  s().loadDocument({ job, geometry: null, modelBytes: null, warnings: [], dirty: false, fileHandle: null, programBytes: {}, fontBytes: {} });
}

describe('texts in the store', () => {
  beforeEach(async () => {
    await clearAutosave();
    fresh();
  });

  it('adds a text centred on a fixed stock and selects it', () => {
    const id = addTextCentred()!;
    expect(s().job.texts).toHaveLength(1);
    expect(s().job.texts[0].position).toEqual({ x: 100, y: 50 });
    expect(s().selectedTextId).toBe(id);
  });

  it('duplicates right after the source as "<name> copy"', () => {
    const a = addTextCentred()!;
    addTextCentred();
    addTextCentred();
    const before = s().past.length;
    const copy = duplicateText(a)!;
    expect(s().job.texts.map((t) => t.name)).toEqual(['Text 1', 'Text 1 copy', 'Text 2', 'Text 3']);
    expect(s().job.texts[1].id).toBe(copy);
    expect(s().past.length).toBe(before + 1);
  });

  it('adds a V-carve operation for a text in one undo step', () => {
    s().commit((j) => ({ ...j, tools: [vbit] }));
    const t = addTextCentred()!;
    const before = s().past.length;
    const op = addTextOperation(t, 'vcarve')!;
    expect(s().past.length).toBe(before + 1);
    const created = s().job.operations.find((o) => o.id === op)!;
    expect(created).toMatchObject({ type: 'vcarve', toolId: 'v60', geometry: [{ kind: 'text', textId: t }] });
    expect(s().selectedOperationId).toBe(op);
    expect(s().selectedTextId).toBeNull();
    s().undo();
    expect(s().job.operations).toHaveLength(0);
  });

  it('selecting a text clears the selected operation and the reverse', () => {
    const t = addTextCentred()!;
    const op = addTextOperation(t, 'engrave')!;
    expect(s().selectedOperationId).toBe(op);
    s().selectText(t);
    expect(s().selectedOperationId).toBeNull();
    expect(s().selectedTextId).toBe(t);
    s().selectOperation(op);
    expect(s().selectedTextId).toBeNull();
  });

  it('keeps a font blob referenced only in the undo history, then drops it', async () => {
    const font = await registerFontFile('Test.ttf', testFontBytes());
    expect(font.blobId).toMatch(/^font-/);
    const t = addTextCentred()!;
    s().dispatch({ type: 'updateText', id: t, patch: { font } });
    s().dispatch({ type: 'updateText', id: t, patch: { font: { kind: 'bundled', id: 'serif' } } });
    await pruneBlobs();
    expect(s().fontBytes[font.blobId]).toBeDefined();
    expect(await getBlob(font.blobId)).toBeDefined();
    s().commit((j) => ({ ...j, name: 'x' }));
    s().loadDocument({ job: s().job, geometry: null, modelBytes: null, warnings: [], dirty: false, fileHandle: null, programBytes: {}, fontBytes: s().fontBytes }); // history reset, job unchanged
    await pruneBlobs();
    expect(s().fontBytes[font.blobId]).toBeUndefined();
    expect(await getBlob(font.blobId)).toBeUndefined();
  });

  it('rejects an unreadable font with the exact message and stores nothing', async () => {
    await expect(registerFontFile('bad.ttf', new Uint8Array([1, 2, 3]))).rejects.toThrow("This font file can't be read");
    await expect(registerFontFile('x.woff2', new Uint8Array([1, 2, 3]))).rejects.toThrow('WOFF2 fonts are not supported; use TTF, OTF or WOFF');
    expect(s().fontBytes).toEqual({});
  });

  it('saves font bytes into the .spon file', async () => {
    const font = await registerFontFile('Test.ttf', testFontBytes());
    const t = addTextCentred()!;
    s().dispatch({ type: 'updateText', id: t, patch: { font } });
    const { bytes } = sponBytesForSave();
    const read = readSpon(bytes);
    expect(read.job.texts[0].font).toEqual(font);
    expect(read.blobs[font.blobId]).toEqual(testFontBytes());
    // open it again: the font bytes come back
    s().markSaved(null);
    const { openFile } = await import('./documents');
    await openFile(new File([bytes as BlobPart], 'sign.spon'));
    expect(s().job.texts[0].font).toEqual(font);
    expect(s().fontBytes[font.blobId]).toEqual(testFontBytes());
    expect(await getBlob(font.blobId)).toEqual(testFontBytes());
  });
});
