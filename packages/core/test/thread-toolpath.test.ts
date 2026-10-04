import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyCommands, type CamGeometry, createJob, describeGeometry, importFile, type Job, type Move, type Path2D, PipelineCache, programContext,
  resolveGeometry, runPipeline, setModel, setStock, starterLibrary, type ThreadOp, type ThreadSpec, type Tool, type Toolpath, threadDirection, threadToolpath,
} from '../src';
import { geoOf, tool6 } from './fixtures/camSetup';
import { drawingJob } from './fixtures/vcarveSetup';

const lib = starterLibrary();
const sp6 = lib.find((t) => t.id === 'starter-thread-sp6')!;
const m8mill = lib.find((t) => t.id === 'starter-thread-m8')!;
/** A single-point mill with a thin neck: the starter's neck is too thick for the deeper external thread forms. */
const thin: Tool = { ...sp6, id: 'thin', thread: { ...sp6.thread!, neckDiameter: 2.5 } };
const withNeck = (t: Tool, neckDiameter: number, neckLength = t.thread!.neckLength): Tool => ({ ...t, thread: { ...t.thread!, neckDiameter, neckLength } });

const M8: ThreadSpec = { standard: 'iso-coarse', size: 'M8', majorDiameter: 8, pitch: 1.25, angle: 60 };
const M10: ThreadSpec = { standard: 'iso-coarse', size: 'M10', majorDiameter: 10, pitch: 1.5, angle: 60 };
const M5: ThreadSpec = { standard: 'iso-coarse', size: 'M5', majorDiameter: 5, pitch: 0.8, angle: 60 };
const M20: ThreadSpec = { standard: 'iso-coarse', size: 'M20', majorDiameter: 20, pitch: 2.5, angle: 60 };
const minorExt = (t: ThreadSpec) => t.majorDiameter - 2 * (17 / 24) * (t.pitch / (2 * Math.tan(Math.PI / 6)));

const circlePath = (diameter: number): Path2D => ({ segments: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: diameter / 2, startAngle: 0, sweep: 2 * Math.PI }], closed: true });

/** A thread op on one drawn circle of the given diameter. */
function drawn(diameter: number, tool: Tool, patch: Record<string, unknown> = {}) {
  const r = drawingJob([circlePath(diameter)], 'thread', patch, tool);
  const op = r.job.operations[0] as ThreadOp;
  const geo = resolveGeometry(op, r.cam);
  const centre = (geo.holes[0] ?? geo.bosses[0]).center;
  return { ...r, op, geo, centre };
}

const arcs = (tp: Toolpath) => tp.moves.filter((m): m is Extract<Move, { kind: 'arc' }> => m.kind === 'arc');
const at = (m: Extract<Move, { kind: 'arc' }>, c: { x: number; y: number }) => Math.hypot(m.to.x - c.x, m.to.y - c.y);
/** The helix arcs: those about the thread axis. */
const helixArcs = (tp: Toolpath, c: { x: number; y: number }) => arcs(tp).filter((m) => Math.hypot(m.center.x - c.x, m.center.y - c.y) < 1e-3);
const codes = (r: { diagnostics: { code: string }[] }) => r.diagnostics.map((d) => d.code);

describe('thread direction (spec §5.1)', () => {
  it.each([
    ['internal', 'right', 'climb', true, true], ['internal', 'right', 'conventional', false, false],
    ['internal', 'left', 'climb', true, false], ['internal', 'left', 'conventional', false, true],
    ['external', 'right', 'climb', false, false], ['external', 'right', 'conventional', true, true],
    ['external', 'left', 'climb', false, true], ['external', 'left', 'conventional', true, false],
  ] as const)('%s %s %s', (kind, hand, dir, ccw, up) => {
    expect(threadDirection(kind, hand, dir)).toEqual({ ccw, up });
  });
});

