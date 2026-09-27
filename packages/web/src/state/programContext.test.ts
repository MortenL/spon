import { createJob, setModel, vec3 } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { programContext, programOrigin } from './programContext';
import type { ModelGeometry } from './store';

// only rawPoints matter for placement; the Milestone 1 20 × 10 × 5 box
const BOX = { kind: 'mesh', rawPoints: Float32Array.from([0, 0, 0, 20, 10, 5]) } as unknown as ModelGeometry;

describe('programContext', () => {
  it('expresses the stock in program coordinates (origin at the WCS point)', () => {
    const job = setModel(createJob(), { sourceName: 'box.stl', blobId: 'b', kind: 'mesh', importUnits: 'mm' });
    const ctx = programContext(job, BOX);
    expect(ctx.stock).toEqual({ min: vec3(0, 0, -6), max: vec3(30, 20, 0) });
    expect(ctx.profile).toBe(job.machine);
    expect(ctx.jobWorkOffset).toBe('G54');
    expect(programOrigin(job, BOX)).toEqual(vec3(-15, -10, 6));
  });

  it('has no stock and a zero origin without a model', () => {
    const job = createJob();
    expect(programContext(job, null).stock).toBeNull();
    expect(programOrigin(job, null)).toEqual(vec3(0, 0, 0));
  });
});
