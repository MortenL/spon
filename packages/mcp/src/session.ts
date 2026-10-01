import type {
  Boxes, ExportOutcome, GeometryCatalog, ImportOutcome, Job, JobCommand, LengthUnit, LibraryImportResult, PreviewOptions, ProgramRef, RunReport,
  SessionInfo, Tool,
} from '@sponcam/core';

export type { Boxes, ExportOutcome, ImportOutcome, LibraryImportResult, SessionInfo } from '@sponcam/core';

/** A failure with a message meant for Claude; the tool layer turns it into an isError result. */
export class SessionError extends Error {
  override name = 'SessionError';
}

export interface ModelInput { fileName: string; bytes: Uint8Array; units?: LengthUnit; body?: number }

export interface ToolLibraryAccess {
  list(): Promise<Tool[]>;
  add(tool: Tool): Promise<void>;
  importFile(fileName: string, bytes: Uint8Array, label?: string): Promise<LibraryImportResult>;
}

/** One open job: a .spon file on disk (FileSession) or the browser tab (LiveSession). */
export interface JobSession {
  readonly kind: 'file' | 'live';
  readonly tools: ToolLibraryAccess;
  describe(): Promise<SessionInfo>;
  job(): Promise<Job>;
  /** Atomic: all commands apply or none do. */
  apply(commands: readonly JobCommand[], label?: string): Promise<Job>;
  importModel(input: ModelInput): Promise<ImportOutcome>;
  /** Pipeline output for the current job, as plain JSON; cached per job version. */
  run(): Promise<RunReport>;
  catalog(): Promise<GeometryCatalog | null>;
  /** Placed model box and stock box in program coordinates. */
  boxes(): Promise<Boxes>;
  previewSvg(options: PreviewOptions): Promise<string>;
  /** Returns the absolute path written. */
  save(path?: string): Promise<string>;
  exportGcode(): Promise<ExportOutcome>;
  importProgram(fileName: string, bytes: Uint8Array): Promise<ProgramRef>;
}
