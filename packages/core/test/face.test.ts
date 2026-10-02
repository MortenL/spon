import { describe, expect, it } from 'vitest';
import {
  applyCommands, camContext, createJob, differencePolys, drawingPathToProgram, flattenPath, type JobCommand, PipelineCache, pathFromPoints,
  pointInPolys, polysArea, programContext, runPipeline, scanlineIntervals, setModel, setStock, sweepPolylines, type Toolpath,
} from '../src';
import type { CamGeometry } from '../src';
import { plateSetup, tool6 } from './fixtures/camSetup';

const flat = { ...tool6, id: 'f20', name: '20 mm flat', number: 5, diameter: 20, fluteLength: 30 };
const ball = { ...tool6, id: 'b6', name: '6 mm ball', number: 6, type: 'ball' as const, cornerRadius: 3 };

/** A spoilboard job: fixed stock 100 x 60 x 0, no model. */
function spoilboard(patch: Record<string, unknown>, tool = flat) {
  let job = setStock(createJob(), { mode: 'fixed', size: { x: 100, y: 60, z: 0 }, modelOffset: { x: 0, y: 0, z: 0 } });
  const cmds: JobCommand[] = [
    { type: 'addTool', tool },
    { type: 'addOperation', opType: 'face', toolId: tool.id, id: 'f' },
    { type: 'updateOperation', id: 'f', patch: { heights: { bottom: { from: 'stockTop', offset: -1 } }, stepdown: 1, ...patch } },
  ];
  job = applyCommands(job, cmds);
  const { run, toolpaths } = runPipeline(job, null, programContext(job, null), new PipelineCache(), { date: '2026-01-01' });
  return { job, run, tp: toolpaths[0] as Toolpath | undefined };
}

/** The XY area the tool covered at the given Z (feed moves at that depth, swept by the tool radius). */
function covered(tp: Toolpath, z: number, r: number) {
  const lines: { points: { x: number; y: number }[]; closed: boolean }[] = [];
  let prev: { x: number; y: number; z: number } | null = null;
  for (const m of tp.moves) {
    if ('to' in m && m.kind !== 'rapid' && prev && Math.abs(m.to.z - z) < 1e-6 && Math.abs(prev.z - z) < 1e-6) lines.push({ points: [prev, m.to], closed: false });
    if ('to' in m) prev = m.to;
  }
  return sweepPolylines(lines, r, 0.01);
}

describe('scanlineIntervals', () => {
  it('cuts a rectangle and an L into inside intervals at an angle', () => {
    const rect = [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 }]];
    const lines = scanlineIntervals(rect, 0, 1);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) for (const iv of l) expect(iv.b.x - iv.a.x).toBeCloseTo(10, 6);
    const L = [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }]];
    const tilted = scanlineIntervals(L, 30, 0.5);
    expect(tilted.flat().length).toBeGreaterThan(0);
  });
});

