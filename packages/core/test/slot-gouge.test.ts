import { describe, expect, it } from 'vitest';
import { applyCommands, type JobCommand, PipelineCache, programContext, runPipeline } from '../src';
import { tool6 } from './fixtures/camSetup';
import { terracedSetup } from './fixtures/slotSetup';
import { rectPts } from './fixtures/terraced.mjs';

function keyway(patch: Record<string, unknown>) {
  const s = terracedSetup(rectPts(0, 0, 100, 60), 10, [{ poly: rectPts(20, 25, 60, 35), z: 7 }]);
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
});
