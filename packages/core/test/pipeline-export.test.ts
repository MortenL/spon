import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { type ExportFileInput, type ExportInput, exportFiles, exportProblems } from '../src';

const file = (over: Partial<ExportFileInput> = {}): ExportFileInput => ({ name: 'a.nc', text: 'G0 X1\n', postErrors: [], analysisDiagnostics: [], ...over });
const input = (over: Partial<ExportInput> = {}): ExportInput => ({
  jobName: 'My Part', operations: [{ id: 'o', name: 'Pocket 1' }], results: { o: { diagnostics: [] } }, files: [file()], ...over,
});
const diag = (severity: 'error' | 'warning', code: string, message: string, line = 0) => ({ line, severity, code, message }) as never;

describe('export checks', () => {
  it('blocks on operation and post errors, warns on warnings and analysis findings', () => {
    expect(exportProblems(input())).toEqual({ errors: [], warnings: [] });
    const warned = input({
      results: { o: { diagnostics: [{ operationId: 'o', severity: 'warning', code: 'unmachined-area', message: 'Corners' }] } },
      files: [file({ analysisDiagnostics: [diag('error', 'below-stock-bottom', 'Too deep', 4)] })],
    });
    expect(exportProblems(warned)).toEqual({ errors: [], warnings: ['Pocket 1: Corners', 'a.nc line 5: Too deep'] });
    const failed = input({
      results: { o: { diagnostics: [{ operationId: 'o', severity: 'error', code: 'no-tool', message: 'Choose a tool' }] } },
      files: [file({ postErrors: [diag('error', 'feed-no-f', 'No F')] })],
    });
    expect(exportProblems(failed).errors).toEqual(['Pocket 1: Choose a tool', 'a.nc: post-processor produced invalid G-code (No F)']);
    expect(exportProblems(input({ files: [] })).errors).toEqual(['Nothing to export: add operations with geometry']);
  });

  it('returns one file directly and several as a zip named after the job', () => {
    const one = exportFiles(input());
    expect(one.name).toBe('a.nc');
    expect(new TextDecoder().decode(one.bytes)).toBe('G0 X1\n');
    const two = input({ files: [file(), file({ name: 'b.nc', text: 'G0 X2\n' })] });
    const zip = exportFiles(two);
    expect(zip.name).toBe('My_Part.zip');
    const files = unzipSync(zip.bytes);
    expect(Object.keys(files)).toEqual(['a.nc', 'b.nc']);
    expect(strFromU8(files['b.nc'])).toBe('G0 X2\n');
  });
});