describe('facing', () => {
  it('covers the whole stock top with zig-zag passes and overlap past the edges (review focus 3)', () => {
    const { run, tp } = spoilboard({});
    expect(run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const left = differencePolys([[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }]], covered(tp!, -1, 10));
    expect(polysArea(left)).toBeLessThan(1e-3);
    // passes reach past the stock edge by the overlap
    const xs = tp!.moves.flatMap((m) => ('to' in m ? [m.to.x] : []));
    expect(Math.min(...xs)).toBeLessThan(-9);
    expect(Math.max(...xs)).toBeGreaterThan(109);
    expect(run.results[0].diagnostics.map((d) => d.code)).not.toContain('unmachined-area');
  });

  it('one-way passes all cut the same direction; both-ways alternate', () => {
    const dirs = (tp: Toolpath) => {
      const out: number[] = [];
      tp.moves.forEach((m, i) => {
        const p = tp.moves[i - 1] && 'to' in tp.moves[i - 1] ? (tp.moves[i - 1] as { to: { x: number; y: number } }).to : undefined;
        if (m.kind === 'line' && p && Math.abs(m.to.y - p.y) < 1e-9 && Math.abs(m.to.x - p.x) > 20) out.push(Math.sign(m.to.x - p.x));
      });
      return out;
    };
    expect(new Set(dirs(spoilboard({ oneWay: true }).tp!)).size).toBe(1);
    expect(new Set(dirs(spoilboard({ oneWay: false }).tp!)).size).toBe(2);
  });

  it('covers with a spiral too, and steps down in levels', () => {
    const { run, tp } = spoilboard({ pattern: 'spiral', heights: { bottom: { from: 'stockTop', offset: -3 } } });
    const left = differencePolys([[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }]], covered(tp!, -3, 10));
    expect(polysArea(left)).toBeLessThan(1e-3);
    expect(run.results[0].diagnostics.map((d) => d.code)).not.toContain('unmachined-area');
    const zs = new Set(tp!.moves.flatMap((m) => (m.kind === 'line' || m.kind === 'arc' ? [m.to.z.toFixed(3)] : [])));
    expect([...zs].filter((z) => ['-1.000', '-2.000', '-3.000'].includes(z)).length).toBe(3);
  });

  it('refuses tools that are not flat or bull-nose', () => {
    const { run } = spoilboard({}, ball);
    expect(run.results[0].diagnostics.map((d) => d.message)).toContain('Facing needs a flat or bull-nose tool');
    expect(run.results[0].diagnostics[0].code).toBe('wrong-tool');
  });

  it('faces a picked L-shaped area and stays within the overlap of it', () => {
    // a closed L drawing (60 x 40, 20 wide arms) on layer 0
    const pts = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 40 }, { x: 0, y: 40 }];
    const geo: CamGeometry = {
      kind: 'drawing',
      drawing: { layers: [{ name: 'L', color: 0xffffff, paths: [pathFromPoints(pts, true)] }] },
      rawPoints: new Float32Array(pts.flatMap((p) => [p.x, p.y, 0])),
    };
    let job = setModel(createJob(), { sourceName: 'l.svg', blobId: 'd1', kind: 'drawing', importUnits: 'mm' });
    job = setStock(job, { mode: 'auto', margin: { xy: 10, zTop: 0, zBottom: 6 } });
    job = applyCommands(job, [
      { type: 'addTool', tool: flat },
      { type: 'addOperation', opType: 'face', toolId: flat.id, id: 'f' },
      {
        type: 'updateOperation', id: 'f',
        patch: { area: 'picked', geometry: [{ kind: 'dxfPath', blobId: 'd1', layer: 0, path: 0 }], heights: { bottom: { from: 'contour', offset: -1 } }, stepdown: 1 } as never,
      },
    ]);
    const { run, toolpaths } = runPipeline(job, geo as never, programContext(job, geo as never), new PipelineCache(), { date: '2026-01-01' });
    expect(run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const tp = toolpaths[0] as Toolpath;
    const ctx = camContext(job, geo as never);
    const L = [flattenPath(drawingPathToProgram(ctx, pathFromPoints(pts, true)), 0.01)];
    const cov = covered(tp, -1, 10);
    expect(polysArea(differencePolys(L, cov))).toBeLessThan(1e-3);
    // a point beyond overlap (10) + tool radius (10) from the L is untouched
    const far = { x: L[0].reduce((m, p) => Math.max(m, p.x), -Infinity) + 25, y: L[0].reduce((m, p) => Math.min(m, p.y), Infinity) };
    expect(pointInPolys(far, cov)).toBe(false);
    const farTop = { x: L[0].reduce((m, p) => Math.min(m, p.x), Infinity), y: L[0].reduce((m, p) => Math.max(m, p.y), -Infinity) + 25 };
    expect(pointInPolys(farTop, cov)).toBe(false);
  });

  it('warns when the facing depth goes below the model top', () => {
    const { job: base, geometry } = plateSetup();
    const job = applyCommands(base, [
      { type: 'addTool', tool: flat },
      { type: 'addOperation', opType: 'face', toolId: flat.id, id: 'f' },
      { type: 'updateOperation', id: 'f', patch: { heights: { bottom: { from: 'modelTop', offset: -0.5 } }, stepdown: 1 } },
    ]);
    const { run } = runPipeline(job, geometry as never, programContext(job, geometry as never), new PipelineCache(), { date: '2026-01-01' });
    const d = run.results[0].diagnostics;
    // facing 0.5 mm below the model top really does cut into the model, so the gouge check reports it (and keeps the toolpath)
    expect(d.filter((x) => x.severity === 'error').map((x) => x.code)).toEqual(['gouge']);
    expect(d.find((x) => x.code === 'gouge')?.message).toMatch(/^Cuts into the model by up to 0\.50 mm/);
    expect(run.results[0].hasToolpath).toBe(true);
    expect(d.map((x) => x.message)).toContain('The facing depth goes below the model top');
    expect(d.find((x) => x.message === 'The facing depth goes below the model top')?.code).toBe('facing-depth');
  });

  it('covers at an odd angle and stepover with no uncut area', () => {
    const { run, tp } = spoilboard({ angleDeg: 37, stepoverPct: 70, oneWay: false });
    expect(run.results[0].diagnostics.map((d) => d.code)).not.toContain('unmachined-area');
    const left = differencePolys([[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }]], covered(tp!, -1, 10));
    expect(polysArea(left)).toBeLessThan(1e-3);
  });

  it('climb one-way passes at 30 degrees visit lines from high to low across, conventional the reverse', () => {
    const across = (direction: string) => {
      const tp = spoilboard({ angleDeg: 30, oneWay: true, direction, heights: { bottom: { from: 'stockTop', offset: -1 } }, stepdown: 1 }).tp!;
      const t = (30 * Math.PI) / 180;
      const cuts: { y: number; dx: number }[] = [];
      tp.moves.forEach((m, i) => {
        const p = tp.moves[i - 1];
        if (m.kind === 'line' && p && 'to' in p && Math.abs(m.to.z - p.to.z) < 1e-9) {
          const dx = m.to.x - p.to.x, dy = m.to.y - p.to.y;
          const along = dx * Math.cos(t) + dy * Math.sin(t);
          if (Math.abs(-dx * Math.sin(t) + dy * Math.cos(t)) < 1e-6 && along > 20) cuts.push({ y: -p.to.x * Math.sin(t) + p.to.y * Math.cos(t), dx: along });
        }
      });
      return cuts;
    };
    const climb = across('climb'), conv = across('conventional');
    expect(climb.length).toBeGreaterThan(3);
    expect(climb.every((c) => c.dx > 0)).toBe(true);
    expect(climb.every((c, i) => i === 0 || c.y < climb[i - 1].y)).toBe(true);
    expect(conv.every((c, i) => i === 0 || c.y > conv[i - 1].y)).toBe(true);
  });

  it('spiral winding: climb is clockwise, conventional counter-clockwise', () => {
    const area = (direction: string) => {
      const tp = spoilboard({ pattern: 'spiral', direction, stepdown: 1 }).tp!;
      const pts: { x: number; y: number }[] = [];
      for (const m of tp.moves) {
        if (m.kind === 'rapid' || !('to' in m)) continue;
        if (Math.abs(m.to.z + 1) < 1e-9) pts.push(m.to);
        if (pts.length >= 5 && m.kind === 'line' && pts.length > 5) break;
      }
      // the outer ring: its first four corners (line moves at the floor)
      const ring = pts.slice(0, 5);
      let a = 0;
      for (let i = 0; i < ring.length - 1; i++) a += ring[i].x * ring[i + 1].y - ring[i + 1].x * ring[i].y;
      return a;
    };
    expect(area('climb')).toBeLessThan(0);
    expect(area('conventional')).toBeGreaterThan(0);
  });
});
