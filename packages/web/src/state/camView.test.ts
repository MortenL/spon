import { applyCommand, createJob, type JobCommand, starterLibrary } from '@sponcam/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { addOperation, operationSeconds, operationStatus, problemCount, runCommand } from './camView';
import { appStore } from './store';
import { toolLibraryStore } from './toolLibrary';

describe('camView', () => {
  beforeEach(() => {
    appStore.setState({ job: createJob(), camResults: {}, camFiles: [], programData: {}, camStatus: 'idle', selectedOperationId: null, camPick: null, past: [], future: [] });
    toolLibraryStore.setState({ tools: starterLibrary(), loaded: true });
  });

  it('adds an operation with the default library tool copied into the job, selected and picking', () => {
    addOperation('pocket');
    const s = appStore.getState();
    expect(s.job.tools.map((t) => t.id)).toEqual(['starter-flat-6']);
    expect(s.job.operations[0]).toMatchObject({ type: 'pocket', toolId: 'starter-flat-6', name: 'Pocket 1' });
    expect(s.selectedOperationId).toBe(s.job.operations[0].id);
    expect(s.inspectorTab).toBe('geometry');
    expect(s.camPick).toEqual({ operationId: s.job.operations[0].id, target: 'geometry' });
    addOperation('profile');
    expect(appStore.getState().job.tools).toHaveLength(1); // the tool is already in the job
    expect(appStore.getState().past).toHaveLength(3); // addTool, addOperation, addOperation — each undoable
  });

  it('reports status from results and the pipeline state', () => {
    const job = applyCommand(createJob(), { type: 'addOperation', opType: 'drill', toolId: null, id: 'd' } as JobCommand);
    appStore.setState({ job });
    const op = job.operations[0];
    expect(operationStatus(op, appStore.getState())).toBe('ok');
    // an info note (a pocket with tabs and no islands) is not a problem
    appStore.setState({ camResults: { d: { operationId: 'd', diagnostics: [{ operationId: 'd', severity: 'info', code: 'tab-no-islands', message: '' }], heights: null, overlays: { tabs: [], tabPaths: [], tabBridges: [], unmachined: [], gouges: [] }, hasToolpath: true } } });
    expect(operationStatus(op, appStore.getState())).toBe('ok');
    appStore.setState({ camResults: { d: { operationId: 'd', diagnostics: [{ operationId: 'd', severity: 'warning', code: 'tool-undersize', message: '' }], heights: null, overlays: { tabs: [], tabPaths: [], tabBridges: [], unmachined: [], gouges: [] }, hasToolpath: true } } });
    expect(operationStatus(op, appStore.getState())).toBe('warning');
    appStore.setState({ camStatus: 'generating' });
    expect(operationStatus(op, appStore.getState())).toBe('generating');
    expect(operationStatus({ ...op, enabled: false }, appStore.getState())).toBe('disabled');
  });

  it('sums the row durations inside an operation section', () => {
    const table = { count: 3, line: new Uint32Array([1, 2, 5]), t: new Float64Array([1, 3, 10]) };
    appStore.setState({
      camFiles: [{ name: 'a.nc', blobId: 'gen:a.nc', operationIds: ['d'], sections: [{ operationId: 'd', firstLine: 0, lastLine: 2 }], postErrors: [] }],
      programData: { 'gen:a.nc': { status: 'ready', text: '', parsed: { table } as never, error: null } },
    });
    expect(operationSeconds('d', appStore.getState())).toBe(3); // rows on lines 1 and 2: 1 + 2 seconds
    expect(operationSeconds('other', appStore.getState())).toBeNull();
  });

  it('turns command errors into a false result instead of throwing', () => {
    expect(runCommand({ type: 'removeOperation', id: 'missing' })).toBe(false);
  });

  it('counts only warnings and errors as problems, not info rows', () => {
    const d = (severity: 'error' | 'warning' | 'info') => ({ operationId: 'p', severity, code: 'tab-no-islands' as const, message: '' });
    expect(problemCount([d('info')])).toBe(0);
    expect(problemCount([d('info'), d('warning'), d('error')])).toBe(2);
    expect(problemCount([])).toBe(0);
  });
});
