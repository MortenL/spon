import { pointInPolys } from '../../geometry/offset/clipper';
import { faceRegion } from '../../geometry/faces';
import { triangleCount, triangleNormal } from '../../geometry/mesh';
import { flattenPath, pathEnd, pathLength, pathStart, pointAt, polyArea, segmentLength } from '../../geometry/offset/pathOps';
import type { Path2D, Segment, Vec2 } from '../../geometry/path2d';
import { quatRotate } from '../../geometry/quat';
import type { CamContext } from '../context';
import { dropCutter } from '../gouge/dropCutter';
import { meshIndex } from '../gouge/meshIndex';
import type { ToolShape } from '../gouge/toolShape';
import type { MeshFaceRef, MeshSlotRef, SlotEnd } from '../types';
import type { ResolvedSlot } from './resolve';
import { type FaceGeometry, faceGeometry, faceRefFromTriangle, upFacingCentroids } from './mesh';

/** An end of an open path: its point, the unit tangent pointing out of the path there, and that tangent turned +90°. */
export function endFrame(path: Path2D, which: 'start' | 'end'): { p: Vec2; t: Vec2; n: Vec2 } {
  const a = pointAt(path, which === 'start' ? 0 : pathLength(path));
  const t = which === 'start' ? { x: -a.tangent.x || 0, y: -a.tangent.y || 0 } : a.tangent;
  return { p: a.point, t, n: { x: -t.y || 0, y: t.x } };
}

/** How far (mm) a loop may stray from the slot shape fitted to it; coarse round holes are held to the same. */
const MAX_DEV = 0.1;
/** The fitted shape's area must match the loop's within this fraction. */
const AREA_TOL = 0.02;
const MIN_WIDTH = 0.5;
/** Spacing (mm) of the extra points tested along each edge of a loop. */
const EDGE_STEP = 1;
const minOf = (a: number[]) => a.reduce((m, x) => (x < m ? x : m), Infinity);
const maxOf = (a: number[]) => a.reduce((m, x) => (x > m ? x : m), -Infinity);

/** The closed loop's points with each edge subdivided (at least its midpoint, then every EDGE_STEP mm), so edges are tested too. */
function densify(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / EDGE_STEP));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}
type Kind = 'round' | 'square';
const END_COMBOS: readonly [Kind, Kind][] = [['round', 'round'], ['round', 'square'], ['square', 'round'], ['square', 'square']];

export interface SlotShape { kind: 'line' | 'arc'; centreline: Path2D; width: number; ends: [SlotEnd, SlotEnd] }

/**
 * The straight or arc slot a closed loop outlines (spec §4.1), or null. The loop's longest segments propose an axis
 * (a line) or a centre (an arc); the slot fitted to that must hold every flattened point within MAX_DEV and match the
 * loop's area within AREA_TOL. Square-ended slots must be at least twice as long as wide; a circle is never a slot.
 */
export function slotShapeOf(loop: Path2D, tol: number): SlotShape | null {
  const pts = flattenPath(loop, Math.max(tol, 0.01));
  if (pts.length < 4) return null;
  const area = Math.abs(polyArea(pts));
  const dev = Math.max(MAX_DEV, tol);
  const candidates = [...loop.segments].sort((a, b) => segmentLength(b) - segmentLength(a)).slice(0, 4);
  for (const s of candidates) {
    const shape = s.kind === 'line' ? straightSlot(pts, area, s, dev) : arcSlot(pts, area, s.center, dev);
    if (shape) return shape;
  }
  return null;
}

/** Distance from a point `out` mm beyond an end centre (negative = inside) and `y` mm off the axis, to a round or square end. */
function endDist(out: number, y: number, kind: Kind, h: number): number {
  if (kind === 'round') return out >= -1e-9 ? Math.abs(Math.hypot(out, y) - h) : Infinity;
  return Math.abs(y) <= h + 1e-9 ? Math.abs(out) : Infinity;
}

