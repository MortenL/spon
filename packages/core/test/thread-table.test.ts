import { describe, expect, it } from 'vitest';
import { listThreads, threadDims, threadRow, tpiToPitch } from '../src';

describe('thread table', () => {
  it('has the standard sizes', () => {
    expect(threadRow('iso-coarse', 'M8')).toEqual({ standard: 'iso-coarse', size: 'M8', majorDiameter: 8, pitch: 1.25, angle: 60 });
    expect(threadRow('iso-fine', 'M8x1')?.pitch).toBe(1);
    expect(threadRow('unc', '1/4-20')?.majorDiameter).toBeCloseTo(6.35, 6);
    expect(threadRow('unc', '1/4-20')?.pitch).toBeCloseTo(1.27, 6);
    expect(threadRow('unc', '#10-24')?.majorDiameter).toBeCloseTo((0.06 + 0.13) * 25.4, 6);
    expect(threadRow('unf', '#10-32')?.pitch).toBeCloseTo(25.4 / 32, 6);
    expect(threadRow('unc', '1 1/8-7')?.majorDiameter).toBeCloseTo(1.125 * 25.4, 6);
    expect(threadRow('iso-coarse', 'M7')).toBeNull();
    expect(listThreads('iso-coarse').length).toBe(28);
    expect(listThreads('iso-fine').length).toBe(24);
    expect(listThreads('unc').length).toBe(20);
    expect(listThreads('unf').length).toBe(20);
    expect(listThreads().length).toBe(listThreads('iso-coarse').length + listThreads('iso-fine').length + listThreads('unc').length + listThreads('unf').length);
  });

  it('derives depths, minor diameters and the tap drill', () => {
    const m8 = threadDims({ majorDiameter: 8, pitch: 1.25, angle: 60 });
    expect(m8.H).toBeCloseTo(1.0825318, 6);
    expect(m8.minorInternal).toBeCloseTo(6.647, 3);
    expect(m8.minorExternal).toBeCloseTo(8 - 2 * 0.613435 * 1.25, 5);
    expect(m8.tapDrill).toBeCloseTo(6.75, 6); // major − pitch
    const w = threadDims({ majorDiameter: 20, pitch: 2.5, angle: 55 });
    expect(w.H).toBeCloseTo(2.5 / (2 * Math.tan((27.5 * Math.PI) / 180)), 6);
    expect(tpiToPitch(20)).toBeCloseTo(1.27, 6);
  });
});
