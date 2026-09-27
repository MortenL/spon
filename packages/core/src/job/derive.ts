import { type BBox, bboxCenter, bboxOfPoints, bboxSize } from '../geometry/bbox';
import { type Quat, quatFromAxisAngle, quatRotate } from '../geometry/quat';
import { v3add, v3scale, v3sub, type Vec3, vec3, Z_AXIS } from '../geometry/vec3';
import { unitScale } from '../units/units';
import { orientationQuat } from './orientation';
import type { AxisAnchor, FixedStock, Job, ModelRef, Wcs } from './types';

/** world = rotate(rotation, raw × scale) + translation */
export interface Placement {
  rotation: Quat;
  scale: number;
  translation: Vec3;
  bbox: BBox;
}

/** Scales to mm, orients, then rests the part on Z = 0 centred on the XY origin. */
export function computePlacement(model: ModelRef, rawPoints: ArrayLike<number>): Placement | null {
  const rotation = model.kind === 'drawing' ? quatFromAxisAngle(Z_AXIS, model.transform.zDeg) : orientationQuat(model.transform);
  const scale = unitScale(model.importUnits);
  const rotated = bboxOfPoints(rawPoints, (x, y, z) => quatRotate(rotation, vec3(x * scale, y * scale, z * scale)));
  if (!rotated) return null;
  const c = bboxCenter(rotated);
  const translation = vec3(-c.x, -c.y, -rotated.min.z);
  return {
    rotation,
    scale,
    translation,
    bbox: { min: v3add(rotated.min, translation), max: v3add(rotated.max, translation) },
  };
}

export function applyPlacement(p: Placement, raw: Vec3): Vec3 {
  return v3add(quatRotate(p.rotation, v3scale(raw, p.scale)), p.translation);
}

export function stockBox(job: Job, placement: Placement | null): BBox | null {
  if (!job.model || !placement) return null;
  const drawing = job.model.kind === 'drawing';
  const { min, max } = placement.bbox;
  const stock = job.stock;
  if (stock.mode === 'auto') {
    const m = stock.margin;
    return {
      min: vec3(min.x - m.xy, min.y - m.xy, min.z - m.zBottom),
      max: vec3(max.x + m.xy, max.y + m.xy, drawing ? max.z : max.z + m.zTop),
    };
  }
  const lo = vec3(
    min.x - stock.modelOffset.x,
    min.y - stock.modelOffset.y,
    drawing ? -stock.size.z : min.z - stock.modelOffset.z,
  );
  return { min: lo, max: v3add(lo, stock.size) };
}

const pick = (anchor: AxisAnchor, lo: number, hi: number) => (anchor === 'min' ? lo : anchor === 'max' ? hi : (lo + hi) / 2);

export function wcsPoint(wcs: Wcs, stock: BBox): Vec3 {
  return v3add(
    vec3(
      pick(wcs.anchor.x, stock.min.x, stock.max.x),
      pick(wcs.anchor.y, stock.min.y, stock.max.y),
      wcs.anchor.z === 'top' ? stock.max.z : stock.min.z,
    ),
    wcs.offset,
  );
}

/** Fixed stock that reproduces `stock` exactly for a model placed at `placed`. */
export function fixedStockFromBox(stock: BBox, placed: BBox): FixedStock {
  return { mode: 'fixed', size: bboxSize(stock), modelOffset: v3sub(placed.min, stock.min) };
}
