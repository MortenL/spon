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

export interface DragState { id: string; start: Vec2; hit0: Vec2; z: number; offset: Vec2 | null }
export type DragEvent = { type: 'move' | 'up'; hit: Vec2 | null } | { type: 'cancel' };
export interface DragStep { state: DragState | null; /** the position to commit (stock coordinates), when the drag ended with a move */ commit: Vec2 | null; orbitEnabled: boolean }

export function dragBegin(id: string, start: Vec2, hit0: Vec2, z: number): DragStep {
  return { state: { id, start, hit0, z, offset: null }, commit: null, orbitEnabled: false };
}

/** The drag state machine: move updates the shown offset, up commits once, cancel (Escape, pointercancel, blur, lost text) never commits. No drag: nothing happens. */
export function dragStep(state: DragState | null, event: DragEvent, minMove: number): DragStep {
  if (!state) return { state: null, commit: null, orbitEnabled: true };
  if (event.type === 'cancel') return { state: null, commit: null, orbitEnabled: true };
  const pos = event.hit ? dragPosition(state.start, state.hit0, event.hit, minMove) : null;
  if (event.type === 'up') return { state: null, commit: pos, orbitEnabled: true };
  if (!event.hit) return { state, commit: null, orbitEnabled: false };
  return { state: { ...state, offset: pos ? { x: pos.x - state.start.x, y: pos.y - state.start.y } : null }, commit: null, orbitEnabled: false };
}

/** Whether a drag's text still exists and is still the selected one. */
export const dragStillValid = (state: DragState, textIds: readonly string[], selectedId: string | null): boolean =>
  selectedId === state.id && textIds.includes(state.id);

export interface Box2 { minX: number; minY: number; maxX: number; maxY: number }

export function loopsBox(loops: readonly { points: readonly Vec2[] }[]): Box2 {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const l of loops) for (const q of l.points) {
    if (q.x < b.minX) b.minX = q.x;
    if (q.x > b.maxX) b.maxX = q.x;
    if (q.y < b.minY) b.minY = q.y;
    if (q.y > b.maxY) b.maxY = q.y;
  }
  return b;
}

/** Does the point lie inside the box grown by margin? */
export const nearBox = (b: Box2, p: Vec2, margin: number): boolean =>
  p.x >= b.minX - margin && p.x <= b.maxX + margin && p.y >= b.minY - margin && p.y <= b.maxY + margin;
