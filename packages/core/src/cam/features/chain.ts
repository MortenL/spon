import { pointInPolys } from '../../geometry/offset/clipper';
import { dist2, flattenPath, orientPath, pathEnd, pathLength, pathStart, polyArea, reversePath } from '../../geometry/offset/pathOps';
import { type Path2D, type Segment, segmentEnd, segmentStart } from '../../geometry/path2d';

/** Joins open paths end to end (reversing where needed) when their end points are within `tol`. */
export function chainPaths(paths: readonly Path2D[], tol: number): { closed: Path2D[]; open: Path2D[]; openSeeds: number[] } {
  const closed: Path2D[] = [];
  const pieces: Path2D[] = [];
  const pieceIndex: number[] = [];
  for (const [idx, p] of paths.entries()) {
    if (!p.segments.length) continue;
    if (p.closed || (dist2(pathStart(p), pathEnd(p)) <= tol && pathLength(p) > 2 * tol)) closed.push({ ...p, closed: true });
    else {
      pieces.push(p);
      pieceIndex.push(idx);
    }
  }
  const used = pieces.map(() => false);
  const open: Path2D[] = [];
  const openSeeds: number[] = [];
  for (let i = 0; i < pieces.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let segs: Segment[] = [...pieces[i].segments];
    for (let grown = true; grown; ) {
      grown = false;
      const start = segmentStart(segs[0]);
      const end = segmentEnd(segs[segs.length - 1]);
      for (let j = 0; j < pieces.length; j++) {
        if (used[j]) continue;
        const q = pieces[j];
        const qs = pathStart(q), qe = pathEnd(q);
        if (dist2(end, qs) <= tol) segs = [...segs, ...q.segments];
        else if (dist2(end, qe) <= tol) segs = [...segs, ...reversePath(q).segments];
        else if (dist2(start, qe) <= tol) segs = [...q.segments, ...segs];
        else if (dist2(start, qs) <= tol) segs = [...reversePath(q).segments, ...segs];
        else continue;
        used[j] = true;
        grown = true;
        break;
      }
    }
    const path: Path2D = { segments: segs, closed: false };
    if (dist2(pathStart(path), pathEnd(path)) <= tol && pathLength(path) > 2 * tol) closed.push({ ...path, closed: true });
    else {
      open.push(path);
      openSeeds.push(pieceIndex[i]);
    }
  }
  return { closed, open, openSeeds };
}

export interface Shape {
  /** Counter-clockwise. */
  outer: Path2D;
  /** Clockwise. */
  islands: Path2D[];
}

/** Groups closed loops by containment: even depth = outer, odd depth = island of the smallest loop around it. */
export function nestLoops(loops: readonly Path2D[], tol: number): Shape[] {
  const flat = loops.map((l) => flattenPath(l, Math.max(tol, 0.01)));
  const areas = flat.map((f) => Math.abs(polyArea(f)));
  const contains = (o: number, i: number) => o !== i && areas[o] > areas[i] && pointInPolys(flat[i][0], [flat[o]]);
  const depth = loops.map((_, i) => loops.filter((_, j) => contains(j, i)).length);
  const shapes = new Map<number, Shape>();
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 0) shapes.set(i, { outer: orientPath(l, true), islands: [] });
  });
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 0) return;
    let parent = -1;
    for (let j = 0; j < loops.length; j++) {
      if (depth[j] === depth[i] - 1 && contains(j, i) && (parent < 0 || areas[j] < areas[parent])) parent = j;
    }
    shapes.get(parent)?.islands.push(orientPath(l, false));
  });
  return [...shapes.values()];
}
