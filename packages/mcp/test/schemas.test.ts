import type { GeometryRef, JobCommand, OperationPatch, Tool } from '@sponcam/core';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { geometryRefSchema, jobCommandSchema, operationPatchSchema, toolSchema } from '../src/schemas';
import { tool6 } from './helpers';

// compile-time: each schema's type and the core type are assignable both ways
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const same = <T extends true>(): T | undefined => undefined;
same<Same<z.infer<typeof jobCommandSchema>, JobCommand>>();
same<Same<z.infer<typeof operationPatchSchema>, OperationPatch>>();
// an optional key missing from the schema passes the check above, so compare the key sets as well
same<Same<keyof z.infer<typeof operationPatchSchema>, keyof OperationPatch>>();
same<Same<z.infer<typeof toolSchema>, Tool>>();
same<Same<z.infer<typeof geometryRefSchema>, GeometryRef>>();

const face = { kind: 'meshFace' as const, blobId: 'm', seed: 3, normal: { x: 0, y: 0, z: 1 }, point: { x: 1, y: 2, z: 3 } };
const SAMPLES: JobCommand[] = [
  { type: 'renameJob', name: 'Part' },
  { type: 'setDisplayUnits', unit: 'in' },
  { type: 'setImportUnits', unit: 'mm' },
  { type: 'rotateQuarter', axis: 'x', direction: -1 },
  { type: 'layFlat', rawNormal: { x: 0, y: 1, z: 0 } },
  { type: 'setZSpin', degrees: 90 },
  { type: 'resetOrientation' },
  { type: 'setStock', stock: { mode: 'fixed', size: { x: 100, y: 50, z: 10 }, modelOffset: { x: 5, y: 5, z: 0 } } },
  { type: 'setWcs', patch: { anchor: { x: 'min', y: 'center', z: 'top' }, workOffset: 'G55' } },
  { type: 'setMachineProfile', patch: { rapid: { x: 5000 }, maxFeed: 3000 } },
  { type: 'applyMachinePreset', name: 'Generic VMC' },
  { type: 'moveProgram', id: 'p', delta: 1 },
  { type: 'setProgramInTimeline', id: 'p', inTimeline: false },
  { type: 'removeProgram', id: 'p' },
  { type: 'updateOperation', id: 'p', patch: { openSide: 'left', geometry: [{ kind: 'dxfPath', blobId: 'b', layer: 0, path: 1, reverse: true }] } },
  { type: 'addOperation', opType: 'pocket', toolId: null, id: 'o', name: 'Pocket A' },
  {
    type: 'updateOperation', id: 'o',
    patch: {
      geometry: [face, { kind: 'meshLoop', face, loop: 1 }], heights: { bottom: { from: 'face', offset: -0.5, face } }, stepoverPct: 40,
      tabs: { enabled: true, positions: [{ refIndex: 0, t: 0.25 }] }, leads: { startPoint: 'auto' }, diameterFilter: null,
    },
  },
  { type: 'updateOperation', id: 'o', patch: { geometry: [{ kind: 'meshSlot', face }, { kind: 'meshSlot', face, loop: 2 }], strategy: 'toolWidth', trochoidal: { stepPct: 12 }, squareEnds: 'dogbone', heights: { bottom: { from: 'slotBottom', offset: 0 } } } },
  { type: 'updateOperation', id: 'o', patch: { maxDepth: null, depthMode: 'width', lineWidth: 0.4, sourceId: 'op1', stepdown: null } },
  { type: 'removeOperation', id: 'o' },
  { type: 'duplicateOperation', id: 'o', newId: 'o2' },
  { type: 'moveOperation', id: 'o', delta: -1 },
  { type: 'setOperationEnabled', id: 'o', enabled: false },
  { type: 'addTool', tool: tool6 },
  { type: 'updateTool', id: 't6', patch: { number: 4, presets: [] } },
  { type: 'removeTool', id: 't6' },
  { type: 'setPost', patch: { dialect: 'linuxcnc', arcFormat: 'r', lineNumbers: true } },
  { type: 'setTolerance', tolerance: 0.01 },
];

describe('jobCommandSchema', () => {
  it('covers every command type', () => {
    expect(new Set(SAMPLES.map((c) => c.type)).size).toBe(25);
  });

  it('accepts every command unchanged', () => {
    for (const c of SAMPLES) expect(jobCommandSchema.parse(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });

  it('rejects unknown commands and unknown operation parameters', () => {
    expect(jobCommandSchema.safeParse({ type: 'explode' }).success).toBe(false);
    const bad = jobCommandSchema.safeParse({ type: 'updateOperation', id: 'o', patch: { stepovr: 40 } });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain('stepovr');
  });

  it('rejects typos in nested objects and inside commands, naming the key', () => {
    const nested = jobCommandSchema.safeParse({ type: 'updateOperation', id: 'o', patch: { tabs: { enable: true } } });
    expect(nested.success).toBe(false);
    expect(JSON.stringify(nested.error?.issues)).toContain('enable');
    const top = jobCommandSchema.safeParse({ type: 'setPost', patch: { lineNumber: true } });
    expect(top.success).toBe(false);
    expect(JSON.stringify(top.error?.issues)).toContain('lineNumber');
    const extra = jobCommandSchema.safeParse({ type: 'removeTool', id: 't', idd: 'x' });
    expect(extra.success).toBe(false);
    expect(JSON.stringify(extra.error?.issues)).toContain('idd');
    const tool = jobCommandSchema.safeParse({ type: 'updateTool', id: 't', patch: { diameterr: 3 } });
    expect(tool.success).toBe(false);
    const axis = jobCommandSchema.safeParse({ type: 'setMachineProfile', patch: { rapid: { xx: 1 } } });
    expect(axis.success).toBe(false);
  });
});
