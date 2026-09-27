import { type Mesh, triangleCount } from './mesh';

export interface Adjacency {
  /** neighbors[t*3+e]: the triangle across edge e (corner e → corner (e+1)%3) of triangle t, or -1. */
  neighbors: Int32Array;
  openEdges: number;
  nonManifoldEdges: number;
}

export function buildAdjacency(mesh: Mesh): Adjacency {
  const tris = triangleCount(mesh);
  const vertexCount = mesh.positions.length / 3;
  const edges = new Map<number, number[]>(); // edge key → list of (tri*3 + edge)
  for (let t = 0; t < tris; t++) {
    for (let e = 0; e < 3; e++) {
      const a = mesh.indices[t * 3 + e];
      const b = mesh.indices[t * 3 + ((e + 1) % 3)];
      const key = Math.min(a, b) * vertexCount + Math.max(a, b);
      const list = edges.get(key);
      if (list) list.push(t * 3 + e);
      else edges.set(key, [t * 3 + e]);
    }
  }
  const neighbors = new Int32Array(tris * 3).fill(-1);
  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const list of edges.values()) {
    if (list.length === 1) openEdges++;
    else if (list.length === 2) {
      neighbors[list[0]] = Math.floor(list[1] / 3);
      neighbors[list[1]] = Math.floor(list[0] / 3);
    } else nonManifoldEdges++;
  }
  return { neighbors, openEdges, nonManifoldEdges };
}
