import { describe, expect, it } from 'vitest';
import {
  applyCommand, applyCommands, chainPaths, createJob, describeGeometry, type JobCommand, migrateJob, pathFromPoints, PipelineCache, programContext, runPipeline,
  setModel, setStock, type Toolpath,
} from '../src';
import type { CamGeometry } from '../src';
import { tool6 } from './fixtures/camSetup';

// an L: (0,0) → (60,0) → (60,40), as a one-layer drawing at the model's raw coordinates
const drawing: CamGeometry = {
  kind: 'drawing',
  drawing: { layers: [{ name: 'L', color: 0xffffff, paths: [pathFromPoints([{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }], false)] }] },
  rawPoints: new Float32Array([0, 0, 0, 60, 0, 0, 60, 40, 0]),
};

// the same L as two pieces that chain: (0,0) to (60,0) and (60,0) to (60,40)
const twoPieces: CamGeometry = {
  kind: 'drawing',
  drawing: {
    layers: [{ name: 'L', color: 0xffffff, paths: [pathFromPoints([{ x: 0, y: 0 }, { x: 60, y: 0 }], false), pathFromPoints([{ x: 60, y: 0 }, { x: 60, y: 40 }], false)] }],
  },
  rawPoints: new Float32Array([0, 0, 0, 60, 0, 0, 60, 40, 0]),
};

function run(geo: CamGeometry, patch: Record<string, unknown>, reverse: boolean | boolean[] = false) {
  const flags = Array.isArray(reverse) ? reverse : [reverse];
  let job = setModel(createJob(), { sourceName: 'l.svg', blobId: 'd1', kind: 'drawing', importUnits: 'mm' });
  job = setStock(job, { mode: 'auto', margin: { xy: 10, zTop: 0, zBottom: 6 } });
  const commands: JobCommand[] = [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'p' },
    { type: 'updateOperation', id: 'p', patch: { geometry: flags.map((rv, path) => ({ kind: 'dxfPath', blobId: 'd1', layer: 0, path, ...(rv ? { reverse: true as const } : {}) })), stepdown: 3, ...patch } as never },
  ];
  job = applyCommands(job, commands);
  const { run: r, toolpaths } = runPipeline(job, geo as never, programContext(job, geo as never), new PipelineCache(), { date: '2026-01-01' });
  return { diagnostics: r.results[0].diagnostics, toolpath: toolpaths[0] as Toolpath | undefined };
}

function cut(patch: Record<string, unknown>, reverse: boolean | boolean[] = false, geo: CamGeometry = drawing): Toolpath {
  const { diagnostics, toolpath } = run(geo, patch, reverse);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return toolpath!;
}

/** The tool-centre XY moves at cutting depth (feed moves below the top). */
const cuts = (tp: Toolpath) =>
  tp.moves.flatMap((m) => (m.kind === 'line' || m.kind === 'arc') && m.to.z < -0.5 ? [m.to] : []);

