import { describe, expect, it } from 'vitest';
import { applyCommand, createJob, CURRENT_SCHEMA_VERSION, defaultTabs, migrateJob, MIGRATIONS, type Operation } from '../src';

const base = (id: string, toolId: string | null) => ({
  id, name: id, enabled: true, toolId, geometry: [],
  feeds: { presetName: null, rpm: 10000, feed: 1000, plungeFeed: 300, coolant: 'off' },
  heights: {},
});

function v9Job(ops: Record<string, unknown>[]) {
  const tool = { id: 't1', name: '6 mm', number: 1, type: 'flat', diameter: 6, presets: [] };
  return { ...createJob(), schemaVersion: 9, tools: [tool], operations: ops };
}

describe('tabs model (schema 10)', () => {
  it('is schema 10', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(10);
    expect(createJob().schemaVersion).toBe(10);
  });

  it('migrates schema 9 profile positions to per-contour manual tabs', () => {
    const tabs = { ...defaultTabs(6), positions: [{ refIndex: 1, t: 0.6 }, { refIndex: 0, t: 0.25 }, { refIndex: 1, t: 0.1 }] } as Record<string, unknown>;
    delete tabs.manual;
    const none = { ...tabs, positions: null };
    const job = migrateJob(v9Job([
      { ...base('p1', 't1'), type: 'profile', tabs },
      { ...base('p2', 't1'), type: 'profile', tabs: none },
    ]), MIGRATIONS, 10);
    const [a, b] = job.operations as Array<Extract<Operation, { type: 'profile' }>>;
    expect(a.tabs.manual).toEqual([{ refIndex: 0, t: [0.25] }, { refIndex: 1, t: [0.1, 0.6] }]);
    expect('positions' in a.tabs).toBe(false);
    expect(b.tabs.manual).toEqual([]);
    expect('positions' in b.tabs).toBe(false);
  });

  it('converts schema 9 positions to the counter-clockwise tab frame where the cut direction tells how', () => {
    const positions = [{ refIndex: 0, t: 0.1 }, { refIndex: 0, t: 0.6 }, { refIndex: 1, t: 0.25 }];
    const profile = (id: string, side: string, direction: string, startPoint: unknown = 'auto') => {
      const tabs = { ...defaultTabs(6), positions } as Record<string, unknown>;
      delete tabs.manual;
      return { ...base(id, 't1'), type: 'profile', side, direction, leads: { mode: 'none', length: 0, startPoint }, tabs };
    };
    const job = migrateJob(v9Job([
      profile('cw', 'outside', 'climb'), // schema 9 measured these clockwise: mirrored
      profile('ccw', 'outside', 'conventional'), // counter-clockwise already: kept
      profile('in', 'inside', 'conventional'), // inside, conventional runs clockwise: mirrored
      profile('on', 'on', 'climb'),
      profile('lead', 'outside', 'climb', { refIndex: 0, t: 0.4 }), // contour 0 started at its lead start point: kept
    ]), MIGRATIONS, 10);
    const manual = (job.operations as Array<Extract<Operation, { type: 'profile' }>>).map((o) => o.tabs.manual);
    const mirrored = [{ refIndex: 0, t: [0.4, 0.9] }, { refIndex: 1, t: [0.75] }];
    const kept = [{ refIndex: 0, t: [0.1, 0.6] }, { refIndex: 1, t: [0.25] }];
    expect(manual[0]).toEqual(mirrored);
    expect(manual[1]).toEqual(kept);
    expect(manual[2]).toEqual(mirrored);
    expect(manual[3]).toEqual(mirrored);
    expect(manual[4]).toEqual([{ refIndex: 0, t: [0.1, 0.6] }, { refIndex: 1, t: [0.75] }]);
  });

  it('gives pockets and slots disabled tabs', () => {
    const job = migrateJob(v9Job([
      { ...base('k1', 't1'), type: 'pocket' },
      { ...base('s1', 't1'), type: 'slot' },
      { ...base('k2', null), type: 'pocket' },
    ]), MIGRATIONS, 10);
    const ops = job.operations as Array<Extract<Operation, { type: 'pocket' | 'slot' }>>;
    expect(ops[0].tabs).toEqual(defaultTabs(6));
    expect(ops[1].tabs).toEqual(defaultTabs(6));
    expect(ops[2].tabs).toEqual({ ...defaultTabs(0), width: 4 });
    expect(ops[2].tabs.width).toBe(4);
  });

  it('validates manual tabs', () => {
    let job = createJob();
    job = applyCommand(job, { type: 'addTool', tool: { id: 't1', name: '6', number: 1, type: 'flat', diameter: 6, fluteLength: 20, flutes: 2, presets: [] } } as never);
    job = applyCommand(job, { type: 'addOperation', id: 'o1', opType: 'profile', toolId: 't1' });
    const upd = (manual: unknown) => () => applyCommand(job, { type: 'updateOperation', id: 'o1', patch: { tabs: { manual } } } as never);
    expect(upd([{ refIndex: -1, t: [0.5] }])).toThrow('Tab contour index must be 0 or more');
    expect(upd([{ refIndex: 0, t: [1.2] }])).toThrow('Tab positions must be from 0 to below 1');
    const out = applyCommand(job, { type: 'updateOperation', id: 'o1', patch: { tabs: { manual: [{ refIndex: 0, t: [0.7, 0.2] }] } } } as never);
    const op = out.operations[0] as Extract<Operation, { type: 'profile' }>;
    expect(op.tabs.manual).toEqual([{ refIndex: 0, t: [0.2, 0.7] }]);
  });
});
