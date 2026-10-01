import { applyCommand, createJob, type JobCommand } from '@sponcam/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CamRun } from './camTypes';

const worker = vi.hoisted(() => ({
  setCamModelInWorker: vi.fn(async () => {}),
  generateInWorker: vi.fn(),
  catalogInWorker: vi.fn(async () => null),
  previewSvgInWorker: vi.fn(async () => '<svg/>'),
  epoch: 0,
  workerEpoch: () => worker.epoch,
}));
vi.mock('../workers/importClient', () => worker);

const { camCatalog, camInputsChanged, camPreviewSvg, currentCamRun, regenerate, startCamPipeline, toCamOutput, waitForCamRun } = await import('./cam');
const { appStore } = await import('./store');
const { allPrograms } = await import('./programList');

const parsed = { table: { count: 0 }, analysis: { summary: { totalSeconds: 3 }, diagnostics: [] }, interpretDiagnostics: [] } as never;
const run = (names: string[]): CamRun => ({
  results: [{ operationId: 'o1', diagnostics: [], heights: null, overlays: { tabs: [], laps: [], unmachined: [] }, hasToolpath: true }],
  files: names.map((name) => ({ name, text: `(${name})\n`, operationIds: ['o1'], tools: [1], sections: [{ operationId: 'o1', firstLine: 0, lastLine: 0 }], parsed, postErrors: [] })),
  catalog: null,
});
const withOp = () => applyCommand(createJob(), { type: 'addOperation', opType: 'drill', toolId: null, id: 'o1' } as JobCommand);

