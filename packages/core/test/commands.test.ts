import { describe, expect, it } from 'vitest';
import { addProgram, applyCommand, CommandError, createJob, defaultHeights, setModel, type Job, type JobCommand, newOperation, type Tool } from '../src';

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

  it('rejects a tool whose T number another job tool already has', () => {
    const job = withTool(); // t6 is T2
    const other = { ...tool, id: 't8', number: 2 };
    expect(() => applyCommand(job, { type: 'addTool', tool: other })).toThrow(CommandError);
    const two = applyCommand(job, { type: 'addTool', tool: { ...other, number: 3 } });
    expect(() => applyCommand(two, { type: 'updateTool', id: 't8', patch: { number: 2 } })).toThrow(CommandError);
    expect(applyCommand(two, { type: 'updateTool', id: 't6', patch: { number: 2, name: 'renamed' } }).tools[0].name).toBe('renamed');
  });

  it('rejects tab settings that cannot place tabs', () => {
    const job = run(withTool(), { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'p' });
    for (const tabs of [{ spacing: 0 }, { spacing: -1 }, { count: 0 }, { count: Number.NaN }, { width: 0 }, { width: -2 }]) {
      expect(() => applyCommand(job, { type: 'updateOperation', id: 'p', patch: { tabs } }), JSON.stringify(tabs)).toThrow(CommandError);
    }
    expect(applyCommand(job, { type: 'updateOperation', id: 'p', patch: { tabs: { spacing: 30, count: 1, width: 3 } } }).operations[0])
      .toMatchObject({ tabs: { spacing: 30, count: 1, width: 3 } });
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

  it('survives a JSON round trip for every JobCommand variant', () => {
    // Start with a job that has a model and programs (set up outside the command sequence)
    let setupJob = setModel(createJob(), { sourceName: 'a.stl', blobId: 'm', kind: 'mesh', importUnits: 'mm' });
    setupJob = addProgram(setupJob, { name: 'prog1', blobId: 'prog1' });
    setupJob = addProgram(setupJob, { name: 'prog2', blobId: 'prog2' });
    const [progId1, progId2] = setupJob.programs.map((p) => p.id);

    // Build a sequence with one of every JobCommand variant (25 total)
    const commands: JobCommand[] = [
      // Milestone 1/2 commands (14)
      { type: 'renameJob', name: 'Test Job' },
      { type: 'setDisplayUnits', unit: 'in' },
      { type: 'setImportUnits', unit: 'in' },
      { type: 'rotateQuarter', axis: 'x', direction: 1 },
      { type: 'layFlat', rawNormal: { x: 0, y: 0, z: 1 } },
      { type: 'setZSpin', degrees: 45 },
      { type: 'resetOrientation' },
      { type: 'setStock', stock: { mode: 'fixed', size: { x: 100, y: 100, z: 50 }, modelOffset: { x: 0, y: 0, z: 0 } } },
      { type: 'setWcs', patch: { workOffset: 'G55' } },
      { type: 'setMachineProfile', patch: { maxFeed: 5000 } },
      { type: 'applyMachinePreset', name: 'Hobby GRBL router' },
      { type: 'moveProgram', id: progId1, delta: 1 },
      { type: 'setProgramInTimeline', id: progId2, inTimeline: false },
      { type: 'removeProgram', id: progId2 },
      // Milestone 3 commands (11)
      { type: 'addTool', tool },
      { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'op1' },
      { type: 'updateOperation', id: 'op1', patch: { side: 'inside' } },
      { type: 'addOperation', opType: 'pocket', toolId: 't6', id: 'op2' },
      { type: 'moveOperation', id: 'op2', delta: -1 },
      { type: 'duplicateOperation', id: 'op1', newId: 'op3' },
      { type: 'setOperationEnabled', id: 'op3', enabled: false },
      { type: 'updateTool', id: 't6', patch: { number: 5 } },
      { type: 'removeOperation', id: 'op2' },
      { type: 'setPost', patch: { dialect: 'fanuc' } },
      { type: 'updateOperation', id: 'op1', patch: { toolId: null } },
      { type: 'updateOperation', id: 'op3', patch: { toolId: null } },
      { type: 'removeTool', id: 't6' },
      { type: 'setTolerance', tolerance: 0.005 },
    ];

    // Exhaustiveness guard: ensure all 25 variants are covered
    const covered = {
      renameJob: 1, setDisplayUnits: 1, setImportUnits: 1, rotateQuarter: 1, layFlat: 1, setZSpin: 1,
      resetOrientation: 1, setStock: 1, setWcs: 1, setMachineProfile: 1, applyMachinePreset: 1,
      moveProgram: 1, setProgramInTimeline: 1, removeProgram: 1, addOperation: 1, updateOperation: 1,
      removeOperation: 1, duplicateOperation: 1, moveOperation: 1, setOperationEnabled: 1, addTool: 1,
      updateTool: 1, removeTool: 1, setPost: 1, setTolerance: 1,
    } satisfies Record<JobCommand['type'], 1>;
    const commandTypes = new Set(commands.map((c) => c.type));
    const coveredTypes = Object.keys(covered);
    expect(commandTypes.size).toBe(coveredTypes.length);
    expect(Array.from(commandTypes).sort()).toEqual(coveredTypes.sort());

    // Apply directly and via JSON round-trip, comparing with normalized ids
    const direct = run(setupJob, ...commands);
    const viaJson = run(setupJob, ...(JSON.parse(JSON.stringify(commands)) as JobCommand[]));
    expect({ ...viaJson, id: direct.id }).toEqual(direct);
  });
});

