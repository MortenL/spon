import { DEFAULT_AUTO_STOCK } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { fixedStockPatch } from './stockNoModel';

describe('fixedStockPatch', () => {
  it('turns auto stock into fixed with only that axis set', () => {
    const s = fixedStockPatch(structuredClone(DEFAULT_AUTO_STOCK), 'x', 300);
    expect(s).toEqual({ mode: 'fixed', size: { x: 300, y: 0, z: 0 }, modelOffset: { x: 0, y: 0, z: 0 } });
  });
  it('keeps the other axes of fixed stock', () => {
    const s = fixedStockPatch({ mode: 'fixed', size: { x: 1, y: 2, z: 3 }, modelOffset: { x: 4, y: 5, z: 6 } }, 'y', 20);
    expect(s.size).toEqual({ x: 1, y: 20, z: 3 });
    expect(s.modelOffset).toEqual({ x: 4, y: 5, z: 6 });
  });
});
