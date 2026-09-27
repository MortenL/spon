import { type Vec3, vec3 } from './vec3';

export interface BBox {
  min: Vec3;
  max: Vec3;
}

/** Bounds of a flat [x, y, z, x, y, z, …] array, optionally transforming each point first. */
export function bboxOfPoints(points: ArrayLike<number>, map?: (x: number, y: number, z: number) => Vec3): BBox | null {
  if (points.length < 3) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < points.length; i += 3) {
    let x = points[i], y = points[i + 1], z = points[i + 2];
    if (map) ({ x, y, z } = map(x, y, z));
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: vec3(minX, minY, minZ), max: vec3(maxX, maxY, maxZ) };
}

export const bboxSize = (b: BBox): Vec3 => vec3(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);

export const bboxCenter = (b: BBox): Vec3 =>
  vec3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
