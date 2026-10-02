import { describe, expect, it } from 'vitest';
import { camContext, createJob, defaultHeights, type Heights, resolveHeights, vec3 } from '../src';
import { camPartSetup } from './fixtures/camSetup';

const none = { contourZ: null, holeBottom: null };

describe('resolveHeights', () => {
  const { job, geometry } = camPartSetup(); // stock top 0, stock bottom −6
  const ctx = camContext(job, geometry);

  it('resolves the profile defaults from the stock', () => {
    expect(resolveHeights(defaultHeights('profile', 'drawing'), ctx, none)).toEqual({
      values: { top: 0, bottom: -6.2, feed: 2, retract: 5, clearance: 15 }, errors: [],
    });
  });

  it('uses the contour Z, hole bottom, picked faces and absolute values', () => {
    const h: Heights = { ...defaultHeights('pocket', 'mesh'), bottom: { from: 'contour', offset: -0.5 } };
    expect(resolveHeights(h, ctx, { contourZ: -2, holeBottom: null }).values?.bottom).toBe(-2.5);
    const d = defaultHeights('drill', 'mesh');
    expect(resolveHeights(d, ctx, { contourZ: 0, holeBottom: -4 }).values?.bottom).toBe(-4);
    const face = { kind: 'meshFace' as const, blobId: 'm', seed: 0, normal: vec3(0, 0, 1), point: vec3(0, 0, 0) };
    const hf: Heights = { ...h, bottom: { from: 'face', offset: 0, face } };
    expect(resolveHeights(hf, ctx, { ...none, faceZ: () => -3 }).values?.bottom).toBe(-3);
    const abs: Heights = { ...h, top: { from: 'origin', offset: 1 }, bottom: { from: 'origin', offset: -1 } };
    expect(resolveHeights(abs, ctx, none).values).toMatchObject({ top: 1, bottom: -1, feed: 3 });
  });

  it('reports invalid combinations and missing references', () => {
    const base = defaultHeights('profile', 'drawing');
    expect(resolveHeights({ ...base, bottom: { from: 'origin', offset: 1 } }, ctx, none).errors).toEqual(['Bottom height must be below top height']);
    expect(resolveHeights({ ...base, bottom: { from: 'origin', offset: 1 } }, ctx, { ...none, facing: true }).errors).toEqual(['Set the facing depth (Heights → Bottom)']);
    expect(resolveHeights({ ...base, top: { from: 'holeBottom', offset: 0 } }, ctx, none).errors[0]).toMatch(/Top height cannot be measured from/);
    expect(resolveHeights({ ...base, retract: { from: 'origin', offset: 0 } }, ctx, none).errors).toEqual(['Retract height must not be below feed height']);
    expect(resolveHeights({ ...base, bottom: { from: 'contour', offset: 0 } }, ctx, none).errors).toEqual(['Bottom height needs a contour']);
    expect(resolveHeights(base, camContext(createJob(), null), none).errors[0]).toBe('Top height needs stock');
    expect(resolveHeights({ ...base, bottom: { from: 'face', offset: 0 } }, ctx, none).errors).toEqual(['Bottom height needs a picked face']);
  });
});
