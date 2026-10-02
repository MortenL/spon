import { describe, expect, it } from 'vitest';
import {
  applyCommands, buildAdjacency, camContext, createJob, toProgram, vec3, faceRefFromTriangle, gougeCheck, type JobCommand, type Mesh, type Move, PipelineCache, programContext,
  runPipeline, setModel, setStock, type Toolpath,
} from '../src';
import { faceAt, plateSetup, tool6 } from './fixtures/camSetup';
import { steppedMesh } from './fixtures/stepped';

function steppedSetup() {
  const mesh = steppedMesh();
  const geometry = { kind: 'mesh' as const, mesh, adjacency: buildAdjacency(mesh), rawPoints: mesh.positions };
  const job = setStock(setModel(createJob(), { sourceName: 'stepped.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 } });
  return { mesh, geometry, job };
}

function steppedJob(opType: 'profile' | 'pocket', patch: Record<string, unknown>, faceOf: 'bossTop' | 'slabTop' = 'bossTop') {
  const { mesh, geometry, job: base } = steppedSetup();
  const face = faceOf === 'slabTop'
    ? faceAt(geometry, 5, 5, 10)
    : faceRefFromTriangle(mesh, 'm1', [...Array(mesh.indices.length / 3).keys()].find((t) => mesh.normals[t * 3 + 2] > 0.99 && mesh.positions[mesh.indices[t * 3] * 3 + 2] > 19.9)!);
  const cmds: JobCommand[] = [
    { type: 'addTool', tool: tool6 },
    { type: 'addOperation', opType, toolId: 't6', id: 'p' },
    { type: 'updateOperation', id: 'p', patch: { geometry: [face], stepdown: 5, ...patch } as never },
  ];
  const job = applyCommands(base, cmds);
  return runPipeline(job, geometry as never, programContext(job, geometry as never), new PipelineCache(), { date: '2026-01-01' });
}

const slabTopBottom = { heights: { bottom: { from: 'modelTop', offset: -10 } } };

function handPath(moves: Move[]): Toolpath {
  return { operationId: 'x', operationName: 'x', toolId: 't6', rpm: 1, coolant: 'off', clearance: 5, moves };
}

describe('gouge check', () => {
  it('flags a profile around the boss that runs down into the base slab (review focus 1)', () => {
    const { run } = steppedJob('profile', {}); // default bottom: stock bottom - 0.2, i.e. through the slab
    const g = run.results[0].diagnostics.find((d) => d.code === 'gouge');
    expect(g?.severity).toBe('error');
    expect(g?.message).toMatch(/^Cuts into the model by up to \d+\.\d\d mm \(\d+ places?, first at X -?\d+\.\d\d Y -?\d+\.\d\d Z -?\d+\.\d\d\)$/);
    expect(run.results[0].overlays.gouges.length).toBeGreaterThan(0);
    expect(run.results[0].hasToolpath).toBe(true); // kept so it can be seen
  });

  it('is clean when the profile stops at the slab top (review focus 2)', () => {
    const { run } = steppedJob('profile', slabTopBottom); // model top 20 -> bottom at the slab top (z 10)
    expect(run.results[0].diagnostics.filter((d) => d.code === 'gouge')).toEqual([]);
    expect(run.results[0].hasToolpath).toBe(true);
  });

  it('is clean for a profile at an explicit zero wall offset', () => {
    const { run } = steppedJob('profile', { ...slabTopBottom, stockRadial: 0, side: 'outside' });
    expect(run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('is clean for a pocket on the slab top beside the boss', () => {
    const { run } = steppedJob('pocket', slabTopBottom, 'slabTop');
    expect(run.results[0].diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(run.results[0].hasToolpath).toBe(true);
  });

  it('flags a rapid through the model', () => {
    const { geometry, job } = steppedSetup();
    const ctx = camContext(job, geometry as never);
    // program Z 0 is the stock top (model z 20); the boss occupies program z -10..0 at x 20..40
    const r = gougeCheck(handPath([
      { kind: 'rapid', to: { x: 0, y: 20, z: 5 } },
      { kind: 'rapid', to: { x: 0, y: 20, z: -5 } },
      { kind: 'rapid', to: { x: 60, y: 20, z: -5 } },
    ]), tool6, ctx);
    expect(r.diagnostics.map((d) => d.message)).toEqual(['A rapid move passes through the model']);
    expect(r.gouges.length).toBeGreaterThan(0);
  });

  it('counts consecutive gouging samples as one place', () => {
    const { geometry, job } = steppedSetup();
    const ctx = camContext(job, geometry as never);
    const msg = gougeCheck(handPath([
      { kind: 'rapid', to: { x: 0, y: 20, z: 5 } },
      { kind: 'rapid', to: { x: 0, y: 20, z: -5 } },
      { kind: 'line', to: { x: 60, y: 20, z: -5 }, feed: 500 },
    ]), tool6, ctx).diagnostics[0].message;
    expect(msg).toMatch(/\(1 place, first at/);
  });

  it('reports no gouge for the STL plate pocket and outline (golden job, review focus 2)', () => {
    const { job, geometry } = plateSetup();
    const floor = faceAt(geometry as never, 12, 17, 6);
    const top = faceAt(geometry as never, 5, 5, 10);
    const j = applyCommands(job, [
      { type: 'addTool', tool: tool6 },
      { type: 'addOperation', opType: 'pocket', toolId: 't6', id: 'pk' },
      { type: 'updateOperation', id: 'pk', patch: { geometry: [floor], heights: { bottom: { from: 'face', offset: 0, face: floor } } } as never },
      { type: 'addOperation', opType: 'profile', toolId: 't6', id: 'pf' },
      { type: 'updateOperation', id: 'pf', patch: { geometry: [{ ...top }], side: 'outside' } as never },
    ]);
    const { run } = runPipeline(j, geometry as never, programContext(j, geometry as never), new PipelineCache(), { date: '2026-01-01' });
    expect(run.results.every((r) => r.hasToolpath)).toBe(true);
    for (const r of run.results) expect(r.diagnostics.filter((d) => d.code === 'gouge')).toEqual([]);
  });

  it('counts two separate gouges as two places', () => {
    const { geometry, job } = steppedSetup();
    const ctx = camContext(job, geometry as never);
    const msg = gougeCheck(handPath([
      { kind: 'rapid', to: { x: 0, y: 20, z: 5 } },
      { kind: 'line', to: { x: 0, y: 20, z: -5 }, feed: 500 },
      { kind: 'line', to: { x: 60, y: 20, z: -5 }, feed: 500 }, // boss gouge, then clear beyond it
      { kind: 'line', to: { x: 60, y: 20, z: 5 }, feed: 500 },
      { kind: 'rapid', to: { x: 0, y: 20, z: 5 } },
      { kind: 'line', to: { x: 0, y: 20, z: -5 }, feed: 500 },
      { kind: 'line', to: { x: 60, y: 20, z: -5 }, feed: 500 },
    ]), tool6, ctx).diagnostics[0].message;
    expect(msg).toMatch(/\(2 places, first at/);
  });

  describe.each([64, 24])('drill cycles in a %i-gon hole', (sides) => {
    // 40 x 40 x 10 block, blind hole of radius 3 down to z 4; program Z 0 is the top (model z 10)
    function holeCtx() {
      const R = 3, O = 20, tris: number[] = [];
      const ring = (r: number, z: number, i: number) => [20 + r * Math.cos((2 * Math.PI * i) / sides), 20 + r * Math.sin((2 * Math.PI * i) / sides), z];
      for (let i = 0; i < sides; i++) {
        const [a, b] = [i, i + 1];
        tris.push(...ring(R, 10, a), ...ring(O, 10, a), ...ring(O, 10, b), ...ring(R, 10, a), ...ring(O, 10, b), ...ring(R, 10, b)); // top
        tris.push(...ring(R, 10, a), ...ring(R, 4, a), ...ring(R, 4, b), ...ring(R, 10, a), ...ring(R, 4, b), ...ring(R, 10, b)); // wall
        tris.push(20, 20, 4, ...ring(R, 4, a), ...ring(R, 4, b)); // floor
      }
      const n = tris.length / 9, indices = new Uint32Array(n * 3).map((_, i) => i);
      const mesh: Mesh = { positions: Float32Array.from(tris), indices, normals: new Float32Array(n * 3) };
      const geometry = { kind: 'mesh' as const, mesh, adjacency: buildAdjacency(mesh), rawPoints: mesh.positions };
      const job = setStock(setModel(createJob(), { sourceName: 'hole.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 0, zTop: 0, zBottom: 0 } });
      return camContext(job, geometry as never);
    }
    const drill = { ...tool6, id: 'd', type: 'drill' as const, tipAngleDeg: 118 };
    const cycle = (ctx: ReturnType<typeof holeCtx>, bottom: number, tool = drill) => gougeCheck(handPath([
      { kind: 'rapid', to: { ...toProgram(ctx, vec3(20, 20, 15)) } },
      { kind: 'cycle', cycle: 'drill', at: { x: toProgram(ctx, vec3(20, 20, 0)).x, y: toProgram(ctx, vec3(20, 20, 0)).y }, top: 0, bottom, r: 2, retract: 5, peck: 0, dwell: 0, feed: 300 },
    ]), tool, ctx);
    it('a full-size drill to just above the floor is clean', () => {
      const ctx = holeCtx();
      expect(cycle(holeCtx(), -5.9).diagnostics).toEqual([]);
      expect(cycle(ctx, -5.9, { ...drill, tipAngleDeg: 0 }).diagnostics).toEqual([]);
    });
    it('a drill 1 mm past the blind floor is flagged', () => {
      expect(cycle(holeCtx(), -7).diagnostics[0]?.message).toMatch(/^Cuts into the model by up to/);
    });
  });

  it('checks a 200,000-triangle mesh with 100,000 moves in under 2 s (review focus 5)', () => {
    const n = 316, size = 79;
    const positions = new Float32Array(n * n * 3);
    const surf = (x: number, y: number) => 3 + 1.5 * Math.sin(x * 0.4) * Math.cos(y * 0.35) + 0.8 * Math.sin((x + y) * 0.9);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * size, y = (j / (n - 1)) * size;
      positions.set([x, y, surf(x, y)], (j * n + i) * 3);
    }
    const indices = new Uint32Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      indices.set([a, b, d, a, d, c], k); k += 6;
    }
    const normals = new Float32Array(indices.length);
    for (let t = 0; t < indices.length; t += 3) normals[t + 2] = 1;
    const mesh: Mesh = { positions, indices, normals };
    expect(indices.length / 3).toBeGreaterThan(198000);
    const geometry = { kind: 'mesh' as const, mesh, adjacency: buildAdjacency(mesh), rawPoints: positions };
    const job = setStock(setModel(createJob(), { sourceName: 'wave.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 0, zTop: 0, zBottom: 0 } });
    const ctx = camContext(job, geometry as never);
    // a finishing-style raster of ~1 mm moves that follows the terrain a little above it (mapped to program coordinates)
    const moves: Move[] = [{ kind: 'rapid', to: toProgram(ctx, vec3(4, 4, 10)) }];
    const rowSteps = 115; // 0.6 mm in XY: about 1 mm moves once the terrain slope is added
    for (let m = 0; m < 100_000; m++) {
      const row = Math.floor(m / rowSteps), col = m % rowSteps;
      const x = 4 + (row % 2 ? rowSteps - col : col) * 0.6, y = 4 + ((row * 0.05) % 70);
      moves.push({ kind: 'line', to: toProgram(ctx, vec3(x, y, surf(x, y) + 0.5)), feed: 1000 });
    }
    const t0 = performance.now();
    const r = gougeCheck(handPath(moves), tool6, ctx);
    const ms = performance.now() - t0;
    expect(r.gouges.length).toBeLessThanOrEqual(200);
    expect(ms).toBeLessThan(2000);
  }, 60_000);
});
