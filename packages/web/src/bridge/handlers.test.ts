import 'fake-indexeddb/auto';
import { applyCommand, createJob, type JobCommand, starterLibrary } from '@sponcam/core';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CamRun } from '../state/camTypes';

const worker = vi.hoisted(() => ({
  setCamModelInWorker: vi.fn(async () => {}),
  generateInWorker: vi.fn(),
  catalogInWorker: vi.fn(async () => null),
  previewSvgInWorker: vi.fn(async () => '<svg/>'),
  importInWorker: vi.fn(),
  cadReaderLoaded: () => true,
  loadCadReaderInWorker: vi.fn(async () => {}),
  parseProgramInWorker: vi.fn(async () => { throw new Error('not parsed in this test'); }),
  analyzeInWorker: vi.fn(),
  workerEpoch: () => 0,
}));
vi.mock('../workers/importClient', () => worker);
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }) }));

const { handlers } = await import('./handlers');
const { regenerate } = await import('../state/cam');
const { appStore } = await import('../state/store');

const parsed = { table: { count: 0 }, analysis: { summary: { totalSeconds: 3, lineCount: 2, extents: null }, diagnostics: [] }, interpretDiagnostics: [] } as never;
const run = (): CamRun => ({
  results: [{ operationId: 'o1', diagnostics: [], heights: null, overlays: { tabs: [], laps: [], unmachined: [] }, hasToolpath: true }],
  files: [{ name: 'job.nc', text: 'G0 X0\n', operationIds: ['o1'], tools: [1], sections: [], parsed, postErrors: [] }],
  catalog: null,
});
const add = (id: string): JobCommand => ({ type: 'addOperation', opType: 'drill', toolId: null, id });

beforeEach(() => {
  vi.mocked(toast).mockClear();
  worker.generateInWorker.mockReset();
  appStore.setState({ job: createJob('Tab'), geometry: null, past: [], future: [], dirty: false, fileHandle: null, camStatus: 'idle' });
});

describe('bridge handlers', () => {
  it('describes the tab', async () => {
    expect(await handlers.describe({})).toEqual({ kind: 'live', name: 'Tab', path: null, dirty: false, model: null, operations: 0 });
  });

  it('applies a batch as one undo step with a toast, or nothing at all', async () => {
    const job = await handlers.apply({ commands: [add('a'), add('b')], label: 'Add two drills' });
    expect(job.operations).toHaveLength(2);
    expect(appStore.getState().past).toHaveLength(1);
    expect(toast).toHaveBeenCalledWith('Claude: Add two drills');
    await expect(handlers.apply({ commands: [add('c'), { type: 'removeOperation', id: 'zz' } as JobCommand], label: 'Bad' })).rejects.toThrow(/^commands\[1\] removeOperation/);
    expect(appStore.getState().job.operations).toHaveLength(2);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('answers run and exportGcode once the pipeline caught up', async () => {
    appStore.setState({ job: applyCommand(createJob('Tab'), add('o1')), camStatus: 'generating' });
    worker.generateInWorker.mockResolvedValue(run());
    const pending = handlers.run({});
    await regenerate();
    const report = await pending;
    expect(report.files).toEqual([{ name: 'job.nc', text: 'G0 X0\n', operationIds: ['o1'], tools: [1], lineCount: 2, seconds: 3, extents: null }]);
    expect(await handlers.exportGcode({})).toEqual({ ok: true, files: [{ name: 'job.nc', text: 'G0 X0\n' }], warnings: [] });
  });

  it('computes boxes on the main thread and asks the worker for the catalog and preview', async () => {
    expect(await handlers.boxes({})).toEqual({ model: null, stock: null });
    expect(await handlers.catalog({})).toBeNull();
    expect(await handlers.previewSvg({ view: 'top' })).toBe('<svg/>');
  });

  it('gives the server the .spon bytes and marks the tab saved after', async () => {
    appStore.setState({ dirty: true });
    const { bytes, token } = await handlers.saveBytes({});
    expect(bytes.length).toBeGreaterThan(0);
    expect(await handlers.markSaved({ token })).toEqual({ saved: true });
    expect(appStore.getState().dirty).toBe(false);
    await expect(handlers.save({})).rejects.toThrow('This tab has no file yet — give a path');
  });

  it('reaches the IndexedDB tool library', async () => {
    const tool = { ...starterLibrary()[1], id: 'via-bridge', name: 'Via bridge', number: 88 };
    await handlers['tools.add']({ tool });
    expect((await handlers['tools.list']({})).some((t) => t.id === 'via-bridge')).toBe(true);
  });
});
