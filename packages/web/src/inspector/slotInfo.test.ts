import {
  applyCommands, camContext, type CamGeometry, createJob, describeGeometry, importFile, type Path2D, setModel, setStock, type SlotOp,
} from '@sponcam/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tool6 } from '../../../core/test/fixtures/camSetup';
import { drawingSlotJob } from '../../../core/test/fixtures/slotSetup';
import { slotInfo, slotView } from './slotInfo';

const line: Path2D = { closed: false, segments: [{ kind: 'line', from: { x: 10, y: 10 }, to: { x: 60, y: 10 } }] };
const drawn = (patch: Record<string, unknown>) => {
  const { job, cam } = drawingSlotJob([line], patch);
  return { op: job.operations[0] as SlotOp, cam };
};

describe('slotInfo', () => {
  it('explains Auto picking Wider', () => {
    const { op, cam } = drawn({ width: 10 });
    expect(slotInfo(op, cam, tool6)).toEqual({ drawn: true, squareEnds: false, auto: ['Auto → Wider (width 10 > tool 6)'], trochoidalLayers: null });
  });
  it('explains Auto picking Tool-width', () => {
    const { op, cam } = drawn({ width: 6 });
    expect(slotInfo(op, cam, tool6).auto).toEqual(['Auto → Tool-width (width 6 = tool 6)']);
  });
  it('counts trochoidal layers by the flute length', () => {
    const { op, cam } = drawn({ width: 10, strategy: 'trochoidal', heights: { bottom: { from: 'origin', offset: -30 } } });
    const i = slotInfo(op, cam, tool6);
    expect(i.trochoidalLayers).toBe(2);
    expect(i.auto).toEqual([]);
  });
  it('shows nothing without a tool', () => {
    const { op, cam } = drawn({ width: 10 });
    expect(slotInfo(op, cam, null)).toMatchObject({ auto: [], trochoidalLayers: null });
  });
  it('knows a recognised slot with a square end', () => {
    const r = importFile('slot-plate.stl', readFileSync(new URL('../../../core/test/fixtures/slot-plate.stl', import.meta.url)));
    if (!r.ok || r.kind !== 'mesh') throw new Error('fixture did not import');
    const geometry: CamGeometry = { kind: 'mesh', mesh: r.mesh, adjacency: r.adjacency, rawPoints: r.mesh.positions };
    const base = setStock(setModel(createJob(), { sourceName: 'slot-plate.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 } });
    const slots = describeGeometry(base, geometry).slots;
    const square = slots.find((s) => s.ends.includes('square'))!;
    const round = slots.find((s) => !s.ends.includes('square'))!;
    const withRef = (ref: typeof square.ref) =>
      applyCommands(base, [
        { type: 'addTool', tool: tool6 },
        { type: 'addOperation', opType: 'slot', toolId: 't6', id: 's' },
        { type: 'updateOperation', id: 's', patch: { geometry: [ref] } },
      ]);
    const job = withRef(square.ref);
    expect(slotInfo(job.operations[0] as SlotOp, camContext(job, geometry), tool6)).toMatchObject({ squareEnds: true, drawn: false });
    const j2 = withRef(round.ref);
    expect(slotInfo(j2.operations[0] as SlotOp, camContext(j2, geometry), tool6).squareEnds).toBe(false);
  });
});

describe('slotFields', () => {
  const view = (patch: Record<string, unknown>, tool: typeof tool6 | null = tool6) => {
    const { op, cam } = drawn(patch);
    return slotView(op, cam, tool);
  };
  it('tool-width hides stepover, direction and radial stock, but not stepdown', () => {
    expect(view({ width: 6, strategy: 'toolWidth' }).fields).toEqual({
      width: true, stepdown: true, stepover: false, step: false, direction: false, layers: false, radialStock: false, finishWalls: false, squareEnds: false,
    });
  });
  it('wider shows stepover, direction, radial stock and finish walls', () => {
    expect(view({ width: 10, strategy: 'wider' }).fields).toMatchObject({ stepdown: true, stepover: true, step: false, direction: true, layers: false, radialStock: true, finishWalls: true });
  });
  it('trochoidal hides stepdown, shows step, direction and layers', () => {
    const { fields } = view({ width: 10, strategy: 'trochoidal', heights: { bottom: { from: 'origin', offset: -30 } } });
    expect(fields).toMatchObject({ stepdown: false, stepover: false, step: true, direction: true, layers: true, radialStock: true, finishWalls: true });
  });
  it('auto follows what each slot resolves to', () => {
    expect(view({ width: 10 }).fields).toMatchObject({ stepover: true, direction: true, radialStock: true });
    expect(view({ width: 6 }).fields).toMatchObject({ stepover: false, direction: false, radialStock: false, finishWalls: false, stepdown: true });
  });
  it('auto without a tool shows no strategy-specific fields', () => {
    const { fields, active } = view({ width: 10 }, null);
    expect(active.size).toBe(0);
    expect(fields).toMatchObject({ stepover: false, step: false, direction: false, radialStock: true, finishWalls: true });
  });
  it('mixed slots on the plate (6.5 mm tool: obround is tool-width, keyway is wider) give the union', () => {
    const r = importFile('slot-plate.stl', readFileSync(new URL('../../../core/test/fixtures/slot-plate.stl', import.meta.url)));
    if (!r.ok || r.kind !== 'mesh') throw new Error('fixture did not import');
    const geometry: CamGeometry = { kind: 'mesh', mesh: r.mesh, adjacency: r.adjacency, rawPoints: r.mesh.positions };
    const base = setStock(setModel(createJob(), { sourceName: 'slot-plate.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 } });
    const refs = describeGeometry(base, geometry).slots.map((s) => s.ref);
    const tool = { ...tool6, id: 't65', diameter: 6.5 };
    const job = applyCommands(base, [
      { type: 'addTool', tool },
      { type: 'addOperation', opType: 'slot', toolId: 't65', id: 's' },
      { type: 'updateOperation', id: 's', patch: { geometry: refs } },
    ]);
    const v = slotView(job.operations[0] as SlotOp, camContext(job, geometry), tool);
    expect([...v.active].sort()).toEqual(['toolWidth', 'wider']);
    expect(v.info.auto).toHaveLength(2);
    expect(v.fields).toMatchObject({ stepover: true, direction: true, radialStock: true, squareEnds: true });
  });
});
