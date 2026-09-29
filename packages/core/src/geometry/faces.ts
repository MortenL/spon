import type { Adjacency } from './adjacency';
import { type Mesh, triangleNormal, triangleVertices } from './mesh';
import { planarRegion, type PlanarRegionOptions } from './planarRegion';
import { v3dot } from './vec3';

interface FaceIndex {
  /** Triangle indices grouped by face id, ascending within each face. */
  order: Uint32Array;
  /** Face `id` owns order[start[id] .. start[id + 1]). */
  start: Uint32Array;
}
const indexes = new WeakMap<Mesh, FaceIndex>();

function faceIndex(mesh: Mesh, ids: Uint32Array): FaceIndex {
  const cached = indexes.get(mesh);
  if (cached) return cached;
  let max = 0;
  for (let t = 0; t < ids.length; t++) if (ids[t] > max) max = ids[t];
  const start = new Uint32Array(max + 2);
  for (let t = 0; t < ids.length; t++) start[ids[t] + 1]++;
  for (let i = 1; i < start.length; i++) start[i] += start[i - 1];
  const fill = start.slice(0, max + 1);
  const order = new Uint32Array(ids.length);
  for (let t = 0; t < ids.length; t++) order[fill[ids[t]]++] = t;
  const index = { order, start };
  indexes.set(mesh, index);
  return index;
}

/** Every triangle with the seed's face id, ascending; just the seed on a mesh without face ids. */
export function faceTriangles(mesh: Mesh, seed: number): number[] {
  const ids = mesh.faceIds;
  if (!ids) return [seed];
  const { order, start } = faceIndex(mesh, ids);
  const id = ids[seed];
  return Array.from(order.subarray(start[id], start[id + 1]));
}

/** True when every triangle lies on the seed triangle's plane (the same tolerances as planarRegion). */
function isFlat(mesh: Mesh, tris: readonly number[], seed: number, opts: PlanarRegionOptions): boolean {
  const cosTol = Math.cos(((opts.angleTolDeg ?? 1) * Math.PI) / 180);
  const distTol = opts.distanceTol ?? 0.01;
  const n0 = triangleNormal(mesh, seed);
  const d0 = v3dot(n0, triangleVertices(mesh, seed)[0]);
  return tris.every((t) =>
    v3dot(triangleNormal(mesh, t), n0) >= cosTol && triangleVertices(mesh, t).every((v) => Math.abs(v3dot(n0, v) - d0) <= distTol));
}

/**
 * The flat face containing `seed`: the source file's B-rep face when the mesh has face ids and that face is flat,
 * otherwise the planar region flood-filled from the seed (STL meshes, curved STEP faces).
 */
export function faceRegion(mesh: Mesh, adjacency: Adjacency, seed: number, opts: PlanarRegionOptions = {}): number[] {
  if (mesh.faceIds) {
    const tris = faceTriangles(mesh, seed);
    if (isFlat(mesh, tris, seed, opts)) return tris;
  }
  return planarRegion(mesh, adjacency, seed, opts);
}
