import { describe, expect, it } from 'vitest';
import {
  resolveGeometry, applyCommands, buildAdjacency, camContext, createJob, faceRefFromTriangle, generateJob, gougeCheck, type JobCommand, type Mesh, meshIndex, type Move,
  setModel, setStock, type Toolpath,
} from '../src';
import { faceAt, tool6 } from './fixtures/camSetup';
import { steppedMesh } from './fixtures/stepped';

const v90 = { ...tool6, id: 'v90', name: '90 chamfer', number: 7, type: 'chamfer' as const, diameter: 12, tipAngleDeg: 90, cornerRadius: 0 };
const t3 = { ...tool6, id: 't3', name: '3 mm flat', number: 3, diameter: 3 };

const gouges = (r: { diagnostics: { code: string; message: string }[] }) => r.diagnostics.filter((d) => d.code === 'gouge').map((d) => d.message);

function steppedSetup() {
  const mesh = steppedMesh();
  const geometry = { kind: 'mesh' as const, mesh, adjacency: buildAdjacency(mesh), rawPoints: mesh.positions };
  const job = setStock(setModel(createJob(), { sourceName: 's.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 5, zTop: 0, zBottom: 0 } });
  const bossTri = [...Array(mesh.indices.length / 3).keys()].find((t) => mesh.normals[t * 3 + 2] > 0.99 && mesh.positions[mesh.indices[t * 3] * 3 + 2] > 19.9)!;
  return { mesh, geometry, job, boss: faceRefFromTriangle(mesh, 'm1', bossTri), slab: faceAt(geometry as never, 5, 5, 10) };
}

/**
 * A 40 x 40 x 10 block with a blind pocket (floor at z 4) whose outline is `ring` (counter-clockwise points around
 * (20, 20), star-shaped). Raw coordinates, welded so faces and loops resolve.
 */
function pocketBlock(ring: [number, number][]) {
  const raw: number[] = [];
  const n = ring.length;
  const edge = ([x, y]: [number, number]): [number, number] => { const k = 20 / Math.max(Math.abs(x - 20), Math.abs(y - 20)); return [20 + (x - 20) * k, 20 + (y - 20) * k]; };
  const P = (i: number, z: number) => [...ring[i % n], z].map((v) => +v.toFixed(9));
  const Q = (i: number, z: number) => [...edge(ring[i % n]), z].map((v) => +v.toFixed(9));
  for (let i = 0; i < n; i++) {
    const j = i + 1;
    raw.push(...P(i, 10), ...Q(i, 10), ...Q(j, 10), ...P(i, 10), ...Q(j, 10), ...P(j, 10)); // top
    raw.push(...P(i, 10), ...P(j, 4), ...P(i, 4), ...P(i, 10), ...P(j, 10), ...P(j, 4)); // pocket wall, facing the axis
    raw.push(20, 20, 4, ...P(i, 4), ...P(j, 4)); // floor
    raw.push(...Q(i, 0), ...Q(j, 0), 20, 20, 0); // bottom
    raw.push(...Q(i, 10), ...Q(i, 0), ...Q(j, 0), ...Q(i, 10), ...Q(j, 0), ...Q(j, 10)); // outer wall
  }
  const key = new Map<string, number>();
  const pos: number[] = [], idx: number[] = [];
  for (let k = 0; k < raw.length; k += 3) {
    const s = `${raw[k]},${raw[k + 1]},${raw[k + 2]}`;
    let i = key.get(s);
    if (i === undefined) { i = pos.length / 3; key.set(s, i); pos.push(raw[k], raw[k + 1], raw[k + 2]); }
    idx.push(i);
  }
  const positions = Float32Array.from(pos), indices = Uint32Array.from(idx);
  const normals = new Float32Array(indices.length);
  for (let t = 0; t < indices.length / 3; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => indices[t * 3 + k] * 3);
    const u = [0, 1, 2].map((k) => positions[b + k] - positions[a + k]);
    const w = [0, 1, 2].map((k) => positions[c + k] - positions[a + k]);
    const nn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(nn[0], nn[1], nn[2]) || 1;
    for (let k = 0; k < 3; k++) normals[t * 3 + k] = nn[k] / l;
  }
  const mesh: Mesh = { positions, indices, normals };
  const geometry = { kind: 'mesh' as const, mesh, adjacency: buildAdjacency(mesh), rawPoints: positions };
  const job = setStock(setModel(createJob(), { sourceName: 'p.stl', blobId: 'm1', kind: 'mesh', importUnits: 'mm' }), { mode: 'auto', margin: { xy: 0, zTop: 0, zBottom: 0 } });
  return { geometry, job, top: (() => { try { return faceAt(geometry as never, 1, 1, 10); } catch { return null as never; } })(), floor: faceAt(geometry as never, 20.5, 20.2, 4) };
}
const circle = (sides: number, R: number): [number, number][] => Array.from({ length: sides }, (_, i) => [20 + R * Math.cos((2 * Math.PI * i) / sides), 20 + R * Math.sin((2 * Math.PI * i) / sides)]);
/** A square of half-size h with corners rounded to radius r in `segs` facets each. */
function rounded(h: number, r: number, segs: number): [number, number][] {
  const out: [number, number][] = [];
  for (let c = 0; c < 4; c++) {
    const cx = 20 + (c === 0 || c === 3 ? h - r : -(h - r)), cy = 20 + (c < 2 ? h - r : -(h - r));
    for (let k = 0; k <= segs; k++) {
      const a = (c * Math.PI) / 2 + ((Math.PI / 2) * k) / segs;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return out;
}

function run(job: ReturnType<typeof createJob>, geometry: unknown, cmds: JobCommand[]) {
  return generateJob(applyCommands(job, cmds), geometry as never);
}
const handPath = (moves: Move[], toolId = 't3'): Toolpath => ({ operationId: 'x', operationName: 'x', toolId, rpm: 1, coolant: 'off', clearance: 5, moves });
const chamferCmds = (geometry: unknown[], patch: Record<string, unknown>): JobCommand[] => [
  { type: 'addTool', tool: v90 }, { type: 'addOperation', opType: 'chamfer', toolId: 'v90', id: 'c' },
  { type: 'updateOperation', id: 'c', patch: { geometry, tipOffset: 0.2, ...patch } as never },
];

describe('gouge check: chamfers', () => {
  describe.each([[0.3], [1]])('width %d, tip offset 0.2 on the stepped mesh', (width) => {
    it('the boss outline is clean', () => {
      const s = steppedSetup();
      const r = run(s.job, s.geometry, chamferCmds([s.boss], { width }))[0];
      expect(r.toolpath).not.toBeNull();
      expect(gouges(r)).toEqual([]);
    });
    it('the slab outline is clean', () => {
      const s = steppedSetup();
      const r = run(s.job, s.geometry, chamferCmds([{ kind: 'meshLoop', face: s.slab, loop: 0 }], { width }))[0];
      expect(r.toolpath).not.toBeNull();
      expect(gouges(r)).toEqual([]);
    });
  });

  it.each([24, 64])('a countersink in a %i-gon hole is clean', (sides) => {
    const { geometry, job, top } = pocketBlock(circle(sides, 5));
    for (const width of [0.3, 1]) {
      const r = run(job, geometry, chamferCmds([{ kind: 'meshHole', face: top, loop: 1 }], { width }))[0];
      expect(r.toolpath).not.toBeNull();
      expect(gouges(r)).toEqual([]);
    }
  });

  it('the allowance does not hide a cone dipping well below the edge it cuts', () => {
    const { geometry, job } = steppedSetup();
    const ctx = camContext(job, geometry as never);
    // the boss wall is at program x 25 (z -10..0); the tip sits 2 mm from it, 8 mm down: the cone cuts 6 mm into the wall
    const deep = handPath([
      { kind: 'rapid', to: { x: 23, y: 25, z: 5 } },
      { kind: 'line', to: { x: 23, y: 25, z: -8 }, feed: 100 },
    ], 'v90');
    expect(gougeCheck(deep, v90, ctx, { allowance: 1 }).diagnostics[0]?.message).toMatch(/^Cuts into the model by up to 6\.\d\d mm/);
    // the designed depth below the edge is fine
    const ok = handPath([
      { kind: 'rapid', to: { x: 23, y: 25, z: 5 } },
      { kind: 'line', to: { x: 23, y: 25, z: -1 }, feed: 100 },
    ], 'v90');
    expect(gougeCheck(ok, v90, ctx, { allowance: 1 }).diagnostics).toEqual([]);
  });

  it('a chamfer whose cone sits on the boss top instead of at its edge is still flagged', () => {
    const s = steppedSetup();
    // side inside puts the tool centre over the boss: the tip is 1.2 mm below a flat top that the cone must not cut
    const r = run(s.job, s.geometry, chamferCmds([s.boss], { width: 1, side: 'inside' }))[0];
    expect(gouges(r)[0]).toMatch(/^Cuts into the model by up to/);
  });
});

describe('gouge check: faceted round walls', () => {
  describe.each([24, 48])('a 10 mm blind hole with %i facets', (sides) => {
    const profile = (radial: number) => {
      const { geometry, job, top } = pocketBlock(circle(sides, 5));
      return run(job, geometry, [
        { type: 'addTool', tool: t3 }, { type: 'addOperation', opType: 'profile', toolId: 't3', id: 'p' },
        { type: 'updateOperation', id: 'p', patch: { geometry: [{ kind: 'meshLoop', face: top, loop: 1 }], side: 'inside', stockRadial: radial, heights: { bottom: { from: 'modelTop', offset: -6 } } } as never },
      ])[0];
    };
    it('an inside profile at stockRadial 0 is clean', () => {
      const r = profile(0);
      expect(r.toolpath).not.toBeNull();
      expect(gouges(r)).toEqual([]);
    });
    it('the same profile pushed 0.5 mm into the wall is flagged', () => {
      const { geometry, job, top } = pocketBlock(circle(sides, 5));
      const r = run(job, geometry, [
        { type: 'addTool', tool: t3 }, { type: 'addOperation', opType: 'profile', toolId: 't3', id: 'p' },
        { type: 'updateOperation', id: 'p', patch: { geometry: [{ kind: 'meshLoop', face: top, loop: 1 }], side: 'inside', stockRadial: 0, heights: { bottom: { from: 'modelTop', offset: -6 } } } as never },
      ])[0];
      // program centre (20, 20); the tool centre runs at radius 3.5, so scaling by 4 / 3.5 moves the cutter edge 0.5 mm into the wall
      const k = 4 / 3.5;
      const grow = (p: { x: number; y: number; z: number }) => ({ x: 20 + (p.x - 20) * k, y: 20 + (p.y - 20) * k, z: p.z });
      const pushed = { ...r.toolpath!, moves: r.toolpath!.moves.map((m) => (m.kind === 'cycle' ? m : { ...m, to: grow(m.to) }) as Move) };
      const ctx = camContext(job, geometry as never);
      expect(gougeCheck(pushed, t3, ctx, { sagitta: 5 * (1 - Math.cos(Math.PI / sides)) }).diagnostics[0]?.message).toMatch(/^Cuts into the model by up to/);
    });
    it('a pocket on the hole floor at stockRadial 0 is clean', () => {
      const { geometry, job, floor } = pocketBlock(circle(sides, 5));
      const r = run(job, geometry, [
        { type: 'addTool', tool: t3 }, { type: 'addOperation', opType: 'pocket', toolId: 't3', id: 'k' },
        { type: 'updateOperation', id: 'k', patch: { geometry: [floor], stockRadial: 0, stockAxial: 0, heights: { bottom: { from: 'face', offset: 0, face: floor } } } as never },
      ])[0];
      expect(r.toolpath).not.toBeNull();
      expect(gouges(r)).toEqual([]);
    });
    it('a hand-made path 0.5 mm into the wall is flagged despite the sagitta allowance', () => {
      const { geometry, job } = pocketBlock(circle(sides, 5));
      const ctx = camContext(job, geometry as never);
      const x = 20 + 5 - 1.5 + 0.5;
      const path = handPath([
        { kind: 'rapid', to: { x, y: 20, z: 5 } },
        { kind: 'line', to: { x, y: 20, z: -6 }, feed: 100 },
      ]);
      expect(gougeCheck(path, t3, ctx, { sagitta: 5 * (1 - Math.cos(Math.PI / sides)) }).diagnostics[0]?.message).toMatch(/^Cuts into the model by up to/);
    });
  });

  it('a pocket bounded by a face with rounded corners is clean', () => {
    const { geometry, job, floor } = pocketBlock(rounded(12, 6, 6));
    const r = run(job, geometry, [
      { type: 'addTool', tool: t3 }, { type: 'addOperation', opType: 'pocket', toolId: 't3', id: 'k' },
      { type: 'updateOperation', id: 'k', patch: { geometry: [floor], stockRadial: 0, stockAxial: 0, heights: { bottom: { from: 'face', offset: 0, face: floor } } } as never },
    ])[0];
    expect(r.toolpath).not.toBeNull();
    expect(gouges(r)).toEqual([]);
  });
});

describe('gouge check: mesh index cache', () => {
  it('keeps one index per cell bucket however many tool sizes are checked', () => {
    const { geometry, job } = steppedSetup();
    const ctx = camContext(job, geometry as never);
    const before = [0.5, 1, 2, 3].map((c) => meshIndex(ctx, c));
    for (const d of [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 25]) {
      gougeCheck(handPath([{ kind: 'rapid', to: { x: 0, y: 0, z: 5 } }]), { ...t3, diameter: d }, ctx);
    }
    // nothing was evicted by the sweep: the same four index objects are still cached
    [0.5, 1, 2, 3].forEach((c, i) => expect(meshIndex(ctx, c)).toBe(before[i]));
  });
});

describe('gouge check: coarse polygons stay polygons', () => {
  const oct = Array.from({ length: 8 }, (_, i): [number, number] => [20 + 10 * Math.cos((i * Math.PI) / 4 + Math.PI / 8), 20 + 10 * Math.sin((i * Math.PI) / 4 + Math.PI / 8)]);
  const h = 10, c = 2;
  const chamSq: [number, number][] = [[20 + h - c, 20 - h], [20 + h, 20 - h + c], [20 + h, 20 + h - c], [20 + h - c, 20 + h], [20 - h + c, 20 + h], [20 - h, 20 + h - c], [20 - h, 20 - h + c], [20 - h + c, 20 - h]];
  // the polygon's wall lines: distance from the centre along each edge normal
  const walls = (poly: [number, number][]) => poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const nx = q[1] - p[1], ny = p[0] - q[0], l = Math.hypot(nx, ny);
    return { nx: nx / l, ny: ny / l, d: ((p[0] - 20) * nx + (p[1] - 20) * ny) / l };
  });
  // a regular 16-gon of R 15: round enough to look like a circle, but its facets sit 0.29 mm inside it
  const gon16 = Array.from({ length: 16 }, (_, i): [number, number] => [20 + 15 * Math.cos((i * Math.PI) / 8), 20 + 15 * Math.sin((i * Math.PI) / 8)]);
  const cases: [string, [number, number][], number][] = [['octagon', oct, 3], ['chamfered square', chamSq, 3], ['chamfered square', chamSq, 10], ['coarse 16-gon', gon16, 3]];
  it.each(cases)('%s pocket, %i mm tool: follows the polygon, no gouge', (_name, poly, dia) => {
    const { geometry, job, floor } = pocketBlock(poly);
    const tool = { ...t3, diameter: dia };
    const j = applyCommands(job, [
      { type: 'addTool', tool }, { type: 'addOperation', opType: 'pocket', toolId: 't3', id: 'k' },
      { type: 'updateOperation', id: 'k', patch: { geometry: [floor], stockRadial: 0, stockAxial: 0, heights: { bottom: { from: 'face', offset: 0, face: floor } } } as never },
      { type: 'addOperation', opType: 'profile', toolId: 't3', id: 'p' },
      { type: 'updateOperation', id: 'p', patch: { geometry: [floor], side: 'inside', stockRadial: 0, heights: { bottom: { from: 'face', offset: 0, face: floor } } } as never },
    ]);
    const geo = resolveGeometry(j.operations[0], camContext(j, geometry as never));
    expect(geo.sagitta).toBeLessThanOrEqual(0.05 + 1e-9); // coarse polygons are not fitted into circles
    const ws = walls(poly);
    for (const r of generateJob(j, geometry as never)) {
      expect(r.toolpath).not.toBeNull();
      expect(gouges(r)).toEqual([]);
      for (const m of r.toolpath!.moves) {
        if (m.kind === 'cycle' || m.kind === 'rapid' || m.to.z > -0.5) continue;
        // the tool edge never passes a flat wall by more than the tolerance (corners may sit further in, walls only matter in reach)
        const reach = Math.max(...ws.map((w) => (m.to.x - 20) * w.nx + (m.to.y - 20) * w.ny - w.d)) + dia / 2;
        expect(reach).toBeLessThanOrEqual(0.01 + 1e-6);
      }
    }
  });

  it('a hand-made path 0.5 mm into a flat octagon wall is flagged', () => {
    const { geometry, job, floor } = pocketBlock(oct);
    const j = applyCommands(job, [
      { type: 'addTool', tool: t3 }, { type: 'addOperation', opType: 'pocket', toolId: 't3', id: 'k' },
      { type: 'updateOperation', id: 'k', patch: { geometry: [floor], heights: { bottom: { from: 'face', offset: 0, face: floor } } } as never },
    ]);
    const ctx = camContext(j, geometry as never);
    const sag = resolveGeometry(j.operations[0], ctx).sagitta;
    const apothem = 10 * Math.cos(Math.PI / 8);
    // wall normal at angle 0 (the first edge is centred on +x after the pi/8 offset): tool edge 0.5 mm beyond it
    const x = 20 + apothem - 1.5 + 0.5;
    const path = handPath([{ kind: 'rapid', to: { x, y: 20, z: 5 } }, { kind: 'line', to: { x, y: 20, z: -5 }, feed: 100 }]);
    expect(gougeCheck(path, t3, ctx, { sagitta: sag }).diagnostics[0]?.message).toMatch(/^Cuts into the model by up to/);
  });
});
