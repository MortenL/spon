import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ setCamModel: vi.fn(() => new Promise<void>(() => {})) }));
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

const { IMPORT_TIMEOUT_MS, setCamModelInWorker, workerEpoch } = await import('./importClient');

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
});
