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
