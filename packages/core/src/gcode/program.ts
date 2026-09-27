import type { WorkOffset } from '../job/types';
import { type AnalysisContext, type AnalysisResult, analyzeTable } from './analysis';
import { decodeProgramText } from './decode';
import { interpretProgram } from './interpreter';
import type { Diagnostic, MotionTable } from './types';

export interface ProgramContext extends AnalysisContext {
  jobWorkOffset: WorkOffset;
}

export interface ParsedProgram {
  table: MotionTable;
  lineStarts: Uint32Array;
  lineFlags: Uint8Array;
  firstMoveOfLine: Int32Array;
  /** Diagnostics that depend only on the program text. */
  interpretDiagnostics: Diagnostic[];
  tools: number[];
  usesInch: boolean;
  /** Timing, summary and job-dependent diagnostics; recomputed when the machine, stock or WCS change. */
  analysis: AnalysisResult;
}

export function parseProgram(bytes: Uint8Array, ctx: ProgramContext): ParsedProgram {
  const result = interpretProgram(decodeProgramText(bytes), { jobWorkOffset: ctx.jobWorkOffset });
  const analysis = analyzeTable(result.table, result.lineFlags, ctx);
  return {
    table: result.table,
    lineStarts: result.lineStarts,
    lineFlags: result.lineFlags,
    firstMoveOfLine: result.firstMoveOfLine,
    interpretDiagnostics: result.diagnostics,
    tools: result.tools,
    usesInch: result.usesInch,
    analysis,
  };
}

export function allDiagnostics(p: Pick<ParsedProgram, 'interpretDiagnostics' | 'analysis'>): Diagnostic[] {
  return [...p.interpretDiagnostics, ...p.analysis.diagnostics].sort((a, b) => a.line - b.line);
}

export function motionTableTransferables(table: MotionTable): ArrayBuffer[] {
  return [table.kind, table.end, table.arc, table.plane, table.feed, table.param, table.line, table.tool, table.flags, table.t]
    .map((a) => a.buffer as ArrayBuffer);
}

export function parsedProgramTransferables(p: ParsedProgram): ArrayBuffer[] {
  return [...motionTableTransferables(p.table), p.lineStarts.buffer as ArrayBuffer, p.lineFlags.buffer as ArrayBuffer, p.firstMoveOfLine.buffer as ArrayBuffer];
}