function straightSlot(pts: Vec2[], area: number, axis: Extract<Segment, { kind: 'line' }>, dev: number): SlotShape | null {
  const len = Math.hypot(axis.to.x - axis.from.x, axis.to.y - axis.from.y);
  if (len < 1e-9) return null;
  const t = { x: (axis.to.x - axis.from.x) / len, y: (axis.to.y - axis.from.y) / len };
  const n = { x: -t.y, y: t.x };
  const u = pts.map((p) => p.x * t.x + p.y * t.y);
  const v = pts.map((p) => p.x * n.x + p.y * n.y);
  const umin = minOf(u), umax = maxOf(u), vmin = minOf(v), vmax = maxOf(v);
  const dense = densify(pts);
  const du = dense.map((p) => p.x * t.x + p.y * t.y);
  const dv = dense.map((p) => p.x * n.x + p.y * n.y);
  const w = vmax - vmin, h = w / 2, vc = (vmin + vmax) / 2;
  if (w < MIN_WIDTH) return null;
  for (const [ks, ke] of END_COMBOS) {
    const ta = umin + (ks === 'round' ? h : 0), tb = umax - (ke === 'round' ? h : 0);
    if (tb - ta < (ks === 'round' && ke === 'round' ? 1e-3 : -1e-9)) continue;
    if ((ks === 'square' || ke === 'square') && umax - umin < 2 * w) continue;
    const expect = (tb - ta) * w + (ks === 'round' ? (Math.PI * h * h) / 2 : 0) + (ke === 'round' ? (Math.PI * h * h) / 2 : 0);
    if (Math.abs(expect - area) > AREA_TOL * expect) continue;
    const ok = dense.every((_, i) => {
      const y = dv[i] - vc;
      const side = du[i] >= ta - 1e-9 && du[i] <= tb + 1e-9 ? Math.abs(Math.abs(y) - h) : Infinity;
      return Math.min(side, endDist(ta - du[i], y, ks, h), endDist(du[i] - tb, y, ke, h)) <= dev;
    });
    if (!ok) continue;
    const at = (uu: number): Vec2 => ({ x: t.x * uu + n.x * vc, y: t.y * uu + n.y * vc });
    return { kind: 'line', width: w, ends: [ks, ke], centreline: { closed: false, segments: [{ kind: 'line', from: at(ta), to: at(tb) }] } };
  }
  return null;
}

function arcSlot(pts: Vec2[], area: number, c: Vec2, dev: number): SlotShape | null {
  const rho = pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
  const inner = minOf(rho), outer = maxOf(rho);
  const w = outer - inner, h = w / 2, rc = (inner + outer) / 2;
  if (w < MIN_WIDTH || inner < 1e-3) return null;
  const ang = pts.map((p) => Math.atan2(p.y - c.y, p.x - c.x)).sort((a, b) => a - b);
  // the slot covers everything but the largest empty gap between the points' angles
  let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1], from = ang[0];
  for (let i = 1; i < ang.length; i++) if (ang[i] - ang[i - 1] > gap) { gap = ang[i] - ang[i - 1]; from = ang[i]; }
  if (gap < 1e-3) return null;
  const span = 2 * Math.PI - gap;
  const dense = densify(pts);
  const cap = Math.asin(Math.min(1, h / rc)); // a round end's cap reaches this far (as seen from c) past its centre
  for (const [ks, ke] of END_COMBOS) {
    const pa = from + (ks === 'round' ? cap : 0), pb = from + span - (ke === 'round' ? cap : 0);
    const sweep = pb - pa;
    if (sweep * rc < (ks === 'round' && ke === 'round' ? 1e-3 : -1e-9)) continue;
    if ((ks === 'square' || ke === 'square') && sweep * rc < 2 * w) continue;
    const expect = sweep * rc * w + (ks === 'round' ? (Math.PI * h * h) / 2 : 0) + (ke === 'round' ? (Math.PI * h * h) / 2 : 0);
    if (Math.abs(expect - area) > AREA_TOL * expect) continue;
    const P = (a: number): Vec2 => ({ x: c.x + rc * Math.cos(a), y: c.y + rc * Math.sin(a) });
    const ok = dense.every((p) => {
      const rhoP = Math.hypot(p.x - c.x, p.y - c.y);
      // the point angle from pa, in (-(2π - sweep)/2, sweep + (2π - sweep)/2]: negative before the start, > sweep past the end
      let phi = Math.atan2(p.y - c.y, p.x - c.x) - pa;
      phi = ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (phi > sweep + (2 * Math.PI - sweep) / 2) phi -= 2 * Math.PI;
      const side = phi >= -1e-9 && phi <= sweep + 1e-9 ? Math.min(Math.abs(rhoP - inner), Math.abs(rhoP - outer)) : Infinity;
      const endAt = (a: number, kind: Kind, before: boolean) => {
        const q = P(a);
        const tx = -Math.sin(a) * (before ? -1 : 1), ty = Math.cos(a) * (before ? -1 : 1); // outward along the centreline
        const out = (p.x - q.x) * tx + (p.y - q.y) * ty;
        const y = (p.x - q.x) * -ty + (p.y - q.y) * tx;
        return endDist(out, y, kind, h);
      };
      return Math.min(side, endAt(pa, ks, true), endAt(pb, ke, false)) <= dev;
    });
    if (!ok) continue;
    return { kind: 'arc', width: w, ends: [ks, ke], centreline: { closed: false, segments: [{ kind: 'arc', center: c, radius: rc, startAngle: pa, sweep }] } };
  }
  return null;
}

