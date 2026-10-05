import { describe, expect, it } from 'vitest';
import { applyCommand, CommandError, createJob, type Job, type JobCommand } from '../src';

const base = (): Job => {
  let job = createJob();
  job = applyCommand(job, { type: 'addTool', tool: { id: 't1', name: '6', number: 1, type: 'flat', diameter: 6, fluteLength: 20, flutes: 2, presets: [] } } as never);
  job = applyCommand(job, { type: 'addOperation', id: 'o1', opType: 'profile', toolId: 't1' });
  job = applyCommand(job, { type: 'addOperation', id: 'dr', opType: 'drill', toolId: 't1' });
  return job;
};
const run = (job: Job, ...cmds: JobCommand[]) => cmds.reduce(applyCommand, job);
const manualOf = (job: Job, id = 'o1') => {
  const op = job.operations.find((o) => o.id === id)!;
  return 'tabs' in op ? op.tabs.manual : undefined;
};
const AUTO = [0.125, 0.375, 0.625, 0.875];

describe('tab commands', () => {
  it('addTab freezes an automatic contour', () => {
    const job = run(base(), { type: 'addTab', opId: 'o1', refIndex: 0, t: 0.5, current: AUTO });
    expect(manualOf(job)).toEqual([{ refIndex: 0, t: [0.125, 0.375, 0.5, 0.625, 0.875] }]);
  });

  it('addTab on a manual contour inserts, ignoring current', () => {
    let job = run(base(), { type: 'addTab', opId: 'o1', refIndex: 0, t: 0.5, current: AUTO });
    job = run(job, { type: 'addTab', opId: 'o1', refIndex: 0, t: 0.01, current: AUTO });
    expect(manualOf(job)).toEqual([{ refIndex: 0, t: [0.01, 0.125, 0.375, 0.5, 0.625, 0.875] }]);
  });

  it('removeTab removes the indexed position', () => {
    const job = run(base(), { type: 'removeTab', opId: 'o1', refIndex: 0, index: 1, current: AUTO });
    expect(manualOf(job)).toEqual([{ refIndex: 0, t: [0.125, 0.625, 0.875] }]);
  });

  it('removeTab can empty a contour and keeps the empty entry', () => {
    let job = run(base(), { type: 'removeTab', opId: 'o1', refIndex: 0, index: 0, current: [0.5] });
    expect(manualOf(job)).toEqual([{ refIndex: 0, t: [] }]);
    expect(() => run(job, { type: 'removeTab', opId: 'o1', refIndex: 0, index: 0, current: [0.5] })).toThrow('No such tab');
  });

  it('removeTab rejects an out-of-range index', () => {
    const rm = (index: number) => () => run(base(), { type: 'removeTab', opId: 'o1', refIndex: 0, index, current: AUTO });
    expect(rm(4)).toThrow(CommandError);
    expect(rm(4)).toThrow('No such tab');
    expect(rm(-1)).toThrow('No such tab');
    expect(rm(0.5)).toThrow('No such tab');
  });

  it('moveTab replaces and re-sorts', () => {
    const job = run(base(), { type: 'moveTab', opId: 'o1', refIndex: 0, index: 0, t: 0.7, current: AUTO });
    expect(manualOf(job)).toEqual([{ refIndex: 0, t: [0.375, 0.625, 0.7, 0.875] }]);
    expect(() => run(base(), { type: 'moveTab', opId: 'o1', refIndex: 0, index: 9, t: 0.7, current: AUTO })).toThrow('No such tab');
  });

  it('normalises t into [0, 1) without merging at the seam', () => {
    const t = (v: number) => manualOf(run(base(), { type: 'addTab', opId: 'o1', refIndex: 0, t: v, current: [] }))![0].t;
    expect(t(1)).toEqual([0]);
    expect(t(-0.25)).toEqual([0.75]);
    expect(t(2.5)).toEqual([0.5]);
    const job = run(base(), { type: 'addTab', opId: 'o1', refIndex: 0, t: 0, current: [] }, { type: 'addTab', opId: 'o1', refIndex: 0, t: 0.9999, current: [] });
    expect(manualOf(job)).toEqual([{ refIndex: 0, t: [0, 0.9999] }]);
  });

  it('normalises and sorts current when freezing', () => {
    const job = run(base(), { type: 'addTab', opId: 'o1', refIndex: 0, t: 0.5, current: [1.25, 0.75, -0.5] });
    expect(manualOf(job)).toEqual([{ refIndex: 0, t: [0.25, 0.5, 0.5, 0.75] }]);
  });

  it('keeps one entry per contour, sorted by refIndex', () => {
    const job = run(base(),
      { type: 'addTab', opId: 'o1', refIndex: 2, t: 0.5, current: [] },
      { type: 'addTab', opId: 'o1', refIndex: 0, t: 0.1, current: [] },
      { type: 'addTab', opId: 'o1', refIndex: 2, t: 0.6, current: [] },
      { type: 'moveTab', opId: 'o1', refIndex: 0, index: 0, t: 0.2, current: [] });
    expect(manualOf(job)).toEqual([{ refIndex: 0, t: [0.2] }, { refIndex: 2, t: [0.5, 0.6] }]);
  });

  it('resetTabs with refIndex removes only that entry; without, clears all', () => {
    const job = run(base(),
      { type: 'addTab', opId: 'o1', refIndex: 0, t: 0.1, current: [] },
      { type: 'addTab', opId: 'o1', refIndex: 1, t: 0.2, current: [] });
    expect(manualOf(run(job, { type: 'resetTabs', opId: 'o1', refIndex: 0 }))).toEqual([{ refIndex: 1, t: [0.2] }]);
    expect(manualOf(run(job, { type: 'resetTabs', opId: 'o1' }))).toEqual([]);
  });

  it('does not mutate the input job', () => {
    const job = base();
    run(job, { type: 'addTab', opId: 'o1', refIndex: 0, t: 0.1, current: [] });
    expect(manualOf(job)).toEqual([]);
  });

  it('rejects ops without tabs, unknown ops and bad numbers', () => {
    for (const c of [
      { type: 'addTab', opId: 'dr', refIndex: 0, t: 0.5, current: [] },
      { type: 'removeTab', opId: 'dr', refIndex: 0, index: 0, current: [] },
      { type: 'moveTab', opId: 'dr', refIndex: 0, index: 0, t: 0.5, current: [] },
      { type: 'resetTabs', opId: 'dr' },
    ] as JobCommand[]) expect(() => run(base(), c)).toThrow('This operation has no tabs');
    expect(() => run(base(), { type: 'resetTabs', opId: 'nope' })).toThrow('No operation with id nope');
    expect(() => run(base(), { type: 'addTab', opId: 'o1', refIndex: -1, t: 0.5, current: [] })).toThrow('Tab contour index must be 0 or more');
    expect(() => run(base(), { type: 'addTab', opId: 'o1', refIndex: 0, t: NaN, current: [] })).toThrow('Tab positions must be from 0 to below 1');
    expect(() => run(base(), { type: 'addTab', opId: 'o1', refIndex: 0, t: 0.5, current: [NaN] })).toThrow('Tab positions must be from 0 to below 1');
  });

  it('works on pocket and slot operations', () => {
    for (const opType of ['pocket', 'slot'] as const) {
      const job = run(base(), { type: 'addOperation', id: 'x', opType, toolId: 't1' }, { type: 'addTab', opId: 'x', refIndex: 0, t: 0.5, current: [] });
      expect(manualOf(job, 'x')).toEqual([{ refIndex: 0, t: [0.5] }]);
    }
  });

  it('updateOperation rejects a contour listed twice', () => {
    expect(() => run(base(), { type: 'updateOperation', id: 'o1', patch: { tabs: { manual: [{ refIndex: 0, t: [0.1] }, { refIndex: 0, t: [0.2] }] } } } as never))
      .toThrow('Each tab contour may appear only once');
  });
});
