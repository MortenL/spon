import { type CamContext, type GeometryRef, type Operation, type Path2D, resolveGeometry } from '@sponcam/core';

/** Whether the operation's drawing geometry has closed contours and/or open chains (decides which Side settings show). */
export function contourKinds(op: Operation, ctx: CamContext): { closed: boolean; open: boolean } {
  const contours = resolveGeometry(op, ctx).contours;
  return { closed: contours.some((c) => c.path.closed), open: contours.some((c) => !c.path.closed) };
}

/**
 * Open chains of a profile, chamfer or slot as drawn (any reverse applied); a profile cuts along them, a chamfer may run
 * against them, see `chamferRunsAsDrawn`. `ref` is the seed reference,
 * `members` every reference that makes up the chain, `z` the height the drawing lies at.
 */
export function openChains(op: Operation, ctx: CamContext): { ref: number; members: number[]; z: number; path: Path2D }[] {
  if (op.type === 'slot') {
    // a drawn centreline runs as drawn (any reverse applied); recognised slots have no direction
    return resolveGeometry(op, ctx).slots
      .filter((s) => !s.centreline.closed && op.geometry[s.ref]?.kind === 'dxfPath')
      .map((s) => ({ ref: s.ref, members: s.members ?? [s.ref], z: s.top, path: s.centreline }));
  }
  if (op.type !== 'profile' && op.type !== 'chamfer' && op.type !== 'engrave') return [];
  return resolveGeometry(op, ctx).contours
    .filter((c) => !c.path.closed)
    .map((c) => ({ ref: c.ref, members: c.members ?? [c.ref], z: c.z, path: c.path }));
}

const isReversed = (g: GeometryRef) => g.kind === 'dxfPath' && g.reverse === true;

/** Whether any reference of the chain is reversed (which reverses the whole chain). */
export function chainReversed(geometry: readonly GeometryRef[], members: readonly number[]): boolean {
  return members.some((m) => geometry[m] && isReversed(geometry[m]));
}

/** Reverses a whole chain by flagging its seed, or, if any member is reversed already, clears the flag on all members. */
export function toggleChainReverse(geometry: readonly GeometryRef[], members: readonly number[], seed: number): GeometryRef[] {
  const clear = chainReversed(geometry, members);
  return geometry.map((g, i) => {
    if (g.kind !== 'dxfPath') return g;
    if (clear && members.includes(i) && g.reverse) {
      const { reverse: _, ...rest } = g;
      return rest;
    }
    return !clear && i === seed ? { ...g, reverse: true as const } : g;
  });
}

/** Whether a chamfer cuts an open chain in its drawn direction. Mirrors `forward` in core's cam/ops/chamfer.ts. */
export function chamferRunsAsDrawn(openSide: 'left' | 'right', direction: 'climb' | 'conventional'): boolean {
  return (openSide === 'left') === (direction === 'climb');
}
