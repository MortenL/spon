import type { Move, Toolpath } from '../cam/types';
import type { AxisMap } from '../job/axes';

/** Maps every XY in a toolpath (line/rapid ends, arc ends and centres, cycle positions) to machine axes; flips arc direction when the map mirrors. Identity maps return the toolpath unchanged (same object). */
export function mapToolpath(tp: Toolpath, map: AxisMap): Toolpath {
  if (map.identity) return tp;
  const to3 = (p: { x: number; y: number; z: number }) => ({ ...map.toMachine(p), z: p.z });
  const moves = tp.moves.map((m): Move => {
    switch (m.kind) {
      case 'rapid':
      case 'line':
        return { ...m, to: to3(m.to) };
      case 'arc':
        return { ...m, to: to3(m.to), center: map.toMachine(m.center), ccw: m.ccw !== map.mirrored };
      case 'cycle':
        return { ...m, at: map.toMachine(m.at) };
    }
  });
  return { ...tp, moves };
}
