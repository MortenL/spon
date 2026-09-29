import { addProgram, createJob, type ProgramRef } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { allPrograms, findProgram } from './programList';

const gen: ProgramRef = { id: 'gen:a.nc', name: 'a.nc', blobId: 'gen:a.nc', inTimeline: true, source: 'generated', operationIds: ['o1'] };

describe('allPrograms', () => {
  it('puts generated programs first and keeps a stable identity for unchanged inputs', () => {
    const job = addProgram(createJob(), { name: 'x.nc', blobId: 'p1' });
    const s = { job, generatedPrograms: [gen] };
    const a = allPrograms(s);
    expect(a.map((p) => p.id)).toEqual(['gen:a.nc', job.programs[0].id]);
    expect(allPrograms({ ...s })).toBe(a);
    expect(allPrograms({ job, generatedPrograms: [] })).not.toBe(a);
    expect(findProgram(s, 'gen:a.nc')).toBe(gen);
    expect(findProgram(s, 'nope')).toBeNull();
  });
});
