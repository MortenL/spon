import { faceRegion } from '../../geometry/faces';
import { triangleCount, triangleNormal } from '../../geometry/mesh';
import { pointInPolys } from '../../geometry/offset/clipper';
import { flattenPath, orientPath, pathStart, reversePath } from '../../geometry/offset/pathOps';
import { quatRotate } from '../../geometry/quat';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import { type CamContext, drawingPathToProgram } from '../context';
import type { CamCode, CamDiagnostic, MeshFaceRef, Operation, SlotEnd } from '../types';
import { chainPaths, nestLoops, type Shape } from './chain';
import { circleOf, drawingPath } from './dxf';
import { type FaceGeometry, faceGeometry, holeBottom, resolveFaceRef } from './mesh';
import { closedSlotOf, openSlotOf, resolvedSlotOf } from './slots';

/** `members` (open chains only): the geometry indices of every reference that makes up the chain; `ref` is its seed. */
export interface ResolvedContour {
  path: Path2D; z: number; ref: number; members?: number[];
  /** Mesh faces: the outline (`outer`) or an inner loop; drawing contours count as `outer`. */
  kind?: 'outer' | 'inner';
}
export interface ResolvedShape { shape: Shape; z: number; ref: number }
export interface ResolvedHole { center: Vec2; diameter: number; top: number; bottom: number; through: boolean; ref: number }
export interface ResolvedSlot {
  centreline: Path2D; width: number; startEnd: SlotEnd; endEnd: SlotEnd; top: number; bottom: number | null; through: boolean; ref: number;
  /** Drawn open chains only: the geometry indices of every reference that makes up the chain; `ref` is its seed. */
  members?: number[];
}
export interface ResolvedGeometry {
  contours: ResolvedContour[];
  shapes: ResolvedShape[];
  holes: ResolvedHole[];
  slots: ResolvedSlot[];
  diagnostics: CamDiagnostic[];
  /** Largest chord sagitta (mm) of the arcs fitted to the mesh loops this operation uses; 0 without any. */
  sagitta: number;
  /** Z of any face reference (for the "face" height reference), or null if it does not resolve. */
  faceZ(ref: MeshFaceRef): number | null;
}

const COS_1DEG = Math.cos(Math.PI / 180);

/** The outer loops (program coordinates) of every up-facing face of the loaded mesh, with their heights. */
function upFaceOutlines(ctx: CamContext): { z: number; outer: Path2D }[] {
  const out: { z: number; outer: Path2D }[] = [];
  const g = ctx.geometry;
  if (!g || g.kind !== 'mesh' || !ctx.placement) return out;
  const visited = new Uint8Array(triangleCount(g.mesh));
  for (let t = 0; t < visited.length; t++) {
    if (visited[t] || quatRotate(ctx.placement.rotation, triangleNormal(g.mesh, t)).z < COS_1DEG) continue;
    const tris = faceRegion(g.mesh, g.adjacency, t);
    for (const r of tris) visited[r] = 1;
    const f = faceGeometry(ctx, tris);
    if (f.loops.length) out.push({ z: f.z, outer: f.loops[0] });
  }
  return out;
}

