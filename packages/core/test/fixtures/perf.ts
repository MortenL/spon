import { expect } from 'vitest';

/** True in the serial `perf` vitest project (SPON_PERF=1), the only place wall-clock budgets are asserted. */
export const PERF = process.env.SPON_PERF === '1';

/** A hard wall-clock budget: checked only in the serial perf project, where parallel load cannot starve it. */
export function expectWithin(ms: number, budget: number): void {
  if (PERF) expect(ms).toBeLessThan(budget);
}
