import type { Adjacency } from './adjacency';
import { type Mesh, triangleCount, triangleNormal, triangleVertices } from './mesh';
import { v3add, v3cross, v3dot, v3normalize, v3sub, type Vec3, vec3 } from './vec3';

export interface PlanarRegionOptions {
  /** Maximum angle between a triangle's normal and the seed normal. Default 1°. */
  angleTolDeg?: number;
  /** Maximum distance of any vertex from the seed plane, in the mesh's raw units. Default 0.01. */
  distanceTol?: number;
}

/** Flood-fills across shared edges from `seed`, collecting triangles that lie on the seed triangle's plane. */
export function planarRegion(mesh: Mesh, adjacency: Adjacency, seed: number, opts: PlanarRegionOptions = {}): number[] {
  const cosTol = Math.cos(((opts.angleTolDeg ?? 1) * Math.PI) / 180);
  const distTol = opts.distanceTol ?? 0.01;
  const n0 = triangleNormal(mesh, seed);
  const d0 = v3dot(n0, triangleVertices(mesh, seed)[0]);

  const visited = new Uint8Array(triangleCount(mesh));
  visited[seed] = 1;
  const stack = [seed];
  const region: number[] = [];
  while (stack.length) {
    const t = stack.pop()!;
    region.push(t);
    for (let e = 0; e < 3; e++) {
      const nb = adjacency.neighbors[t * 3 + e];
      if (nb < 0 || visited[nb]) continue;
      visited[nb] = 1;
      if (v3dot(triangleNormal(mesh, nb), n0) < cosTol) continue;
      if (triangleVertices(mesh, nb).some((v) => Math.abs(v3dot(n0, v) - d0) > distTol)) continue;
      stack.push(nb);
    }
  }
  return region;
}

/** Area-weighted average normal of a set of triangles, as a unit vector. */
export function regionNormal(mesh: Mesh, tris: ArrayLike<number>): Vec3 {
  let sum = vec3(0, 0, 0);
  for (let i = 0; i < tris.length; i++) {
    const [a, b, c] = triangleVertices(mesh, tris[i]);
    sum = v3add(sum, v3cross(v3sub(b, a), v3sub(c, a))); // length = 2 × area
  }
  return v3normalize(sum);
}
