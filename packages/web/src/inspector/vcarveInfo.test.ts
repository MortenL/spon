import { applyCommands, createJob, type Job, type Tool, type VClearOp } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { tool6 } from '../../../core/test/fixtures/camSetup';
import { addClearingBatch, addClearingCommands, clearingFor, defaultClearingTool, engraveModeUi } from './vcarveInfo';

const base = (): Job => applyCommands(createJob(), [
  { type: 'addOperation', opType: 'engrave', toolId: null, id: 'a' },
  { type: 'addOperation', opType: 'vcarve', toolId: null, id: 'v' },
  { type: 'addOperation', opType: 'engrave', toolId: null, id: 'b' },
]);

describe('vcarveInfo', () => {
  it('places a linked clearing directly before its V-carve', () => {
    const job = applyCommands(base(), addClearingCommands(base(), 'v', null, 'c'));
    expect(job.operations.map((o) => o.id)).toEqual(['a', 'c', 'v', 'b']);
    expect((job.operations[1] as VClearOp).sourceId).toBe('v');
  });

  it('finds the clearing and ignores disabled ones', () => {
    const job = applyCommands(base(), addClearingCommands(base(), 'v', null, 'c'));
    expect(clearingFor(job, 'v')?.id).toBe('c');
    expect(clearingFor(job, 'a')).toBeNull();
    const off = applyCommands(job, [{ type: 'setOperationEnabled', id: 'c', enabled: false }]);
    expect(clearingFor(off, 'v')).toBeNull();
  });

  it('prefers job tools over library tools', () => {
    const lib: Tool = { ...tool6, id: 'lib' };
    const jobTool: Tool = { ...tool6, id: 'job' };
    const vbit: Tool = { ...tool6, id: 'vb', type: 'vbit' };
    expect(defaultClearingTool({ ...createJob(), tools: [vbit, jobTool] }, [lib])?.id).toBe('job');
    expect(defaultClearingTool({ ...createJob(), tools: [vbit] }, [vbit, lib])?.id).toBe('lib');
    expect(defaultClearingTool(createJob(), [vbit])).toBeNull();
  });

  it('adds no moves for a missing source, but still patches sourceId', () => {
    const cmds = addClearingCommands(base(), 'gone', null, 'c');
    expect(cmds.filter((c) => c.type === 'moveOperation')).toHaveLength(0);
    expect(cmds[1]).toEqual({ type: 'updateOperation', id: 'c', patch: { sourceId: 'gone' } });
  });

  it('adds the library tool first only when the job lacks it', () => {
    const lib: Tool = { ...tool6, id: 'lib' };
    expect(addClearingBatch(base(), [lib], 'v', 'c')[0].type).toBe('addTool');
    const withTool = { ...base(), tools: [lib] };
    const cmds = addClearingBatch(withTool, [lib], 'v', 'c');
    expect(cmds.some((c) => c.type === 'addTool')).toBe(false);
    expect(cmds[0]).toMatchObject({ type: 'addOperation', toolId: 'lib' });
  });

  it('engraveModeUi: V-bit + width shows width, allowed', () => {
    expect(engraveModeUi({ depthMode: 'width' }, { ...tool6, type: 'vbit' })).toEqual({ widthAllowed: true, showWidth: true });
  });
  it('engraveModeUi: flat + width shows width, not allowed', () => {
    expect(engraveModeUi({ depthMode: 'width' }, tool6)).toEqual({ widthAllowed: false, showWidth: true });
  });
  it('engraveModeUi: flat + depth shows depth, width not allowed', () => {
    expect(engraveModeUi({ depthMode: 'depth' }, tool6)).toEqual({ widthAllowed: false, showWidth: false });
  });
});
