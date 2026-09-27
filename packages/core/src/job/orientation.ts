import { type Quat, quatFromAxisAngle, quatMultiply } from '../geometry/quat';
import { Z_AXIS } from '../geometry/vec3';
import type { ModelTransform } from './types';

/** Full model orientation: `base` first, then the spin about machine Z. */
export function orientationQuat(t: ModelTransform): Quat {
  return quatMultiply(quatFromAxisAngle(Z_AXIS, t.zDeg), t.base);
}

/** Maps any angle in degrees into (-180, 180]. */
export function normalizeDegrees(deg: number): number {
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}