export function resolveGeometry(op: Operation, ctx: CamContext): ResolvedGeometry {
  const out: ResolvedGeometry = {
    contours: [], shapes: [], holes: [], slots: [], diagnostics: [], sagitta: 0,
    faceZ: (ref) => {
      const r = resolveFaceRef(ctx, ref);
      return r.ok ? r.face.z : null;
    },
  };
  const fail = (ref: number, code: CamCode, message: string, severity: 'error' | 'warning' = 'error') =>
    out.diagnostics.push({ operationId: op.id, severity, code, message, ref });
  let faceOutlines: ReturnType<typeof upFaceOutlines> | undefined;
  const faceCache = new Map<string, ReturnType<typeof resolveFaceRef>>();
  const face = (ref: MeshFaceRef) => {
    const key = `${ref.blobId}:${ref.seed}`;
    if (!faceCache.has(key)) faceCache.set(key, resolveFaceRef(ctx, ref));
    return faceCache.get(key)!;
  };
  /** Notes the fitted-arc sagitta of the loops of `f` that the operation uses. */
  const usesLoops = (f: FaceGeometry, loops: Iterable<number>) => {
    for (const k of loops) out.sagitta = Math.max(out.sagitta, f.sagittas[k] ?? 0);
  };
  const holeFromLoop = (f: FaceGeometry, loop: number, ref: number): boolean => {
    const c = loop > 0 ? f.circles[loop] ?? null : null;
    if (!c) return false;
    // the hole is cut as the circle through the facet corners, so its facets may sit this far inside the cut
    out.sagitta = Math.max(out.sagitta, f.circleSagittas[loop] ?? 0);
    const hb = holeBottom(ctx, c.center, c.diameter / 2, f.z);
    out.holes.push({ center: c.center, diameter: c.diameter, top: f.z, bottom: hb.bottom, through: hb.through, ref });
    return true;
  };

  // DXF references of one operation are chained together
  const dxf: { path: Path2D; ref: number }[] = [];
  const drawingZ = -ctx.origin.z; // a drawing lies at scene Z = 0
  op.geometry.forEach((g, i) => {
    if (g.kind === 'dxfPath') {
      const model = ctx.job.model;
      const geo = ctx.geometry;
      const raw = geo && geo.kind === 'drawing' && model && model.blobId === g.blobId && ctx.placement ? drawingPath(geo.drawing, g.layer, g.path) : null;
      if (!raw) return fail(i, 'ref-missing', 'The picked drawing path no longer exists');
      dxf.push({ path: drawingPathToProgram(ctx, raw), ref: i });
      return;
    }
    const faceRef = g.kind === 'meshFace' ? g : g.face;
    const r = face(faceRef);
    if (!r.ok) return fail(i, r.code, r.message);
    const f = r.face;
    if (g.kind === 'meshSlot' && op.type === 'engrave') return fail(i, 'wrong-geometry', 'Engraving needs lines or outlines');
    if ((g.kind === 'meshSlot' || g.kind === 'meshHole') && op.type === 'vcarve') return fail(i, 'wrong-geometry', 'V-carve needs outlines');
    if (g.kind === 'meshSlot' || op.type === 'slot') {
      if (g.kind !== 'meshSlot') return fail(i, 'wrong-geometry', 'Slots need a centreline or a recognised slot');
      if (op.type !== 'slot') return fail(i, 'wrong-geometry', 'A recognised slot can only be cut by a Slot operation');
      const rec = g.loop === undefined ? openSlotOf(ctx, f, g.face) : closedSlotOf(ctx, f, g.face, g.loop);
      if (!rec) return fail(i, 'ref-changed', 'The picked slot is no longer a slot');
      usesLoops(f, [g.loop ?? 0]);
      out.slots.push(resolvedSlotOf(rec, i));
      return;
    }
    if (g.kind === 'meshFace') {
      if (op.type !== 'drill' && op.type !== 'pocket' && op.type !== 'engrave' && op.type !== 'vcarve') usesLoops(f, [0]);
      if (op.type === 'pocket' || op.type === 'engrave' || op.type === 'vcarve') usesLoops(f, f.loops.keys());
      if (op.type === 'vcarve') {
        // spec §2.2: each recess of the face is a shape; faces at the same height inside it are islands left standing
        if (f.loops.length < 2) return fail(i, 'no-geometry', 'This face has no recessed outlines to V-carve', 'warning');
        faceOutlines ??= upFaceOutlines(ctx);
        for (let k = 1; k < f.loops.length; k++) {
          const outer = orientPath(f.loops[k], true);
          const flat = flattenPath(outer, Math.max(ctx.tolerance, 0.01));
          const islands = faceOutlines
            .filter((o) => Math.abs(o.z - f.z) <= 1e-6 && pointInPolys(pathStart(o.outer), [flat]))
            .map((o) => orientPath(o.outer, false));
          out.shapes.push({ shape: { outer, islands }, z: f.z, ref: i });
        }
        return;
      }
      if (op.type === 'engrave') f.loops.forEach((path, k) => out.contours.push({ path, z: f.z, ref: i, kind: k === 0 ? 'outer' : 'inner' }));
      else if (op.type === 'profile') out.contours.push({ path: f.loops[0], z: f.z, ref: i });
      else if (op.type === 'chamfer') out.contours.push({ path: f.loops[0], z: f.z, ref: i, kind: 'outer' });
      else if (op.type === 'face') out.shapes.push({ shape: { outer: f.loops[0], islands: [] }, z: f.z, ref: i });
      else if (op.type === 'pocket') out.shapes.push({ shape: { outer: f.loops[0], islands: f.loops.slice(1) }, z: f.z, ref: i });
      else for (let k = 1; k < f.loops.length; k++) holeFromLoop(f, k, i);
      return;
    }
    const path = f.loops[g.loop];
    if (!path) return fail(i, 'ref-missing', 'The picked edge loop no longer exists');
    if (op.type === 'engrave' && g.kind === 'meshHole') return fail(i, 'wrong-geometry', 'Engraving needs lines or outlines');
    if (g.kind === 'meshHole' && op.type === 'face') return fail(i, 'open-contour', 'Facing needs closed areas');
    if (g.kind === 'meshHole' || op.type === 'drill') {
      if (!holeFromLoop(f, g.loop, i)) fail(i, 'ref-changed', 'The picked loop is not a round hole');
      return;
    }
    usesLoops(f, [g.loop]);
    if (op.type === 'profile' || op.type === 'engrave') out.contours.push({ path, z: f.z, ref: i });
    else if (op.type === 'chamfer') out.contours.push({ path, z: f.z, ref: i, kind: g.loop === 0 ? 'outer' : 'inner' });
    else out.shapes.push({ shape: { outer: orientPath(path, true), islands: [] }, z: f.z, ref: i });
  });

  if (dxf.length) {
    const firstRef = dxf[0].ref;
    if (op.type === 'drill') {
      for (const d of dxf) {
        const c = circleOf(d.path);
        if (!c) fail(d.ref, 'no-geometry', 'Only circles can be drilled; this path is skipped', 'warning');
        else out.holes.push({ center: c.center, diameter: c.diameter, top: drawingZ, bottom: ctx.stock?.min.z ?? drawingZ, through: true, ref: d.ref });
      }
    } else {
      const { closed, open, openSeeds, openMembers } = chainPaths(dxf.map((d) => d.path), ctx.tolerance);
      if (op.type === 'slot') {
        // a drawn centreline: round ends centred on its end points (spec §2.1); closed chains are ring grooves
        const slot = (centreline: Path2D, ref: number, members?: number[]): ResolvedSlot =>
          ({ centreline, width: op.width, startEnd: 'round', endEnd: 'round', top: drawingZ, bottom: null, through: false, ref, ...(members ? { members } : {}) });
        for (const path of closed) out.slots.push(slot(path, firstRef));
        open.forEach((path, k) => {
          const reversed = openMembers[k].some((m) => {
            const g = op.geometry[dxf[m].ref];
            return g.kind === 'dxfPath' && g.reverse === true;
          });
          out.slots.push(slot(reversed ? reversePath(path) : path, dxf[openSeeds[k]].ref, openMembers[k].map((m) => dxf[m].ref)));
        });
      } else if (op.type === 'profile' || op.type === 'chamfer' || op.type === 'engrave') {
        const chamfer = op.type === 'chamfer';
        for (const path of closed) {
          const c = chamfer ? circleOf(path) : null;
          // a chamfered drawing circle is a countersink
          if (c) out.holes.push({ center: c.center, diameter: c.diameter, top: drawingZ, bottom: ctx.stock?.min.z ?? drawingZ, through: true, ref: firstRef });
          else out.contours.push({ path, z: drawingZ, ref: firstRef, ...(chamfer ? { kind: 'outer' as const } : {}) });
        }
        open.forEach((path, k) => {
          const seed = dxf[openSeeds[k]].ref;
          // the chain runs in its seed's drawn direction; a reverse flag on any of its references flips the whole chain
          const reversed = openMembers[k].some((m) => {
            const g = op.geometry[dxf[m].ref];
            return g.kind === 'dxfPath' && g.reverse === true;
          });
          out.contours.push({ path: reversed ? reversePath(path) : path, z: drawingZ, ref: seed, members: openMembers[k].map((m) => dxf[m].ref) });
        });
      } else {
        for (const shape of nestLoops(closed, ctx.tolerance)) out.shapes.push({ shape, z: drawingZ, ref: firstRef });
        if (open.length) fail(firstRef, 'open-contour', op.type === 'face' ? 'Facing needs closed areas' : op.type === 'vcarve' ? 'V-carve needs closed outlines' : 'Pockets need closed contours; open chains are skipped');
      }
    }
  }
  return out;
}
