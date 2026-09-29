import { v3add, v3dot, v3length, v3scale, v3sub, type Vec3, vec3 } from './vec3';

export interface Mesh {
  positions: Float32Array; // xyz per vertex
  indices: Uint32Array; // 3 vertex indices per triangle
  normals: Float32Array; // one unit normal per triangle
  /** STEP/IGES meshes: the source B-rep face of each triangle (dense ids from 0). */
  faceIds?: Uint32Array;
}

export interface MeshDiagnostics {
  triangles: number;
  vertices: number;
  degenerateRemoved: number;
  openEdges: number;
  nonManifoldEdges: number;
}

export const triangleCount = (mesh: Mesh): number => mesh.indices.length / 3;

export function vertexAt(mesh: Mesh, index: number): Vec3 {
  const p = mesh.positions;
  return vec3(p[index * 3], p[index * 3 + 1], p[index * 3 + 2]);
}

export function triangleNormal(mesh: Mesh, tri: number): Vec3 {
  const n = mesh.normals;
  return vec3(n[tri * 3], n[tri * 3 + 1], n[tri * 3 + 2]);
}

export function triangleVertices(mesh: Mesh, tri: number): [Vec3, Vec3, Vec3] {
  const i = mesh.indices;
  return [vertexAt(mesh, i[tri * 3]), vertexAt(mesh, i[tri * 3 + 1]), vertexAt(mesh, i[tri * 3 + 2])];
}

function distanceToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = v3sub(b, a);
  const lenSq = v3dot(ab, ab);
  const t = lenSq === 0 ? 0 : Math.min(1, Math.max(0, v3dot(v3sub(p, a), ab) / lenSq));
  return v3length(v3sub(p, v3add(a, v3scale(ab, t))));
}

/** The edge (start, end) of triangle `tri` nearest to `point`; edges run corner 0→1, 1→2, 2→0. */
export function nearestTriangleEdge(mesh: Mesh, tri: number, point: Vec3): [Vec3, Vec3] {
  const v = triangleVertices(mesh, tri);
  let best: [Vec3, Vec3] = [v[0], v[1]];
  let bestDist = Infinity;
  for (let e = 0; e < 3; e++) {
    const a = v[e], b = v[(e + 1) % 3];
    const d = distanceToSegment(point, a, b);
    if (d < bestDist) {
      bestDist = d;
      best = [a, b];
    }
  }
  return best;
}
