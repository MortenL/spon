import { flattenPath, pathEnd, pathLength, pathStart, polyArea } from '../../geometry/offset/pathOps';
import type { Vec2 } from '../../geometry/path2d';
import { triangleCount, triangleNormal } from '../../geometry/mesh';
import { faceRegion } from '../../geometry/faces';
import { quatRotate } from '../../geometry/quat';
import type { Job } from '../../job/types';
import { camContext, type CamGeometry, drawingPathToProgram } from '../context';
import type { DxfPathRef, MeshBossRef, MeshFaceRef, MeshHoleRef } from '../types';
import { circleOf } from './dxf';
import { catalogSlot, type CatalogSlot, faceSlots } from './slots';
import { faceGeometry, faceRefFromTriangle, holeBottom, wallsDrop } from './mesh';

export interface CatalogFace {
  ref: MeshFaceRef;
  z: number;
  area: number;
  loops: { index: number; kind: 'outer' | 'hole'; length: number; circle: { center: Vec2; diameter: number } | null }[];
}
export interface CatalogContour {
  ref: DxfPathRef;
  layer: string;
  closed: boolean;
  length: number;
  /** Where the drawn path starts and ends (program coordinates); the direction an open line is cut in. */
  start: Vec2;
  end: Vec2;
  bbox: { min: Vec2; max: Vec2 };
  circle: { center: Vec2; diameter: number } | null;
}
export interface CatalogHole { ref: MeshHoleRef | DxfPathRef; center: Vec2; diameter: number; top: number; bottom: number; through: boolean }
/** A round boss: an up-facing face with a round outer loop that stands above the faces around it. */
export interface CatalogBoss { ref: MeshBossRef | DxfPathRef; center: Vec2; diameter: number; top: number }
export interface GeometryCatalog { faces: CatalogFace[]; contours: CatalogContour[]; holes: CatalogHole[]; slots: CatalogSlot[]; bosses: CatalogBoss[] }

const COS_1DEG = Math.cos(Math.PI / 180);

/** Everything pickable, described in program coordinates (spec §8a). */
export function describeGeometry(job: Job, geometry: CamGeometry): GeometryCatalog {
  const ctx = camContext(job, geometry);
  const out: GeometryCatalog = { faces: [], contours: [], holes: [], slots: [], bosses: [] };
  const model = job.model;
  if (!model || !ctx.placement) return out;
  if (geometry.kind === 'mesh') {
    const visited = new Uint8Array(triangleCount(geometry.mesh));
    for (let t = 0; t < visited.length; t++) {
      if (visited[t] || quatRotate(ctx.placement.rotation, triangleNormal(geometry.mesh, t)).z < COS_1DEG) continue;
      const tris = faceRegion(geometry.mesh, geometry.adjacency, t);
      for (const r of tris) visited[r] = 1;
      const f = faceGeometry(ctx, tris);
      const ref = faceRefFromTriangle(geometry.mesh, model.blobId, t);
      const loops = f.loops.map((l, index) => ({ index, kind: index === 0 ? 'outer' as const : 'hole' as const, length: pathLength(l), circle: index > 0 ? f.circles[index] : null }));
      out.faces.push({ ref, z: f.z, area: f.loops.reduce((a, l) => a + polyArea(flattenPath(l, 0.01)), 0), loops });
      for (const l of loops) {
        // the base ring of a boss is a round inner loop too, but its walls rise: not a hole
        if (!l.circle || !wallsDrop(ctx, f, l.circle)) continue;
        const hb = holeBottom(ctx, l.circle.center, l.circle.diameter / 2, f.z);
        out.holes.push({ ref: { kind: 'meshHole', face: ref, loop: l.index }, center: l.circle.center, diameter: l.circle.diameter, top: f.z, ...hb });
      }
      const outer = f.circles[0];
      if (outer && wallsDrop(ctx, f, outer)) out.bosses.push({ ref: { kind: 'meshBoss', face: ref }, center: outer.center, diameter: outer.diameter, top: f.z });
      out.slots.push(...faceSlots(ctx, f, ref).map(catalogSlot));
    }
    out.faces.sort((a, b) => b.z - a.z);
  } else {
    const z = -ctx.origin.z;
    geometry.drawing.layers.forEach((layer, li) => {
      layer.paths.forEach((raw, pi) => {
        const path = drawingPathToProgram(ctx, raw);
        const pts = flattenPath(path, 0.01);
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        const ref: DxfPathRef = { kind: 'dxfPath', blobId: model.blobId, layer: li, path: pi };
        const circle = circleOf(path);
        out.contours.push({
          ref, layer: layer.name, closed: path.closed, length: pathLength(path), start: pathStart(path), end: pathEnd(path), circle,
          bbox: { min: { x: Math.min(...xs), y: Math.min(...ys) }, max: { x: Math.max(...xs), y: Math.max(...ys) } },
        });
        if (circle) {
          out.holes.push({ ref, center: circle.center, diameter: circle.diameter, top: z, bottom: ctx.stock?.min.z ?? z, through: true });
          out.bosses.push({ ref, center: circle.center, diameter: circle.diameter, top: z });
        }
      });
    });
  }
  return out;
}
