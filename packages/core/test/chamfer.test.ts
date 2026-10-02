import { describe, expect, it } from 'vitest';
import {
  applyCommands, camContext, chamferGeometry, circleOf, createJob, drawingPathToProgram, flattenPath, type JobCommand, type Move, nearestS, type Path2D, pathFromPoints,
  PipelineCache, programContext, runPipeline, setModel, setStock, type Tool, type Toolpath,
} from '../src';
import type { CamGeometry } from '../src';
import { tool6 } from './fixtures/camSetup';

const v90 = { ...tool6, id: 'v90', name: '90 deg chamfer', number: 7, type: 'chamfer' as const, diameter: 12, tipAngleDeg: 90, cornerRadius: 0 };
const v60 = { ...v90, id: 'v60', name: '60 deg V', type: 'vbit' as const, tipAngleDeg: 60, number: 8 };

describe('chamferGeometry', () => {
  it('computes depth and offset from width, tip offset and the tool angle', () => {
    const g = chamferGeometry(v90, 1, 0.2);
    expect(g.depth).toBeCloseTo(1.2, 9);
    expect(g.offset).toBeCloseTo(0.2, 9);
    expect(g.maxWidth).toBeCloseTo(5.8, 9);
    const h = chamferGeometry(v60, 1, 0.2);
    expect(h.depth).toBeCloseTo(1 / Math.tan(Math.PI / 6) + 0.2, 9);
    expect(h.offset).toBeCloseTo(0.2 * Math.tan(Math.PI / 6), 9);
  });
});

const rectPath = pathFromPoints([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }], true);
const circlePath: Path2D = { closed: true, segments: [{ kind: 'arc', center: { x: 20, y: 15 }, radius: 3, startAngle: 0, sweep: 2 * Math.PI }] };
const linePath = pathFromPoints([{ x: 0, y: -10 }, { x: 40, y: -10 }], false);
// a 40 x 30 rectangle drawing at the stock top, a 3 mm circle in it, and an open line below it; auto stock 6 mm thick
const rect: CamGeometry = {
  kind: 'drawing',
  drawing: { layers: [{ name: 'L', color: 0xffffff, paths: [rectPath, circlePath, linePath] }] },
  rawPoints: new Float32Array([0, -10, 0, 40, 30, 0]),
};

function cut(patch: Record<string, unknown>, tool: Tool = v90, path = 0, opType: 'chamfer' | 'profile' = 'chamfer') {
  let job = setStock(setModel(createJob(), { sourceName: 'r.dxf', blobId: 'd1', kind: 'drawing', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 10, zTop: 0, zBottom: 6 } });
  const cmds: JobCommand[] = [
    { type: 'addTool', tool },
    { type: 'addOperation', opType, toolId: tool.id, id: 'c' },
    { type: 'updateOperation', id: 'c', patch: { geometry: [{ kind: 'dxfPath', blobId: 'd1', layer: 0, path }], ...patch } },
  ];
  job = applyCommands(job, cmds);
  const pctx = programContext(job, rect as never);
  const ctx = camContext(job, rect);
  const { run, toolpaths } = runPipeline(job, rect as never, pctx, new PipelineCache(), { date: '2026-01-01' });
  return { run, tp: toolpaths[0] as Toolpath | undefined, job, ctx };
}

const cutting = (tp: Toolpath, below: number) =>
  tp.moves.filter((m): m is Exclude<Move, { kind: 'rapid' | 'cycle' }> => m.kind !== 'rapid' && m.kind !== 'cycle' && m.to.z < below);
/** Shoelace area: positive for counter-clockwise. */
const signedArea = (pts: { x: number; y: number }[]) =>
  pts.reduce((a, p, i) => a + (p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y), 0) / 2;

