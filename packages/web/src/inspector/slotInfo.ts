import { type CamContext, hasSquareEnd, resolveGeometry, resolveHeights, type SlotOp, slotStrategy, type Tool } from '@sponcam/core';

const LABEL = { toolWidth: 'Tool-width', wider: 'Wider', trochoidal: 'Trochoidal' } as const;

export interface SlotInfo {
  /** Any drawn centreline: its width is set on the operation. */
  drawn: boolean;
  /** Some picked slot has a square end, so the operation must say how to cut it. */
  squareEnds: boolean;
  /** One line per distinct strategy Auto picks. */
  auto: string[];
  /** Layers of the first slot when the strategy is trochoidal. */
  trochoidalLayers: number | null;
}

/** Display values for a slot operation, computed with the same geometry and rules the toolpath uses. */
export function slotInfo(op: SlotOp, ctx: CamContext, tool: Tool | null): SlotInfo {
  const geo = resolveGeometry(op, ctx);
  const auto = new Set<string>();
  if (tool) {
    for (const s of geo.slots) {
      const st = slotStrategy('auto', s.width, tool.diameter);
      if (op.strategy === 'auto' && 'strategy' in st) auto.add(`Auto → ${LABEL[st.strategy]} (${st.reason})`);
    }
  }
  let trochoidalLayers: number | null = null;
  const first = geo.slots[0];
  if (tool && first && op.strategy === 'trochoidal') {
    const h = resolveHeights(op.heights, ctx, { contourZ: first.top, holeBottom: null, slotBottom: first.bottom, faceZ: geo.faceZ }).values;
    if (h) trochoidalLayers = Math.max(1, Math.ceil((h.top - h.bottom - op.stockAxial) / tool.fluteLength - 1e-9));
  }
  return { drawn: op.geometry.some((g) => g.kind === 'dxfPath'), squareEnds: geo.slots.some(hasSquareEnd), auto: [...auto], trochoidalLayers };
}

/** The strategies the slots resolve to, with Auto settled per slot; the settings shown depend on them. */
export function activeStrategies(op: SlotOp, ctx: CamContext, tool: Tool | null): Set<'toolWidth' | 'wider' | 'trochoidal'> {
  if (op.strategy !== 'auto') return new Set([op.strategy]);
  const out = new Set<'toolWidth' | 'wider' | 'trochoidal'>();
  if (!tool) return out;
  for (const s of resolveGeometry(op, ctx).slots) {
    const st = slotStrategy('auto', s.width, tool.diameter);
    if ('strategy' in st) out.add(st.strategy);
  }
  return out;
}
