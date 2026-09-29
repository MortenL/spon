import { applyCommand, createJob, type JobCommand } from '@sponcam/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CamRun } from './camTypes';

const worker = vi.hoisted(() => ({
  setCamModelInWorker: vi.fn(async () => {}),
  generateInWorker: vi.fn(),
}));
vi.mock('../workers/importClient', () => worker);

const { regenerate, toCamOutput } = await import('./cam');
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
    appStore.setState({ job: createJob(), programData: {}, generatedPrograms: [], camFiles: [], camResults: {}, activeProgramId: null });
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
});
