import type { GeometryCatalog } from '../cam/features/describe';
import type { BBox } from '../geometry/bbox';
import type { Vec3 } from '../geometry/vec3';
import type { CadBodySummary, ModelFormat, ModelKind } from '../import/importFile';
import type { JobCommand } from '../job/commands';
import type { Job, ModelRef, ProgramRef } from '../job/types';
import type { RunReport } from '../pipeline/report';
import type { PreviewOptions } from '../preview/svg';
import type { Tool } from '../tools/types';
import type { LengthUnit } from '../units/units';

/** The live bridge between the MCP server and one browser tab: JSON-RPC 2.0 over a WebSocket. */
export const BRIDGE_PROTOCOL = 1;
export const DEFAULT_BRIDGE_PORT = 5197;
export const BRIDGE_TIMEOUT_MS = 60_000;
/** Large STEP files take a while to read. */
export const BRIDGE_IMPORT_TIMEOUT_MS = 300_000;
/** WebSocket close codes (4000–4999 are free for applications); the close reason is the message to show. */
export const BRIDGE_CLOSE = { protocolMismatch: 4001, busy: 4002, replaced: 4003 } as const;
export const BUSY_MESSAGE = 'Another Spon tab is connected';
export const REPLACED_MESSAGE = 'Disconnected — another tab took over';

export interface SessionModel { sourceName: string; kind: ModelKind; format: ModelFormat; body: number | null }

export interface SessionInfo {
  kind: 'file' | 'live';
  name: string;
  /** File session: the absolute .spon path. Live: the tab's file name. Null until opened or saved. */
  path: string | null;
  dirty: boolean;
  model: SessionModel | null;
  operations: number;
}

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

/** Placed model box and stock box in program coordinates. */
export interface Boxes { model: BBox | null; stock: BBox | null }

/** The tab's first message. `takeover` is true only for an explicit Connect click. */
export interface HelloParams { protocol: number; app: string; title: string; dirty: boolean; takeover: boolean }
export interface WelcomeParams { protocol: number; server: string }
/** Sent by the tab whenever its job name or dirty flag changes. */
export interface JobChangedParams { title: string; dirty: boolean }

type NoParams = Record<string, never>;

/** Requests the server sends to the tab. Bytes travel as base64 strings. */
export interface BridgeMethods {
  describe: { params: NoParams; result: SessionInfo };
  job: { params: NoParams; result: Job };
  /** Atomic, one undo step. */
  apply: { params: { commands: JobCommand[]; label: string }; result: Job };
  importModel: { params: { fileName: string; bytes: string; units?: LengthUnit; body?: number }; result: ImportOutcome };
  run: { params: NoParams; result: RunReport };
  catalog: { params: NoParams; result: GeometryCatalog | null };
  boxes: { params: NoParams; result: Boxes };
  previewSvg: { params: PreviewOptions; result: string };
  /** Saves through the tab's own file handle; returns the file name. */
  save: { params: NoParams; result: { name: string } };
  /** The job as .spon bytes, for the server to write; `token` goes back in markSaved. */
  saveBytes: { params: NoParams; result: { bytes: string; token: number } };
  /** Sent after the server wrote the saveBytes file; the tab clears its dirty flag if the job is unchanged. */
  markSaved: { params: { token: number }; result: { saved: boolean } };
  exportGcode: { params: NoParams; result: ExportOutcome };
  importProgram: { params: { fileName: string; bytes: string }; result: ProgramRef };
  'tools.list': { params: NoParams; result: Tool[] };
  'tools.add': { params: { tool: Tool }; result: NoParams };
  'tools.import': { params: { fileName: string; bytes: string }; result: LibraryImportResult };
}
export type BridgeMethod = keyof BridgeMethods;
export type BridgeParams<M extends BridgeMethod> = BridgeMethods[M]['params'];
export type BridgeResult<M extends BridgeMethod> = BridgeMethods[M]['result'];

export function modelSummary(model: ModelRef | null): SessionModel | null {
  if (!model) return null;
  return { sourceName: model.sourceName, kind: model.kind, format: model.format ?? (model.kind === 'mesh' ? 'stl' : 'dxf'), body: model.body ?? null };
}

/** Chunked, so multi-megabyte files never overflow the argument limit of String.fromCharCode. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
