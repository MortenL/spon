import { type CamContext, type GeometryRef, type Operation, type Path2D, resolveGeometry } from '@sponcam/core';

/** Whether the operation's drawing geometry has closed contours and/or open chains (decides which Side settings show). */
export function contourKinds(op: Operation, ctx: CamContext): { closed: boolean; open: boolean } {
  const contours = resolveGeometry(op, ctx).contours;
  return { closed: contours.some((c) => c.path.closed), open: contours.some((c) => !c.path.closed) };
}

/** Open chains of a profile in the direction they will be cut along (reverse applied), with their seed reference. */
export function openChains(op: Operation, ctx: CamContext): { ref: number; path: Path2D }[] {
  if (op.type !== 'profile') return [];
  return resolveGeometry(op, ctx).contours.filter((c) => !c.path.closed).map((c) => ({ ref: c.ref, path: c.path }));
}

export function toggleReverse(geometry: readonly GeometryRef[], index: number): GeometryRef[] {
  return geometry.map((g, i) => {
    if (i !== index || g.kind !== 'dxfPath') return g;
    if (g.reverse) {
      const { reverse: _, ...rest } = g;
      return rest;
    }
    return { ...g, reverse: true as const };
  });
}
