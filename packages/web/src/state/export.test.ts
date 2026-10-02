import { createJob } from '@sponcam/core';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { exportFiles, exportGcode, exportProblems, type ExportState } from './export';
import { appStore } from './store';

const parsed = (diags: { line: number; severity: 'error' | 'warning'; code: string; message: string }[] = []) =>
  ({ interpretDiagnostics: [], analysis: { diagnostics: diags } }) as never;
const base = (): ExportState => {
  const job = { ...createJob('My Part'), operations: [{ id: 'o', name: 'Pocket 1' }] as never };
  return {
    job,
    camResults: { o: { operationId: 'o', diagnostics: [], heights: null, overlays: { tabs: [], laps: [], unmachined: [], gouges: [] }, hasToolpath: true } },
    camFiles: [{ name: 'a.nc', blobId: 'gen:a.nc', operationIds: ['o'], sections: [], postErrors: [] }],
    programData: { 'gen:a.nc': { status: 'ready' as const, text: 'G0 X1\n', parsed: parsed(), error: null } },
  };
};

describe('export', () => {
  it('blocks on operation and post errors, warns on warnings and analysis findings', () => {
    const s = base();
    expect(exportProblems(s)).toEqual({ errors: [], warnings: [] });
    s.camResults.o.diagnostics = [{ operationId: 'o', severity: 'warning', code: 'unmachined-area', message: 'Corners' }] as never;
    s.programData['gen:a.nc'].parsed = parsed([{ line: 4, severity: 'error', code: 'below-stock-bottom', message: 'Too deep' }]);
    expect(exportProblems(s)).toEqual({ errors: [], warnings: ['Pocket 1: Corners', 'a.nc line 5: Too deep'] });
    s.camFiles[0].postErrors = [{ line: 0, severity: 'error', code: 'feed-no-f', message: 'No F' }] as never;
    s.camResults.o.diagnostics = [{ operationId: 'o', severity: 'error', code: 'no-tool', message: 'Choose a tool' }] as never;
    expect(exportProblems(s).errors).toEqual(['Pocket 1: Choose a tool', 'a.nc: post-processor produced invalid G-code (No F)']);
    expect(exportProblems({ ...base(), camFiles: [] }).errors).toEqual(['Nothing to export: add operations with geometry']);
  });

  it('downloads one file directly and several as a zip named after the job', () => {
    const one = exportFiles(base());
    expect(one.name).toBe('a.nc');
    expect(new TextDecoder().decode(one.bytes)).toBe('G0 X1\n');
    const s = base();
    s.camFiles.push({ name: 'b.nc', blobId: 'gen:b.nc', operationIds: ['o'], sections: [], postErrors: [] });
    s.programData['gen:b.nc'] = { status: 'ready', text: 'G0 X2\n', parsed: parsed(), error: null };
    const zip = exportFiles(s);
    expect(zip.name).toBe('My_Part.zip');
    const files = unzipSync(zip.bytes);
    expect(Object.keys(files)).toEqual(['a.nc', 'b.nc']);
    expect(strFromU8(files['b.nc'])).toBe('G0 X2\n');
  });

  it('aborts when the output changes or regeneration starts while the warnings are being confirmed', async () => {
    const warned = (): ExportState => {
      const s = base();
      s.camResults.o.diagnostics = [{ operationId: 'o', severity: 'warning', code: 'unmachined-area', message: 'Corners' }] as never;
      return s;
    };
    const click = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ click }) });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
    for (const change of [
      () => appStore.setState({ camStatus: 'generating' }),
      () => appStore.setState({ camFiles: [...appStore.getState().camFiles] }),
    ]) {
      appStore.setState({ ...warned(), camStatus: 'idle' });
      const ok = await exportGcode(async () => {
        change();
        return true;
      });
      expect(ok).toBe(false);
    }
    expect(click).not.toHaveBeenCalled();
    appStore.setState({ ...warned(), camStatus: 'idle' });
    expect(await exportGcode(async () => true)).toBe(true); // unchanged: the download goes ahead
    expect(click).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
