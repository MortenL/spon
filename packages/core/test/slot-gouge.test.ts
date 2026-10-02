import { describe, expect, it } from 'vitest';
import { applyCommands, type JobCommand, PipelineCache, programContext, runPipeline } from '../src';
import { tool6 } from './fixtures/camSetup';
import { terracedSetup } from './fixtures/slotSetup';
import { rectPts } from './fixtures/terraced.mjs';

function keyway(patch: Record<string, unknown>, o: { width?: number; top?: number; floor?: number; x0?: number } = {}) {
  const { width = 10, top = 10, floor = 7, x0 = 20 } = o;
  const s = terracedSetup(rectPts(0, 0, 100, 60), top, [{ poly: rectPts(x0, 30 - width / 2, 60, 30 + width / 2), z: floor }]);
  const slot = s.catalog().slots[0];
  const cmds: JobCommand[] = [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'slot', toolId: 't6', id: 's' },
    { type: 'updateOperation', id: 's', patch: { geometry: [slot.ref], stepdown: 3, ...patch } as never },
  ];
  const job = applyCommands(s.job, cmds);
  const { run, toolpaths } = runPipeline(job, s.geometry as never, programContext(job, s.geometry as never), new PipelineCache(), { date: '2026-01-01' });
  return { ...run.results[0], toolpath: toolpaths[0] ?? null };
}
const codes = (r: ReturnType<typeof keyway>) => r.diagnostics.map((d) => `${d.severity}:${d.code}`);

describe('square slot ends against the model', () => {
  it('inside: no gouge, the corner warning only', () => {
    const r = keyway({ squareEnds: 'inside' });
    expect(codes(r)).toContain('warning:unmachined-area');
    expect(codes(r).filter((c) => c.startsWith('error'))).toEqual([]);
  });

  it('endWall and dogbone: warnings, not gouges, and the toolpath exports', () => {
    for (const squareEnds of ['endWall', 'dogbone']) {
      const r = keyway({ squareEnds });
      expect(codes(r)).toContain('warning:slot-overcut');
      expect(codes(r)).not.toContain('error:gouge');
      expect(r.toolpath).not.toBeNull();
      expect(r.diagnostics.filter((d) => d.code === 'slot-overcut')).toHaveLength(2); // once per end
    }
  });

  it('still reports a real gouge elsewhere', () => {
    const r = keyway({ squareEnds: 'endWall', heights: { bottom: { from: 'slotBottom', offset: -2 } } });
    expect(codes(r)).toContain('error:gouge');
  });

  it('exports endWall with finish walls and no error', () => {
    const r = keyway({ squareEnds: 'endWall', finishWalls: true });
    expect(codes(r).filter((c) => c.startsWith('error'))).toEqual([]);
    expect(r.toolpath).not.toBeNull();
  });

  it('does not excuse a floor gouge inside an end zone (zones stop above the slot floor)', () => {
    const r = keyway({ squareEnds: 'endWall', heights: { bottom: { from: 'slotBottom', offset: -2 } }, strategy: 'trochoidal' });
    expect(codes(r)).toContain('error:gouge');
  });

  it('multi-layer endWall slots export with no error (lifts retreat from the wall first)', () => {
    for (const strategy of ['wider', 'toolWidth'])
      for (const stepdown of [1, 2]) {
        const r = keyway({ squareEnds: 'endWall', stepdown, strategy }, strategy === 'toolWidth' ? { width: 6 } : {});
        expect(codes(r).filter((c) => c.startsWith('error')), `${strategy} stepdown ${stepdown}`).toEqual([]);
        expect(r.toolpath).not.toBeNull();
      }
    const r = keyway({ squareEnds: 'dogbone', stepdown: 1 });
    expect(codes(r).filter((c) => c.startsWith('error'))).toEqual([]);
    const i = keyway({ squareEnds: 'inside', stepdown: 1 });
    expect(codes(i).filter((c) => c.startsWith('error'))).toEqual([]);
  });

  it('a deep trochoidal endWall slot (two layers) exports with no error', () => {
    for (const squareEnds of ['endWall', 'dogbone']) {
      const r = keyway({ squareEnds, strategy: 'trochoidal', heights: { bottom: { from: 'slotBottom', offset: 0 } } }, { top: 30, floor: 2 });
      expect(codes(r).filter((c) => c.startsWith('error')), squareEnds).toEqual([]);
      expect(r.toolpath).not.toBeNull();
    }
  });
});

describe('slots exactly as wide as the tool', () => {
  it('a 6.000 keyway exports with the 6 mm tool (inside and endWall)', () => {
    for (const squareEnds of ['inside', 'endWall']) {
      const r = keyway({ squareEnds, stepdown: 1 }, { width: 6 });
      expect(codes(r).filter((c) => c.startsWith('error')), squareEnds).toEqual([]);
    }
  });

  it('a 6.000 open dado exports with the 6 mm tool', () => {
    const s = terracedSetup(rectPts(0, 0, 100, 60), 10, [{ poly: rectPts(-5, 27, 105, 33), z: 7 }]);
    const slot = s.catalog().slots[0];
    const job = applyCommands(s.job, [
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'slot', toolId: 't6', id: 's' },
      { type: 'updateOperation', id: 's', patch: { geometry: [slot.ref], stepdown: 3 } as never },
    ]);
    const { run } = runPipeline(job, s.geometry as never, programContext(job, s.geometry as never), new PipelineCache(), { date: '2026-01-01' });
    expect(run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('still flags a real overcut into a wall (floor 2 mm below the slot bottom)', () => {
    const r = keyway({ squareEnds: 'inside', heights: { bottom: { from: 'slotBottom', offset: -2 } } }, { width: 6 });
    expect(codes(r)).toContain('error:gouge');
  });

  it('flags a side overcut larger than the tolerance (tool 0.2 mm wider than the slot)', () => {
    const r = keyway({ squareEnds: 'inside' }, { width: 5.8 });
    expect(codes(r).some((c) => c.startsWith('error'))).toBe(true);
  });
});
