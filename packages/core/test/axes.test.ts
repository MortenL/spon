import { describe, expect, it } from 'vitest';
import { applyCommand, axisMap, createJob, CURRENT_SCHEMA_VERSION, migrateJob, type WcsAxes } from '../src';

const all: WcsAxes[] = [false, true].flatMap((reverseX) => [false, true].flatMap((reverseY) => [false, true].map((swapXY) => ({ reverseX, reverseY, swapXY }))));

describe('axis map', () => {
  it('round-trips and knows when it mirrors', () => {
    for (const a of all) {
      const m = axisMap(a);
      for (const p of [{ x: 3, y: 4 }, { x: -2.5, y: 7 }, { x: 0, y: -1 }]) expect(m.toSpon(m.toMachine(p))).toEqual(p);
      expect(m.mirrored).toBe([a.reverseX, a.reverseY, a.swapXY].filter(Boolean).length % 2 === 1);
      expect(m.identity).toBe(!a.reverseX && !a.reverseY && !a.swapXY);
    }
  });
  it('matches the spec examples', () => {
    expect(axisMap({ reverseX: false, reverseY: true, swapXY: false }).toMachine({ x: 3, y: 4 })).toEqual({ x: 3, y: -4 });
    expect(axisMap({ reverseX: false, reverseY: false, swapXY: true }).toMachine({ x: 3, y: 4 })).toEqual({ x: 4, y: 3 });
    expect(axisMap({ reverseX: true, reverseY: false, swapXY: true }).toMachine({ x: 3, y: 4 })).toEqual({ x: 4, y: -3 });
  });
});

describe('WCS axes in the job', () => {
  it('defaults off, migrates schema 8 and merges partial patches', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(9);
    expect(createJob().wcs.axes).toEqual({ reverseX: false, reverseY: false, swapXY: false });
    const v8 = { ...createJob(), schemaVersion: 8 } as Record<string, unknown>;
    v8.wcs = { ...(v8.wcs as object) };
    delete (v8.wcs as Record<string, unknown>).axes;
    expect(migrateJob(v8).wcs.axes).toEqual({ reverseX: false, reverseY: false, swapXY: false });
    let job = applyCommand(createJob(), { type: 'setWcs', patch: { axes: { reverseY: true } } });
    expect(job.wcs.axes).toEqual({ reverseX: false, reverseY: true, swapXY: false });
    job = applyCommand(job, { type: 'setWcs', patch: { axes: { swapXY: true } } });
    expect(job.wcs.axes).toEqual({ reverseX: false, reverseY: true, swapXY: true });
    expect(() => applyCommand(job, { type: 'setWcs', patch: { axes: { reverseX: 'yes' } as never } })).toThrow('axes.reverseX must be true or false');
  });
});
