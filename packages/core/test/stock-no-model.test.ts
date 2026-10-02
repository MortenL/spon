import { describe, expect, it } from 'vitest';
import { camContext, createJob, setStock, stockBox } from '../src';

describe('fixed stock without a model (spoilboard)', () => {
  it('gives fixed stock a box with its top at Z 0 and its min corner at the origin', () => {
    const job = setStock(createJob(), { mode: 'fixed', size: { x: 600, y: 400, z: 0 }, modelOffset: { x: 0, y: 0, z: 0 } });
    const box = stockBox(job, null)!;
    expect([box.min.x, box.min.y, box.max.x, box.max.y, box.max.z]).toEqual([0, 0, 600, 400, 0]);
    expect(box.min.z).toBeCloseTo(0, 12);
    const ctx = camContext(job, null);
    expect(ctx.stock).not.toBeNull();
    expect(ctx.model).toBeNull();
  });

  it('auto stock still needs a model', () => {
    expect(stockBox(createJob(), null)).toBeNull();
  });
});
