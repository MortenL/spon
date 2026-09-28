import { describe, expect, it } from 'vitest';
import { applyCommand, CommandError, createJob, defaultHeights, type Job, type JobCommand, newOperation, type Tool } from '../src';

const tool: Tool = {
  id: 't6', name: '6 mm flat', type: 'flat', number: 2, diameter: 6, cornerRadius: 0, tipAngleDeg: 0,
  fluteLength: 20, stickout: 30, flutes: 2,
  presets: [{ name: 'Softwood', rpm: 18000, feed: 2000, plungeFeed: 600, stepdown: 3, stepoverPct: 45, coolant: 'off' }],
};
const run = (job: Job, ...commands: JobCommand[]) => commands.reduce(applyCommand, job);
const withTool = () => applyCommand(createJob(), { type: 'addTool', tool });

describe('newOperation', () => {
  it('takes feeds, stepdown and stepover from the tool preset', () => {
    const op = newOperation('pocket', { id: 'o1', name: 'Pocket 1', tool, modelKind: 'mesh' });
    expect(op).toMatchObject({
      id: 'o1', type: 'pocket', enabled: true, toolId: 't6', stepdown: 3, stepoverPct: 45,
      feeds: { presetName: 'Softwood', rpm: 18000, feed: 2000, plungeFeed: 600, coolant: 'off' },
      entry: { mode: 'auto', helixDiameterPct: 90, rampAngleDeg: 3 },
    });
    expect(op.heights.bottom).toEqual({ from: 'contour', offset: 0 });
  });

  it('uses spec defaults for heights, leads and tabs', () => {
    expect(defaultHeights('profile', 'mesh')).toEqual({
      clearance: { from: 'retract', offset: 10 }, retract: { from: 'stockTop', offset: 5 }, feed: { from: 'top', offset: 2 },
      top: { from: 'stockTop', offset: 0 }, bottom: { from: 'stockBottom', offset: -0.2 },
    });
    expect(defaultHeights('pocket', 'drawing').bottom).toEqual({ from: 'stockTop', offset: -3 });
    expect(defaultHeights('drill', 'mesh').bottom).toEqual({ from: 'holeBottom', offset: 0 });
    const p = newOperation('profile', { id: 'p', name: 'P', tool, modelKind: 'mesh' });
    expect(p).toMatchObject({ side: 'outside', direction: 'climb', leads: { mode: 'arc', length: 3, startPoint: 'auto' } });
    expect(p.type === 'profile' && p.tabs).toEqual({ enabled: false, shape: 'rect', width: 6, height: 2, placement: 'count', count: 4, spacing: 50, positions: null });
  });

  it('falls back to neutral feeds without a tool', () => {
    const op = newOperation('drill', { id: 'd', name: 'D', tool: null, modelKind: null });
    expect(op).toMatchObject({ toolId: null, feeds: { presetName: null, rpm: 10000, feed: 1000, plungeFeed: 300 }, cycle: 'drill', peck: 1, dwellSeconds: 0.5 });
  });
});