describe('chamfer', () => {
  it('runs the tip at the chamfer depth, offset outside the outline by tipOffset*tan(alpha) (review focus 4)', () => {
    const { run, tp, ctx } = cut({ width: 1, tipOffset: 0.2 });
    expect(run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const deep = cutting(tp!, -0.5);
    expect(deep.length).toBeGreaterThan(0);
    expect(deep.every((m) => Math.abs(m.to.z - -1.2) < 1e-6)).toBe(true);
    expect(run.results[0].heights!.top).toBeCloseTo(0, 9);
    expect(run.results[0].heights!.bottom).toBeCloseTo(-1.2, 9);
    // centre path: the longest straight move lies 0.2 outside the rectangle edge, and nothing comes closer
    const edge = drawingPathToProgram(ctx, rectPath);
    const pts = flattenPath(edge, 1e-3);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const outside = (p: { x: number; y: number }) => p.x < Math.min(...xs) || p.x > Math.max(...xs) || p.y < Math.min(...ys) || p.y > Math.max(...ys);
    let prev = { x: 0, y: 0 }, best = { len: -1, mid: { x: 0, y: 0 } };
    for (const m of tp!.moves) {
      if (m.kind === 'line' && m.to.z < -0.5) {
        const len = Math.hypot(m.to.x - prev.x, m.to.y - prev.y);
        if (len > best.len) best = { len, mid: { x: (m.to.x + prev.x) / 2, y: (m.to.y + prev.y) / 2 } };
      }
      if (m.kind !== 'cycle') prev = m.to;
    }
    expect(best.len).toBeGreaterThan(30);
    expect(nearestS(edge, best.mid).distance).toBeCloseTo(0.2, 2);
    expect(outside(best.mid)).toBe(true);
    for (const m of deep) expect(nearestS(edge, m.to).distance).toBeGreaterThan(0.2 - 1e-3);
  });

  it('cuts inside a circle (a countersink) and reports the error for a chamfer too wide', () => {
    const hole = cut({ width: 1 }, v90, 1);
    expect(hole.run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const c = circleOf(drawingPathToProgram(hole.ctx, circlePath))!;
    const deep = cutting(hole.tp!, -0.5);
    expect(deep.length).toBeGreaterThan(0);
    for (const m of deep) expect(Math.hypot(m.to.x - c.center.x, m.to.y - c.center.y)).toBeCloseTo(3 - 0.2, 2);
    const tooWide = cut({ width: 9 });
    expect(tooWide.run.results[0].diagnostics.map((d) => d.message)).toContain('Chamfer too wide for this tool (max 5.80 mm)');
  });

  it('steps down with every level on the final chamfer surface', () => {
    const { tp, ctx } = cut({ width: 2, tipOffset: 0.2, stepdown: 1 });
    const moves = cutting(tp!, -0.01);
    const zs = [...new Set(moves.map((m) => m.to.z.toFixed(3)))];
    expect(zs.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...zs.map(Number))).toBeCloseTo(-2.2, 6);
    // for a 90 degree tool a tip at depth d has its centre |0.2 - (2.2 - d)| from the edge (negative: inside the part edge)
    const edge = drawingPathToProgram(ctx, rectPath);
    for (const m of moves) expect(Math.abs(nearestS(edge, m.to).distance - Math.abs(0.2 - (2.2 + m.to.z)))).toBeLessThan(0.03);
  });

  it('refuses tools that are not chamfer mills or V-bits', () => {
    const { run } = cut({}, tool6);
    expect(run.results[0].diagnostics.map((d) => d.message)).toContain('Chamfering needs a chamfer mill or V-bit');
  });

  it('puts the centre on the right of an open line drawn left to right', () => {
    const { run, tp, ctx } = cut({ width: 1, openSide: 'right' }, v90, 2);
    expect(run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const y0 = flattenPath(drawingPathToProgram(ctx, linePath), 1e-3)[0].y;
    const deep = cutting(tp!, -0.5);
    expect(deep.length).toBeGreaterThan(0);
    for (const m of deep) expect(m.to.y).toBeCloseTo(y0 - 0.2, 2); // right of +X is -Y
    const left = cut({ width: 1, openSide: 'left' }, v90, 2);
    for (const m of cutting(left.tp!, -0.5)) expect(m.to.y).toBeCloseTo(y0 + 0.2, 2);
  });

  it('runs an outside chamfer the same way round as an outside profile with the same direction', () => {
    for (const direction of ['climb', 'conventional']) {
      const ch = cut({ width: 1, direction }, v90, 0);
      const pr = cut({ side: 'outside', direction }, tool6, 0, 'profile');
      const a = signedArea(cutting(ch.tp!, -0.5).map((m) => m.to));
      const b = signedArea(cutting(pr.tp!, -0.5).map((m) => m.to));
      expect(Math.abs(a)).toBeGreaterThan(100);
      expect(Math.sign(a)).toBe(Math.sign(b));
      expect(Math.sign(a)).toBe(direction === 'climb' ? -1 : 1);
    }
  });
});
