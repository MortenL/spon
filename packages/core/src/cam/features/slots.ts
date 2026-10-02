import { pointInPolys } from '../../geometry/offset/clipper';
import { flattenPath, pathLength, pointAt, polyArea, segmentLength } from '../../geometry/offset/pathOps';
import type { Path2D, Segment, Vec2 } from '../../geometry/path2d';
import type { CamContext } from '../context';
import type { MeshFaceRef, MeshSlotRef, SlotEnd } from '../types';
import { type FaceGeometry, upFacingCentroids } from './mesh';

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
  const umin = Math.min(...u), umax = Math.max(...u), vmin = Math.min(...v), vmax = Math.max(...v);
  const w = vmax - vmin, h = w / 2, vc = (vmin + vmax) / 2;
  if (w < MIN_WIDTH) return null;
  for (const [ks, ke] of END_COMBOS) {
    const ta = umin + (ks === 'round' ? h : 0), tb = umax - (ke === 'round' ? h : 0);
    if (tb - ta < (ks === 'round' && ke === 'round' ? 1e-3 : -1e-9)) continue;
    if ((ks === 'square' || ke === 'square') && umax - umin < 2 * w) continue;
    const expect = (tb - ta) * w + (ks === 'round' ? (Math.PI * h * h) / 2 : 0) + (ke === 'round' ? (Math.PI * h * h) / 2 : 0);
    if (Math.abs(expect - area) > AREA_TOL * expect) continue;
    const ok = pts.every((_, i) => {
      const y = v[i] - vc;
      const side = u[i] >= ta - 1e-9 && u[i] <= tb + 1e-9 ? Math.abs(Math.abs(y) - h) : Infinity;
      return Math.min(side, endDist(ta - u[i], y, ks, h), endDist(u[i] - tb, y, ke, h)) <= dev;
    });
    if (!ok) continue;
    const at = (uu: number): Vec2 => ({ x: t.x * uu + n.x * vc, y: t.y * uu + n.y * vc });
    return { kind: 'line', width: w, ends: [ks, ke], centreline: { closed: false, segments: [{ kind: 'line', from: at(ta), to: at(tb) }] } };
  }
  return null;
}

function arcSlot(pts: Vec2[], area: number, c: Vec2, dev: number): SlotShape | null {
  const rho = pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
  const inner = Math.min(...rho), outer = Math.max(...rho);
  const w = outer - inner, h = w / 2, rc = (inner + outer) / 2;
  if (w < MIN_WIDTH || inner < 1e-3) return null;
  const ang = pts.map((p) => Math.atan2(p.y - c.y, p.x - c.x)).sort((a, b) => a - b);
  // the slot covers everything but the largest empty gap between the points' angles
  let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1], from = ang[0];
  for (let i = 1; i < ang.length; i++) if (ang[i] - ang[i - 1] > gap) { gap = ang[i] - ang[i - 1]; from = ang[i]; }
  if (gap < 1e-3) return null;
  const span = 2 * Math.PI - gap;
  const cap = Math.asin(Math.min(1, h / rc)); // a round end's cap reaches this far (as seen from c) past its centre
  for (const [ks, ke] of END_COMBOS) {
    const pa = from + (ks === 'round' ? cap : 0), pb = from + span - (ke === 'round' ? cap : 0);
    const sweep = pb - pa;
    if (sweep * rc < (ks === 'round' && ke === 'round' ? 1e-3 : -1e-9)) continue;
    if ((ks === 'square' || ke === 'square') && sweep * rc < 2 * w) continue;
    const expect = sweep * rc * w + (ks === 'round' ? (Math.PI * h * h) / 2 : 0) + (ke === 'round' ? (Math.PI * h * h) / 2 : 0);
    if (Math.abs(expect - area) > AREA_TOL * expect) continue;
    const P = (a: number): Vec2 => ({ x: c.x + rc * Math.cos(a), y: c.y + rc * Math.sin(a) });
    const ok = pts.every((p, i) => {
      // the point angle from pa, in (-(2π - sweep)/2, sweep + (2π - sweep)/2]: negative before the start, > sweep past the end
      let phi = Math.atan2(p.y - c.y, p.x - c.x) - pa;
      phi = ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (phi > sweep + (2 * Math.PI - sweep) / 2) phi -= 2 * Math.PI;
      const side = phi >= -1e-9 && phi <= sweep + 1e-9 ? Math.min(Math.abs(rho[i] - inner), Math.abs(rho[i] - outer)) : Infinity;
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
  const hi = Math.max(...zs);
  return hi - Math.min(...zs) <= 0.01 ? { bottom: hi, through: false } : null;
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
