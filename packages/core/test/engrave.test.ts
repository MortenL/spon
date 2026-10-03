import { describe, expect, it } from 'vitest';
import { applyCommands, type Move, engraveDepth, newOperation, pathFromPoints, pathStart, PipelineCache, programContext, runPipeline, type EngraveOp, type JobCommand, type Tool, type Toolpath } from '../src';
import { tool6 } from './fixtures/camSetup';
import { terracedSetup } from './fixtures/slotSetup';
import { rectPts } from './fixtures/terraced.mjs';
import { drawingJob } from './fixtures/vcarveSetup';

const vbit60: Tool = { ...tool6, id: 'v60', number: 7, type: 'vbit', tipAngleDeg: 60, cornerRadius: 0, fluteLength: 10 };
const line = pathFromPoints([{ x: 0, y: 0 }, { x: 30, y: 0 }], false);
const square = pathFromPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], true);
type Feed = Exclude<Move, { kind: 'cycle' }>;
const feedMoves = (moves: Move[]): Feed[] => moves.filter((m): m is Feed => m.kind !== 'cycle');
const errors = (d: { severity: string; message: string }[]) => d.filter((x) => x.severity === 'error').map((x) => x.message);

describe('engrave', () => {
  it('turns a V-bit line width into a depth', () => {
    const op = { ...(newOperation('engrave', { id: 'e', name: 'E', tool: vbit60, modelKind: 'drawing' }) as EngraveOp), depthMode: 'width' as const, lineWidth: 0.6 };
    expect((engraveDepth(op, vbit60) as { depth: number }).depth).toBeCloseTo(0.3 / Math.tan(Math.PI / 6), 9);
    expect(engraveDepth(op, tool6)).toEqual({ error: 'Line width needs a V-bit; set a depth' });
  });

  it('cuts an open line back and forth per level without retracting', () => {
    const { tp, diagnostics, program } = drawingJob([line], 'engrave', { depthMode: 'depth', depth: 1, stepdown: 0.5 }, vbit60);
    expect(errors(diagnostics)).toEqual([]);
    const o = pathStart(program(0)); // the drawing sits at its program offset
    const cuts = feedMoves(tp!.moves).filter((m) => m.kind === 'line' && Math.abs(m.to.y - o.y) < 1e-9 && m.to.z < 0);
    expect(Math.min(...feedMoves(tp!.moves).map((m) => m.to.z))).toBeCloseTo(-1, 9);
    const firstFeed = tp!.moves.findIndex((m) => m.kind !== 'rapid');
    const lastFeed = tp!.moves.length - 1 - [...tp!.moves].reverse().findIndex((m) => m.kind !== 'rapid');
    expect(tp!.moves.slice(firstFeed, lastFeed).filter((m) => m.kind === 'rapid')).toEqual([]);
    expect(cuts.length).toBeGreaterThanOrEqual(2);
  });

  it('cuts a closed outline as full loops at each level, tool centre on the line', () => {
    const { tp, program } = drawingJob([square], 'engrave', { depthMode: 'depth', depth: 0.4, stepdown: 0.2 }, vbit60);
    const o = pathStart(program(0));
    const xy = feedMoves(tp!.moves).filter((m) => m.kind !== 'rapid' && m.to.z < -1e-6).map((m) => ({ x: m.to.x - o.x, y: m.to.y - o.y, z: m.to.z }));
    for (const p of xy) expect(Math.min(Math.abs(p.x), Math.abs(p.x - 10), Math.abs(p.y), Math.abs(p.y - 10))).toBeLessThan(1e-6);
    expect(new Set(xy.map((p) => p.z.toFixed(3)))).toEqual(new Set(['-0.200', '-0.400']));
  });

  it('refuses tools that cannot engrave, and width mode without a V-bit', () => {
    const drill: Tool = { ...tool6, id: 'd5', number: 8, type: 'drill', tipAngleDeg: 118 };
    expect(errors(drawingJob([line], 'engrave', {}, drill).diagnostics)).toContain('Engraving needs a V-bit, ball, flat or bull-nose tool');
    expect(errors(drawingJob([line], 'engrave', { depthMode: 'width' }, tool6).diagnostics)).toContain('Line width needs a V-bit; set a depth');
  });

  it('engraves the loops of a model face, outer and inner, from the face top', () => {
    const s = terracedSetup(rectPts(0, 0, 100, 60), 10, [{ poly: rectPts(40, 25, 60, 35), z: 7 }]);
    const top = s.catalog().faces[0];
    expect(top.z).toBeCloseTo(0, 6);
    expect(top.loops.length).toBe(2);
    const cmds: JobCommand[] = [
      { type: 'addTool', tool: vbit60 },
      { type: 'addOperation', opType: 'engrave', toolId: 'v60', id: 'e' },
      { type: 'updateOperation', id: 'e', patch: { geometry: [top.ref], depthMode: 'depth', depth: 0.3, stepdown: 0.3, heights: { top: { from: 'face', offset: 0, face: top.ref } } } as never },
    ];
    const job = applyCommands(s.job, cmds);
    const { run, toolpaths } = runPipeline(job, s.geometry as never, programContext(job, s.geometry as never), new PipelineCache(), { date: '2026-01-01' });
    expect(errors(run.results[0].diagnostics)).toEqual([]);
    const tp = toolpaths[0] as Toolpath;
    const zs = tp.moves.flatMap((m) => (m.kind === 'cycle' ? [] : [m.to.z]));
    expect(Math.min(...zs)).toBeCloseTo(-0.3, 6);
  });
});
