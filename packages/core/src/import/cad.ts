import { type BBox, bboxOfPoints, bboxSize } from '../geometry/bbox';
import type { Mesh } from '../geometry/mesh';
import { weldTriangles } from '../geometry/weld';
import type { CadFormat, ImportResult } from './importFile';
import { finishMeshImport } from './stl';

/** The parts of an occt-import-js mesh that Spon reads. */
export interface OcctMesh {
  name?: string;
  attributes: { position: { array: ArrayLike<number> } };
  index: { array: ArrayLike<number> };
  /** The source B-rep faces as inclusive triangle ranges. */
  brep_faces?: { first: number; last: number }[];
}
export interface OcctNode { name: string; meshes: number[]; children: OcctNode[] }
/** What occt-import-js's ReadStepFile / ReadIgesFile return. */
export interface OcctResult { success: boolean; root?: OcctNode; meshes?: OcctMesh[] }

export interface OcctBody {
  name: string;
  /** Welded mesh; `mesh.faceIds` is the same array as `faceIds`, or undefined when `faceIds` is empty. */
  mesh: Mesh;
  /** Per-triangle B-rep face id, dense from 0. Empty when no reader mesh in the group had any `brep_faces` entries. */
  faceIds: Uint32Array;
  triangles: number;
  bbox: BBox;
  degenerateRemoved: number;
}

export const CAD_LABEL: Record<CadFormat, 'STEP' | 'IGES'> = { step: 'STEP', iges: 'IGES' };

/**
 * Welds a group of reader meshes into one body; face ids are renumbered densely in order of appearance. When no
 * mesh in the group has any `brep_faces` entries, `mesh.faceIds` is left undefined (so `faceRegion` falls back to
 * `planarRegion`, the STL behaviour) and `faceIds` is an empty array.
 */
function toBody(group: readonly OcctMesh[], name: string): OcctBody | null {
  const hasFaces = group.some((m) => (m.brep_faces?.length ?? 0) > 0);
  let total = 0;
  for (const m of group) total += Math.floor(m.index.array.length / 3);
  const soup = new Float32Array(total * 9);
  const sourceFace = hasFaces ? new Uint32Array(total) : undefined;
  let t = 0;
  let nextFace = 0;
  for (const m of group) {
    const pos = m.attributes.position.array;
    const idx = m.index.array;
    const n = Math.floor(idx.length / 3);
    const local = hasFaces ? new Int32Array(n).fill(-1) : undefined;
    if (local) {
      for (const f of m.brep_faces ?? []) {
        const id = nextFace++;
        for (let k = Math.max(0, f.first); k <= Math.min(n - 1, f.last); k++) local[k] = id;
      }
    }
    for (let k = 0; k < n; k++, t++) {
      for (let c = 0; c < 3; c++) {
        const v = idx[k * 3 + c];
        soup[t * 9 + c * 3] = pos[v * 3];
        soup[t * 9 + c * 3 + 1] = pos[v * 3 + 1];
        soup[t * 9 + c * 3 + 2] = pos[v * 3 + 2];
      }
      if (sourceFace && local) sourceFace[t] = local[k] >= 0 ? local[k] : nextFace++; // a triangle outside every face range is a face of its own
    }
  }
  const { mesh, degenerateRemoved, kept } = weldTriangles(soup);
  if (kept.length === 0) return null;
  if (!sourceFace) {
    return { name, mesh, faceIds: new Uint32Array(0), triangles: kept.length, bbox: bboxOfPoints(mesh.positions)!, degenerateRemoved };
  }
  const dense = new Map<number, number>();
  const faceIds = new Uint32Array(kept.length);
  for (let i = 0; i < kept.length; i++) {
    const f = sourceFace[kept[i]];
    let id = dense.get(f);
    if (id === undefined) {
      id = dense.size;
      dense.set(f, id);
    }
    faceIds[i] = id;
  }
  mesh.faceIds = faceIds;
  return { name, mesh, faceIds, triangles: kept.length, bbox: bboxOfPoints(mesh.positions)!, degenerateRemoved };
}

/**
 * The bodies of a reader result: one per reader mesh for STEP. IGES surface models come back as one reader mesh
 * per face, so an IGES file is always one body. Bodies with only degenerate triangles are dropped.
 */
export function occtToBodies(result: OcctResult, format: CadFormat): OcctBody[] {
  const meshes = result.meshes ?? [];
  const groups = format === 'iges' ? (meshes.length ? [meshes] : []) : meshes.map((m) => [m]);
  const bodies: OcctBody[] = [];
  groups.forEach((group, i) => {
    const name = group.length === 1 && group[0].name ? group[0].name : `Body ${i + 1}`;
    const body = toBody(group, name);
    if (body) bodies.push(body);
  });
  return bodies;
}

/** A reader result as an import result: the chosen body (default the only one), or the list to choose from. */
export function cadImport(result: OcctResult, format: CadFormat, body?: number): ImportResult {
  const label = CAD_LABEL[format];
  if (!result.success) return { ok: false, error: `Not a readable ${label} file` };
  const bodies = occtToBodies(result, format);
  if (bodies.length === 0) return { ok: false, error: 'No solid bodies found' };
  if (body === undefined && bodies.length > 1) {
    return { ok: true, kind: 'bodies', format, bodies: bodies.map((b) => ({ name: b.name, triangles: b.triangles, size: bboxSize(b.bbox) })) };
  }
  const index = body ?? 0;
  const chosen = Number.isInteger(index) ? bodies[index] : undefined;
  if (!chosen) return { ok: false, error: `The ${label} file has no body ${index + 1}` };
  const imported = finishMeshImport(chosen.mesh, chosen.degenerateRemoved);
  return { ok: true, kind: 'mesh', ...imported, detectedUnits: 'mm', source: { format, body: index, bodies: bodies.length, name: chosen.name } };
}