describe('CAM pipeline', () => {
  beforeEach(() => {
    worker.generateInWorker.mockReset();
    worker.setCamModelInWorker.mockClear();
    appStore.setState({ job: createJob(), programData: {}, generatedPrograms: [], camFiles: [], camResults: {}, activeProgramId: null, camStatus: 'idle' });
  });

  it('maps a run to generated programs, program data and results', () => {
    const out = toCamOutput(run(['job.nc']));
    expect(out.programs).toEqual([{ id: 'gen:job.nc', name: 'job.nc', blobId: 'gen:job.nc', inTimeline: true, source: 'generated', operationIds: ['o1'] }]);
    expect(out.programData['gen:job.nc']).toMatchObject({ status: 'ready', text: '(job.nc)\n', error: null });
    expect(Object.keys(out.results)).toEqual(['o1']);
  });

  it('installs the newest run, activates it and drops stale runs', async () => {
    appStore.setState({ job: withOp() });
    let first!: (r: CamRun) => void;
    worker.generateInWorker.mockImplementationOnce(() => new Promise((res) => (first = res)));
    worker.generateInWorker.mockImplementationOnce(async () => run(['new.nc']));
    const a = regenerate();
    const b = regenerate();
    await b;
    first(run(['old.nc']));
    await a;
    const s = appStore.getState();
    expect(allPrograms(s).map((p) => p.id)).toEqual(['gen:new.nc']);
    expect(s.activeProgramId).toBe('gen:new.nc');
    expect(Object.keys(s.programData)).toEqual(['gen:new.nc']);
    expect(s.camStatus).toBe('idle');
  });

  it('discards a run that resolves after a different document was loaded while it was in flight', async () => {
    appStore.setState({ job: withOp() });
    let resolveOld!: (r: CamRun) => void;
    worker.generateInWorker.mockImplementationOnce(() => new Promise((res) => (resolveOld = res)));
    const pending = regenerate();
    // Simulate loadDocument: a new job (different id), CAM fields reset, as loadDocument does.
    const newJob = applyCommand(createJob(), { type: 'addOperation', opType: 'drill', toolId: null, id: 'o2' } as JobCommand);
    appStore.setState({ job: newJob, generatedPrograms: [], camFiles: [], camResults: {}, programData: {}, activeProgramId: null });
    resolveOld(run(['old.nc']));
    await pending;
    const s = appStore.getState();
    expect(s.generatedPrograms).toEqual([]);
    expect(s.camResults).toEqual({});
    expect(s.programData).toEqual({});
  });

  it('clears the output without calling the worker when there are no operations', async () => {
    appStore.setState({ generatedPrograms: toCamOutput(run(['x.nc'])).programs, programData: toCamOutput(run(['x.nc'])).programData });
    await regenerate();
    expect(worker.generateInWorker).not.toHaveBeenCalled();
    expect(appStore.getState().generatedPrograms).toEqual([]);
    expect(appStore.getState().programData).toEqual({});
  });

  it('sends the model to the worker only when the geometry object changes', async () => {
    const geometry = { kind: 'drawing', drawing: { layers: [] }, rawPoints: new Float32Array() } as never; // a fresh object
    appStore.setState({ job: withOp(), geometry });
    worker.generateInWorker.mockResolvedValue(run([]));
    await regenerate();
    await regenerate();
    expect(worker.setCamModelInWorker).toHaveBeenCalledTimes(1);
  });

  it('re-sends the model after the worker was replaced', async () => {
    const geometry = { kind: 'drawing', drawing: { layers: [] }, rawPoints: new Float32Array() } as never;
    appStore.setState({ job: withOp(), geometry });
    worker.generateInWorker.mockResolvedValue(run([]));
    await regenerate();
    const sent = worker.setCamModelInWorker.mock.calls.length;
    worker.epoch++; // the shared worker timed out and was terminated
    await regenerate();
    expect(worker.setCamModelInWorker).toHaveBeenCalledTimes(sent + 1);
  });

  it('marks the output pending as soon as a regeneration is scheduled', () => {
    const stop = startCamPipeline(appStore, 60_000);
    try {
      appStore.setState({ camStatus: 'idle' });
      appStore.getState().dispatch({ type: 'addOperation', opType: 'drill', toolId: null, id: 'o9' } as JobCommand);
      expect(appStore.getState().camStatus).toBe('generating');
    } finally {
      stop();
    }
  });

  it('settles to idle when there is nothing to generate', async () => {
    appStore.setState({ camStatus: 'generating' });
    await regenerate();
    expect(appStore.getState().camStatus).toBe('idle');
  });

  it('discards a run whose job changed while it was in flight and runs again', async () => {
    appStore.setState({ job: withOp() });
    let resolveOld!: (r: CamRun) => void;
    worker.generateInWorker.mockImplementationOnce(() => new Promise((res) => (resolveOld = res)));
    worker.generateInWorker.mockImplementationOnce(async () => run(['fresh.nc']));
    const pending = regenerate();
    // same document, edited while the worker was busy (a change the pipeline does not watch, so no timer runs)
    appStore.setState({ job: { ...appStore.getState().job, name: appStore.getState().job.name } });
    resolveOld(run(['old.nc']));
    await pending;
    const s = appStore.getState();
    expect(worker.generateInWorker).toHaveBeenCalledTimes(2);
    expect(s.generatedPrograms.map((p) => p.id)).toEqual(['gen:fresh.nc']);
    expect(s.camStatus).toBe('idle');
  });

  it('treats only toolpath inputs as changes', () => {
    const job = withOp();
    expect(camInputsChanged(job, { ...job, programs: [] }, null, null)).toBe(false);
    expect(camInputsChanged(job, { ...job, name: 'Other' }, null, null)).toBe(true);
    expect(camInputsChanged(job, job, null, { kind: 'drawing', drawing: { layers: [] }, rawPoints: new Float32Array() })).toBe(true);
  });

  it('waits for the run of the current job, also across an edit during generation (review focus 1)', async () => {
    appStore.setState({ job: withOp(), camStatus: 'generating' });
    let release!: (r: CamRun) => void;
    worker.generateInWorker.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const waiting = waitForCamRun();
    const first = regenerate();
    // regenerate sends the model first; wait until the generate call (and its release function) exists
    await vi.waitFor(() => expect(worker.generateInWorker).toHaveBeenCalledTimes(1));
    // the user renames the job while the first run is in flight: its output must not be returned
    appStore.getState().commit((j) => ({ ...j, name: 'Renamed' }));
    worker.generateInWorker.mockResolvedValueOnce(run(['renamed.nc']));
    release(run(['old.nc']));
    await first;
    const { job, run: got } = await waiting;
    expect(job.name).toBe('Renamed');
    expect(got.files.map((f) => f.name)).toEqual(['renamed.nc']);
    expect(currentCamRun(appStore.getState())).toBe(got);
  });

  it('rejects when generation failed for the current job', async () => {
    appStore.setState({ job: withOp(), camStatus: 'generating' });
    worker.generateInWorker.mockRejectedValueOnce(new Error('boom'));
    const waiting = waitForCamRun();
    await regenerate();
    await expect(waiting).rejects.toThrow('Toolpath generation failed; see the tab');
  });

  it('answers at once for a job without operations', async () => {
    appStore.setState({ job: createJob('Empty'), camStatus: 'generating' });
    const waiting = waitForCamRun();
    await regenerate();
    expect((await waiting).run).toEqual({ results: [], files: [], catalog: null });
  });

  it('sends the model before asking the worker for the catalog and the preview', async () => {
    appStore.setState({ job: withOp(), geometry: null });
    await camCatalog();
    expect(worker.catalogInWorker).toHaveBeenCalledWith(appStore.getState().job);
    expect(await camPreviewSvg({ view: 'iso' })).toBe('<svg/>');
    expect(worker.previewSvgInWorker).toHaveBeenCalledWith(appStore.getState().job, expect.anything(), { view: 'iso' });
  });
});
