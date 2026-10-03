import type { Vec2, Vec3 } from '@sponcam/core';

export interface Ray3 { origin: Vec3; direction: Vec3 }

/** Where the ray meets the horizontal plane Z = z, or null for a parallel ray or a plane behind it. */
export function planeHit(ray: Ray3, z: number): Vec3 | null {
  if (Math.abs(ray.direction.z) < 1e-9) return null;
  const t = (z - ray.origin.z) / ray.direction.z;
  if (t < 0) return null;
  return { x: ray.origin.x + ray.direction.x * t, y: ray.origin.y + ray.direction.y * t, z };
}

/** The dragged text's new position (start + pointer delta), or null while the pointer moved less than minMove. */
export function dragPosition(start: Vec2, hit0: Vec2, hit: Vec2, minMove: number): Vec2 | null {
  const dx = hit.x - hit0.x;
  const dy = hit.y - hit0.y;
  if (Math.hypot(dx, dy) < minMove) return null;
  return { x: start.x + dx, y: start.y + dy };
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from p to the nearest segment of the loops (closed loops include their closing segment). */
export function distanceToLoops(loops: readonly { points: readonly Vec2[]; closed: boolean }[], p: Vec2): number {
  let best = Infinity;
  for (const { points, closed } of loops) {
    const n = points.length;
    if (n === 1) best = Math.min(best, Math.hypot(p.x - points[0].x, p.y - points[0].y));
    for (let i = 0; i < (closed ? n : n - 1); i++) best = Math.min(best, segmentDistance(p, points[i], points[(i + 1) % n]));
  }
  return best;
}
