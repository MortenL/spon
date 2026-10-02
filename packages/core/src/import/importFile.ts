import type { Adjacency } from '../geometry/adjacency';
import type { Mesh, MeshDiagnostics } from '../geometry/mesh';
import type { Vec2 } from '../geometry/path2d';
import type { Vec3 } from '../geometry/vec3';
import type { LengthUnit } from '../units/units';
import { type Drawing, parseDxf } from './dxf/dxf';
import { parseSvg, type SvgScale } from './svg/svg';
import { importStl } from './stl';

export type ModelKind = 'mesh' | 'drawing';
export type ModelFormat = 'stl' | 'dxf' | 'step' | 'iges' | 'svg';
/** Formats read by the OCCT reader (occt-import-js) in the web import worker. */
export type CadFormat = 'step' | 'iges';

/** Where a STEP/IGES mesh came from. */
export interface CadSource {
  format: CadFormat;
  /** The chosen body, 0-based. */
  body: number;
  /** How many bodies the file has. */
  bodies: number;
  name: string;
}

export interface CadBodySummary {
  name: string;
  triangles: number;
  /** Bounding box size in mm. */
  size: Vec3;
}

export const MAX_SOFT_IMPORT_BYTES = 200 * 1024 * 1024;

export type ImportResult =
  | {
      ok: true;
      kind: 'mesh';
      mesh: Mesh;
      adjacency: Adjacency;
      detectedUnits: LengthUnit | null;
      diagnostics: MeshDiagnostics;
      warnings: string[];
      source?: CadSource;
    }
  | { ok: true; kind: 'drawing'; drawing: Drawing; detectedUnits: LengthUnit | null; warnings: string[]; svgScale?: number }
  /** An SVG without real-world units; `rawSize` is in px. */
  | { ok: true; kind: 'needsScale'; rawSize: Vec2; warnings: string[] }
  /** A STEP/IGES file with several bodies, read without choosing one. */
  | { ok: true; kind: 'bodies'; format: CadFormat; bodies: CadBodySummary[] }
  | { ok: false; error: string };

const FORMATS = new Map<string, ModelFormat>([['stl', 'stl'], ['dxf', 'dxf'], ['svg', 'svg'], ['step', 'step'], ['stp', 'step'], ['iges', 'iges'], ['igs', 'iges']]);

export function modelFormat(fileName: string): ModelFormat | null {
  if (!fileName.includes('.')) return null;
  return FORMATS.get(fileName.toLowerCase().split('.').pop()!) ?? null;
}

export function cadFormat(fileName: string): CadFormat | null {
  const format = modelFormat(fileName);
  return format === 'step' || format === 'iges' ? format : null;
}

export function fileKind(fileName: string): ModelKind | null {
  const format = modelFormat(fileName);
  return format === null ? null : format === 'dxf' || format === 'svg' ? 'drawing' : 'mesh';
}

export function importFile(fileName: string, bytes: Uint8Array, options: { svgScale?: SvgScale } = {}): ImportResult {
  const format = modelFormat(fileName);
  if (!format) return { ok: false, error: `Unsupported file type: ${fileName}` };
  if (format === 'step' || format === 'iges') return { ok: false, error: 'STEP and IGES files are read by the import worker' };
  try {
    if (format === 'stl') {
      const stl = importStl(bytes);
      return { ok: true, kind: 'mesh', ...stl, detectedUnits: null };
    }
    const text = new TextDecoder('utf-8').decode(bytes);
    if (format === 'svg') {
      const svg = parseSvg(text, { svgScale: options.svgScale });
      if (svg.kind === 'needsScale') return { ok: true, kind: 'needsScale', rawSize: svg.rawSize, warnings: svg.warnings };
      return { ok: true, kind: 'drawing', drawing: svg.drawing, detectedUnits: 'mm', warnings: svg.warnings, svgScale: svg.svgScale };
    }
    const dxf = parseDxf(text);
    return { ok: true, kind: 'drawing', drawing: dxf.drawing, detectedUnits: dxf.detectedUnits, warnings: dxf.warnings };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Buffers that can be transferred (not copied) when posting an ImportResult between threads. */
export function importResultTransferables(result: ImportResult): ArrayBuffer[] {
  if (!result.ok || result.kind !== 'mesh') return [];
  const { mesh, adjacency } = result;
  return [mesh.positions.buffer, mesh.indices.buffer, mesh.normals.buffer, adjacency.neighbors.buffer, ...(mesh.faceIds ? [mesh.faceIds.buffer] : [])] as ArrayBuffer[];
}
