import type { FixedStock, Stock } from '@sponcam/core';

/** Stock after editing one size axis in fixed mode. Auto stock (or none yet) becomes fixed with only that axis set. */
export function fixedStockPatch(stock: Stock, axis: 'x' | 'y' | 'z', valueMm: number): FixedStock {
  const base = stock.mode === 'fixed' ? stock.size : { x: 0, y: 0, z: 0 };
  return { mode: 'fixed', size: { ...base, [axis]: valueMm }, modelOffset: stock.mode === 'fixed' ? { ...stock.modelOffset } : { x: 0, y: 0, z: 0 } };
}
