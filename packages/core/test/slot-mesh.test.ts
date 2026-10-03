import { describe, expect, it } from 'vitest';
import { applyCommands, camContext, meshSlots, PipelineCache, programContext, resolveGeometry, runPipeline, type JobCommand, type Toolpath } from '../src';
import { tool6 } from './fixtures/camSetup';
import { terracedSetup } from './fixtures/slotSetup';
import { obroundPts, rectPts } from './fixtures/terraced.mjs';

const plate = rectPts(0, 0, 100, 60);

describe('open slots', () => {
  it('finds a dado open at both ends', () => {
    const { catalog } = terracedSetup(plate, 10, [{ poly: rectPts(40, -1, 52, 61), z: 6 }]);
    const [s] = catalog().slots;
    expect(s).toMatchObject({ kind: 'line', ends: ['open', 'open'], through: false });
    expect(s.width).toBeCloseTo(12, 6);
    expect(s.length).toBeCloseTo(60, 6);
    expect(s.top - s.bottom).toBeCloseTo(4, 6);
    expect(s.ref.loop).toBeUndefined();
  });

  it('finds a groove open at one end and round at the other', () => {
    const groove: [number, number][] = [
      [-1, 25], [30, 25],
      ...Array.from({ length: 31 }, (_, i): [number, number] => [30 + 5 * Math.cos(-Math.PI / 2 + (Math.PI * i) / 30), 30 + 5 * Math.sin(-Math.PI / 2 + (Math.PI * i) / 30)]),
      [-1, 35],
    ];
    expect(terracedSetup(plate, 10, [{ poly: groove, z: 6 }]).catalog().slots[0]).toMatchObject({ ends: ['open', 'round'] });
  });

  it('skips a rebate (a wall on one side only)', () => {
    expect(terracedSetup(plate, 10, [{ poly: rectPts(90, -1, 101, 61), z: 6 }]).catalog().slots).toEqual([]);
  });
});

describe('cutting recognised slots', () => {
  function cut(cuts: Parameters<typeof terracedSetup>[2], patch: Record<string, unknown> = {}, top = 10) {
    const s = terracedSetup(rectPts(0, 0, 100, 60), top, cuts);
    const slot = s.catalog().slots[0];
    const cmds: JobCommand[] = [
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'slot', toolId: 't6', id: 's' },
      { type: 'updateOperation', id: 's', patch: { geometry: [slot.ref], stepdown: 2, ...patch } as never },
    ];
    const job = applyCommands(s.job, cmds);
    const { run, toolpaths } = runPipeline(job, s.geometry as never, programContext(job, s.geometry as never), new PipelineCache(), { date: '2026-01-01' });
    return { slot, s, job, diagnostics: run.results[0].diagnostics, tp: toolpaths[0] as Toolpath | undefined };
  }

  it('cuts a blind obround slot to its floor, cleanly (gouge check included)', () => {
    const { slot, diagnostics, tp } = cut([{ poly: obroundPts(30, 50, 30, 10), z: 6 }]);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(Math.min(...tp!.moves.flatMap((m) => (m.kind === 'cycle' ? [] : [m.to.z])))).toBeCloseTo(slot.bottom, 6);
  });

  it('cuts a slot in a lower step from its own floor (review focus 5)', () => {
    // a 10 mm plate stepped down to 6 mm on the right, with a slot 3 mm deep in the step
    const { slot, diagnostics, tp } = cut([{ poly: rectPts(50, -1, 101, 61), z: 6 }, { poly: obroundPts(65, 85, 30, 10), z: 3 }]);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(slot.top - slot.bottom).toBeCloseTo(3, 6);
    expect(Math.min(...tp!.moves.flatMap((m) => (m.kind === 'cycle' ? [] : [m.to.z])))).toBeCloseTo(slot.bottom, 6);
  });

  it('reports a slot reference that no longer is one', () => {
    const { s, job } = cut([{ poly: obroundPts(30, 50, 30, 10), z: 6 }]);
    const op = job.operations[0];
    const broken = { ...op, geometry: [{ ...(op.geometry[0] as object), loop: 0 }] } as typeof op;
    expect(resolveGeometry(broken, camContext(job, s.geometry)).diagnostics.map((d) => d.message)).toContain('The picked slot is no longer a slot');
  });

  it('caches the slots of a context', () => {
    const { s } = cut([{ poly: obroundPts(30, 50, 30, 10), z: 6 }]);
    const ctx = camContext(s.job, s.geometry);
    expect(meshSlots(ctx)).toBe(meshSlots(ctx));
    expect(meshSlots(ctx)).toHaveLength(1);
  });
});
