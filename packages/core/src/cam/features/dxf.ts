import { dist2, nearestS } from '../../geometry/offset/pathOps';
import type { Path2D, Vec2 } from '../../geometry/path2d';
import type { Drawing } from '../../import/dxf/dxf';
import { type CamContext, drawingPathToProgram } from '../context';
import type { DxfPathRef } from '../types';

export function drawingPath(drawing: Drawing, layer: number, path: number): Path2D | null {
  return drawing.layers[layer]?.paths[path] ?? null;
}

/** A path made only of arcs with one centre and radius, sweeping a full turn. */
export function circleOf(path: Path2D, eps = 1e-6): { center: Vec2; diameter: number } | null {
  const first = path.segments[0];
  if (!first || first.kind !== 'arc') return null;
  let sweep = 0;
  for (const s of path.segments) {
    if (s.kind !== 'arc' || dist2(s.center, first.center) > eps || Math.abs(s.radius - first.radius) > eps) return null;
    sweep += s.sweep;
  }
  return Math.abs(Math.abs(sweep) - 2 * Math.PI) < 1e-6 ? { center: first.center, diameter: 2 * first.radius } : null;
}

/** The drawing path nearest to program point `q`, if within `maxDist` mm. */
export function nearestDxfPath(ctx: CamContext, q: Vec2, maxDist: number, hiddenLayers?: ReadonlySet<string>): DxfPathRef | null {
  const g = ctx.geometry;
  if (!g || g.kind !== 'drawing' || !ctx.job.model || !ctx.placement) return null;
  let best: DxfPathRef | null = null;
  let bestDist = maxDist;
  g.drawing.layers.forEach((l, layer) => {
    if (hiddenLayers?.has(l.name)) return;
    l.paths.forEach((p, path) => {
      const d = nearestS(drawingPathToProgram(ctx, p), q).distance;
      if (d <= bestDist) {
        bestDist = d;
        best = { kind: 'dxfPath', blobId: ctx.job.model!.blobId, layer, path };
      }
    });
  });
  return best;
}
