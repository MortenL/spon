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

export interface SlotFields {
  /** Width of a drawn centreline. */
  width: boolean;
  stepdown: boolean;
  /** Wider stepover. */
  stepover: boolean;
  /** Trochoidal step. */
  step: boolean;
  direction: boolean;
  layers: boolean;
  radialStock: boolean;
  finishWalls: boolean;
  squareEnds: boolean;
}

type Strategies = Set<'toolWidth' | 'wider' | 'trochoidal'>;

/** Which settings the Passes tab shows, from the chosen strategy, the strategies the slots resolve to and the info. */
export function slotFields(strategy: SlotOp['strategy'], active: Strategies, info: SlotInfo): SlotFields {
  const wider = active.has('wider');
  const trochoidal = active.has('trochoidal');
  const toolWidthOnly = active.size > 0 && [...active].every((a) => a === 'toolWidth');
  return {
    width: info.drawn,
    stepdown: strategy !== 'trochoidal',
    stepover: wider,
    step: trochoidal,
    direction: wider || trochoidal,
    layers: strategy === 'trochoidal' && info.trochoidalLayers !== null,
    radialStock: !toolWidthOnly,
    finishWalls: !toolWidthOnly,
    squareEnds: info.squareEnds,
  };
}

/** Everything the Slot settings need, from a single resolveGeometry call. */
export function slotView(op: SlotOp, ctx: CamContext, tool: Tool | null): { info: SlotInfo; active: Strategies; fields: SlotFields } {
  const geo = resolveGeometry(op, ctx);
  const auto = new Set<string>();
  const active: Strategies = op.strategy === 'auto' ? new Set() : new Set([op.strategy]);
  if (tool && op.strategy === 'auto') {
    for (const s of geo.slots) {
      const st = slotStrategy('auto', s.width, tool.diameter);
      if (!('strategy' in st)) continue;
      active.add(st.strategy);
      auto.add(`Auto \u2192 ${LABEL[st.strategy]} (${st.reason})`);
    }
  }
  let trochoidalLayers: number | null = null;
  const first = geo.slots[0];
  if (tool && first && op.strategy === 'trochoidal') {
    const h = resolveHeights(op.heights, ctx, { contourZ: first.top, holeBottom: null, slotBottom: first.bottom, faceZ: geo.faceZ }).values;
    if (h) trochoidalLayers = Math.max(1, Math.ceil((h.top - h.bottom - op.stockAxial) / tool.fluteLength - 1e-9));
  }
  const info: SlotInfo = { drawn: op.geometry.some((g) => g.kind === 'dxfPath'), squareEnds: geo.slots.some(hasSquareEnd), auto: [...auto], trochoidalLayers };
  return { info, active, fields: slotFields(op.strategy, active, info) };
}

/** Display values for a slot operation, computed with the same geometry and rules the toolpath uses. */
export const slotInfo = (op: SlotOp, ctx: CamContext, tool: Tool | null): SlotInfo => slotView(op, ctx, tool).info;