describe('open-line sides', () => {
  it('cuts on the line by default, as before', () => {
    // program coordinates are shifted by the stock origin, so compare with the two sides: on the line is halfway
    const mid = (tp: Toolpath) => cuts(tp).filter((p) => p.x < 30).map((p) => p.y)[0];
    expect(mid(cut({}))).toBeCloseTo((mid(cut({ openSide: 'left' })) + mid(cut({ openSide: 'right' }))) / 2, 6);
  });

  it('cuts left or right of the drawn direction at the tool radius', () => {
    const left = cuts(cut({ openSide: 'left' }));
    const right = cuts(cut({ openSide: 'right' }));
    const yAtMid = (pts: { x: number; y: number }[]) => pts.filter((p) => p.x < 30).map((p) => p.y);
    const on = yAtMid(cuts(cut({})))[0];
    expect(yAtMid(left).length).toBeGreaterThan(0);
    expect(yAtMid(left).every((y) => Math.abs(y - (on + 3)) < 0.02)).toBe(true);
    expect(yAtMid(right).every((y) => Math.abs(y - (on - 3)) < 0.02)).toBe(true);
  });

  it('sets the travel direction from climb or conventional and reverse; every level runs the same way', () => {
    const firstCut = (tp: Toolpath) => {
      const at = tp.moves.findIndex((m) => (m.kind === 'line' || m.kind === 'arc') && m.to.z < -0.5);
      const a = tp.moves[at], b = tp.moves[at + 1];
      if (!('to' in a) || !('to' in b)) throw new Error('expected cutting moves');
      return { from: a.to, next: b.to };
    };
    const dir = (tp: Toolpath) => {
      const { from, next } = firstCut(tp);
      return Math.sign(next.x - from.x) || Math.sign(next.y - from.y);
    };
    expect(dir(cut({ openSide: 'left', direction: 'climb' }))).toBe(1);
    expect(dir(cut({ openSide: 'right', direction: 'climb' }))).not.toBe(1);
    expect(dir(cut({ openSide: 'left', direction: 'conventional' }))).not.toBe(1);
    expect(dir(cut({ openSide: 'left', direction: 'climb' }, true))).not.toBe(1);
    const tp = cut({ openSide: 'left' });
    const starts: { x: number; y: number }[] = [];
    tp.moves.forEach((m, i) => {
      const prev = tp.moves[i - 1];
      if (i > 0 && m.kind === 'line' && prev && 'to' in prev && prev.to.z > m.to.z + 1e-9 && m.to.z < -0.5 && m.to.x === prev.to.x && m.to.y === prev.to.y) starts.push(m.to);
    });
    expect(new Set(starts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)).size).toBe(1);
  });

  it('warns or errors for a tight U, and never cuts closer than the tool radius to the line', () => {
    // a U with a 2 mm gap between its arms, cut on its inside with a 6 mm tool
    const pts = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 2 }, { x: 0, y: 2 }];
    const geo: CamGeometry = {
      kind: 'drawing',
      drawing: { layers: [{ name: 'U', color: 0xffffff, paths: [pathFromPoints(pts, false)] }] },
      rawPoints: new Float32Array(pts.flatMap((p) => [p.x, p.y, 0])),
    };
    const { diagnostics, toolpath } = run(geo, { openSide: 'left' });
    const hit = diagnostics.find((d) => d.code === 'bend-rounded' || (d.code === 'offset-collapsed' && d.message === 'The tool does not fit beside this line'));
    expect(hit).toBeDefined();
    if (hit?.code === 'bend-rounded') expect(hit.message).toBe('The tool is too large for a bend in this line; the bend was rounded');
    if (toolpath) {
      // distance from the line (in program coordinates, find the offset from the on-line cut)
      const on = run(geo, {}).toolpath!;
      const line = cuts(on).filter((p, i, a) => i === 0 || p.x !== a[i - 1].x || p.y !== a[i - 1].y);
      const segs: [typeof line[0], typeof line[0]][] = [];
      for (let i = 0; i + 1 < line.length; i++) segs.push([line[i], line[i + 1]]);
      const distTo = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
        const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
        return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
      };
      for (const p of cuts(toolpath)) expect(Math.min(...segs.map(([a, b]) => distTo(p, a, b)))).toBeGreaterThanOrEqual(3 - 0.01);
    }
  });

  it('records which piece seeds each open chain', () => {
    const a = pathFromPoints([{ x: 10, y: 0 }, { x: 20, y: 0 }], false);
    const b = pathFromPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }], false);
    const r = chainPaths([a, b], 1e-6);
    expect(r.open).toHaveLength(1);
    expect(r.openSeeds).toEqual([0]);
    expect(r.openMembers).toEqual([[0, 1]]);
  });

  it('reverses a whole chain when any of its references is reversed', () => {
    const firstDir = (rev: boolean[]) => {
      const tp = cut({ openSide: 'left', direction: 'climb' }, rev, twoPieces);
      const at = tp.moves.findIndex((m) => (m.kind === 'line' || m.kind === 'arc') && m.to.z < -0.5);
      const a = tp.moves[at], b = tp.moves[at + 1];
      if (!('to' in a) || !('to' in b)) throw new Error('expected cutting moves');
      return Math.sign(b.to.x - a.to.x) || Math.sign(b.to.y - a.to.y);
    };
    expect(firstDir([false, false])).toBe(1);
    expect(firstDir([false, true])).not.toBe(1);
    expect(firstDir([true, false])).not.toBe(1);
  });

  it('runs a finish pass for open-side cuts, never closer than the tool radius', () => {
    const tp = cut({ openSide: 'left', stockRadial: 0.5, finishPass: true });
    const on = cut({});
    const line = cuts(on).filter((p, i, a) => i === 0 || p.x !== a[i - 1].x || p.y !== a[i - 1].y);
    const distTo = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    };
    const d = cuts(tp).map((p) => Math.min(...line.slice(1).map((q, i) => distTo(p, line[i], q))));
    expect(Math.min(...d)).toBeGreaterThanOrEqual(3 - 0.01);
    expect(d.some((v) => Math.abs(v - 3) < 0.02)).toBe(true);
    expect(d.some((v) => Math.abs(v - 3.5) < 0.02)).toBe(true);
  });

  it('describes the start and end of an open contour in program coordinates', () => {
    let job = setModel(createJob(), { sourceName: 'l.svg', blobId: 'd1', kind: 'drawing', importUnits: 'mm' });
    job = setStock(job, { mode: 'auto', margin: { xy: 10, zTop: 0, zBottom: 6 } });
    const c = describeGeometry(job, drawing).contours[0];
    expect(c.closed).toBe(false);
    expect(c.end.x - c.start.x).toBeCloseTo(60, 6);
    expect(c.end.y - c.start.y).toBeCloseTo(40, 6);
  });

  it('migrates v3 jobs: profiles get openSide on', () => {
    const v3 = { ...createJob(), schemaVersion: 3, operations: [{ ...applyCommand(createJob(), { type: 'addOperation', opType: 'profile', toolId: null, id: 'p' }).operations[0] }] };
    delete (v3.operations[0] as Record<string, unknown>).openSide;
    const job = migrateJob(v3);
    expect(job.operations[0]).toMatchObject({ openSide: 'on' });
    expect(job.schemaVersion).toBe(4);
  });
});
