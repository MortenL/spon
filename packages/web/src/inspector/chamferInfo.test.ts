import type { ChamferOp, Tool } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { chamferInfo } from './chamferInfo';

const tool = (over: Partial<Tool> = {}) => ({ id: 't', name: 'V', type: 'chamfer', diameter: 12, tipAngleDeg: 90, ...over }) as Tool;
const op = (width: number, tipOffset: number) => ({ width, tipOffset }) as ChamferOp;

describe('chamferInfo', () => {
  it('computes depth and the widest chamfer', () => {
    const i = chamferInfo(op(1, 0.2), tool(), null);
    expect(i.depth).toBeCloseTo(1.2, 9);
    expect(i.maxWidth).toBeCloseTo(5.8, 9);
    expect(i.topDiameter).toBeNull();
    expect(i.error).toBeNull();
  });
  it('gives the top diameter of a hole', () => {
    expect(chamferInfo(op(1, 0.2), tool(), 5).topDiameter).toBeCloseTo(7, 9);
  });
  it('reports a chamfer that is too wide', () => {
    expect(chamferInfo(op(9, 0.2), tool(), null).error).toBe('Chamfer too wide for this tool (max 5.80 mm)');
  });
  it('rejects a flat tool', () => {
    expect(chamferInfo(op(1, 0.2), tool({ type: 'flat', tipAngleDeg: 0 }), null).error).toBe('Chamfering needs a chamfer mill or V-bit');
  });
  it('shows nothing without a tool', () => {
    expect(chamferInfo(op(1, 0.2), null, null)).toEqual({ depth: null, maxWidth: null, topDiameter: null, error: null });
  });
});
