import type { Adjacency } from '../geometry/adjacency';
import type { Mesh, MeshDiagnostics } from '../geometry/mesh';
import type { LengthUnit } from '../units/units';
import { type Drawing, parseDxf } from './dxf/dxf';
import { importStl } from './stl';

export type ModelKind = 'mesh' | 'drawing';

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
    }
  | { ok: true; kind: 'drawing'; drawing: Drawing; detectedUnits: LengthUnit | null; warnings: string[] }
  | { ok: false; error: string };

export function fileKind(fileName: string): ModelKind | null {
  const ext = fileName.toLowerCase().split('.').pop();
  if (!fileName.includes('.')) return null;
  return ext === 'stl' ? 'mesh' : ext === 'dxf' ? 'drawing' : null;
}

export function importFile(fileName: string, bytes: Uint8Array): ImportResult {
  const kind = fileKind(fileName);
  if (!kind) return { ok: false, error: `Unsupported file type: ${fileName}` };
  try {
    if (kind === 'mesh') {
      const stl = importStl(bytes);
      return { ok: true, kind: 'mesh', ...stl, detectedUnits: null };
    }
    const dxf = parseDxf(new TextDecoder('utf-8').decode(bytes));
    return { ok: true, kind: 'drawing', drawing: dxf.drawing, detectedUnits: dxf.detectedUnits, warnings: dxf.warnings };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Buffers that can be transferred (not copied) when posting an ImportResult between threads. */
export function importResultTransferables(result: ImportResult): ArrayBuffer[] {
  if (!result.ok || result.kind !== 'mesh') return [];
  return [result.mesh.positions.buffer, result.mesh.indices.buffer, result.mesh.normals.buffer, result.adjacency.neighbors.buffer] as ArrayBuffer[];
}