describe('single-point internal thread', () => {
  const r = drawn(6.8, sp6);
  const tp = r.tp!;
  const helix = helixArcs(tp, r.centre);
  it('cuts without errors', () => {
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(tp).toBeDefined();
  });
  it('turns counter-clockwise on a radius of major/2 - d/2', () => {
    expect(helix.every((m) => m.ccw)).toBe(true);
    for (const m of helix) expect(at(m, r.centre)).toBeCloseTo(4 - 3, 6);
  });
  it('rises exactly one pitch per four arcs over the span bottom - P/4 to top + P/4', () => {
    for (let i = 4; i < helix.length; i++) expect(Math.abs(helix[i].to.z - helix[i - 4].to.z - 1.25)).toBeLessThan(1e-6);
    expect(helix.length).toBe(34); // 8.5 turns: ceil(10 / 1.25) + 1 = 9 turns started
    expect(Math.ceil(helix.length / 4)).toBe(9);
    const top = r.geo.holes[0].top;
    const bottom = top - 10;
    const entry = arcs(tp).find((m) => Math.abs(m.center.x - r.centre.x) > 1e-9)!;
    expect(entry.to.z).toBeCloseTo(bottom - 0.3125, 9);
    expect(helix[helix.length - 1].to.z).toBeCloseTo(top + 0.3125, 9);
  });
  it('stays within r of the axis during entry and exit', () => {
    for (const m of arcs(tp).filter((x) => !helix.includes(x))) {
      // the half circle about the midpoint of the centre and the orbit
      const radius = Math.hypot(m.to.x - m.center.x, m.to.y - m.center.y);
      expect(radius).toBeCloseTo(0.5, 6);
      expect(Math.hypot(m.center.x - r.centre.x, m.center.y - r.centre.y) + radius).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
});

describe('all eight direction rows, end to end', () => {
  const rows = [
    ['internal', 'right', 'climb'], ['internal', 'right', 'conventional'], ['internal', 'left', 'climb'], ['internal', 'left', 'conventional'],
    ['external', 'right', 'climb'], ['external', 'right', 'conventional'], ['external', 'left', 'climb'], ['external', 'left', 'conventional'],
  ] as const;
  it.each(rows)('%s %s %s', (kind, hand, direction) => {
    const r = drawn(kind === 'internal' ? 6.8 : 8, thin, { kind, hand, direction });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const { ccw, up } = threadDirection(kind, hand, direction);
    const helix = helixArcs(r.tp!, r.centre);
    expect(helix.length).toBeGreaterThan(8);
    expect(helix.every((m) => m.ccw === ccw)).toBe(true);
    const turnDz = helix[4].to.z - helix[0].to.z;
    expect(Math.sign(turnDz)).toBe(up ? 1 : -1);
    expect(Math.abs(turnDz)).toBeCloseTo(1.25, 6);
  });
});

describe('multi-tooth internal thread', () => {
  it('one orbit when the teeth cover the length (L = 10, length 9)', () => {
    const r = drawn(6.8, m8mill, { length: 9 });
    const helix = helixArcs(r.tp!, r.centre);
    expect(helix.length).toBe(5); // 370 degrees
    const top = r.geo.holes[0].top;
    const entry = arcs(r.tp!).find((m) => Math.abs(m.center.x - r.centre.x) > 1e-9)!;
    expect(entry.to.z).toBeCloseTo(top - 9 - 1.25 / 4, 9);
    expect(helix[4].to.z - entry.to.z).toBeCloseTo((1.25 * 370) / 360, 9);
  });
  it('two orbits shifted by 10 mm when the length is 15', () => {
    const r = drawn(6.8, m8mill, { length: 15 });
    const helix = helixArcs(r.tp!, r.centre);
    expect(helix.length).toBe(10);
    const top = r.geo.holes[0].top;
    expect(helix[0].to.z).toBeLessThan(top - 15 + 0.7);
    // each orbit starts where the previous one's tool tip started, 10 mm higher
    const starts = arcs(r.tp!).filter((m) => Math.abs(m.center.x - r.centre.x) > 1e-9 && Math.hypot(m.to.x - r.centre.x - 1.1, m.to.y - r.centre.y) < 1).map((m) => m.to.z);
    expect(starts[1] - starts[0]).toBeCloseTo(10, 9);
  });
});

describe('external thread on the fixture boss', () => {
  const plate = (() => {
    const f = importFile('thread-plate.stl', readFileSync(new URL('./fixtures/thread-plate.stl', import.meta.url)));
    if (!f.ok || f.kind !== 'mesh') throw new Error('fixture did not import');
    const geometry: CamGeometry = { kind: 'mesh', mesh: f.mesh, adjacency: f.adjacency, rawPoints: f.mesh.positions };
    let job = setModel(createJob(), { sourceName: 'thread-plate.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' });
    job = setStock(job, { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 } });
    return { job, geometry, cat: describeGeometry(job, geometry) };
  })();
  const run = (kind: 'internal' | 'external', tool: Tool, patch: Record<string, unknown>) => {
    const geometry = [kind === 'external' ? plate.cat.bosses[0].ref : plate.cat.holes[0].ref];
    const job: Job = applyCommands(plate.job, [
      { type: 'addTool', tool },
      { type: 'addOperation', opType: 'thread', toolId: tool.id, id: 'o' },
      { type: 'updateOperation', id: 'o', patch: { kind, geometry, ...patch } as never },
    ]);
    const out = runPipeline(job, plate.geometry as never, programContext(job, plate.geometry as never), new PipelineCache(), { date: '2026-01-01' });
    return { job, result: out.run.results[0], tp: out.toolpaths[0] as Toolpath | undefined, text: out.run.files[0]?.text ?? '' };
  };
  const centre = { x: 45, y: 25 };

  it('M20x2.5: radius minor/2 + d/2, clockwise for right-hand climb, Z falling, entry r + 5 out', () => {
    const r = run('external', thin, { thread: M20, length: 6 });
    expect(r.result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const helix = helixArcs(r.tp!, centre);
    const rad = minorExt(M20) / 2 + 3;
    for (const m of helix) expect(at(m, centre)).toBeCloseTo(rad, 4);
    expect(helix.every((m) => !m.ccw)).toBe(true);
    expect(helix[4].to.z).toBeLessThan(helix[0].to.z);
    // the feed move before the entry arc starts r + 5 from the axis
    const firstArc = r.tp!.moves.findIndex((m) => m.kind === 'arc');
    const before = r.tp!.moves[firstArc - 1] as Extract<Move, { kind: 'line' }>;
    expect(Math.hypot(before.to.x - centre.x, before.to.y - centre.y)).toBeCloseTo(rad + 5, 3);
  });

  it('reports the gouge when the thread runs below the boss base into the plate', () => {
    expect(codes(run('external', thin, { thread: M20, length: 6 }).result)).not.toContain('gouge');
    const deep = run('external', thin, { thread: M20, length: 10 });
    expect(codes(deep.result)).toContain('gouge');
  });

  it('warns about the boss size', () => {
    const r = run('external', thin, { thread: { ...M20, standard: 'custom', size: null, majorDiameter: 22 }, length: 6 });
    expect(r.result.diagnostics.find((d) => d.code === 'boss-size')).toMatchObject({ severity: 'warning', message: "The boss is 20.00 mm; the thread's major diameter is 22.00 mm" });
  });

  it('posts the golden G-code of M20x2.5 external on the boss', async () => {
    const r = run('external', thin, { thread: M20, length: 6 });
    expect(r.result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    await expect(r.text).toMatchFileSnapshot('./fixtures/thread-external-m20.nc');
  });

  it('posts the golden G-code of M8 internal single-point on the hole', async () => {
    const r = run('internal', sp6, { thread: M8, length: 10 });
    expect(r.result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.text).toMatch(/G3 X.* Z.* I.* J/);
    await expect(r.text).toMatchFileSnapshot('./fixtures/thread-internal-m8.nc');
  });
});

describe('feed and passes', () => {
  it('scales the helix feed by r / R with feed compensation, not the plunge', () => {
    const r = drawn(6.8, sp6);
    const F = r.op.feeds.feed;
    const helix = helixArcs(r.tp!, r.centre);
    expect(helix[0].feed).toBeCloseTo((F * 1) / 4, 9);
    const plunge = r.tp!.moves.find((m) => m.kind === 'line') as Extract<Move, { kind: 'line' }>;
    expect(plunge.feed).toBe(r.op.feeds.plungeFeed);
    const flat = drawn(6.8, sp6, { feedCompensation: false });
    expect(helixArcs(flat.tp!, flat.centre)[0].feed).toBe(F);
  });

  it('steps the radii linearly and repeats the last one for a spring pass', () => {
    const r = drawn(6.8, sp6, { passes: 3, springPass: true });
    const helix = helixArcs(r.tp!, r.centre);
    const radii = [...new Set(helix.map((m) => Math.round(at(m, r.centre) * 1e6) / 1e6))];
    // start = 3.4 - 3 = 0.4, final = 1
    expect(radii).toEqual([0.6, 0.8, 1]);
    expect(helix.length).toBe(4 * 34); // four helices, the last repeating the final radius
    for (const m of helix.slice(0, 34)) expect(at(m, r.centre)).toBeCloseTo(0.6, 6);
  });

  it('never goes to a negative radius', () => {
    const r = drawn(2, sp6, { thread: { ...M8, standard: 'custom', size: null, majorDiameter: 6.6, pitch: 0.5 }, passes: 2 }); // the hole is smaller than the tool: the start is the centre, never a negative radius
    for (const m of arcs(r.tp!)) expect(Math.hypot(m.to.x - m.center.x, m.to.y - m.center.y)).toBeGreaterThanOrEqual(0);
    expect(helixArcs(r.tp!, r.centre).every((m) => at(m, r.centre) > 0)).toBe(true);
  });
});

describe('thread diagnostics', () => {
  const only = (r: { diagnostics: { severity: string; code: string; message: string }[] }, code: string) => r.diagnostics.find((d) => d.code === code);

  it('wrong-tool', () => {
    const r = drawn(6.8, tool6);
    expect(only(r, 'wrong-tool')).toMatchObject({ severity: 'error', message: 'Thread milling needs a thread mill' });
    expect(r.tp).toBeUndefined();
  });
  it('thread-angle', () => {
    const r = drawn(6.8, sp6, { thread: { ...M8, standard: 'custom', size: null, angle: 55 } });
    expect(only(r, 'thread-angle')).toMatchObject({ severity: 'error', message: "The cutter's 60° tooth does not match the 55° thread" });
    expect(r.tp).toBeUndefined();
  });
  it('thread-pitch', () => {
    const r = drawn(8.5, m8mill, { thread: M10 });
    expect(only(r, 'thread-pitch')).toMatchObject({ severity: 'error', message: 'This multi-tooth cutter cuts 1.25 mm pitch; the thread needs 1.50 mm' });
  });
  it('tool-too-big', () => {
    const r = drawn(4.2, sp6, { thread: M5 });
    expect(only(r, 'tool-too-big')).toMatchObject({ severity: 'error', message: 'The thread mill is too big for this hole' });
  });
  it('thread-neck', () => {
    const r = drawn(6.8, withNeck(sp6, 5.9));
    expect(only(r, 'thread-neck')).toMatchObject({ severity: 'error', message: "The cutter's neck is too thick for this thread depth" });
  });
  it('thread-reach', () => {
    const r = drawn(6.8, sp6, { length: 25 });
    expect(only(r, 'thread-reach')).toMatchObject({ severity: 'error', message: 'The thread mill cannot reach 25.00 mm deep' });
    expect(r.tp).toBeUndefined();
  });
  it('thread-too-deep on a blind hole', () => {
    const r = drawn(6.8, sp6);
    const hole = { ...r.geo.holes[0], through: false, bottom: r.geo.holes[0].top - 5 };
    const out = threadToolpath({ ...r.op, length: 10 }, sp6, r.cam, geoOf({ holes: [hole] }));
    expect(out.diagnostics).toMatchObject([{ severity: 'error', code: 'thread-too-deep', message: 'The thread runs below the bottom of the hole' }]);
    expect(out.toolpath).toBeNull();
    // the other holes are still cut
    const fine = { ...hole, center: { x: 0, y: 0 }, bottom: hole.top - 12, ref: 1 };
    const two = threadToolpath({ ...r.op, length: 10 }, sp6, r.cam, geoOf({ holes: [hole, fine] }));
    expect(two.diagnostics.map((d) => d.code)).toEqual(['thread-too-deep']);
    expect(two.toolpath).not.toBeNull();
    expect(helixArcs(two.toolpath!, { x: 0, y: 0 }).length).toBeGreaterThan(0);
  });
  it('hole-small names the tap drill', () => {
    const r = drawn(6, sp6);
    expect(only(r, 'hole-small')).toMatchObject({ severity: 'warning', message: "The hole is smaller than the thread's minor diameter (6.65 mm); drill 6.8 mm first" });
    expect(r.tp).toBeDefined();
  });
  it('hole-large', () => {
    const r = drawn(8.5, sp6);
    expect(only(r, 'hole-large')).toMatchObject({ severity: 'error', message: 'The hole is larger than the thread (8.00 mm)' });
    expect(r.tp).toBeUndefined();
  });
  it('boss-size', () => {
    const r = drawn(21, thin, { kind: 'external', thread: M20, length: 6 });
    expect(only(r, 'boss-size')).toMatchObject({ severity: 'warning', message: "The boss is 21.00 mm; the thread's major diameter is 20.00 mm" });
    expect(r.tp).toBeDefined();
  });
  it('skips the stepdown warning', () => {
    expect(codes(drawn(6.8, sp6))).not.toContain('stepdown-exceeds-flute');
  });
});
