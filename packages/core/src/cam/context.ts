import type { Adjacency } from '../geometry/adjacency';
import type { BBox } from '../geometry/bbox';
import type { Mesh } from '../geometry/mesh';
import type { Path2D, Segment, Vec2 } from '../geometry/path2d';
import { v3sub, type Vec3, vec3 } from '../geometry/vec3';
import type { Drawing } from '../import/dxf/dxf';
import { applyPlacement, computePlacement, type Placement, stockBox, wcsPoint } from '../job/derive';
import type { Job } from '../job/types';

/** The loaded model as CAM needs it; the web app's ModelGeometry has this shape. */
export type CamGeometry =
  | { kind: 'mesh'; mesh: Mesh; adjacency: Adjacency; rawPoints: ArrayLike<number> }
  | { kind: 'drawing'; drawing: Drawing; rawPoints: ArrayLike<number> };

export interface CamContext {
  job: Job;
  geometry: CamGeometry | null;
  placement: Placement | null;
  /** WCS point in scene coordinates; program coordinates = scene − origin. */
  origin: Vec3;
  /** Stock box in program coordinates. */
  stock: BBox | null;
  /** Placed model box in program coordinates. */
  model: BBox | null;
  tolerance: number;
}

const shift = (b: BBox, o: Vec3): BBox => ({ min: v3sub(b.min, o), max: v3sub(b.max, o) });

export function camContext(job: Job, geometry: CamGeometry | null): CamContext {
  const placement = job.model && geometry && geometry.kind === job.model.kind ? computePlacement(job.model, geometry.rawPoints) : null;
  const box = stockBox(job, placement);
  const origin = box ? wcsPoint(job.wcs, box) : vec3(0, 0, 0);
  return {
    job, geometry, placement, origin,
    stock: box ? shift(box, origin) : null,
    model: placement ? shift(placement.bbox, origin) : null,
    tolerance: job.tolerance,
  };
}

/** A raw model point in program coordinates (requires a placement). */
export function toProgram(ctx: CamContext, raw: Vec3): Vec3 {
  if (!ctx.placement) throw new Error('No model placement');
  return v3sub(applyPlacement(ctx.placement, raw), ctx.origin);
}

/** A drawing path (raw DXF units) in program coordinates: scale, spin about Z, placement shift, minus the WCS point. */
export function drawingPathToProgram(ctx: CamContext, path: Path2D): Path2D {
  const p = ctx.placement;
  if (!p) throw new Error('No model placement');
  const theta = ((ctx.job.model?.transform.zDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(theta), sin = Math.sin(theta), k = p.scale;
  const tx = p.translation.x - ctx.origin.x, ty = p.translation.y - ctx.origin.y;
  const map = (v: Vec2): Vec2 => ({ x: (v.x * cos - v.y * sin) * k + tx, y: (v.x * sin + v.y * cos) * k + ty });
  const seg = (s: Segment): Segment =>
    s.kind === 'line'
      ? { kind: 'line', from: map(s.from), to: map(s.to) }
      : { ...s, center: map(s.center), radius: s.radius * k, startAngle: s.startAngle + theta };
  return { closed: path.closed, segments: path.segments.map(seg) };
}