describe('facing and chamfer operations', () => {
  it('adds them with defaults and validates their fields', () => {
    let job = applyCommand(withTool(), { type: 'addOperation', opType: 'face', toolId: 't6', id: 'f' });
    expect(job.operations[0]).toMatchObject({ type: 'face', name: 'Face 1', area: 'stock', pattern: 'zigzag', angleDeg: 0, stepoverPct: 70, oneWay: true, overlap: 3, finishPass: false });
    job = applyCommand(job, { type: 'addOperation', opType: 'chamfer', toolId: 't6', id: 'c' });
    expect(job.operations[1]).toMatchObject({ type: 'chamfer', side: 'auto', openSide: 'left', width: 1, tipOffset: 0.2, stepdown: 0 });
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'f', patch: { stepoverPct: 0 } })).toThrow('stepoverPct must be in (0, 100]');
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'c', patch: { width: 0 } })).toThrow('width must be greater than 0');
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'c', patch: { tipOffset: -1 } })).toThrow('tipOffset must not be negative');
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'f', patch: { side: 'inside' } as never })).toThrow('"side" does not apply to a face operation');
  });
});

describe('operation patch validation', () => {
  const base = () => run(withTool(),
    { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'p' },
    { type: 'addOperation', opType: 'face', toolId: 't6', id: 'f' },
    { type: 'addOperation', opType: 'chamfer', toolId: 't6', id: 'c' });
  const patch = (id: string, p: Record<string, unknown>) => () => applyCommand(base(), { type: 'updateOperation', id, patch: p as never });
  it('rejects enum values that do not belong to the operation type', () => {
    expect(patch('p', { side: 'auto' })).toThrow('side must be one of outside, inside, on');
    expect(patch('c', { openSide: 'on' })).toThrow('openSide must be one of left, right');
    expect(patch('c', { side: 'on' })).toThrow('side must be one of auto, outside, inside');
    expect(patch('f', { pattern: 'x' })).toThrow('pattern must be one of zigzag, spiral');
    expect(patch('f', { area: 'x' })).toThrow('area must be one of stock, picked');
    expect(patch('f', { direction: 'x' })).toThrow('direction must be one of climb, conventional');
    expect(() => patch('p', { side: 'on', openSide: 'on' })()).not.toThrow();
  });
  it('validates numbers', () => {
    expect(() => patch('c', { stepdown: 0 })()).not.toThrow();
    expect(patch('c', { stepdown: -1 })).toThrow('stepdown must not be negative');
    expect(patch('f', { finishStepoverPct: 0 })).toThrow('finishStepoverPct must be in (0, 100]');
    expect(patch('f', { angleDeg: NaN })).toThrow('angleDeg must be a finite number');
    expect(patch('c', { width: Infinity })).toThrow('width must be greater than 0');
    expect(patch('f', { overlap: Infinity })).toThrow('overlap must not be negative');
    expect(patch('c', { tipOffset: Infinity })).toThrow('tipOffset must not be negative');
    expect(patch('f', { stepdown: Infinity })).toThrow('stepdown must be greater than 0');
  });
});
