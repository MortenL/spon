import type {
  BBox, CadBodySummary, CamRun, GeometryCatalog, Job, JobCommand, LengthUnit, ModelFormat, ModelKind, PreviewOptions, ProgramRef, Tool, Vec3,
} from '@sponcam/core';

/** A failure with a message meant for Claude; the tool layer turns it into an isError result. */
export class SessionError extends Error {
  override name = 'SessionError';
}

export interface SessionInfo {
  kind: 'file' | 'live';
  name: string;
  /** Absolute .spon path once opened or saved, else null. */
  path: string | null;
  dirty: boolean;
  model: { sourceName: string; kind: ModelKind; format: ModelFormat; body: number | null } | null;
  operations: number;
}

export interface ModelInput { fileName: string; bytes: Uint8Array; units?: LengthUnit; body?: number }

export type ImportOutcome =
  | { status: 'imported'; kind: ModelKind; size: Vec3; units: LengthUnit; warnings: string[] }
  /** STL/DXF that doesn't declare its units; `rawSize` is in file units. */
  | { status: 'needsUnits'; suggested: LengthUnit; rawSize: Vec3 }
  | { status: 'needsBody'; bodies: CadBodySummary[]; suggested: number }
  | { status: 'error'; error: string };

export type ExportOutcome =
  | { ok: true; files: { name: string; text: string }[]; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

export interface LibraryImportResult { added: number; updated: number; skipped: { name: string; reason: string }[]; notes: string[] }

export interface ToolLibraryAccess {
  list(): Promise<Tool[]>;
  add(tool: Tool): Promise<void>;
  importFile(fileName: string, bytes: Uint8Array): Promise<LibraryImportResult>;
}

/** One open job: a .spon file on disk (FileSession) or, in phase 2, the browser tab. */
export interface JobSession {
  readonly kind: 'file' | 'live';
  readonly tools: ToolLibraryAccess;
  describe(): Promise<SessionInfo>;
  job(): Promise<Job>;
  /** Atomic: all commands apply or none do. */
  apply(commands: readonly JobCommand[], label?: string): Promise<Job>;
  importModel(input: ModelInput): Promise<ImportOutcome>;
  run(): Promise<CamRun>;
  catalog(): Promise<GeometryCatalog | null>;
  /** Placed model box and stock box in program coordinates. */
  boxes(): Promise<{ model: BBox | null; stock: BBox | null }>;
  previewSvg(options: PreviewOptions): Promise<string>;
  /** Returns the absolute path written. */
  save(path?: string): Promise<string>;
  exportGcode(): Promise<ExportOutcome>;
  importProgram(fileName: string, bytes: Uint8Array): Promise<ProgramRef>;
}
