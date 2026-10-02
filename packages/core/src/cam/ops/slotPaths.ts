import type { CamCode, SlotOp } from '../types';

/** A slot this close to the tool diameter (mm) is a tool-width slot. */
export const WIDTH_MATCH = 0.05;
export type SlotStrategy = 'toolWidth' | 'wider' | 'trochoidal';

const mm = (v: number) => String(Number(v.toFixed(2)));

/** Spec §3.1: the strategy a slot of `width` is cut with, or why it cannot be. Auto never picks trochoidal. */
export function slotStrategy(strategy: SlotOp['strategy'], width: number, toolDiameter: number):
  { strategy: SlotStrategy; reason: string } | { error: { code: CamCode; message: string } } {
  if (width < toolDiameter - WIDTH_MATCH) return { error: { code: 'tool-too-large', message: `The tool is wider than this slot (${width.toFixed(2)} mm)` } };
  const matches = Math.abs(width - toolDiameter) <= WIDTH_MATCH;
  if (strategy === 'auto') {
    return matches
      ? { strategy: 'toolWidth', reason: `width ${mm(width)} = tool ${mm(toolDiameter)}` }
      : { strategy: 'wider', reason: `width ${mm(width)} > tool ${mm(toolDiameter)}` };
  }
  if (strategy === 'toolWidth' && !matches) {
    return { error: { code: 'slot-width-mismatch', message: `Tool-width slots need a tool as wide as the slot (${width.toFixed(2)} mm); use Wider` } };
  }
  return { strategy, reason: 'chosen' };
}
