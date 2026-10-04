import { flattenPath, pathEnd, pathLength, pathStart, polyArea } from '../../geometry/offset/pathOps';
import type { Vec2 } from '../../geometry/path2d';
import { triangleCount, triangleNormal } from '../../geometry/mesh';
import { faceRegion } from '../../geometry/faces';
import { quatRotate } from '../../geometry/quat';
import type { Job } from '../../job/types';
import { camContext, type CamContext, type CamGeometry, drawingPathToProgram } from '../context';
import { THREAD_DEFAULT_LENGTH } from '../defaults';
import type { DxfPathRef, GeometryRef, MeshBossRef, Operation, MeshFaceRef, MeshHoleRef } from '../types';
import { circleOf } from './dxf';
import { catalogSlot, type CatalogSlot, faceSlots } from './slots';
import { faceGeometry, faceRefFromTriangle, holeBottom, upFacingCentroids, wallsDrop } from './mesh';

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
export interface CatalogBoss { ref: MeshBossRef | DxfPathRef; center: Vec2; diameter: number; top: number; /** How far the boss stands above its base (a free-standing one, or a drawn circle: down to the model or stock bottom). */ height?: number }
export interface GeometryCatalog { faces: CatalogFace[]; contours: CatalogContour[]; holes: CatalogHole[]; slots: CatalogSlot[]; bosses: CatalogBoss[] }

/** Z of the highest up-facing face just outside a boss (within 5 mm of its wall) and below its top; otherwise the model bottom. */
function bossBase(ctx: CamContext, center: Vec2, radius: number, top: number): number {
  let best = -Infinity;
  for (const c of upFacingCentroids(ctx)) {
    const d = Math.hypot(c.x - center.x, c.y - center.y);
    if (c.z < top - 1e-6 && d > radius * 1.001 && d < radius + 5 && c.z > best) best = c.z;
  }
  return best > -Infinity ? best : (ctx.model?.min.z ?? top);
}

/** The thread length a fresh Thread operation should start with for these picks: the first hole's depth or boss's height (null when none is known). */
export function defaultThreadLength(catalog: GeometryCatalog, refs: readonly GeometryRef[]): number | null {
  const same = (a: GeometryRef, b: GeometryRef) => {
    if (a.kind === 'dxfPath' && b.kind === 'dxfPath') return a.blobId === b.blobId && a.layer === b.layer && a.path === b.path;
    if (a.kind === 'meshBoss' && b.kind === 'meshBoss') return a.face.blobId === b.face.blobId && a.face.seed === b.face.seed;
    if (a.kind === 'meshHole' && b.kind === 'meshHole') return a.face.blobId === b.face.blobId && a.face.seed === b.face.seed && a.loop === b.loop;
    return false;
  };
  for (const ref of refs) {
    const hole = catalog.holes.find((h) => same(h.ref, ref));
    const boss = catalog.bosses.find((b) => same(b.ref, ref));
    const length = hole ? hole.top - hole.bottom : boss?.height;
    if (length !== undefined && length > 0) return Math.round(length * 1000) / 1000;
  }
  return null;
}

/** The extra patch for a Thread operation whose first geometry is being set while its length is still the default: the length of the picked feature. */
export function firstPickLength(op: Operation, catalog: GeometryCatalog, refs: readonly GeometryRef[]): { length: number } | Record<string, never> {
  if (op.type !== 'thread' || op.geometry.length > 0 || op.length !== THREAD_DEFAULT_LENGTH) return {};
  const length = defaultThreadLength(catalog, refs);
  return length === null ? {} : { length };
}

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
      if (outer && wallsDrop(ctx, f, outer)) out.bosses.push({ ref: { kind: 'meshBoss', face: ref }, center: outer.center, diameter: outer.diameter, top: f.z, height: f.z - bossBase(ctx, outer.center, outer.diameter / 2, f.z) });
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
          out.bosses.push({ ref, center: circle.center, diameter: circle.diameter, top: z, height: z - (ctx.stock?.min.z ?? z) });
        }
      });
    });
  }
  return out;
}
