import type { AxisMap } from '../job/axes';
import { MoveKind, type MotionTable } from './types';

/**
 * In place: maps `start`, every row's `end` and `arc` centre (x, y) through map.toSpon, and swaps MoveKind.ArcCW and ArcCCW when map.mirrored.
 *
 * Arcs in G18 (XZ) and G19 (YZ) follow the same linear map. CCW is a positive turn about the plane normal (+Y for G18, +X for G19),
 * the map carries that normal to +-X or +-Y in Spon's frame, and a turn keeps its sense about the image axis only when the map does
 * not mirror. So the plane becomes G19 when the normal lands on X (swapXY) else G18, and the direction flips when the map mirrors
 * XOR the normal's image points the negative way. G17 arcs just flip when mirrored.
 */
export function mapTableToSpon(table: MotionTable, map: AxisMap): void {
  if (map.identity) return;
  const s = map.toSpon(table.start);
  table.start = { x: s.x, y: s.y, z: table.start.z };
  const nY = map.toSpon({ x: 0, y: 1 }); // image of the G18 normal
  const nX = map.toSpon({ x: 1, y: 0 }); // image of the G19 normal
  for (let i = 0; i < table.count; i++) {
    for (const buf of [table.end, table.arc]) {
      const p = map.toSpon({ x: buf[i * 3], y: buf[i * 3 + 1] });
      buf[i * 3] = p.x;
      buf[i * 3 + 1] = p.y;
    }
    const kind = table.kind[i];
    if (kind !== MoveKind.ArcCW && kind !== MoveKind.ArcCCW) continue;
    let flip = map.mirrored;
    const plane = table.plane[i];
    if (plane === 18 || plane === 19) {
      const n = plane === 18 ? nY : nX;
      const onX = Math.abs(n.x) > 0.5;
      table.plane[i] = onX ? 19 : 18;
      flip = flip !== ((onX ? n.x : n.y) < 0);
    }
    if (flip) table.kind[i] = kind === MoveKind.ArcCW ? MoveKind.ArcCCW : MoveKind.ArcCW;
  }
}
