import 'fake-indexeddb/auto';
import { createJob, readSpon, setStock, type Tool, writeSpon } from '@sponcam/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../workers/importClient', () => ({ importInWorker: vi.fn(), cadReaderLoaded: () => true, loadCadReaderInWorker: vi.fn(), addFontsInWorker: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('./fileio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./fileio')>()),
  supportsFsAccess: () => true,
  pickSaveHandle: vi.fn(),
  pickOpenFile: vi.fn(),
  writeToHandle: vi.fn(async () => {}),
  downloadBytes: vi.fn(),
}));

const fileio = await import('./fileio');
const { toast } = await import('sonner');
const { clearAutosave } = await import('./autosave');
const { addTextCentred, addTextOperation, updateText } = await import('./texts');
const { runInlay } = await import('./inlay');
const { appStore } = await import('./store');
const { registerFontFile } = await import('./texts');
const { testFontBytes } = await import('../../../core/test/fixtures/testFont');

const s = () => appStore.getState();
const vbit: Tool = {
  id: 'v60', number: 7, name: '60 V', type: 'vbit', diameter: 12, tipAngleDeg: 60, cornerRadius: 0, fluteLength: 10, stickout: 25, flutes: 2,
  presets: [], materialPresets: [],
} as never;
const flat: Tool = {
  id: 'f6', number: 1, name: '6 flat', type: 'flat', diameter: 6, fluteLength: 20, stickout: 30, flutes: 2, presets: [], materialPresets: [],
} as never;
const input = { inlayDepth: 4, startDepth: 2, glueGap: 0.5, margin: 10 };
const handle = (name: string) => ({ name } as unknown as FileSystemFileHandle);

function fresh(tool: Tool = vbit): string {
  const job = setStock(createJob(), { mode: 'fixed', size: { x: 200, y: 100, z: 18 }, modelOffset: { x: 0, y: 0, z: 0 } });
  s().loadDocument({ job: { ...job, tools: [tool] }, geometry: null, modelBytes: null, warnings: [], dirty: false, fileHandle: null, programBytes: {}, fontBytes: {} });
  const t = addTextCentred()!;
  updateText(t, { text: 'HOA', font: { kind: 'bundled', id: 'sans' } });
  return addTextOperation(t, 'vcarve')!;
}

const written = () => vi.mocked(fileio.writeToHandle).mock.calls;

describe('runInlay', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearAutosave();
  });

  it('saves the plug, then changes the base in one undo step', async () => {
    const id = fresh();
    vi.mocked(fileio.pickSaveHandle).mockResolvedValue(handle('chosen.spon'));
    const past = s().past.length;
    const result = await runInlay(id, input, { library: [flat] });
    expect(result).toMatchObject({ status: 'done', H: 5.5 });
    expect(s().past.length).toBe(past + 1);
    const op = s().job.operations.find((o) => o.id === id)!;
    expect(op).toMatchObject({ type: 'vcarve', inlay: { plugFileName: 'chosen.spon', startDepth: 2, glueGap: 0.5 } });
    expect(s().job.operations.some((o) => o.type === 'vclear' && o.sourceId === id)).toBe(true);
    expect(s().job.tools.some((t) => t.id === 'f6')).toBe(true);
    expect(written()).toHaveLength(1);
    const plug = readSpon(written()[0][1]).job;
    expect(plug.operations.some((o) => o.type === 'vplug')).toBe(true);
    expect(toast.success).toHaveBeenCalledWith('Plug job saved', expect.objectContaining({ action: expect.anything() }));
  });

  it('changes nothing when the save is cancelled', async () => {
    const id = fresh();
    vi.mocked(fileio.pickSaveHandle).mockResolvedValue(null);
    const before = s().job;
    const past = s().past.length;
    expect(await runInlay(id, input, { library: [flat] })).toEqual({ status: 'cancelled' });
    expect(s().job).toBe(before);
    expect(s().past.length).toBe(past);
    expect(written()).toHaveLength(0);
  });

  it('refuses a flat-tool V-carve without dispatching', async () => {
    const id = fresh(flat);
    const before = s().job;
    const result = await runInlay(id, input, { library: [] });
    expect(result).toEqual({ status: 'error', message: 'Inlays need a V-bit' });
    expect(s().job).toBe(before);
    expect(fileio.pickSaveHandle).not.toHaveBeenCalled();
  });

  it('updates the picked plug file in place without duplicating texts', async () => {
    const id = fresh();
    vi.mocked(fileio.pickSaveHandle).mockResolvedValue(handle('plug.spon'));
    await runInlay(id, input, { library: [flat] });
    const firstBytes = written()[0][1];
    const texts = readSpon(firstBytes).job.texts.length;
    const picked = handle('plug.spon');
    vi.mocked(fileio.pickOpenFile).mockResolvedValue({ file: new File([firstBytes.slice()], 'plug.spon'), handle: picked });
    const past = s().past.length;
    const result = await runInlay(id, input, { library: [flat], update: true });
    expect(result.status).toBe('done');
    expect(written()).toHaveLength(2);
    expect(written()[1][0]).toBe(picked);
    expect(readSpon(written()[1][1]).job.texts).toHaveLength(texts);
    expect(s().job.operations.find((o) => o.id === id)).toMatchObject({ inlay: { plugFileName: 'plug.spon' } });
    expect(s().past.length).toBe(past + 1);
  });

  it('returns an error, with the job unchanged, when writing the plug fails', async () => {
    const id = fresh();
    vi.mocked(fileio.pickSaveHandle).mockResolvedValue(handle('x.spon'));
    vi.mocked(fileio.writeToHandle).mockRejectedValueOnce(new Error('disk full'));
    const before = s().job;
    const past = s().past.length;
    expect(await runInlay(id, input, { library: [flat] })).toEqual({ status: 'error', message: 'disk full' });
    expect(s().job).toBe(before);
    expect(s().past.length).toBe(past);
  });

  it('refuses updating from a file that is not a plug job', async () => {
    const id = fresh();
    vi.mocked(fileio.pickSaveHandle).mockResolvedValue(handle('plug.spon'));
    await runInlay(id, input, { library: [flat] });
    const notPlug = writeSpon(createJob(), {});
    vi.mocked(fileio.pickOpenFile).mockResolvedValue({ file: new File([notPlug.slice()], 'other.spon'), handle: handle('other.spon') });
    const before = s().job;
    expect(await runInlay(id, input, { library: [flat], update: true })).toEqual({ status: 'error', message: 'This job is not a plug job' });
    expect(s().job).toBe(before);
    vi.mocked(fileio.pickOpenFile).mockResolvedValue({ file: new File([new Uint8Array([1, 2, 3])], 'bad.spon'), handle: null as never });
    expect((await runInlay(id, input, { library: [flat], update: true })).status).toBe('error');
  });

  it('carries an uploaded font into the plug job', async () => {
    const id = fresh();
    const font = await registerFontFile('Test.ttf', testFontBytes());
    const text = s().job.operations.find((o) => o.id === id)!;
    const textId = (text as { geometry: { textId: string }[] }).geometry[0].textId;
    updateText(textId, { font });
    vi.mocked(fileio.pickSaveHandle).mockResolvedValue(handle('f.spon'));
    expect((await runInlay(id, input, { library: [flat] })).status).toBe('done');
    const plug = readSpon(written()[0][1]);
    expect(Object.keys(plug.blobs)).toContain(font.blobId);
  });
});