export interface RecognisedSlot {
  ref: MeshSlotRef;
  shape: SlotShape;
  /** The shape ends, with ends that run out of the part marked open. */
  ends: [SlotEnd, SlotEnd];
  top: number;
  bottom: number;
  through: boolean;
  /** The slot opening (closed slots) or floor (open slots), program XY. */
  outline: Vec2[];
}

/** The floor under an opening (clarification 1): through, one flat floor, or null for anything else. */
function slotFloor(ctx: CamContext, outline: Vec2[], top: number): { bottom: number; through: boolean } | null {
  const zs = upFacingCentroids(ctx).filter((c) => c.z < top - 1e-6 && pointInPolys(c, [outline])).map((c) => c.z);
  if (!zs.length) return { bottom: ctx.stock?.min.z ?? ctx.model?.min.z ?? top, through: true };
  const hi = maxOf(zs);
  return hi - minOf(zs) <= 0.01 ? { bottom: hi, through: false } : null;
}

/** Inner loop `loop` of face `f` as a closed slot (spec §4.1), or null. */
export function closedSlotOf(ctx: CamContext, f: FaceGeometry, face: MeshFaceRef, loop: number): RecognisedSlot | null {
  if (loop < 1 || !f.loops[loop] || f.circles[loop]) return null;
  const shape = slotShapeOf(f.loops[loop], ctx.tolerance);
  if (!shape) return null;
  const outline = flattenPath(f.loops[loop], Math.max(ctx.tolerance, 0.01));
  const floor = slotFloor(ctx, outline, f.z);
  if (!floor) return null;
  return { ref: { kind: 'meshSlot', face, loop }, shape, ends: shape.ends, top: f.z, ...floor, outline };
}

const COS_1DEG = Math.cos(Math.PI / 180);
const PROBE: ToolShape = { radius: 0.05, kind: 'torus', cornerRadius: 0, halfAngle: 0 };

/** The highest mesh Z under a 0.05 mm disc at a program XY (−Infinity where there is none); null without a mesh. */
export function surfaceProbe(ctx: CamContext): ((x: number, y: number) => number) | null {
  const index = meshIndex(ctx, 1);
  return index ? (x, y) => dropCutter(index, PROBE, x, y, ctx.tolerance) : null;
}

