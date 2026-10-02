import 'fake-indexeddb/auto';
import { createJob, importFile, type SvgScale } from '@sponcam/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const worker = vi.hoisted(() => ({
  importInWorker: vi.fn(),
  cadReaderLoaded: () => true,
  loadCadReaderInWorker: vi.fn(async () => {}),
}));
vi.mock('../workers/importClient', () => worker);
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }) }));

const { importModelOutcome, markSavedIfCurrent, saveToCurrentHandle, sponBytesForSave } = await import('./documents');
const { appStore } = await import('./store');

const STL = new TextEncoder().encode(['solid t', 'facet normal 0 0 1', 'outer loop', 'vertex 0 0 0', 'vertex 2 0 0', 'vertex 0 1 0', 'endloop', 'endfacet', 'endsolid t'].join('\n'));

beforeEach(() => {
  worker.importInWorker.mockReset();
  worker.importInWorker.mockImplementation(async (name: string, bytes: Uint8Array, options?: { svgScale?: SvgScale }) => importFile(name, bytes, options));
  appStore.setState({ job: createJob('Tab'), geometry: null, modelBytes: null, past: [], future: [], dirty: false, fileHandle: null, pendingImport: null, pendingBodies: null, pendingScale: null });
});

describe('bridge import', () => {
  it('answers needsUnits instead of opening the units dialog', async () => {
    const outcome = await importModelOutcome('part.stl', STL);
    expect(outcome.status).toBe('needsUnits');
    expect(appStore.getState().pendingImport).toBeNull();
    expect(appStore.getState().job.model).toBeNull();
  });

  it('imports with the given units, starting a new undo history, and says so', async () => {
    appStore.getState().commit((j) => ({ ...j, name: 'Edited' }));
    const outcome = await importModelOutcome('part.stl', STL, { units: 'mm' });
    if (outcome.status !== 'imported') throw new Error(`expected imported, got ${outcome.status}`);
    expect(outcome.size).toEqual({ x: 2, y: 1, z: 0 });
    expect(outcome.warnings).toContain('Importing a model starts a new undo history in the tab');
    expect(appStore.getState().job.model?.sourceName).toBe('part.stl');
    expect(appStore.getState().past).toEqual([]);
  });

  it('turns reader failures into an error outcome', async () => {
    worker.importInWorker.mockRejectedValueOnce(new Error('Import timed out'));
    expect(await importModelOutcome('part.stl', STL, { units: 'mm' })).toEqual({ status: 'error', error: 'Import timed out' });
  });
});

describe('bridge SVG import', () => {
  it('answers needsScale, then imports with a scale', async () => {
    const svg = new TextEncoder().encode('<svg viewBox="0 0 96 48"><rect width="96" height="48"/></svg>');
    expect(await importModelOutcome('a.svg', svg)).toMatchObject({ status: 'needsScale', rawSize: { x: 96, y: 48 }, suggestedDpi: 96 });
    const done = await importModelOutcome('a.svg', svg, { svgScale: { dpi: 96 } });
    expect(done).toMatchObject({ status: 'imported', kind: 'drawing' });
    expect(appStore.getState().job.model).toMatchObject({ format: 'svg', svgScale: 25.4 / 96 });
  });

  it('puts a px SVG dropped in the app into pendingScale', async () => {
    const { importModelBytes } = await import('./documents');
    await importModelBytes('a.svg', new TextEncoder().encode('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'));
    expect(appStore.getState().pendingScale).toMatchObject({ fileName: 'a.svg', rawSize: { x: 10, y: 10 } });
  });
});

describe('bridge save', () => {
  it('needs a file handle to save in place', async () => {
    await expect(saveToCurrentHandle()).rejects.toThrow('This tab has no file yet — give a path');
  });

  it('marks the tab saved only if the job did not change after the bytes were taken', () => {
    appStore.setState({ dirty: true });
    const first = sponBytesForSave();
    expect(first.bytes.length).toBeGreaterThan(0);
    appStore.getState().commit((j) => ({ ...j, name: 'Changed meanwhile' }));
    expect(markSavedIfCurrent(first.token)).toBe(false);
    expect(appStore.getState().dirty).toBe(true);
    const second = sponBytesForSave();
    expect(markSavedIfCurrent(first.token)).toBe(false);
    expect(markSavedIfCurrent(second.token)).toBe(true);
    expect(appStore.getState().dirty).toBe(false);
    expect(appStore.getState().fileHandle).toBeNull();
  });
});
