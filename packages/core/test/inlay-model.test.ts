import { describe, expect, it } from 'vitest';
import { applyCommand, applyCommands, createJob, CURRENT_SCHEMA_VERSION, migrateJob } from '../src';
import { tool6 } from './fixtures/camSetup';

const vbit = { ...tool6, id: 'v60', number: 7, type: 'vbit' as const, tipAngleDeg: 60, cornerRadius: 0 };
const withV = () => applyCommand(createJob(), { type: 'addTool', tool: vbit });

describe('inlay job model', () => {
  it('is schema 7 and migrates schema 6 jobs unchanged', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(7);
    const v6 = { ...createJob(), schemaVersion: 6 };
    expect(migrateJob(v6)).toEqual({ ...v6, schemaVersion: 7 });
  });

  it('adds a V-carve plug with defaults and validates it', () => {
    let job = applyCommand(withV(), { type: 'addOperation', opType: 'vplug', toolId: 'v60', id: 'p' });
    expect(job.operations[0]).toMatchObject({ type: 'vplug', name: 'V-carve plug 1', inlayDepth: 4, startDepth: 2, glueGap: 0.5, stepdown: null });
    job = applyCommand(job, { type: 'updateOperation', id: 'p', patch: { inlayDepth: 5, startDepth: 1.5, glueGap: 0.2, stepdown: 1 } });
    expect(job.operations[0]).toMatchObject({ inlayDepth: 5, startDepth: 1.5, glueGap: 0.2, stepdown: 1 });
    for (const [k, v] of [['inlayDepth', 0], ['startDepth', -1], ['glueGap', 0]] as const) {
      expect(() => applyCommand(job, { type: 'updateOperation', id: 'p', patch: { [k]: v } as never })).toThrow(`${k} must be greater than 0`);
    }
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'p', patch: { stepdown: 0 } })).toThrow('stepdown must be greater than 0');
    job = applyCommand(job, { type: 'updateOperation', id: 'p', patch: { stepdown: null } });
    expect(job.operations[0]).toMatchObject({ stepdown: null });
  });

  it('stores inlay settings on a V-carve and validates them', () => {
    let job = applyCommands(withV(), [{ type: 'addOperation', opType: 'vcarve', toolId: 'v60', id: 'v' }]);
    const inlay = { startDepth: 2, glueGap: 0.5, margin: 10, plugBoard: { x: 120, y: 60, z: 8 }, plugFileName: 'Sign plug.spon' };
    job = applyCommand(job, { type: 'updateOperation', id: 'v', patch: { inlay } });
    expect((job.operations[0] as { inlay?: unknown }).inlay).toEqual(inlay);
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'v', patch: { inlay: { ...inlay, margin: -1 } } })).toThrow('inlay.margin must be 0 or more');
    expect(() => applyCommand(job, { type: 'updateOperation', id: 'v', patch: { inlay: { ...inlay, plugBoard: { x: 0, y: 60, z: 8 } } } })).toThrow('inlay.plugBoard must be greater than 0');
    job = applyCommand(job, { type: 'updateOperation', id: 'v', patch: { inlay: undefined } as never });
    expect('inlay' in job.operations[0]).toBe(false);
  });
});
