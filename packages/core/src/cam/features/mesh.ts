import type { Adjacency } from '../../geometry/adjacency';
import { type Mesh, triangleCount, triangleNormal, triangleVertices, vertexAt } from '../../geometry/mesh';
import { type ArcFitStats, fitArcs } from '../../geometry/offset/arcFit';
import { orientPath, polyArea, v2 } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import { faceRegion } from '../../geometry/faces';
import { quatRotate } from '../../geometry/quat';
import { v3dot, vec3 } from '../../geometry/vec3';
import { type CamContext, toProgram } from '../context';
import type { CamCode, MeshFaceRef } from '../types';

const COS_1DEG = Math.cos(Math.PI / 180);

export function faceRefFromTriangle(mesh: Mesh, blobId: string, tri: number): MeshFaceRef {
  const [a, b, c] = triangleVertices(mesh, tri);
  return { kind: 'meshFace', blobId, seed: tri, normal: triangleNormal(mesh, tri), point: vec3((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3) };
}

/** Boundary loops of a triangle set as vertex-index cycles; the region is on the left of travel (seen from its normal). */
export function boundaryLoops(mesh: Mesh, adjacency: Adjacency, tris: readonly number[]): number[][] {
  const inRegion = new Set(tris);
  const next = new Map<number, number[]>();
  for (const t of tris) {
    for (let e = 0; e < 3; e++) {
      const nb = adjacency.neighbors[t * 3 + e];
      if (nb >= 0 && inRegion.has(nb)) continue;
      const a = mesh.indices[t * 3 + e];
      const b = mesh.indices[t * 3 + ((e + 1) % 3)];
      const list = next.get(a);
      if (list) list.push(b);
      else next.set(a, [b]);
    }
  }
  const loops: number[][] = [];
  while (next.size) {
    const start = Math.min(...next.keys());
    const loop = [start];
    let v = start;
    for (let guard = 0; guard < 1_000_000; guard++) {
      const list = next.get(v);
      if (!list) break;
      const b = list.pop()!;
      if (!list.length) next.delete(v);
      if (b === start) break;
      loop.push(b);
      v = b;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export interface FaceGeometry {
  tris: number[];
  /** Height of the face in program coordinates. */
  z: number;
  /** Loop 0 = outer (counter-clockwise); the others are holes (clockwise); program coordinates. */
  loops: Path2D[];
  /** Per loop: the largest gap between a mesh chord and the arc fitted over it (mm); 0 for a loop without fitted arcs. */
  sagittas: number[];
}

export function faceGeometry(ctx: CamContext, tris: number[]): FaceGeometry {
  const g = ctx.geometry;
  if (!g || g.kind !== 'mesh') throw new Error('No mesh loaded');
  const loops3 = boundaryLoops(g.mesh, g.adjacency, tris).map((loop) => loop.map((vi) => toProgram(ctx, vertexAt(g.mesh, vi))));
  let zSum = 0, n = 0;
  for (const loop of loops3) for (const p of loop) { zSum += p.z; n++; }
  const polys: Vec2[][] = loops3.map((loop) => loop.map((p) => v2(p.x, p.y)));
  const order = polys.map((p, i) => ({ i, area: Math.abs(polyArea(p)) })).sort((a, b) => b.area - a.area).map((o) => o.i);
  const sagittas: number[] = [];
  const loops = order.map((i, k) => {
    const stats: ArcFitStats = { sagitta: 0 };
    const path = orientPath(fitArcs(polys[i], true, ctx.tolerance, Infinity, stats), k === 0);
    sagittas.push(stats.sagitta);
    return path;
  });
  return { tris, z: n ? zSum / n : 0, loops, sagittas };
}

/** Checks a face reference against the loaded mesh and the current orientation, then builds its geometry. */
export function resolveFaceRef(ctx: CamContext, ref: MeshFaceRef): { ok: true; face: FaceGeometry } | { ok: false; code: CamCode; message: string } {
  const g = ctx.geometry;
  if (!g || g.kind !== 'mesh' || !ctx.job.model || ctx.job.model.blobId !== ref.blobId || !ctx.placement) {
    return { ok: false, code: 'ref-missing', message: 'The model this face belongs to is not loaded' };
  }
  if (!Number.isInteger(ref.seed) || ref.seed < 0 || ref.seed >= triangleCount(g.mesh)) {
    return { ok: false, code: 'ref-missing', message: 'The picked face no longer exists in the model' };
  }
  if (v3dot(triangleNormal(g.mesh, ref.seed), ref.normal) < COS_1DEG) {
    return { ok: false, code: 'ref-changed', message: 'The picked face has changed; pick it again' };
  }
  if (quatRotate(ctx.placement.rotation, ref.normal).z < COS_1DEG) {
    return { ok: false, code: 'face-not-horizontal', message: 'The face is not horizontal and facing up in the current orientation' };
  }
  return { ok: true, face: faceGeometry(ctx, faceRegion(g.mesh, g.adjacency, ref.seed)) };
}

const upFacing = new WeakMap<CamContext, { x: number; y: number; z: number }[]>();

/** Centroids (program coordinates) of all triangles facing up within 1°. */
function upFacingCentroids(ctx: CamContext): { x: number; y: number; z: number }[] {
  const cached = upFacing.get(ctx);
  if (cached) return cached;
  const out: { x: number; y: number; z: number }[] = [];
  const g = ctx.geometry;
  if (g && g.kind === 'mesh' && ctx.placement) {
    for (let t = 0; t < triangleCount(g.mesh); t++) {
      if (quatRotate(ctx.placement.rotation, triangleNormal(g.mesh, t)).z < COS_1DEG) continue;
      const [a, b, c] = triangleVertices(g.mesh, t);
      out.push(toProgram(ctx, vec3((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3)));
    }
  }
  upFacing.set(ctx, out);
  return out;
}

/** Bottom of a round hole: the highest up-facing face below its top inside its radius; otherwise a through hole to the model bottom. */
export function holeBottom(ctx: CamContext, center: Vec2, radius: number, top: number): { bottom: number; through: boolean } {
  let best = -Infinity;
  for (const c of upFacingCentroids(ctx)) {
    if (c.z < top - 1e-6 && Math.hypot(c.x - center.x, c.y - center.y) < radius * 0.999 && c.z > best) best = c.z;
  }
  return best > -Infinity ? { bottom: best, through: false } : { bottom: ctx.model?.min.z ?? top, through: true };
}