/** Face `f` as the floor of an open slot (spec §4.2): a strip with walls along both sides and at least one end without one. */
export function openSlotOf(ctx: CamContext, f: FaceGeometry, face: MeshFaceRef): RecognisedSlot | null {
  const shape = slotShapeOf(f.loops[0], ctx.tolerance);
  const probe = shape && surfaceProbe(ctx);
  if (!shape || !probe) return null;
  const h = shape.width / 2;
  const L = pathLength(shape.centreline);
  let top = -Infinity;
  for (const s of [0.25, 0.5, 0.75]) {
    const { point: p, tangent: t } = pointAt(shape.centreline, s * L);
    for (const side of [1, -1]) {
      const z = probe(p.x - t.y * side * (h + 0.5), p.y + t.x * side * (h + 0.5));
      if (!(z > f.z + 0.1)) return null; // no wall rising beside the floor here
      top = Math.max(top, z);
    }
  }
  const ends = shape.ends.map((kind, i) => {
    const { p, t } = endFrame(shape.centreline, i === 0 ? 'start' : 'end');
    const reach = (kind === 'round' ? h : 0) + 1;
    return probe(p.x + t.x * reach, p.y + t.y * reach) > f.z + 1e-3 ? kind : 'open';
  }) as [SlotEnd, SlotEnd];
  if (!ends.includes('open')) return null;
  return { ref: { kind: 'meshSlot', face }, shape, ends, top, bottom: f.z, through: false, outline: flattenPath(f.loops[0], Math.max(ctx.tolerance, 0.01)) };
}

const cache = new WeakMap<CamContext, RecognisedSlot[]>();

/** Every recognised slot of the placed mesh, face by face in the order describeGeometry visits them. */
export function meshSlots(ctx: CamContext): RecognisedSlot[] {
  const hit = cache.get(ctx);
  if (hit) return hit;
  const out: RecognisedSlot[] = [];
  const g = ctx.geometry, model = ctx.job.model;
  if (g && g.kind === 'mesh' && model && ctx.placement) {
    const visited = new Uint8Array(triangleCount(g.mesh));
    for (let t = 0; t < visited.length; t++) {
      if (visited[t] || quatRotate(ctx.placement.rotation, triangleNormal(g.mesh, t)).z < COS_1DEG) continue;
      const tris = faceRegion(g.mesh, g.adjacency, t);
      for (const r of tris) visited[r] = 1;
      out.push(...faceSlots(ctx, faceGeometry(ctx, tris), faceRefFromTriangle(g.mesh, model.blobId, t)));
    }
  }
  cache.set(ctx, out);
  return out;
}

/** The closed slots in a face's inner loops and the open slot it is the floor of. */
export function faceSlots(ctx: CamContext, f: FaceGeometry, face: MeshFaceRef): RecognisedSlot[] {
  const out: RecognisedSlot[] = [];
  for (let k = 1; k < f.loops.length; k++) {
    const s = closedSlotOf(ctx, f, face, k);
    if (s) out.push(s);
  }
  const open = openSlotOf(ctx, f, face);
  if (open) out.push(open);
  return out;
}

export interface CatalogSlot {
  ref: MeshSlotRef;
  kind: 'line' | 'arc';
  /** Centreline ends, program coordinates. */
  start: Vec2;
  end: Vec2;
  center?: Vec2;
  radius?: number;
  length: number;
  width: number;
  ends: [SlotEnd, SlotEnd];
  top: number;
  bottom: number;
  through: boolean;
}

export function catalogSlot(s: RecognisedSlot): CatalogSlot {
  const cl = s.shape.centreline;
  const seg = cl.segments[0];
  return {
    ref: s.ref, kind: s.shape.kind, start: pathStart(cl), end: pathEnd(cl), ...(seg.kind === 'arc' ? { center: seg.center, radius: seg.radius } : {}),
    length: pathLength(cl), width: s.shape.width, ends: s.ends, top: s.top, bottom: s.bottom, through: s.through,
  };
}

export const resolvedSlotOf = (s: RecognisedSlot, ref: number): ResolvedSlot => ({
  centreline: s.shape.centreline, width: s.shape.width, startEnd: s.ends[0], endEnd: s.ends[1], top: s.top, bottom: s.bottom, through: s.through, ref,
});
