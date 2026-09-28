import type { Segment, Vec2 } from '../../geometry/path2d';
import type { LeadSettings } from '../types';

const left = (t: Vec2): Vec2 => ({ x: -t.y, y: t.x });

/**
 * Lead-in ending at P, arriving along the unit tangent T. `freeLeft` = the free (waste) side is to the left of travel.
 * Arc: a quarter circle of radius `length`, tangent to the path at P. Line: straight in from `length` away on the free side.
 */
export function leadIn(P: Vec2, T: Vec2, freeLeft: boolean, mode: LeadSettings['mode'], length: number): Segment[] {
  if (mode === 'none' || !(length > 0)) return [];
  const n = freeLeft ? left(T) : { x: -left(T).x, y: -left(T).y };
  if (mode === 'line') return [{ kind: 'line', from: { x: P.x + n.x * length, y: P.y + n.y * length }, to: P }];
  const c = { x: P.x + n.x * length, y: P.y + n.y * length };
  const startAngle = Math.atan2(-T.y, -T.x); // the start point is c − T·R
  return [{ kind: 'arc', center: c, radius: length, startAngle, sweep: freeLeft ? Math.PI / 2 : -Math.PI / 2 }];
}

/** Lead-out starting at P, leaving along T, turning away to the free side. */
export function leadOut(P: Vec2, T: Vec2, freeLeft: boolean, mode: LeadSettings['mode'], length: number): Segment[] {
  if (mode === 'none' || !(length > 0)) return [];
  const n = freeLeft ? left(T) : { x: -left(T).x, y: -left(T).y };
  if (mode === 'line') return [{ kind: 'line', from: P, to: { x: P.x + n.x * length, y: P.y + n.y * length } }];
  const c = { x: P.x + n.x * length, y: P.y + n.y * length };
  const startAngle = Math.atan2(-n.y, -n.x); // P = c − n·R
  return [{ kind: 'arc', center: c, radius: length, startAngle, sweep: freeLeft ? Math.PI / 2 : -Math.PI / 2 }];
}
