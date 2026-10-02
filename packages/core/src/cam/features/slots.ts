import { pathLength, pointAt } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';

/** An end of an open path: its point, the unit tangent pointing out of the path there, and that tangent turned +90°. */
export function endFrame(path: Path2D, which: 'start' | 'end'): { p: Vec2; t: Vec2; n: Vec2 } {
  const a = pointAt(path, which === 'start' ? 0 : pathLength(path));
  const t = which === 'start' ? { x: -a.tangent.x || 0, y: -a.tangent.y || 0 } : a.tangent;
  return { p: a.point, t, n: { x: -t.y || 0, y: t.x } };
}
