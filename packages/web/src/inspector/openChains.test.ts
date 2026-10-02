import { applyCommands, camContext, createJob, pathFromPoints, segmentStart, setModel, setStock } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import type { ModelGeometry } from '@/state/store';
import { chamferRunsAsDrawn, contourKinds, openChains, toggleChainReverse, chainReversed } from './openChains';

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

  it('lists the members of a chain', () => {
    const { op, ctx } = setup([ref(0), ref(1)]);
    expect(openChains(op, ctx)).toMatchObject([{ ref: 0, members: [0] }]);
  });

  it('toggles reverse for a whole chain', () => {
    const geo = [ref(0), ref(1), ref(2)];
    expect(toggleChainReverse(geo, [0, 1], 0)).toEqual([ref(0, true), ref(1), ref(2)]);
    expect(toggleChainReverse([ref(0), ref(1, true), ref(2)], [0, 1], 0)).toEqual(geo);
    expect(toggleChainReverse([ref(0, true), ref(1, true), ref(2, true)], [0, 1], 0)).toEqual([ref(0), ref(1), ref(2, true)]);
    expect(chainReversed([ref(0), ref(1, true)], [0, 1])).toBe(true);
    expect(chainReversed([ref(0), ref(1, true)], [0])).toBe(false);
  });
});

describe('open chains of slot operations', () => {
  const chain: ModelGeometry = {
    kind: 'drawing',
    drawing: { layers: [{ name: 'L', color: 0xffffff, paths: [
      pathFromPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }], false),
      pathFromPoints([{ x: 10, y: 0 }, { x: 20, y: 0 }], false),
    ] }] },
    rawPoints: new Float32Array([0, 0, 0, 20, 0, 0]),
  };
  it('lists every member of a drawn chain and honours a reverse flag on a non-seed member', () => {
    const base = setStock(setModel(createJob(), { sourceName: 'a.svg', blobId: 'b', kind: 'drawing', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 5 } });
    const mk = (geo: ReturnType<typeof ref>[]) => applyCommands(base, [
      { type: 'addOperation', opType: 'slot', toolId: null, id: 's' },
      { type: 'updateOperation', id: 's', patch: { geometry: geo } },
    ]);
    const fwd = mk([ref(0), ref(1)]);
    const rev = mk([ref(0), ref(1, true)]);
    const [a] = openChains(fwd.operations[0], camContext(fwd, chain));
    const [b] = openChains(rev.operations[0], camContext(rev, chain));
    expect(a).toMatchObject({ ref: 0, members: [0, 1] });
    expect(chainReversed(rev.operations[0].geometry, b.members)).toBe(true);
    expect(segmentStart(a.path.segments[0]).x).toBeLessThan(segmentStart(b.path.segments[0]).x);
  });
});

describe('chamferRunsAsDrawn', () => {
  it.each([
    ['left', 'climb', true],
    ['left', 'conventional', false],
    ['right', 'climb', false],
    ['right', 'conventional', true],
  ] as const)('%s + %s -> %s', (side, dir, expected) => {
    expect(chamferRunsAsDrawn(side, dir)).toBe(expected);
  });
});