describe('applyCommand', () => {
  it('adds, names, updates, reorders, duplicates, toggles and removes operations', () => {
    let job = run(withTool(),
      { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'a' },
      { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'b' },
    );
    expect(job.operations.map((o) => [o.id, o.name])).toEqual([['a', 'Profile 1'], ['b', 'Profile 2']]);
    job = applyCommand(job, { type: 'updateOperation', id: 'a', patch: { side: 'inside', heights: { top: { from: 'origin', offset: 1 } }, tabs: { enabled: true } } });
    const a = job.operations[0];
    expect(a.type === 'profile' && [a.side, a.tabs.enabled, a.tabs.width]).toEqual(['inside', true, 6]);
    expect(a.heights.top).toEqual({ from: 'origin', offset: 1 });
    expect(a.heights.bottom).toEqual({ from: 'stockBottom', offset: -0.2 });
    job = applyCommand(job, { type: 'moveOperation', id: 'b', delta: -1 });
    expect(job.operations.map((o) => o.id)).toEqual(['b', 'a']);
    expect(applyCommand(job, { type: 'moveOperation', id: 'b', delta: -1 })).toBe(job);
    job = applyCommand(job, { type: 'duplicateOperation', id: 'b', newId: 'c' });
    expect(job.operations.map((o) => [o.id, o.name])).toEqual([['b', 'Profile 2'], ['c', 'Profile 2 copy'], ['a', 'Profile 1']]);
    job = applyCommand(job, { type: 'setOperationEnabled', id: 'c', enabled: false });
    expect(job.operations[1].enabled).toBe(false);
    job = applyCommand(job, { type: 'removeOperation', id: 'c' });
    expect(job.operations.map((o) => o.id)).toEqual(['b', 'a']);
  });

  it('manages job tools and post settings', () => {
    let job = withTool();
    expect(job.tools).toEqual([tool]);
    job = applyCommand(job, { type: 'updateTool', id: 't6', patch: { number: 7 } });
    expect(job.tools[0].number).toBe(7);
    job = applyCommand(job, { type: 'setPost', patch: { dialect: 'fanuc', lineNumbers: true } });
    expect(job.post).toMatchObject({ dialect: 'fanuc', lineNumbers: true, decimals: 3 });
    job = applyCommand(job, { type: 'setTolerance', tolerance: 0.01 });
    expect(job.tolerance).toBe(0.01);
    job = applyCommand(job, { type: 'removeTool', id: 't6' });
    expect(job.tools).toEqual([]);
  });

  it('wraps the Milestone 1 and 2 edits', () => {
    const job = run(createJob(), { type: 'renameJob', name: 'Bracket' }, { type: 'setWcs', patch: { workOffset: 'G55' } },
      { type: 'setMachineProfile', patch: { maxFeed: 5000 } }, { type: 'setDisplayUnits', unit: 'in' });
    expect([job.name, job.wcs.workOffset, job.machine.maxFeed, job.displayUnits]).toEqual(['Bracket', 'G55', 5000, 'in']);
  });

  it('rejects invalid commands with CommandError', () => {
    const job = run(withTool(), { type: 'addOperation', opType: 'drill', toolId: 't6', id: 'd' });
    const bad: JobCommand[] = [
      { type: 'updateOperation', id: 'nope', patch: {} },
      { type: 'updateOperation', id: 'd', patch: { side: 'inside' } },
      { type: 'updateOperation', id: 'd', patch: { peck: -1 } },
      { type: 'addOperation', opType: 'pocket', toolId: 'missing' },
      { type: 'addOperation', opType: 'pocket', toolId: 't6', id: 'd' },
      { type: 'removeTool', id: 't6' },
      { type: 'addTool', tool },
      { type: 'setTolerance', tolerance: 0 },
      { type: 'updateOperation', id: 'd', patch: { toolId: 'missing' } },
    ];
    for (const c of bad) expect(() => applyCommand(job, c), JSON.stringify(c)).toThrow(CommandError);
  });

  it('serialises every command through JSON unchanged', () => {
    const commands: JobCommand[] = [
      { type: 'addTool', tool },
      { type: 'addOperation', opType: 'pocket', toolId: 't6', id: 'p', name: 'Main pocket' },
      { type: 'updateOperation', id: 'p', patch: { stepoverPct: 30, geometry: [{ kind: 'dxfPath', blobId: 'b', layer: 0, path: 2 }] } },
      { type: 'setPost', patch: { dialect: 'linuxcnc' } },
    ];
    const direct = run(createJob(), ...commands);
    const viaJson = run(createJob(), ...(JSON.parse(JSON.stringify(commands)) as JobCommand[]));
    expect({ ...viaJson, id: direct.id }).toEqual(direct);
  });
});
