import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  setCamModel: vi.fn(() => new Promise<void>(() => {})),
  loadCadReader: vi.fn(async () => {}),
  import: vi.fn(async () => ({ ok: true, kind: 'mesh', format: 'step', detectedUnits: 'mm' })),
}));
vi.mock('comlink', () => ({ wrap: () => api, transfer: <T>(v: T) => v }));

class FakeWorker {
  static created = 0;
  terminated = false;
  constructor() {
    FakeWorker.created++;
  }
  terminate() {
    this.terminated = true;
  }
}
vi.stubGlobal('Worker', FakeWorker);

const { cadReaderLoaded, importInWorker, IMPORT_TIMEOUT_MS, loadCadReaderInWorker, setCamModelInWorker, workerEpoch } = await import('./importClient');

describe('import worker client', () => {
  afterEach(() => vi.useRealTimers());

  it('bumps the worker epoch when a stuck worker is replaced', async () => {
    vi.useFakeTimers();
    const before = workerEpoch();
    const call = setCamModelInWorker(null);
    const settled = call.catch((e: Error) => e.message);
    expect(workerEpoch()).toBe(before);
    await vi.advanceTimersByTimeAsync(IMPORT_TIMEOUT_MS + 1);
    expect(await settled).toMatch(/timed out/);
    expect(workerEpoch()).toBe(before + 1);
    void setCamModelInWorker(null); // a fresh worker is created for the next call
    expect(FakeWorker.created).toBe(2);
  });

  it('remembers that the STEP reader is loaded until the worker is replaced', async () => {
    vi.useFakeTimers();
    expect(cadReaderLoaded()).toBe(false);
    await loadCadReaderInWorker();
    expect(cadReaderLoaded()).toBe(true);
    const stuck = setCamModelInWorker(null).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(IMPORT_TIMEOUT_MS + 1);
    await stuck;
    expect(cadReaderLoaded()).toBe(false);
  });

  it('marks the reader as loaded after a successful STEP/IGES read, even without an explicit load', async () => {
    expect(cadReaderLoaded()).toBe(false);
    await importInWorker('a.step', new Uint8Array([1, 2, 3]));
    expect(cadReaderLoaded()).toBe(true);
  });
});
