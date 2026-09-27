import {
  type AnalysisContext, type AnalysisResult, analyzeTable, type ImportResult, importFile, importResultTransferables,
  type MotionTable, type ParsedProgram, parsedProgramTransferables, parseProgram, type ProgramContext,
} from '@sponcam/core';
import * as Comlink from 'comlink';

const api = {
  import(fileName: string, bytes: Uint8Array): ImportResult {
    const result = importFile(fileName, bytes);
    return Comlink.transfer(result, importResultTransferables(result));
  },
  parseProgram(bytes: Uint8Array, ctx: ProgramContext): ParsedProgram {
    const parsed = parseProgram(bytes, ctx);
    return Comlink.transfer(parsed, parsedProgramTransferables(parsed));
  },
  /** Receives a copy of the table (structured clone), re-times it and returns only the new times and analysis. */
  analyze(table: MotionTable, lineFlags: Uint8Array, ctx: AnalysisContext): { analysis: AnalysisResult; t: Float64Array } {
    const analysis = analyzeTable(table, lineFlags, ctx);
    return Comlink.transfer({ analysis, t: table.t }, [table.t.buffer as ArrayBuffer]);
  },
};

export type ImportWorkerApi = typeof api;

Comlink.expose(api);
