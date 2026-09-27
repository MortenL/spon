import { addProgram, createJob, setModel } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import { isProgramFile, referencedBlobIds } from './programs';

describe('isProgramFile', () => {
  it('accepts the spec extensions case-insensitively', () => {
    for (const name of ['a.nc', 'b.NGC', 'c.gcode', 'd.tap', 'e.cnc']) expect(isProgramFile(name)).toBe(true);
    for (const name of ['a.stl', 'b.spon', 'nc', 'x.txt']) expect(isProgramFile(name)).toBe(false);
  });
});

describe('referencedBlobIds', () => {
  it('collects blobs from the job and the undo/redo stacks without duplicates', () => {
    const base = setModel(createJob(), { sourceName: 'm.stl', blobId: 'm', kind: 'mesh', importUnits: 'mm' });
    const withP1 = addProgram(base, { name: 'a.nc', blobId: 'p1' });
    const withP2 = addProgram(withP1, { name: 'b.nc', blobId: 'p2' });
    expect(referencedBlobIds(withP1, [base], [withP2]).sort()).toEqual(['m', 'p1', 'p2']);
  });
});
