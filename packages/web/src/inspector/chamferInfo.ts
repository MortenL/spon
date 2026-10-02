import { type ChamferOp, chamferGeometry, type Tool } from '@sponcam/core';

export interface ChamferInfo {
  /** Tip depth below the edge (mm). */
  depth: number | null;
  /** The widest chamfer the tool can cut (mm). */
  maxWidth: number | null;
  /** Diameter of a chamfered hole at the surface (mm). */
  topDiameter: number | null;
  error: string | null;
}

/** Display values for a chamfer operation, computed with the same geometry the toolpath uses. */
export function chamferInfo(op: Pick<ChamferOp, 'width' | 'tipOffset'>, tool: Tool | null, holeDiameter: number | null): ChamferInfo {
  const none: ChamferInfo = { depth: null, maxWidth: null, topDiameter: null, error: null };
  if (!tool) return none;
  if (tool.type !== 'chamfer' && tool.type !== 'vbit') return { ...none, error: 'Chamfering needs a chamfer mill or V-bit' };
  if (!(tool.tipAngleDeg > 0 && tool.tipAngleDeg < 180)) return { ...none, error: 'The tool needs a tip angle between 0 and 180 degrees' };
  const g = chamferGeometry(tool, op.width, op.tipOffset);
  return {
    depth: g.depth,
    maxWidth: g.maxWidth,
    topDiameter: holeDiameter === null ? null : holeDiameter + 2 * op.width,
    error: op.width > g.maxWidth + 1e-9 ? `Chamfer too wide for this tool (max ${g.maxWidth.toFixed(2)} mm)` : null,
  };
}
