import { applyCommands, createJob, type Job, type Tool, type VClearOp } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { tool6 } from '../../../core/test/fixtures/camSetup';
import { addClearingCommands, clearingFor, defaultClearingTool } from './vcarveInfo';

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
});
