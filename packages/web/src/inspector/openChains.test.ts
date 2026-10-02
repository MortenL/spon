import { applyCommands, camContext, createJob, pathFromPoints, segmentStart, setModel, setStock } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import type { ModelGeometry } from '@/state/store';
import { contourKinds, openChains, toggleReverse } from './openChains';

const geometry: ModelGeometry = {
  kind: 'drawing',
  drawing: { layers: [{ name: 'L', color: 0xffffff, paths: [
    pathFromPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }], false),
    pathFromPoints([{ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 15 }, { x: 0, y: 15 }], true),
  ] }] },
  rawPoints: new Float32Array([0, 0, 0, 10, 15, 0]),
};
const ref = (path: number, reverse = false) => ({ kind: 'dxfPath' as const, blobId: 'b', layer: 0, path, ...(reverse ? { reverse: true as const } : {}) });

function setup(geo: ReturnType<typeof ref>[]) {
  let job = setStock(setModel(createJob(), { sourceName: 'a.svg', blobId: 'b', kind: 'drawing', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 5 } });
  job = applyCommands(job, [
    { type: 'addOperation', opType: 'profile', toolId: null, id: 'p' },
    { type: 'updateOperation', id: 'p', patch: { geometry: geo } },
  ]);
  return { op: job.operations[0], ctx: camContext(job, geometry) };
}

describe('open chains in the inspector', () => {
  it('knows which settings apply', () => {
    expect(contourKinds(setup([ref(0)]).op, setup([ref(0)]).ctx)).toEqual({ closed: false, open: true });
    const both = setup([ref(0), ref(1)]);
    expect(contourKinds(both.op, both.ctx)).toEqual({ closed: true, open: true });
  });

  it('lists open chains with their seed and direction, honouring reverse', () => {
    const fwd = setup([ref(0)]);
    const rev = setup([ref(0, true)]);
    const [a] = openChains(fwd.op, fwd.ctx);
    const [b] = openChains(rev.op, rev.ctx);
    expect(a.ref).toBe(0);
    expect(segmentStart(a.path.segments[0]).x).toBeLessThan(segmentStart(b.path.segments[0]).x);
  });

  it('toggles reverse on one reference', () => {
    expect(toggleReverse([ref(0), ref(1)], 0)).toEqual([ref(0, true), ref(1)]);
    expect(toggleReverse([ref(0, true)], 0)).toEqual([ref(0)]);
  });
});
